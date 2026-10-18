import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Conversation, Message } from '@scopewise/shared';
import { Assistant } from '../components/Assistant';
import { BriefCard } from '../components/BriefCard';
import { EstimateCard } from '../components/EstimateCard';
import { Questions } from '../components/Questions';
import { Stages } from '../components/Stages';
import { Icon, Spinner, Tag } from '../components/ui';
import { copy } from '../copy';
import { api } from '../lib/api';
import { categoryLabel } from '../lib/categories';
import { useConversations } from '../state/conversations';
import { planOf, scopeOf, versionEstimate } from '../state/engine';

/**
 * Edits inside the card must never move the viewport. Before an update we remember the section the user is
 * interacting with and where it sits; after React commits (before paint) we scroll by however much it moved.
 */
function useViewportHold(root: React.RefObject<HTMLElement | null>, key: string) {
  const anchor = useRef<{ el: Element; top: number } | null>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const remember = (e: Event) => {
      const t = (e.target as Element | null)?.closest?.('[data-hold]');
      if (t) anchor.current = { el: t, top: t.getBoundingClientRect().top };
    };
    el.addEventListener('pointerdown', remember, true);
    el.addEventListener('focusin', remember, true);
    el.addEventListener('change', remember, true);
    return () => {
      el.removeEventListener('pointerdown', remember, true);
      el.removeEventListener('focusin', remember, true);
      el.removeEventListener('change', remember, true);
    };
  }, [root]);
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a || !document.contains(a.el)) return;
    const delta = a.el.getBoundingClientRect().top - a.top;
    if (Math.abs(delta) > 1) window.scrollBy(0, delta);
    a.top = a.el.getBoundingClientRect().top;
  }, [key]);
}

function ProgressSteps({ msg }: { msg: Extract<Message, { kind: 'progress' }> }) {
  return (
    <section className="brick p-5 sm:p-7 flex flex-col gap-4" aria-live="polite" aria-label="Working on the estimate">
      <p className="m-0 text-[17px] leading-relaxed">{msg.intro}</p>
      <ol className="list-none m-0 p-0 flex flex-col gap-2">
        {msg.steps.map((s) => (
          <li key={s.label} className="flex items-center gap-3 text-[15px]" style={{ color: s.state === 'todo' ? 'var(--muted)' : 'var(--ink)' }}>
            <span className="w-5 h-5 grid place-items-center shrink-0">
              {s.state === 'done' ? (
                <span className="w-5 h-5 grid place-items-center" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
                  <Icon name="check" size={13} />
                </span>
              ) : s.state === 'active' ? (
                <span className="spin" />
              ) : (
                <span className="w-2 h-2" style={{ background: 'var(--surface-3)' }} />
              )}
            </span>
            <span className={s.state === 'active' ? 'pulse' : ''}>{s.label}</span>
            <span className="sr-only">{s.state === 'done' ? '(done)' : s.state === 'active' ? '(in progress)' : ''}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Header({ conv }: { conv: Conversation }) {
  const { mode, readOnly } = useConversations();
  const [note, setNote] = useState<string | null>(null);
  const jira = mode.kind === 'live' && mode.health.features.jira;
  const scope = scopeOf(conv);
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
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="h-page m-0 truncate">{conv.title}</h1>
        {scope ? <Tag tone="accent">{categoryLabel(scope.projectType)}</Tag> : null}
      </div>
      <div className="flex items-center gap-2">
        {note ? (
          <span className="text-[13px] muted" role="status">
            {note}
          </span>
        ) : null}
        <button className="btn btn-sm" disabled={!jira || readOnly || conv.status !== 'ready'} title={jira ? undefined : copy.needsApi} onClick={sendToJira}>
          <Icon name="jira" size={14} />
          {copy.sendToJira}
        </button>
        <button className="btn btn-sm" onClick={share}>
          <Icon name="share" size={14} />
          {copy.share}
        </button>
      </div>
    </header>
  );
}

/** The estimate document: a page with a fixed structure, plus the floating assistant. */
export function EstimateScreen() {
  const { id = '' } = useParams();
  const { conversations, retry } = useConversations();
  const conv = conversations.find((c) => c.id === id);
  const root = useRef<HTMLDivElement>(null);
  const versionKey = conv?.currentEstimateId ?? '';
  useViewportHold(root, versionKey);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  const scope = conv ? scopeOf(conv) : undefined;
  const spec = conv?.versions[conv.currentEstimateId]?.spec;
  const est = useMemo(() => (conv && conv.status === 'ready' && conv.currentEstimateId ? versionEstimate(conv, conv.currentEstimateId) : undefined), [conv]);
  const plan = useMemo(() => (conv && spec ? planOf(conv, spec) : undefined), [conv, spec]);

  if (!conv) {
    return (
      <div className="page">
        <p className="m-0 text-lg">{copy.notFound}</p>
        <Link to="/" className="btn btn-primary self-start">
          {copy.backHome}
        </Link>
      </div>
    );
  }
  const latest = [...conv.messages].reverse().find((m) => m.kind === 'estimate');
  const progress = conv.messages.find((m) => m.kind === 'progress');
  const error = [...conv.messages].reverse().find((m) => m.kind === 'error');
  return (
    <>
      <div ref={root} className="page">
        <Header conv={conv} />
        {conv.status === 'working' && progress?.kind === 'progress' ? <ProgressSteps msg={progress} /> : null}
        {conv.status === 'error' && error?.kind === 'error' ? (
          <div className="panel-danger p-4 flex flex-wrap items-center gap-3" role="alert">
            <span style={{ color: 'var(--danger)' }}>{error.text}</span>
            {error.retry ? (
              <button className="btn btn-sm" onClick={() => retry(conv.id)}>
                {copy.retry}
              </button>
            ) : null}
          </div>
        ) : null}
        {conv.status === 'error' ? <BriefCard conv={conv} /> : null}
        {conv.status === 'ready' && scope && spec ? (
          est && plan ? (
            <>
              {latest?.kind === 'estimate' && latest.changeNote ? (
                <p className="m-0">
                  <Tag tone="accent">{latest.changeNote}</Tag>
                </p>
              ) : null}
              <EstimateCard conv={conv} scope={scope} est={est} spec={spec} plan={plan} />
              <Stages est={est} scope={scope} />
              <Questions est={est} scope={scope} conv={conv} />
              <BriefCard conv={conv} />
            </>
          ) : (
            <Spinner label="Working it out" />
          )
        ) : null}
      </div>
      <Assistant conv={conv} />
    </>
  );
}
