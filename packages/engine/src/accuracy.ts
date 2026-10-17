import type { AccuracyMetrics } from '@scopewise/shared';
import { CITATIONS, type Explained } from './explain';
import { mean, round } from './stats';

export interface Outcome {
  actual: number;
  estimate: number;
  p80?: number;
}

/** Magnitude of relative error |actual − estimate| / actual. */
export function mre(o: Outcome): number {
  return o.actual > 0 ? Math.abs(o.actual - o.estimate) / o.actual : 0;
}

/** MMRE, PRED(25) and P80 hit rate (Conte, Dunsmore & Shen 1986). */
export function accuracy(outcomes: readonly Outcome[]): Explained<AccuracyMetrics> {
  const n = outcomes.length;
  const errs = outcomes.map(mre);
  const withP80 = outcomes.filter((o) => o.p80 !== undefined);
  const value: AccuracyMetrics = {
    n,
    mmre: round(mean(errs), 4),
    pred25: round(n ? errs.filter((e) => e <= 0.25).length / n : 0, 4),
    p80HitRate: round(withP80.length ? withP80.filter((o) => o.actual <= (o.p80 as number)).length / withP80.length : 0, 4),
  };
  return {
    value,
    explanation: {
      method: 'Estimation accuracy metrics',
      citation: CITATIONS.accuracy,
      plainWords: `Across ${n} closed projects, estimates were off by ${Math.round(value.mmre * 100)}% on average; ${Math.round(value.pred25 * 100)}% landed within 25% of actual, and ${Math.round(value.p80HitRate * 100)}% finished at or under their P80.`,
      formula: 'MMRE = mean(|a − e| / a); PRED(25) = share with MRE ≤ 0.25; P80 hit = share with a ≤ P80',
      inputs: { n, mmre: value.mmre, pred25: value.pred25, p80HitRate: value.p80HitRate },
    },
  };
}

/** Trailing-window mean, for rolling MMRE lines. */
export function rollingMean(values: readonly number[], window: number): number[] {
  return values.map((_, i) => mean(values.slice(Math.max(0, i - window + 1), i + 1)));
}
