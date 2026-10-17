import type { Category, Estimate, HistoryProject, SquadStats } from '@scopewise/shared';
import { CATEGORY_WORDS } from '../copy';
import { quantile } from '@scopewise/engine';

const weeksBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (7 * 864e5);

/** 3–4 plain bullets, built from templates over engine output (never by the language model). */
export function toWhyBullets(est: Estimate, projects: readonly HistoryProject[], squad: SquadStats, observedBias?: ReadonlyMap<Category, number>): string[] {
  const out: string[] = [];
  const ref = projects.filter((p) => est.referenceClass.projectIds.includes(p.id));
  if (ref.length >= 2) {
    const weeks = ref.map((p) => weeksBetween(p.startDate, p.endDate));
    const lo = Math.max(1, Math.round(quantile(weeks, 0.2)));
    const hi = Math.max(lo, Math.round(quantile(weeks, 0.8)));
    out.push(`${ref.length} similar projects we finished took between ${lo} and ${hi} weeks.`);
  }

  // The kind of work we most often get wrong, among the kinds in this brief.
  const cats = new Map<Category, { bias: number; hours: number }>();
  for (const c of est.items) {
    const e = cats.get(c.category) ?? { bias: observedBias?.get(c.category) ?? c.biasFactor, hours: 0 };
    e.hours += c.p50;
    cats.set(c.category, e);
  }
  const ranked = [...cats.entries()].filter(([, v]) => v.hours > 0).sort((a, b) => b[1].bias - a[1].bias);
  const over = ranked.find(([, v]) => v.bias >= 1.15);
  const under = [...ranked].reverse().find(([, v]) => v.bias <= 0.9);
  if (over) out.push(`We usually underestimate “${CATEGORY_WORDS[over[0]]}” work, so I've allowed extra time for it.`);
  else if (under) out.push(`“${CATEGORY_WORDS[under[0]]}” work usually comes in quicker than planned, so I've trimmed it a little.`);

  const focus = Math.round(squad.focusFactor * 10);
  out.push(`Your team spends about ${focus} of every 10 work hours on project work, so a 40-hour week counts as ${Math.round(40 * squad.focusFactor)}.`);

  out.push(
    est.rankedQuestions.length
      ? 'The safety margin covers the open questions and the usual time off.'
      : 'The safety margin covers the usual time off and the small surprises every project has.',
  );
  return out;
}
