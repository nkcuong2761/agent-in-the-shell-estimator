import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WorkItem } from '@scopewise/shared';
import { ROLE_LABELS } from '@scopewise/shared';
import { Box } from '../components/Ascii';
import { ProvenanceNote } from '../components/ui';
import { PROJECT_TYPE_LABELS } from '../lib/data';
import { hours, pct, plural } from '../lib/format';
import { useActiveEstimate, useStore } from '../lib/store';

function SourceChip({ source, quote, onShow }: { source: string; quote?: string; onShow: () => void }) {
  return (
    <button type="button" className="chip chip-source cursor-pointer hover:bg-[var(--paper-2)]" title={quote ? `“${quote}”` : `From ${source}`} onClick={onShow}>
      {source.replace(/\.md$/, '')}
    </button>
  );
}

function ItemRow({ item, onSource }: { item: WorkItem; onSource: (source: string, quote?: string) => void }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 py-2.5 border-b border-dashed" style={{ borderColor: 'var(--rule-soft)' }}>
      <div className="min-w-0">
        <p className="m-0 leading-snug">{item.title}</p>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {item.sourceRefs.map((r, i) => (
            <SourceChip key={i} source={r.source} quote={r.quote} onShow={() => onSource(r.source, r.quote)} />
          ))}
          {item.affectedByQuestions.length ? <span className="chip" style={{ borderStyle: 'dashed' }}>waits on {plural(item.affectedByQuestions.length, 'answer')}</span> : null}
        </div>
      </div>
      <div className="text-right">
        <p className="mono text-sm m-0 whitespace-nowrap">
          {Math.round(item.o)}/{Math.round(item.m)}/{Math.round(item.p)}h
        </p>
        <p className="text-xs muted m-0">
          {item.category}, {item.complexity}
        </p>
      </div>
    </li>
  );
}

export function ScopePage() {
  const { ws, estimate } = useActiveEstimate();
  const { history } = useStore();
  const [source, setSource] = useState<{ name: string; quote?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const email = useMemo(() => {
    if (!ws) return '';
    const order = estimate?.rankedQuestions.map((q) => q.questionId) ?? ws.scope.missingInfo.map((q) => q.id);
    const byId = new Map(ws.scope.missingInfo.map((q) => [q.id, q]));
    const open = order.map((id) => byId.get(id)).filter((q) => q && !ws.answered.includes(q.id));
    const lines = open.map((q, i) => `${i + 1}. ${q?.question}`);
    const risks = ws.scope.scopeRisks.filter((r) => r.clientQuestion).map((r, i) => `${lines.length + i + 1}. ${r.clientQuestion}`);
    const block = [...lines, ...risks].join('\n');
    return ws.scope.clientEmailDraft.includes('{{questions}}') ? ws.scope.clientEmailDraft.replace('{{questions}}', block) : `${ws.scope.clientEmailDraft}\n\n${block}`;
  }, [ws, estimate]);

  if (!ws) return null;
  const sc = ws.scope;
  const sourceDoc = source ? ws.brief.sources.find((s) => s.name === source.name) : undefined;
  const projectName = new Map(history.projects.map((p) => [p.id, p.name]));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <p className="text-sm muted m-0">
          {PROJECT_TYPE_LABELS[sc.projectType]}, size {sc.size}, for {ws.client}
        </p>
        <h1 className="h-page m-0">{ws.title}</h1>
        <p className="lede m-0">{sc.summary}</p>
        <div className="flex flex-wrap items-center gap-4">
          <Link to={`/estimate/${ws.id}`} className="btn btn-primary no-underline">
            See the estimate
          </Link>
          <ProvenanceNote p={ws.scopeProvenance} what="Scope" />
        </div>
      </header>

      <div className="grid gap-12 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Box title={`${plural(sc.items.length, 'work item')} in ${plural(sc.phases.length, 'phase')}`} labelledBy="items-title">
          <ol className="list-none m-0 p-0 flex flex-col gap-7">
            {[...sc.phases]
              .sort((a, b) => a.order - b.order)
              .map((ph, i) => {
                const items = sc.items.filter((it) => it.phaseId === ph.id);
                return (
                  <li key={ph.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="h-section m-0">
                        <span className="muted mono text-sm mr-2">{i + 1}.</span>
                        {ph.name}
                      </h3>
                      <span className="text-xs muted">
                        {ROLE_LABELS[ph.role]}, {hours(items.reduce((s, it) => s + it.m, 0))} likely
                      </span>
                    </div>
                    <ul className="list-none m-0 p-0 mt-1">
                      {items.map((it) => (
                        <ItemRow key={it.id} item={it} onSource={(name, quote) => setSource({ name, quote })} />
                      ))}
                    </ul>
                  </li>
                );
              })}
          </ol>
          <p className="text-xs muted m-0 mt-4">Hours are the scope agent’s first optimistic/likely/pessimistic guess. The estimator panel and history adjust them on the estimate.</p>
        </Box>

        <div className="flex flex-col gap-12">
          <Box title="Source" labelledBy="source-title" well>
            {sourceDoc ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="mono text-sm m-0">{sourceDoc.name}</p>
                  <button className="btn btn-sm" onClick={() => setSource(null)}>
                    Close
                  </button>
                </div>
                {source?.quote ? (
                  <p className="m-0 text-sm">
                    Cited: <mark style={{ background: 'color-mix(in oklab, var(--blue) 22%, transparent)', color: 'inherit' }}>“{source.quote}”</mark>
                  </p>
                ) : null}
                <pre className="mono text-[12px] leading-relaxed whitespace-pre-wrap m-0 max-h-[28rem] overflow-y-auto">{sourceDoc.text}</pre>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="m-0 text-sm muted">Select a source chip on any item to read the line it came from.</p>
                <ul className="list-none m-0 p-0 flex flex-wrap gap-2">
                  {ws.brief.sources.map((s) => (
                    <li key={s.name}>
                      <button className="chip chip-source cursor-pointer" onClick={() => setSource({ name: s.name })}>
                        {s.name.replace(/\.md$/, '')}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Box>

          <Box title={`Missing information (${sc.missingInfo.length})`} labelledBy="missing-title">
            <ul className="list-none m-0 p-0 flex flex-col gap-4">
              {sc.missingInfo.map((q) => (
                <li key={q.id}>
                  <p className="m-0 font-semibold leading-snug">{q.question}</p>
                  <p className="m-0 text-sm muted mt-1">{q.why}</p>
                  <p className="m-0 text-xs mt-1 mono">
                    {q.impact} impact, up to ×{q.spreadMultiplier} on {plural(q.affectedItemIds.length, 'item')}
                    {ws.answered.includes(q.id) ? ', answered' : ''}
                  </p>
                </li>
              ))}
            </ul>
          </Box>
        </div>
      </div>

      <div className="grid gap-12 md:grid-cols-2">
        <Box title="Assumptions" labelledBy="assumptions-title">
          <ul className="m-0 pl-5 flex flex-col gap-2">
            {sc.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Box>
        <Box title="Out of scope" labelledBy="oos-title">
          <ul className="m-0 pl-5 flex flex-col gap-2">
            {sc.outOfScope.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Box>
      </div>

      <Box title="Likely scope additions" labelledBy="risks-title">
        {sc.scopeRisks.length === 0 ? (
          <p className="m-0 muted">Similar past projects didn’t add work after kickoff often enough to flag anything.</p>
        ) : (
          <ul className="list-none m-0 p-0 grid gap-6 md:grid-cols-2">
            {sc.scopeRisks.map((r) => (
              <li key={r.id} className="flex flex-col gap-1.5">
                <p className="m-0 font-semibold">{r.description}</p>
                <p className="m-0 text-sm">
                  <span className="mono">{pct(r.likelihood)}</span> likely, adds <span className="mono">{hours(r.addedHoursRange[0])}–{hours(r.addedHoursRange[1])}</span> when it happens.
                </p>
                <p className="m-0 text-xs muted">
                  Seen in: {r.evidenceProjectIds.map((id) => projectName.get(id) ?? id).join('; ')}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs muted m-0 mt-4">Found by the engine in fictional history: items logged after kickoff in projects of the same type. They are not in the range above; ask the client.</p>
      </Box>

      <Box title="Email to the client" labelledBy="email-title">
        <div className="flex flex-col gap-4">
          <p className="m-0 text-sm muted">Questions appear in order of how much each answer narrows the estimate, followed by likely additions.</p>
          <pre className="m-0 p-4 whitespace-pre-wrap text-[15px] leading-relaxed" style={{ fontFamily: 'var(--font-body)', background: 'var(--paper-2)' }}>
            {email}
          </pre>
          <div className="flex items-center gap-3">
            <button className="btn btn-primary" onClick={copy}>
              Copy email
            </button>
            <span role="status" className="mono text-sm" style={{ color: 'var(--blue-ink)' }}>
              {copied ? 'Copied to clipboard' : ''}
            </span>
          </div>
        </div>
      </Box>
    </div>
  );
}
