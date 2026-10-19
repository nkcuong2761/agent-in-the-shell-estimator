import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { copy } from '../copy';
import { extractJiraRefs, JiraPicker, parseJiraRef } from '../components/JiraPicker';
import { Icon, Mark } from '../components/ui';
import { useConversations } from '../state/conversations';
import { addRealProject } from '../state/realProjects';
import { api } from '../lib/api';

export { parseJiraRef };

const EXAMPLES: { label: string; sampleId: string }[] = [
  { label: 'Put a paper form online', sampleId: 'subscription-form' },
  { label: 'Remind investors to sign', sampleId: 'investor-reminders' },
  { label: 'Sync with a fund administrator', sampleId: 'fund-admin-sync' },
];

export function NewEstimate() {
  const { mode, startSample, startBrief, readOnly } = useConversations();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [jira, setJira] = useState<string[]>([]);
  const [jiraOpen, setJiraOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const jiraWrap = useRef<HTMLDivElement>(null);
  const live = mode.kind === 'live';
  const jiraLive = live && mode.health.features.jira;
  const hasInput = text.trim().length > 0 || files.length > 0 || jira.length > 0;
  // Pasted text is read in the browser when there is no API. Files and Jira tickets need the API (and Jira set up).
  const needsApi = files.length > 0 || jira.length > 0;
  const canSubmit = hasInput && !readOnly && !busy && (live ? jira.length === 0 || jiraLive : !needsApi);
  const note =
    problem ??
    busy ??
    (!hasInput
      ? ''
      : !live && needsApi
        ? copy.demoNeedsApi
        : live && jira.length > 0 && !jiraLive
          ? copy.liveNoJira
          : live && !mode.health.features.claude
            ? copy.liveNoClaude
            : !live
              ? copy.demoOffline
              : '');

  // The picker closes on Escape and on a pointer down outside it (the same pattern as the date field).
  useEffect(() => {
    if (!jiraOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setJiraOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!jiraWrap.current?.contains(e.target as Node)) setJiraOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [jiraOpen]);

  const addFiles = (list: FileList | null) => setFiles((f) => [...f, ...Array.from(list ?? [])].slice(0, 10));
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    addFiles(e.dataTransfer.files);
  };
  const addJira = (key: string) => {
    setJira((j) => [...new Set([...j, key])]);
    setProblem(null);
  };
  // A Jira link pasted or typed into the brief becomes a ticket chip, the same as one picked from the list.
  const onText = (value: string) => {
    const { text: cleaned, keys } = extractJiraRefs(value);
    setText(cleaned);
    if (keys.length) {
      setJira((j) => [...new Set([...j, ...keys])]);
      setProblem(null);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setProblem(null);
    // One ticket and nothing else: a finished ticket opens its results instead of a new estimate.
    const only = jira.length === 1 && !text.trim() && files.length === 0 ? jira[0] : undefined;
    if (only && jiraLive) {
      setBusy(copy.jiraReading(only));
      try {
        const issue = await api.jiraIssue(only);
        if (issue.statusCategory === 'done') {
          setBusy(copy.jiraImporting(only));
          const imported = await api.jiraImport(only);
          addRealProject(imported);
          navigate(`/project/${encodeURIComponent(imported.project.id)}`);
          return;
        }
      } catch (err) {
        setProblem(copy.jiraImportFailed(err instanceof Error ? err.message : 'unknown error'));
        setBusy(null);
        return;
      }
      setBusy(null);
    }
    const id = startBrief({ text, files, jiraKeys: jira });
    navigate(`/estimate/${id}`);
  };

  return (
    <div className="flex-1 flex flex-col justify-center px-4 py-12 sm:py-20">
      <div className="w-full max-w-[46rem] mx-auto flex flex-col gap-8">
        <div className="flex flex-col gap-4 enter">
          <Mark size={44} />
          <h1 className="h-hero m-0">{copy.askHeading}</h1>
          <p className="m-0 text-lg leading-relaxed ink-2 measure">{copy.askSub}</p>
        </div>

        {/* While the picker is open the form sits above the example chips (each `.enter` block is its own stacking context). */}
        <form onSubmit={(e) => void submit(e)} className={`enter relative ${jiraOpen ? 'z-30' : ''}`} style={{ ['--i' as string]: 1 }}>
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
              <textarea id="brief" className="textarea px-1 min-h-[9rem]" placeholder={copy.pastePlaceholder} value={text} onChange={(e) => onText(e.target.value)} />
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
                      <button type="button" className="btn btn-ghost btn-sm btn-icon-only -mr-1" aria-label={`Remove ${k}`} onClick={() => setJira((j) => j.filter((x) => x !== k))}>
                        <Icon name="close" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="dropzone px-4 py-3 text-sm muted flex items-center gap-2">
                <Icon name="file" />
                {copy.dropHere}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileInput} type="file" multiple accept=".md,.txt,.eml,.pdf,text/plain,application/pdf" className="sr-only" onChange={(e) => addFiles(e.target.files)} tabIndex={-1} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInput.current?.click()}>
                  <Icon name="clip" />
                  {copy.attach}
                </button>
                <div ref={jiraWrap} className="relative">
                  <button type="button" className="btn btn-ghost btn-sm" aria-haspopup="dialog" aria-expanded={jiraOpen} onClick={() => setJiraOpen((o) => !o)}>
                    <Icon name="jira" />
                    {copy.addJira}
                  </button>
                  {jiraOpen ? <JiraPicker availability={jiraLive ? 'ready' : live ? 'no-jira' : 'no-api'} onPick={addJira} onClose={() => setJiraOpen(false)} /> : null}
                </div>
                <button type="submit" className="btn btn-primary ml-auto" disabled={!canSubmit} aria-busy={busy ? true : undefined}>
                  {copy.estimateButton}
                  <span className="btn-icon">
                    <Icon name="arrow" size={16} />
                  </span>
                </button>
              </div>
            </div>
          </div>
          {note ? (
            <p className={`m-0 mt-3 text-[15px] ${problem ? 'danger' : 'ink-2'}`} role="status">
              {note}
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
