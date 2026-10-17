import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AskScriptEntry, ChatMessage } from '@scopewise/shared';
import { api } from '../lib/api';
import { useActiveEstimate, useStore } from '../lib/store';
import { Spinner } from './ui';

interface Msg extends ChatMessage {
  tools?: { name: string; summary: string }[];
  scripted?: boolean;
}

const STOP = new Set(['the', 'a', 'an', 'is', 'to', 'of', 'what', 'how', 'why', 'we', 'i', 'should', 'if', 'do', 'it', 'this', 'so', 'was']);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

/** Pick the scripted answer whose question shares the most words with what was typed. */
function matchScript(q: string, script: AskScriptEntry[]): AskScriptEntry | undefined {
  const qs = new Set(words(q));
  let best: AskScriptEntry | undefined;
  let score = 0;
  for (const s of script) {
    const overlap = words(s.question).filter((w) => qs.has(w) || [...qs].some((x) => x.length > 4 && w.startsWith(x.slice(0, 5)))).length;
    if (overlap > score) {
      score = overlap;
      best = s;
    }
  }
  return score >= 1 ? best : undefined;
}

export function AskPanel({ onClose }: { onClose: () => void }) {
  const { mode } = useStore();
  const { ws } = useActiveEstimate();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const live = mode.kind === 'live' && mode.health.features.claude;
  const script = ws?.ask ?? [];

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, busy]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    if (live && ws) {
      setBusy(true);
      try {
        const r = await api.ask(
          next.map(({ role, content }) => ({ role, content })),
          { scope: ws.scope, panel: ws.panel, teamShape: ws.teamShape, squadId: ws.squadId, startDate: ws.startDate, deadline: ws.deadline, answeredQuestionIds: ws.answered, droppedItemIds: ws.dropped },
        );
        setMessages([...next, { role: 'assistant', content: r.answer, tools: r.toolCalls.map((t) => ({ name: t.name, summary: t.summary })) }]);
      } catch (err) {
        setMessages([...next, { role: 'assistant', content: `I couldn’t reach the API: ${err instanceof Error ? err.message : 'unknown error'}. Try again, or use one of the questions below.` }]);
      } finally {
        setBusy(false);
      }
      return;
    }
    const hit = matchScript(q, script);
    setMessages([
      ...next,
      hit
        ? { role: 'assistant', content: hit.answer, tools: hit.toolCalls, scripted: true }
        : {
            role: 'assistant',
            scripted: true,
            content: `In demo mode I can only give prepared answers, worked out by the engine for this brief as first opened. Try one of these: ${script.map((s) => `“${s.question}”`).join(', ')}.`,
          },
    ]);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(input);
  };

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="ask-title">
        <div className="drawer-head">
          <div>
            <h2 id="ask-title" className="h-section m-0">
              Ask about this estimate
            </h2>
            <p className="text-xs muted m-0">
              {ws ? ws.title : 'No brief open'}. {live ? 'Claude answers by calling the engine.' : 'Demo mode: prepared answers.'}
            </p>
          </div>
          <button className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="drawer-body flex-1 flex flex-col gap-4" aria-live="polite">
          {messages.length === 0 ? (
            <p className="m-0 muted text-sm">
              Ask why a number is what it is, what happens with a different team, or which question to send the client first. Every figure in an answer comes from the engine, not the language model.
            </p>
          ) : null}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'self-end max-w-[85%]' : 'max-w-[95%]'}>
              {m.role === 'user' ? (
                <p className="m-0 px-3 py-2" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>
                  {m.content}
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {m.tools?.length ? (
                    <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
                      {m.tools.map((t, j) => (
                        <li key={j} className="mono text-[11px] muted">
                          &gt; {t.name}: {t.summary}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="m-0 whitespace-pre-line leading-relaxed">{m.content}</p>
                  {m.scripted ? <p className="mono text-[10px] muted m-0">prepared answer, computed for the brief as first opened</p> : null}
                </div>
              )}
            </div>
          ))}
          {busy ? <Spinner label="Calling the engine" /> : null}
          <div ref={endRef} />
        </div>
        <div className="p-4 flex flex-col gap-3" style={{ borderTop: '1px solid var(--rule)' }}>
          {script.length ? (
            <div className="flex flex-wrap gap-1.5">
              {script.map((s) => (
                <button key={s.question} className="chip cursor-pointer hover:bg-[var(--paper-2)]" onClick={() => void ask(s.question)}>
                  {s.question}
                </button>
              ))}
            </div>
          ) : null}
          <form onSubmit={submit} className="flex gap-2">
            <label htmlFor="ask-input" className="sr-only">
              Your question
            </label>
            <input id="ask-input" ref={inputRef} className="input flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Why is the range so wide?" autoComplete="off" />
            <button className="btn btn-primary" type="submit" disabled={busy || !input.trim()}>
              Ask
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
