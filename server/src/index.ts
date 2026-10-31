/**
 * BugBanisher API entry point for a long-lived Node process.
 *
 * The Express app itself lives in `app.ts` so the same code can also be mounted
 * as a serverless function (`api/index.ts` at the repository root).
 */
import { app } from './app.js';
import { config, oauthAvailable } from './config.js';
import { log } from './logger.js';

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
