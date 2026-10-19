import type { HistoryItem, HistoryProject, ProjectType, ScopeRisk } from '@scopewise/shared';
import { quantile, round } from './stats';
import { tokenize } from './tfidf';

export const MIN_RISK_LIKELIHOOD = 0.25;

function normaliseTitle(title: string): string {
  return tokenize(title).slice(0, 4).join(' ');
}

/**
 * Items commonly added after kickoff in similar past projects.
 * likelihood = share of same-type closed projects that added an item with this (normalised) title.
 * Claude only phrases these as client questions; the numbers come from here.
 */
export function predictScopeRisks(
  projects: readonly HistoryProject[],
  items: readonly HistoryItem[],
  projectType: ProjectType,
  limit = 4,
): ScopeRisk[] {
  const similar = projects.filter((p) => p.status === 'closed' && p.projectType === projectType);
  if (similar.length === 0) return [];
  const ids = new Set(similar.map((p) => p.id));
  const groups = new Map<string, { title: string; projects: Set<string>; hours: number[] }>();
  for (const it of items) {
    if (!it.addedAfterKickoff || !ids.has(it.projectId)) continue;
    const key = normaliseTitle(it.title);
    const g = groups.get(key) ?? { title: it.title, projects: new Set<string>(), hours: [] };
    g.projects.add(it.projectId);
    g.hours.push(it.timeSpentH);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      id: `risk-${key.replace(/\s+/g, '-')}`,
      description: `${g.title} was added after kickoff in ${g.projects.size} of ${similar.length} similar projects.`,
      likelihood: round(g.projects.size / similar.length, 2),
      evidenceProjectIds: [...g.projects].sort(),
      addedHoursRange: [round(quantile(g.hours, 0.2)), round(quantile(g.hours, 0.8))] as [number, number],
    }))
    .filter((r) => r.likelihood >= MIN_RISK_LIKELIHOOD)
    .sort((a, b) => b.likelihood - a.likelihood || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** Expected extra hours from scope risks: Σ likelihood × midpoint of the added-hours range. */
export function expectedRiskHours(risks: readonly ScopeRisk[]): number {
  return risks.reduce((s, r) => s + r.likelihood * ((r.addedHoursRange[0] + r.addedHoursRange[1]) / 2), 0);
}

/** Template client question for a scope risk; Claude rephrases it when a key is available. */
export function templateRiskQuestion(r: ScopeRisk): string {
  const title = r.description.split(' was added')[0] ?? r.description;
  return `Similar projects often added “${title.toLowerCase()}” after kickoff. Should we plan for it now?`;
}
