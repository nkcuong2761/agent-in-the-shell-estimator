/**
 * Small persistent store for lessons and the Jira sync cache.
 *  - DATABASE_URL set → Postgres (e.g. Supabase) via the `postgres` package; tables are created on first use.
 *  - otherwise → a JSON file at apps/api/.data/store.json (STORE_PATH overrides; on Vercel, /tmp is used because
 *    the deployment file system is read-only, so lessons there only live as long as the instance).
 * Both seed lessons from data/demo-cache/postmortems.json when empty.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HistoryItem, HistoryProject, Lesson, Worklog } from '@scopewise/shared';
import { seedLessons } from './data';
import { env } from './env';

export const JiraCache = z.object({
  syncedAt: z.string(),
  projects: z.array(HistoryProject),
  items: z.array(HistoryItem),
  worklogs: z.array(Worklog),
  warnings: z.array(z.string()).default([]),
});
export type JiraCache = z.infer<typeof JiraCache>;

export interface Store {
  kind: 'postgres' | 'json-file';
  listLessons(): Promise<Lesson[]>;
  addLessons(lessons: Lesson[]): Promise<Lesson[]>;
  getJiraCache(): Promise<JiraCache | null>;
  setJiraCache(cache: JiraCache): Promise<void>;
}

export function normaliseLesson(l: Lesson, source: Lesson['source'] = 'user'): Lesson {
  return { ...l, id: l.id ?? `l-${randomUUID()}`, createdAt: l.createdAt ?? new Date().toISOString(), source: l.source ?? source };
}

// --- JSON file ------------------------------------------------------------------------------------

const FileShape = z.object({
  version: z.literal(1),
  lessons: z.array(Lesson),
  jiraCache: JiraCache.nullable().default(null),
});
type FileShape = z.infer<typeof FileShape>;

function defaultStorePath(): string {
  if (process.env.VERCEL) return join(tmpdir(), 'scopewise', 'store.json');
  return join(dirname(fileURLToPath(import.meta.url)), '..', '.data', 'store.json');
}

export class JsonFileStore implements Store {
  readonly kind = 'json-file' as const;
  private data: FileShape | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  constructor(readonly path: string = env.storePath() ?? defaultStorePath()) {}

  private load(): FileShape {
    if (this.data) return this.data;
    if (existsSync(this.path)) {
      try {
        this.data = FileShape.parse(JSON.parse(readFileSync(this.path, 'utf8')));
        return this.data;
      } catch (err) {
        console.warn(`[store] ${this.path} is unreadable (${err instanceof Error ? err.message : err}); starting fresh.`);
      }
    }
    this.data = { version: 1, lessons: seedLessons(), jiraCache: null };
    this.persist();
    return this.data;
  }

  private persist(): void {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writeChain = this.writeChain.then(() => {
      try {
        mkdirSync(dirname(this.path), { recursive: true });
        const tmp = `${this.path}.tmp`;
        writeFileSync(tmp, snapshot);
        renameSync(tmp, this.path);
      } catch (err) {
        console.warn(`[store] could not write ${this.path}; keeping data in memory only:`, err instanceof Error ? err.message : err);
      }
    });
  }

  async listLessons() {
    return [...this.load().lessons];
  }
  async addLessons(lessons: Lesson[]) {
    const d = this.load();
    const added = lessons.map((l) => normaliseLesson(l));
    const ids = new Set(added.map((l) => l.id));
    d.lessons = [...d.lessons.filter((l) => !ids.has(l.id)), ...added];
    this.persist();
    await this.writeChain;
    return added;
  }
  async getJiraCache() {
    return this.load().jiraCache;
  }
  async setJiraCache(cache: JiraCache) {
    this.load().jiraCache = cache;
    this.persist();
    await this.writeChain;
  }
}

// --- Postgres -------------------------------------------------------------------------------------

export class PostgresStore implements Store {
  readonly kind = 'postgres' as const;
  private ready: Promise<void> | null = null;
  private sqlPromise: Promise<import('postgres').Sql> | null = null;
  constructor(private readonly url: string) {}

  private sql() {
    this.sqlPromise ??= import('postgres').then(({ default: postgres }) =>
      // prepare: false keeps Supabase's transaction pooler (pgbouncer) happy.
      postgres(this.url, { ssl: process.env.DATABASE_SSL === 'disable' ? false : 'prefer', prepare: false, max: 3, idle_timeout: 20 }),
    );
    return this.sqlPromise;
  }

  private init() {
    this.ready ??= (async () => {
      const sql = await this.sql();
      await sql`create table if not exists scopewise_lessons (id text primary key, data jsonb not null, created_at timestamptz not null default now())`;
      await sql`create table if not exists scopewise_kv (key text primary key, value jsonb not null, updated_at timestamptz not null default now())`;
      const [row] = await sql<{ n: number }[]>`select count(*)::int as n from scopewise_lessons`;
      if ((row?.n ?? 0) === 0) await this.insert(seedLessons());
    })().catch((err: unknown) => {
      this.ready = null;
      throw err;
    });
    return this.ready;
  }

  private async insert(lessons: Lesson[]) {
    const sql = await this.sql();
    for (const l of lessons) {
      const json = sql.json(l as unknown as Parameters<typeof sql.json>[0]);
      await sql`insert into scopewise_lessons (id, data) values (${l.id as string}, ${json}) on conflict (id) do update set data = excluded.data`;
    }
  }

  async listLessons() {
    await this.init();
    const sql = await this.sql();
    const rows = await sql<{ data: unknown }[]>`select data from scopewise_lessons order by created_at, id`;
    return rows.flatMap((r) => {
      const p = Lesson.safeParse(r.data);
      return p.success ? [p.data] : [];
    });
  }
  async addLessons(lessons: Lesson[]) {
    await this.init();
    const added = lessons.map((l) => normaliseLesson(l));
    await this.insert(added);
    return added;
  }
  async getJiraCache() {
    await this.init();
    const sql = await this.sql();
    const [row] = await sql<{ value: unknown }[]>`select value from scopewise_kv where key = 'jira-cache'`;
    if (!row) return null;
    const p = JiraCache.safeParse(row.value);
    return p.success ? p.data : null;
  }
  async setJiraCache(cache: JiraCache) {
    await this.init();
    const sql = await this.sql();
    const json = sql.json(cache as unknown as Parameters<typeof sql.json>[0]);
    await sql`insert into scopewise_kv (key, value, updated_at) values ('jira-cache', ${json}, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`;
  }
}

let store: Store | null = null;

export function getStore(): Store {
  if (!store) {
    const url = env.databaseUrl();
    store = url ? new PostgresStore(url) : new JsonFileStore();
  }
  return store;
}

/** For tests. */
export function setStore(s: Store | null): void {
  store = s;
}
