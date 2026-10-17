import type { ReactNode } from 'react';
import { Card } from '../components/ui';
import { useConversations } from '../state/conversations';

function Box({ title, labelledBy, children }: { title: string; labelledBy: string; children: ReactNode }) {
  return (
    <Card inner="p-5 sm:p-6 flex flex-col gap-4 h-full" aria-labelledby={labelledBy}>
      <h2 id={labelledBy} className="h-card m-0">
        {title}
      </h2>
      <div>{children}</div>
    </Card>
  );
}

type Kind = 'agent' | 'browser' | 'system';

interface Node {
  x: number;
  y: number;
  w: number;
  title: string;
  lines: [string, string];
  kind: Kind;
}

const H = 74;
const NODES: Record<string, Node> = {
  brief: { x: 10, y: 30, w: 150, title: 'Brief pack', lines: ['email, notes,', 'PDF, Jira ticket'], kind: 'system' },
  scope: { x: 200, y: 30, w: 170, title: 'Scope agent', lines: ['phases, items,', 'sources, open questions'], kind: 'agent' },
  panel: { x: 410, y: 30, w: 170, title: 'Estimator panel', lines: ['3 personas, 2 rounds', 'o / m / p guesses'], kind: 'agent' },
  engine: { x: 620, y: 30, w: 160, title: 'Engine', lines: ['pure TS, seeded', 'Monte Carlo, buffer'], kind: 'browser' },
  estimate: { x: 820, y: 30, w: 130, title: 'Estimate', lines: ['P50/P80, commit,', 'on-time chance'], kind: 'browser' },
  jira: { x: 10, y: 230, w: 150, title: 'Jira Cloud', lines: ['epics = projects,', 'worklogs = capacity'], kind: 'system' },
  history: { x: 200, y: 230, w: 170, title: 'History', lines: ['closed projects,', 'items, actual hours'], kind: 'system' },
  postmortem: { x: 410, y: 230, w: 170, title: 'Post-mortem agent', lines: ['classifies misses,', 'writes lessons'], kind: 'agent' },
  lessons: { x: 620, y: 230, w: 160, title: 'Lessons store', lines: ['Postgres or JSON;', 'browser in demo'], kind: 'system' },
  ask: { x: 820, y: 230, w: 130, title: 'Ask agent', lines: ['tools call', 'the engine'], kind: 'agent' },
};

const stroke: Record<Kind, string> = { agent: 'var(--blue)', browser: 'var(--ink)', system: 'var(--muted)' };

function NodeBox({ n }: { n: Node }) {
  return (
    <g>
      <rect x={n.x} y={n.y} width={n.w} height={H} rx={12} fill="var(--surface)" stroke={stroke[n.kind]} strokeWidth={n.kind === 'browser' ? 2 : 1} strokeDasharray={n.kind === 'system' ? '4 3' : undefined} />
      <text x={n.x + 10} y={n.y + 22} fontFamily="var(--font-sans)" fontSize="13" fontWeight="600" fill="var(--ink)">
        {n.title}
      </text>
      <text x={n.x + 10} y={n.y + 44} fontFamily="var(--font-sans)" fontSize="11" fill="var(--ink-2)">
        {n.lines[0]}
      </text>
      <text x={n.x + 10} y={n.y + 60} fontFamily="var(--font-sans)" fontSize="11" fill="var(--ink-2)">
        {n.lines[1]}
      </text>
    </g>
  );
}

const right = (n: Node) => [n.x + n.w, n.y + H / 2] as const;
const left = (n: Node) => [n.x, n.y + H / 2] as const;

function Arrow({ d, label, lx, ly, dashed }: { d: string; label?: string; lx?: number; ly?: number; dashed?: boolean }) {
  return (
    <g>
      <path d={d} fill="none" stroke="var(--surface)" strokeWidth={6} />
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth={1.25} markerEnd="url(#arrow)" strokeDasharray={dashed ? '5 4' : undefined} />
      {label ? (
        <text x={lx} y={ly} fontFamily="var(--font-sans)" fontSize="11" fill="var(--muted)" textAnchor="middle">
          {label}
        </text>
      ) : null}
    </g>
  );
}

function Architecture() {
  const N = NODES as Record<keyof typeof NODES, Node>;
  const h = (a: Node, b: Node) => {
    const [x1, y1] = right(a);
    const [x2, y2] = left(b);
    return `M${x1} ${y1} L${x2 - 2} ${y2}`;
  };
  const e = N.engine as Node;
  const hi = N.history as Node;
  const le = N.lessons as Node;
  const sc = N.scope as Node;
  const es = N.estimate as Node;
  const ak = N.ask as Node;
  return (
    <svg viewBox="0 0 960 350" className="w-full h-auto" role="img" aria-labelledby="arch-title arch-desc">
      <title id="arch-title">Scopewise architecture</title>
      <desc id="arch-desc">
        A brief pack goes to the scope agent, then the three-persona estimator panel, then the engine, which produces the estimate. Jira history feeds the engine. The post-mortem agent turns closed
        projects into lessons, which go back to the scope agent. The Ask agent answers questions by calling the engine.
      </desc>
      <defs>
        <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0 0 L8 4 L0 8 z" fill="var(--ink)" />
        </marker>
      </defs>
      {Object.entries(NODES).map(([k, n]) => (
        <NodeBox key={k} n={n} />
      ))}
      <Arrow d={h(N.brief as Node, sc)} />
      <Arrow d={h(sc, N.panel as Node)} />
      <Arrow d={h(N.panel as Node, e)} />
      <Arrow d={h(e, es)} />
      <Arrow d={h(N.jira as Node, hi)} label="read" lx={180} ly={262} />
      <Arrow d={h(hi, N.postmortem as Node)} />
      <Arrow d={h(N.postmortem as Node, le)} />
      {/* history -> engine */}
      <Arrow d={`M${hi.x + 40} ${hi.y} L${hi.x + 40} 150 L${e.x + 50} 150 L${e.x + 50} ${e.y + H + 2}`} label="analogs, bias, capacity" lx={500} ly={144} />
      {/* lessons -> scope agent */}
      <Arrow d={`M${le.x + 110} ${le.y} L${le.x + 110} 182 L${sc.x + 120} 182 L${sc.x + 120} ${sc.y + H + 2}`} label="top lessons per type" lx={500} ly={196} dashed />
      {/* ask <-> estimate */}
      <Arrow d={`M${ak.x + 65} ${ak.y} L${es.x + 65} ${es.y + H + 2}`} label="explain" lx={es.x + 100} ly={170} />
      {/* estimate -> jira push */}
      <Arrow d={`M${es.x + es.w} ${es.y + 20} L955 ${es.y + 20} L955 336 L85 336 L85 ${(N.jira as Node).y + H + 2}`} label="push epic and stories" lx={520} ly={330} />
    </svg>
  );
}

const METHODS: [string, string, string][] = [
  ['Reference class forecasting', 'What projects like this took overall', 'Kahneman & Tversky (1979); Flyvbjerg (2006)'],
  ['Estimation by analogy', 'The 3 most similar past items for each work item', 'Shepperd & Schofield (1997)'],
  ['Wideband Delphi', 'Three personas guess twice; spread flags disagreement', 'Boehm (1981)'],
  ['Evidence-based scheduling with shrinkage', 'Per-category bias correction, shrunk for small samples', 'Spolsky (2007); Efron & Morris (1975)'],
  ['Beta-PERT', 'Each item as a skewed three-point distribution', 'Malcolm, Roseboom, Clark & Fazar (1959)'],
  ['Monte Carlo simulation', '5,000 seeded runs of effort, capacity and absence', 'Metropolis & Ulam (1949)'],
  ['Coordination overhead', 'Each extra person in a role adds 10% to its hours', 'Brooks (1975)'],
  ['Critical chain buffer', 'One visible buffer, root-square of item risk', 'Goldratt (1997); Newbold (1998)'],
  ['Value of information', 'Rank client questions by how much they narrow the range', 'Howard (1966)'],
  ['Accuracy metrics', 'MMRE, PRED(25), P80 hit rate in a walk-forward backtest', 'Conte, Dunsmore & Shen (1986)'],
];

export function About() {
  const { readOnly, setReadOnly } = useConversations();
  const viewMode = readOnly ? 'overseer' : 'manager';
  const setViewMode = (v: 'manager' | 'overseer') => setReadOnly(v === 'overseer');
  return (
    <div className="thread !max-w-[64rem] gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="h-page m-0">How estimates are worked out</h1>
        <p className="m-0 text-lg leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          Language models read the brief, make rough guesses and explain. They never set a final number. Every figure is computed by a small, deterministic estimating engine that runs in your browser and can show its working. This page uses the technical names for each method.
        </p>
      </header>

      <Box title="Architecture" labelledBy="arch-box">
        <div className="overflow-x-auto">
          <div className="min-w-[44rem]">
            <Architecture />
          </div>
        </div>
        <ul className="list-none m-0 p-0 mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <li className="inline-flex items-center gap-2">
            <span aria-hidden="true" style={{ width: 22, height: 12, border: '1px solid var(--blue)' }} /> Claude agent (API)
          </li>
          <li className="inline-flex items-center gap-2">
            <span aria-hidden="true" style={{ width: 22, height: 12, border: '2px solid var(--ink)' }} /> Runs in the browser on GitHub Pages
          </li>
          <li className="inline-flex items-center gap-2">
            <span aria-hidden="true" style={{ width: 22, height: 12, border: '1px dashed var(--muted)' }} /> Data and outside systems
          </li>
        </ul>
        <p className="text-sm muted m-0 mt-3 measure">
          The site is static. With no API configured it runs in demo mode: the same engine, bundled history, and AI outputs precomputed for the three samples. The API (Hono, serverless) holds the
          Claude and Jira credentials and is only needed for your own briefs, live Jira and live Ask.
        </p>
      </Box>

      <Box title="Methods" labelledBy="methods-title">
        <div className="overflow-x-auto">
          <table className="table min-w-[36rem]">
            <thead>
              <tr>
                <th>Method</th>
                <th>Used for</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {METHODS.map(([m, u, c]) => (
                <tr key={m}>
                  <td className="font-semibold">{m}</td>
                  <td>{u}</td>
                  <td className="muted">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm muted m-0 mt-3">Two additions of ours, both explained in the drawers: a shared project-level error factor, measured from history, so items can run late together; and a shared factor per open question, so an unanswered question moves all its items at once.</p>
      </Box>

      <div className="grid gap-6 md:grid-cols-2">
        <Box title="Manager and Overseer views" labelledBy="views-title">
          <div className="flex flex-col gap-3">
            <p className="m-0">
              <span className="font-semibold">Manager</span> is for the person preparing the estimate: answer questions, change the team, trim scope and push to Jira.
            </p>
            <p className="m-0">
              <span className="font-semibold">Overseer</span> is for a reviewer or client lead: the same numbers and explanations, read only, so nothing changes by accident in a review.
            </p>
            <div className="flex gap-2">
              <button className="btn btn-sm" aria-pressed={viewMode === 'manager'} onClick={() => setViewMode('manager')}>
                Use Manager view
              </button>
              <button className="btn btn-sm" aria-pressed={viewMode === 'overseer'} onClick={() => setViewMode('overseer')}>
                Use Overseer view
              </button>
            </div>
          </div>
        </Box>
        <Box title="About the data" labelledBy="data-title">
          <div className="flex flex-col gap-3">
            <p className="m-0">Everything here is fictional: clients, people, squads, projects and hours. History was generated by a seeded script so that it’s reproducible, with known patterns planted for the engine to find:</p>
            <ul className="m-0 pl-5 flex flex-col gap-1 text-sm">
              <li>integration work overruns by about 1.4×; reporting comes in under, about 0.9×</li>
              <li>form digitizations often add an e-signature step after kickoff</li>
              <li>squads lose about 8% of planned hours to absence, plus one planned leave</li>
              <li>the first 10 projects are noisier, and two time entries have a typo</li>
            </ul>
            <p className="m-0 text-sm muted">The wording rule for every agent: talk about work, skills and capacity, never about individuals’ performance or personal circumstances.</p>
          </div>
        </Box>
      </div>
    </div>
  );
}
