import { describe, expect, it } from 'vitest';
import type { Conversation, EstimateSpec } from '@scopewise/shared';
import { samples } from '../lib/data';
import { defaultTeam, estimateFor, planOf } from './engine';

function conv(sampleId: string): Conversation {
  const s = samples.find((x) => x.meta.id === sampleId)!;
  return {
    id: `t-${sampleId}`,
    title: s.meta.title,
    createdAt: '2026-10-14T09:30:00.000Z',
    updatedAt: '2026-10-14T09:30:00.000Z',
    status: 'ready',
    brief: s.brief,
    sampleId,
    squadId: s.meta.squad,
    messages: [],
    versions: {},
    currentEstimateId: '',
    team: defaultTeam(s.cache.scope),
    startDate: s.meta.startDate,
    clientDeadline: s.meta.clientDeadline,
  };
}

const spec = (c: Conversation, patch: Partial<EstimateSpec> = {}): EstimateSpec => ({ team: c.team, answeredQuestionIds: [], droppedItemIds: [], startDate: c.startDate, deadline: c.clientDeadline, ...patch });

describe('working time', () => {
  const c = conv('fund-admin-sync');
  it('does not change with the start date, even when planned leave falls in the window', () => {
    const a = planOf(c, spec(c, { startDate: '2026-10-26' }))!;
    const b = planOf(c, spec(c, { startDate: '2027-03-01' }))!;
    expect(a.planDays).toBeCloseTo(b.planDays, 6);
    // The real finish for the October start includes the squad's planned leave, so it is longer than the plan.
    const real = estimateFor(c, spec(c, { startDate: '2026-10-26' }), { quick: true })!;
    expect(real.finishDays.p50).toBeGreaterThan(a.planDays);
    expect(a.effortH % 5).toBe(0);
  });
});

describe('fractional team', () => {
  const c = conv('fund-admin-sync');
  it('half a developer roughly doubles the weeks with the same hours; a second developer lowers weeks and raises hours', () => {
    const one = planOf(c, spec(c))!;
    const half = planOf(c, spec(c, { team: { ...c.team, engineer: 0.5 } }))!;
    const two = planOf(c, spec(c, { team: { ...c.team, engineer: 2 } }))!;
    expect(half.effortH).toBe(one.effortH);
    expect(half.planDays / one.planDays).toBeGreaterThan(1.5);
    expect(two.planDays).toBeLessThan(one.planDays);
    expect(two.effortH).toBeGreaterThan(one.effortH);
    const q = planOf(c, spec(c, { team: { ...c.team, engineer: 0.75 } }))!;
    expect(q.planDays).toBeGreaterThan(one.planDays);
    expect(q.planDays).toBeLessThan(half.planDays);
  });
});

describe('risks and buffer', () => {
  const c = conv('fund-admin-sync');
  it('stretches the time but leaves the effort untouched', () => {
    const base = planOf(c, spec(c))!;
    const buffered = planOf(c, spec(c, { risks: [{ label: 'Sandbox arrives late', h: 25 }], bufferPct: 15 }))!;
    expect(buffered.effortH).toBe(base.effortH);
    expect(buffered.f).toBeGreaterThan(1.15);
    // planDays is pure (divided by f); the real run is longer by f.
    expect(buffered.planDays).toBeCloseTo(base.planDays, 1);
    const realA = estimateFor(c, spec(c), { quick: true })!;
    const realB = estimateFor(c, spec(c, { risks: [{ label: 'Sandbox arrives late', h: 25 }], bufferPct: 15 }), { quick: true })!;
    expect(realB.finishDays.p50 / realA.finishDays.p50).toBeGreaterThan(1.1);
    expect(Math.round(realB.total.p50 / 5) * 5).toBe(Math.round(realA.total.p50 / 5) * 5);
  });
});

describe('working-hours policy', () => {
  const c = conv('investor-reminders');
  it('fewer hours a day means more weeks, same hours', () => {
    const base = planOf(c, spec(c))!;
    const short = planOf(c, spec(c, { hoursPerDay: 3, daysPerWeek: 5 }))!;
    expect(short.effortH).toBe(base.effortH);
    expect(short.planDays).toBeGreaterThan(base.planDays * 1.3);
  });
});

describe('covered roles', () => {
  const c = conv('subscription-form');
  it('a role with nobody on the team can be covered by another role', () => {
    // With nobody in a role the engine borrows one person; covering it with two developers runs the testing in parallel.
    const borrowed = planOf(c, spec(c, { team: { ...c.team, engineer: 2, qa: 0 } }))!;
    const covered = planOf(c, spec(c, { team: { ...c.team, engineer: 2, qa: 0 }, coveredRoles: { qa: 'engineer' } }))!;
    expect(covered.effortH).toBeGreaterThan(0);
    expect(covered.planDays).toBeLessThan(borrowed.planDays);
  });
});
