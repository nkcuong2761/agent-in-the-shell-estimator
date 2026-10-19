import { describe, expect, it } from 'vitest';
import { extractJiraRefs, parseJiraRef } from './JiraPicker';

describe('Jira references in the brief box', () => {
  it('turns a pasted link into a chip and removes it from the text', () => {
    expect(extractJiraRefs('https://anduin.atlassian.net/browse/IDM-2123')).toEqual({ text: '', keys: ['IDM-2123'] });
    expect(extractJiraRefs('See https://anduin.atlassian.net/browse/IDM-2123?focusedCommentId=1 and tell me')).toEqual({ text: 'See and tell me', keys: ['IDM-2123'] });
    expect(extractJiraRefs('https://x.atlassian.net/jira/software/projects/IDM/boards/3?selectedIssue=IDM-7')).toEqual({ text: '', keys: ['IDM-7'] });
  });
  it('accepts a bare key on its own but leaves a key inside a sentence', () => {
    expect(extractJiraRefs(' idm-2123 ')).toEqual({ text: '', keys: ['IDM-2123'] });
    const prose = 'Like IDM-2123 but for funds';
    expect(extractJiraRefs(prose)).toEqual({ text: prose, keys: [] });
  });
  it('parseJiraRef reads a key from a key or a link', () => {
    expect(parseJiraRef('https://anduin.atlassian.net/browse/IDM-2123')).toBe('IDM-2123');
    expect(parseJiraRef('sub-142')).toBe('SUB-142');
    expect(parseJiraRef('hello')).toBeUndefined();
  });
});
