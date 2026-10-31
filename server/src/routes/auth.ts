/**
 * Authentication routes.
 *
 * Two ways to connect GitHub:
 *   1. Fine-grained personal access token (recommended, least privilege).
 *      Stored only in the in-memory session; never logged, never persisted.
 *   2. OAuth app (optional) — the client secret stays on the server.
 */
import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { config, oauthAvailable } from '../config.js';
import { HttpError, asyncHandler, requireAuth, stateCookieOptions } from '../http.js';
import { GitHubError, getAuthenticatedUser, listOwnedRepos, sanitizeScopes } from '../github/client.js';
import { log } from '../logger.js';
import {
  clearSessionAuth,
  getSession,
  sessionView,
  setSessionUser,
} from '../session.js';

export const authRouter = Router();

const OAUTH_STATE_COOKIE = 'bb_oauth_state';

/** GET /api/config — public runtime info (no secrets). */
authRouter.get('/config', (_req, res) => {
  res.json({
    oauthAvailable: oauthAvailable(),
    llm: {
      provider: config.llm.provider,
      model: config.llm.provider === 'none' ? null : config.llm.model,
    },
    approvalCap: config.safety.approvalCap,
    dryRunDefault: true,
  });
});

/** GET /api/session — who am I, is dry-run on, how many approvals are left. */
authRouter.get('/session', (req, res) => {
  res.json(sessionView(getSession(req)));
});

/**
 * POST /api/auth/pat
 * Body: { token: string }
 *
 * We validate the token by calling /user, check the scopes GitHub reports, and
 * keep it in memory only.
 */
authRouter.post(
  '/auth/pat',
  asyncHandler(async (req, res) => {
    const body = req.body as { token?: unknown };
    const token = typeof body.token === 'string' ? body.token.trim() : '';

    if (!token) throw new HttpError(400, 'Paste a personal access token to continue.');
    if (token.length < 20 || token.length > 255) {
      throw new HttpError(400, 'That does not look like a GitHub token.');
    }
    if (/\s/.test(token)) {
      throw new HttpError(400, 'That token contains spaces. Copy it again without line breaks.');
    }
    // We intentionally do not enforce a prefix: fine-grained tokens start with
    // github_pat_, classic with ghp_, OAuth with gho_, and GitHub App tokens
    // with ghs_. GitHub itself is the authority — the next call validates it.

    try {
      const { user, scopes } = await getAuthenticatedUser(token);
      const session = getSession(req);

      // A classic token with broad scopes is allowed but we warn the user.
      const warnings: string[] = [];
      const classicBroad = scopes.some((s) => ['repo', 'write:org', 'admin:org', 'delete_repo'].includes(s));
      if (classicBroad) {
        warnings.push(
          'This looks like a classic token with broad scopes. A fine-grained token limited to Contents and Pull requests is safer.',
        );
      }

      setSessionUser(session, token, tokenKindFromToken(token), user, sanitizeScopes(scopes));
      log.info('GitHub connected via PAT', { login: user.login, scopes: scopes.join(',') || 'fine-grained' });
      res.json({ ...sessionView(session), warnings });
    } catch (error) {
      if (error instanceof GitHubError && error.status === 401) {
        throw new HttpError(401, 'GitHub rejected that token. Check it has not expired.');
      }
      throw error;
    }
  }),
);

function tokenKindFromToken(token: string): 'oauth' | 'pat' {
  return token.startsWith('gho_') ? 'oauth' : 'pat';
}

/** POST /api/auth/logout — forget the token and all scans. */
authRouter.post('/auth/logout', (req, res) => {
  const session = getSession(req);
  clearSessionAuth(session);
  res.json(sessionView(session));
});

/** GET /api/auth/github/start — begin the OAuth dance (if configured). */
authRouter.get('/auth/github/start', (req, res) => {
  if (!oauthAvailable()) {
    res.status(400).json({
      error: 'OAuth is not configured on this server.',
      hint: 'Use a fine-grained personal access token instead, or set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.',
      status: 400,
    });
    return;
  }
  const state = crypto.randomBytes(16).toString('base64url');
  getSession(req).oauthState = state;
  res.cookie(OAUTH_STATE_COOKIE, state, stateCookieOptions());

  const params = new URLSearchParams({
    client_id: config.github.clientId,
    redirect_uri: `${req.protocol}://${req.get('host')}/api/auth/github/callback`,
    scope: config.github.oauthScope,
    state,
    allow_signup: 'true',
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

/** GET /api/auth/github/callback — exchange the code, store the token in memory. */
authRouter.get(
  '/auth/github/callback',
  asyncHandler(async (req: Request, res: Response) => {
    const { code, state, error: oauthError } = req.query as Record<string, string | undefined>;
    const session = getSession(req);
    const expected = req.cookies?.[OAUTH_STATE_COOKIE];

    if (oauthError) {
      res.redirect('/?auth=cancelled');
      return;
    }
    if (!code) throw new HttpError(400, 'Missing OAuth code.');
    if (!state || !expected || state !== expected || state !== session.oauthState) {
      throw new HttpError(400, 'OAuth state check failed. Please try connecting again.');
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: config.github.clientId,
        client_secret: config.github.clientSecret,
        code,
        redirect_uri: `${req.protocol}://${req.get('host')}/api/auth/github/callback`,
      }),
    });

    const tokenJson = (await tokenRes.json()) as { access_token?: string; error_description?: string };
    if (!tokenJson.access_token) {
      throw new HttpError(400, tokenJson.error_description ?? 'GitHub did not return an access token.');
    }

    const { user, scopes } = await getAuthenticatedUser(tokenJson.access_token);
    setSessionUser(session, tokenJson.access_token, 'oauth', user, scopes);
    log.info('GitHub connected via OAuth', { login: user.login });
    res.redirect('/?auth=ok');
  }),
);

/**
 * GET /api/repos — only repositories the signed-in user owns.
 * This is the single source for the repo picker; there is no "type any repo"
 * endpoint anywhere in the app.
 */
authRouter.get(
  '/repos',
  asyncHandler(async (req, res) => {
    const { token, login } = requireAuth(req);
    const includeWritable = req.query.includeWritable === '1';
    const repos = await listOwnedRepos(token, login, { includeWritable });
    res.json({
      login,
      repos,
      includeWritable,
      note: includeWritable
        ? 'Your repositories plus repositories you have write access to. You still choose exactly one.'
        : 'Only repositories owned by you are listed.',
    });
  }),
);
