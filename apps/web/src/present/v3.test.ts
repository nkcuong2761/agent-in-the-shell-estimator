import { describe, expect, it } from 'vitest';
import { categoryLabel } from '../lib/categories';
import { bufferFactor, focusFactorFor, learnedPolicy, resolvePolicy, startingTeam } from '../state/policy';
import { fmtNum, halfWeeks, rolePhrase, sd, teamPhrase } from './format';
import { progressLine } from './progress';

describe('comma halves', () => {
  it('writes halves as 16,5 and never with the ½ sign', () => {
    expect(sd(81.4)).toBe('16,5 weeks');
    expect(sd(5)).toBe('1 week');
    expect(sd(7.6)).toBe('1,5 weeks');
    expect(sd(3)).toBe('a few days');
    expect(halfWeeks(81.4)).toBe(16.5);
    expect(fmtNum(0.75)).toBe('0,75');
    expect(fmtNum(2)).toBe('2');
  });
  it('names part-time roles', () => {
    expect(rolePhrase('engineer', 0.5)).toBe('0,5 developer (part-time)');
    expect(rolePhrase('engineer', 1.5)).toBe('1,5 developers, one part-time');
    expect(teamPhrase({ engineer: 2, qa: 1 })).toBe('2 developers and 1 tester');
  });
});

describe('category labels', () => {
  it('maps project types to short labels', () => {
    expect(categoryLabel('form-digitization')).toBe('Form');
    expect(categoryLabel('integration')).toBe('Integration');
    expect(categoryLabel(undefined)).toBe('Uncategorised');
    expect(categoryLabel('weird')).toBe('Uncategorised');
  });
});

describe('working-hours policy', () => {
  const stats = { focusFactor: 0.76, absenceRate: 0.08, coordinationOverheadPerExtra: 0.1 };
  const conv = { createdAt: '2026-10-20T09:00:00.000Z' };
  it('learns hours a day from the squad: round(6 × focus × 2) / 2', () => {
    expect(learnedPolicy(stats)).toEqual({ hpd: 4.5, dpw: 5, source: 'learned' });
    expect(learnedPolicy(undefined)).toEqual({ hpd: 7, dpw: 5, source: 'fallback' });
  });
  it('resolves estimate → default (if created after it) → learned → fallback', () => {
    const saved = { hpd: 6, dpw: 4, at: '2026-10-19T00:00:00.000Z' };
    expect(resolvePolicy({ hoursPerDay: 8, daysPerWeek: 3 }, conv, stats, saved)).toMatchObject({ hpd: 8, dpw: 3, source: 'estimate' });
    expect(resolvePolicy({}, conv, stats, saved)).toMatchObject({ hpd: 6, dpw: 4, source: 'default' });
    expect(resolvePolicy({}, { createdAt: '2026-10-01T00:00:00.000Z' }, stats, saved)).toMatchObject({ source: 'learned' });
    expect(resolvePolicy({}, conv, stats, null)).toMatchObject({ hpd: 4.5, source: 'learned' });
    expect(resolvePolicy({}, conv, undefined, null)).toMatchObject({ hpd: 7, dpw: 5, source: 'fallback' });
  });
  it('turns a policy into a focus factor, skipping the override for learned hours', () => {
    expect(focusFactorFor({ hpd: 6, dpw: 5, source: 'estimate' }, stats)).toBeCloseTo(1);
    expect(focusFactorFor({ hpd: 3, dpw: 5, source: 'estimate' }, stats)).toBeCloseTo(0.5);
    expect(focusFactorFor(learnedPolicy(stats), stats)).toBeUndefined();
  });
});

describe('risks and buffer', () => {
  it('f = (P50 + risks + P50 × pct) / P50', () => {
    expect(bufferFactor(400, [{ label: 'Sandbox late', h: 20 }], 15)).toBeCloseTo((400 + 20 + 60) / 400);
    expect(bufferFactor(400, [], undefined)).toBe(1);
    expect(bufferFactor(0, [{ label: 'x', h: 5 }], 10)).toBe(1);
  });
});

describe('default team', () => {
  it('starts from 1 per needed role, or the saved default for the category', () => {
    expect(startingTeam('integration', ['pm', 'engineer', 'qa'], {})).toEqual({ pm: 1, engineer: 1, qa: 1 });
    expect(startingTeam('integration', ['pm', 'engineer', 'qa'], { integration: { engineer: 2, designer: 1 } })).toEqual({ pm: 1, engineer: 2, qa: 1, designer: 1 });
  });
});

describe('sidebar progress', () => {
  it('before, during and after the plan', () => {
    expect(progressLine('ready', '2026-10-26', 60, '2026-10-18')).toEqual({ text: 'Not started · starts Mon 26 Oct', tone: 'muted' });
    const during = progressLine('ready', '2026-10-26', 60, '2026-12-09');
    expect(during.text).toBe('Week 7 of 12 · 55%');
    expect(during.pct).toBeCloseTo(33 / 60);
    expect(progressLine('ready', '2026-10-26', 60, '2027-03-01')).toMatchObject({ text: 'Past the planned finish', tone: 'warning' });
    expect(progressLine('working', '2026-10-26', undefined, '2026-10-18').text).toBe('Estimating…');
  });
});
