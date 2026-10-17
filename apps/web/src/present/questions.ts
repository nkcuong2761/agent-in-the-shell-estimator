import type { Estimate, ScopeResult, ScopeRisk } from '@scopewise/shared';
import { copy } from '../copy';
import { formatSpan } from './format';
import { hoursToScheduleDays } from './headline';

export interface ClientQuestion {
  id: string;
  question: string;
  reason: string;
  /** Present when the question came from the engine's ranking (it can be answered to tighten the estimate). */
  questionId?: string;
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'is', 'be', 'it', 'do', 'we', 'you', 'should', 'will', 'can', 'how', 'what', 'which', 'with', 'step', 'after', 'kickoff', 'added', 'was', 'similar', 'projects', 'often']);
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/[\s-]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ing|s)$/, '')),
  );

function riskTitle(r: ScopeRisk): string {
  return (r.description.split(' was added')[0] ?? r.description).trim();
}

function riskEvidence(r: ScopeRisk): string {
  const m = r.description.match(/in (\d+) of (\d+) similar projects/);
  const title = riskTitle(r).toLowerCase();
  return m ? `${m[1]} of ${m[2]} similar projects added ${title} later.` : `Similar projects often added ${title} later.`;
}

function relatedRisk(question: string, risks: ScopeRisk[]): ScopeRisk | undefined {
  const q = words(question);
  return risks.find((r) => [...words(riskTitle(r))].some((w) => q.has(w)));
}

/** Top questions from the value-of-information ranking, each with a one-line plain reason. */
export function toQuestions(est: Estimate, scope: ScopeResult, limit = 3): ClientQuestion[] {
  const used = new Set<string>();
  const out: ClientQuestion[] = est.rankedQuestions.slice(0, limit).map((q) => {
    const risk = relatedRisk(q.question, scope.scopeRisks);
    if (risk) used.add(risk.id);
    return {
      id: q.questionId,
      questionId: q.questionId,
      question: q.question,
      reason: risk ? riskEvidence(risk) : copy.saveGuesswork(formatSpan(hoursToScheduleDays(est, q.narrowsByH))),
    };
  });
  for (const r of scope.scopeRisks) {
    if (out.length >= limit) break;
    if (used.has(r.id) || !r.clientQuestion) continue;
    out.push({ id: r.id, question: r.clientQuestion, reason: riskEvidence(r) });
  }
  return out;
}

/** The client email with these questions filled in. */
export function toClientEmail(scope: ScopeResult, questions: ClientQuestion[]): string {
  const block = questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n');
  return scope.clientEmailDraft.includes('{{questions}}') ? scope.clientEmailDraft.replace('{{questions}}', block) : `${scope.clientEmailDraft}\n\n${block}`;
}
