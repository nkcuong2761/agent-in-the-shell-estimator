import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { copy } from '../copy';

/**
 * The brief box: an editable area where Jira tickets live inline with the text as chips, so a brief can read
 * "Read {IDM-2389} and estimate with a 10% buffer". A pasted or typed Jira link stays visible as the link for a
 * moment (long enough to see what was recognised), then turns into a chip in place. Chips are atomic: Backspace
 * removes a whole one, and each has its own ×.
 *
 * The DOM is the source of truth while typing (so the caret never jumps); `read()` serialises it to segments.
 * The parent only writes into the DOM through the handle (insert a chip, clear), never by re-rendering text.
 */
export type Segment = { kind: 'text'; value: string } | { kind: 'jira'; key: string };

export interface BriefValue {
  /** Plain text with each chip written as its key, e.g. "Read IDM-2389 and estimate…". */
  text: string;
  /** Ticket keys in order of appearance, without repeats. */
  keys: string[];
  /** True when the box holds nothing but one or more chips. */
  onlyChips: boolean;
}

export interface BriefComposerHandle {
  insertChip: (key: string) => void;
  focus: () => void;
}

/** A Jira issue link: …/browse/KEY, …/issues/KEY or a ?selectedIssue=KEY query. */
const JIRA_LINK = /https?:\/\/\S*?(?:\/browse\/|\/issues\/|[?&]selectedIssue=)([A-Za-z][A-Za-z0-9]+-\d+)\S*/;
/** A bare key typed as its own word, finished with a space or a line break so a half-typed key is left alone. */
const BARE_KEY = /(^|\s)([A-Za-z][A-Za-z0-9]+-\d+)(?=\s)/;
/** How long a recognised link stays as text before it becomes a chip. */
export const LINK_HOLD_MS = 650;

export function readSegments(root: HTMLElement): Segment[] {
  const out: Segment[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') last.value += t;
    else out.push({ kind: 'text', value: t });
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) return pushText(node.textContent ?? '');
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.jira) return void out.push({ kind: 'jira', key: node.dataset.jira });
    if (node.tagName === 'BR') return pushText('\n');
    const block = node.tagName === 'DIV' || node.tagName === 'P';
    const last = out[out.length - 1];
    if (block && last && !(last.kind === 'text' && last.value.endsWith('\n'))) pushText('\n');
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out;
}

export function toValue(segments: Segment[]): BriefValue {
  const keys = [...new Set(segments.filter((s): s is { kind: 'jira'; key: string } => s.kind === 'jira').map((s) => s.key))];
  // A chip reads as its key, with a space on each side unless the text already has one.
  let text = '';
  for (const s of segments) {
    if (s.kind === 'text') text += s.value;
    else text += `${text && !/\s$/.test(text) ? ' ' : ''}${s.key} `;
  }
  text = text.replace(/\u00a0/g, ' ').replace(/ {2,}/g, ' ').replace(/ \n/g, '\n').trim();
  const prose = segments
    .filter((s): s is { kind: 'text'; value: string } => s.kind === 'text')
    .map((s) => s.value)
    .join('')
    .replace(/\u00a0/g, ' ')
    .trim();
  return { text, keys, onlyChips: keys.length > 0 && prose === '' };
}

function chipElement(key: string, fresh: boolean): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = `chip chip-inline${fresh ? ' chip-fresh' : ''}`;
  chip.contentEditable = 'false';
  chip.dataset.jira = key;
  chip.setAttribute('role', 'img');
  chip.setAttribute('aria-label', `${copy.jiraTicketWord} ${key}`);
  chip.innerHTML = `<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M10 3l7 7-7 7-7-7 7-7zM10 7l3 3-3 3-3-3 3-3z"></path></svg>`;
  chip.append(key);
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'chip-x';
  x.setAttribute('aria-label', `${copy.removeWord} ${key}`);
  x.textContent = '×';
  chip.append(x);
  if (fresh) window.setTimeout(() => chip.classList.remove('chip-fresh'), 1000);
  return chip;
}

/** Replace the first link (or finished bare key) inside a text node with a chip, keeping the caret after it. */
function convertIn(root: HTMLElement): string | undefined {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    const link = JIRA_LINK.exec(text);
    const bare = link ? null : BARE_KEY.exec(text);
    if (!link && !bare) continue;
    const m = (link ?? bare) as RegExpExecArray;
    const start = link ? m.index : m.index + (m[1] ?? '').length;
    const matched = (link ? m[0] : m[2]) ?? '';
    const key = ((link ? m[1] : m[2]) ?? '').toUpperCase();
    const length = matched.length;
    const t = node as Text;
    const after = t.splitText(start);
    after.textContent = (after.textContent ?? '').slice(length);
    const chip = chipElement(key, true);
    after.before(chip);
    // A space after the chip so typing continues naturally; place the caret there.
    if (!after.textContent?.startsWith(' ')) after.textContent = ` ${after.textContent ?? ''}`;
    const range = document.createRange();
    range.setStart(after, 1);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return key;
  }
  return undefined;
}

export const BriefComposer = forwardRef<BriefComposerHandle, { onChange: (v: BriefValue) => void; onLinked?: (keys: string[]) => void; placeholder: string }>(
  function BriefComposer({ onChange, onLinked, placeholder }, ref) {
    const el = useRef<HTMLDivElement>(null);
    const timer = useRef<number | null>(null);
    const [empty, setEmpty] = useState(true);

    const emit = () => {
      if (!el.current) return;
      const v = toValue(readSegments(el.current));
      setEmpty(v.text === '');
      onChange(v);
    };

    /** Links are left as text for a moment, then converted; one pass converts every link present by then. */
    const scheduleConvert = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        if (!el.current) return;
        const keys: string[] = [];
        for (let k = convertIn(el.current); k; k = convertIn(el.current)) keys.push(k);
        if (keys.length) {
          onLinked?.(keys);
          emit();
        }
      }, LINK_HOLD_MS);
    };

    useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

    useImperativeHandle(ref, () => ({
      insertChip: (key: string) => {
        const root = el.current;
        if (!root) return;
        const chip = chipElement(key, true);
        const sel = window.getSelection();
        const inside = sel && sel.rangeCount > 0 && root.contains(sel.getRangeAt(0).startContainer);
        if (inside) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(chip);
        } else root.append(chip);
        const space = document.createTextNode(' ');
        chip.after(space);
        const range = document.createRange();
        range.setStart(space, 1);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
        root.focus();
        emit();
      },
      focus: () => el.current?.focus(),
    }));

    const onInput = () => {
      emit();
      scheduleConvert();
    };
    const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
      // Plain text only, so pasted HTML never brings its own markup into the box.
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        document.execCommand('insertText', false, '\n');
      }
    };
    const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const x = (e.target as HTMLElement).closest('.chip-x');
      if (!x) return;
      e.preventDefault();
      x.closest('[data-jira]')?.remove();
      emit();
    };

    return (
      <div
        ref={el}
        id="brief"
        className="composer"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={copy.briefLabel}
        data-placeholder={placeholder}
        data-empty={empty || undefined}
        suppressContentEditableWarning
        onInput={onInput}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onClick={onClick}
      />
    );
  },
);
