import { CITATIONS, type Explained } from './explain';
import { beta, mulberry32, type Rng } from './prng';
import { quantileSorted, round } from './stats';

/** One draw from Beta-PERT(o, m, p). Degenerate ranges return m. */
export function samplePert(rng: Rng, o: number, m: number, p: number): number {
  const range = p - o;
  if (range <= 1e-9) return m;
  const a = 1 + (4 * (m - o)) / range;
  const b = 1 + (4 * (p - m)) / range;
  return o + beta(rng, a, b) * range;
}

export function pertMean(o: number, m: number, p: number): number {
  return (o + 4 * m + p) / 6;
}

export function pertSd(o: number, p: number): number {
  return (p - o) / 6;
}

export interface ItemQuantiles {
  p50: number;
  p80: number;
}

/** P50/P80 of Beta-PERT(o, m, p) by seeded sampling (common random numbers across calls with the same seed). */
export function pertQuantiles(o: number, m: number, p: number, seed: number, n = 2000): Explained<ItemQuantiles> {
  const rng = mulberry32(seed);
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = samplePert(rng, o, m, p);
  xs.sort();
  const value = { p50: round(quantileSorted(xs, 0.5), 2), p80: round(quantileSorted(xs, 0.8), 2) };
  return {
    value,
    explanation: {
      method: 'Three-point estimate as a Beta-PERT distribution',
      citation: CITATIONS.pert,
      plainWords: `Between ${round(o)}h (optimistic) and ${round(p)}h (pessimistic), most likely ${round(m)}h: half of outcomes land under ${round(value.p50)}h and 80% under ${round(value.p80)}h.`,
      formula: 'X = o + (p − o)·Beta(1 + 4(m − o)/(p − o), 1 + 4(p − m)/(p − o))',
      inputs: { o: round(o, 2), m: round(m, 2), p: round(p, 2), samples: n },
    },
  };
}
