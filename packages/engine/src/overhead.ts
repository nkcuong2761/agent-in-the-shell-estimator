import type { HistoryItem, HistoryProject, Squad } from '@scopewise/shared';
import { overheadFactor } from './simulate';

/** Returns the coordination-overhead factor that was baked into an item's actual hours. */
export type OverheadLookup = (item: HistoryItem) => number;

export const noOverhead: OverheadLookup = () => 1;

/**
 * Past actuals already include the coordination overhead of the squad that did the work.
 * Bias and analog calculations divide it out so the engine can re-apply overhead for the planned team.
 */
export function historyOverhead(projects: readonly HistoryProject[], squads: readonly Squad[]): OverheadLookup {
  const squadOf = new Map(projects.map((p) => [p.id, p.squad]));
  const byId = new Map(squads.map((s) => [s.id, s]));
  return (item) => {
    const squad = byId.get(squadOf.get(item.projectId) ?? '');
    if (!squad) return 1;
    const n = squad.members.find((m) => m.role === item.role)?.count ?? 1;
    return overheadFactor(Math.max(1, n), squad.stats.coordinationOverheadPerExtra);
  };
}
