/**
 * The bridge between conversations and the engine. Estimates are recomputed from each version's spec (the engine
 * is deterministic), and cached so re-renders and the sidebar stay fast. The engine's methods are untouched: the
 * working-hours policy and the risks-and-buffer factor arrive as a squad focus-factor override, covered roles as a
 * derived scope, and the plan ("working time") as a second run with no planned leave in its window.
 */
import type { BriefPack, Category, Conversation, Estimate, EstimateSpec, EstimateVersion, PanelResult, PlannedLeave, Provenance, Role, ScopeResult, SquadStats, TeamShape } from '@scopewise/shared';
import {
  biasFactors,
  buildAnalogIndex,
  DEFAULT_SQUAD_STATS,
  findAnalogs,
  historyOverhead,
  OFFLINE_PANEL_VERSION,
  OFFLINE_SCOPE_VERSION,
  offlinePanel,
  offlineScope,
  prepareEstimate,
  runEstimate,
  type PreparedEstimate,
} from '@scopewise/engine';
import { sampleById, seed } from '../lib/data';
import { formatDate, weeksRange } from '../present/format';
import { bufferFactor, focusFactorFor, resolvePolicy, startingTeam, type HoursPolicy } from './policy';

export function scopeOf(conv: Conversation): ScopeResult | undefined {
  return conv.scope ?? sampleById(conv.sampleId)?.cache.scope;
}

export function panelOf(conv: Conversation): PanelResult | undefined {
  return conv.panel ?? sampleById(conv.sampleId)?.cache.panel;
}

const offlineProvenance = (promptVersion: string): Provenance => ({ promptVersion, generatedBy: 'offline-heuristic', generatedAt: new Date().toISOString() });

/** With no API at all, a pasted brief is read here in the browser by the engine's rule-based reader. */
export function scopeInBrowser(brief: BriefPack): { scope: ScopeResult; provenance: Provenance } {
  return { scope: offlineScope(brief, { projects: seed.projects, items: seed.items }), provenance: offlineProvenance(OFFLINE_SCOPE_VERSION) };
}

export function panelInBrowser(scope: ScopeResult): { panel: PanelResult; provenance: Provenance } {
  const index = buildAnalogIndex(seed.items, seed.projects, historyOverhead(seed.projects, seed.squads));
  const analogs = scope.items.map((i) => findAnalogs(i, index).value);
  return { panel: offlinePanel(scope, analogs), provenance: offlineProvenance(OFFLINE_PANEL_VERSION) };
}

export function squadOf(conv: Pick<Conversation, 'squadId'>) {
  return seed.squads.find((s) => s.id === conv.squadId);
}

export function squadStatsOf(conv: Pick<Conversation, 'squadId'>): SquadStats {
  return squadOf(conv)?.stats ?? DEFAULT_SQUAD_STATS;
}

export const ROLE_ORDER: Role[] = ['pm', 'designer', 'engineer', 'qa', 'legal'];

/** Roles the scope needs, in the order their first stage appears. */
export function neededRoles(scope: ScopeResult): Role[] {
  const order = new Map(scope.phases.map((p) => [p.id, p.order]));
  const first = new Map<Role, number>();
  for (const it of scope.items) {
    const o = order.get(it.phaseId) ?? 99;
    if (!first.has(it.role) || o < (first.get(it.role) as number)) first.set(it.role, o);
  }
  return [...first.entries()].sort((a, b) => a[1] - b[1] || ROLE_ORDER.indexOf(a[0]) - ROLE_ORDER.indexOf(b[0])).map(([r]) => r);
}

/** The team a new estimate starts from: the saved default for its category, else one person per role the work needs. */
export function defaultTeam(scope: ScopeResult): TeamShape {
  return startingTeam(scope.projectType, neededRoles(scope));
}

export function policyOf(conv: Pick<Conversation, 'createdAt' | 'squadId'>, spec: Pick<EstimateSpec, 'hoursPerDay' | 'daysPerWeek'>): HoursPolicy {
  return resolvePolicy(spec, conv, squadOf(conv)?.stats);
}

/** Items of a covered role are done by the covering role ("Developer does it too"). */
function coveredScope(scope: ScopeResult, covered: EstimateSpec['coveredRoles']): ScopeResult {
  const entries = Object.entries(covered ?? {}) as [Role, Role][];
  if (!entries.length) return scope;
  const map = new Map(entries);
  return { ...scope, items: scope.items.map((i) => (map.has(i.role) ? { ...i, role: map.get(i.role) as Role } : i)) };
}

const derivedScopes = new WeakMap<ScopeResult, Map<string, ScopeResult>>();
function scopeFor(scope: ScopeResult, covered: EstimateSpec['coveredRoles']): ScopeResult {
  const key = JSON.stringify(covered ?? {});
  if (key === '{}') return scope;
  let m = derivedScopes.get(scope);
  if (!m) derivedScopes.set(scope, (m = new Map()));
  let s = m.get(key);
  if (!s) m.set(key, (s = coveredScope(scope, covered)));
  return s;
}

const prepared = new WeakMap<ScopeResult, Map<string, PreparedEstimate>>();

/** History-dependent preparation, once per squad (the start date and squad stats are swapped in per run). */
function prepare(conv: Conversation, scope: ScopeResult): PreparedEstimate {
  let bySquad = prepared.get(scope);
  if (!bySquad) prepared.set(scope, (bySquad = new Map()));
  let p = bySquad.get(conv.squadId);
  if (!p) {
    const squad = squadOf(conv);
    p = prepareEstimate({
      scope,
      panel: panelOf(conv),
      history: { projects: seed.projects, items: seed.items, squads: seed.squads },
      squad: squad?.stats ?? DEFAULT_SQUAD_STATS,
      plannedLeave: squad?.plannedLeave ?? [],
      teamShape: defaultTeam(scope),
      startDate: conv.startDate,
    });
    bySquad.set(conv.squadId, p);
  }
  return p;
}

interface RunInputs {
  startDate: string;
  focusFactor: number;
  plannedLeave: readonly PlannedLeave[];
}

function withInputs(p: PreparedEstimate, r: RunInputs): PreparedEstimate {
  return { ...p, inputs: { ...p.inputs, startDate: r.startDate, plannedLeave: r.plannedLeave, squad: { ...p.inputs.squad, focusFactor: r.focusFactor } } };
}

const cache = new Map<string, Estimate>();
function remember(key: string, est: Estimate): Estimate {
  if (cache.size > 120) cache.delete(cache.keys().next().value as string);
  cache.set(key, est);
  return est;
}

/** Pure P50 effort for this spec, before the buffer factor (the buffer never changes hours, only time). */
function p50HoursOf(conv: Conversation, scope: ScopeResult, spec: EstimateSpec, focus: number): number {
  const key = JSON.stringify(['p50', conv.id, scope.items.length, spec.team, spec.droppedItemIds, spec.answeredQuestionIds, spec.coveredRoles, focus]);
  const hit = cache.get(key);
  if (hit) return hit.total.p50;
  const est = runEstimate(withInputs(prepare(conv, scopeFor(scope, spec.coveredRoles)), { startDate: spec.startDate, focusFactor: focus, plannedLeave: [] }), {
    teamShape: spec.team,
    answeredQuestionIds: spec.answeredQuestionIds,
    droppedItemIds: spec.droppedItemIds,
    skipVoi: true,
    runs: 1000,
  });
  return remember(key, est).total.p50;
}

/** The inputs the engine runs with for a spec: the policy's focus factor divided by the buffer factor. */
export function runInputsOf(conv: Conversation, spec: EstimateSpec): { focus: number; f: number; policy: HoursPolicy } {
  const stats = squadStatsOf(conv);
  const policy = policyOf(conv, spec);
  const base = focusFactorFor(policy, stats) ?? stats.focusFactor;
  const scope = scopeOf(conv);
  const f = scope && ((spec.risks?.length ?? 0) > 0 || (spec.bufferPct ?? 0) > 0) ? bufferFactor(p50HoursOf(conv, scope, spec, base), spec.risks, spec.bufferPct) : 1;
  return { focus: base / f, f, policy };
}

export function estimateFor(conv: Conversation, spec: EstimateSpec, opts: { quick?: boolean; noLeave?: boolean } = {}): Estimate | undefined {
  const scope = scopeOf(conv);
  if (!scope) return undefined;
  const { focus, f } = runInputsOf(conv, spec);
  const key = JSON.stringify([conv.id, scope.items.length, spec, opts.quick ?? false, opts.noLeave ?? false, focus, f]);
  const hit = cache.get(key);
  if (hit) return hit;
  const squad = squadOf(conv);
  const est = runEstimate(withInputs(prepare(conv, scopeFor(scope, spec.coveredRoles)), { startDate: spec.startDate, focusFactor: focus, plannedLeave: opts.noLeave ? [] : (squad?.plannedLeave ?? []) }), {
    teamShape: spec.team,
    answeredQuestionIds: spec.answeredQuestionIds,
    droppedItemIds: spec.droppedItemIds,
    deadline: spec.deadline,
    skipVoi: opts.quick,
    runs: opts.quick ? 1000 : undefined,
  });
  return remember(key, est);
}

export function versionEstimate(conv: Conversation, versionId: string, quick = false): Estimate | undefined {
  const v = conv.versions[versionId];
  return v ? estimateFor(conv, v.spec, { quick }) : undefined;
}

export interface Plan {
  /** Pure working days: the most likely finish with planned leave removed, divided by the buffer factor. */
  planDays: number;
  /** Pure P50 effort in hours, rounded to 5. */
  effortH: number;
  f: number;
  policy: HoursPolicy;
}

/** Working time (6.1): min(P50 finish with no leave in the window, the real P50 finish) / f. Does not move with the start date. */
export function planOf(conv: Conversation, spec: EstimateSpec): Plan | undefined {
  const real = estimateFor(conv, spec, { quick: true });
  const noLeave = estimateFor(conv, spec, { quick: true, noLeave: true });
  if (!real || !noLeave) return undefined;
  const { f, policy } = runInputsOf(conv, spec);
  return { planDays: Math.min(real.finishDays.p50, noLeave.finishDays.p50) / f, effortH: Math.round(real.total.p50 / 5) * 5, f, policy };
}

export function makeVersion(conv: Conversation, spec: EstimateSpec, id: string, now: string): EstimateVersion | undefined {
  const est = estimateFor(conv, spec, { quick: true });
  if (!est) return undefined;
  const w = weeksRange(est.finishDays.p50, est.finishDays.p80);
  return { id, createdAt: now, spec, summary: { weeksLow: w.low, weeksHigh: w.high, safeDate: formatDate(est.commitDate) } };
}

let observed: Map<Category, number> | null = null;
/** Actual/estimate per kind of work as the team experienced it (coordination included), for plain-language notes. */
export function observedBias(): ReadonlyMap<Category, number> {
  if (!observed) observed = new Map([...biasFactors(seed.items, seed.projects)].map(([k, v]) => [k, v.value.factor]));
  return observed;
}
