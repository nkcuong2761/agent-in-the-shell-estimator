import type {
  AccuracyMetrics,
  BacktestPoint,
  HistoryItem,
  HistoryProject,
  Phase,
  ScopeResult,
  Squad,
  TeamShape,
} from '@scopewise/shared';
import { PHASE_TEMPLATES } from '@scopewise/shared';
import { accuracy, mre, rollingMean } from './accuracy';
import { isSuspectedDataError } from './analogs';
import { buildEstimate } from './estimate';
import { CITATIONS, type Explained } from './explain';
import { DEFAULT_SQUAD_STATS } from './squad';
import { round } from './stats';

export const BACKTEST_WINDOW = 8;
export const BACKTEST_RUNS = 400;
/** Three-point shape assumed around a past single-point estimate. */
export const PAST_ESTIMATE_SHAPE = { o: 0.75, p: 1.6 } as const;

export interface BacktestResult {
  points: BacktestPoint[];
  raw: AccuracyMetrics;
  calibrated: AccuracyMetrics;
}

export function teamFromSquad(squad: Squad | undefined): TeamShape {
  const t: TeamShape = {};
  for (const m of squad?.members ?? []) t[m.role] = m.count;
  return t;
}

function phasesFor(project: HistoryProject, items: readonly HistoryItem[]): Phase[] {
  const template = PHASE_TEMPLATES[project.projectType];
  const used = new Set(items.map((i) => i.phaseId));
  const phases = template.filter((p) => used.has(p.id));
  return phases.length ? phases : template;
}

/** A kickoff-time scope built from a past project's planned items, as the engine would have seen it. */
export function scopeFromHistory(project: HistoryProject, items: readonly HistoryItem[]): ScopeResult {
  const planned = items.filter((i) => i.projectId === project.id && !i.addedAfterKickoff);
  return {
    projectType: project.projectType,
    size: project.size,
    summary: project.name,
    phases: phasesFor(project, planned),
    items: planned.map((i) => ({
      id: i.id,
      phaseId: i.phaseId,
      title: i.title,
      category: i.category,
      complexity: i.complexity,
      role: i.role,
      o: i.originalEstimateH * PAST_ESTIMATE_SHAPE.o,
      m: i.originalEstimateH,
      p: i.originalEstimateH * PAST_ESTIMATE_SHAPE.p,
      sourceRefs: [],
      affectedByQuestions: [],
    })),
    assumptions: [],
    outOfScope: [],
    missingInfo: [],
    scopeRisks: [],
    clientEmailDraft: '',
  };
}

/**
 * Replay closed projects in start-date order. Each is estimated using only projects that closed before it
 * started: the raw estimate is the sum of the original (panel) estimates; the calibrated one runs the full
 * engine (analogs, bias correction, Monte Carlo) on the same kickoff scope.
 */
export function backtest(
  data: { projects: readonly HistoryProject[]; items: readonly HistoryItem[]; squads: readonly Squad[] },
  opts: { window?: number; runs?: number; seed?: number } = {},
): Explained<BacktestResult> {
  const window = opts.window ?? BACKTEST_WINDOW;
  const runs = opts.runs ?? BACKTEST_RUNS;
  const closed = data.projects
    .filter((p) => p.status === 'closed')
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
  const squadById = new Map(data.squads.map((s) => [s.id, s]));
  // Suspected time-entry errors (see post-mortem) are excluded from actuals so one typo doesn't swamp the metric.
  const cleanActual = new Map<string, number>();
  for (const it of data.items) {
    if (isSuspectedDataError(it)) continue;
    cleanActual.set(it.projectId, (cleanActual.get(it.projectId) ?? 0) + it.timeSpentH);
  }
  const actualOf = (p: HistoryProject) => cleanActual.get(p.id) ?? p.actualH;

  const rows = closed.map((project, order) => {
    const prior = closed.filter((p) => p.endDate < project.startDate);
    const priorIds = new Set(prior.map((p) => p.id));
    const priorItems = data.items.filter((i) => priorIds.has(i.projectId));
    const squad = squadById.get(project.squad);
    const est = buildEstimate({
      scope: scopeFromHistory(project, data.items),
      history: { projects: prior, items: priorItems, squads: data.squads },
      squad: squad?.stats ?? DEFAULT_SQUAD_STATS,
      teamShape: teamFromSquad(squad),
      startDate: project.startDate,
      runs,
      seed: opts.seed,
      skipVoi: true,
    });
    return { project, order, est, priorCount: prior.length };
  });

  const rawErr = rows.map((r) => mre({ actual: actualOf(r.project), estimate: r.project.estimateH }));
  const calErr = rows.map((r) => mre({ actual: actualOf(r.project), estimate: r.est.total.p50 }));
  const rollRaw = rollingMean(rawErr, window);
  const rollCal = rollingMean(calErr, window);
  const points: BacktestPoint[] = rows.map((r, i) => ({
    order: r.order + 1,
    projectId: r.project.id,
    name: r.project.name,
    actualH: round(actualOf(r.project)),
    rawH: round(r.project.estimateH),
    calibratedP50: r.est.total.p50,
    calibratedP80: r.est.total.p80,
    rawMRE: round(rawErr[i] ?? 0, 4),
    calibratedMRE: round(calErr[i] ?? 0, 4),
    rollingRawMMRE: round(rollRaw[i] ?? 0, 4),
    rollingCalibratedMMRE: round(rollCal[i] ?? 0, 4),
    withinP80: actualOf(r.project) <= r.est.total.p80,
  }));
  const raw = accuracy(rows.map((r) => ({ actual: actualOf(r.project), estimate: r.project.estimateH }))).value;
  const calibrated = accuracy(rows.map((r) => ({ actual: actualOf(r.project), estimate: r.est.total.p50, p80: r.est.total.p80 }))).value;
  return {
    value: { points, raw, calibrated },
    explanation: {
      method: 'Walk-forward backtest',
      citation: `${CITATIONS.accuracy}; ${CITATIONS.shrinkage}`,
      plainWords: `Each of ${points.length} closed projects is re-estimated using only projects that had closed before it started. The panel alone was off by ${Math.round(raw.mmre * 100)}% on average; the calibrated engine by ${Math.round(calibrated.mmre * 100)}%.`,
      formula: `rolling MMRE over the last ${window} projects; calibrated = engine P50 with history up to kickoff`,
      inputs: { projects: points.length, window, runsPerProject: runs, rawMMRE: raw.mmre, calibratedMMRE: calibrated.mmre, p80HitRate: calibrated.p80HitRate },
    },
  };
}
