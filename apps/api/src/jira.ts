/**
 * Jira Cloud REST v3 client (basic auth: JIRA_EMAIL + JIRA_API_TOKEN). Credentials never leave the API.
 *
 * Conventions (CLAUDE.md §7): epics are projects, child issues are items.
 *   epic labels:  type:<projectType> size:<S|M|L|XL> squad:<id> client:<slug> seed:<id> [leave-overlap]
 *   item labels:  phase:<phaseId> cat:<category> seed:<id> [cx:<S|M|L>] [added-after-kickoff] [blocked]
 * Jira can't backdate `created`/`resolutiondate` through the API, so seeded issues also carry
 * `start:`/`end:` (epics) and `created:`/`resolved:` (items) date labels; reads prefer them when present.
 */
import { z } from 'zod';
import type { HistoryItem, HistoryProject, JiraPushRequest, JiraPushResponse, Squad, Worklog } from '@scopewise/shared';
import { Category, Complexity, PHASE_TEMPLATES, ProjectType, Size } from '@scopewise/shared';
import { worklogsFromTimesheet } from '@scopewise/engine';
import type { JiraConfig } from './env';
import { ApiError } from './errors';
import type { JiraCache } from './store';

const H = 3600;
const TIMEOUT_MS = 30_000;

// --- low-level client --------------------------------------------------------------------------

const JiraErrorBody = z.object({ errorMessages: z.array(z.string()).optional(), errors: z.record(z.string(), z.string()).optional() }).partial();

export class JiraClient {
  constructor(readonly cfg: JiraConfig) {}

  private get auth(): string {
    return `Basic ${Buffer.from(`${this.cfg.email}:${this.cfg.apiToken}`).toString('base64')}`;
  }

  async request<T = unknown>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: { Authorization: this.auth, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new ApiError(502, 'jira_unreachable', `Could not reach Jira at ${this.cfg.baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const text = await res.text();
    if (!res.ok) {
      const parsed = JiraErrorBody.safeParse(safeJson(text));
      const detail = parsed.success
        ? [...(parsed.data.errorMessages ?? []), ...Object.entries(parsed.data.errors ?? {}).map(([k, v]) => `${k}: ${v}`)].join('; ')
        : text.slice(0, 300);
      if (res.status === 401 || res.status === 403) {
        throw new ApiError(502, 'jira_auth', `Jira rejected the credentials (${res.status}). Check JIRA_EMAIL / JIRA_API_TOKEN and project permissions.${detail ? ` ${detail}` : ''}`);
      }
      if (res.status === 429) throw new ApiError(429, 'jira_rate_limited', 'Jira rate limit reached. Try again shortly.');
      if (res.status === 404) throw new ApiError(502, 'jira_not_found', `Jira returned 404 for ${method} ${path}.${detail ? ` ${detail}` : ''} Check JIRA_BASE_URL and JIRA_PROJECT_KEY.`);
      throw new ApiError(502, 'jira_error', `Jira ${method} ${path} failed (${res.status}): ${detail || 'no details'}`);
    }
    return (text ? safeJson(text) : null) as T;
  }

  /** Enhanced JQL search (`/rest/api/3/search/jql`), following nextPageToken. */
  async search(jql: string, fields: string[], limit = 5000): Promise<JiraIssue[]> {
    const out: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    do {
      const page = SearchPage.parse(
        await this.request('POST', '/rest/api/3/search/jql', { jql, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }),
      );
      out.push(...page.issues);
      nextPageToken = page.isLast ? undefined : page.nextPageToken;
    } while (nextPageToken && out.length < limit);
    return out;
  }

  async createIssue(fields: Record<string, unknown>): Promise<{ id: string; key: string }> {
    return CreatedIssue.parse(await this.request('POST', '/rest/api/3/issue', { fields }));
  }

  /** Bulk create (≤ 50 per call). Returns keys in order; throws if any element failed. */
  async bulkCreate(fieldsList: Record<string, unknown>[]): Promise<string[]> {
    const keys: string[] = [];
    for (let i = 0; i < fieldsList.length; i += 50) {
      const chunk = fieldsList.slice(i, i + 50);
      const res = BulkCreated.parse(await this.request('POST', '/rest/api/3/issue/bulk', { issueUpdates: chunk.map((fields) => ({ fields })) }));
      if (res.errors?.length) {
        const first = res.errors[0];
        const msg = first ? JSON.stringify(first.elementErrors ?? first).slice(0, 300) : 'unknown';
        throw new ApiError(502, 'jira_bulk_create_failed', `Jira bulk create failed for ${res.errors.length} issue(s) (created ${res.issues.length}): ${msg}`);
      }
      keys.push(...res.issues.map((x) => x.key));
    }
    return keys;
  }

  async addWorklog(issueKey: string, seconds: number, startedIsoDate: string): Promise<void> {
    if (seconds < 60) return;
    await this.request('POST', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog?adjustEstimate=leave&notifyUsers=false`, {
      timeSpentSeconds: Math.round(seconds),
      started: `${startedIsoDate.slice(0, 10)}T09:00:00.000+0000`,
    });
  }

  /** Move an issue to a status in the Done category, if the workflow offers one. */
  async transitionToDone(issueKey: string): Promise<boolean> {
    const res = Transitions.parse(await this.request('GET', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`));
    const t = res.transitions.find((x) => x.to?.statusCategory?.key === 'done');
    if (!t) return false;
    await this.request('POST', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, { transition: { id: t.id } });
    return true;
  }

  async fields(): Promise<z.infer<typeof FieldList>> {
    return FieldList.parse(await this.request('GET', '/rest/api/3/field'));
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// --- response schemas (only what we read) -------------------------------------------------------

const IssueFields = z
  .object({
    summary: z.string().nullish(),
    labels: z.array(z.string()).nullish(),
    timeoriginalestimate: z.number().nullish(),
    timespent: z.number().nullish(),
    created: z.string().nullish(),
    resolutiondate: z.string().nullish(),
    parent: z.object({ key: z.string() }).nullish(),
    issuetype: z.object({ name: z.string(), hierarchyLevel: z.number().optional(), subtask: z.boolean().optional() }).nullish(),
    status: z.object({ statusCategory: z.object({ key: z.string() }).nullish() }).nullish(),
    worklog: z
      .object({
        total: z.number().optional(),
        worklogs: z.array(z.object({ started: z.string(), timeSpentSeconds: z.number() })).default([]),
      })
      .nullish(),
  })
  .catchall(z.unknown());

const JiraIssue = z.object({ id: z.string(), key: z.string(), fields: IssueFields });
export type JiraIssue = z.infer<typeof JiraIssue>;

const SearchPage = z.object({
  issues: z.array(JiraIssue).default([]),
  nextPageToken: z.string().nullish().transform((v) => v ?? undefined),
  isLast: z.boolean().optional(),
});
const CreatedIssue = z.object({ id: z.string(), key: z.string() });
const BulkCreated = z.object({
  issues: z.array(CreatedIssue).default([]),
  errors: z.array(z.object({ status: z.number().optional(), elementErrors: z.unknown().optional(), failedElementNumber: z.number().optional() })).optional(),
});
const Transitions = z.object({
  transitions: z.array(z.object({ id: z.string(), name: z.string().optional(), to: z.object({ statusCategory: z.object({ key: z.string() }).optional() }).optional() })),
});
const FieldList = z.array(z.object({ id: z.string(), name: z.string(), schema: z.object({ custom: z.string().optional() }).partial().optional() }));
const WorklogPage = z.object({ worklogs: z.array(z.object({ started: z.string(), timeSpentSeconds: z.number() })).default([]) });

const MetaIssueType = z.object({ id: z.string(), name: z.string(), subtask: z.boolean().optional(), hierarchyLevel: z.number().optional() });
const MetaIssueTypes = z.object({ issueTypes: z.array(MetaIssueType).optional(), values: z.array(MetaIssueType).optional() });
const MetaField = z.object({
  fieldId: z.string(),
  key: z.string().optional(),
  name: z.string(),
  required: z.boolean().optional(),
  schema: z.object({ type: z.string().optional(), custom: z.string().optional(), system: z.string().optional() }).partial().optional(),
});
const MetaFields = z.object({ fields: z.array(MetaField).optional(), values: z.array(MetaField).optional() });
type MetaField = z.infer<typeof MetaField>;

// --- create metadata: how to link stories to an epic ---------------------------------------------

export interface CreateMeta {
  epicTypeId: string;
  storyTypeId: string;
  storyTypeName: string;
  /** `parent` (team-managed / modern company-managed), an Epic Link custom field, or none. */
  link: { kind: 'parent' } | { kind: 'epic-link'; fieldId: string } | { kind: 'none' };
  epicNameFieldId?: string;
  storyHasTimetracking: boolean;
  epicHasTimetracking: boolean;
  labelsOnStory: boolean;
}

const EPIC_LINK_CUSTOM = 'com.pyxis.greenhopper.jira:gh-epic-link';
const EPIC_NAME_CUSTOM = 'com.pyxis.greenhopper.jira:gh-epic-label';

/** Read issue types and their create fields instead of assuming `parent` works. */
export async function discoverCreateMeta(client: JiraClient): Promise<CreateMeta> {
  const key = encodeURIComponent(client.cfg.projectKey);
  const typesRes = MetaIssueTypes.parse(await client.request('GET', `/rest/api/3/issue/createmeta/${key}/issuetypes?maxResults=100`));
  const types = typesRes.issueTypes ?? typesRes.values ?? [];
  const epic = types.find((t) => t.hierarchyLevel === 1) ?? types.find((t) => t.name.toLowerCase() === 'epic');
  const standard = types.filter((t) => !t.subtask && (t.hierarchyLevel ?? 0) === 0);
  const story = standard.find((t) => t.name.toLowerCase() === 'story') ?? standard.find((t) => t.name.toLowerCase() === 'task') ?? standard[0];
  if (!epic) throw new ApiError(502, 'jira_no_epic_type', `Project ${client.cfg.projectKey} has no Epic issue type available for creation.`);
  if (!story) throw new ApiError(502, 'jira_no_story_type', `Project ${client.cfg.projectKey} has no Story or Task issue type available for creation.`);
  const fieldsOf = async (typeId: string): Promise<MetaField[]> => {
    const r = MetaFields.parse(await client.request('GET', `/rest/api/3/issue/createmeta/${key}/issuetypes/${typeId}?maxResults=200`));
    return r.fields ?? r.values ?? [];
  };
  const [storyFields, epicFields] = await Promise.all([fieldsOf(story.id), fieldsOf(epic.id)]);
  const has = (fs: MetaField[], id: string) => fs.some((f) => f.fieldId === id || f.key === id);
  const epicLink = storyFields.find((f) => f.schema?.custom === EPIC_LINK_CUSTOM || f.name.toLowerCase() === 'epic link');
  const epicName = epicFields.find((f) => f.schema?.custom === EPIC_NAME_CUSTOM || f.name.toLowerCase() === 'epic name');
  return {
    epicTypeId: epic.id,
    storyTypeId: story.id,
    storyTypeName: story.name,
    link: has(storyFields, 'parent') ? { kind: 'parent' } : epicLink ? { kind: 'epic-link', fieldId: epicLink.fieldId } : { kind: 'none' },
    epicNameFieldId: epicName?.fieldId,
    storyHasTimetracking: has(storyFields, 'timetracking'),
    epicHasTimetracking: has(epicFields, 'timetracking'),
    labelsOnStory: has(storyFields, 'labels'),
  };
}

export function linkFields(meta: CreateMeta, epicKey: string): Record<string, unknown> {
  if (meta.link.kind === 'parent') return { parent: { key: epicKey } };
  if (meta.link.kind === 'epic-link') return { [meta.link.fieldId]: epicKey };
  return {};
}

// --- ADF + time helpers ------------------------------------------------------------------------

type AdfInline = { type: 'text'; text: string; marks?: { type: 'link'; attrs: { href: string } }[] };
export type AdfSpan = string | { text: string; href: string };

/** Atlassian Document Format: one paragraph per array of spans. */
export function adfDoc(paragraphs: AdfSpan[][]) {
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.map((spans) => ({
      type: 'paragraph',
      content: spans
        .filter((s) => (typeof s === 'string' ? s.length > 0 : s.text.length > 0))
        .map((s): AdfInline => (typeof s === 'string' ? { type: 'text', text: s } : { type: 'text', text: s.text, marks: [{ type: 'link', attrs: { href: s.href } }] })),
    })),
  };
}

/** Hours → Jira duration string in minutes (e.g. 12.5h → "750m"). */
export function jiraDuration(hours: number): string {
  return `${Math.max(1, Math.round(hours * 60))}m`;
}

// --- read: Jira → history -----------------------------------------------------------------------

const labelValue = (labels: readonly string[], prefix: string) => labels.find((l) => l.startsWith(`${prefix}:`))?.slice(prefix.length + 1);
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : undefined);
const titleCase = (slug: string) => slug.split('-').filter(Boolean).map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');
const r1 = (x: number) => Math.round(x * 10) / 10;

const READ_FIELDS = ['summary', 'labels', 'timeoriginalestimate', 'timespent', 'created', 'resolutiondate', 'parent', 'issuetype', 'status', 'worklog'];

function complexityFromHours(h: number): z.infer<typeof Complexity> {
  return h < 12 ? 'S' : h < 28 ? 'M' : 'L';
}

/** Read epics + child issues + worklogs from the configured project and map them to history shapes. */
export async function readHistory(client: JiraClient, squads: readonly Squad[]): Promise<JiraCache> {
  const warnings: string[] = [];
  const pk = client.cfg.projectKey.replace(/"/g, '');
  const fieldList = await client.fields().catch(() => []);
  const epicLinkId = fieldList.find((f) => f.schema?.custom === EPIC_LINK_CUSTOM)?.id;
  const epics = await client.search(`project = "${pk}" AND issuetype = Epic ORDER BY created ASC`, READ_FIELDS);
  const children = await client.search(
    `project = "${pk}" AND issuetype != Epic AND issuetype not in subTaskIssueTypes() ORDER BY created ASC`,
    [...READ_FIELDS, ...(epicLinkId ? [epicLinkId] : [])],
  );

  const projects: HistoryProject[] = [];
  const byEpicKey = new Map<string, HistoryProject>();
  for (const e of epics) {
    const labels = e.fields.labels ?? [];
    const type = ProjectType.safeParse(labelValue(labels, 'type'));
    if (!type.success) {
      warnings.push(`${e.key}: skipped (no valid type: label)`);
      continue;
    }
    const size = Size.safeParse(labelValue(labels, 'size'));
    const clientSlug = labelValue(labels, 'client');
    const name = e.fields.summary ?? e.key;
    const done = e.fields.status?.statusCategory?.key === 'done' || labels.includes('state:closed');
    const p: HistoryProject = {
      id: labelValue(labels, 'seed') ?? e.key,
      seedId: labelValue(labels, 'seed') ?? e.key,
      name,
      client: clientSlug ? titleCase(clientSlug) : (name.split(':')[0] ?? name),
      projectType: type.data,
      size: size.success ? size.data : 'M',
      squad: labelValue(labels, 'squad') ?? 'unknown',
      startDate: labelValue(labels, 'start') ?? day(e.fields.created) ?? new Date().toISOString().slice(0, 10),
      endDate: labelValue(labels, 'end') ?? day(e.fields.resolutiondate) ?? '',
      status: done ? 'closed' : 'open',
      estimateH: 0,
      actualH: 0,
      labels,
      jiraKey: e.key,
    };
    projects.push(p);
    byEpicKey.set(e.key, p);
  }

  const items: HistoryItem[] = [];
  const timesheet: { date: string; squad: string; role: Worklog['role']; hours: number }[] = [];
  const needWorklogs: { issue: JiraIssue; item: HistoryItem; squad: string }[] = [];
  for (const c of children) {
    const parentKey = c.fields.parent?.key ?? (epicLinkId ? (c.fields[epicLinkId] as string | null | undefined) ?? undefined : undefined);
    const project = parentKey ? byEpicKey.get(parentKey) : undefined;
    if (!project) {
      warnings.push(`${c.key}: skipped (no parent epic with a type: label)`);
      continue;
    }
    const labels = c.fields.labels ?? [];
    const template = PHASE_TEMPLATES[project.projectType];
    const phaseLabel = labelValue(labels, 'phase');
    const phase = template.find((p) => p.id === phaseLabel) ?? template.find((p) => p.role === 'engineer') ?? template[0];
    if (!phase) continue;
    if (phaseLabel && phase.id !== phaseLabel) warnings.push(`${c.key}: phase "${phaseLabel}" not in ${project.projectType} template; using ${phase.id}`);
    const cat = Category.safeParse(labelValue(labels, 'cat'));
    const est = (c.fields.timeoriginalestimate ?? 0) / H;
    const spent = (c.fields.timespent ?? 0) / H;
    const cx = Complexity.safeParse(labelValue(labels, 'cx'));
    const item: HistoryItem = {
      id: labelValue(labels, 'seed') ?? c.key,
      seedId: labelValue(labels, 'seed') ?? c.key,
      projectId: project.id,
      phaseId: phase.id,
      title: c.fields.summary ?? c.key,
      category: cat.success ? cat.data : 'backend',
      complexity: cx.success ? cx.data : complexityFromHours(est),
      role: phase.role,
      originalEstimateH: r1(est),
      timeSpentH: r1(spent),
      labels,
      addedAfterKickoff: labels.includes('added-after-kickoff'),
      created: labelValue(labels, 'created') ?? day(c.fields.created) ?? project.startDate,
      resolved: labelValue(labels, 'resolved') ?? day(c.fields.resolutiondate),
      jiraKey: c.key,
    };
    items.push(item);
    if (!item.addedAfterKickoff) project.estimateH += item.originalEstimateH;
    project.actualH += item.timeSpentH;
    const wl = c.fields.worklog;
    if (wl && (wl.total ?? wl.worklogs.length) > wl.worklogs.length) needWorklogs.push({ issue: c, item, squad: project.squad });
    else for (const w of wl?.worklogs ?? []) timesheet.push({ date: w.started.slice(0, 10), squad: project.squad, role: item.role, hours: w.timeSpentSeconds / H });
  }

  // Issues with more worklogs than the search returned inline: fetch them, a few at a time.
  for (let i = 0; i < needWorklogs.length; i += 6) {
    await Promise.all(
      needWorklogs.slice(i, i + 6).map(async ({ issue, item, squad }) => {
        const page = WorklogPage.parse(await client.request('GET', `/rest/api/3/issue/${encodeURIComponent(issue.key)}/worklog?maxResults=5000`));
        for (const w of page.worklogs) timesheet.push({ date: w.started.slice(0, 10), squad, role: item.role, hours: w.timeSpentSeconds / H });
      }),
    );
  }

  for (const p of projects) {
    p.estimateH = r1(p.estimateH);
    p.actualH = r1(p.actualH);
    if (!p.endDate) {
      const ends = items.filter((i) => i.projectId === p.id && i.resolved).map((i) => i.resolved as string).sort();
      p.endDate = ends[ends.length - 1] ?? p.startDate;
    }
  }

  // Jira knows hours logged, not headcount: planned hours come from squad membership (seed/squads.json).
  const headcount = (squad: string, role: Worklog['role']) => squads.find((s) => s.id === squad)?.members.find((m) => m.role === role)?.count ?? 1;
  const worklogs = worklogsFromTimesheet(timesheet, headcount);
  if (!timesheet.length) warnings.push('No worklogs found; squad stats will fall back to defaults or a CSV timesheet.');

  return { syncedAt: new Date().toISOString(), projects, items, worklogs, warnings };
}

// --- push: estimate → epic + stories ------------------------------------------------------------

export async function pushEstimate(client: JiraClient | null, req: JiraPushRequest, publicWebUrl?: string): Promise<JiraPushResponse> {
  const link = req.estimateUrl ?? publicWebUrl;
  const totalP50 = req.items.reduce((s, i) => s + i.p50Hours, 0);
  const totalP80 = req.items.reduce((s, i) => s + i.p80Hours, 0);
  const epicLabels = [`type:${req.projectType}`, `size:${req.size}`, 'scopewise'];
  const plan = [
    `Create epic "${req.title}" with labels ${epicLabels.join(', ')}`,
    ...req.items.map((i) => `Create story "${i.title}" (original estimate ${Math.round(i.p50Hours * 10) / 10}h = P50; labels phase:${i.phaseId}, cat:${i.category})`),
    `Total original estimate ${Math.round(totalP50)}h (P80 ${Math.round(totalP80)}h)${link ? `; descriptions link to ${link}` : ''}`,
  ];
  if (req.dryRun || !client) return { epicKey: null, storyKeys: [], dryRun: true, plan };

  const meta = await discoverCreateMeta(client);
  plan.push(
    meta.link.kind === 'parent'
      ? `Stories (${meta.storyTypeName}) link to the epic via the parent field`
      : meta.link.kind === 'epic-link'
        ? `Stories (${meta.storyTypeName}) link to the epic via the Epic Link field ${meta.link.fieldId}`
        : `Warning: no parent or Epic Link field on ${meta.storyTypeName}; stories are created unlinked`,
  );
  if (!meta.storyHasTimetracking) plan.push('Warning: time tracking is not on the create screen; the estimate is written into each description instead');

  const epic = await client.createIssue({
    project: { key: client.cfg.projectKey },
    issuetype: { id: meta.epicTypeId },
    summary: req.title,
    labels: epicLabels,
    ...(meta.epicNameFieldId ? { [meta.epicNameFieldId]: req.title.slice(0, 255) } : {}),
    description: adfDoc([
      [req.summary],
      [`Estimated with Scopewise: ${Math.round(totalP50)}h at P50, ${Math.round(totalP80)}h at P80 across ${req.items.length} items.`],
      ...(link ? [['See how each number was calculated: ', { text: link, href: link }]] : []),
    ]),
  });
  const storyKeys = await client.bulkCreate(
    req.items.map((i) => ({
      project: { key: client.cfg.projectKey },
      issuetype: { id: meta.storyTypeId },
      summary: i.title.slice(0, 250),
      ...(meta.labelsOnStory ? { labels: [`phase:${i.phaseId}`, `cat:${i.category}`, 'scopewise'] } : {}),
      ...(meta.storyHasTimetracking ? { timetracking: { originalEstimate: jiraDuration(i.p50Hours) } } : {}),
      ...linkFields(meta, epic.key),
      description: adfDoc([
        [`Original estimate is the P50 from Scopewise: ${Math.round(i.p50Hours * 10) / 10}h (P80 ${Math.round(i.p80Hours * 10) / 10}h).`],
        ...(link ? [['Estimate: ', { text: link, href: link }]] : []),
        [`Scopewise item id: ${i.id}`],
      ]),
    })),
  );
  return { epicKey: epic.key, storyKeys, dryRun: false, plan };
}
