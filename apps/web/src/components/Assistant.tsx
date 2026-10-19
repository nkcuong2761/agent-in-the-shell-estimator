import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { Conversation, Message } from '@scopewise/shared';
import { copy } from '../copy';
import { toComparison } from '../present/comparison';
import { toSuggestions } from '../present/suggestions';
import { useConversations } from '../state/conversations';
import { estimateFor, versionEstimate } from '../state/engine';
import { Icon, Mark } from './ui';

const OPEN_KEY = 'sw-chat-open';
const NOTIFY: Message['kind'][] = ['answer', 'comparison', 'error', 'estimate'];

function readOpen(): boolean {
  try {
    return window.sessionStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}
function writeOpen(v: boolean) {
  try {
    window.sessionStorage.setItem(OPEN_KEY, v ? '1' : '0');
  } catch {
    /* session storage unavailable */
  }
}

function ComparisonBubble({ conv, msg }: { conv: Conversation; msg: Extract<Message, { kind: 'comparison' }> }) {
  const { decide, readOnly } = useConversations();
  const a = conv.versions[msg.baseEstimateId] ? estimateFor(conv, conv.versions[msg.baseEstimateId]!.spec, { quick: true }) : undefined;
  const b = conv.versions[msg.proposedEstimateId] ? estimateFor(conv, conv.versions[msg.proposedEstimateId]!.spec, { quick: true }) : undefined;
  const cmp = a && b ? toComparison(a, b) : undefined;
  return (
    <div className="bubble bubble-assistant flex flex-col gap-2.5 w-full max-w-full">
      <p className="m-0">{msg.summary}</p>
      {cmp ? (
        <table className="table text-[13px]">
          <thead>
            <tr>
              <th>
                <span className="sr-only">Measure</span>
              </th>
              <th className="r">{copy.current}</th>
              <th className="r">{msg.proposedLabel}</th>
            </tr>
          </thead>
          <tbody>
            {cmp.rows.map((r) => (
              <tr key={r.label}>
                <td className="!py-1.5 !px-2">{r.label}</td>
                <td className="r mono !py-1.5 !px-2">{r.current}</td>
                <td className="r mono font-semibold !py-1.5 !px-2">{r.proposed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {msg.applied === undefined ? (
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary btn-sm" disabled={readOnly} onClick={() => decide(conv.id, msg.id, true)}>
            {copy.useThis}
          </button>
          <button className="btn btn-sm" disabled={readOnly} onClick={() => decide(conv.id, msg.id, false)}>
            {copy.keepCurrent}
          </button>
        </div>
      ) : (
        <p className="m-0 text-[13px] muted">{msg.applied ? copy.usedThis : copy.keptCurrent}</p>
      )}
    </div>
  );
}

function Bubble({ conv, msg, firstEstimate }: { conv: Conversation; msg: Message; firstEstimate: boolean }) {
  const { retry } = useConversations();
  switch (msg.kind) {
    case 'user_brief':
      return <div className="bubble bubble-user">{copy.sharedBrief(msg.files.length)}</div>;
    case 'user_text':
      return <div className="bubble bubble-user whitespace-pre-line">{msg.text}</div>;
    case 'progress':
      return <div className="bubble bubble-assistant">{msg.steps.every((s) => s.state === 'done') ? copy.readBrief : copy.workingIntro}</div>;
    case 'estimate':
      return <div className="bubble bubble-assistant">{firstEstimate || !msg.changeNote ? copy.estimateReady : copy.estimateUpdated(msg.changeNote)}</div>;
    case 'answer':
      return <div className="bubble bubble-assistant whitespace-pre-line">{msg.text}</div>;
    case 'comparison':
      return <ComparisonBubble conv={conv} msg={msg} />;
    case 'error':
      return (
        <div className="bubble bubble-assistant panel-danger flex flex-wrap items-center gap-2" role="alert">
          <span style={{ color: 'var(--danger)' }}>{msg.text}</span>
          {msg.retry ? (
            <button className="btn btn-sm" onClick={() => retry(conv.id)}>
              {copy.retry}
            </button>
          ) : null}
        </div>
      );
  }
}

/** The assistant, minimised to a corner. It keeps the text history and, when asked, updates the document. */
export function Assistant({ conv }: { conv: Conversation }) {
  const { send, readOnly, busy } = useConversations();
  const [open, setOpen] = useState(readOpen);
  const [seen, setSeen] = useState(() => (readOpen() ? conv.messages.length : 0));
  const [draft, setDraft] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const ready = conv.status === 'ready' && !!conv.currentEstimateId;
  const est = ready ? versionEstimate(conv, conv.currentEstimateId, true) : undefined;
  const spec = conv.versions[conv.currentEstimateId]?.spec;
  const suggestions = est ? toSuggestions(est, spec?.deadline ?? conv.clientDeadline) : [];
  const disabled = !ready || readOnly || busy(conv.id);
  const count = conv.messages.length;
  const unread = open ? 0 : conv.messages.slice(seen).filter((m) => NOTIFY.includes(m.kind)).length;

  useEffect(() => {
    if (!open) return;
    setSeen(count);
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, count]);
  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);
  // The box grows with the draft so a long message is readable in full; past half the panel it scrolls.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, open]);

  const toggle = (v: boolean) => {
    setOpen(v);
    writeOpen(v);
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!draft.trim() || disabled) return;
    send(conv.id, draft);
    setDraft('');
  };

  if (!open) {
    return (
      <button className="btn btn-primary assistant-pill relative" onClick={() => toggle(true)} aria-label={`${copy.openAssistant}${unread ? `, ${unread} new` : ''}`}>
        <Icon name="spark" size={15} />
        {copy.askScopewise}
        {unread ? <span className="badge">{unread}</span> : null}
      </button>
    );
  }
  let estimates = 0;
  return (
    <aside className="assistant" aria-label={copy.askScopewise} role="complementary">
      <div className="assistant-head">
        <Mark size={28} />
        <div className="min-w-0 flex-1">
          <p className="m-0 font-[var(--font-display)] font-extrabold text-[15px] leading-tight">{copy.askScopewise}</p>
          <p className="m-0 text-[12px] muted leading-tight">{copy.assistantSub}</p>
        </div>
        <button className="btn btn-ghost btn-sm btn-icon-only" aria-label={copy.minimise} onClick={() => toggle(false)}>
          <Icon name="minimize" size={16} />
        </button>
      </div>
      <div ref={body} className="assistant-body" aria-live="polite">
        {conv.messages.map((m) => {
          const first = m.kind === 'estimate' ? estimates++ === 0 : false;
          return <Bubble key={m.id} conv={conv} msg={m} firstEstimate={first} />;
        })}
      </div>
      <form className="assistant-foot" onSubmit={submit}>
        {ready && !readOnly ? (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
            {suggestions.map((s) => (
              <button key={s} type="button" className="chip shrink-0" onClick={() => send(conv.id, s)} disabled={disabled}>
                {s}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2 panel px-3 py-1.5">
          <label htmlFor="assistant-input" className="sr-only">
            {copy.assistantPlaceholder}
          </label>
          <textarea
            id="assistant-input"
            ref={input}
            rows={1}
            className="textarea py-1.5 text-[15px] assistant-input"
            placeholder={readOnly ? copy.readOnly : ready ? copy.assistantPlaceholder : copy.followUpLocked}
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button type="submit" className="btn btn-primary btn-sm btn-icon-only shrink-0 mb-0.5" disabled={disabled || !draft.trim()} aria-label={copy.send}>
            <Icon name="send" size={15} />
          </button>
        </div>
      </form>
    </aside>
  );
}
