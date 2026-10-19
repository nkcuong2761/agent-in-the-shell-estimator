/**
 * Scopewise API (Hono). Runs on Node (src/server.ts) and Vercel (api/index.ts).
 * Every request body and response is validated with zod; errors are `{ error: { code, message } }`.
 * Jira tickets: GET /jira/issues (ongoing, to pick from), GET /jira/issue/:key (one ticket with status and hours),
 * POST /jira/import/:key (a finished ticket becomes a real history project), GET /jira/imports (what was imported).
 */
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  Conversation,
  AskRequest,
  AskResponse,
  BriefPack,
  Category,
  Estimate,
  EstimateRequest,
  HealthResponse,
  Hindsight,
  JiraIssueDetail,
  JiraIssuesResponse,
  JiraPushRequest,
  JiraPushResponse,
  Lesson,
  LessonsResponse,
  PanelRequest,
  PanelResponse,
  PostmortemRequest,
  PostmortemResponse,
  ProjectType,
  type ScopeResult,
  RealProject,
  RealProjectsResponse,
  ScopeRequest,
  ScopeResponse,
} from '@scopewise/shared';
import { runEstimate, squadStatsFromWorklogs, worklogsFromTimesheet } from '@scopewise/engine';
import { runAsk, runPanel, runPanelOffline, runPostmortem, runScopeAgent, runScopeOffline } from './agents';
import { API_VERSION, loadSeedHistory, type SeedHistory } from './data';
import { analogsFor, prepareFromRequest } from './engineRun';
import { env } from './env';
import { ApiError, claudeNotConfigured, errorBody, jiraNotConfigured } from './errors';
import { importFinishedIssue, JiraClient, listOpenIssues, pushEstimate, readHistory, readIssueDetail } from './jira';
import { rateLimit } from './rateLimit';
import { getStore, type JiraCache } from './store';
import { parseTimesheetCsv } from './timesheet';
import { briefFromForm, checkBriefSize, UPLOAD_LIMITS } from './upload';

const MINUTE = 60_000;

// --- CORS --------------------------------------------------------------------------------------

const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const GITHUB_PAGES = /^https:\/\/[a-z0-9-]+\.github\.io$/i;

export function isAllowedOrigin(origin: string): boolean {
  const o = origin.replace(/\/$/, '');
  return LOCALHOST.test(o) || GITHUB_PAGES.test(o) || env.corsOrigins().includes(o);
}

// --- helpers -----------------------------------------------------------------------------------

async function jsonBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, 'invalid_json', 'The request body must be valid JSON.');
  }
  return schema.parse(raw);
}

const requireClaude: MiddlewareHandler = async (_c, next) => {
  if (!env.anthropicKey()) throw claudeNotConfigured();
  await next();
};

export const NO_KEY_NOTE = 'The API has no Claude key, so built-in rules read the brief instead of Claude.';

/**
 * Claude when there is a key, otherwise the engine's offline stand-in. A Claude failure (no credit, bad key,
 * outage, invalid output) also falls back, with the reason in `note`; request errors (bad input) still throw.
 */
async function withOfflineFallback<T extends object>(label: string, live: () => Promise<T>, offline: () => T): Promise<T & { note?: string }> {
  if (!env.anthropicKey()) return { ...offline(), note: NO_KEY_NOTE };
  try {
    return { ...(await live()) };
  } catch (err) {
    if (!(err instanceof ApiError) || !err.code.startsWith('claude_')) throw err;
    console.warn(`[${label}] Claude failed (${err.code}); using the offline heuristic instead: ${err.message}`);
    return { ...offline(), note: `Claude could not read this brief (${err.message}), so built-in rules did.` };
  }
}

function jiraClient(): JiraClient {
  const cfg = env.jira();
  if (!cfg) throw jiraNotConfigured();
  return new JiraClient(cfg);
}

function issueKey(c: Context): string {
  const key = (c.req.param('key') ?? '').toUpperCase();
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) throw new ApiError(400, 'bad_issue_key', `"${key}" is not a Jira issue key (for example SUB-142).`);
  return key;
}

/** For post-mortems: synced Jira history when a cache exists (Jira is the system of record), else seed. Estimates use seed history so they match demo mode. */
async function history(): Promise<SeedHistory> {
  const seed = loadSeedHistory();
  const cache = await getStore().getJiraCache().catch(() => null);
  if (!cache || cache.projects.length === 0) return seed;
  return { projects: cache.projects, items: cache.items, squads: seed.squads, worklogs: cache.worklogs.length ? cache.worklogs : seed.worklogs };
}

/** What Scopewise would have said about a ticket, from its text alone: scope (Claude or the rule-based reader), offline panel, engine estimate. */
async function hindsightFor(key: string, detail: { summary: string; text: string }, squadId: string, startDate: string, seed: SeedHistory): Promise<Hindsight> {
  const brief: BriefPack = { id: key, title: detail.summary || key, sources: [{ kind: 'jira', name: `jira-${key}.md`, text: detail.text }] };
  const lessons = await getStore().listLessons().catch(() => []);
  const { scope, provenance } = await withOfflineFallback(
    'hindsight scope',
    () => runScopeAgent(brief, { lessons }),
    () => runScopeOffline(brief),
  );
  const panel = runPanelOffline(scope, analogsFor(scope, seed)).panel;
  const est = runEstimate(prepareFromRequest({ scope, panel, teamShape: oneEachRole(scope), squadId, startDate, answeredQuestionIds: [], droppedItemIds: [] }, seed));
  return Hindsight.parse({ effortH: Math.round(est.total.p50), safeEffortH: Math.round(est.total.p80), likelyDate: est.p50Date, safeDate: est.commitDate, scopeProvenance: provenance });
}

/** One person per role the scope's items need. */
function oneEachRole(scope: ScopeResult): Record<string, number> {
  return Object.fromEntries([...new Set(scope.items.map((i) => i.role))].map((r) => [r, 1]));
}

const aiLimit = rateLimit({ limit: 30, windowMs: MINUTE, name: 'AI' });
const jiraLimit = rateLimit({ limit: 20, windowMs: MINUTE, name: 'Jira' });
const generalLimit = rateLimit({ limit: 240, windowMs: MINUTE, name: 'API' });

const tooLarge = (c: Context) => c.json(errorBody('payload_too_large', 'The request body is too large.'), 413);

// --- app ---------------------------------------------------------------------------------------

export function createApp() {
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: (origin) => (origin && isAllowedOrigin(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
      maxAge: 86400,
    }),
  );
  app.use('*', generalLimit);
  app.use('/scope', bodyLimit({ maxSize: UPLOAD_LIMITS.maxTotalBytes + 512 * 1024, onError: tooLarge }));
  app.use('/timesheet', bodyLimit({ maxSize: 5 * 1024 * 1024, onError: tooLarge }));
  for (const path of ['/panel', '/estimate', '/ask', '/postmortem', '/jira/push', '/lessons']) {
    app.use(path, bodyLimit({ maxSize: 1024 * 1024, onError: tooLarge }));
  }

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(errorBody(err.code, err.message, err.details), err.status);
    if (err instanceof z.ZodError) return c.json(errorBody('invalid_request', z.prettifyError(err), err.issues.slice(0, 20)), 400);
    if (err instanceof HTTPException) return c.json(errorBody(`http_${err.status}`, err.message || 'Request failed'), err.status);
    console.error('[api] unhandled error:', err);
    return c.json(errorBody('internal_error', 'Something went wrong on the API. Check the server logs.'), 500);
  });
  app.notFound((c) => c.json(errorBody('not_found', `No route for ${c.req.method} ${c.req.path}.`), 404));

  app.get('/', (c) => c.json({ name: 'scopewise-api', version: API_VERSION, docs: 'GET /health for features' }));

  app.get('/health', (c) =>
    c.json(
      HealthResponse.parse({
        ok: true,
        version: API_VERSION,
        features: { claude: Boolean(env.anthropicKey()), jira: env.jira() !== null, database: Boolean(env.databaseUrl()) },
        model: env.model(),
      }),
    ),
  );

  // Scope: JSON { brief } (or a bare BriefPack), or multipart upload of brief files.
  // Without a Claude key, or when Claude fails (no credit, bad key, outage), the engine's rule-based reader
  // answers instead; the response is labelled offline-heuristic and `note` says why.
  app.post('/scope', aiLimit, async (c) => {
    const type = c.req.header('content-type') ?? '';
    let brief: BriefPack;
    if (type.startsWith('multipart/form-data')) {
      brief = await briefFromForm(await c.req.parseBody({ all: true }));
    } else {
      brief = (await jsonBody(c, z.union([ScopeRequest, BriefPack.transform((b) => ({ brief: b }))]))).brief;
      checkBriefSize(brief);
    }
    const lessons = await getStore().listLessons().catch(() => []);
    const out = await withOfflineFallback(
      'scope',
      () => runScopeAgent(brief, { lessons }),
      () => runScopeOffline(brief),
    );
    return c.json({ ...ScopeResponse.parse(out), brief });
  });

  app.post('/panel', aiLimit, async (c) => {
    const req = await jsonBody(c, PanelRequest);
    checkBriefSize(req.brief);
    const analogs = analogsFor(req.scope, loadSeedHistory());
    const out = await withOfflineFallback(
      'panel',
      () => runPanel(req.brief, req.scope, analogs),
      () => runPanelOffline(req.scope, analogs),
    );
    return c.json(PanelResponse.parse(out));
  });

  app.post('/estimate', async (c) => {
    const req = await jsonBody(c, EstimateRequest);
    const est = runEstimate(prepareFromRequest(req, loadSeedHistory()));
    return c.json(Estimate.parse(est));
  });

  app.post('/ask', aiLimit, requireClaude, async (c) => {
    const req = await jsonBody(c, AskRequest);
    const out = await runAsk(req.messages, req.context, loadSeedHistory());
    return c.json(AskResponse.parse(out));
  });

  // Post-mortem works without a key too: it then returns the engine's template notes (labelled offline-heuristic).
  app.post('/postmortem', aiLimit, async (c) => {
    const { projectId } = await jsonBody(c, PostmortemRequest);
    const h = await history();
    const project = h.projects.find((p) => p.id === projectId || p.jiraKey === projectId);
    if (!project) throw new ApiError(404, 'project_not_found', `No project with id ${projectId}.`);
    if (project.status !== 'closed') throw new ApiError(409, 'project_open', `${project.id} is still open; post-mortems run on closed projects.`);
    const out = await runPostmortem(project, h.items);
    if (out.provenance.generatedBy === 'claude' && out.result.lessons.length) {
      await getStore()
        .addLessons(out.result.lessons.map((l, i) => ({ id: `pm-${project.id}-${i + 1}`, projectId: project.id, cause: l.cause, note: l.note, appliesTo: { category: l.appliesTo.category, projectType: ProjectType.safeParse(l.appliesTo.projectType).data }, source: 'postmortem' })))
        .catch((err: unknown) => console.warn('[postmortem] could not save lessons:', err));
    }
    return c.json(PostmortemResponse.parse(out));
  });

  app.get('/jira/history', jiraLimit, async (c) => {
    const client = jiraClient();
    const store = getStore();
    const refresh = ['1', 'true'].includes(c.req.query('refresh') ?? '');
    let cache: JiraCache | null = refresh ? null : await store.getJiraCache();
    const cached = cache !== null;
    if (!cache) {
      cache = await readHistory(client, loadSeedHistory().squads);
      await store.setJiraCache(cache);
    }
    const squads = [...new Set(cache.projects.map((p) => p.squad))];
    const squadStats = Object.fromEntries(squads.map((s) => [s, squadStatsFromWorklogs(cache.worklogs, s).value]));
    return c.json({ source: 'jira', cached, ...cache, squadStats });
  });

  // Ongoing (unresolved) tickets in the configured project, newest change first, to pick one on the intake screen.
  app.get('/jira/issues', jiraLimit, async (c) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
    return c.json(JiraIssuesResponse.parse(await listOpenIssues(jiraClient(), limit)));
  });

  // One issue: summary and description as brief text, plus its status and hours (so a finished ticket can be told apart).
  app.get('/jira/issue/:key', jiraLimit, async (c) => {
    return c.json(JiraIssueDetail.parse(await readIssueDetail(jiraClient(), issueKey(c))));
  });

  // A finished ticket becomes a real closed project in the history, with a post-mortem (engine template notes without a Claude key).
  // A ticket without hours is imported "dates-only": the engine estimates it from its text in hindsight, so calendar time can still be compared.
  app.post('/jira/import/:key', jiraLimit, async (c) => {
    const client = jiraClient();
    const key = issueKey(c);
    const seed = loadSeedHistory();
    const { project, items, detail, datesOnly } = await importFinishedIssue(client, key, seed.squads);
    const pm = await runPostmortem(project, items);
    let hindsight: Hindsight | undefined;
    if (datesOnly) {
      pm.result.summary = `No time was logged on ${key} in Jira, so only calendar time can be compared: it was opened on ${project.startDate} and finished on ${project.endDate}.`;
      hindsight = await hindsightFor(key, detail, project.squad, project.startDate, seed);
    }
    const real = RealProject.parse({
      project,
      items,
      postmortem: pm.result,
      postmortemProvenance: pm.provenance,
      ...(hindsight ? { hindsight } : {}),
      importedAt: new Date().toISOString(),
      url: `${client.cfg.baseUrl}/browse/${key}`,
    });
    await getStore().putRealProject(real);
    return c.json(real, 201);
  });

  // Imported tickets from the store; no Jira call, so it answers even when Jira is not configured.
  app.get('/jira/imports', async (c) => c.json(RealProjectsResponse.parse({ projects: await getStore().listRealProjects() })));

  // Conversations, saved from the web app in live mode (the browser keeps its own copy too).
  app.get('/conversations', async (c) => c.json({ conversations: await getStore().listConversations() }));
  app.put('/conversations/:id', async (c) => {
    const conv = await jsonBody(c, Conversation);
    if (conv.id !== c.req.param('id')) throw new ApiError(400, 'id_mismatch', 'The conversation id in the URL and the body differ.');
    await getStore().putConversation(conv);
    return c.json({ ok: true });
  });

  app.post('/jira/push', jiraLimit, async (c) => {
    const req = await jsonBody(c, JiraPushRequest);
    const cfg = env.jira();
    if (!cfg && !req.dryRun) throw jiraNotConfigured();
    const out = await pushEstimate(cfg ? new JiraClient(cfg) : null, req, env.publicWebUrl());
    return c.json(JiraPushResponse.parse(out), out.dryRun ? 200 : 201);
  });

  app.get('/lessons', async (c) => {
    const pt = ProjectType.safeParse(c.req.query('projectType'));
    const cat = Category.safeParse(c.req.query('category'));
    const all = await getStore().listLessons();
    const lessons = all.filter(
      (l) => (!pt.success || !l.appliesTo.projectType || l.appliesTo.projectType === pt.data) && (!cat.success || !l.appliesTo.category || l.appliesTo.category === cat.data),
    );
    return c.json(LessonsResponse.parse({ lessons }));
  });

  app.post('/lessons', async (c) => {
    const body = await jsonBody(c, z.union([z.object({ lessons: z.array(Lesson).min(1).max(100) }), z.array(Lesson).min(1).max(100), Lesson]));
    const lessons = Array.isArray(body) ? body : 'lessons' in body ? body.lessons : [body];
    const added = await getStore().addLessons(lessons.map((l) => ({ ...l, source: l.source ?? 'user' })));
    return c.json(LessonsResponse.parse({ lessons: added }), 201);
  });

  // Timesheet CSV (date,squad,role,hours) as text/csv, JSON { csv }, or a multipart `file`.
  app.post('/timesheet', async (c) => {
    const type = c.req.header('content-type') ?? '';
    let csv: string;
    if (type.startsWith('multipart/form-data')) {
      const body = await c.req.parseBody();
      const f = body.file;
      if (!f || typeof f === 'string') throw new ApiError(400, 'no_file', 'Send the CSV as a multipart field named "file".');
      csv = await f.text();
    } else if (type.includes('json')) {
      csv = (await jsonBody(c, z.object({ csv: z.string().min(1) }))).csv;
    } else {
      csv = await c.req.text();
    }
    const { rows, skipped } = parseTimesheetCsv(csv);
    if (!rows.length) throw new ApiError(422, 'no_rows', `No valid rows found.${skipped.length ? ` First problem (line ${skipped[0]?.line}): ${skipped[0]?.reason}` : ''}`);
    const squads = loadSeedHistory().squads;
    const headcount = (squad: string, role: string) => squads.find((s) => s.id === squad)?.members.find((m) => m.role === role)?.count ?? 1;
    const worklogs = worklogsFromTimesheet(rows, headcount);
    const ids = [...new Set(rows.map((r) => r.squad))].sort();
    const stats = Object.fromEntries(ids.map((s) => [s, squadStatsFromWorklogs(worklogs, s)]));
    return c.json({ rowCount: rows.length, skipped: skipped.slice(0, 50), skippedCount: skipped.length, worklogs, stats });
  });

  return app;
}

export const app = createApp();
export default app;
