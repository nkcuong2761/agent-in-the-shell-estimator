import { describe, expect, it } from 'vitest';
import { parseJiraRef } from './JiraPicker';

describe('Jira references in the brief box', () => {
  it('parseJiraRef reads a key from a key or a link', () => {
    expect(parseJiraRef('https://anduin.atlassian.net/browse/IDM-2123')).toBe('IDM-2123');
    expect(parseJiraRef('sub-142')).toBe('SUB-142');
    expect(parseJiraRef('hello')).toBeUndefined();
  });
});
