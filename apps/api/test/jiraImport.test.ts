import { describe, expect, it } from 'vitest';
import type { Squad } from '@scopewise/shared';
import { ApiError } from '../src/errors';
import { categoryFromSummary, importFinishedIssue, itemFromIssue, projectFromIssue, type IssueReader, type JiraIssue } from '../src/jira';

const H = 3600;

const squads: Squad[] = [
  { id: 'alpha', name: 'Alpha', members: [{ role: 'engineer', count: 2 }], stats: { focusFactor: 0.7, absenceRate: 0.08, coordinationOverheadPerExtra: 0.1 }, plannedLeave: [] },
  { id: 'beta', name: 'Beta', members: [{ role: 'engineer', count: 1 }], stats: { focusFactor: 0.7, absenceRate: 0.08, coordinationOverheadPerExtra: 0.1 }, plannedLeave: [] },
];

type Fields = JiraIssue['fields'] & { description?: unknown };
const issue = (key: string, fields: Fields): JiraIssue & { fields: Fields } => ({ id: key.replace(/\D/g, ''), key, fields });

const done = { name: 'Done', statusCategory: { key: 'done' } };
const open = { name: 'In Progress', statusCategory: { key: 'indeterminate' } };
const story = { name: 'Story', hierarchyLevel: 0 };
const epicType = { name: 'Epic', hierarchyLevel: 1 };

/** A fake client: `issues` answers GET /issue/{key}; `children` answers the epic-children search. */
function fakeClient(issues: Record<string, JiraIssue>, children: JiraIssue[] = []): IssueReader & { searches: string[] } {
  const searches: string[] = [];
  return {
    cfg: { baseUrl: 'https://example.atlassian.net', email: 'x', apiToken: 'y', projectKey: 'PK' },
    searches,
    async request(_method, path) {
      const m = /\/issue\/([A-Z0-9-]+)/.exec(path);
      const found = m?.[1] ? issues[m[1]] : undefined;
      if (!found) throw new ApiError(502, 'jira_not_found', `no ${path}`);
      return found;
    },
    async search(jql) {
      searches.push(jql);
      return children;
    },
    async fields() {
      return [];
    },
  };
}

describe('projectFromIssue / itemFromIssue (the readHistory mapping)', () => {
  const epic = issue('PK-1', {
    summary: 'Acme: Investor reminders',
    labels: ['type:new-feature', 'size:L', 'squad:beta', 'client:acme-capital', 'seed:P007', 'start:2025-01-06', 'end:2025-03-14'],
    created: '2025-05-01T10:00:00.000+0000',
    resolutiondate: '2025-06-01T10:00:00.000+0000',
    status: done,
    issuetype: epicType,
  });

  it('maps an epic the way readHistory did', () => {
    const p = projectFromIssue(epic, { projectType: 'new-feature', squad: 'beta' });
    expect(p).toEqual({
      id: 'P007',
      seedId: 'P007',
      name: 'Acme: Investor reminders',
      client: 'Acme Capital',
      projectType: 'new-feature',
      size: 'L',
      squad: 'beta',
      startDate: '2025-01-06',
      endDate: '2025-03-14',
      status: 'closed',
      estimateH: 0,
      actualH: 0,
      labels: epic.fields.labels,
      jiraKey: 'PK-1',
    });
  });

  it('falls back to created/resolution dates, the summary prefix as client, size M and open status', () => {
    const e = issue('PK-2', { summary: 'Beta Fund: Sync', labels: ['type:integration'], created: '2025-05-01T10:00:00.000+0000', status: open });
    const p = projectFromIssue(e, { projectType: 'integration', squad: 'unknown' });
    expect(p).toMatchObject({ id: 'PK-2', client: 'Beta Fund', size: 'M', squad: 'unknown', startDate: '2025-05-01', endDate: '', status: 'open' });
  });

  it('maps a child the way readHistory did', () => {
    const project = projectFromIssue(epic, { projectType: 'new-feature', squad: 'beta' });
    const child = issue('PK-3', {
      summary: 'Reminder scheduler',
      labels: ['phase:build', 'cat:notifications', 'seed:I0071', 'cx:M', 'added-after-kickoff', 'created:2025-01-10', 'resolved:2025-02-02'],
      timeoriginalestimate: 10 * H,
      timespent: 14.25 * H,
      created: '2025-05-02T00:00:00.000+0000',
      resolutiondate: '2025-05-20T00:00:00.000+0000',
    });
    expect(itemFromIssue(child, project)).toEqual({
      id: 'I0071',
      seedId: 'I0071',
      projectId: 'P007',
      phaseId: 'build',
      title: 'Reminder scheduler',
      category: 'notifications',
      complexity: 'M',
      role: 'engineer',
      originalEstimateH: 10,
      timeSpentH: 14.3,
      labels: child.fields.labels,
      addedAfterKickoff: true,
      created: '2025-01-10',
      resolved: '2025-02-02',
      jiraKey: 'PK-3',
    });
  });

  it('uses the first engineer phase, backend and complexity-from-hours when labels are missing', () => {
    const project = projectFromIssue(epic, { projectType: 'form-digitization', squad: 'beta' });
    const child = issue('PK-4', { summary: 'Something', labels: ['phase:nope'], timeoriginalestimate: 30 * H, created: '2025-05-02T00:00:00.000+0000' });
    const item = itemFromIssue(child, project);
    expect(item).toMatchObject({ phaseId: 'build-form', role: 'engineer', category: 'backend', complexity: 'L', originalEstimateH: 30, timeSpentH: 0, created: '2025-05-02', addedAfterKickoff: false });
    expect(item.resolved).toBeUndefined();
  });
});

describe('categoryFromSummary', () => {
  it('maps keywords and falls back to backend', () => {
    expect(categoryFromSummary('Subscription form fields')).toBe('forms');
    expect(categoryFromSummary('Add e-signature step')).toBe('esign');
    expect(categoryFromSummary('Email reminders for investors')).toBe('notifications');
    expect(categoryFromSummary('Quarterly report dashboard')).toBe('reporting');
    expect(categoryFromSummary('Sync with fund admin API')).toBe('integration');
    expect(categoryFromSummary('Migrate legacy records')).toBe('data');
    expect(categoryFromSummary('New settings page')).toBe('frontend');
    expect(categoryFromSummary('Regression test pass')).toBe('qa');
    expect(categoryFromSummary('Legal wording review')).toBe('legal');
    expect(categoryFromSummary('Refactor the scheduler')).toBe('backend');
  });
});

describe('importFinishedIssue', () => {
  const base = { created: '2025-03-03T09:00:00.000+0000', issuetype: story, labels: [] as string[] };

  it('refuses an open issue', async () => {
    const client = fakeClient({ 'PK-10': issue('PK-10', { ...base, summary: 'Open one', status: open, timespent: 5 * H, timeoriginalestimate: 4 * H }) });
    await expect(importFinishedIssue(client, 'PK-10', squads)).rejects.toMatchObject({ status: 422, code: 'issue_not_finished' });
  });

  it('imports a done issue without hours as dates-only, using the status-change date when there is no resolution', async () => {
    const client = fakeClient({
      'PK-11': issue('PK-11', { ...base, summary: 'No resolution', status: done, statuscategorychangedate: '2025-04-02T09:00:00.000+0000', updated: '2025-04-05T09:00:00.000+0000', timespent: 5 * H, timeoriginalestimate: 4 * H }),
      'PK-12': issue('PK-12', { ...base, summary: 'No time', status: done, resolutiondate: '2025-04-01T09:00:00.000+0000', timeoriginalestimate: 4 * H }),
      'PK-13': issue('PK-13', { ...base, summary: 'No estimate', status: done, resolutiondate: '2025-04-01T09:00:00.000+0000', timespent: 4 * H }),
      'PK-14': issue('PK-14', { ...base, summary: 'Only updated', status: done, updated: '2025-04-05T09:00:00.000+0000' }),
    });
    const r11 = await importFinishedIssue(client, 'PK-11', squads);
    expect(r11.datesOnly).toBe(false);
    expect(r11.project).toMatchObject({ endDate: '2025-04-02', estimateH: 4, actualH: 5, labels: ['real'] });
    const r12 = await importFinishedIssue(client, 'PK-12', squads);
    expect(r12.datesOnly).toBe(true);
    expect(r12.project).toMatchObject({ endDate: '2025-04-01', estimateH: 4, actualH: 0, labels: ['real', 'dates-only'] });
    expect((await importFinishedIssue(client, 'PK-13', squads)).project.labels).toEqual(['real', 'dates-only']);
    const r14 = await importFinishedIssue(client, 'PK-14', squads);
    expect(r14.project).toMatchObject({ endDate: '2025-04-05', estimateH: 0, actualH: 0, labels: ['real', 'dates-only'] });
    expect(r14.items[0]?.resolved).toBe('2025-04-05');
    expect(r14.detail).toMatchObject({ key: 'PK-14', resolved: '2025-04-05', statusCategory: 'done', text: '# PK-14: Only updated' });
  });

  it('imports a done single issue as a one-item closed project', async () => {
    const client = fakeClient({
      'PK-20': issue('PK-20', {
        ...base,
        summary: 'Email reminders for investors with open subscriptions',
        description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Send a reminder email when a subscription is unsigned after 3 days.' }] }] },
        status: done,
        resolutiondate: '2025-04-11T15:00:00.000+0000',
        timeoriginalestimate: 20 * H,
        timespent: 33.33 * H,
        labels: ['squad:nope'],
      }),
    });
    const { project, items, datesOnly } = await importFinishedIssue(client, 'PK-20', squads);
    expect(datesOnly).toBe(false);
    expect(project).toMatchObject({
      id: 'PK-20',
      seedId: 'PK-20',
      name: 'Email reminders for investors with open subscriptions',
      client: 'PK',
      projectType: 'new-feature',
      size: 'S',
      squad: 'alpha',
      startDate: '2025-03-03',
      endDate: '2025-04-11',
      status: 'closed',
      estimateH: 20,
      actualH: 33.3,
      jiraKey: 'PK-20',
    });
    expect(project.labels).toContain('real');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'PK-20', projectId: 'PK-20', phaseId: 'build', role: 'engineer', category: 'notifications', originalEstimateH: 20, timeSpentH: 33.3, created: '2025-03-03', resolved: '2025-04-11' });
    expect(client.searches).toHaveLength(0);
  });

  it('imports a done epic with its children as items, honouring labels', async () => {
    const children = [
      issue('PK-31', { ...base, summary: 'Map the API', labels: ['phase:api-mapping', 'cat:integration'], timeoriginalestimate: 50 * H, timespent: 70 * H, resolutiondate: '2025-05-01T00:00:00.000+0000' }),
      issue('PK-32', { ...base, summary: 'End-to-end test pass', labels: [], timeoriginalestimate: 80 * H, timespent: 95 * H, resolutiondate: '2025-05-20T00:00:00.000+0000' }),
    ];
    const client = fakeClient(
      { 'PK-30': issue('PK-30', { ...base, summary: 'Fund admin sync', issuetype: epicType, status: done, resolutiondate: '2025-06-01T00:00:00.000+0000', labels: ['type:integration', 'squad:beta'] }) },
      children,
    );
    const { project, items } = await importFinishedIssue(client, 'PK-30', squads);
    expect(client.searches).toHaveLength(1);
    expect(client.searches[0]).toContain('parent = PK-30');
    expect(project).toMatchObject({ id: 'PK-30', projectType: 'integration', squad: 'beta', size: 'L', estimateH: 130, actualH: 165, status: 'closed', endDate: '2025-06-01' });
    expect(project.labels).toEqual(['type:integration', 'squad:beta', 'real']);
    expect(items.map((i) => [i.id, i.phaseId, i.category, i.role])).toEqual([
      ['PK-31', 'api-mapping', 'integration', 'engineer'],
      ['PK-32', 'api-mapping', 'qa', 'engineer'],
    ]);
  });

  it('sums hours over children for an epic, so an epic whose children have no time logged is dates-only', async () => {
    const client = fakeClient(
      { 'PK-40': issue('PK-40', { ...base, summary: 'Empty epic', issuetype: epicType, status: done, resolutiondate: '2025-06-01T00:00:00.000+0000', timespent: 99 * H, timeoriginalestimate: 99 * H }) },
      [issue('PK-41', { ...base, summary: 'Child', timeoriginalestimate: 5 * H })],
    );
    const { project, datesOnly } = await importFinishedIssue(client, 'PK-40', squads);
    expect(datesOnly).toBe(true);
    expect(project).toMatchObject({ estimateH: 5, actualH: 0, labels: ['real', 'dates-only'] });
  });
});
