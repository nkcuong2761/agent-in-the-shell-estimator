import type { Explanation } from '@scopewise/shared';

export interface Explained<T> {
  value: T;
  explanation: Explanation;
}

export const CITATIONS = {
  referenceClass: 'Kahneman & Tversky (1979); Flyvbjerg (2006)',
  analogy: 'Shepperd & Schofield (1997)',
  delphi: 'Wideband Delphi; Boehm (1981)',
  shrinkage: 'Spolsky (2007), evidence-based scheduling; Efron & Morris (1975)',
  pert: 'Malcolm, Roseboom, Clark & Fazar (1959)',
  monteCarlo: 'Metropolis & Ulam (1949)',
  brooks: 'Brooks (1975), The Mythical Man-Month',
  buffer: 'Goldratt (1997), critical chain; Newbold (1998), root-square method',
  voi: 'Howard (1966), information value theory',
  accuracy: 'Conte, Dunsmore & Shen (1986)',
  confidence: 'Scopewise rule of thumb (P80/P50 spread and open questions)',
} as const;

export function explain(e: Explanation): Explanation {
  return e;
}
