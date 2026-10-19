import { useMemo, useState } from 'react';
import type { Conversation, Estimate, ScopeResult } from '@scopewise/shared';
import { copy } from '../copy';
import { toClientEmail, toQuestions } from '../present/questions';
import { useConversations } from '../state/conversations';
import { Card, Icon, Label } from './ui';

/** "Ask the client before you commit": the top 3 questions, copy-email and answer-inline. */
export function Questions({ est, scope, conv }: { est: Estimate; scope: ScopeResult; conv: Conversation }) {
  const { answer, readOnly } = useConversations();
  const qs = toQuestions(est, scope);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [answering, setAnswering] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const email = useMemo(() => toClientEmail(scope, qs), [scope, qs]);
  if (!qs.length) return null;
  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    window.setTimeout(() => setCopied(null), 3000);
  };
  return (
    <Card id="est-questions" inner="p-5 sm:p-6 flex flex-col gap-4" aria-labelledby="questions-title" tabIndex={-1}>
      <div className="flex flex-col gap-1">
        <Label idx="§ 06">Before you commit</Label>
        <h2 id="questions-title" className="h-card m-0">
          {copy.askClient}
        </h2>
        <p className="m-0 text-[15px] muted">{copy.askClientSub}</p>
      </div>
      <ol className="m-0 p-0 list-none flex flex-col">
        {qs.map((q, i) => (
          <li key={q.id} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-3 rule-top">
            <span className="mono text-[13px] font-bold" style={{ color: 'var(--accent-ink)' }} aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div>
              <p className="m-0 font-semibold leading-snug">{q.question}</p>
              <p className="m-0 text-[14px] muted mt-0.5">{q.reason}</p>
              {answering ? (
                <label className="block mt-2">
                  <span className="sr-only">{copy.answerPlaceholder}</span>
                  <input className="input w-full" placeholder={copy.answerPlaceholder} value={answers[q.id] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
                </label>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {answering ? (
          <>
            <button
              className="btn btn-primary btn-sm"
              disabled={!Object.values(answers).some((v) => v.trim())}
              onClick={() => {
                answer(
                  conv.id,
                  qs.map((q) => ({ questionId: q.questionId ?? q.id, question: q.question, text: answers[q.id] ?? '' })),
                );
                setAnswering(false);
                setAnswers({});
              }}
            >
              {copy.submitAnswers}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAnswering(false)}>
              {copy.cancel}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-sm" onClick={copyEmail}>
              <Icon name="copy" size={14} />
              {copy.copyEmail}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={readOnly} onClick={() => setAnswering(true)}>
              {copy.knowAnswers}
            </button>
          </>
        )}
        {copied ? (
          <span className="text-[14px]" role="status" style={{ color: copied === 'ok' ? 'var(--success)' : 'var(--warning)' }}>
            {copied === 'ok' ? copy.copied : copy.copyFailed}
          </span>
        ) : null}
      </div>
      {copied === 'fail' ? <pre className="panel p-4 m-0 whitespace-pre-wrap text-[14px] leading-relaxed font-[inherit]">{email}</pre> : null}
    </Card>
  );
}
