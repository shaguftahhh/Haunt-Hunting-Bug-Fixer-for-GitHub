/**
 * BugBanisher API server.
 *
 * Responsibilities, in order of importance:
 *   1. Hold GitHub tokens in memory only (never on disk, never in the browser).
 *   2. Serve the JSON API the React app talks to.
 *   3. Serve the built React app in production (single process, single port).
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { config, oauthAvailable } from './config.js';
import { errorHandler } from './http.js';
import { log } from './logger.js';
import { sessionMiddleware } from './session.js';
import { authRouter } from './routes/auth.js';
import { settingsRouter } from './routes/settings.js';
import { scanRouter } from './routes/scan.js';
import { fixRouter } from './routes/fix.js';
import { approveRouter } from './routes/approve.js';
import { demoRouter } from './routes/demo.js';
import { modelRouter } from './routes/model.js';

const app = express();

// Respect X-Forwarded-* when deployed behind a proxy (OAuth redirect URLs).
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(sessionMiddleware);

// CSRF hardening: state-changing requests that carry an Origin must come from
// this same origin. (Cookies are also SameSite=Lax.)
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  const host = req.get('host');
  try {
    if (new URL(origin).host !== host) {
      res.status(403).json({ error: 'Cross-origin writes are not allowed.', status: 403 });
      return;
    }
  } catch {
    res.status(403).json({ error: 'Invalid Origin header.', status: 403 });
    return;
  }
  next();
});

// Basic security headers. No third-party scripts, no inline eval.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  );
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    name: 'BugBanisher',
    oauth: oauthAvailable(),
    llmProvider: config.llm.provider,
    version: '1.0.0',
  });
});

app.use('/api', authRouter);
app.use('/api', settingsRouter);
app.use('/api', scanRouter);
app.use('/api', fixRouter);
app.use('/api', approveRouter);
app.use('/api', demoRouter);
app.use('/api', modelRouter);

// In production we serve the built frontend from web/dist.
if (fs.existsSync(config.webDistDir)) {
  app.use(express.static(config.webDistDir, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(config.webDistDir, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: `No API route for ${req.method} ${req.path}`, status: 404 });
});

app.use(errorHandler);

const server = app.listen(config.port, '0.0.0.0', () => {
  log.info('BugBanisher API listening', {
    url: `http://localhost:${config.port}`,
    oauth: oauthAvailable() ? 'configured' : 'not configured (PAT only)',
    llm: `${config.llm.provider}/${config.llm.model}`,
    dryRunDefault: true,
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info(`Received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  });
}
