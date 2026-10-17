/**
 * Post-mortem agent. The engine (compareProject) finds the misses and classifies causes from evidence; Claude
 * writes the notes, summary and lessons, may reclassify a cause with a stated reason, and may flag further
 * suspected data-entry errors. Numbers are never taken from Claude. Falls back to offlinePostmortem on failure.
 */
import { z } from 'zod';
import type { HistoryItem, HistoryProject, MissFinding, PostmortemResult, Provenance } from '@scopewise/shared';
import { Category, LessonCause, PostmortemResult as PostmortemResultSchema, ProjectType } from '@scopewise/shared';
import { compareProject, offlinePostmortem } from '@scopewise/engine';
import { callStructured, provenance } from '../claude';
import { loadPrompt } from '../data';
import { env } from '../env';

export const OFFLINE_POSTMORTEM_VERSION = 'offline-heuristic-postmortem@1';

const PostmortemDraft = z.object({
  summary: z.string().min(1).max(1200),
  notes: z.array(
    z.object({
      scope: z.enum(['phase', 'item']),
      refId: z.string(),
      note: z.string().min(1).max(400),
      cause: LessonCause.optional(),
      reclassifiedReason: z.string().max(400).optional(),
    }),
  ),
  suspectedDataErrors: z.array(z.object({ refId: z.string(), reason: z.string().max(400) })).default([]),
  lessons: z
    .array(
      z.object({
        cause: LessonCause,
        note: z.string().min(1).max(300),
        appliesTo: z.object({ category: Category.optional(), projectType: ProjectType.optional() }),
      }),
    )
    .min(1)
    .max(3),
});
type PostmortemDraft = z.infer<typeof PostmortemDraft>;

const key = (scope: string, refId: string) => `${scope}:${refId}`;

function findingsBlock(project: HistoryProject, items: readonly HistoryItem[], findings: MissFinding[]): string {
  const byId = new Map(items.map((i) => [i.id, i]));
  return [
    `<project id="${project.id}" type="${project.projectType}" size="${project.size}" squad="${project.squad}">`,
    `name: ${project.name}`,
    `dates: ${project.startDate} to ${project.endDate}`,
    `estimate ${project.estimateH}h, actual ${project.actualH}h`,
    `labels: ${project.labels.join(', ')}`,
    '</project>',
    '<findings>',
    ...findings.map((f) => {
      const it = f.scope === 'item' ? byId.get(f.refId) : undefined;
      const extra = it ? `; category ${it.category}; phase ${it.phaseId}; labels ${it.labels.filter((l) => !l.startsWith('seed:')).join(', ')}` : '';
      return `- scope ${f.scope}, refId ${f.refId}: "${f.title}" estimate ${f.estimateH}h, actual ${f.actualH}h, ratio ${f.ratio}; engine cause ${f.cause}${f.suspectedDataError ? ' (suspected data-entry error)' : ''}${extra}`;
    }),
    '</findings>',
  ].join('\n');
}

export function mergePostmortem(
  project: HistoryProject,
  findings: MissFinding[],
  draft: PostmortemDraft,
): PostmortemResult {
  const notes = new Map(draft.notes.map((n) => [key(n.scope, n.refId), n]));
  const suspected = new Map(draft.suspectedDataErrors.map((s) => [s.refId, s.reason]));
  const merged = findings.map((f) => {
    const n = notes.get(key(f.scope, f.refId));
    let cause = f.cause;
    let note = n?.note ?? '';
    // The engine's data-error flag is authoritative; other causes change only with a stated reason.
    if (n?.cause && n.cause !== f.cause && n.reclassifiedReason && f.cause !== 'data-error') {
      cause = n.cause;
      note = `${note} (Reclassified from ${f.cause}: ${n.reclassifiedReason})`;
    }
    const extra = f.scope === 'item' ? suspected.get(f.refId) : undefined;
    if (extra && !f.suspectedDataError) note = `${note} Possible time-entry error: ${extra}`;
    return { ...f, cause, note: note.trim(), suspectedDataError: f.suspectedDataError || Boolean(extra) };
  });
  return PostmortemResultSchema.parse({
    projectId: project.id,
    summary: draft.summary,
    findings: merged,
    lessons: draft.lessons.map((l) => ({ ...l, appliesTo: { ...l.appliesTo, projectType: l.appliesTo.projectType ?? project.projectType } })),
  });
}

export async function runPostmortem(
  project: HistoryProject,
  items: HistoryItem[],
): Promise<{ result: PostmortemResult; provenance: Provenance }> {
  const prompt = loadPrompt('postmortem');
  const findings = compareProject(project, items);
  const fallback = () => ({
    result: offlinePostmortem(project, items),
    provenance: { promptVersion: OFFLINE_POSTMORTEM_VERSION, generatedBy: 'offline-heuristic' as const, generatedAt: new Date().toISOString() },
  });
  if (!env.anthropicKey()) return fallback();
  try {
    const wanted = new Set(findings.map((f) => key(f.scope, f.refId)));
    const { value, model } = await callStructured({
      label: 'post-mortem agent',
      system: prompt.text,
      user: findingsBlock(project, items, findings),
      tool: { name: 'submit_postmortem', description: 'Submit the post-mortem notes, summary and lessons.', schema: PostmortemDraft },
      check: (d) => {
        const got = new Set(d.notes.map((n) => key(n.scope, n.refId)));
        const missing = [...wanted].filter((k) => !got.has(k));
        return missing.length ? [`Missing notes for findings: ${missing.join(', ')}.`] : [];
      },
      maxTokens: 12000,
      effort: 'low',
    });
    return { result: mergePostmortem(project, findings, value), provenance: provenance(prompt.version, model) };
  } catch (err) {
    console.warn(`[postmortem] ${project.id}: agent failed, using engine template notes:`, err instanceof Error ? err.message : err);
    return fallback();
  }
}
