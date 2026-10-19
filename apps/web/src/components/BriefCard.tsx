import type { Conversation } from '@scopewise/shared';
import { copy } from '../copy';
import { Card, Icon, Label, provenanceWords } from './ui';

/** The brief as it was shared: preview text and attached file chips. */
export function BriefCard({ conv }: { conv: Conversation }) {
  const brief = conv.messages.find((m) => m.kind === 'user_brief');
  if (!brief || brief.kind !== 'user_brief') return null;
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
          {brief.files.map((f) => (
            <li key={f.name} className="chip">
              <Icon name={f.label.startsWith('Jira') ? 'jira' : 'file'} size={13} />
              {f.label}
            </li>
          ))}
        </ul>
      ) : null}
      {conv.scopeProvenance ? <p className="m-0 text-[13px] muted">{copy.briefWas(provenanceWords(conv.scopeProvenance))}</p> : null}
    </Card>
  );
}
