/**
 * Quick-pick opportunities and risks for the Schedule section. Risks come first from the scope's own
 * "surprises seen on similar projects" (hours = likelihood × the middle of the hours they cost before), then a
 * short fixed list sized from this estimate's effort. Opportunities are a fixed list sized the same way. Each
 * pick is stored on the spec as a signed `BufferRisk` (+h risk, −h opportunity) keyed by its id.
 */
import type { BufferRisk, Category, ScopeResult, ScopeRisk } from '@scopewise/shared';
import { copy } from '../copy';
import { riskEvidence, riskTitle } from './questions';

export interface Suggestion {
  id: string;
  label: string;
  /** Signed hours: positive adds time, negative takes it off. */
  h: number;
  /** Where the number comes from, for a tooltip; absent for the fixed list. */
  why?: string;
}

const round5 = (h: number) => Math.max(5, Math.round(h / 5) * 5);

const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'to', 'and', 'or', 'in', 'on', 'with', 'step', 'after', 'kickoff']);
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
const overlaps = (a: string, b: string) => [...words(a)].some((w) => words(b).has(w));

/** Hours of the items in these categories, as a share of the whole; falls back to the whole when the scope has none. */
function shareOf(scope: ScopeResult, effortH: number, categories: readonly Category[]): number {
  const all = scope.items.reduce((s, i) => s + i.m, 0);
  const part = scope.items.filter((i) => categories.includes(i.category)).reduce((s, i) => s + i.m, 0);
  return all > 0 && part > 0 ? (effortH * part) / all : 0;
}

const BUILD: Category[] = ['backend', 'frontend', 'integration', 'data', 'devops', 'forms', 'esign', 'notifications', 'reporting'];

export function suggestedRisks(scope: ScopeResult, effortH: number, hoursPerWeek: number): Suggestion[] {
  const out: Suggestion[] = scope.scopeRisks.map((r: ScopeRisk) => ({
    id: r.id,
    label: riskTitle(r),
    h: round5(r.likelihood * ((r.addedHoursRange[0] + r.addedHoursRange[1]) / 2)),
    why: riskEvidence(r),
  }));
  const fixed: Suggestion[] = [
    { id: 'risk-access', label: copy.riskFixed.access, h: round5(effortH * 0.08) },
    { id: 'risk-away', label: copy.riskFixed.away, h: round5(hoursPerWeek) },
    { id: 'risk-reviews', label: copy.riskFixed.reviews, h: round5(effortH * 0.06) },
    { id: 'risk-change', label: copy.riskFixed.change, h: round5(effortH * 0.1) },
    { id: 'risk-compliance', label: copy.riskFixed.compliance, h: round5(effortH * 0.05) },
  ];
  for (const f of fixed) if (!out.some((r) => overlaps(r.label, f.label))) out.push(f);
  return out;
}

export function suggestedOpportunities(scope: ScopeResult, effortH: number): Suggestion[] {
  const build = shareOf(scope, effortH, BUILD) || effortH;
  const qa = shareOf(scope, effortH, ['qa']);
  const design = shareOf(scope, effortH, ['design']);
  const out: Suggestion[] = [
    { id: 'opp-reuse', label: copy.oppFixed.reuse, h: -round5(build * 0.1) },
    { id: 'opp-drop', label: copy.oppFixed.drop, h: -round5(effortH * 0.08) },
    { id: 'opp-experience', label: copy.oppFixed.experience, h: -round5(effortH * 0.06) },
    { id: 'opp-decisions', label: copy.oppFixed.decisions, h: -round5(effortH * 0.04) },
  ];
  if (qa > 0) out.splice(1, 0, { id: 'opp-testdata', label: copy.oppFixed.testdata, h: -round5(qa * 0.05 + effortH * 0.01) });
  if (design > 0) out.push({ id: 'opp-design', label: copy.oppFixed.design, h: -round5(design * 0.05 + effortH * 0.01) });
  return out;
}

/** Picked suggestions plus any custom entries, as the spec stores them. */
export function pickedFrom(risks: readonly BufferRisk[] | undefined): Set<string> {
  return new Set((risks ?? []).map((r) => r.id).filter((id): id is string => !!id));
}
