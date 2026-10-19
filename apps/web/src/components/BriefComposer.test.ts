import { describe, expect, it } from 'vitest';
import { readSegments, toValue } from './BriefComposer';

function box(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('brief composer serialisation', () => {
  it('reads text and inline ticket chips in order', () => {
    const el = box('Read <span data-jira="IDM-2389" class="chip chip-inline">x IDM-2389 <button>×</button></span> and estimate with a 10% buffer');
    const v = toValue(readSegments(el));
    expect(v.text).toBe('Read IDM-2389 and estimate with a 10% buffer');
    expect(v.keys).toEqual(['IDM-2389']);
    expect(v.onlyChips).toBe(false);
  });

  it('knows when the box holds nothing but chips, and keeps line breaks', () => {
    const only = box('<span data-jira="IDM-1">IDM-1</span> <span data-jira="IDM-2">IDM-2</span> ');
    expect(toValue(readSegments(only))).toEqual({ text: 'IDM-1 IDM-2', keys: ['IDM-1', 'IDM-2'], onlyChips: true });
    const lines = box('first line<br>second<div>third</div>');
    expect(toValue(readSegments(lines)).text).toBe('first line\nsecond\nthird');
  });

  it('pads a chip with spaces when the text around it has none', () => {
    const el = box('buffer<span data-jira="IDM-2388">x</span>please');
    expect(toValue(readSegments(el)).text).toBe('buffer IDM-2388 please');
  });

  it('lists each ticket once', () => {
    const el = box('<span data-jira="IDM-7">a</span> twice <span data-jira="IDM-7">b</span>');
    expect(toValue(readSegments(el)).keys).toEqual(['IDM-7']);
  });
});
