import type { PanelResult, WorkItem } from '@scopewise/shared';
import { CITATIONS, type Explained } from './explain';
import { coefficientOfVariation, median, round } from './stats';

export const DISAGREEMENT_CV = 0.35;

export interface AggregatedGuess {
  itemId: string;
  o: number;
  m: number;
  p: number;
  cv: number;
  flagged: boolean;
  /** Number of personas that gave a guess for the item. */
  n: number;
}

/**
 * Wideband Delphi aggregation of the final round: o = min, m = median, p = max.
 * Items with a coefficient of variation of m above 0.35 are flagged for discussion.
 * Items no persona estimated fall back to the scope agent's own o/m/p.
 */
export function aggregatePanel(
  panel: PanelResult | undefined,
  items: readonly WorkItem[],
): Explained<AggregatedGuess[]> {
  const out: AggregatedGuess[] = items.map((item) => {
    const guesses = panel ? panel.agents.flatMap((a) => a.items.filter((g) => g.itemId === item.id)) : [];
    if (guesses.length === 0) {
      return { itemId: item.id, o: item.o, m: item.m, p: item.p, cv: 0, flagged: false, n: 0 };
    }
    const ms = guesses.map((g) => g.m);
    const o = Math.min(...guesses.map((g) => g.o));
    const p = Math.max(...guesses.map((g) => g.p));
    const m = median(ms);
    const cv = coefficientOfVariation(ms);
    return {
      itemId: item.id,
      o: Math.min(o, m),
      m,
      p: Math.max(p, m),
      cv: round(cv, 3),
      flagged: cv > DISAGREEMENT_CV,
      n: guesses.length,
    };
  });
  const flagged = out.filter((g) => g.flagged).length;
  return {
    value: out,
    explanation: {
      method: 'Wideband Delphi panel (2 rounds)',
      citation: CITATIONS.delphi,
      plainWords: panel
        ? `Three estimators guessed each item twice, seeing each other's reasons in between. We keep the lowest optimistic, the median likely and the highest pessimistic guess. ${flagged} item${flagged === 1 ? '' : 's'} still disagree enough to discuss.`
        : 'No panel ran, so the scope agent’s own three-point guesses are used.',
      formula: 'o = min(oᵢ), m = median(mᵢ), p = max(pᵢ); flag if CV(mᵢ) > 0.35',
      inputs: { personas: panel?.agents.length ?? 0, items: items.length, flagged, threshold: DISAGREEMENT_CV },
    },
  };
}
