/**
 * Small HTTP helpers shared by the route modules.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { GitHubError } from './github/client.js';
import { log, safeErrorMessage } from './logger.js';
import { getSession } from './session.js';
import { config, oauthAvailable } from './config.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Wrap an async handler so thrown errors reach the central error handler. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/** Standard error shape consumed by the React app. */
export interface ApiErrorBody {
  error: string;
  hint?: string;
  status: number;
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof GitHubError) {
    const status = error.status >= 400 && error.status < 600 ? error.status : 502;
    const body: ApiErrorBody = { error: error.message, hint: error.hint, status };
    if (status === 401) body.hint = body.hint ?? 'Reconnect GitHub to refresh your token.';
    log.warn('GitHub API error', { status, message: error.message });
    res.status(status).json(body);
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, status: error.status } satisfies ApiErrorBody);
    return;
  }
  const message = safeErrorMessage(error);
  log.error('Unhandled API error', { message });
  res.status(500).json({
    error: 'Something went bump in the night (server error).',
    hint: message,
    status: 500,
  } satisfies ApiErrorBody);
}

export function requireAuth(req: Request): { token: string; login: string } {
  const session = getSession(req);
  if (!session.token || !session.user) {
    throw new HttpError(401, 'Connect GitHub first, then try again.');
  }
  return { token: session.token, login: session.user.login };
}

/** True when a GitHub OAuth app is configured; otherwise only PATs work. */
export const canUseOAuth = oauthAvailable;

/** Cookie options for the OAuth state cookie (short-lived CSRF protection). */
export function stateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProduction,
    maxAge: 10 * 60 * 1000,
    path: '/',
  };
}
