import type { Category, Estimate, ScopeResult } from '@scopewise/shared';
import { CATEGORY_WORDS } from '../copy';
import { formatSpan } from './format';
import { hoursToScheduleDays } from './headline';

export interface WhyGroups {
  /** "Why 365 working hours" */
  hours: string[];
  /** "Why 'Not sure yet'" */
  confidence: string[];
  /** "Surprises seen on similar projects" */
  surprises: string[];
}

const round5 = (h: number) => Math.round(h / 5) * 5;

/** Template bullets over engine output (never written by the language model). */
export function toWhy(est: Estimate, scope: ScopeResult, observedBias?: ReadonlyMap<Category, number>): WhyGroups {
  const hours: string[] = [];
  const ref = est.referenceClass;
  if (ref.n >= 2) hours.push(`Past work: ${ref.n} similar projects you finished took ${round5(ref.p20)}–${round5(ref.p80)} working hours.`);

  const cats = new Map<Category, { bias: number; hours: number }>();
  for (const c of est.items) {
    const e = cats.get(c.category) ?? { bias: observedBias?.get(c.category) ?? c.biasFactor, hours: 0 };
    e.hours += c.p50;
    cats.set(c.category, e);
  }
  const ranked = [...cats.entries()].filter(([, v]) => v.hours > 0).sort((a, b) => b[1].bias - a[1].bias);
  const over = ranked.find(([, v]) => v.bias >= 1.15);
  const under = [...ranked].reverse().find(([, v]) => v.bias <= 0.9);
  if (over) hours.push(`Your track record: “${CATEGORY_WORDS[over[0]]}” work usually takes longer than planned, so it gets extra hours.`);
  else if (under) hours.push(`Your track record: “${CATEGORY_WORDS[under[0]]}” work usually comes in quicker than planned, so it gets fewer hours.`);
  else hours.push('Your track record: this kind of work usually comes in close to plan, so the hours are taken as they are.');
  hours.push('No buffer: the number is pure working time. How many weeks it takes depends on your team and working week below.');

  const confidence: string[] = [];
  const open = est.rankedQuestions.length;
  const top = est.rankedQuestions[0];
  if (open && top) {
    confidence.push(
      `${open} open question${open === 1 ? '' : 's'} could still move this by up to ${formatSpan(hoursToScheduleDays(est, top.narrowsByH))}. Get answers to the questions in “Ask the client before you commit” and confidence goes up.`,
    );
  } else confidence.push('No open questions are left. What remains is ordinary day-to-day uncertainty.');
  const spread = est.finishDays.p80 - est.finishDays.p50;
  confidence.push(`In most simulated runs the work finished within ${formatSpan(spread)} of the most likely date.`);

  const surprises = scope.scopeRisks.map((r) => r.description);
  return { hours, confidence, surprises };
}
