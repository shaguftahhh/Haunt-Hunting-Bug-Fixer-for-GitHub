/**
 * Session settings: the dry-run switch and the History tab.
 */
import { Router } from 'express';
import { getSession, sessionView, addHistory } from '../session.js';
import { HttpError } from '../http.js';
import { config } from '../config.js';
import type { PullRequestRecord } from '../types.js';

export const settingsRouter = Router();

/**
 * POST /api/settings/dry-run
 * Dry-run starts ON. Turning it off only affects future approvals and is
 * always shown in the UI (pumpkin dot in the header).
 */
settingsRouter.post('/settings/dry-run', (req, res) => {
  const body = req.body as { dryRun?: unknown };
  const session = getSession(req);
  if (typeof body.dryRun !== 'boolean') {
    throw new HttpError(400, 'dryRun must be true or false.');
  }
  session.dryRun = body.dryRun;
  res.json(sessionView(session));
});

/** GET /api/history — PRs created in this session (dry-run entries included). */
settingsRouter.get('/history', (req, res) => {
  const session = getSession(req);
  res.json({
    history: session.history,
    approvals: session.approvals,
    cap: config.safety.approvalCap,
  });
});

/**
 * POST /api/history/:id/discard — remove a dry-run entry from the list.
 * Real PRs are never deleted from GitHub; this only tidies the local list.
 */
settingsRouter.delete('/history/:id', (req, res) => {
  const session = getSession(req);
  const before = session.history.length;
  session.history = session.history.filter((entry) => entry.id !== req.params.id);
  if (session.history.length === before) throw new HttpError(404, 'No such history entry.');
  res.status(204).end();
});

export function historyEntry(entry: PullRequestRecord): PullRequestRecord {
  return entry;
}

// Re-export so route modules can build entries with the same shape.
export { addHistory };
