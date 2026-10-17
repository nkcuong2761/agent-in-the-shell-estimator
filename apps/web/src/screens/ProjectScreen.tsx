import { Link, useParams } from 'react-router-dom';
import { copy } from '../copy';
import { Card, Spinner } from '../components/ui';
import { finishedLine, toHappened, toImprovement, toLesson } from '../present';
import { useHistory, usePostmortems } from '../state/history';

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ProjectScreen() {
  const { id = '' } = useParams();
  const history = useHistory();
  const pms = usePostmortems();
  if (!history) {
    return (
      <div className="thread">
        <Spinner label="Looking back at finished projects" />
      </div>
    );
  }
  const f = history.finished.find((x) => x.project.id === id);
  if (!f) {
    return (
      <div className="thread">
        <p className="m-0 text-lg">{copy.notFound}</p>
        <Link to="/" className="btn btn-primary self-start no-underline">
          {copy.backToNew}
        </Link>
      </div>
    );
  }
  const pm = pms?.results.find((r) => r.projectId === id);
  const happened = toHappened(pm);
  const lesson = toLesson(pm, f.project);
  const imp = toImprovement(history.points, id);
  const o = f.outcome;
  const scale = Math.max(o.tookWeeks, o.said.high) * 1.15;
  const pct = (w: number) => `${(w / scale) * 100}%`;
  const maxOff = Math.max(...imp.bars.map((b) => b.offPct), 10);
  const [client, name] = f.project.name.split(': ');

  return (
    <div className="thread">
      <header className="flex flex-col gap-2 enter">
        <p className="m-0 text-[15px] muted">{client}</p>
        <h1 className="h-page m-0">{capitalise(name ?? f.project.name)}</h1>
        <p className="m-0 muted">{finishedLine(f.project)}</p>
      </header>

      <Card inner="p-5 sm:p-6 flex flex-col gap-5" className="enter" style={{ ['--i' as string]: 1 }}>
        <h2 className="h-card m-0">{copy.howDidItDo}</h2>
        <p className="m-0 text-2xl font-semibold tracking-tight leading-snug">{o.sentence}</p>
        <div className="flex flex-col gap-3" role="img" aria-label={`Estimated ${o.said.text}; actual ${o.took}.`}>
          <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 items-center">
            <span className="text-[14px] muted">{copy.estimated}</span>
            <span className="track block">
              <span className="seg-likely" style={{ left: pct(o.said.low), width: pct(Math.max(0.15, o.said.high - o.said.low)), opacity: 0.85 }} />
            </span>
          </div>
          <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 items-center">
            <span className="text-[14px] muted">{copy.actual}</span>
            <span className="track block">
              <span className="seg-actual" style={{ left: 0, width: pct(o.tookWeeks) }} />
            </span>
          </div>
          <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
            <span />
            <div className="relative h-4 text-[12px] muted num" aria-hidden="true">
              {Array.from({ length: Math.floor(scale) + 1 }, (_, w) => w)
                .filter((w) => scale <= 12 || w % 2 === 0)
                .map((w) => (
                  <span key={w} className="absolute -translate-x-1/2" style={{ left: pct(w) }}>
                    {w}
                  </span>
                ))}
            </div>
          </div>
        </div>
        <p className="m-0 text-[14px] muted">{copy.fromJira}</p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card inner="p-5 sm:p-6 flex flex-col gap-3 h-full" className="enter" style={{ ['--i' as string]: 2 }}>
          <h2 className="h-card m-0">{copy.whatHappened}</h2>
          {happened.length ? (
            <ul className="m-0 pl-5 flex flex-col gap-2 text-[15px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              {happened.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          ) : pms ? (
            <p className="m-0 muted">Nothing unusual: the work came in close to the estimate.</p>
          ) : (
            <Spinner />
          )}
        </Card>
        <Card inner="p-5 sm:p-6 flex flex-col gap-3 h-full" className="enter" style={{ ['--i' as string]: 3 }}>
          <h2 className="h-card m-0">{copy.whatLearned}</h2>
          {lesson ? (
            <>
              <p className="m-0 text-[15px] leading-relaxed">{lesson.text}</p>
              {lesson.addsRule ? (
                <p className="m-0">
                  <span className="tag tag-accent">{copy.ruleAdded}</span>
                </p>
              ) : null}
            </>
          ) : (
            <p className="m-0 muted">No new lesson from this one.</p>
          )}
        </Card>
      </div>

      <Card inner="p-5 sm:p-6 flex flex-col gap-4" className="enter" style={{ ['--i' as string]: 4 }}>
        <div>
          <h2 className="h-card m-0">{copy.gettingBetter}</h2>
          <p className="m-0 mt-1 text-[15px] muted">{copy.gettingBetterSub}</p>
        </div>
        <div className="flex items-end gap-[3px] h-36" role="img" aria-label={imp.sentence}>
          {imp.bars.map((b) => (
            <Link
              key={b.projectId}
              to={`/project/${b.projectId}`}
              className="flex-1 rounded-t-md transition-opacity hover:opacity-70"
              style={{ height: `${Math.max(3, (b.offPct / maxOff) * 100)}%`, background: b.highlight ? 'var(--accent)' : 'var(--surface-3)' }}
              title={`${b.offPct}% off`}
              aria-label={`${b.offPct}% off${b.highlight ? ` (${copy.thisProject.toLowerCase()})` : ''}`}
            />
          ))}
        </div>
        <div className="flex justify-between text-[13px] muted">
          <span>Oldest</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--accent)' }} aria-hidden="true" />
            {copy.thisProject}
          </span>
          <span>Newest</span>
        </div>
        <p className="m-0 text-[16px] font-medium">{imp.sentence}</p>
      </Card>
    </div>
  );
}
