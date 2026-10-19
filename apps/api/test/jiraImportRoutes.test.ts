/**
 * The import route end to end, in process: POST /jira/import/:key → post-mortem (offline, no Claude key) → store →
 * GET /jira/imports. Jira is a stubbed global fetch; the store is a JSON file in a temp directory.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RealProject, RealProjectsResponse } from '@scopewise/shared';

const H = 3600;
const adf = (text: string) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const issues: Record<string, unknown> = {
  'PK-20': {
    id: '20',
    key: 'PK-20',
    fields: {
      summary: 'Sync investor records with the fund administrator API',
      description: adf('Nightly sync of investor data with the administrator system.'),
      status: { name: 'Done', statusCategory: { key: 'done' } },
      issuetype: { name: 'Story', hierarchyLevel: 0 },
      created: '2025-03-03T09:00:00.000+0000',
      resolutiondate: '2025-05-16T15:00:00.000+0000',
      timeoriginalestimate: 60 * H,
      timespent: 88 * H,
      labels: [],
    },
  },
};

issues['PK-21'] = {
  id: '21',
  key: 'PK-21',
  fields: {
    summary: 'Automated reminder emails for investors who have not signed',
    description: adf('Send reminder emails to investors with unsigned subscription documents, with a schedule and an audit log.'),
    status: { name: 'Done', statusCategory: { key: 'done' } },
    issuetype: { name: 'Story', hierarchyLevel: 0 },
    created: '2025-02-03T09:00:00.000+0000',
    resolutiondate: null,
    statuscategorychangedate: '2025-03-21T15:00:00.000+0000',
    updated: '2025-03-25T15:00:00.000+0000',
    timeoriginalestimate: null,
    timespent: null,
    labels: [],
  },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dir: string;
let app: import('hono').Hono;
const saved = { ...process.env };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'scopewise-api-test-'));
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DATABASE_URL;
  process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
  process.env.JIRA_EMAIL = 'tester@example.com';
  process.env.JIRA_API_TOKEN = 'test-token';
  process.env.JIRA_PROJECT_KEY = 'PK';
  process.env.STORE_PATH = join(dir, 'store.json');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      const m = /\/rest\/api\/3\/issue\/([A-Z0-9-]+)/.exec(url);
      if (m?.[1]) return issues[m[1]] ? json(issues[m[1]]) : json({ errorMessages: ['Issue does not exist'] }, 404);
      return json({ errorMessages: [`unexpected ${url}`] }, 500);
    }),
  );
  const { createApp } = await import('../src/app');
  const { JsonFileStore, setStore } = await import('../src/store');
  setStore(new JsonFileStore(process.env.STORE_PATH));
  app = createApp();
});

afterAll(() => {
  vi.unstubAllGlobals();
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
});

describe('POST /jira/import/:key and GET /jira/imports', () => {
  it('starts with no imports', async () => {
    const res = await app.request('/jira/imports');
    expect(res.status).toBe(200);
    expect(RealProjectsResponse.parse(await res.json())).toEqual({ projects: [] });
  });

  it('imports a finished ticket with a post-mortem and stores it', async () => {
    const res = await app.request('/jira/import/pk-20', { method: 'POST' });
    expect(res.status).toBe(201);
    const real = RealProject.parse(await res.json());
    expect(real.project).toMatchObject({ id: 'PK-20', projectType: 'integration', status: 'closed', estimateH: 60, actualH: 88, client: 'PK', squad: 'alpha' });
    expect(real.project.labels).toContain('real');
    expect(real.items).toHaveLength(1);
    expect(real.items[0]).toMatchObject({ category: 'integration', phaseId: 'api-mapping' });
    expect(real.postmortem.projectId).toBe('PK-20');
    expect(real.postmortemProvenance.generatedBy).toBe('offline-heuristic');
    expect(real.url).toBe('https://example.atlassian.net/browse/PK-20');

    const list = RealProjectsResponse.parse(await (await app.request('/jira/imports')).json());
    expect(list.projects.map((p) => p.project.id)).toEqual(['PK-20']);

    // Re-importing replaces, not duplicates.
    expect((await app.request('/jira/import/PK-20', { method: 'POST' })).status).toBe(201);
    const again = RealProjectsResponse.parse(await (await app.request('/jira/imports')).json());
    expect(again.projects).toHaveLength(1);
  });

  it('imports a done ticket without hours as dates-only, with a hindsight estimate', async () => {
    const res = await app.request('/jira/import/PK-21', { method: 'POST' });
    expect(res.status).toBe(201);
    const real = RealProject.parse(await res.json());
    expect(real.project).toMatchObject({ id: 'PK-21', startDate: '2025-02-03', endDate: '2025-03-21', estimateH: 0, actualH: 0, status: 'closed' });
    expect(real.project.labels).toEqual(['real', 'dates-only']);
    expect(real.postmortem.summary).toMatch(/No time was logged on PK-21/);
    expect(real.hindsight).toBeDefined();
    expect(real.hindsight?.effortH).toBeGreaterThan(0);
    expect(real.hindsight?.safeEffortH).toBeGreaterThanOrEqual(real.hindsight?.effortH ?? 0);
    expect(real.hindsight?.likelyDate > '2025-02-03').toBe(true);
    expect(real.hindsight?.safeDate >= real.hindsight?.likelyDate).toBe(true);
    expect(real.hindsight?.scopeProvenance.generatedBy).toBe('offline-heuristic');
    const list = RealProjectsResponse.parse(await (await app.request('/jira/imports')).json());
    expect(list.projects.map((p) => p.project.id).sort()).toEqual(['PK-20', 'PK-21']);
  });

  it('answers 502 for a ticket Jira does not know, and 400 for a bad key', async () => {
    expect((await app.request('/jira/import/PK-99', { method: 'POST' })).status).toBe(502);
    expect((await app.request('/jira/import/nope', { method: 'POST' })).status).toBe(400);
  });
});
