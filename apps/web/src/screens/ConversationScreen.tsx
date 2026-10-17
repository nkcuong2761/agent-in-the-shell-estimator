import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Conversation, Message } from '@scopewise/shared';
import { copy } from '../copy';
import { EstimateView } from '../components/EstimateView';
import { Card, Icon, Mark, Spinner, provenanceWords } from '../components/ui';
import { formatWeeks, toComparison, toSuggestions } from '../present';
import { useConversations } from '../state/conversations';
import { estimateFor, scopeOf, versionEstimate } from '../state/engine';
import { api } from '../lib/api';

function Assistant({ children, i = 0 }: { children: ReactNode; i?: number }) {
  return (
    <div className="msg-assistant enter" style={{ ['--i' as string]: i }}>
      <span className="avatar" aria-hidden="true">
        <Mark size={32} />
      </span>
      <div className="flex flex-col gap-3 min-w-0 pt-1">{children}</div>
    </div>
  );
}

function UserBubble({ children }: { children: ReactNode }) {
  return <div className="msg-user enter">{children}</div>;
}

function ProgressMsg({ msg }: { msg: Extract<Message, { kind: 'progress' }> }) {
  return (
    <Assistant>
      <p className="m-0 text-[16px] leading-relaxed">{msg.intro}</p>
      <ol className="list-none m-0 p-0 flex flex-col gap-2" aria-live="polite">
        {msg.steps.map((s) => (
          <li key={s.label} className="flex items-center gap-3 text-[15px]" style={{ color: s.state === 'todo' ? 'var(--muted)' : 'var(--ink)' }}>
            <span className="w-5 h-5 grid place-items-center shrink-0">
              {s.state === 'done' ? (
                <span className="w-5 h-5 rounded-full grid place-items-center" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                  <Icon name="check" size={14} />
                </span>
              ) : s.state === 'active' ? (
                <span className="spin" />
              ) : (
                <span className="w-2 h-2 rounded-full" style={{ background: 'var(--surface-3)' }} />
              )}
            </span>
            <span className={s.state === 'active' ? 'pulse' : ''}>{s.label}</span>
            <span className="sr-only">{s.state === 'done' ? '(done)' : s.state === 'active' ? '(in progress)' : ''}</span>
          </li>
        ))}
      </ol>
    </Assistant>
  );
}

function EstimateMsg({ conv, msg, onChangeTeam }: { conv: Conversation; msg: Extract<Message, { kind: 'estimate' }>; onChangeTeam: () => void }) {
  const current = msg.estimateId === conv.currentEstimateId;
  const latestForVersion = [...conv.messages].reverse().find((m) => m.kind === 'estimate' && m.estimateId === msg.estimateId)?.id === msg.id;
  const [expanded, setExpanded] = useState(false);
  const scope = scopeOf(conv);
  const version = conv.versions[msg.estimateId];
  const showFull = (current && latestForVersion) || expanded;
  const est = useMemo(() => (showFull ? versionEstimate(conv, msg.estimateId) : undefined), [showFull, conv, msg.estimateId]);
  if (!scope || !version) return null;
  const range = formatWeeks(version.summary.weeksLow, version.summary.weeksHigh);
  if (!showFull) {
    return (
      <Assistant>
        <button className="row-button panel px-4 py-3 flex items-center justify-between gap-3" aria-expanded={false} onClick={() => setExpanded(true)}>
          <span className="text-[15px]">
            {msg.changeNote ? <span className="block muted text-[13px]">{msg.changeNote}</span> : null}
            {copy.earlierVersion(range, version.summary.safeDate)}
          </span>
          <span className="text-[14px] muted shrink-0">{copy.showVersion}</span>
        </button>
      </Assistant>
    );
  }
  return (
    <Assistant>
      {msg.changeNote ? (
        <p className="m-0">
          <span className="tag tag-accent">{msg.changeNote}</span>
        </p>
      ) : null}
      <p className="m-0 text-[16px] leading-relaxed">
        {copy.hereIsEstimate(`“${conv.title}”.`)}
        {conv.scopeProvenance ? <span className="muted text-[14px]"> The brief was {provenanceWords(conv.scopeProvenance)}.</span> : null}
      </p>
      {est ? <EstimateView est={est} conv={conv} scope={scope} team={version.spec.team} current={current} onChangeTeam={onChangeTeam} /> : <Spinner label="Working it out" />}
      {expanded ? (
        <button className="link text-[14px] self-start" onClick={() => setExpanded(false)}>
          {copy.hideVersion}
        </button>
      ) : null}
    </Assistant>
  );
}

function ComparisonMsg({ conv, msg }: { conv: Conversation; msg: Extract<Message, { kind: 'comparison' }> }) {
  const { decide, readOnly } = useConversations();
  const a = conv.versions[msg.baseEstimateId] ? estimateFor(conv, conv.versions[msg.baseEstimateId]!.spec, { quick: true }) : undefined;
  const b = conv.versions[msg.proposedEstimateId] ? estimateFor(conv, conv.versions[msg.proposedEstimateId]!.spec, { quick: true }) : undefined;
  const cmp = a && b ? toComparison(a, b) : undefined;
  return (
    <Assistant>
      <p className="m-0 text-[16px] leading-relaxed">{msg.summary}</p>
      {cmp ? (
        <Card inner="p-2 overflow-x-auto">
          <table className="table">
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
                  <td>{r.label}</td>
                  <td className="r">{r.current}</td>
                  <td className="r font-medium">{r.proposed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
      {msg.applied === undefined ? (
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary btn-sm" disabled={readOnly} onClick={() => decide(conv.id, msg.id, true)}>
            {copy.useThis}
            <span className="btn-icon">
              <Icon name="check" size={14} />
            </span>
          </button>
          <button className="btn btn-sm" disabled={readOnly} onClick={() => decide(conv.id, msg.id, false)}>
            {copy.keepCurrent}
          </button>
        </div>
      ) : (
        <p className="m-0 text-[14px] muted">{msg.applied ? copy.usedThis : copy.keptCurrent}</p>
      )}
    </Assistant>
  );
}

function MessageView({ conv, msg, onChangeTeam }: { conv: Conversation; msg: Message; onChangeTeam: () => void }) {
  const { retry } = useConversations();
  switch (msg.kind) {
    case 'user_brief':
      return (
        <UserBubble>
          {msg.preview ? <p className="m-0 text-[15px] leading-relaxed">{msg.preview}</p> : null}
          {msg.files.length ? (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {msg.files.map((f) => (
                <span key={f.name} className="chip chip-quiet text-[13px]">
                  <Icon name={f.label.startsWith('Jira') ? 'jira' : 'file'} size={14} />
                  {f.label}
                </span>
              ))}
            </div>
          ) : null}
        </UserBubble>
      );
    case 'user_text':
      return (
        <UserBubble>
          <p className="m-0 text-[15px] leading-relaxed whitespace-pre-line">{msg.text}</p>
        </UserBubble>
      );
    case 'progress':
      return <ProgressMsg msg={msg} />;
    case 'estimate':
      return <EstimateMsg conv={conv} msg={msg} onChangeTeam={onChangeTeam} />;
    case 'comparison':
      return <ComparisonMsg conv={conv} msg={msg} />;
    case 'answer':
      return (
        <Assistant>
          <p className="m-0 text-[16px] leading-relaxed whitespace-pre-line">{msg.text}</p>
        </Assistant>
      );
    case 'error':
      return (
        <Assistant>
          <div className="panel px-4 py-3 flex flex-wrap items-center gap-3" style={{ background: 'var(--danger-soft)' }} role="alert">
            <span className="text-[15px]" style={{ color: 'var(--danger)' }}>
              {msg.text}
            </span>
            {msg.retry ? (
              <button className="btn btn-sm" onClick={() => retry(conv.id)}>
                {copy.retry}
              </button>
            ) : null}
          </div>
        </Assistant>
      );
  }
}

function Composer({ conv, draft, setDraft }: { conv: Conversation; draft: string; setDraft: (s: string) => void }) {
  const { send, readOnly, busy } = useConversations();
  const ready = conv.status === 'ready' && !!conv.currentEstimateId;
  const est = ready ? versionEstimate(conv, conv.currentEstimateId, true) : undefined;
  const spec = conv.versions[conv.currentEstimateId]?.spec;
  const suggestions = est ? toSuggestions(est, spec?.deadline ?? conv.clientDeadline) : [];
  const disabled = !ready || readOnly || busy(conv.id);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (draft) input.current?.focus();
  }, [draft]);
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!draft.trim() || disabled) return;
    send(conv.id, draft);
    setDraft('');
  };
  return (
    <div className="composer-dock">
      <div className="flex flex-col gap-2">
        {ready && !readOnly ? (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button key={s} className="chip text-[14px]" onClick={() => send(conv.id, s)} disabled={disabled}>
                {s}
              </button>
            ))}
          </div>
        ) : null}
        <form onSubmit={submit} className="bezel">
          <div className="bezel-core flex items-end gap-2 p-2 pl-4">
            <label htmlFor="follow-up" className="sr-only">
              {copy.followUpPlaceholder}
            </label>
            <textarea
              id="follow-up"
              ref={input}
              rows={1}
              className="textarea py-2 max-h-40"
              placeholder={readOnly ? copy.readOnly : ready ? copy.followUpPlaceholder : copy.followUpLocked}
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
            <button type="submit" className="btn btn-primary !p-0 w-10 h-10 shrink-0" disabled={disabled || !draft.trim()} aria-label={copy.send}>
              <Icon name="send" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Header({ conv }: { conv: Conversation }) {
  const { mode, readOnly } = useConversations();
  const [note, setNote] = useState<string | null>(null);
  const jira = mode.kind === 'live' && mode.health.features.jira;
  const flash = (t: string) => {
    setNote(t);
    window.setTimeout(() => setNote(null), 2500);
  };
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      flash(copy.linkCopied);
    } catch {
      flash(window.location.href);
    }
  };
  const sendToJira = async () => {
    const scope = scopeOf(conv);
    const est = versionEstimate(conv, conv.currentEstimateId, true);
    if (!scope || !est) return;
    try {
      const r = await api.jiraPush({
        title: conv.title,
        summary: scope.summary,
        estimateUrl: window.location.href,
        projectType: scope.projectType,
        size: scope.size,
        dryRun: false,
        items: est.items.map((c) => ({ id: c.itemId, title: scope.items.find((i) => i.id === c.itemId)?.title ?? c.itemId, phaseId: c.phaseId, category: c.category, p50Hours: c.p50, p80Hours: c.p80 })),
      });
      flash(copy.sentToJira(r.epicKey ?? 'a new epic'));
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Jira did not accept it.');
    }
  };
  return (
    <header className="w-full max-w-[50rem] mx-auto px-[clamp(1rem,4vw,2rem)] pt-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-[17px] font-semibold tracking-tight m-0 truncate">{conv.title}</h1>
      <div className="flex items-center gap-2">
        {note ? (
          <span className="text-[14px] muted" role="status">
            {note}
          </span>
        ) : null}
        <button className="btn btn-sm" disabled={!jira || readOnly || conv.status !== 'ready'} title={jira ? undefined : copy.needsApi} onClick={sendToJira}>
          <Icon name="jira" size={16} />
          {copy.sendToJira}
        </button>
        <button className="btn btn-sm" onClick={share}>
          <Icon name="share" size={16} />
          {copy.share}
        </button>
      </div>
    </header>
  );
}

export function ConversationScreen() {
  const { id = '' } = useParams();
  const { conversations } = useConversations();
  const conv = conversations.find((c) => c.id === id);
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const count = conv?.messages.length ?? 0;
  useEffect(() => {
    if (count > 2) end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [count]);
  useEffect(() => setDraft(''), [id]);

  if (!conv) {
    return (
      <div className="thread">
        <p className="m-0 text-lg">{copy.notFound}</p>
        <Link to="/" className="btn btn-primary self-start no-underline">
          {copy.backToNew}
        </Link>
      </div>
    );
  }
  const changeTeam = () => {
    const est = versionEstimate(conv, conv.currentEstimateId, true);
    const first = est ? toSuggestions(est, conv.clientDeadline)[0] : undefined;
    setDraft(first ?? 'What if we add another developer?');
  };
  return (
    <>
      <Header conv={conv} />
      <div className="thread flex-1" aria-live="polite">
        {conv.messages.map((m) => (
          <MessageView key={m.id} conv={conv} msg={m} onChangeTeam={changeTeam} />
        ))}
        <div ref={end} />
      </div>
      <Composer conv={conv} draft={draft} setDraft={setDraft} />
    </>
  );
}
