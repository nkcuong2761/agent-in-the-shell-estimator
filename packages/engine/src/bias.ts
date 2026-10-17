import type { Category, HistoryItem, HistoryProject } from '@scopewise/shared';
import { isSuspectedDataError } from './analogs';
import { CITATIONS, type Explained } from './explain';
import { noOverhead, type OverheadLookup } from './overhead';
import { mean, round } from './stats';

export const SHRINKAGE_K = 5;

export interface BiasFactor {
  category: Category;
  n: number;
  /** Raw mean of log(actual/estimate). */
  meanLogRatio: number;
  /** Shrunk multiplier r_c. */
  factor: number;
}

/**
 * Per-category bias multiplier with shrinkage toward 1:
 * log r_c = (n_c / (n_c + k)) · mean(log(actual / estimate)), k = 5.
 * Only planned items count (scope added after kickoff had no kickoff estimate to be biased).
 * Actuals are divided by the coordination overhead of the squad that did them (see overhead.ts).
 */
export function biasFactors(
  items: readonly HistoryItem[],
  projects: readonly HistoryProject[],
  overhead: OverheadLookup = noOverhead,
  k = SHRINKAGE_K,
): Map<Category, Explained<BiasFactor>> {
  const closed = new Set(projects.filter((p) => p.status === 'closed').map((p) => p.id));
  const groups = new Map<Category, number[]>();
  for (const it of items) {
    if (!closed.has(it.projectId) || it.addedAfterKickoff) continue;
    if (it.originalEstimateH <= 0 || it.timeSpentH <= 0 || isSuspectedDataError(it)) continue;
    const arr = groups.get(it.category) ?? [];
    arr.push(Math.log(it.timeSpentH / overhead(it) / it.originalEstimateH));
    groups.set(it.category, arr);
  }
  const out = new Map<Category, Explained<BiasFactor>>();
  const net = overhead !== noOverhead;
  for (const [category, logs] of groups) out.set(category, biasFor(category, logs, k, net));
  return out;
}

function biasFor(category: Category, logs: number[], k: number, netOfOverhead = false): Explained<BiasFactor> {
  const n = logs.length;
  const ml = mean(logs);
  const weight = n / (n + k);
  const factor = Math.exp(weight * ml);
  const pct = Math.round((factor - 1) * 100);
  return {
    value: { category, n, meanLogRatio: round(ml, 4), factor: round(factor, 4) },
    explanation: {
      method: 'Evidence-based bias correction with shrinkage',
      citation: CITATIONS.shrinkage,
      plainWords:
        pct === 0
          ? `Past ${category} work landed on estimate, so no correction.`
          : `Past ${category} work ran ${pct > 0 ? `${pct}% over` : `${-pct}% under`} estimate${netOfOverhead ? ' once team coordination time is set aside (it is added back for your team)' : ''}, shrunk toward 0% for ${n} data points, so guesses are scaled by ×${round(factor, 2)}.`,
      formula: 'log r_c = (n_c / (n_c + k)) · mean(log((actual / overhead) / estimate)), k = 5',
      inputs: { category, n, k, meanLogRatio: round(ml, 4), shrinkWeight: round(weight, 3), factor: round(factor, 4) },
    },
  };
}

export function neutralBias(category: Category): Explained<BiasFactor> {
  return biasFor(category, [], SHRINKAGE_K);
}
