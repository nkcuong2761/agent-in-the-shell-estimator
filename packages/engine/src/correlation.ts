import type { HistoryItem, HistoryProject } from '@scopewise/shared';
import { isSuspectedDataError } from './analogs';
import { CITATIONS, type Explained } from './explain';
import { mean, round, stdev } from './stats';

export const DEFAULT_PROJECT_SIGMA = 0.15;
const PRIOR_WEIGHT = 5;

/**
 * Item errors within a project are not independent: a misunderstood brief or a slow partner moves every
 * item together. We estimate the spread of project-level error as the standard deviation of
 * log(actual / estimate) across closed projects, after removing each project type's mean (that part is
 * handled by bias correction), shrunk toward 0.15 for small samples. Each Monte Carlo run draws one
 * shared factor exp(σ·z − σ²/2) and applies it to every item.
 */
export function projectErrorSigma(projects: readonly HistoryProject[], items: readonly HistoryItem[]): Explained<number> {
  const closed = projects.filter((p) => p.status === 'closed' && p.estimateH > 0);
  const actualClean = new Map<string, number>();
  for (const it of items) {
    if (isSuspectedDataError(it)) continue;
    actualClean.set(it.projectId, (actualClean.get(it.projectId) ?? 0) + it.timeSpentH);
  }
  const byType = new Map<string, number[]>();
  for (const p of closed) {
    const a = actualClean.get(p.id) ?? p.actualH;
    if (a <= 0) continue;
    const arr = byType.get(p.projectType) ?? [];
    arr.push(Math.log(a / p.estimateH));
    byType.set(p.projectType, arr);
  }
  const residuals: number[] = [];
  for (const logs of byType.values()) {
    const m = mean(logs);
    for (const l of logs) residuals.push(l - m);
  }
  const n = residuals.length;
  const sd = n >= 3 ? stdev(residuals) : DEFAULT_PROJECT_SIGMA;
  const w = n / (n + PRIOR_WEIGHT);
  const sigma = Math.min(0.5, Math.max(0.05, w * sd + (1 - w) * DEFAULT_PROJECT_SIGMA));
  return {
    value: round(sigma, 4),
    explanation: {
      method: 'Correlated project-level error',
      citation: `${CITATIONS.monteCarlo}; ${CITATIONS.shrinkage}`,
      plainWords:
        n >= 3
          ? `Items in one project tend to run late together. Across ${n} closed projects, whole-project error varied by about ±${Math.round(sigma * 100)}%, so every simulated run shares one project-wide factor.`
          : `Too little history to measure how items move together, so a ±${Math.round(sigma * 100)}% project-wide factor is assumed.`,
      formula: 'σ = shrink(sd(log(actual/estimate) − type mean), toward 0.15, k = 5); factor = exp(σz − σ²/2)',
      inputs: { projects: n, rawSd: round(sd, 4), sigma: round(sigma, 4) },
    },
  };
}
