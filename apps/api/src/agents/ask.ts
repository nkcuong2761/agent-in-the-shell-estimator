/**
 * Ask agent: a short tool-use loop over the engine. Tools compute; Claude only phrases the results.
 * State within one request: answering a question or the what-if are applied by re-running the engine.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AskResponse, ChatMessage, Estimate, EstimateRequest } from '@scopewise/shared';
import { TeamShape } from '@scopewise/shared';
import { WHAT_IF_RUNS, runEstimate, type PreparedEstimate } from '@scopewise/engine';
import { createMessage, defineTool, provenance, textOf } from '../claude';
import { loadPrompt, type SeedHistory } from '../data';
import { prepareFromRequest } from '../engineRun';
import { env } from '../env';

export const MAX_TOOL_ITERATIONS = 6;

const GetEstimateInput = z.object({});
const ExplainInput = z.object({ numberId: z.string().min(1).describe('e.g. total.p80, buffer.total, phase.build, question.q-sso') });
const WhatIfInput = z.object({
  teamShape: TeamShape.optional().describe('Headcount per role, e.g. {"engineer": 4}. Roles not given keep the current headcount.'),
  dropItemIds: z.array(z.string()).optional().describe('Item ids to leave out of the estimate.'),
});
const AnswerInput = z.object({ questionId: z.string().min(1), answer: z.string().min(1).max(2000) });

const TOOLS: Anthropic.Tool[] = [
  defineTool('get_estimate', 'Get the current estimate: totals (P50/P80), buffer, dates, on-time chance, confidence, phases and ranked open questions.', GetEstimateInput),
  defineTool('explain_number', 'Explain how one number was calculated: method, citation, formula, inputs and plain words.', ExplainInput),
  defineTool('run_what_if', 'Re-run the estimate with a different team shape and/or without some items; returns before/after.', WhatIfInput),
  defineTool('answer_question', 'Mark an open client question as answered and re-run the estimate; returns before/after.', AnswerInput),
];

const h = (x: number) => `${Math.round(x).toLocaleString('en-US')}h`;
const pct = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);

export function summarizeEstimate(est: Estimate) {
  return {
    total: est.total,
    commitHours: est.commitHours,
    buffer: est.buffer,
    startDate: est.startDate,
    p50Date: est.p50Date,
    p80Date: est.p80Date,
    commitDate: est.commitDate,
    deadline: est.deadline ?? null,
    onTimeProbability: est.onTimeProbability,
    confidence: est.confidence,
    perPhase: est.perPhase.map((p) => ({ phaseId: p.phaseId, name: p.name, role: p.role, p50: p.p50, p80: p.p80 })),
    rankedQuestions: est.rankedQuestions.map((q) => ({ questionId: q.questionId, question: q.question, impact: q.impact, narrowsByH: q.narrowsByH })),
    referenceClass: { n: est.referenceClass.n, median: est.referenceClass.median, p20: est.referenceClass.p20, p80: est.referenceClass.p80 },
  };
}

function compare(before: Estimate, after: Estimate) {
  return {
    before: { p50: before.total.p50, p80: before.total.p80, p50Date: before.p50Date, p80Date: before.p80Date, commitDate: before.commitDate, onTimeProbability: before.onTimeProbability, confidence: before.confidence },
    after: { p50: after.total.p50, p80: after.total.p80, p50Date: after.p50Date, p80Date: after.p80Date, commitDate: after.commitDate, onTimeProbability: after.onTimeProbability, confidence: after.confidence },
    rangeWidthBefore: Math.round(before.total.p80 - before.total.p50),
    rangeWidthAfter: Math.round(after.total.p80 - after.total.p50),
  };
}

interface AskState {
  prep: PreparedEstimate;
  req: EstimateRequest;
  answered: Set<string>;
  answers: Record<string, string>;
  current?: Estimate;
}

function current(state: AskState): Estimate {
  state.current ??= runEstimate(state.prep, { answeredQuestionIds: [...state.answered] });
  return state.current;
}

type ToolOutcome = { content: unknown; summary: string; isError?: boolean };

function runTool(name: string, rawInput: unknown, state: AskState | null): ToolOutcome {
  if (!state) {
    return { content: { error: 'No estimate is loaded. Open a sample or run an estimate first, then ask again.' }, summary: 'no estimate loaded', isError: true };
  }
  switch (name) {
    case 'get_estimate': {
      const est = current(state);
      return { content: summarizeEstimate(est), summary: `P50 ${h(est.total.p50)}, P80 ${h(est.total.p80)}, confidence ${est.confidence}` };
    }
    case 'explain_number': {
      const input = ExplainInput.parse(rawInput);
      const est = current(state);
      const ex = est.explanations[input.numberId];
      if (!ex) {
        const prefixes = [...new Set(Object.keys(est.explanations).map((k) => k.split('.')[0]))];
        return { content: { error: `Unknown numberId "${input.numberId}".`, examples: Object.keys(est.explanations).slice(0, 40), prefixes }, summary: `unknown ${input.numberId}`, isError: true };
      }
      return { content: ex, summary: input.numberId };
    }
    case 'run_what_if': {
      const input = WhatIfInput.parse(rawInput);
      const before = current(state);
      const team = { ...state.req.teamShape, ...(input.teamShape ?? {}) };
      const dropped = [...new Set([...(state.req.droppedItemIds ?? []), ...(input.dropItemIds ?? [])])];
      const unknown = (input.dropItemIds ?? []).filter((id) => !state.req.scope.items.some((i) => i.id === id));
      const after = runEstimate(state.prep, { teamShape: team, droppedItemIds: dropped, answeredQuestionIds: [...state.answered], runs: WHAT_IF_RUNS, skipVoi: true });
      const changes = [
        ...Object.entries(input.teamShape ?? {}).map(([r, n]) => `${r}: ${state.req.teamShape[r as keyof typeof team] ?? 0} → ${n}`),
        ...(input.dropItemIds?.length ? [`drop ${input.dropItemIds.join(', ')}`] : []),
      ];
      return {
        content: { ...compare(before, after), teamShape: team, droppedItemIds: dropped, unknownItemIds: unknown, runs: WHAT_IF_RUNS },
        summary: `${changes.join('; ') || 'no change'}: P50 ${h(before.total.p50)} → ${h(after.total.p50)}, on time ${pct(before.onTimeProbability)} → ${pct(after.onTimeProbability)}`,
      };
    }
    case 'answer_question': {
      const input = AnswerInput.parse(rawInput);
      const q = state.req.scope.missingInfo.find((m) => m.id === input.questionId);
      if (!q) {
        return { content: { error: `Unknown questionId "${input.questionId}".`, openQuestions: state.req.scope.missingInfo.filter((m) => !state.answered.has(m.id)).map((m) => ({ id: m.id, question: m.question })) }, summary: `unknown ${input.questionId}`, isError: true };
      }
      const before = current(state);
      state.answered.add(q.id);
      state.answers[q.id] = input.answer;
      state.current = undefined;
      const after = current(state);
      return {
        content: { ...compare(before, after), question: q.question, recordedAnswer: input.answer, note: 'The engine removes this question’s extra spread; it does not re-scope items from the answer text.' },
        summary: `${q.id} answered: range ${h(before.total.p80 - before.total.p50)} → ${h(after.total.p80 - after.total.p50)}`,
      };
    }
    default:
      return { content: { error: `Unknown tool ${name}` }, summary: `unknown tool ${name}`, isError: true };
  }
}

function toApiMessages(messages: readonly ChatMessage[]): Anthropic.MessageParam[] {
  const first = messages.findIndex((m) => m.role === 'user');
  return messages.slice(first < 0 ? messages.length : first).map((m) => ({ role: m.role, content: m.content }));
}

export async function runAsk(
  messages: ChatMessage[],
  context: EstimateRequest | undefined,
  seedData: SeedHistory,
): Promise<AskResponse> {
  const prompt = loadPrompt('ask');
  const state: AskState | null = context
    ? { prep: prepareFromRequest(context, seedData), req: context, answered: new Set(context.answeredQuestionIds ?? []), answers: {} }
    : null;
  const history = toApiMessages(messages);
  if (!history.length) return { answer: 'Ask me something about the estimate.', toolCalls: [], provenance: provenance(prompt.version, env.model()) };
  const system = state
    ? `${prompt.text}\n\nContext: the current estimate is for "${state.req.scope.summary || state.req.scope.projectType}" (${state.req.scope.items.length} items, ${state.req.scope.missingInfo.length} client questions). Team: ${JSON.stringify(state.req.teamShape)}. Start ${state.req.startDate}${state.req.deadline ? `, deadline ${state.req.deadline}` : ''}.`
    : `${prompt.text}\n\nContext: no estimate is loaded in the app right now. Tools will say so; suggest opening a sample.`;
  const toolCalls: AskResponse['toolCalls'] = [];
  let model = env.model();
  for (let i = 0; i <= MAX_TOOL_ITERATIONS; i++) {
    const last = i === MAX_TOOL_ITERATIONS;
    const res = await createMessage({ system, messages: history, tools: TOOLS, maxTokens: 4000, effort: 'low', noTools: last });
    model = res.model ?? model;
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || uses.length === 0 || last) {
      const answer = textOf(res) || (last ? 'I ran out of steps before finishing. Try a narrower question.' : 'I could not find an answer to that.');
      return { answer, toolCalls, provenance: provenance(prompt.version, model) };
    }
    history.push({ role: 'assistant', content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = uses.map((u) => {
      let out: ToolOutcome;
      try {
        out = runTool(u.name, u.input, state);
      } catch (err) {
        const msg = err instanceof z.ZodError ? z.prettifyError(err) : err instanceof Error ? err.message : String(err);
        out = { content: { error: `Invalid input: ${msg}` }, summary: 'invalid input', isError: true };
      }
      toolCalls.push({ name: u.name, input: u.input, summary: out.summary });
      return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out.content), ...(out.isError ? { is_error: true } : {}) };
    });
    history.push({ role: 'user', content: results });
    if (i === MAX_TOOL_ITERATIONS - 1) {
      history.push({ role: 'user', content: 'Answer now from the tool results above, without calling more tools.' });
    }
  }
  return { answer: 'I could not finish that question.', toolCalls, provenance: provenance(prompt.version, model) };
}
