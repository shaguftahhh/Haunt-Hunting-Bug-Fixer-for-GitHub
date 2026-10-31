/**
 * Vercel serverless entry point.
 *
 * Vercel maps `api/index.ts` to `/api`. Because a single function cannot also own
 * `/api/scan`, `/api/fix/...`, `vercel.json` rewrites those paths to
 * `/api?__bb_path=scan`, and this handler puts the original path back before
 * handing the request to the same Express app that runs locally.
 *
 * The path restore is deliberately tolerant: if the platform forwards the path
 * untouched (or only rewrites to `/api`), the request still reaches Express with
 * a URL it understands.
 *
 * IMPORTANT — why the app is loaded lazily:
 * Vercel compiles this file to **CommonJS**, but `server/` is an ES module
 * package (`"type": "module"`). A static `import { app } from '../server/src/app.js'`
 * therefore became `require('../server/src/app.js')`, which throws
 * `ERR_REQUIRE_ESM` on any Node runtime without `require(esm)` support (Node < 22.12).
 * That crash happened while the module was loading, so *every* route answered
 * `500 FUNCTION_INVOCATION_FAILED` — including `/api/health`.
 *
 * A dynamic `import()` stays a real `import()` in Vercel's CommonJS output, so the
 * ES module is loaded the way it is meant to be, on any supported Node version.
 * The promise is cached, so the module is evaluated once per instance.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let appPromise: Promise<Handler> | null = null;

function loadApp(): Promise<Handler> {
  appPromise ??= import('../server/src/app.js').then((mod) => mod.app as unknown as Handler);
  return appPromise;
}

function restorePath(req: IncomingMessage): void {
  const raw = req.url ?? '/';
  const url = new URL(raw, 'http://localhost');
  const rewrite = url.searchParams.get('__bb_path');

  if (rewrite === null) return; // path already intact

  url.searchParams.delete('__bb_path');
  const query = url.searchParams.toString();
  const suffix = rewrite.replace(/^\/+/, '');
  req.url = `/api${suffix ? `/${suffix}` : ''}${query ? `?${query}` : ''}`;
}

const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  restorePath(req);

  let app: Handler;
  try {
    app = await loadApp();
  } catch (error) {
    // A load failure would otherwise be an opaque 500. Surface the real reason
    // in the response (never any secret: this is module loading, not auth).
    const message = error instanceof Error ? error.message : String(error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'BugBanisher failed to start.', detail: message, status: 500 }));
    return;
  }

  app(req, res);
};

export default handler;
