import { describe, expect, it } from 'vitest';
import { samples } from '../lib/data';
import { suggestedOpportunities, suggestedRisks } from './adjustments';

const scope = samples.find((s) => s.meta.id === 'fund-admin-sync')!.cache.scope;

describe('quick-pick adjustments', () => {
  it('history risks come first with hours from likelihood × the middle of the range, then the fixed ones', () => {
    const risks = suggestedRisks(scope, 400, 25);
    const n = scope.scopeRisks.length;
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const r = scope.scopeRisks[i]!;
      const mid = (r.addedHoursRange[0] + r.addedHoursRange[1]) / 2;
      expect(risks[i]!.id).toBe(r.id);
      expect(risks[i]!.h).toBe(Math.max(5, Math.round((r.likelihood * mid) / 5) * 5));
      expect(risks[i]!.why).toMatch(/similar projects/);
      expect(risks[i]!.h).toBeGreaterThan(0);
    }
    expect(risks.length).toBeGreaterThan(n);
    expect(risks.find((r) => r.id === 'risk-away')!.h).toBe(25);
    expect(risks.find((r) => r.id === 'risk-change')!.h).toBe(40);
  });

  it('opportunities are negative and scale with the effort', () => {
    const small = suggestedOpportunities(scope, 200);
    const big = suggestedOpportunities(scope, 400);
    for (const o of big) expect(o.h).toBeLessThan(0);
    expect(big.find((o) => o.id === 'opp-drop')!.h).toBe(-30);
    expect(Math.abs(big.find((o) => o.id === 'opp-reuse')!.h)).toBeGreaterThanOrEqual(Math.abs(small.find((o) => o.id === 'opp-reuse')!.h));
    expect(big.some((o) => o.id === 'opp-testdata')).toBe(scope.items.some((i) => i.category === 'qa'));
  });
});
