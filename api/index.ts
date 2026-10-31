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
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from '../server/src/app.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

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

const handler: Handler = (req, res) => {
  restorePath(req);
  (app as unknown as Handler)(req, res);
};

export default handler;
