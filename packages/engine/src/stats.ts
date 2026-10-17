/** Linear-interpolated quantile (type 7). `q` in [0, 1]. Input need not be sorted. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return quantileSorted(sorted, q);
}

export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = (n - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / (values.length - 1));
}

/** Coefficient of variation (population sd / mean). 0 when the mean is 0. */
export function coefficientOfVariation(values: readonly number[]): number {
  const m = mean(values);
  if (m === 0 || values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / values.length) / m;
}

export function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function histogram(values: readonly number[], bins: number): { edges: number[]; counts: number[]; binWidth: number } {
  if (values.length === 0) return { edges: [], counts: [], binWidth: 0 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi === lo) hi = lo + 1;
  const width = (hi - lo) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const v of values) {
    const i = Math.min(bins - 1, Math.floor((v - lo) / width));
    counts[i] = (counts[i] ?? 0) + 1;
  }
  const edges = counts.map((_, i) => lo + i * width);
  return { edges, counts, binWidth: width };
}
