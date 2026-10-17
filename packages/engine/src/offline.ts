import type { ItemAnalogs, PanelAgent, PanelResult, Persona, ScopeResult, WorkItem } from '@scopewise/shared';
import { DISAGREEMENT_CV } from './panel';
import { mulberry32, normal, subSeed } from './prng';
import { coefficientOfVariation, median, round } from './stats';

/**
 * Deterministic stand-in for the three-persona Claude panel, used when no API key is available
 * (demo cache generation, tests). Outputs are labelled `offline-heuristic` wherever they appear.
 * Each persona applies a fixed lens to the scope agent's guess and the analog actuals.
 */
export const OFFLINE_PANEL_VERSION = 'offline-heuristic-panel@1';

const PERSONAS: Persona[] = ['delivery-lead', 'qa-lead', 'domain-expert'];
const QA_HEAVY = new Set(['qa', 'integration', 'forms', 'esign', 'backend', 'data']);
const DOMAIN_HEAVY = new Set(['legal', 'integration', 'esign', 'forms', 'data']);

interface Lens {
  m: number;
  o: number;
  p: number;
  reason: string;
}

function lens(persona: Persona, item: WorkItem, anchor: number | null, n: number): Lens {
  const base = item.m;
  const a = anchor ?? base;
  const questions = item.affectedByQuestions.length;
  switch (persona) {
    case 'delivery-lead': {
      const m = (0.6 * base + 0.4 * a) * 0.95;
      return {
        m,
        o: m * 0.8,
        p: m * 1.45,
        reason:
          anchor === null
            ? `Planned as scoped; no close past match, so I kept it near the brief's size.`
            : `Anchored on ${n} similar past item${n === 1 ? '' : 's'} (median ${round(a)}h) and the plan as scoped.`,
      };
    }
    case 'qa-lead': {
      const heavy = QA_HEAVY.has(item.category);
      const m = (0.5 * base + 0.5 * a) * (heavy ? 1.15 : 1.02);
      return {
        m,
        o: m * 0.8,
        p: m * (heavy ? 1.75 : 1.5),
        reason: heavy
          ? `Test surface is wide here (${item.category}); I allowed for a second pass after fixes.`
          : 'Low test surface; small allowance for review and fixes.',
      };
    }
    case 'domain-expert': {
      const heavy = DOMAIN_HEAVY.has(item.category);
      const factor = 1 + 0.12 * questions + (heavy ? 0.12 : 0);
      const m = (0.55 * base + 0.45 * a) * factor;
      return {
        m,
        o: m * 0.78,
        p: m * (1.5 + 0.2 * questions),
        reason:
          questions > 0
            ? `Depends on ${questions} open question${questions === 1 ? '' : 's'}; the answer could change what gets built.`
            : heavy
              ? 'Rules in this area tend to surface late; I added room for rework.'
              : 'Well understood work; little domain risk.',
      };
    }
  }
}

export function offlinePanel(scope: ScopeResult, analogs: readonly ItemAnalogs[], seed = 7): PanelResult {
  const rng = mulberry32(subSeed(seed, scope.items.map((i) => i.id).join('|')));
  const anchors = new Map(
    analogs.map((a) => [a.itemId, a.matches.length ? { m: median(a.matches.map((x) => x.actualH)), n: a.matches.length } : null]),
  );
  const round1: PanelAgent[] = PERSONAS.map((persona) => ({ persona, items: [] }));
  const round2: PanelAgent[] = PERSONAS.map((persona) => ({ persona, items: [] }));
  const flags: string[] = [];
  for (const item of scope.items) {
    const anchor = anchors.get(item.id) ?? null;
    const lenses = PERSONAS.map((p) => lens(p, item, anchor?.m ?? null, anchor?.n ?? 0));
    // Round 1: independent guesses with estimator noise.
    const r1 = lenses.map((l) => {
      const k = Math.max(0.55, 1 + 0.18 * normal(rng));
      return { ...l, m: l.m * k, o: l.o * k, p: l.p * k };
    });
    const mid = median(r1.map((g) => g.m));
    // Round 2: after reading each other's reasons, each persona moves halfway toward the group median.
    const r2 = r1.map((g, i) => {
      const keep = PERSONAS[i] === 'domain-expert' && item.affectedByQuestions.length >= 2 ? 0.8 : 0.5;
      const m = keep * g.m + (1 - keep) * mid;
      const s = m / g.m;
      return { ...g, m, o: g.o * s, p: g.p * s };
    });
    PERSONAS.forEach((_, i) => {
      const g1 = r1[i] as Lens;
      const g2 = r2[i] as Lens;
      (round1[i] as PanelAgent).items.push({ itemId: item.id, o: round(g1.o), m: round(g1.m), p: round(g1.p), reason: g1.reason });
      (round2[i] as PanelAgent).items.push({ itemId: item.id, o: round(g2.o), m: round(g2.m), p: round(g2.p), reason: g2.reason });
    });
    if (coefficientOfVariation(r2.map((g) => g.m)) > DISAGREEMENT_CV) flags.push(item.id);
  }
  return { agents: round2, round1, rounds: 2, disagreementFlags: flags };
}
