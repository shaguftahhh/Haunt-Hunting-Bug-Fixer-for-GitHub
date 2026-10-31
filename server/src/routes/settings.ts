/**
 * Session settings: the dry-run switch and the History tab.
 */
import { Router } from 'express';
import { getSession, sessionView } from '../session.js';
import { HttpError } from '../http.js';
import { config } from '../config.js';
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

