/**
 * Typed client for the BugBanisher API.
 *
 * Every call is same-origin (`/api/...`) and carries the session cookie, so
 * the browser never sees a GitHub token. Errors are normalised into ApiError
 * with a human-readable message + optional hint from the server.
 */
import type {
  Finding,
  FixResult,
  GitHubUser,
  JobView,
  ModelStatus,
  PullRequestRecord,
  RepoSummary,
  ScanResult,
  SessionView,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiErrorBody {
  error?: string;
  hint?: string;
}

/**
 * Session continuity without cookies.
 *
 * The server also returns its session id in the `X-BB-Session` header. We keep
 * it in sessionStorage (with an in-memory fallback for sandboxed iframes where
 * storage is unavailable) and echo it on each request. This keeps scans, fixes
 * and approvals attached to one session even when the browser blocks the
 * httpOnly session cookie — which is exactly what happens inside preview
 * iframes. It is per-tab, never written to disk, and cleared when the tab closes.
 */
const SESSION_HEADER = 'X-BB-Session';
const SESSION_STORAGE_KEY = 'bugbanisher.session';
let memorySessionId: string | null = null;

function readSessionId(): string | null {
  if (memorySessionId) return memorySessionId;
  try {
    const stored = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) memorySessionId = stored;
    return stored;
  } catch {
    return null;
  }
}

function rememberSessionId(id: string | null): void {
  if (!id) return;
  memorySessionId = id;
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    /* storage blocked: the in-memory value still carries this page's session */
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const sessionId = readSessionId();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId ? { [SESSION_HEADER]: sessionId } : {}),
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch {
    throw new ApiError('Could not reach the BugBanisher server.', 0, 'Is `npm run dev` still running?');
  }

  rememberSessionId(res.headers.get(SESSION_HEADER));

  if (!res.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* not JSON */
    }
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.hint);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface SessionResponse extends SessionView {}

export interface ReposResponse {
  login: string;
  repos: RepoSummary[];
  includeWritable: boolean;
  note: string;
}

export interface ConnectResponse extends SessionView {
  warnings?: string[];
}

export interface ScanJob extends JobView<ScanResult> {}
export interface FixJob extends JobView<FixResult> {}

export const api = {
  session: () => request<SessionResponse>('/session'),

  connectWithToken: (token: string) =>
    request<ConnectResponse>('/auth/pat', { method: 'POST', body: JSON.stringify({ token }) }),

  disconnect: () => request<SessionView>('/auth/logout', { method: 'POST' }),

  repos: (includeWritable = false) =>
    request<ReposResponse>(`/repos${includeWritable ? '?includeWritable=1' : ''}`),

  modelStatus: () => request<ModelStatus>('/model/status'),

  setDryRun: (dryRun: boolean) =>
    request<SessionView>('/settings/dry-run', {
      method: 'POST',
      body: JSON.stringify({ dryRun }),
    }),

  startScan: (repoFullName: string) =>
    request<{ jobId: string }>('/scan', {
      method: 'POST',
      body: JSON.stringify({ repoFullName }),
    }),

  scanStatus: (jobId: string) => request<ScanJob>(`/scan/${encodeURIComponent(jobId)}`),

  getScan: (scanId: string) => request<ScanResult>(`/scan/result/${encodeURIComponent(scanId)}`),

  startFix: (scanId: string, findingId: string) =>
    request<{ jobId: string }>('/fix', {
      method: 'POST',
      body: JSON.stringify({ scanId, findingId }),
    }),

  fixStatus: (jobId: string) => request<FixJob>(`/fix/${encodeURIComponent(jobId)}`),

  getFix: (fixId: string) => request<FixResult>(`/fix/result/${encodeURIComponent(fixId)}`),

  approve: (fixId: string) =>
    request<{
      record: PullRequestRecord;
      session: SessionView;
      labelApplied: boolean;
      note: string;
    }>('/approve', {
      method: 'POST',
      body: JSON.stringify({ fixId, confirm: true }),
    }),

  history: () =>
    request<{ history: PullRequestRecord[]; approvals: number; cap: number }>('/history'),

  demo: () =>
    request<{
      repo: RepoSummary;
      scan: ScanResult;
      fixes: Record<string, FixResult | { error: string; finding: Finding }>;
    }>('/demo', { method: 'POST', body: JSON.stringify({}) }),
};

export type { Finding, FixResult, GitHubUser, ModelStatus, PullRequestRecord, RepoSummary, ScanResult, SessionView };
