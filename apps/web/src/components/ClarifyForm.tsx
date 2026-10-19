import { useId, useState, type FormEvent } from 'react';
import type { LessonCause, RealProject } from '@scopewise/shared';
import { LessonCause as LessonCauseSchema } from '@scopewise/shared';
import { copy } from '../copy';
import type { Clarify } from '../present/project';
import { updateRealProject } from '../state/realProjects';

/**
 * On a finished ticket with no hours in Jira, the page cannot say why it took the time it did. This form asks
 * the user: hours of work, a cause, a note. Saving writes the hours onto the ticket's items (so it joins the
 * hour-based history), adds the lesson to its post-mortem, and keeps it (API store when live, local mirror always).
 */
export function ClarifyForm({ real, clarify, onSaved }: { real: RealProject; clarify: Clarify; onSaved?: () => void }) {
  const id = useId();
  const [hours, setHours] = useState('');
  const [cause, setCause] = useState<LessonCause>('underestimated');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const h = Number(hours.replace(',', '.'));
  const hasHours = hours.trim() !== '' && Number.isFinite(h) && h > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const title = real.project.name;
    const lessonNote = note.trim() || `${copy.causeWords[cause]}: ${title.toLowerCase()}.`;
    const items = hasHours ? spreadHours(real, h) : real.items;
    const project = hasHours
      ? { ...real.project, actualH: round1(h), estimateH: real.project.estimateH || round1(sumEstimate(items)), labels: real.project.labels.filter((l) => l !== 'dates-only') }
      : real.project;
    const findings = hasHours
      ? [{ scope: 'item' as const, refId: real.items[0]?.id ?? real.project.id, title, estimateH: project.estimateH, actualH: project.actualH, ratio: project.estimateH > 0 ? round1(project.actualH / project.estimateH) : 1, cause, note: lessonNote, suspectedDataError: cause === 'data-error' }]
      : real.postmortem.findings;
    updateRealProject({
      ...real,
      project,
      items,
      postmortem: {
        ...real.postmortem,
        summary: hasHours ? `${title}: about ${Math.round(h)} hours of work, told to us by the team. ${copy.causeWords[cause]}.` : real.postmortem.summary,
        findings,
        lessons: [{ cause, note: lessonNote, appliesTo: { category: real.items[0]?.category, projectType: real.project.projectType } }, ...real.postmortem.lessons],
      },
    });
    setSaved(true);
    onSaved?.();
  };

  if (saved) return <p className="m-0 text-[15px] leading-relaxed">{copy.clarifySaved}</p>;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-clarify>
      <p className="m-0 text-[15px] leading-relaxed ink-2">{clarify.intro}</p>
      <label htmlFor={`${id}-h`} className="text-[13px] muted leading-tight">
        {clarify.hoursQuestion}
      </label>
      <input id={`${id}-h`} className="input" inputMode="decimal" placeholder={copy.hoursPlaceholder} value={hours} onChange={(e) => setHours(e.target.value)} />
      <label htmlFor={`${id}-c`} className="text-[13px] muted leading-tight">
        {clarify.causeQuestion}
      </label>
      <select id={`${id}-c`} className="select" value={cause} onChange={(e) => setCause(LessonCauseSchema.parse(e.target.value))}>
        {LessonCauseSchema.options.map((c) => (
          <option key={c} value={c}>
            {copy.causeWords[c]}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-n`} className="text-[13px] muted leading-tight">
        {clarify.noteQuestion}
      </label>
      <textarea id={`${id}-n`} className="textarea px-2 min-h-[4rem]" placeholder={copy.notePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} />
      <button type="submit" className="btn btn-primary self-start">
        {copy.clarifySave}
      </button>
    </form>
  );
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const sumEstimate = (items: RealProject['items']) => items.reduce((s, i) => s + i.originalEstimateH, 0);

/** Hours the user gave, shared across the ticket's items in proportion to their estimates (evenly when there are none). */
function spreadHours(real: RealProject, total: number): RealProject['items'] {
  const est = sumEstimate(real.items);
  const n = real.items.length || 1;
  return real.items.map((i) => ({
    ...i,
    timeSpentH: round1(est > 0 ? (total * i.originalEstimateH) / est : total / n),
    // A ticket with no estimate at all gets the hours as its estimate too, so the ratio is 1 and the bias stays clean.
    originalEstimateH: i.originalEstimateH > 0 ? i.originalEstimateH : round1(total / n),
    labels: i.labels.filter((l) => l !== 'dates-only'),
  }));
}
