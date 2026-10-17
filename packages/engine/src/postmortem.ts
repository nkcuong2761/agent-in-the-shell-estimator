import type { HistoryItem, HistoryProject, LessonCause, MissFinding, PostmortemResult } from '@scopewise/shared';
import { PHASE_TEMPLATES } from '@scopewise/shared';
import { DATA_ERROR_RATIO } from './analogs';
import { round } from './stats';

export const MISS_THRESHOLD = 0.25;

/**
 * Deterministic comparison of estimate vs actual per phase and item for a closed project.
 * Classifies each miss into a lesson cause from evidence in the data (labels, added-after-kickoff,
 * implausible ratios). The post-mortem agent phrases the notes; it may reclassify with a reason.
 */
export function compareProject(project: HistoryProject, items: readonly HistoryItem[]): MissFinding[] {
  const own = items.filter((i) => i.projectId === project.id);
  const findings: MissFinding[] = [];
  const leave = project.labels.includes('leave-overlap');
  for (const it of own) {
    const est = it.addedAfterKickoff ? 0 : it.originalEstimateH;
    const ratio = est > 0 ? it.timeSpentH / est : Infinity;
    const suspected = est > 0 && (ratio >= DATA_ERROR_RATIO || ratio <= 1 / DATA_ERROR_RATIO);
    if (!it.addedAfterKickoff && !suspected && Math.abs(ratio - 1) <= MISS_THRESHOLD) continue;
    let cause: LessonCause;
    if (suspected) cause = 'data-error';
    else if (it.addedAfterKickoff) cause = 'scope-added';
    else if (it.labels.includes('blocked')) cause = 'blocked';
    else if (leave && ratio > 1) cause = 'availability';
    else cause = 'underestimated';
    findings.push({
      scope: 'item',
      refId: it.id,
      title: it.title,
      estimateH: round(est),
      actualH: round(it.timeSpentH),
      ratio: Number.isFinite(ratio) ? round(ratio, 2) : 0,
      cause,
      note: '',
      suspectedDataError: suspected,
    });
  }
  for (const ph of PHASE_TEMPLATES[project.projectType]) {
    const phaseItems = own.filter((i) => i.phaseId === ph.id);
    if (!phaseItems.length) continue;
    const est = phaseItems.filter((i) => !i.addedAfterKickoff).reduce((s, i) => s + i.originalEstimateH, 0);
    const act = phaseItems.reduce((s, i) => s + i.timeSpentH, 0);
    const ratio = est > 0 ? act / est : 0;
    if (est > 0 && Math.abs(ratio - 1) <= MISS_THRESHOLD) continue;
    const itemCauses = findings.filter((f) => phaseItems.some((i) => i.id === f.refId));
    const dominant = (itemCauses.sort((a, b) => b.actualH - b.estimateH - (a.actualH - a.estimateH))[0]?.cause ?? 'underestimated') as LessonCause;
    findings.push({
      scope: 'phase',
      refId: ph.id,
      title: ph.name,
      estimateH: round(est),
      actualH: round(act),
      ratio: round(ratio, 2),
      cause: dominant,
      note: '',
      suspectedDataError: false,
    });
  }
  return findings;
}

const CAUSE_TEMPLATES: Record<LessonCause, (f: MissFinding) => string> = {
  'scope-added': (f) => `${f.title} wasn't in the kickoff scope and cost ${Math.round(f.actualH)}h. Ask about it up front next time.`,
  underestimated: (f) => `${f.title} took ${f.ratio}× its estimate. Similar work needs a larger likely value.`,
  blocked: (f) => `${f.title} waited on an outside dependency and ran ${f.ratio}× over. Confirm access and owners before build starts.`,
  availability: (f) => `${f.title} ran ${f.ratio}× over while capacity was reduced by planned leave. Plan around known leave windows.`,
  'data-error': (f) => `${f.title} logged ${Math.round(f.actualH)}h against ${Math.round(f.estimateH)}h, which looks like a time-entry error. Excluded from calibration.`,
};

/** Template notes, used offline (no Claude) and as a fallback when the agent fails validation. */
export function offlinePostmortem(project: HistoryProject, items: readonly HistoryItem[]): PostmortemResult {
  const findings = compareProject(project, items).map((f) => ({ ...f, note: CAUSE_TEMPLATES[f.cause](f) }));
  const itemFindings = findings.filter((f) => f.scope === 'item');
  const delta = project.actualH - project.estimateH;
  const byCause = new Map<LessonCause, number>();
  for (const f of itemFindings) byCause.set(f.cause, (byCause.get(f.cause) ?? 0) + (f.actualH - f.estimateH));
  const top = [...byCause.entries()].sort((a, b) => b[1] - a[1])[0];
  const lessons = itemFindings
    .filter((f) => f.cause !== 'data-error')
    .sort((a, b) => b.actualH - b.estimateH - (a.actualH - a.estimateH))
    .slice(0, 2)
    .map((f) => ({
      cause: f.cause,
      note: f.note,
      appliesTo: { category: items.find((i) => i.id === f.refId)?.category, projectType: project.projectType },
    }));
  return {
    projectId: project.id,
    summary:
      `${project.name} came in at ${Math.round(project.actualH)}h against ${Math.round(project.estimateH)}h estimated (${delta >= 0 ? '+' : ''}${Math.round(delta)}h).` +
      (top ? ` Most of the gap was ${top[0].replace('-', ' ')}.` : ''),
    findings,
    lessons,
  };
}
