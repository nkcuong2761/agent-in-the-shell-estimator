import type { Category, Estimate, ScopeResult } from '@scopewise/shared';
import { copy } from '../copy';
import { formatDuration, roundHours } from './format';

export const RUNS_LONG_FACTOR = 1.2;

export interface StageItem {
  id: string;
  title: string;
  hours: string;
  sources: { label: string; quote?: string }[];
}

export interface StageRow {
  id: string;
  name: string;
  duration: string;
  startWeek: number;
  endWeek: number;
  runsLong: boolean;
  items: StageItem[];
}

export interface Stages {
  rows: StageRow[];
  margin: { startWeek: number; endWeek: number; duration: string };
  scaleWeeks: number;
}

const SOURCE_NAMES: Record<string, string> = {
  'email.md': 'Client email',
  'meeting-notes.md': 'Kickoff call notes',
  'jira-ticket.md': 'Jira ticket',
};

export function sourceLabel(name: string): string {
  return SOURCE_NAMES[name] ?? name.replace(/\.(md|txt|eml|pdf)$/i, '').replace(/[-_]/g, ' ');
}

/**
 * One row per stage on a weeks-from-kickoff scale, from the median simulated schedule, plus the safety margin.
 * `observedBias` is actual/estimate per category as people experienced it (team coordination included); it
 * decides the "often runs long" note. Without it the engine's own factor is used.
 */
export function toStages(est: Estimate, scope: ScopeResult, observedBias?: ReadonlyMap<Category, number>): Stages {
  const byItem = new Map(scope.items.map((i) => [i.id, i]));
  const rows: StageRow[] = est.perPhase.map((ph) => {
    const cal = est.items.filter((c) => c.phaseId === ph.phaseId);
    // The stage's main kind of work is the category carrying the most hours.
    const byCat = new Map<Category, { hours: number; bias: number }>();
    for (const c of cal) {
      const e = byCat.get(c.category) ?? { hours: 0, bias: observedBias?.get(c.category) ?? c.biasFactor };
      e.hours += c.p50;
      byCat.set(c.category, e);
    }
    const main = [...byCat.values()].sort((a, b) => b.hours - a.hours)[0];
    return {
      id: ph.phaseId,
      name: ph.name,
      duration: formatDuration(ph.endDayP50 - ph.startDay),
      startWeek: ph.startDay / 5,
      endWeek: ph.endDayP50 / 5,
      runsLong: (main?.bias ?? 1) >= RUNS_LONG_FACTOR,
      items: cal.map((c) => {
        const it = byItem.get(c.itemId);
        return {
          id: c.itemId,
          title: it?.title ?? c.itemId,
          hours: copy.itemHours(roundHours(c.p50), roundHours(c.p80)),
          sources: (it?.sourceRefs ?? []).map((r) => ({ label: sourceLabel(r.source), quote: r.quote })),
        };
      }),
    };
  });
  const marginStart = est.finishDays.p50 / 5;
  const marginEnd = Math.max(marginStart, est.finishDays.commit / 5);
  return {
    rows,
    margin: { startWeek: marginStart, endWeek: marginEnd, duration: formatDuration((marginEnd - marginStart) * 5) },
    scaleWeeks: Math.max(1, Math.ceil(Math.max(marginEnd, est.finishDays.p80 / 5))),
  };
}
