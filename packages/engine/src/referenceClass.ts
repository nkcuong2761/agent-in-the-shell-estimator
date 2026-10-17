import type { HistoryProject, ProjectType, ReferenceClass, Size } from '@scopewise/shared';
import { CITATIONS, type Explained } from './explain';
import { quantile, round } from './stats';

export const MIN_REFERENCE_CLASS = 3;

/** Distribution of actual total hours for closed projects of the same type and size. */
export function referenceClass(
  projects: readonly HistoryProject[],
  projectType: ProjectType,
  size: Size,
): Explained<ReferenceClass> {
  const closed = projects.filter((p) => p.status === 'closed' && p.projectType === projectType);
  let matches = closed.filter((p) => p.size === size);
  let relaxed = false;
  if (matches.length < MIN_REFERENCE_CLASS) {
    matches = closed;
    relaxed = true;
  }
  const actuals = matches.map((p) => p.actualH);
  const value: ReferenceClass = {
    n: matches.length,
    median: round(quantile(actuals, 0.5)),
    p20: round(quantile(actuals, 0.2)),
    p80: round(quantile(actuals, 0.8)),
    projectIds: matches.map((p) => p.id),
    relaxed,
  };
  const scope = relaxed ? `${projectType} projects of any size` : `${size} ${projectType} projects`;
  return {
    value,
    explanation: {
      method: 'Reference class forecasting',
      citation: CITATIONS.referenceClass,
      plainWords:
        value.n === 0
          ? `No closed ${projectType} projects yet, so there is no outside view to compare against.`
          : `Across ${value.n} closed ${scope}, the middle 60% took ${value.p20}–${value.p80} hours (median ${value.median}).`,
      formula: 'P20, median, P80 of actual total hours over matching closed projects',
      inputs: { projectType, size, n: value.n, relaxedSizeFilter: relaxed ? 'yes' : 'no' },
    },
  };
}
