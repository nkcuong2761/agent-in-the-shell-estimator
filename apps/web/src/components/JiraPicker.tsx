import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { JiraIssueSummary, JiraIssuesResponse } from '@scopewise/shared';
import { copy } from '../copy';
import { api } from '../lib/api';
import { Icon, Spinner, Tag } from './ui';

/** An issue key on its own ("SUB-142") or inside a link ("https://x.atlassian.net/browse/SUB-142"). */
export function parseJiraRef(input: string): string | undefined {
  return input.toUpperCase().match(/\b([A-Z][A-Z0-9]+-\d+)\b/)?.[1];
}

/** The list is fetched once per screen life; a later open shows it straight away. */
let cached: JiraIssuesResponse | null = null;

export type JiraPickerAvailability = 'ready' | 'no-jira' | 'no-api';

/**
 * The Attach Jira popover: a key-or-link input on top, then the project's ongoing tickets as a listbox.
 * Pasting works regardless of the list (a finished ticket is accepted here and handled on submit).
 */
export function JiraPicker({ availability, onPick, onClose }: { availability: JiraPickerAvailability; onPick: (key: string) => void; onClose: () => void }) {
  const [input, setInput] = useState('');
  const [bad, setBad] = useState(false);
  const [list, setList] = useState<JiraIssuesResponse | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (availability !== 'ready' || cached) return;
    let alive = true;
    api
      .jiraIssues()
      .then((r) => {
        cached = r;
        if (alive) setList(r);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'unknown error'));
    return () => {
      alive = false;
    };
  }, [availability]);

  // The picker opens upward over the brief box; make sure its top edge is on screen.
  useLayoutEffect(() => {
    box.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const q = input.trim().toLowerCase();
  const shown = (list?.issues ?? []).filter((i) => !q || i.key.toLowerCase().includes(q) || i.summary.toLowerCase().includes(q));
  const pick = (key: string) => {
    onPick(key);
    onClose();
  };
  const add = () => {
    const key = parseJiraRef(input);
    if (key) return pick(key);
    if (shown[active]) return pick(shown[active].key);
    setBad(input.trim().length > 0);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  return (
    <div ref={box} className="jira-picker" role="dialog" aria-label={copy.addJira}>
      <div className="flex gap-2">
        <label htmlFor={`${listId}-input`} className="sr-only">
          {copy.jiraPlaceholder}
        </label>
        <input
          id={`${listId}-input`}
          className="input flex-1"
          placeholder={copy.jiraPlaceholder}
          value={input}
          role="combobox"
          aria-controls={`${listId}-list`}
          aria-expanded={shown.length > 0}
          aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
          aria-invalid={bad || undefined}
          aria-describedby={bad ? `${listId}-error` : undefined}
          onChange={(e) => {
            setInput(e.target.value);
            setBad(false);
            setActive(0);
          }}
          onKeyDown={onKey}
          autoFocus
        />
        <button type="button" className="btn btn-sm" onClick={add}>
          {copy.jiraAdd}
        </button>
      </div>
      {bad ? (
        <p id={`${listId}-error`} className="m-0 text-[13px] danger" role="alert">
          {copy.jiraNotAKey}
        </p>
      ) : null}

      {availability === 'ready' ? (
        <>
          <p className="m-0 label">{copy.jiraOngoingIn(list?.projectKey ?? '…')}</p>
          {error ? (
            <p className="m-0 text-[13px] ink-2">{copy.jiraListFailed(error)}</p>
          ) : !list ? (
            <Spinner label={copy.jiraLoading} />
          ) : list.issues.length === 0 ? (
            <p className="m-0 text-[13px] ink-2">{copy.jiraNoOpen(list.projectKey)}</p>
          ) : shown.length === 0 ? (
            <p className="m-0 text-[13px] ink-2">{copy.jiraNoMatch}</p>
          ) : (
            <ul id={`${listId}-list`} role="listbox" aria-label={copy.jiraOngoingIn(list.projectKey)} className="jira-list list-none m-0 p-0">
              {shown.map((i, n) => (
                <JiraOption key={i.key} id={`${listId}-${n}`} issue={i} active={n === active} onHover={() => setActive(n)} onPick={() => pick(i.key)} />
              ))}
            </ul>
          )}
          <p className="m-0 text-[12px] muted">{copy.jiraPickHint}</p>
        </>
      ) : (
        <p className="m-0 text-[13px] ink-2">{availability === 'no-api' ? copy.jiraListNeedsApi : copy.liveNoJira}</p>
      )}
    </div>
  );
}

function JiraOption({ id, issue, active, onHover, onPick }: { id: string; issue: JiraIssueSummary; active: boolean; onHover: () => void; onPick: () => void }) {
  const tone = issue.statusCategory === 'indeterminate' ? 'accent' : 'muted';
  return (
    <li id={id} role="option" aria-selected={active} className={`jira-option ${active ? 'is-active' : ''}`} onPointerMove={onHover} onClick={onPick}>
      <Icon name="jira" size={14} />
      <span className="mono text-[12px] shrink-0">{issue.key}</span>
      <span className="truncate text-[13px] flex-1 min-w-0">{issue.summary}</span>
      <Tag tone={tone}>{issue.status}</Tag>
    </li>
  );
}
