import { describe, expect, it } from 'vitest';
import type { Message } from '@scopewise/shared';
import { replaceLatestEstimate } from './conversations';

const msgs: Message[] = [
  { id: 'm1', createdAt: '2026-10-14T09:00:00.000Z', kind: 'user_brief', briefId: 'b', preview: 'p', files: [] },
  { id: 'm2', createdAt: '2026-10-14T09:00:01.000Z', kind: 'progress', intro: 'i', steps: [] },
  { id: 'm3', createdAt: '2026-10-14T09:00:02.000Z', kind: 'estimate', estimateId: 'v1' },
  { id: 'm4', createdAt: '2026-10-14T09:00:03.000Z', kind: 'answer', text: 'a' },
];

describe('in-place estimate updates', () => {
  it('replaces the latest estimate message and keeps the old version on edits[]', () => {
    const out = replaceLatestEstimate(msgs, 'v2', 'Updated: 2 developers', '2026-10-18T10:00:00.000Z');
    expect(out).toHaveLength(4);
    const est = out[2];
    expect(est?.kind).toBe('estimate');
    if (est?.kind !== 'estimate') return;
    expect(est.estimateId).toBe('v2');
    expect(est.changeNote).toBe('Updated: 2 developers');
    expect(est.edits).toEqual([{ estimateId: 'v1', changeNote: undefined, createdAt: '2026-10-14T09:00:02.000Z' }]);
    const again = replaceLatestEstimate(out, 'v3', 'Updated: hours', '2026-10-18T11:00:00.000Z');
    const e2 = again[2];
    if (e2?.kind === 'estimate') expect(e2.edits?.map((e) => e.estimateId)).toEqual(['v1', 'v2']);
  });
  it('appends when there is no estimate message yet', () => {
    const out = replaceLatestEstimate(msgs.slice(0, 2), 'v1', undefined, '2026-10-18T10:00:00.000Z');
    expect(out).toHaveLength(3);
    expect(out[2]?.kind).toBe('estimate');
  });
});
