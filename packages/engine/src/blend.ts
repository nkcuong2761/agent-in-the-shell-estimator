import { CITATIONS, type Explained } from './explain';
import { median, round } from './stats';

export const BLEND_PRIOR = 3;

export interface BlendedItem {
  o: number;
  m: number;
  p: number;
  weight: number;
  analogMedian: number | null;
}

/**
 * Blend the (bias-corrected) panel guess with the median of analog actuals:
 * m' = w · median(analog actuals) + (1 − w) · r_c · m_panel, where w = n / (n + 3).
 * Bias correction applies to the panel part only: analog actuals are already actuals, so correcting
 * them again would double-count. o and p keep their shape relative to m.
 */
export function blendItem(
  panel: { o: number; m: number; p: number },
  analogActuals: readonly number[],
  biasFactor: number,
): Explained<BlendedItem> {
  const n = analogActuals.length;
  const w = n / (n + BLEND_PRIOR);
  const am = n > 0 ? median(analogActuals) : null;
  const correctedM = panel.m * biasFactor;
  const m = am === null ? correctedM : w * am + (1 - w) * correctedM;
  const scale = panel.m > 0 ? m / panel.m : biasFactor;
  const o = Math.min(panel.o * scale, m);
  const p = Math.max(panel.p * scale, m);
  return {
    value: { o: round(o, 2), m: round(m, 2), p: round(p, 2), weight: round(w, 3), analogMedian: am === null ? null : round(am, 2) },
    explanation: {
      method: 'Blend panel with history, then bias-correct',
      citation: `${CITATIONS.analogy}; ${CITATIONS.shrinkage}`,
      plainWords:
        am === null
          ? `No similar past items, so the panel's ${round(panel.m)}h is used, scaled ×${round(biasFactor, 2)} for category bias.`
          : `${Math.round(w * 100)}% weight on what ${n} similar items actually took (median ${round(am)}h), ${Math.round((1 - w) * 100)}% on the panel's ${round(panel.m)}h after a ×${round(biasFactor, 2)} bias correction, giving ${round(m)}h.`,
      formula: "m' = w·median(analogs) + (1−w)·r_c·m_panel; w = n/(n+3); o', p' scaled by m'/m",
      inputs: {
        mPanel: round(panel.m, 2),
        analogMedian: am === null ? 'none' : round(am, 2),
        n,
        w: round(w, 3),
        biasFactor: round(biasFactor, 4),
        mBlended: round(m, 2),
      },
    },
  };
}
