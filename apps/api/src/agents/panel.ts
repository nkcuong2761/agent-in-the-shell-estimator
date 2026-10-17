/**
 * Estimator panel (Wideband Delphi): three personas guess every item independently (round 1, in parallel), then
 * revise after reading each other's round-1 guesses and reasons (round 2, in parallel). Aggregation and the
 * disagreement flags (CV of m > 0.35) come from the engine's aggregatePanel.
 */
import { z } from 'zod';
import type { BriefPack, ItemAnalogs, PanelAgent, PanelResult, Persona, Provenance, ScopeResult } from '@scopewise/shared';
import { PERSONA_LABELS, PanelGuess, PanelResult as PanelResultSchema } from '@scopewise/shared';
import { aggregatePanel } from '@scopewise/engine';
import { callStructured, provenance } from '../claude';
import { loadPrompt, type PromptName } from '../data';
import { env } from '../env';
import { briefBlock } from './scope';

const PERSONAS: { persona: Persona; prompt: PromptName }[] = [
  { persona: 'delivery-lead', prompt: 'panel-delivery-lead' },
  { persona: 'qa-lead', prompt: 'panel-qa-lead' },
  { persona: 'domain-expert', prompt: 'panel-domain-expert' },
];

const Guesses = z.object({ items: z.array(PanelGuess.extend({ reason: z.string().min(1).max(400) })) });
type Guesses = z.infer<typeof Guesses>;

function itemsBlock(scope: ScopeResult, analogs: readonly ItemAnalogs[]): string {
  const byItem = new Map(analogs.map((a) => [a.itemId, a.matches]));
  const qs = new Map(scope.missingInfo.map((q) => [q.id, q.question]));
  const phases = new Map(scope.phases.map((p) => [p.id, p.name]));
  return scope.items
    .map((it) => {
      const matches = byItem.get(it.id) ?? [];
      const lines = [
        `- id: ${it.id}`,
        `  title: ${it.title}`,
        `  phase: ${phases.get(it.phaseId) ?? it.phaseId}; category: ${it.category}; complexity: ${it.complexity}; role: ${it.role}`,
        `  scope agent guess (h): o ${it.o}, m ${it.m}, p ${it.p}`,
        matches.length
          ? `  similar past items, actual hours: ${matches.map((m) => `${m.actualH}h "${m.title}" (estimated ${m.estimateH}h)`).join('; ')}`
          : '  similar past items: none',
      ];
      if (it.affectedByQuestions.length) lines.push(`  open questions: ${it.affectedByQuestions.map((q) => qs.get(q) ?? q).join(' | ')}`);
      return lines.join('\n');
    })
    .join('\n');
}

function othersBlock(round1: PanelAgent[], self: Persona): string {
  return round1
    .filter((a) => a.persona !== self)
    .map((a) => `${PERSONA_LABELS[a.persona]}:\n${a.items.map((g) => `- ${g.itemId}: o ${g.o}, m ${g.m}, p ${g.p}. ${g.reason}`).join('\n')}`)
    .join('\n\n');
}

function repairGuesses(input: unknown): unknown {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { items?: unknown }).items)) return input;
  const items = (input as { items: Record<string, unknown>[] }).items.map((g) => {
    const vals = [g.o, g.m, g.p].map((v) => (typeof v === 'string' ? Number(v) : v));
    if (vals.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      const [o, m, p] = (vals as number[]).sort((a, b) => a - b);
      return { ...g, o, m, p };
    }
    return g;
  });
  return { ...input, items };
}

function checkGuesses(g: Guesses, scope: ScopeResult): string[] {
  const want = new Set(scope.items.map((i) => i.id));
  const got = new Set(g.items.map((x) => x.itemId));
  const problems: string[] = [];
  const missing = [...want].filter((id) => !got.has(id));
  if (missing.length) problems.push(`Missing guesses for items: ${missing.join(', ')}. Give a guess for every item.`);
  const unknown = [...got].filter((id) => !want.has(id));
  if (unknown.length) problems.push(`Unknown item ids: ${unknown.join(', ')}. Use the ids exactly as given.`);
  return problems;
}

async function guess(
  persona: (typeof PERSONAS)[number],
  brief: BriefPack,
  scope: ScopeResult,
  analogs: readonly ItemAnalogs[],
  round1?: PanelAgent[],
): Promise<{ agent: PanelAgent; model: string }> {
  const prompt = loadPrompt(persona.prompt);
  const parts = [
    briefBlock(brief),
    '',
    `Project type: ${scope.projectType}, size ${scope.size}. ${scope.summary}`,
    '',
    '<items>',
    itemsBlock(scope, analogs),
    '</items>',
  ];
  if (round1) {
    const mine = round1.find((a) => a.persona === persona.persona);
    parts.push(
      '',
      'This is round 2.',
      '<your_round_1>',
      mine ? mine.items.map((g) => `- ${g.itemId}: o ${g.o}, m ${g.m}, p ${g.p}. ${g.reason}`).join('\n') : '(none)',
      '</your_round_1>',
      '<other_panellists_round_1>',
      othersBlock(round1, persona.persona),
      '</other_panellists_round_1>',
      'Revise your guesses for every item.',
    );
  } else {
    parts.push('', 'This is round 1. Give your independent guesses for every item.');
  }
  const { value, model } = await callStructured({
    label: `${PERSONA_LABELS[persona.persona]} (round ${round1 ? 2 : 1})`,
    system: prompt.text,
    user: parts.join('\n'),
    tool: { name: 'submit_guesses', description: 'Submit o/m/p hour guesses with a one-sentence reason for every item.', schema: Guesses },
    repair: repairGuesses,
    check: (g) => checkGuesses(g, scope),
    maxTokens: 12000,
    effort: 'low',
  });
  const order = new Map(scope.items.map((i, k) => [i.id, k]));
  const items = [...value.items].sort((a, b) => (order.get(a.itemId) ?? 0) - (order.get(b.itemId) ?? 0));
  return { agent: { persona: persona.persona, items }, model };
}

export async function runPanel(
  brief: BriefPack,
  scope: ScopeResult,
  analogs: ItemAnalogs[],
): Promise<{ panel: PanelResult; provenance: Provenance }> {
  const r1 = await Promise.all(PERSONAS.map((p) => guess(p, brief, scope, analogs)));
  const round1 = r1.map((r) => r.agent);
  const r2 = await Promise.all(PERSONAS.map((p) => guess(p, brief, scope, analogs, round1)));
  const agents = r2.map((r) => r.agent);
  const draft: PanelResult = { agents, round1, rounds: 2, disagreementFlags: [] };
  const flags = aggregatePanel(draft, scope.items).value.filter((g) => g.flagged).map((g) => g.itemId);
  const panel = PanelResultSchema.parse({ ...draft, disagreementFlags: flags });
  const version = PERSONAS.map((p) => loadPrompt(p.prompt).version).join('+');
  return { panel, provenance: provenance(version, r2[0]?.model ?? env.model()) };
}
