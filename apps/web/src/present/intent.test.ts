import { describe, expect, it } from 'vitest';
import { samples } from '../lib/data';
import { parseDate, parseIntent, type IntentContext } from './intent';

const scope = samples.find((s) => s.meta.id === 'subscription-form')!.cache.scope;
const ctx: IntentContext = { scope, team: { pm: 1, legal: 1, engineer: 1, qa: 1 }, refDate: '2026-10-26' };

describe('parseDate', () => {
  it('reads common date forms and picks the next occurrence', () => {
    expect(parseDate('can we finish by 30 Nov?', '2026-10-26')).toBe('2026-11-30');
    expect(parseDate('by December 11th', '2026-10-26')).toBe('2026-12-11');
    expect(parseDate('done by Fri 29 Jan', '2026-10-26')).toBe('2027-01-29');
    expect(parseDate('2026-12-01', '2026-10-26')).toBe('2026-12-01');
    expect(parseDate('no date here', '2026-10-26')).toBeUndefined();
  });
});

describe('parseIntent', () => {
  it('team what-ifs', () => {
    const a = parseIntent('What if we add another developer?', ctx);
    expect(a).toMatchObject({ kind: 'team_what_if', team: { engineer: 2 }, label: 'With 2 developers' });
    expect(parseIntent('what if 2 testers', ctx)).toMatchObject({ kind: 'team_what_if', team: { qa: 2 } });
    expect(parseIntent('add 2 more developers', ctx)).toMatchObject({ kind: 'team_what_if', team: { engineer: 3 } });
  });
  it('dropping a stage', () => {
    const d = parseIntent('what if we skip the legal check', ctx);
    expect(d.kind).toBe('drop_what_if');
    if (d.kind === 'drop_what_if') expect(d.itemIds).toEqual(scope.items.filter((i) => i.phaseId === 'legal-review').map((i) => i.id));
    expect(parseIntent('what if we skip QA', ctx)).toMatchObject({ kind: 'drop_what_if', what: 'qa' });
  });
  it('deadline checks', () => {
    expect(parseIntent('Can we finish by 30 Nov?', ctx)).toEqual({ kind: 'deadline_check', date: '2026-11-30' });
  });
  it('explanations', () => {
    expect(parseIntent('why is building the form so long?', ctx)).toEqual({ kind: 'explain', phaseId: 'build-form' });
  });
  it('new information answers the matching question', () => {
    const n = parseIntent('the client says no e-signing needed, they will print and sign', ctx);
    expect(n.kind).toBe('new_info');
    if (n.kind === 'new_info') expect(n.questionIds[0]).toBe('q-signature');
  });
  it('anything else', () => {
    expect(parseIntent('tell me a joke', ctx)).toEqual({ kind: 'other' });
  });
});
