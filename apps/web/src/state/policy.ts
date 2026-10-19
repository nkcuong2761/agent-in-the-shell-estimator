/**
 * Per-estimate inputs that are not part of the scope: the working-hours policy, the default team per category,
 * the risks-and-buffer factor and the realistic-forecast inclusion flags. Pure functions plus storage keys.
 */
import type { AiPlan, AiToolKind, AiTools, BufferRisk, Category, Role, SquadStats, TeamShape } from '@scopewise/shared';
import { HOURS_PER_DAY } from '@scopewise/engine';
import { readStore } from '../lib/storage';

export const HOURS_DEF_KEY = 'sw-hours-def.v1';
export const TEAM_DEF_KEY = 'sw-team-def.v1';
export const FORECAST_KEY = 'sw-forecast.v1';
export const TOOLS_DEF_KEY = 'sw-tools-def.v1';
export const CY = HOURS_PER_DAY;

export interface HoursDefault {
  dpw: number;
  hpd: number;
  /** ISO time it was saved; it applies to estimates created after this. */
  at: string;
}
export type TeamDefaults = Record<string, Partial<Record<Role, number>>>;
export interface ToolsDefault {
  tools: AiTools;
  /** ISO time it was saved; it applies to estimates created after this. */
  at: string;
}
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

// --- AI tooling --------------------------------------------------------------------------------

export type ToolsSource = 'estimate' | 'default' | 'none';

/**
 * What each kind of tool saves, as a share of the hours of the work it touches, by plan. These are assumptions
 * (no finished project carries its tooling yet), kept small on purpose; the card and "Why this estimate" say so.
 */
export const AI_TOOL_EFFECT: Record<AiToolKind, { categories: Category[]; saves: Record<AiPlan, number> }> = {
  coding: { categories: ['backend', 'frontend', 'integration', 'data', 'devops'], saves: { none: 0, free: 0.06, paid: 0.14, enterprise: 0.18 } },
  chat: { categories: ['discovery', 'legal', 'reporting', 'notifications', 'forms'], saves: { none: 0, free: 0.04, paid: 0.08, enterprise: 0.1 } },
  testing: { categories: ['qa'], saves: { none: 0, free: 0.05, paid: 0.12, enterprise: 0.15 } },
  design: { categories: ['design'], saves: { none: 0, free: 0.04, paid: 0.1, enterprise: 0.12 } },
};
/** No kind of work ever loses more than this share to tooling, whatever is switched on. */
export const AI_TOOL_FLOOR = 0.7;
export const AI_TOOL_KINDS: AiToolKind[] = ['coding', 'chat', 'testing', 'design'];
export const AI_PLANS: AiPlan[] = ['none', 'free', 'paid', 'enterprise'];

/** Resolution order: this estimate → the saved default (only for estimates created after it) → no tools. */
export function resolveTools(
  spec: { aiTools?: AiTools | undefined },
  conv: { createdAt: string },
  saved: ToolsDefault | null = readStore<ToolsDefault | null>(TOOLS_DEF_KEY, null),
): { tools: AiTools; source: ToolsSource } {
  if (spec.aiTools) return { tools: spec.aiTools, source: 'estimate' };
  if (saved && conv.createdAt >= saved.at) return { tools: saved.tools, source: 'default' };
  return { tools: {}, source: 'none' };
}

export function hasTools(tools: AiTools): boolean {
  return AI_TOOL_KINDS.some((k) => (tools[k] ?? 'none') !== 'none');
}

/** Per category, the share of hours that remains once the team's tools are counted (1 = untouched). */
export function toolFactors(tools: AiTools): Partial<Record<Category, number>> {
  const out: Partial<Record<Category, number>> = {};
  for (const kind of AI_TOOL_KINDS) {
    const plan = tools[kind] ?? 'none';
    const save = AI_TOOL_EFFECT[kind].saves[plan];
    if (save <= 0) continue;
    for (const cat of AI_TOOL_EFFECT[kind].categories) out[cat] = Math.max(AI_TOOL_FLOOR, (out[cat] ?? 1) - save);
  }
  return out;
}
