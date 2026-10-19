import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { RealProject } from '@scopewise/shared';
import { App } from '../App';
import { BANNED_TERMS } from '../copy';
import { historyFor } from '../state/history';
import { setRealProjects } from '../state/realProjects';

/** A finished ticket as POST /jira/import returns it: one item, time logged, a template post-mortem. */
const REAL_TICKET: RealProject = {
  project: {
    id: 'IDM-900',
    seedId: 'IDM-900',
    name: 'Copy contact matrix between investments',
    client: 'IDM',
    projectType: 'new-feature',
    size: 'M',
    squad: 'alpha',
    startDate: '2026-03-02',
    endDate: '2026-04-24',
    status: 'closed',
    estimateH: 80,
    actualH: 104,
    labels: ['real'],
    jiraKey: 'IDM-900',
  },
  items: [
    {
      id: 'IDM-900',
      seedId: 'IDM-900',
      projectId: 'IDM-900',
      phaseId: 'build',
      title: 'Copy contact matrix between investments',
      category: 'backend',
      complexity: 'L',
      role: 'engineer',
      originalEstimateH: 80,
      timeSpentH: 104,
      labels: ['real'],
      addedAfterKickoff: false,
      created: '2026-03-02',
      resolved: '2026-04-24',
      jiraKey: 'IDM-900',
    },
  ],
  postmortem: {
    projectId: 'IDM-900',
    summary: 'Took 104 hours against 80 estimated.',
    findings: [{ scope: 'item', refId: 'IDM-900', title: 'Copy contact matrix between investments', estimateH: 80, actualH: 104, ratio: 1.3, cause: 'underestimated', note: 'Copying the matrix took 30% longer than estimated.', suspectedDataError: false }],
    lessons: [{ cause: 'underestimated', note: 'Copying the matrix took 30% longer than estimated.', appliesTo: { category: 'backend', projectType: 'new-feature' } }],
  },
  postmortemProvenance: { promptVersion: 'offline-heuristic-postmortem@1', generatedBy: 'offline-heuristic', generatedAt: '2026-10-19T00:00:00.000Z' },
  importedAt: '2026-10-19T00:00:00.000Z',
  url: 'https://example.atlassian.net/browse/IDM-900',
};

/** The same ticket as the user's real project has them: done, but no hours logged, so the API adds a hindsight estimate. */
const DATES_ONLY_TICKET: RealProject = {
  ...REAL_TICKET,
  project: { ...REAL_TICKET.project, id: 'IDM-901', seedId: 'IDM-901', jiraKey: 'IDM-901', estimateH: 0, actualH: 0, labels: ['real', 'dates-only'] },
  items: [{ ...REAL_TICKET.items[0]!, id: 'IDM-901', seedId: 'IDM-901', projectId: 'IDM-901', jiraKey: 'IDM-901', originalEstimateH: 0, timeSpentH: 0, labels: ['real', 'dates-only'] }],
  postmortem: { projectId: 'IDM-901', summary: 'No time was logged on this ticket, so only calendar time can be compared.', findings: [], lessons: [] },
  hindsight: { effortH: 90, safeEffortH: 130, likelyDate: '2026-04-03', safeDate: '2026-04-17', scopeProvenance: { promptVersion: 'offline-heuristic-scope@1', generatedBy: 'offline-heuristic', generatedAt: '2026-10-19T00:00:00.000Z' } },
  url: 'https://example.atlassian.net/browse/IDM-901',
};

/** Visible text of the page, leaving out the methods drawer (the one place technical terms may appear). */
function mainText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-methods], .sr-only').forEach((el) => el.remove());
  return clone.textContent ?? '';
}

function expectNoBannedTerms() {
  const text = mainText();
  for (const term of BANNED_TERMS) {
    // Acronyms match as whole uppercase words ("FTE" must not trip on "after"); phrases match anywhere, any case.
    const re = /^[A-Z0-9]+$/.test(term) ? new RegExp(`\\b${term}\\b`) : new RegExp(term, 'i');
    // "No buffer: the number is pure working time" is the one sentence allowed to say the word.
    const cleaned = term === 'buffer' ? text.replace(/No buffer: the number is pure working time\./g, '').replace(/Risks & buffer|risks & buffer|Buffer for the unknown|risks and buffer/g, '') : text;
    expect(re.test(cleaned), `"${term}" appears on a main screen`).toBe(false);
  }
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('plain language on the main screens', () => {
  it('the estimate document renders its fixed order, each anchor once, with no technical terms', async () => {
    window.location.hash = '#/estimate/sample-subscription-form';
    render(<App />);
    await screen.findByText('Estimated effort', {}, { timeout: 10000 });
    for (const id of ['est-summary', 'est-team', 'est-tools', 'est-hours', 'est-duration', 'est-stages', 'est-questions', 'est-brief']) {
      expect(document.querySelectorAll(`#${id}`), id).toHaveLength(1);
    }
    const order = ['est-summary', 'est-stages', 'est-questions', 'est-brief'].map((id) => document.getElementById(id)!);
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Open every stage, the why panel and the forecast list, then check the words.
    fireEvent.click(screen.getByText('Why this estimate and confidence?'));
    for (const row of within(document.getElementById('est-stages')!).getAllByRole('button', { expanded: false })) fireEvent.click(row);
    await screen.findByText('Ask the client before you commit');
    expect(document.querySelector('.composer-dock')).toBeNull();
    expect(screen.getByRole('button', { name: /Open the assistant/ })).toBeTruthy();
    expectNoBannedTerms();
    expect(mainText()).not.toMatch(/½/);
  });

  it('half values are written 16,5 in the header and editing the team updates the card in place', async () => {
    window.location.hash = '#/estimate/sample-fund-admin-sync';
    render(<App />);
    await screen.findByText('Estimated effort', {}, { timeout: 10000 });
    const duration = document.getElementById('est-duration')!;
    expect(duration.textContent).toMatch(/\d+(,5)?weeks|a fewdays/);
    const before = document.querySelectorAll('#est-summary').length;
    const inc = screen.getAllByRole('button', { name: /Increase Developer/ })[0]!;
    fireEvent.click(inc);
    await screen.findByText(/Updated: 1,5 developers, one part-time on the team\./);
    expect(document.querySelectorAll('#est-summary')).toHaveLength(before);
    expect(screen.getAllByText(/Updated:/).length).toBe(1);
    // AI tooling: picking a paid coding assistant lowers the effort and leaves one note.
    const effortBefore = Number(document.querySelector('#est-hours .big-number')!.textContent);
    const coding = within(document.getElementById('est-tools')!).getByRole('radiogroup', { name: 'Coding assistant' });
    fireEvent.click(within(coding).getByRole('radio', { name: 'Paid' }));
    await screen.findByText(/Updated: coding assistant on a paid plan\./);
    expect(Number(document.querySelector('#est-hours .big-number')!.textContent)).toBeLessThan(effortBefore);
    expect(document.querySelector('[data-tools-note]')!.textContent).toMatch(/AI tools take about \d+ hours \(\d+%\) off build work/);
    expect(screen.getAllByText(/Updated:/).length).toBe(1);
    expectNoBannedTerms();
  });

  it('the methods drawer is where the technical terms live', async () => {
    window.location.hash = '#/estimate/sample-investor-reminders';
    render(<App />);
    fireEvent.click(await screen.findByText('Why this estimate and confidence?', {}, { timeout: 10000 }));
    fireEvent.click(await screen.findByText('See the full working and methods'));
    const drawer = document.querySelector('[data-methods]');
    expect(drawer?.textContent).toMatch(/P50|P80|buffer/i);
    expectNoBannedTerms();
  });

  it('a finished project shows its category and no technical terms', async () => {
    window.location.hash = '#/project/P020';
    render(<App />);
    await screen.findByText('How did the estimate do?', {}, { timeout: 20000 });
    await screen.findByText(/Early estimates were off by about/);
    expect(screen.getAllByText(/^(New feature|Form|Integration|Data migration|Reporting)$/).length).toBeGreaterThan(0);
    expectNoBannedTerms();
  }, 30000);

  it('an imported Jira ticket shows as a real finished project with fixed numbers and no technical terms', async () => {
    setRealProjects([REAL_TICKET]);
    try {
      window.location.hash = '#/project/IDM-900';
      render(<App />);
      await screen.findByText('How did the estimate do?', {}, { timeout: 20000 });
      await screen.findByText('Real ticket');
      expect(screen.getByText("Jira's own estimate")).toBeTruthy();
      expect(screen.getByText('Time logged')).toBeTruthy();
      expect(screen.getByText('We would have said')).toBeTruthy();
      expect(screen.getByText('Done · 100%')).toBeTruthy();
      expect(screen.getByRole('link', { name: /Open in Jira/ }).getAttribute('href')).toBe(REAL_TICKET.url);
      expect(screen.getAllByText(/^(New feature|Form|Integration|Data migration|Reporting)$/).length).toBeGreaterThan(0);
      expect(mainText()).toMatch(/This finished (about .+ (sooner|later) than|within the range)/);
      expectNoBannedTerms();
    } finally {
      setRealProjects([]);
    }
  }, 30000);

  it('a dates-only ticket compares calendar time only and stays out of the hour-based history', async () => {
    setRealProjects([DATES_ONLY_TICKET]);
    try {
      expect(historyFor().projects.some((p) => p.id === 'IDM-901')).toBe(false);
      window.location.hash = '#/project/IDM-901';
      render(<App />);
      await screen.findByText('How did the estimate do?', {}, { timeout: 20000 });
      await screen.findByText('Real ticket');
      expect(screen.queryByText('Time logged')).toBeNull();
      expect(screen.getByText('We would have said')).toBeTruthy();
      expect(screen.getAllByText(/No time was logged on this ticket/).length).toBeGreaterThan(0);
      expect(mainText()).toMatch(/This finished about 1 week later than the safe date/);
      // No hours, no lesson: the page asks instead, and the chart gets a calendar-time bar for this ticket.
      expect(screen.getByText('Roughly how many hours of work was it, all roles together?')).toBeTruthy();
      expect(mainText()).toMatch(/its bar is calendar time only/);
      expect(document.querySelectorAll('[role=img] a').length).toBe(0);
      fireEvent.change(screen.getByPlaceholderText('e.g. 12'), { target: { value: '14' } });
      fireEvent.click(screen.getByText('Save what happened'));
      await screen.findByText(/This now counts as history/);
      expect(historyFor().projects.some((p) => p.id === 'IDM-901')).toBe(true);
      expectNoBannedTerms();
    } finally {
      setRealProjects([]);
    }
  }, 30000);

  it('home shows the estimates table; #/new shows the brief screen', async () => {
    window.location.hash = '#/';
    render(<App />);
    await screen.findByText('Open estimates');
    expect(screen.getByRole('tab', { name: /Finished/ })).toBeTruthy();
    expect(screen.getByText('Export CSV')).toBeTruthy();
    expectNoBannedTerms();
    cleanup();
    window.location.hash = '#/new';
    render(<App />);
    await screen.findByText("What's the brief you'd like me to estimate?");
    expectNoBannedTerms();
  });

  it('the sidebar lists ongoing estimates with a progress line and no finished projects', async () => {
    window.location.hash = '#/';
    render(<App />);
    await screen.findByText('Open estimates');
    const nav = screen.getByRole('complementary', { name: 'Navigation' });
    expect(within(nav).getByText('Ongoing')).toBeTruthy();
    expect(within(nav).getAllByText(/Not started · starts|Week \d+ of \d+|Past the planned finish/).length).toBeGreaterThan(0);
    expect(within(nav).queryByText(/Sample data/)).toBeNull();
  });
});
