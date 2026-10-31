/**
 * In-memory sessions.
 *
 * Why in-memory? The GitHub token must never touch disk, localStorage or a
 * database. A random, httpOnly session id points at a server-side object that
 * lives for 12 hours. Restarting the server forgets every token — that is a
 * feature, not a bug.
 */
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type {
  FixRecord,
  GitHubUser,
  PullRequestRecord,
  ScanRecord,
  SessionView,
} from './types.js';
import { config, publicRuntimeInfo } from './config.js';

const SESSION_COOKIE = 'bb_sid';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SCANS_PER_SESSION = 2;
const MAX_SESSIONS = 500;

export interface SessionData {
  id: string;
  createdAt: number;
  lastSeen: number;
  token: string | null;
  tokenKind: 'oauth' | 'pat' | null;
  scopes: string[];
  user: GitHubUser | null;
  dryRun: boolean;
  approvals: number;
  history: PullRequestRecord[];
  scans: Map<string, ScanRecord>;
  fixes: Map<string, FixRecord>;
  oauthState: string | null;
}

const sessions = new Map<string, SessionData>();

function newSession(): SessionData {
  return {
    id: crypto.randomBytes(24).toString('base64url'),
    createdAt: Date.now(),
    lastSeen: Date.now(),
    token: null,
    tokenKind: null,
    scopes: [],
    user: null,
    // Safety rule: dry-run is ON by default for every new session.
    dryRun: true,
    approvals: 0,
    history: [],
    scans: new Map(),
    fixes: new Map(),
    oauthState: null,
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionData;
    }
  }
}

/**
 * Attach (or create) a session for every request. Creating a session for an
 * anonymous visitor is harmless: it holds no token until they sign in.
 */
export function sessionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const raw = req.cookies?.[SESSION_COOKIE];
  let session = typeof raw === 'string' ? sessions.get(raw) : undefined;

  if (!session) {
    // Bound memory for long-running demos: evict the least recently seen
    // anonymous sessions before adding another one.
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = [...sessions.values()].sort((a, b) => a.lastSeen - b.lastSeen).slice(0, 50);
      for (const stale of oldest) sessions.delete(stale.id);
    }
    session = newSession();
    sessions.set(session.id, session);
    res.cookie(SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  }

  session.lastSeen = Date.now();
  req.session = session;
  next();
}

export function getSession(req: Request): SessionData {
  if (!req.session) throw new Error('Session middleware missing');
  return req.session;
}

export function setSessionUser(
  session: SessionData,
  token: string,
  kind: 'oauth' | 'pat',
  user: GitHubUser,
  scopes: string[],
): void {
  session.token = token;
  session.tokenKind = kind;
  session.user = user;
  session.scopes = scopes;
  session.scans.clear();
  session.fixes.clear();
}

export function clearSessionAuth(session: SessionData): void {
  session.token = null;
  session.tokenKind = null;
  session.scopes = [];
  session.user = null;
  session.scans.clear();
  session.fixes.clear();
  session.oauthState = null;
}

export function storeScan(session: SessionData, record: ScanRecord): void {
  // Keep memory bounded: only the two newest scans (and their files) are kept.
  session.scans.set(record.scan.scanId, record);
  while (session.scans.size > MAX_SCANS_PER_SESSION) {
    const oldest = session.scans.keys().next().value;
    if (oldest === undefined) break;
    session.scans.delete(oldest);
  }
  // Fixes belong to their scans; drop orphaned ones.
  for (const [id, fix] of session.fixes) {
    if (!session.scans.has(fix.scanId)) session.fixes.delete(id);
  }
}

export function storeFix(session: SessionData, record: FixRecord): void {
  session.fixes.set(record.fix.fixId, record);
}

export function sessionView(session: SessionData): SessionView {
  return {
    connected: Boolean(session.token && session.user),
    user: session.user,
    oauthAvailable: publicRuntimeInfo().oauthAvailable,
    dryRun: session.dryRun,
    approvals: session.approvals,
    approvalCap: config.safety.approvalCap,
    history: session.history,
    demoAvailable: true,
    llm: publicRuntimeInfo().llm,
  };
}

export function addHistory(session: SessionData, entry: PullRequestRecord): void {
  session.history.unshift(entry);
}

export function canApprove(session: SessionData): boolean {
  return session.approvals < config.safety.approvalCap;
}

// Housekeeping: expire stale sessions so tokens are not kept forever.
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.lastSeen < cutoff) sessions.delete(id);
  }
}, 10 * 60 * 1000).unref();
