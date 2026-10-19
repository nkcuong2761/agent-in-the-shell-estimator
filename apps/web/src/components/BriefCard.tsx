import { useState } from 'react';
import type { Conversation } from '@scopewise/shared';
import { copy } from '../copy';
import { useConversations } from '../state/conversations';
import { Modal } from './fields';
import { Card, Icon, Label, provenanceWords } from './ui';

const JIRA_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;

/** The brief as it was shared: preview text and the sources as chips. A chip opens its text; a Jira ticket opens Jira. */
export function BriefCard({ conv }: { conv: Conversation }) {
  const { mode } = useConversations();
  const [open, setOpen] = useState<{ label: string; text: string } | null>(null);
  const brief = conv.messages.find((m) => m.kind === 'user_brief');
  if (!brief || brief.kind !== 'user_brief') return null;
  // Sample briefs carry fictional tickets, so their chips show the text; tickets read from your Jira link to it.
  const jiraBase = mode.kind === 'live' && !conv.sampleId ? mode.health.jiraBaseUrl : undefined;
  const sourceOf = (name: string) => conv.brief.sources.find((s) => s.name === name);
  return (
    <Card id="est-brief" inner="p-5 sm:p-6 flex flex-col gap-3" aria-labelledby="brief-title" quiet>
      <div className="flex flex-col gap-1">
        <Label idx="§ 07">Source</Label>
        <h2 id="brief-title" className="h-card m-0">
          {copy.briefTitle}
        </h2>
      </div>
      {brief.preview ? <p className="m-0 text-[15px] leading-relaxed ink-2">{brief.preview}</p> : null}
      {brief.files.length ? (
        <ul className="list-none m-0 p-0 flex flex-wrap gap-1.5">
          {brief.files.map((f) => {
            const isJira = f.label.startsWith('Jira');
            const key = isJira ? (f.label.match(JIRA_KEY)?.[1] ?? f.name.match(JIRA_KEY)?.[1]) : undefined;
            const src = sourceOf(f.name);
            if (isJira && key && jiraBase) {
              return (
                <li key={f.name}>
                  <a className="chip" href={`${jiraBase}/browse/${key}`} target="_blank" rel="noreferrer" aria-label={copy.openInJiraTab(key)}>
                    <Icon name="jira" size={13} />
                    {f.label}
                    <Icon name="arrow" size={11} className="-rotate-45" />
                  </a>
                </li>
              );
            }
            return (
              <li key={f.name}>
                <button type="button" className="chip" aria-label={copy.openSource(f.label)} onClick={() => setOpen({ label: f.label, text: src?.text ?? '' })}>
                  <Icon name={isJira ? 'jira' : 'file'} size={13} />
                  {f.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {conv.scopeProvenance ? <p className="m-0 text-[13px] muted">{copy.briefWas(provenanceWords(conv.scopeProvenance))}</p> : null}
      {open ? (
        <Modal title={open.label} onClose={() => setOpen(null)}>
          {open.text ? <pre className="m-0 whitespace-pre-wrap break-words text-[15px] leading-relaxed source-text">{open.text}</pre> : <p className="m-0 text-[15px] ink-2">{copy.sourceNoText}</p>}
        </Modal>
      ) : null}
    </Card>
  );
}
