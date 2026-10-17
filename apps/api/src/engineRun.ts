/** Server-side runs of the pure engine against seed (or synced) history. */
import type { EstimateRequest, ItemAnalogs, ScopeResult, Squad } from '@scopewise/shared';
import {
  DEFAULT_SQUAD_STATS,
  buildAnalogIndex,
  findAnalogs,
  historyOverhead,
  prepareEstimate,
  type PreparedEstimate,
} from '@scopewise/engine';
import type { SeedHistory } from './data';

export function findSquad(history: SeedHistory, squadId: string | undefined): Squad | undefined {
  return squadId ? history.squads.find((s) => s.id === squadId) : undefined;
}

export function prepareFromRequest(req: EstimateRequest, history: SeedHistory): PreparedEstimate {
  const squad = findSquad(history, req.squadId);
  return prepareEstimate({
    scope: req.scope,
    panel: req.panel,
    history: { projects: history.projects, items: history.items, squads: history.squads },
    squad: squad?.stats ?? DEFAULT_SQUAD_STATS,
    plannedLeave: squad?.plannedLeave ?? [],
    teamShape: req.teamShape,
    startDate: req.startDate,
    deadline: req.deadline,
    answeredQuestionIds: req.answeredQuestionIds,
    droppedItemIds: req.droppedItemIds,
    runs: req.runs,
  });
}

export function analogsFor(scope: ScopeResult, history: SeedHistory): ItemAnalogs[] {
  const index = buildAnalogIndex(history.items, history.projects, historyOverhead(history.projects, history.squads));
  return scope.items.map((i) => findAnalogs(i, index).value);
}
