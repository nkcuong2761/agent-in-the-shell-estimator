import type {
  CalibratedItem,
  Category,
  Estimate,
  Explanation,
  HistoryItem,
  HistoryProject,
  ItemAnalogs,
  MissingInfo,
  PanelResult,
  PhaseEstimate,
  PlannedLeave,
  RankedQuestion,
  ReferenceClass,
  ScopeResult,
  Squad,
  SquadStats,
  TeamShape,
  WorkItem,
} from '@scopewise/shared';
import { buildAnalogIndex, findAnalogs } from './analogs';
import { biasFactors, neutralBias, type BiasFactor } from './bias';
import { blendItem } from './blend';
import { HOURS_PER_DAY, addWorkingDays, nextWorkingDay, workingDaysBetween } from './calendar';
import { CITATIONS, type Explained } from './explain';
import { aggregatePanel, type AggregatedGuess } from './panel';
import { projectErrorSigma } from './correlation';
import { historyOverhead, noOverhead } from './overhead';
import { pertQuantiles } from './pert';
import { subSeed } from './prng';
import { referenceClass } from './referenceClass';
import { scheduleOnce, simulate, sortedCopy, effectiveHeadcount, type SimConfig, type SimItem } from './simulate';
import { histogram, quantileSorted, round } from './stats';

export const DEFAULT_RUNS = 5000;
export const WHAT_IF_RUNS = 1000;
export const VOI_RUNS = 1000;
export const DEFAULT_SEED = 20240611;
export const MAX_SPREAD = 4;

export interface EstimateInputs {
  scope: ScopeResult;
  panel?: PanelResult;
  history: { projects: readonly HistoryProject[]; items: readonly HistoryItem[]; squads?: readonly Squad[] };
  squad: SquadStats;
  plannedLeave?: readonly PlannedLeave[];
  teamShape: TeamShape;
  startDate: string;
  deadline?: string;
  answeredQuestionIds?: readonly string[];
  droppedItemIds?: readonly string[];
  runs?: number;
  seed?: number;
  /** Skip value-of-information re-simulation (for the fastest slider updates). */
  skipVoi?: boolean;
  voiRuns?: number;
  /** Override the project-level error spread measured from history. */
  projectSigma?: number;
}

/** History-dependent work that doesn't change when the team, answers or deadline change. */
export interface PreparedEstimate {
  inputs: EstimateInputs;
  aggregated: Explained<AggregatedGuess[]>;
  analogs: Explained<ItemAnalogs>[];
  biases: Map<Category, Explained<BiasFactor>>;
  reference: Explained<ReferenceClass>;
  sigma: Explained<number>;
  /** Calibrated o/m/p per item, before any open-question spread. */
  calibrated: { item: WorkItem; o: number; m: number; p: number; weight: number; bias: number; blend: Explanation; panel: AggregatedGuess }[];
}

export function prepareEstimate(inputs: EstimateInputs): PreparedEstimate {
  const { scope, panel, history } = inputs;
  const aggregated = aggregatePanel(panel, scope.items);
  const overhead = history.squads ? historyOverhead(history.projects, history.squads) : noOverhead;
  const index = buildAnalogIndex(history.items, history.projects, overhead);
  const biases = biasFactors(history.items, history.projects, overhead);
  const analogs = scope.items.map((it) => findAnalogs(it, index));
  const calibrated = scope.items.map((item, i) => {
    const agg = aggregated.value[i] as AggregatedGuess;
    const bias = (biases.get(item.category) ?? neutralBias(item.category)).value.factor;
    const actuals = (analogs[i] as Explained<ItemAnalogs>).value.matches.map((m) => m.actualH);
    const blend = blendItem(agg, actuals, bias);
    return { item, o: blend.value.o, m: blend.value.m, p: blend.value.p, weight: blend.value.weight, bias, blend: blend.explanation, panel: agg };
  });
  return {
    inputs,
    aggregated,
    analogs,
    biases,
    reference: referenceClass(history.projects, scope.projectType, scope.size),
    sigma:
      inputs.projectSigma !== undefined
        ? { ...projectErrorSigma([], []), value: inputs.projectSigma }
        : projectErrorSigma(history.projects, history.items),
    calibrated,
  };
}

export interface RunOptions {
  teamShape?: TeamShape;
  answeredQuestionIds?: readonly string[];
  droppedItemIds?: readonly string[];
  deadline?: string;
  runs?: number;
  seed?: number;
  skipVoi?: boolean;
  voiRuns?: number;
}

/** Which open questions widen which items. An item is affected if either side names the link. */
export function questionLinks(scope: ScopeResult): Map<string, Set<string>> {
  const links = new Map<string, Set<string>>();
  for (const q of scope.missingInfo) links.set(q.id, new Set(q.affectedItemIds));
  for (const it of scope.items) {
    for (const qid of it.affectedByQuestions) links.get(qid)?.add(it.id);
  }
  return links;
}

function openSpreadFor(itemId: string, open: readonly MissingInfo[], links: Map<string, Set<string>>): number {
  let s = 1;
  for (const q of open) if (links.get(q.id)?.has(itemId)) s *= q.spreadMultiplier;
  return Math.min(MAX_SPREAD, s);
}

/** Widen the pessimistic side by the open-question spread: p' = m + (p − m)·s. */
function widen(o: number, m: number, p: number, s: number): { o: number; m: number; p: number } {
  return { o, m, p: m + (p - m) * s };
}

function simConfig(prep: PreparedEstimate, items: SimItem[], team: TeamShape, runs: number, seed: number): SimConfig {
  const { inputs } = prep;
  return {
    phases: inputs.scope.phases.map((p) => ({ id: p.id, order: p.order })),
    items,
    teamShape: team,
    squad: inputs.squad,
    plannedLeave: inputs.plannedLeave ?? [],
    startDate: inputs.startDate,
    runs,
    seed,
    projectSigma: prep.sigma.value,
  };
}

function simItems(prep: PreparedEstimate, open: readonly MissingInfo[], dropped: ReadonlySet<string>, links: Map<string, Set<string>>): SimItem[] {
  return prep.calibrated
    .filter((c) => !dropped.has(c.item.id))
    .map((c) => {
      const s = openSpreadFor(c.item.id, open, links);
      const w = widen(c.o, c.m, c.p, s);
      return { id: c.item.id, phaseId: c.item.phaseId, role: c.item.role, ...w };
    });
}

function spreadOf(totals: Float64Array): number {
  const s = sortedCopy(totals);
  return quantileSorted(s, 0.8) - quantileSorted(s, 0.5);
}

const fmtH = (h: number) => `${Math.round(h).toLocaleString('en-US')}h`;

export function runEstimate(prep: PreparedEstimate, opts: RunOptions = {}): Estimate {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { inputs } = prep;
  const { scope } = inputs;
  const team = opts.teamShape ?? inputs.teamShape;
  const runs = opts.runs ?? inputs.runs ?? DEFAULT_RUNS;
  const seed = opts.seed ?? inputs.seed ?? DEFAULT_SEED;
  const deadline = opts.deadline ?? inputs.deadline;
  const answered = new Set(opts.answeredQuestionIds ?? inputs.answeredQuestionIds ?? []);
  const dropped = new Set(opts.droppedItemIds ?? inputs.droppedItemIds ?? []);
  const skipVoi = opts.skipVoi ?? inputs.skipVoi ?? false;
  const voiRuns = opts.voiRuns ?? inputs.voiRuns ?? VOI_RUNS;
  const startDate = nextWorkingDay(inputs.startDate);
  const links = questionLinks(scope);
  const open = scope.missingInfo.filter((q) => !answered.has(q.id));

  const items = simItems(prep, open, dropped, links);
  const cfg = simConfig(prep, items, team, runs, seed);
  const sim = simulate(cfg);
  const explanations: Record<string, Explanation> = {};

  // --- totals -------------------------------------------------------------
  const totalSorted = sortedCopy(sim.totalHours);
  const total = {
    p10: round(quantileSorted(totalSorted, 0.1)),
    p50: round(quantileSorted(totalSorted, 0.5)),
    p80: round(quantileSorted(totalSorted, 0.8)),
    p95: round(quantileSorted(totalSorted, 0.95)),
  };
  const mcInputs = {
    runs,
    seed,
    items: items.length,
    openQuestions: open.length,
    focusFactor: inputs.squad.focusFactor,
    absenceRate: inputs.squad.absenceRate,
    overheadPerExtraPerson: inputs.squad.coordinationOverheadPerExtra,
    hoursPerPersonDay: HOURS_PER_DAY,
    projectSigma: prep.sigma.value,
  };
  explanations['total.p50'] = {
    method: 'Monte Carlo simulation of Beta-PERT items',
    citation: `${CITATIONS.monteCarlo}; ${CITATIONS.pert}`,
    plainWords: `In half of ${runs.toLocaleString('en-US')} simulated projects the work took less than ${fmtH(total.p50)}.`,
    formula: 'P50 over runs of shared factor × Σ Beta-PERT(o, m′, p) × coordination overhead',
    inputs: mcInputs,
  };
  explanations['total.p80'] = {
    method: 'Monte Carlo simulation of Beta-PERT items',
    citation: `${CITATIONS.monteCarlo}; ${CITATIONS.pert}`,
    plainWords: `In 80% of simulated projects the work took less than ${fmtH(total.p80)}. That's the safe-to-promise number.`,
    formula: 'P80 of total simulated hours across runs',
    inputs: mcInputs,
  };

  // --- per item -------------------------------------------------------------
  const calibratedOut: CalibratedItem[] = [];
  let sumP50 = 0;
  let taskSq = 0;
  const extraByQuestion = new Map<string, number>();
  const baseP50ById = new Map<string, number>();
  for (const c of prep.calibrated) {
    if (dropped.has(c.item.id)) continue;
    const qSeed = subSeed(seed, c.item.id);
    const base = pertQuantiles(c.o, c.m, c.p, qSeed).value;
    const s = openSpreadFor(c.item.id, open, links);
    const w = widen(c.o, c.m, c.p, s);
    const withOpen = s > 1 ? pertQuantiles(w.o, w.m, w.p, qSeed).value : base;
    sumP50 += base.p50;
    baseP50ById.set(c.item.id, base.p50);
    taskSq += (base.p80 - base.p50) ** 2;
    if (s > 1) {
      const extra = withOpen.p80 - base.p80;
      const qs = open.filter((q) => links.get(q.id)?.has(c.item.id));
      const logTotal = qs.reduce((acc, q) => acc + Math.log(q.spreadMultiplier), 0) || 1;
      for (const q of qs) {
        extraByQuestion.set(q.id, (extraByQuestion.get(q.id) ?? 0) + (extra * Math.log(q.spreadMultiplier)) / logTotal);
      }
    }
    calibratedOut.push({
      itemId: c.item.id,
      phaseId: c.item.phaseId,
      role: c.item.role,
      category: c.item.category,
      panel: { o: c.panel.o, m: c.panel.m, p: c.panel.p },
      blendWeight: c.weight,
      biasFactor: c.bias,
      openSpread: round(s, 3),
      o: round(w.o, 1),
      m: round(w.m, 1),
      p: round(w.p, 1),
      p50: round(withOpen.p50, 1),
      p80: round(withOpen.p80, 1),
    });
    explanations[`item.${c.item.id}`] = c.blend;
    explanations[`item.${c.item.id}.range`] = {
      method: 'Three-point estimate as a Beta-PERT distribution',
      citation: CITATIONS.pert,
      plainWords:
        s > 1
          ? `Calibrated to ${round(c.o)}–${round(w.p)}h (most likely ${round(c.m)}h). Open questions widen the pessimistic side ×${round(s, 2)}.`
          : `Calibrated to ${round(c.o)}–${round(c.p)}h (most likely ${round(c.m)}h): P50 ${round(base.p50)}h, P80 ${round(base.p80)}h.`,
      formula: "p′ = m + (p − m)·s for open-question spread s; P50/P80 of Beta-PERT(o, m′, p′)",
      inputs: { o: round(c.o, 2), m: round(c.m, 2), p: round(w.p, 2), spread: round(s, 3), p50: round(withOpen.p50, 2), p80: round(withOpen.p80, 2) },
    };
  }

  // --- buffer ---------------------------------------------------------------
  const bTask = Math.sqrt(taskSq);
  let missingSq = 0;
  for (const v of extraByQuestion.values()) missingSq += v * v;
  const bMissing = Math.sqrt(missingSq);
  const bAvail = inputs.squad.absenceRate * sumP50;
  const buffer = { task: round(bTask), missingInfo: round(bMissing), availability: round(bAvail), total: round(bTask + bMissing + bAvail) };
  const commitHours = round(sumP50 + buffer.total);
  explanations['buffer.task'] = {
    method: 'Root-square task buffer',
    citation: CITATIONS.buffer,
    plainWords: `Each item's gap between P50 and P80, combined as independent risks: not every item runs late at once, so this is less than adding them up.`,
    formula: 'B_task = √Σ(P80ᵢ − P50ᵢ)²',
    inputs: { items: calibratedOut.length, sumOfGaps: round(calibratedOut.reduce((a, c) => a + (c.p80 - c.p50), 0)), bufferH: buffer.task },
  };
  explanations['buffer.missingInfo'] = {
    method: 'Missing-information buffer',
    citation: CITATIONS.buffer,
    plainWords:
      open.length === 0
        ? 'Every question is answered, so no extra buffer is held for unknowns.'
        : `${open.length} open question${open.length === 1 ? '' : 's'} widen the items they touch. This is the extra P80 those items need until the client answers.`,
    formula: 'extra_q = Σᵢ∈q (P80ᵢ with spread − P80ᵢ without); B_missing = √Σ extra_q²',
    inputs: Object.fromEntries([['openQuestions', open.length], ...[...extraByQuestion].map(([k, v]) => [k, round(v)])]),
  };
  explanations['buffer.availability'] = {
    method: 'Availability buffer',
    citation: CITATIONS.buffer,
    plainWords: `The squad historically loses ${Math.round(inputs.squad.absenceRate * 100)}% of planned hours to absence, held back from ${fmtH(sumP50)} of P50 work.`,
    formula: 'B_avail = absenceRate × ΣP50ᵢ',
    inputs: { absenceRate: inputs.squad.absenceRate, sumP50: round(sumP50), bufferH: buffer.availability },
  };
  explanations['buffer.total'] = {
    method: 'Critical-chain project buffer',
    citation: CITATIONS.buffer,
    plainWords: `Instead of padding every item, one visible buffer of ${fmtH(buffer.total)} sits at the end: task risk + unknowns + absence.`,
    formula: 'B = B_task + B_missing + B_avail; commit = ΣP50ᵢ + B',
    inputs: { sumP50: round(sumP50), task: buffer.task, missingInfo: buffer.missingInfo, availability: buffer.availability, commitHours },
  };

  // --- schedule -------------------------------------------------------------
  const finishSorted = sortedCopy(sim.finishDays);
  const finishP50 = quantileSorted(finishSorted, 0.5);
  const finishP80 = quantileSorted(finishSorted, 0.8);
  const p50Hours = items.map((it) => baseP50ById.get(it.id) ?? it.m);
  const det = scheduleOnce(cfg, p50Hours);
  const baseP50Sum = sumP50 || 1;
  const commitDays = det.finish * (commitHours / baseP50Sum);
  const p50Date = addWorkingDays(startDate, finishP50);
  const p80Date = addWorkingDays(startDate, finishP80);
  const commitDate = addWorkingDays(startDate, Math.max(commitDays, finishP50));
  const teamDesc = Object.entries(team)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([r, n]) => `${n} ${r}`)
    .join(', ');
  explanations['p50Date'] = {
    method: 'Monte Carlo schedule',
    citation: `${CITATIONS.monteCarlo}; ${CITATIONS.brooks}`,
    plainWords: `Half of simulated schedules finish by ${p50Date} with ${teamDesc || 'the current team'}.`,
    formula: 'phases in order; phase days = max over roles of max(Σh·(1 + c(n−1)) / (n·6h·focus·(1−absence)), longest item); + planned leave',
    inputs: { ...mcInputs, finishWorkingDaysP50: round(finishP50) },
  };
  explanations['p80Date'] = {
    ...explanations['p50Date'],
    plainWords: `80% of simulated schedules finish by ${p80Date}.`,
    inputs: { ...mcInputs, finishWorkingDaysP80: round(finishP80) },
  };
  explanations['commitDate'] = {
    method: 'Critical-chain commit date',
    citation: CITATIONS.buffer,
    plainWords: `Plan every item at its P50, then add the ${fmtH(buffer.total)} buffer at the end: ${fmtH(commitHours)} of work lands on ${commitDate}.`,
    formula: 'commit days = P50 schedule days × (ΣP50 + B) / ΣP50',
    inputs: { p50ScheduleDays: round(det.finish), commitHours, sumP50: round(baseP50Sum), commitWorkingDays: round(commitDays) },
  };

  let onTimeProbability: number | null = null;
  if (deadline) {
    const limit = workingDaysBetween(startDate, deadline);
    let hits = 0;
    for (let i = 0; i < sim.finishDays.length; i++) if ((sim.finishDays[i] as number) <= limit) hits++;
    onTimeProbability = round(hits / runs, 3);
    explanations['onTime'] = {
      method: 'Probability of meeting the deadline',
      citation: CITATIONS.monteCarlo,
      plainWords: `${Math.round(onTimeProbability * 100)}% of simulated schedules finish on or before ${deadline} (${limit} working days from ${startDate}).`,
      formula: 'P(finish ≤ deadline) = #runs with finish days ≤ deadline days / runs',
      inputs: { deadline, workingDaysAvailable: limit, runs, hits },
    };
  }

  // --- per phase ------------------------------------------------------------
  const perPhase: PhaseEstimate[] = [];
  const orderedPhases = [...scope.phases].sort((a, b) => a.order - b.order);
  let prevEnd = 0;
  for (const ph of orderedPhases) {
    const idx = scope.phases.indexOf(ph);
    const hs = sortedCopy(sim.phaseHours[idx] as Float64Array);
    const es = sortedCopy(sim.phaseEnd[idx] as Float64Array);
    const pe: PhaseEstimate = {
      phaseId: ph.id,
      name: ph.name,
      role: ph.role,
      order: ph.order,
      p50: round(quantileSorted(hs, 0.5)),
      p80: round(quantileSorted(hs, 0.8)),
      startDay: round(prevEnd, 2),
      endDayP50: round(quantileSorted(es, 0.5), 2),
      endDayP80: round(quantileSorted(es, 0.8), 2),
    };
    prevEnd = pe.endDayP50;
    perPhase.push(pe);
    const phaseItems = calibratedOut.filter((c) => c.phaseId === ph.id);
    const n = effectiveHeadcount(team, ph.role);
    explanations[`phase.${ph.id}`] = {
      method: 'Monte Carlo per phase',
      citation: `${CITATIONS.monteCarlo}; ${CITATIONS.brooks}`,
      plainWords: `${phaseItems.length} item${phaseItems.length === 1 ? '' : 's'} shared across ${n} ${ph.role}${n === 1 ? '' : 's'}: ${fmtH(pe.p50)} at P50, ${fmtH(pe.p80)} at P80, ending around working day ${Math.ceil(pe.endDayP50)}.`,
      formula: 'P50/P80 of Σ phase item hours × (1 + c·(n − 1)) across runs',
      inputs: { items: phaseItems.length, headcount: n, overheadPerExtra: inputs.squad.coordinationOverheadPerExtra, p50: pe.p50, p80: pe.p80 },
    };
  }

  // --- confidence -----------------------------------------------------------
  const ratio = total.p50 > 0 ? total.p80 / total.p50 : 1;
  const highOpen = open.filter((q) => q.impact === 'high').length;
  const confidence: Estimate['confidence'] =
    ratio > 1.6 || open.length >= 3 ? 'Low' : ratio < 1.25 && highOpen === 0 ? 'High' : 'Medium';
  explanations['confidence'] = {
    method: 'Confidence rule',
    citation: CITATIONS.confidence,
    plainWords:
      confidence === 'High'
        ? `The P80 is only ${Math.round((ratio - 1) * 100)}% above the P50 and no high-impact question is open.`
        : confidence === 'Low'
          ? open.length >= 3
            ? `${open.length} questions are still open. Answer the top ones to raise confidence.`
            : `The P80 is ${Math.round((ratio - 1) * 100)}% above the P50: the range is wide.`
          : `The range is moderate (P80 is ${Math.round((ratio - 1) * 100)}% above P50)${highOpen ? ` and ${highOpen} high-impact question${highOpen === 1 ? ' is' : 's are'} open` : ''}.`,
    formula: 'High: P80/P50 < 1.25 and no high-impact open questions; Low: P80/P50 > 1.6 or ≥ 3 open; else Medium',
    inputs: { p80OverP50: round(ratio, 3), openQuestions: open.length, highImpactOpen: highOpen },
  };

  // --- value of information -------------------------------------------------
  const rankedQuestions: RankedQuestion[] = [];
  if (!skipVoi && open.length > 0) {
    const baseCfg = simConfig(prep, items, team, voiRuns, seed);
    const baseSpread = spreadOf(simulate(baseCfg).totalHours);
    for (const q of open) {
      const others = open.filter((o) => o.id !== q.id);
      const without = simConfig(prep, simItems(prep, others, dropped, links), team, voiRuns, seed);
      const narrows = Math.max(0, baseSpread - spreadOf(simulate(without).totalHours));
      rankedQuestions.push({
        questionId: q.id,
        question: q.question,
        impact: q.impact,
        narrowsByH: round(narrows),
        affectedItemIds: [...(links.get(q.id) ?? [])],
      });
      explanations[`question.${q.id}`] = {
        method: 'Value of information',
        citation: CITATIONS.voi,
        plainWords: `Ask this first: it narrows the range by ~${fmtH(narrows)}. Answering it removes the extra spread on ${links.get(q.id)?.size ?? 0} item${(links.get(q.id)?.size ?? 0) === 1 ? '' : 's'}.`,
        formula: 'VOI_q = (P80 − P50) with all questions open − (P80 − P50) with q answered (same seed)',
        inputs: { runs: voiRuns, seed, spreadMultiplier: q.spreadMultiplier, baseSpreadH: round(baseSpread), narrowsByH: round(narrows) },
      };
    }
    rankedQuestions.sort((a, b) => b.narrowsByH - a.narrowsByH || a.questionId.localeCompare(b.questionId));
  }

  // --- history context -------------------------------------------------------
  explanations['referenceClass'] = prep.reference.explanation;
  explanations['correlation'] = prep.sigma.explanation;
  explanations['panel'] = prep.aggregated.explanation;
  for (const [cat, b] of prep.biases) explanations[`bias.${cat}`] = b.explanation;
  prep.analogs.forEach((a) => (explanations[`analogs.${a.value.itemId}`] = a.explanation));

  const elapsedMs = round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0, 1);
  return {
    perPhase,
    total,
    buffer,
    commitHours,
    startDate,
    commitDate,
    p50Date,
    p80Date,
    deadline,
    onTimeProbability,
    confidence,
    rankedQuestions,
    analogs: prep.analogs.map((a) => a.value),
    referenceClass: prep.reference.value,
    items: calibratedOut,
    hoursHistogram: histogram(Array.from(sim.totalHours), 48),
    finishDayHistogram: histogram(Array.from(sim.finishDays), 32),
    runs,
    seed,
    elapsedMs,
    explanations,
  };
}

/** One-shot estimate. */
export function buildEstimate(inputs: EstimateInputs): Estimate {
  return runEstimate(prepareEstimate(inputs));
}

/** Team what-if: same inputs, new team shape, 1,000 runs. Pure; reuse `prep` across slider moves. */
export function whatIf(prep: PreparedEstimate, teamShape: TeamShape, opts: Omit<RunOptions, 'teamShape'> = {}): Estimate {
  return runEstimate(prep, { runs: WHAT_IF_RUNS, skipVoi: true, ...opts, teamShape });
}
