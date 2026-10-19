import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BriefPack, HistoryItem, HistoryProject, ProjectType } from '@scopewise/shared';
import { ScopeResult } from '@scopewise/shared';
import { detectProjectType, offlineScope } from '../src';

const data = (p: string) => JSON.parse(readFileSync(join(__dirname, '../../../data', p), 'utf8')) as unknown;
const samples = data('demo-cache/samples.json') as { meta: { id: string; projectType: ProjectType; plantedGaps: { id: string; keywords: string[] }[] }; brief: BriefPack }[];
const history = { projects: data('seed/projects.json') as HistoryProject[], items: data('seed/items.json') as HistoryItem[] };

describe('offline scope (rule-based reader)', () => {
  it('detects each sample\'s project type', () => {
    for (const s of samples) {
      const text = s.brief.sources.map((x) => x.text).join('\n');
      expect(detectProjectType(text).type, s.meta.id).toBe(s.meta.projectType);
    }
  });

  it('produces a valid scope with cited items, questions that cover the planted gaps, and risks from history', () => {
    for (const s of samples) {
      const scope = offlineScope(s.brief, history);
      expect(() => ScopeResult.parse(scope)).not.toThrow();
      expect(scope.items.length).toBeGreaterThanOrEqual(8);
      const names = new Set(s.brief.sources.map((x) => x.name));
      for (const it of scope.items) {
        expect(it.sourceRefs.length).toBeGreaterThan(0);
        for (const r of it.sourceRefs) expect(names.has(r.source)).toBe(true);
        expect(it.o).toBeLessThanOrEqual(it.m);
        expect(it.m).toBeLessThanOrEqual(it.p);
        expect(scope.phases.some((p) => p.id === it.phaseId)).toBe(true);
      }
      const corpus = scope.missingInfo.map((q) => q.question.toLowerCase());
      for (const gap of s.meta.plantedGaps) {
        expect(gap.keywords.some((k) => corpus.some((q) => q.includes(k.toLowerCase()))), `${s.meta.id}: ${gap.id}`).toBe(true);
      }
      for (const q of scope.missingInfo) for (const id of q.affectedItemIds) expect(scope.items.find((i) => i.id === id)?.affectedByQuestions).toContain(q.id);
      expect(scope.scopeRisks.length).toBeGreaterThan(0);
      expect(scope.clientEmailDraft).toContain('{{questions}}');
      expect(scope.title.length).toBeGreaterThan(3);
    }
  });

  it('is deterministic and falls back to new-feature for a vague brief', () => {
    const brief: BriefPack = { id: 'b', title: 'New brief', sources: [{ kind: 'notes', name: 'pasted-brief.txt', text: 'We would like a button that lets investors download their documents. Needed by 3 March.' }] };
    const a = offlineScope(brief);
    const b = offlineScope(brief);
    expect(a).toEqual(b);
    expect(a.projectType).toBe('new-feature');
    expect(a.size).toBe('S');
    expect(a.missingInfo.map((q) => q.id)).not.toContain('q-deadline');
    expect(a.title).toBe('New brief'.length ? 'We would like a button that lets investors…' : '');
  });
});
