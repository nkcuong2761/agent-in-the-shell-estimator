import { describe, expect, it } from 'vitest';
import type { Estimate, ScopeResult, TeamShape } from '@scopewise/shared';
import { backtest, prepareEstimate, runEstimate } from '@scopewise/engine';
import { samples, seed } from '../lib/data';
import { BANNED_TERMS } from '../copy';
import {
  chanceWords,
  formatDate,
  formatDuration,
  formatWeeks,
  howSure,
  teamPhrase,
  toComparison,
  toHeadline,
  toImprovement,
  toOutcome,
  toQuestions,
  toStages,
  toSuggestions,
  toWhy,
  weeksRange,
} from '.';
import { defaultTeam, observedBias } from '../state/engine';

function sampleEstimate(id: string, team?: TeamShape): { est: Estimate; scope: ScopeResult; team: TeamShape } {
  const s = samples.find((x) => x.meta.id === id)!;
  const squad = seed.squads.find((q) => q.id === s.meta.squad)!;
  const scope = s.cache.scope;
  const t = team ?? defaultTeam(scope);
  const prep = prepareEstimate({ scope, panel: s.cache.panel, history: seed, squad: squad.stats, plannedLeave: squad.plannedLeave, teamShape: t, startDate: s.meta.startDate, deadline: s.meta.clientDeadline });
  return { est: runEstimate(prep), scope, team: t };
}

const noBanned = (text: string) =>
  BANNED_TERMS.forEach((t) => expect((/^[A-Z0-9]+$/.test(t) ? new RegExp(`\\b${t}\\b`) : new RegExp(t, 'i')).test(text), t).toBe(false));

describe('format', () => {
  it('formats dates as "Fri 4 Dec"', () => {
    expect(formatDate('2026-12-04')).toBe('Fri 4 Dec');
  });
  it('describes durations in plain words, to the nearest half week', () => {
    expect(formatDuration(3)).toBe('a few days');
    expect(formatDuration(5)).toBe('1 week');
    expect(formatDuration(7.6)).toBe('1,5 weeks');
    expect(formatDuration(10)).toBe('2 weeks');
  });
  it('rounds the week range: low to the nearest week, high up', () => {
    expect(weeksRange(29, 36)).toEqual({ low: 6, high: 8 });
    expect(weeksRange(2, 3)).toEqual({ low: 1, high: 1 });
    expect(formatWeeks(6, 8)).toBe('6–8 weeks');
  });
  it('names the team in plain words', () => {
    expect(teamPhrase({ designer: 1, engineer: 2, qa: 1 })).toBe('1 designer, 2 developers and 1 tester');
  });
  it('turns probabilities into words', () => {
    expect(chanceWords(0.33)).toBe('About a 1 in 3 chance');
    expect(chanceWords(0.97)).toBe('Almost certain');
  });
  it('maps confidence to "How sure am I?"', () => {
    expect(howSure('High')).toEqual({ label: 'Very sure', bars: 3 });
    expect(howSure('Medium')).toEqual({ label: 'Fairly sure', bars: 2 });
    expect(howSure('Low')).toEqual({ label: 'Not sure yet', bars: 1 });
  });
});

describe('estimate presentation', () => {
  const { est, scope, team } = sampleEstimate('subscription-form');

  it('headline: weeks range, dates, margin and how sure, with no jargon', () => {
    const h = toHeadline(est, team);
    expect(h.range).toMatch(/^\d+–\d+ weeks$|^\d+ weeks?$/);
    expect(h.mostLikely).toBe(formatDate(est.p50Date));
    expect(h.safeDate).toBe(formatDate(est.commitDate));
    expect(h.team).toContain('developer');
    expect(h.openQuestions).toBeGreaterThan(0);
    noBanned(JSON.stringify(h));
  });

  it('stages: one row per phase, items listed, then the safety margin', () => {
    const s = toStages(est, scope, observedBias());
    expect(s.rows.map((r) => r.id)).toEqual(est.perPhase.map((p) => p.phaseId));
    expect(s.rows.flatMap((r) => r.items)).toHaveLength(scope.items.length);
    expect(s.rows[0]?.items[0]?.hours).toMatch(/^about \d+(–\d+)? hours$/);
    expect(s.rows[0]?.items[0]?.sources[0]?.label).toBe('Client email');
    // Integration work runs long in history.
    expect(s.rows.find((r) => r.id === 'integration')?.runsLong).toBe(true);
  });

  it('questions: top 3 by value, with scope-risk evidence where it fits', () => {
    const q = toQuestions(est, scope);
    expect(q).toHaveLength(3);
    expect(q.map((x) => x.questionId)).toEqual(est.rankedQuestions.slice(0, 3).map((r) => r.questionId));
    expect(q.some((x) => /similar projects added e-signature/.test(x.reason))).toBe(true);
    noBanned(JSON.stringify(q));
  });

  it('why: two labelled groups of template bullets plus the surprises', () => {
    const w = toWhy(est, scope, observedBias());
    expect(w.hours).toHaveLength(3);
    expect(w.hours[0]).toMatch(/^Past work: \d+ similar projects you finished took \d+–\d+ working hours\.$/);
    expect(w.hours[1]).toMatch(/^Your track record:/);
    expect(w.hours[2]).toMatch(/^No buffer: the number is pure working time/);
    expect(w.confidence[0]).toMatch(/open questions? could still move this by up to .* and confidence goes up\.$/);
    expect(w.surprises.length).toBeGreaterThan(0);
    // "buffer" is allowed in exactly this sentence, which the screen test skips via its own wording check.
    noBanned([...w.hours.slice(0, 2), ...w.confidence, ...w.surprises].join(' '));
  });

  it('comparison: adding a developer finishes sooner and costs a little more time', () => {
    const more = sampleEstimate('subscription-form', { ...team, engineer: 2 }).est;
    const c = toComparison(est, more, 'because two developers need time to coordinate');
    expect(c.summary).toMatch(/sooner/);
    expect(c.summary).toMatch(/more time in total, because two developers/);
    expect(c.rows.map((r) => r.label)).toEqual(['Takes about', 'Most likely finished', 'Safe date to promise', 'Total team time']);
    expect(c.rows[3]?.proposed).toMatch(/% more/);
  });

  it('suggestions: team, longest stage, deadline', () => {
    const s = toSuggestions(est, '2027-01-29');
    expect(s[0]).toBe('What if we add another developer?');
    expect(s[1]).toMatch(/^Why does .+ take so long\?$/);
    expect(s[2]).toBe('Can we finish by Fri 29 Jan?');
  });
});

describe('finished projects', () => {
  const r = backtest(seed, { runs: 150 }).value;
  it('outcome compares the weeks we said with the weeks it took', () => {
    const p = r.points[10]!;
    const project = seed.projects.find((x) => x.id === p.projectId)!;
    const o = toOutcome(project, p);
    expect(o.said.low).toBeLessThanOrEqual(o.said.high);
    expect(o.sentence).toMatch(/^We said \d+(–\d+)? weeks?\. It (took \d+ weeks?|finished on time)\.$/);
  });
  it('improvement sentence is computed from the backtest', () => {
    const pt = r.points[3]!;
    const project = seed.projects.find((x) => x.id === pt.projectId)!;
    const imp = toImprovement(r.points, { project, point: pt, outcome: toOutcome(project, pt) });
    expect(imp.bars).toHaveLength(r.points.length);
    expect(imp.bars.filter((b) => b.highlight)).toHaveLength(1);
    expect(imp.detail).toMatch(/^This project: we would have said \d+ hours and it took \d+, \d+% off\./);
    expect(imp.sentence).toMatch(/^Early estimates were off by about \d+%\. The last five were off by about \d+%\.$/);
  });
});
