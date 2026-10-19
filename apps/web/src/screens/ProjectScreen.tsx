import { Link, useParams } from 'react-router-dom';
import { copy } from '../copy';
import { Card, Icon, Label, Spinner, Tag } from '../components/ui';
import { categoryLabel } from '../lib/categories';
import { finishedLine, toHappened, toImprovement, toLesson, toRealFacts } from '../present';
import { postmortemFor, useHistory, usePostmortems } from '../state/history';
import { realProjects } from '../state/realProjects';

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ProjectScreen() {
  const { id = '' } = useParams();
  const history = useHistory();
  const pms = usePostmortems();
  if (!history) {
    return (
      <div className="page">
        <Spinner label="Looking back at finished projects" />
      </div>
    );
  }
  const f = history.finished.find((x) => x.project.id === id);
  if (!f) {
    return (
      <div className="page">
        <p className="m-0 text-lg">{copy.notFound}</p>
        <Link to="/" className="btn btn-primary self-start">
          {copy.backHome}
        </Link>
      </div>
    );
  }
  const real = realProjects().find((r) => r.project.id === id);
  const pm = postmortemFor(id, pms);
  const datesOnly = f.project.labels.includes('dates-only');
  // Without hours there are no per-item findings worth reading: the post-mortem's one-line summary is the story.
  const happened = datesOnly ? [pm?.summary ?? ''].filter(Boolean) : toHappened(pm);
  const lesson = datesOnly ? undefined : toLesson(pm, f.project);
  const imp = toImprovement(history.points, id);
  const o = f.outcome;
  const facts = real ? toRealFacts(real, f.point, o) : undefined;
  const scale = Math.max(o.tookWeeks, o.said.high) * 1.15;
  const pct = (w: number) => `${(w / scale) * 100}%`;
  const maxOff = Math.max(...imp.bars.map((b) => b.offPct), 10);
  const [client, name] = real ? [f.project.client, f.project.name] : f.project.name.split(': ');

  return (
    <div className="page">
      <header className="flex flex-col gap-2 enter">
        <Label>{client}</Label>
        <h1 className="h-page m-0">{capitalise(name ?? f.project.name)}</h1>
        <p className="m-0 muted flex items-center gap-3 flex-wrap">
          <span>{finishedLine(f.project)}</span>
          <Tag tone="accent">{categoryLabel(f.project.projectType)}</Tag>
          {real ? (
            <>
              <Tag tone="success">{copy.realTicket}</Tag>
              <a href={real.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5">
                <Icon name="jira" size={14} />
                {copy.openInJira}
              </a>
            </>
          ) : null}
        </p>
        {real ? (
          <div className="max-w-xs" aria-label={copy.doneProgress}>
            <span className="text-[12px] mono muted">{copy.doneProgress}</span>
            <span className="progress-bar block">
              <span style={{ width: '100%' }} />
            </span>
          </div>
        ) : null}
      </header>

      <Card inner="p-5 sm:p-6 flex flex-col gap-5" className="enter" style={{ ['--i' as string]: 1 }}>
        <h2 className="h-card m-0">{copy.howDidItDo}</h2>
        <p className="m-0 text-2xl font-semibold tracking-tight leading-snug">{o.sentence}</p>
        {facts ? (
          <div className="flex flex-col gap-4" data-real-facts>
            <div className={`grid ${facts.hours ? 'grid-cols-3' : 'grid-cols-1'} gap-4 max-w-xl`}>
              {facts.hours ? (
                <>
                  <div className="flex flex-col gap-1">
                    <Label>{copy.jiraEstimate}</Label>
                    <span className="mid-number">
                      {facts.hours.estimateH} <span className="text-[14px] mono muted">{copy.hoursShort}</span>
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>{copy.timeLogged}</Label>
                    <span className="mid-number">
                      {facts.hours.actualH} <span className="text-[14px] mono muted">{copy.hoursShort}</span>
                    </span>
                  </div>
                </>
              ) : null}
              <div className="flex flex-col gap-1">
                <Label>{copy.wouldHaveSaid}</Label>
                <span className="mid-number">
                  {facts.hindsightH} <span className="text-[14px] mono muted">{copy.hoursShort}</span>
                </span>
              </div>
            </div>
            <p className="m-0 text-[15px] ink-2">
              {facts.started}, {facts.finished}. {facts.hindsight}
            </p>
            <p className="m-0 text-[16px] font-medium">
              {facts.verdict}
              {facts.second ? ` ${facts.second}` : ''}
            </p>
            <p className="m-0 text-[14px] muted">{facts.roles}</p>
          </div>
        ) : null}
        <div className="flex flex-col gap-3" role="img" aria-label={`Estimated ${o.said.text}; actual ${o.took}.`}>
          <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 items-center">
            <span className="text-[14px] muted">{copy.estimated}</span>
            <span className="track block">
              <span className="seg-likely" style={{ left: pct(o.said.low), width: pct(Math.max(0.15, o.said.high - o.said.low)) }} />
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
            <div className="relative h-4 text-[11px] muted mono" aria-hidden="true">
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
        {real && !facts?.hours ? null : <p className="m-0 text-[14px] muted">{real ? copy.learnedFromReal : copy.fromJira}</p>}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card inner="p-5 sm:p-6 flex flex-col gap-3 h-full" className="enter" style={{ ['--i' as string]: 2 }}>
          <h2 className="h-card m-0">{copy.whatHappened}</h2>
          {happened.length ? (
            <ul className="m-0 pl-5 flex flex-col gap-2 text-[15px] leading-relaxed ink-2">
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
              className="flex-1 transition-opacity hover:opacity-70"
              style={{ height: `${Math.max(3, (b.offPct / maxOff) * 100)}%`, background: b.highlight ? 'var(--accent)' : 'var(--surface-3)', border: '1px solid var(--line)', borderBottom: 0 }}
              title={`${b.offPct}% off`}
              aria-label={`${b.offPct}% off${b.highlight ? ` (${copy.thisProject.toLowerCase()})` : ''}`}
            />
          ))}
        </div>
        <div className="flex justify-between text-[13px] muted">
          <span>Oldest</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5" style={{ background: 'var(--accent)' }} aria-hidden="true" />
            {copy.thisProject}
          </span>
          <span>Newest</span>
        </div>
        <p className="m-0 text-[16px] font-medium">{imp.sentence}</p>
      </Card>
    </div>
  );
}
