import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ROLE_LABELS, type Role, type TeamShape } from '@scopewise/shared';
import { prepareEstimate, runEstimate } from '@scopewise/engine';
import { Box } from '../components/Ascii';
import { DitherHistogram, Swatch } from '../components/Dither';
import { DisabledNote, Spinner, Stepper } from '../components/ui';
import { api } from '../lib/api';
import { PROJECT_TYPE_LABELS, samples, seed } from '../lib/data';
import { hours, longDate, plural, shortDate } from '../lib/format';
import { useStore } from '../lib/store';

const ROLES: Role[] = ['pm', 'designer', 'engineer', 'qa', 'legal'];

function HeroChart() {
  const s = samples[0];
  const est = useMemo(() => {
    if (!s) return undefined;
    const squad = seed.squads.find((q) => q.id === s.meta.squad);
    const team: TeamShape = {};
    for (const m of squad?.members ?? []) team[m.role] = m.count;
    return runEstimate(
      prepareEstimate({
        scope: s.cache.scope,
        panel: s.cache.panel,
        history: seed,
        squad: squad?.stats ?? { focusFactor: 0.75, absenceRate: 0.08, coordinationOverheadPerExtra: 0.1 },
        plannedLeave: squad?.plannedLeave,
        teamShape: team,
        startDate: s.meta.startDate,
        deadline: s.meta.clientDeadline,
      }),
      { skipVoi: true },
    );
  }, [s]);
  if (!est || !s) return null;
  return (
    <figure className="m-0">
      <p className="mono text-xs m-0 mb-4 text-[var(--ink-2)]" aria-hidden="true">
        <span className="muted">$</span> scopewise run {s.meta.id} --runs {est.runs}
        <span className="blink">_</span>
      </p>
      <DitherHistogram
        histogram={est.hoursHistogram}
        p50={est.total.p50}
        p80={est.total.p80}
        height={250}
        dot={4}
        animate
        ariaLabel={`Distribution of ${est.runs} simulated outcomes for ${s.meta.title}: P50 ${Math.round(est.total.p50)} hours, P80 ${Math.round(est.total.p80)} hours.`}
      />
      <figcaption className="text-sm muted mt-2 flex flex-wrap gap-x-4 gap-y-1 items-center">
        <span>
          {est.runs.toLocaleString('en-US')} simulated runs of “{s.meta.title}”
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Swatch density={100} /> likely
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Swatch density={50} /> possible
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Swatch density={12} tone="graphite" /> tail
        </span>
      </figcaption>
    </figure>
  );
}

function SampleTicket({ i }: { i: number }) {
  const s = samples[i];
  const navigate = useNavigate();
  const { setActive } = useStore();
  if (!s) return null;
  const sc = s.cache.scope;
  const open = () => {
    setActive(s.meta.id);
    navigate(`/estimate/${s.meta.id}`);
  };
  return (
    <button type="button" className="ticket cursor-pointer" onClick={open} aria-label={`Open the estimate for ${s.meta.title}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="chip">{PROJECT_TYPE_LABELS[sc.projectType]}</span>
        <span className="mono text-[11px] muted">due {shortDate(s.meta.clientDeadline)}</span>
      </div>
      <div>
        <p className="h-sub text-lg leading-snug m-0">{s.meta.title}</p>
        <p className="text-sm muted m-0">{s.meta.client}</p>
      </div>
      <p className="text-sm m-0 text-[var(--ink-2)]">{sc.summary}</p>
      <div className="ticket-perf" aria-hidden="true">
        - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
      </div>
      <div className="mono text-xs flex justify-between gap-2 text-[var(--ink-2)]">
        <span>{plural(sc.items.length, 'item')}</span>
        <span>{plural(sc.missingInfo.length, 'open question')}</span>
        <span>{s.brief.sources.length} sources</span>
      </div>
      <span className="mono text-sm" style={{ color: 'var(--blue-ink)' }}>
        Open estimate
      </span>
    </button>
  );
}

function UploadForm() {
  const { mode, addWorkspace, history } = useStore();
  const navigate = useNavigate();
  const live = mode.kind === 'live' && mode.health.features.claude;
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [squadId, setSquadId] = useState(history.squads[0]?.id ?? 'alpha');
  const [team, setTeam] = useState<TeamShape>(() => {
    const t: TeamShape = {};
    for (const m of history.squads[0]?.members ?? []) t[m.role] = m.count;
    return t;
  });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickSquad = (id: string) => {
    setSquadId(id);
    const t: TeamShape = {};
    for (const m of history.squads.find((s) => s.id === id)?.members ?? []) t[m.role] = m.count;
    setTeam(t);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!files.length) {
      setError('Add at least one file: an email, meeting notes, a PDF or a Jira ticket.');
      return;
    }
    setError(null);
    try {
      setBusy('Reading the brief and splitting it into phases');
      const scoped = await api.scopeFromFiles(title || files[0]?.name || 'Untitled brief', deadline || undefined, files);
      const brief = scoped.brief ?? { id: `upload-${Date.now()}`, title: title || 'Untitled brief', clientDeadline: deadline || undefined, sources: [] };
      setBusy('Asking the three-person estimator panel');
      const panel = await api.panel(brief, scoped.scope).catch(() => undefined);
      const id = `upload-${Date.now().toString(36)}`;
      addWorkspace({
        id,
        title: brief.title,
        client: 'Your brief',
        brief,
        scope: scoped.scope,
        scopeProvenance: scoped.provenance,
        panel: panel?.panel,
        panelProvenance: panel?.provenance,
        ask: [],
        squadId,
        teamShape: team,
        startDate: new Date().toISOString().slice(0, 10),
        deadline: deadline || undefined,
        answered: [],
        dropped: [],
        origin: 'upload',
      });
      navigate(`/scope/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong reading the brief.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-5 md:grid-cols-2" aria-describedby="upload-note">
      <div className="flex flex-col gap-4">
        <div className="field">
          <label htmlFor="brief-files">Brief pack</label>
          <label
            htmlFor="brief-files"
            className="flex flex-col items-start gap-1 p-4 cursor-pointer"
            style={{ border: '1px dashed var(--rule)', background: live ? 'var(--paper-2)' : 'transparent' }}
          >
            <span className="mono text-sm">{files.length ? files.map((f) => f.name).join(', ') : 'Drop emails, notes, PDFs or a Jira ticket'}</span>
            <span className="text-xs muted">.md .txt .eml .pdf, up to 2 MB each</span>
          </label>
          <input
            id="brief-files"
            type="file"
            multiple
            accept=".md,.txt,.eml,.pdf,text/plain,application/pdf"
            className="sr-only"
            disabled={!live}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </div>
        <div className="field">
          <label htmlFor="brief-title">Name</label>
          <input id="brief-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Partner portal export" disabled={!live} />
        </div>
        <div className="field">
          <label htmlFor="brief-deadline">Client deadline</label>
          <input id="brief-deadline" type="date" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} disabled={!live} />
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <div className="field">
          <label htmlFor="brief-squad">Squad</label>
          <select id="brief-squad" className="input" value={squadId} onChange={(e) => pickSquad(e.target.value)} disabled={!live}>
            {history.squads.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="flex flex-col gap-2 border-0 p-0 m-0" disabled={!live}>
          <legend className="text-sm text-[var(--ink-2)] mb-1">Team shape</legend>
          {ROLES.map((r) => (
            <div key={r} className="flex items-center justify-between gap-3">
              <span className="text-sm">{ROLE_LABELS[r]}</span>
              <Stepper label={ROLE_LABELS[r]} value={team[r] ?? 0} onChange={(v) => setTeam((t) => ({ ...t, [r]: v }))} />
            </div>
          ))}
        </fieldset>
      </div>
      <div className="md:col-span-2 flex flex-wrap items-center gap-4">
        <button className="btn btn-primary" type="submit" disabled={!live || !!busy}>
          Read brief and estimate
        </button>
        {busy ? <Spinner label={busy} /> : null}
        {error ? (
          <p role="alert" className="text-sm m-0" style={{ color: 'var(--pink-ink)' }}>
            {error}
          </p>
        ) : null}
        {!live ? (
          <DisabledNote>
            <span id="upload-note">
              {mode.kind === 'checking' ? 'Checking whether an API is available…' : mode.kind === 'live' ? 'The API is up, but it has no Claude key configured, so it can’t read new briefs yet.' : 'Uploading your own brief needs the Scopewise API (it holds the Claude key). This site is running in demo mode: try a sample above.'}
            </span>
          </DisabledNote>
        ) : null}
      </div>
    </form>
  );
}

export function Intake() {
  const first = samples[0];
  return (
    <div className="flex flex-col gap-14">
      <section className="grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] items-end" aria-labelledby="hero-title">
        <div className="flex flex-col gap-6">
          <h1 id="hero-title" className="h-display m-0">
            Turn a client brief into a range you can defend.
          </h1>
          <p className="lede m-0">
            Drop in the emails, notes and ticket. Scopewise splits the work into phases, lists what it doesn’t know, and gives a P50 to P80 range, a visible buffer and the chance of hitting
            the deadline. Every number traces back to past projects and a published method.
          </p>
          <div className="flex flex-wrap gap-3">
            {first ? (
              <Link to={`/estimate/${first.meta.id}`} className="btn btn-primary no-underline">
                Open a sample estimate
              </Link>
            ) : null}
            <a href="#samples" className="link self-center text-sm">
              or browse all three samples
            </a>
          </div>
        </div>
        <HeroChart />
      </section>

      <Box title="Start here" as="section" labelledBy="start-here">
        <ol className="grid gap-6 md:grid-cols-3 m-0 p-0 list-none">
          {[
            ['Read the brief', 'The scope agent turns sources into phases and work items, and cites the line each item came from.'],
            ['Close the gaps', 'Open questions are ranked by how much each answer would narrow the range. Send them to the client in one email.'],
            ['Commit to a range', 'The engine runs 5,000 simulations with your team’s real capacity. Commit to P50 plus one visible buffer.'],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="mono text-sm muted pt-0.5" aria-hidden="true">
                {i + 1}.
              </span>
              <div>
                <p className="h-sub m-0">{t}</p>
                <p className="text-sm muted m-0 mt-1">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </Box>

      <section id="samples" aria-labelledby="samples-title" className="flex flex-col gap-5 scroll-mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="samples-title" className="h-section m-0">
            Sample brief packs
          </h2>
          <p className="text-sm muted m-0">Fictional clients. One click opens the full estimate, no backend needed.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {samples.map((_, i) => (
            <SampleTicket key={i} i={i} />
          ))}
        </div>
      </section>

      <Box title="Estimate your own brief" as="section" labelledBy="upload-title">
        <UploadForm />
      </Box>

      <p className="text-xs muted m-0">
        History: {seed.projects.filter((p) => p.status === 'closed').length} closed fictional projects, {seed.items.length} work items, {longDate(seed.projects[0]?.startDate)} to{' '}
        {longDate([...seed.projects].filter((p) => p.status === 'closed').sort((a, b) => b.endDate.localeCompare(a.endDate))[0]?.endDate)}. Total logged{' '}
        {hours(seed.projects.reduce((s, p) => s + p.actualH, 0))}.
      </p>
    </div>
  );
}
