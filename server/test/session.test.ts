/**
 * Session continuity tests.
 *
 * Regression guard for the "That scan is no longer in memory" bug: inside a
 * preview iframe the browser blocks the session cookie, so the app must be able
 * to continue the same session through the X-BB-Session header instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_HEADER, getSession, sessionMiddleware, type SessionData } from '../src/session.js';
import { getRememberedDemoScan, rememberDemoScan } from '../src/demo/store.js';
import { buildDemoBundle } from '../src/demo/loader.js';

interface FakeRequest {
  cookies: Record<string, string>;
  path: string;
  get(name: string): string | undefined;
  session?: SessionData;
}

function makeRequest(headers: Record<string, string> = {}, cookies: Record<string, string> = {}): FakeRequest {
  return {
    cookies,
    path: '/api/demo',
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  };
}

function makeResponse() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    cookie() {
      /* the cookie jar is the browser's job in this test */
    },
  };
}

function run(req: FakeRequest, res: ReturnType<typeof makeResponse>): SessionData {
  let captured: SessionData | undefined;
  sessionMiddleware(
    req as never,
    res as never,
    () => {
      captured = getSession(req as never);
    },
  );
  assert.ok(captured, 'middleware must attach a session');
  return captured as SessionData;
}

test('the session id is always echoed in the X-BB-Session header', () => {
  const res = makeResponse();
  const session = run(makeRequest(), res);
  assert.equal(res.headers[SESSION_HEADER.toLowerCase()], session.id);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('a cookie-less client continues the same session via the header', () => {
  const first = run(makeRequest(), makeResponse());

  // Same "browser", no cookie at all, only the header: must be the same session.
  const second = run(makeRequest({ [SESSION_HEADER.toLowerCase()]: first.id }), makeResponse());
  assert.equal(second.id, first.id);
  assert.equal(second, first, 'the same in-memory session object must be reused');
});

test('unknown or malformed session ids start a fresh session', () => {
  const fresh = run(makeRequest({ [SESSION_HEADER.toLowerCase()]: 'x'.repeat(40) }), makeResponse());
  assert.ok(fresh.id.length > 20);

  const malformed = run(makeRequest({ [SESSION_HEADER.toLowerCase()]: 'not a valid id!' }), makeResponse());
  assert.notEqual(malformed.id, fresh.id);
});

test('a valid cookie wins over a stale header', () => {
  const cookieSession = run(makeRequest(), makeResponse());
  const other = run(makeRequest(), makeResponse());

  const res = makeResponse();
  const resolved = run(
    makeRequest(
      { [SESSION_HEADER.toLowerCase()]: other.id },
      { bb_sid: cookieSession.id },
    ),
    res,
  );

  assert.equal(resolved.id, cookieSession.id);
  assert.equal(res.headers[SESSION_HEADER.toLowerCase()], cookieSession.id);
});

test('demo scans are recoverable without a session (demo-only fallback)', async () => {
  const bundle = await buildDemoBundle();
  const record = {
    scan: bundle.scan,
    files: bundle.files,
    repo: bundle.repo,
    userLogin: 'demo',
  };
  rememberDemoScan(record);
  const recovered = getRememberedDemoScan(bundle.scan.scanId);
  assert.ok(recovered, 'the demo scan must be recoverable');
  assert.equal(recovered?.scan.mode, 'demo');
  assert.equal(getRememberedDemoScan('nope'), null);
});
