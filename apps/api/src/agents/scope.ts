/**
 * Scope agent: brief pack → ScopeResult.
 * One call detects the project type and produces items (the prompt carries all five phase templates); phases are
 * then copied from the template so ids/roles are exact. Scope risks are computed by the engine
 * (predictScopeRisks) and a second, small call only phrases each one as a client question.
 */
import { z } from 'zod';
import type { BriefPack, Lesson, Provenance, ScopeResult, ScopeRisk } from '@scopewise/shared';
import { MissingInfo, PHASE_TEMPLATES, ProjectType, ScopeResult as ScopeResultSchema, WorkItem } from '@scopewise/shared';
import { predictScopeRisks } from '@scopewise/engine';
import { callStructured, provenance } from '../claude';
import { loadPrompt, loadSeedHistory } from '../data';
import { env } from '../env';

/** What Claude fills in. Phases come from the template; scope risks from the engine. */
export const ScopeDraft = ScopeResultSchema.omit({ phases: true, scopeRisks: true }).extend({
  items: z.array(WorkItem).min(1),
  missingInfo: z.array(MissingInfo),
});
export type ScopeDraft = z.infer<typeof ScopeDraft>;

const LESSONS_PER_TYPE = 3;
export const QUESTIONS_PLACEHOLDER = '{{questions}}';

const esc = (s: string) => s.replace(/"/g, '&quot;');

export function briefBlock(brief: BriefPack): string {
  const head = `<brief id="${esc(brief.id)}" title="${esc(brief.title)}"${brief.clientDeadline ? ` clientDeadline="${esc(brief.clientDeadline)}"` : ''}>`;
  const sources = brief.sources.map((s) => `<source name="${esc(s.name)}" kind="${s.kind}">\n${s.text.trim()}\n</source>`);
  return [head, ...sources, '</brief>'].join('\n');
}

/** Top lessons per project type (most recent first), plus general ones. */
export function lessonsBlock(lessons: readonly Lesson[]): string {
  const sorted = [...lessons].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  const lines: string[] = [];
  for (const t of [...ProjectType.options, undefined]) {
    const top = sorted.filter((l) => l.appliesTo.projectType === t && l.cause !== 'data-error').slice(0, LESSONS_PER_TYPE);
    if (!top.length) continue;
    lines.push(`${t ?? 'any project type'}:`);
    for (const l of top) lines.push(`- (${l.cause}${l.appliesTo.category ? `, ${l.appliesTo.category}` : ''}) ${l.note}`);
  }
  return lines.length ? lines.join('\n') : '(no lessons recorded yet)';
}

function templatesBlock(): string {
  return ProjectType.options
    .map((t) => `${t}: ${PHASE_TEMPLATES[t].map((p) => `${p.id} "${p.name}" (role ${p.role})`).join(' → ')}`)
    .join('\n');
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined;
}

/** Silent clean-ups: o ≤ m ≤ p, symmetric question links, exact source names, spread clamped to [1, 4]. */
export function repairDraft(input: unknown, brief: BriefPack): unknown {
  if (!input || typeof input !== 'object') return input;
  const d = structuredClone(input) as Record<string, unknown>;
  const names = new Map(brief.sources.map((s) => [s.name.toLowerCase(), s.name]));
  const items = Array.isArray(d.items) ? (d.items as Record<string, unknown>[]) : [];
  const missing = Array.isArray(d.missingInfo) ? (d.missingInfo as Record<string, unknown>[]) : [];
  for (const it of items) {
    const vals = [num(it.o), num(it.m), num(it.p)];
    if (vals.every((v) => v !== undefined)) {
      const [o, m, p] = (vals as number[]).sort((a, b) => a - b);
      Object.assign(it, { o, m, p });
    }
    if (Array.isArray(it.sourceRefs)) {
      for (const r of it.sourceRefs as Record<string, unknown>[]) {
        if (typeof r.source === 'string') r.source = names.get(r.source.trim().toLowerCase()) ?? r.source;
      }
    }
    if (!Array.isArray(it.affectedByQuestions)) it.affectedByQuestions = [];
  }
  const itemIds = new Set(items.map((i) => i.id));
  for (const q of missing) {
    const s = num(q.spreadMultiplier);
    if (s !== undefined) q.spreadMultiplier = Math.min(4, Math.max(1, s));
    const affected = new Set(Array.isArray(q.affectedItemIds) ? (q.affectedItemIds as unknown[]).filter((x) => typeof x === 'string') : []);
    for (const it of items) if ((it.affectedByQuestions as unknown[]).includes(q.id)) affected.add(it.id as string);
    q.affectedItemIds = [...affected].filter((id) => itemIds.has(id as string));
    for (const it of items) {
      const list = it.affectedByQuestions as unknown[];
      if (affected.has(it.id as string) && !list.includes(q.id)) list.push(q.id);
    }
  }
  const qIds = new Set(missing.map((q) => q.id));
  for (const it of items) it.affectedByQuestions = (it.affectedByQuestions as unknown[]).filter((q) => qIds.has(q as string));
  return d;
}

export function checkDraft(d: ScopeDraft, brief: BriefPack): string[] {
  const problems: string[] = [];
  const phaseIds = new Set(PHASE_TEMPLATES[d.projectType].map((p) => p.id));
  const sourceNames = new Set(brief.sources.map((s) => s.name));
  const ids = new Set<string>();
  if (d.items.length < 8) problems.push(`Only ${d.items.length} items; break the work into at least 8.`);
  for (const it of d.items) {
    if (ids.has(it.id)) problems.push(`Duplicate item id "${it.id}".`);
    ids.add(it.id);
    if (!phaseIds.has(it.phaseId)) problems.push(`Item ${it.id}: phaseId "${it.phaseId}" is not in the ${d.projectType} template (${[...phaseIds].join(', ')}).`);
    if (it.sourceRefs.length === 0) problems.push(`Item ${it.id} has no sourceRefs; cite at least one source.`);
    for (const r of it.sourceRefs) {
      if (!sourceNames.has(r.source)) problems.push(`Item ${it.id}: source "${r.source}" is not one of ${[...sourceNames].join(', ')}.`);
    }
  }
  const qIds = new Set<string>();
  for (const q of d.missingInfo) {
    if (qIds.has(q.id)) problems.push(`Duplicate missingInfo id "${q.id}".`);
    qIds.add(q.id);
    for (const id of q.affectedItemIds) if (!ids.has(id)) problems.push(`Question ${q.id}: unknown affected item "${id}".`);
  }
  if (!d.clientEmailDraft.includes(QUESTIONS_PLACEHOLDER)) {
    problems.push(`clientEmailDraft must contain the literal placeholder ${QUESTIONS_PLACEHOLDER} on its own line.`);
  }
  return problems;
}

export function draftToScope(d: ScopeDraft, scopeRisks: ScopeRisk[]): ScopeResult {
  const used = new Set(d.items.map((i) => i.phaseId));
  const phases = PHASE_TEMPLATES[d.projectType].filter((p) => used.has(p.id));
  return ScopeResultSchema.parse({ ...d, phases, scopeRisks });
}

const RiskQuestions = z.object({
  questions: z.array(z.object({ id: z.string(), clientQuestion: z.string().min(5).max(400) })),
});

/** Template phrasing used when the phrasing call fails (numbers are unchanged either way). */
export function templateRiskQuestion(r: ScopeRisk): string {
  const title = r.description.split(' was added')[0] ?? r.description;
  return `Similar projects often added “${title.toLowerCase()}” after kickoff. Should we plan for it now?`;
}

async function phraseRisks(brief: BriefPack, scope: ScopeDraft, risks: ScopeRisk[]): Promise<{ risks: ScopeRisk[]; phrasedBy: 'claude' | 'template' }> {
  if (!risks.length) return { risks, phrasedBy: 'template' };
  const prompt = loadPrompt('scope-risk');
  try {
    const { value } = await callStructured({
      label: 'scope-risk phrasing',
      system: prompt.text,
      user: [
        `Project: ${brief.title} (${scope.projectType}). ${scope.summary}`,
        '<risks>',
        ...risks.map((r) => JSON.stringify({ id: r.id, description: r.description, likelihood: r.likelihood, addedHoursRange: r.addedHoursRange })),
        '</risks>',
      ].join('\n'),
      tool: { name: 'submit_questions', description: 'One client question per scope risk id.', schema: RiskQuestions },
      check: (v) => risks.filter((r) => !v.questions.some((q) => q.id === r.id)).map((r) => `Missing a question for risk ${r.id}.`),
      maxTokens: 4000,
      effort: 'low',
    });
    const byId = new Map(value.questions.map((q) => [q.id, q.clientQuestion.trim()]));
    return { risks: risks.map((r) => ({ ...r, clientQuestion: byId.get(r.id) ?? templateRiskQuestion(r) })), phrasedBy: 'claude' };
  } catch (err) {
    console.warn('[scope] risk phrasing failed, using template questions:', err instanceof Error ? err.message : err);
    return { risks: risks.map((r) => ({ ...r, clientQuestion: templateRiskQuestion(r) })), phrasedBy: 'template' };
  }
}

export async function runScopeAgent(brief: BriefPack, opts: { lessons: Lesson[] }): Promise<{ scope: ScopeResult; provenance: Provenance }> {
  const prompt = loadPrompt('scope');
  const user = [
    briefBlock(brief),
    '',
    '<phase_templates>',
    templatesBlock(),
    '</phase_templates>',
    '',
    '<lessons>',
    lessonsBlock(opts.lessons),
    '</lessons>',
    '',
    `Source names you may cite: ${brief.sources.map((s) => s.name).join(', ')}.`,
  ].join('\n');
  const { value: draft, model } = await callStructured({
    label: 'scope agent',
    system: prompt.text,
    user,
    tool: { name: 'submit_scope', description: 'Submit the structured scope for the brief pack.', schema: ScopeDraft },
    repair: (input) => repairDraft(input, brief),
    check: (d) => checkDraft(d, brief),
    maxTokens: 16000,
    effort: 'medium',
  });
  const seed = loadSeedHistory();
  const engineRisks = predictScopeRisks(seed.projects, seed.items, draft.projectType);
  const phrased = await phraseRisks(brief, draft, engineRisks);
  const scope = draftToScope(draft, phrased.risks);
  const riskVersion = phrased.phrasedBy === 'claude' ? `+${loadPrompt('scope-risk').version}` : '';
  return { scope, provenance: provenance(`${prompt.version}${riskVersion}`, model ?? env.model()) };
}
