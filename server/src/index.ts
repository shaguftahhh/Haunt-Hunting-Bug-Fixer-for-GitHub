/**
 * BugBanisher API entry point for a long-lived Node process.
 *
 * The Express app itself lives in `app.ts` so the same code can also be mounted
 * as a serverless function (`api/index.ts` at the repository root).
 *
 * On a serverless platform this module is *imported* rather than run as a server,
 * and the platform expects the Express app itself. Calling `listen()` there would
 * open a socket nothing reads — so the app is always exported, and the listener is
 * only started when we really are a long-lived process. That also keeps a
 * misconfigured deployment (Vercel "Root Directory" pointed at `server/`, where
 * `api/index.ts` is invisible) answering as an API instead of crashing.
 */
import { app } from './app.js';
import { config, oauthAvailable } from './config.js';
import { log } from './logger.js';

export default app;

function serve(): void {
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
}

if (config.serverless) {
  log.info('Serverless runtime detected: exporting the app instead of listening');
} else {
  serve();
}
