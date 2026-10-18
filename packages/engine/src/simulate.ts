import type { PlannedLeave, Role, SquadStats, TeamShape } from '@scopewise/shared';
import { HOURS_PER_DAY, workingDayOffset } from './calendar';
import { samplePert } from './pert';
import { mulberry32, normal, type Rng } from './prng';

export interface SimItem {
  id: string;
  phaseId: string;
  role: Role;
  o: number;
  m: number;
  p: number;
  /** Indices into SimConfig.questionSigmas of the open questions that move this item. */
  questions?: number[];
}

export interface SimPhase {
  id: string;
  order: number;
}

export interface SimConfig {
  phases: readonly SimPhase[];
  items: readonly SimItem[];
  teamShape: TeamShape;
  squad: SquadStats;
  plannedLeave: readonly PlannedLeave[];
  startDate: string;
  runs: number;
  seed: number;
  /** Spread of the shared project-level error factor (see correlation.ts). 0 = independent items. */
  projectSigma?: number;
  /** σ of each question's shared factor (see questionSigma); 0 when answered. */
  questionSigmas?: number[];
}

export interface SimOutput {
  runs: number;
  /** [itemIndex][run] sampled effort hours, before coordination overhead. */
  itemHours: Float64Array[];
  /** [phaseIndex][run] effort hours, including coordination overhead. */
  phaseHours: Float64Array[];
  /** [phaseIndex][run] working-day offset at which the phase ends. */
  phaseEnd: Float64Array[];
  totalHours: Float64Array;
  finishDays: Float64Array;
}

interface LeaveWindow {
  role: Role;
  start: number;
  end: number;
  people: number;
}

/** Headcount used for scheduling: fractions are part-time capacity; a role with nobody assigned borrows one person. */
export function effectiveHeadcount(team: TeamShape, role: Role): number {
  const v = team[role] ?? 0;
  return v > 0 ? Math.max(0.05, v) : 1;
}

/** Brooks overhead: each extra person in a role adds `c` of that role's hours. */
export function overheadFactor(headcount: number, c: number): number {
  return 1 + c * Math.max(0, headcount - 1);
}

interface PhasePlan {
  phaseIndex: number;
  roles: { role: Role; itemIdx: number[] }[];
}

function plan(cfg: SimConfig): PhasePlan[] {
  const sorted = cfg.phases.map((p, i) => ({ p, i })).sort((a, b) => a.p.order - b.p.order);
  return sorted.map(({ p, i }) => {
    const byRole = new Map<Role, number[]>();
    cfg.items.forEach((it, idx) => {
      if (it.phaseId !== p.id) return;
      const arr = byRole.get(it.role) ?? [];
      arr.push(idx);
      byRole.set(it.role, arr);
    });
    return { phaseIndex: i, roles: [...byRole.entries()].map(([role, itemIdx]) => ({ role, itemIdx })) };
  });
}

function leaveWindows(cfg: SimConfig): LeaveWindow[] {
  return cfg.plannedLeave.map((l) => ({
    role: l.role,
    start: workingDayOffset(cfg.startDate, l.start),
    end: workingDayOffset(cfg.startDate, l.end) + 1,
    people: l.people,
  }));
}

/**
 * Calendar length of one role's share of a phase.
 * Items run in parallel across the role's headcount, but a single item can't be split.
 * Random absence removes capacity; planned leave inside the window pushes the end out.
 */
function roleDuration(
  hours: number[],
  role: Role,
  start: number,
  cfg: SimConfig,
  leave: LeaveWindow[],
  absenceFraction: number,
): { effort: number; days: number } {
  const n = effectiveHeadcount(cfg.teamShape, role);
  const oh = overheadFactor(n, cfg.squad.coordinationOverheadPerExtra);
  let sum = 0;
  let longest = 0;
  for (const h of hours) {
    sum += h;
    if (h > longest) longest = h;
  }
  const effort = sum * oh;
  const perPersonDay = HOURS_PER_DAY * cfg.squad.focusFactor * (1 - absenceFraction);
  let days = Math.max(effort / (n * perPersonDay), (longest * oh) / perPersonDay);
  for (const w of leave) {
    if (w.role !== role) continue;
    const overlap = Math.max(0, Math.min(start + days, w.end) - Math.max(start, w.start));
    if (overlap > 0) days += (overlap * Math.min(w.people, n)) / n;
  }
  return { effort, days };
}

/** Deterministic schedule for fixed item hours (used for the commit date). */
export function scheduleOnce(cfg: SimConfig, itemHours: readonly number[]): { phaseEnd: number[]; finish: number; effort: number } {
  const leave = leaveWindows(cfg);
  const phaseEnd = new Array<number>(cfg.phases.length).fill(0);
  let day = 0;
  let effort = 0;
  for (const ph of plan(cfg)) {
    let longest = 0;
    for (const r of ph.roles) {
      const d = roleDuration(r.itemIdx.map((i) => itemHours[i] ?? 0), r.role, day, cfg, leave, cfg.squad.absenceRate);
      effort += d.effort;
      if (d.days > longest) longest = d.days;
    }
    day += longest;
    phaseEnd[ph.phaseIndex] = day;
  }
  return { phaseEnd, finish: day, effort };
}

/**
 * Monte Carlo over item effort, team capacity and absence (Metropolis & Ulam 1949).
 * Each run: draw one shared project-level error factor, sample every item from Beta-PERT, add coordination overhead per role, remove random capacity
 * at the squad absence rate, run phases in order with items in parallel across each role's headcount.
 */
export function simulate(cfg: SimConfig): SimOutput {
  const runs = cfg.runs;
  const rng: Rng = mulberry32(cfg.seed);
  const plans = plan(cfg);
  const leave = leaveWindows(cfg);
  const itemHours = cfg.items.map(() => new Float64Array(runs));
  const phaseHours = cfg.phases.map(() => new Float64Array(runs));
  const phaseEnd = cfg.phases.map(() => new Float64Array(runs));
  const totalHours = new Float64Array(runs);
  const finishDays = new Float64Array(runs);
  const scratch = new Array<number>(cfg.items.length).fill(0);
  const absenceMax = 2 * cfg.squad.absenceRate;
  const sigma = cfg.projectSigma ?? 0;
  const qSigmas = cfg.questionSigmas ?? [];
  const qFactor = new Float64Array(qSigmas.length);

  for (let r = 0; r < runs; r++) {
    // Draw in a fixed order (project factor, question factors, items, absence) so runs with different team shapes or
    // answered questions share random numbers.
    const shared = sigma > 0 ? Math.exp(sigma * normal(rng) - (sigma * sigma) / 2) : 1;
    for (let q = 0; q < qSigmas.length; q++) {
      const z = normal(rng);
      const s = qSigmas[q] as number;
      qFactor[q] = s > 0 ? Math.exp(z > 0 ? s * z : (s * z) / 3) : 1;
    }
    for (let i = 0; i < cfg.items.length; i++) {
      const it = cfg.items[i] as SimItem;
      let g = shared;
      if (it.questions) for (const q of it.questions) g *= qFactor[q] as number;
      const h = samplePert(rng, it.o, it.m, it.p) * g;
      scratch[i] = h;
      (itemHours[i] as Float64Array)[r] = h;
    }
    const absence = rng() * absenceMax;
    let day = 0;
    let total = 0;
    for (const ph of plans) {
      let longest = 0;
      let effort = 0;
      for (const role of ph.roles) {
        const d = roleDuration(role.itemIdx.map((i) => scratch[i] ?? 0), role.role, day, cfg, leave, absence);
        effort += d.effort;
        if (d.days > longest) longest = d.days;
      }
      day += longest;
      total += effort;
      (phaseHours[ph.phaseIndex] as Float64Array)[r] = effort;
      (phaseEnd[ph.phaseIndex] as Float64Array)[r] = day;
    }
    totalHours[r] = total;
    finishDays[r] = day;
  }
  return { runs, itemHours, phaseHours, phaseEnd, totalHours, finishDays };
}

export function sortedCopy(xs: Float64Array): Float64Array {
  return Float64Array.from(xs).sort();
}
