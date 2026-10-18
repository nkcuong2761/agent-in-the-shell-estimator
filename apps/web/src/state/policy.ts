/**
 * Per-estimate inputs that are not part of the scope: the working-hours policy, the default team per category,
 * the risks-and-buffer factor and the realistic-forecast inclusion flags. Pure functions plus storage keys.
 */
import type { BufferRisk, Role, SquadStats, TeamShape } from '@scopewise/shared';
import { HOURS_PER_DAY } from '@scopewise/engine';
import { readStore } from '../lib/storage';

export const HOURS_DEF_KEY = 'sw-hours-def.v1';
export const TEAM_DEF_KEY = 'sw-team-def.v1';
export const FORECAST_KEY = 'sw-forecast.v1';
export const CY = HOURS_PER_DAY;

export interface HoursDefault {
  dpw: number;
  hpd: number;
  /** ISO time it was saved; it applies to estimates created after this. */
  at: string;
}
export type TeamDefaults = Record<string, Partial<Record<Role, number>>>;
export interface ForecastFlags {
  leave: boolean;
  hist: boolean;
  buf: boolean;
}

export type PolicySource = 'estimate' | 'default' | 'learned' | 'fallback';
export interface HoursPolicy {
  hpd: number;
  dpw: number;
  source: PolicySource;
}

export const FALLBACK_POLICY: HoursPolicy = { hpd: 7, dpw: 5, source: 'fallback' };

/** Hours a day the squad really spends on project work, from its worklogs: round(cy × focus × 2) / 2, 5 days a week. */
export function learnedPolicy(stats: SquadStats | undefined): HoursPolicy {
  if (!stats) return FALLBACK_POLICY;
  return { hpd: Math.round(CY * stats.focusFactor * 2) / 2, dpw: 5, source: 'learned' };
}

/** Resolution order: this estimate → the saved default (only for estimates created after it) → learned → 5 × 7. */
export function resolvePolicy(
  spec: { hoursPerDay?: number | undefined; daysPerWeek?: number | undefined },
  conv: { createdAt: string },
  stats: SquadStats | undefined,
  saved: HoursDefault | null = readStore<HoursDefault | null>(HOURS_DEF_KEY, null),
): HoursPolicy {
  if (spec.hoursPerDay !== undefined && spec.daysPerWeek !== undefined) return { hpd: spec.hoursPerDay, dpw: spec.daysPerWeek, source: 'estimate' };
  if (saved && conv.createdAt >= saved.at) return { hpd: saved.hpd, dpw: saved.dpw, source: 'default' };
  return learnedPolicy(stats);
}

/** The squad focus factor that makes the engine's 5-day, `cy`-hour calendar deliver this policy. undefined = keep the learned one. */
export function focusFactorFor(policy: HoursPolicy, stats: SquadStats | undefined): number | undefined {
  if (policy.source === 'learned' && stats) return undefined;
  return (policy.hpd * policy.dpw) / 5 / CY;
}

/** f = (P50 + Σ risk hours + P50 × pct / 100) / P50. The timeline stretches by f; effort stays pure. */
export function bufferFactor(p50Hours: number, risks: readonly BufferRisk[] | undefined, pct: number | undefined): number {
  if (p50Hours <= 0) return 1;
  const extra = (risks ?? []).reduce((s, r) => s + Math.max(0, r.h), 0) + (p50Hours * (pct ?? 0)) / 100;
  return Math.max(1, (p50Hours + extra) / p50Hours);
}

export function bufferExtraHours(p50Hours: number, risks: readonly BufferRisk[] | undefined, pct: number | undefined): number {
  return Math.round((risks ?? []).reduce((s, r) => s + Math.max(0, r.h), 0) + (p50Hours * (pct ?? 0)) / 100);
}

export function readTeamDefaults(): TeamDefaults {
  return readStore<TeamDefaults>(TEAM_DEF_KEY, {});
}

/** The team a new estimate in this category starts from: the saved default, else 1 per role the work needs. */
export function startingTeam(category: string, neededRoles: readonly Role[], defaults: TeamDefaults = readTeamDefaults()): TeamShape {
  const saved = defaults[category];
  const t: TeamShape = {};
  for (const role of neededRoles) t[role] = 1;
  if (saved) for (const [role, n] of Object.entries(saved) as [Role, number][]) if (n > 0 || role in t) t[role] = n;
  return t;
}

export function readForecastFlags(convId: string): ForecastFlags {
  const all = readStore<Record<string, Partial<ForecastFlags>>>(FORECAST_KEY, {});
  return { leave: true, hist: true, buf: true, ...all[convId] };
}
