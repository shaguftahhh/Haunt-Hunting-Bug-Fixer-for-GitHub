/**
 * Deployment diagnostics.
 *
 * Regression guard for a real deployment: Vercel was pointed at the `server/`
 * folder, so only the API was deployed and opening the URL showed
 * `{"error":"No API route for GET /","status":404}`. A person opening that link
 * must get an explanation and the fix, while API clients keep getting JSON.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// Point the static folder at something that does not exist *before* the app is
// imported, so this behaves exactly like a deployment without a built UI.
process.env.WEB_DIST_DIR = '/tmp/bugbanisher-no-ui-here';
process.env.SERVERLESS = '1';

const { app } = await import('../src/app.js');

const server = http.createServer(app);
// Keep-alive sockets from fetch() would otherwise keep the test process alive.
server.unref();
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

test.after(() => {
  server.closeAllConnections?.();
  server.close();
});

test('health reports that no UI is built', async () => {
  const res = await fetch(`${base}/api/health`);
  const body = (await res.json()) as { ok: boolean; ui: boolean; serverless: boolean };
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.ui, false);
  assert.equal(body.serverless, true);
});

test('opening the root URL in a browser explains the deployment', async () => {
  const res = await fetch(`${base}/`, { headers: { Accept: 'text/html' } });
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.match(html, /The API is running/);
  assert.match(html, /Root Directory/);
  assert.match(html, /vercel\.json/);
  assert.match(html, /\/api\/health/);
  // The old, confusing response must be gone.
  assert.doesNotMatch(html, /No API route for GET/);
});

test('deep links also render the setup page, not JSON', async () => {
  const res = await fetch(`${base}/board?x=1`, { headers: { Accept: 'text/html' } });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /API only/);
});

test('unknown API routes still answer with JSON', async () => {
  const res = await fetch(`${base}/api/nope`, { headers: { Accept: 'text/html' } });
  const body = (await res.json()) as { error: string; status: number };
  assert.equal(res.status, 404);
  assert.match(body.error, /No API route for GET \/api\/nope/);
});

test('API clients that do not accept HTML still get JSON', async () => {
  const res = await fetch(`${base}/`, { headers: { Accept: 'application/json' } });
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /No API route/);
});
