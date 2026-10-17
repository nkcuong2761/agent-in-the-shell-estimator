/**
 * Backend detection and calls. With no VITE_API_BASE_URL, or if /health fails, the app runs in demo mode.
 * No secrets live here: the API holds every key.
 */
import type {
  AskResponse,
  BriefPack,
  ChatMessage,
  EstimateRequest,
  HealthResponse,
  HistoryItem,
  HistoryProject,
  JiraPushRequest,
  JiraPushResponse,
  Lesson,
  PanelResponse,
  PostmortemResponse,
  ScopeResponse,
  ScopeResult,
  Worklog,
} from '@scopewise/shared';
import { HealthResponse as HealthSchema } from '@scopewise/shared';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export type Mode = { kind: 'checking' } | { kind: 'demo'; reason: string } | { kind: 'live'; health: HealthResponse };

export async function detectMode(): Promise<Mode> {
  if (!API_BASE) return { kind: 'demo', reason: 'No API is configured for this site.' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(`${API_BASE}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { kind: 'demo', reason: `The API answered ${res.status}.` };
    const health = HealthSchema.parse(await res.json());
    return { kind: 'live', health };
  } catch {
    return { kind: 'demo', reason: 'The API is not reachable right now.' };
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { 'content-type': 'application/json', ...init?.headers },
  });
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new ApiError(body?.error?.message ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export const api = {
  scopeFromFiles(title: string, deadline: string | undefined, files: File[]): Promise<ScopeResponse> {
    const form = new FormData();
    form.set('title', title);
    if (deadline) form.set('clientDeadline', deadline);
    for (const f of files) form.append('files', f);
    return call('/scope', { method: 'POST', body: form });
  },
  scope(brief: BriefPack): Promise<ScopeResponse> {
    return call('/scope', { method: 'POST', body: JSON.stringify({ brief }) });
  },
  panel(brief: BriefPack, scope: ScopeResult): Promise<PanelResponse> {
    return call('/panel', { method: 'POST', body: JSON.stringify({ brief, scope }) });
  },
  ask(messages: ChatMessage[], context: EstimateRequest | undefined): Promise<AskResponse> {
    return call('/ask', { method: 'POST', body: JSON.stringify({ messages, context }) });
  },
  postmortem(projectId: string): Promise<PostmortemResponse> {
    return call('/postmortem', { method: 'POST', body: JSON.stringify({ projectId }) });
  },
  jiraHistory(refresh = false): Promise<{ projects: HistoryProject[]; items: HistoryItem[]; worklogs: Worklog[]; syncedAt?: string }> {
    return call(`/jira/history${refresh ? '?refresh=1' : ''}`);
  },
  jiraPush(req: JiraPushRequest): Promise<JiraPushResponse> {
    return call('/jira/push', { method: 'POST', body: JSON.stringify(req) });
  },
  lessons(): Promise<{ lessons: Lesson[] }> {
    return call('/lessons');
  },
  saveLesson(lesson: Lesson): Promise<{ lessons: Lesson[] }> {
    return call('/lessons', { method: 'POST', body: JSON.stringify(lesson) });
  },
};
