/**
 * The bridge between conversations and the engine. Estimates are recomputed from each version's spec (the engine
 * is deterministic), and cached so re-renders and the sidebar stay fast.
 */
import type { Category, Conversation, Estimate, EstimateSpec, EstimateVersion, PanelResult, Role, ScopeResult, SquadStats, TeamShape } from '@scopewise/shared';
import { biasFactors, DEFAULT_SQUAD_STATS, prepareEstimate, runEstimate, type PreparedEstimate } from '@scopewise/engine';
import { sampleById, seed } from '../lib/data';
import { formatDate, weeksRange } from '../present/format';

export function scopeOf(conv: Conversation): ScopeResult | undefined {
  return conv.scope ?? sampleById(conv.sampleId)?.cache.scope;
}

export function panelOf(conv: Conversation): PanelResult | undefined {
  return conv.panel ?? sampleById(conv.sampleId)?.cache.panel;
}

export function squadOf(conv: Pick<Conversation, 'squadId'>) {
  return seed.squads.find((s) => s.id === conv.squadId);
}

export function squadStatsOf(conv: Pick<Conversation, 'squadId'>): SquadStats {
  return squadOf(conv)?.stats ?? DEFAULT_SQUAD_STATS;
}

/** The team defaults to one person per role the work needs. */
export function defaultTeam(scope: ScopeResult): TeamShape {
  const t: TeamShape = {};
  for (const role of new Set<Role>(scope.items.map((i) => i.role))) t[role] = 1;
  return t;
}

const prepared = new WeakMap<ScopeResult, Map<string, PreparedEstimate>>();

function prepare(conv: Conversation, scope: ScopeResult, startDate: string): PreparedEstimate {
  let byStart = prepared.get(scope);
  if (!byStart) prepared.set(scope, (byStart = new Map()));
  const key = `${conv.squadId}|${startDate}`;
  let p = byStart.get(key);
  if (!p) {
    const squad = squadOf(conv);
    p = prepareEstimate({
      scope,
      panel: panelOf(conv),
      history: { projects: seed.projects, items: seed.items, squads: seed.squads },
      squad: squad?.stats ?? DEFAULT_SQUAD_STATS,
      plannedLeave: squad?.plannedLeave ?? [],
      teamShape: defaultTeam(scope),
      startDate,
    });
    byStart.set(key, p);
  }
  return p;
}

const cache = new Map<string, Estimate>();

export function estimateFor(conv: Conversation, spec: EstimateSpec, opts: { quick?: boolean } = {}): Estimate | undefined {
  const scope = scopeOf(conv);
  if (!scope) return undefined;
  const key = JSON.stringify([conv.id, scope.items.length, spec, opts.quick ?? false]);
  const hit = cache.get(key);
  if (hit) return hit;
  const est = runEstimate(prepare(conv, scope, spec.startDate), {
    teamShape: spec.team,
    answeredQuestionIds: spec.answeredQuestionIds,
    droppedItemIds: spec.droppedItemIds,
    deadline: spec.deadline,
    skipVoi: opts.quick,
  });
  if (cache.size > 80) cache.delete(cache.keys().next().value as string);
  cache.set(key, est);
  return est;
}

export function versionEstimate(conv: Conversation, versionId: string, quick = false): Estimate | undefined {
  const v = conv.versions[versionId];
  return v ? estimateFor(conv, v.spec, { quick }) : undefined;
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
