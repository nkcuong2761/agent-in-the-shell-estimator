import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HistoryItem, HistoryProject, PanelResult, ScopeResult, Squad, Worklog } from '@scopewise/shared';
import {
  accuracy,
  addWorkingDays,
  aggregatePanel,
  backtest,
  biasFactors,
  blendItem,
  buildAnalogIndex,
  buildEstimate,
  compareProject,
  cosine,
  findAnalogs,
  historyOverhead,
  mulberry32,
  offlinePanel,
  offlinePostmortem,
  overheadFactor,
  pertQuantiles,
  predictScopeRisks,
  prepareEstimate,
  quantile,
  referenceClass,
  rollingMean,
  runEstimate,
  samplePert,
  squadStatsFromWorklogs,
  TfIdf,
  whatIf,
  workingDaysBetween,
  worklogsFromTimesheet,
} from '../src';

const seedDir = join(__dirname, '../../../data/seed');
const load = <T>(f: string): T => JSON.parse(readFileSync(join(seedDir, f), 'utf8')) as T;
const projects = load<HistoryProject[]>('projects.json');
const items = load<HistoryItem[]>('items.json');
const squads = load<Squad[]>('squads.json');
const worklogs = load<Worklog[]>('worklogs.json');
const history = { projects, items, squads };
const alpha = squads.find((s) => s.id === 'alpha') as Squad;

function scope(overrides: Partial<ScopeResult> = {}): ScopeResult {
  return {
    projectType: 'new-feature',
    size: 'M',
    summary: 'test',
    phases: [
      { id: 'discovery', name: 'Discovery', order: 0, role: 'pm' },
      { id: 'build', name: 'Build', order: 1, role: 'engineer' },
      { id: 'qa', name: 'QA', order: 2, role: 'qa' },
    ],
    items: [
      { id: 'i1', phaseId: 'discovery', title: 'Stakeholder interviews and requirements', category: 'discovery', complexity: 'M', role: 'pm', o: 8, m: 12, p: 20, sourceRefs: [], affectedByQuestions: [] },
      { id: 'i2', phaseId: 'build', title: 'Backend service and data model', category: 'backend', complexity: 'L', role: 'engineer', o: 24, m: 36, p: 60, sourceRefs: [], affectedByQuestions: ['q1'] },
      { id: 'i3', phaseId: 'build', title: 'Frontend screens', category: 'frontend', complexity: 'M', role: 'engineer', o: 20, m: 28, p: 44, sourceRefs: [], affectedByQuestions: [] },
      { id: 'i4', phaseId: 'build', title: 'Partner sync job with retries', category: 'integration', complexity: 'L', role: 'engineer', o: 20, m: 30, p: 50, sourceRefs: [], affectedByQuestions: ['q2'] },
      { id: 'i5', phaseId: 'qa', title: 'Test plan and regression', category: 'qa', complexity: 'M', role: 'qa', o: 10, m: 16, p: 26, sourceRefs: [], affectedByQuestions: [] },
    ],
    assumptions: [],
    outOfScope: [],
    missingInfo: [
      { id: 'q1', question: 'Which channels?', why: '', affectedItemIds: ['i2'], spreadMultiplier: 1.8, impact: 'high' },
      { id: 'q2', question: 'Which partner API version?', why: '', affectedItemIds: ['i4'], spreadMultiplier: 1.4, impact: 'medium' },
    ],
    scopeRisks: [],
    clientEmailDraft: '',
    ...overrides,
  };
}

const baseInputs = () => ({
  scope: scope(),
  history,
  squad: alpha.stats,
  teamShape: { pm: 1, designer: 1, engineer: 3, qa: 1 },
  startDate: '2026-10-26',
  deadline: '2026-12-18',
  seed: 42,
});

describe('prng', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('calendar', () => {
  it('skips weekends', () => {
    expect(addWorkingDays('2026-10-23', 1)).toBe('2026-10-23'); // Friday, day 1
    expect(addWorkingDays('2026-10-23', 2)).toBe('2026-10-26'); // next Monday
    expect(workingDaysBetween('2026-10-26', '2026-11-06')).toBe(10);
  });
});

describe('1. reference class', () => {
  it('returns the actual-hours distribution of matching projects', () => {
    const r = referenceClass(projects, 'integration', 'L');
    expect(r.value.n).toBeGreaterThan(0);
    expect(r.value.p20).toBeLessThanOrEqual(r.value.median);
    expect(r.value.median).toBeLessThanOrEqual(r.value.p80);
    expect(r.explanation.citation).toContain('Flyvbjerg');
  });
  it('relaxes the size filter when there are too few matches', () => {
    const few = projects.filter((p) => p.projectType === 'reporting').slice(0, 4);
    const r = referenceClass(few, 'reporting', 'XL');
    expect(r.value.relaxed).toBe(true);
  });
});

describe('2. analogies', () => {
  it('ranks same category, then complexity, then text similarity', () => {
    const index = buildAnalogIndex(items, projects);
    const r = findAnalogs({ id: 'x', title: 'Sync job with retries', category: 'integration', complexity: 'L' }, index);
    expect(r.value.matches).toHaveLength(3);
    const first = items.find((i) => i.id === r.value.matches[0]?.historyItemId);
    expect(first?.category).toBe('integration');
    expect(first?.complexity).toBe('L');
    expect(r.value.matches[0]?.title).toBe('Sync job with retries');
  });
  it('tf-idf cosine is 1 for identical text and 0 for disjoint', () => {
    const t = new TfIdf(['alpha beta', 'gamma delta']);
    expect(cosine(t.vector('alpha beta'), t.vector('alpha beta'))).toBeCloseTo(1);
    expect(cosine(t.vector('alpha beta'), t.vector('gamma delta'))).toBe(0);
  });
});

describe('3. panel aggregation', () => {
  it('takes min o, median m, max p and flags disagreement above CV 0.35', () => {
    const s = scope();
    const g = (itemId: string, o: number, m: number, p: number) => ({ itemId, o, m, p, reason: '' });
    const panel: PanelResult = {
      rounds: 2,
      disagreementFlags: [],
      agents: [
        { persona: 'delivery-lead', items: [g('i1', 8, 10, 14), g('i2', 20, 20, 30)] },
        { persona: 'qa-lead', items: [g('i1', 9, 12, 18), g('i2', 30, 40, 60)] },
        { persona: 'domain-expert', items: [g('i1', 10, 14, 22), g('i2', 50, 70, 100)] },
      ],
    };
    const r = aggregatePanel(panel, s.items);
    const i1 = r.value.find((x) => x.itemId === 'i1');
    expect(i1).toMatchObject({ o: 8, m: 12, p: 22, flagged: false });
    expect(r.value.find((x) => x.itemId === 'i2')?.flagged).toBe(true);
    // items no persona estimated fall back to the scope guess
    expect(r.value.find((x) => x.itemId === 'i3')).toMatchObject({ o: 20, m: 28, p: 44, n: 0 });
  });
});

describe('4. blend with history', () => {
  it('uses w = n/(n+3)', () => {
    const r = blendItem({ o: 8, m: 10, p: 20 }, [20, 20, 20], 1);
    expect(r.value.weight).toBe(0.5);
    expect(r.value.m).toBe(15);
    expect(r.value.o).toBe(12);
    expect(r.value.p).toBe(30);
  });
  it('falls back to the bias-corrected panel with no analogs', () => {
    expect(blendItem({ o: 8, m: 10, p: 20 }, [], 1.2).value.m).toBe(12);
  });
});

describe('5. bias correction', () => {
  it('learns integration overrun and reporting underrun, shrunk toward 1', () => {
    const b = biasFactors(items, projects);
    expect(b.get('integration')?.value.factor).toBeGreaterThan(1.25);
    expect(b.get('reporting')?.value.factor).toBeLessThan(0.97);
  });
  it('shrinks small samples: log r = n/(n+5) · mean log ratio', () => {
    const mk = (id: string, est: number, act: number): HistoryItem => ({
      id, seedId: id, projectId: 'p', phaseId: 'build', title: id, category: 'backend', complexity: 'M', role: 'engineer',
      originalEstimateH: est, timeSpentH: act, labels: [], addedAfterKickoff: false, created: '2025-01-01',
    });
    const p = [{ ...projects[0], id: 'p', status: 'closed' } as HistoryProject];
    const r = biasFactors([mk('a', 10, 20)], p).get('backend');
    expect(r?.value.factor).toBeCloseTo(Math.exp((1 / 6) * Math.log(2)), 4);
  });
  it('divides out the squad coordination overhead baked into actuals', () => {
    const raw = biasFactors(items, projects).get('backend')?.value.factor ?? 0;
    const net = biasFactors(items, projects, historyOverhead(projects, squads)).get('backend')?.value.factor ?? 0;
    expect(net).toBeLessThan(raw);
  });
});

describe('6. PERT', () => {
  it('samples within [o, p] and P50 near the PERT median', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 1000; i++) {
      const x = samplePert(rng, 10, 20, 50);
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(50);
    }
    const q = pertQuantiles(10, 20, 50, 1, 4000).value;
    expect(q.p50).toBeGreaterThan(20);
    expect(q.p50).toBeLessThan(26);
    expect(q.p80).toBeGreaterThan(q.p50);
  });
  it('degenerate range returns m', () => {
    expect(samplePert(mulberry32(1), 5, 5, 5)).toBe(5);
  });
});

describe('7–10. estimate', () => {
  it('is reproducible: same inputs, same output', () => {
    const a = buildEstimate(baseInputs());
    const b = buildEstimate(baseInputs());
    expect({ ...a, elapsedMs: 0 }).toEqual({ ...b, elapsedMs: 0 });
  });

  it('produces ordered percentiles, a buffer and a commit date after P50', () => {
    const e = buildEstimate(baseInputs());
    expect(e.total.p10).toBeLessThan(e.total.p50);
    expect(e.total.p50).toBeLessThan(e.total.p80);
    expect(e.buffer.total).toBeCloseTo(e.buffer.task + e.buffer.missingInfo + e.buffer.availability, 0);
    expect(e.buffer.missingInfo).toBeGreaterThan(0);
    expect(e.commitDate >= e.p50Date).toBe(true);
    expect(e.perPhase.map((p) => p.phaseId)).toEqual(['discovery', 'build', 'qa']);
    expect(e.onTimeProbability).not.toBeNull();
    for (const key of ['total.p50', 'total.p80', 'buffer.task', 'buffer.missingInfo', 'buffer.availability', 'commitDate', 'onTime', 'confidence', 'referenceClass']) {
      expect(e.explanations[key], key).toBeDefined();
    }
  });

  it('task buffer is the root-square of item P80−P50 gaps (without open spread)', () => {
    const s = scope({ missingInfo: [] });
    const e = buildEstimate({ ...baseInputs(), scope: s });
    const rs = Math.sqrt(e.items.reduce((acc, i) => acc + (i.p80 - i.p50) ** 2, 0));
    expect(e.buffer.task).toBeCloseTo(rs, 0);
    expect(e.buffer.missingInfo).toBe(0);
  });

  it('availability buffer = absence rate × ΣP50', () => {
    const e = buildEstimate({ ...baseInputs(), scope: scope({ missingInfo: [] }) });
    const sum = e.items.reduce((a, i) => a + i.p50, 0);
    expect(e.buffer.availability).toBeCloseTo(alpha.stats.absenceRate * sum, 0);
  });

  it('ranks questions by value of information and answering one narrows the range', () => {
    const prep = prepareEstimate(baseInputs());
    const before = runEstimate(prep);
    const [top, second] = before.rankedQuestions;
    expect(top?.narrowsByH).toBeGreaterThan(0);
    expect(top?.narrowsByH).toBeGreaterThanOrEqual(second?.narrowsByH ?? 0);
    const after = runEstimate(prep, { answeredQuestionIds: [top?.questionId ?? ''] });
    expect(after.total.p80 - after.total.p50).toBeLessThan(before.total.p80 - before.total.p50);
    expect(after.buffer.missingInfo).toBeLessThan(before.buffer.missingInfo);
  });

  it('confidence follows the rule', () => {
    const three = scope({
      missingInfo: ['a', 'b', 'c'].map((id) => ({ id, question: id, why: '', affectedItemIds: ['i1'], spreadMultiplier: 1.1, impact: 'low' as const })),
    });
    expect(buildEstimate({ ...baseInputs(), scope: three }).confidence).toBe('Low');
    const tight = scope({
      missingInfo: [],
      items: scope().items.map((i) => ({ ...i, o: i.m * 0.95, p: i.m * 1.05 })),
    });
    expect(buildEstimate({ ...baseInputs(), scope: tight, history: { projects: [], items: [] } }).confidence).toBe('High');
  });

  it('more engineers: shorter schedule, more hours (Brooks overhead)', () => {
    const prep = prepareEstimate(baseInputs());
    const small = whatIf(prep, { pm: 1, engineer: 1, qa: 1 });
    const big = whatIf(prep, { pm: 1, engineer: 4, qa: 1 });
    expect(big.p50Date < small.p50Date).toBe(true);
    expect(big.total.p50).toBeGreaterThan(small.total.p50);
    expect(overheadFactor(4, 0.1)).toBeCloseTo(1.3);
  });

  it('planned leave inside the window pushes the finish out', () => {
    const leave = [{ role: 'engineer' as const, start: '2026-11-02', end: '2026-11-20', people: 1, note: '' }];
    const without = buildEstimate({ ...baseInputs(), teamShape: { pm: 1, engineer: 1, qa: 1 } });
    const withLeave = buildEstimate({ ...baseInputs(), teamShape: { pm: 1, engineer: 1, qa: 1 }, plannedLeave: leave });
    expect(withLeave.p50Date > without.p50Date).toBe(true);
  });

  it('dropping an item lowers the total', () => {
    const prep = prepareEstimate(baseInputs());
    const all = runEstimate(prep, { skipVoi: true });
    const fewer = runEstimate(prep, { skipVoi: true, droppedItemIds: ['i4'] });
    expect(fewer.total.p50).toBeLessThan(all.total.p50);
  });

  it('5,000 runs finish well under 300 ms', () => {
    const prep = prepareEstimate(baseInputs());
    const t0 = performance.now();
    runEstimate(prep, { skipVoi: true, runs: 5000 });
    expect(performance.now() - t0).toBeLessThan(300);
  });
});

describe('11. accuracy', () => {
  it('computes MMRE, PRED(25) and P80 hit rate', () => {
    const r = accuracy([
      { actual: 100, estimate: 80, p80: 110 },
      { actual: 100, estimate: 150, p80: 90 },
    ]).value;
    expect(r.mmre).toBeCloseTo(0.35);
    expect(r.pred25).toBe(0.5);
    expect(r.p80HitRate).toBe(0.5);
    expect(rollingMean([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
  });
});

describe('12. backtest', () => {
  it('calibrated error falls below raw panel error', () => {
    const r = backtest(history, { runs: 200 });
    expect(r.value.points).toHaveLength(40);
    expect(r.value.calibrated.mmre).toBeLessThan(r.value.raw.mmre);
    expect(r.value.calibrated.p80HitRate).toBeGreaterThan(0.6);
    const late = r.value.points.slice(20);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(late.map((p) => p.rollingCalibratedMMRE))).toBeLessThan(avg(late.map((p) => p.rollingRawMMRE)));
  });
});

describe('capacity, scope risk, post-mortem, offline panel', () => {
  it('derives ~8% absence from worklogs', () => {
    const s = squadStatsFromWorklogs(worklogs, 'alpha').value;
    expect(s.absenceRate).toBeGreaterThan(0.05);
    expect(s.absenceRate).toBeLessThan(0.11);
    expect(s.focusFactor).toBeGreaterThan(0.6);
  });
  it('imports a CSV-style timesheet into weekly worklogs', () => {
    const w = worklogsFromTimesheet(
      [
        { date: '2026-10-05', squad: 'alpha', role: 'engineer', hours: 30 },
        { date: '2026-10-07', squad: 'alpha', role: 'engineer', hours: 40 },
      ],
      () => 3,
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ weekStart: '2026-10-05', loggedH: 70, plannedH: 120 });
  });
  it('predicts e-signature as a likely addition for form digitization', () => {
    const risks = predictScopeRisks(projects, items, 'form-digitization');
    expect(risks[0]?.description).toMatch(/E-signature/);
    expect(risks[0]?.likelihood).toBeGreaterThan(0.4);
  });
  it('flags planted data-entry errors in post-mortems', () => {
    const flagged = projects
      .filter((p) => p.status === 'closed')
      .flatMap((p) => compareProject(p, items))
      .filter((f) => f.suspectedDataError);
    expect(flagged.length).toBe(2);
    const pm = offlinePostmortem(projects[0] as HistoryProject, items);
    expect(pm.summary).toContain('estimated');
  });
  it('offline panel is deterministic and covers every item', () => {
    const s = scope();
    const index = buildAnalogIndex(items, projects);
    const analogs = s.items.map((i) => findAnalogs(i, index).value);
    const a = offlinePanel(s, analogs);
    expect(a).toEqual(offlinePanel(s, analogs));
    expect(a.agents.every((ag) => ag.items.length === s.items.length)).toBe(true);
    expect(quantile([1, 2, 3], 0.5)).toBe(2);
  });
});
