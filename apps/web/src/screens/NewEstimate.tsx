import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { copy } from '../copy';
import { Icon, Mark } from '../components/ui';
import { useConversations } from '../state/conversations';

const EXAMPLES: { label: string; sampleId: string }[] = [
  { label: 'Put a paper form online', sampleId: 'subscription-form' },
  { label: 'Remind investors to sign', sampleId: 'investor-reminders' },
  { label: 'Sync with a fund administrator', sampleId: 'fund-admin-sync' },
];

const JIRA_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;

export function NewEstimate() {
  const { mode, startSample, startBrief, readOnly } = useConversations();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [jira, setJira] = useState<string[]>([]);
  const [jiraOpen, setJiraOpen] = useState(false);
  const [jiraInput, setJiraInput] = useState('');
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const live = mode.kind === 'live' && mode.health.features.claude;
  const jiraLive = mode.kind === 'live' && mode.health.features.jira;
  const hasInput = text.trim().length > 0 || files.length > 0 || jira.length > 0;
  const showDemoNote = !live && hasInput;

  const addFiles = (list: FileList | null) => setFiles((f) => [...f, ...Array.from(list ?? [])].slice(0, 10));
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    addFiles(e.dataTransfer.files);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!hasInput || !live || readOnly) return;
    const id = startBrief({ text, files, jiraKeys: jira });
    navigate(`/estimate/${id}`);
  };
  const addJira = () => {
    const key = jiraInput.toUpperCase().match(JIRA_KEY)?.[1];
    if (key) setJira((j) => [...new Set([...j, key])]);
    setJiraInput('');
    setJiraOpen(false);
  };

  return (
    <div className="flex-1 flex flex-col justify-center px-4 py-12 sm:py-20">
      <div className="w-full max-w-[46rem] mx-auto flex flex-col gap-8">
        <div className="flex flex-col gap-4 enter">
          <Mark size={44} />
          <h1 className="h-hero m-0">{copy.askHeading}</h1>
          <p className="m-0 text-lg leading-relaxed ink-2 measure">{copy.askSub}</p>
        </div>

        <form onSubmit={submit} className="enter" style={{ ['--i' as string]: 1 }}>
          <div className="brick">
            <div
              className={`p-3 sm:p-4 flex flex-col gap-3 ${over ? 'dropzone is-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              <label htmlFor="brief" className="sr-only">
                Brief
              </label>
              <textarea id="brief" className="textarea px-1 min-h-[9rem]" placeholder={copy.pastePlaceholder} value={text} onChange={(e) => setText(e.target.value)} />
              <div className="dropzone px-4 py-3 text-sm muted flex items-center gap-2">
                <Icon name="file" />
                {copy.dropHere}
              </div>
              {files.length || jira.length ? (
                <ul className="list-none m-0 p-0 flex flex-wrap gap-2">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="chip chip-quiet">
                      <Icon name="file" size={16} />
                      {f.name}
                      <button type="button" className="btn btn-ghost btn-sm btn-icon-only -mr-1" aria-label={`Remove ${f.name}`} onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}>
                        <Icon name="close" size={12} />
                      </button>
                    </li>
                  ))}
                  {jira.map((k) => (
                    <li key={k} className="chip chip-quiet">
                      <Icon name="jira" size={16} />
                      {k}
                    </li>
                  ))}
                </ul>
              ) : null}
              {jiraOpen ? (
                <div className="flex gap-2">
                  <label htmlFor="jira" className="sr-only">
                    {copy.jiraPlaceholder}
                  </label>
                  <input id="jira" className="input flex-1" placeholder={copy.jiraPlaceholder} value={jiraInput} onChange={(e) => setJiraInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addJira())} autoFocus />
                  <button type="button" className="btn btn-sm" onClick={addJira}>
                    Add
                  </button>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileInput} type="file" multiple accept=".md,.txt,.eml,.pdf,text/plain,application/pdf" className="sr-only" onChange={(e) => addFiles(e.target.files)} tabIndex={-1} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInput.current?.click()}>
                  <Icon name="clip" />
                  {copy.attach}
                </button>
                {jiraLive ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setJiraOpen((o) => !o)}>
                    <Icon name="link" />
                    {copy.addJira}
                  </button>
                ) : null}
                <button type="submit" className="btn btn-primary ml-auto" disabled={!hasInput || !live || readOnly}>
                  {copy.estimateButton}
                  <span className="btn-icon">
                    <Icon name="arrow" size={16} />
                  </span>
                </button>
              </div>
            </div>
          </div>
          {showDemoNote ? (
            <p className="m-0 mt-3 text-[15px] ink-2" role="status">
              {mode.kind === 'live' ? copy.liveNoClaude : copy.demoNeedsApi}
            </p>
          ) : null}
        </form>

        <div className="flex flex-col gap-3 enter" style={{ ['--i' as string]: 2 }}>
          <p className="m-0 label">{copy.tryExample}</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.sampleId}
                className="chip"
                disabled={readOnly}
                onClick={() => {
                  const id = startSample(ex.sampleId);
                  navigate(`/estimate/${id}`);
                }}
              >
                <Icon name="spark" size={16} />
                {ex.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
