/**
 * Serverless smoke test.
 *
 * Emulates what Vercel does with this repository, without deploying:
 *   - loads the real `api/index.ts` function,
 *   - applies the same `/api/(.*) → /api?__bb_path=$1` rewrite from vercel.json,
 *   - runs the Demo Mode flow across TWO separate processes, i.e. a cold start
 *     between every step, which is the case that breaks naive in-memory sessions.
 *
 * Usage: npx tsx scripts/serverless-check.mjs
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'serverless-check.mjs');
const stage = process.argv[2] ?? 'all';

/** Recreate vercel.json's rewrite: /api/scan → /api?__bb_path=scan */
function applyRewrite(url) {
  const parsed = new URL(url, 'http://localhost');
  if (!parsed.pathname.startsWith('/api/')) return parsed.pathname + parsed.search;
  const rest = parsed.pathname.slice('/api/'.length);
  return `/api?__bb_path=${rest}${parsed.search ? `&${parsed.search.slice(1)}` : ''}`;
}

async function startInstance() {
  process.env.SERVERLESS = '1';
  process.env.LLM_PROVIDER = 'none';
  const { default: handler } = await import('../api/index.ts');

  const server = http.createServer((req, res) => {
    const original = req.url ?? '/';
    req.url = applyRewrite(original);
    handler(req, res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

// Mirrors web/src/api.ts: when the cookie is unavailable the browser keeps the
// session id from the X-BB-Session response header and echoes it back.
let sessionId = null;

async function call(base, method, apiPath, body) {
  const started = Date.now();
  const res = await fetch(`${base}/api/${apiPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionId ? { 'X-BB-Session': sessionId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const echoed = res.headers.get('x-bb-session');
  if (echoed) sessionId = echoed;
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, ms: Date.now() - started };
}

async function runStage(name, args) {
  const child = spawn(process.execPath, ['--import', 'tsx', script, name, ...args], {
    cwd: path.join(here, '..'),
    env: { ...process.env, SERVERLESS: '1', LLM_PROVIDER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  child.stderr.on('data', (chunk) => (err += chunk));

  const code = await new Promise((resolve) => child.on('close', resolve));
  if (code !== 0) throw new Error(`${name} failed (${code}):\n${err || out}`);

  const line = out.trim().split('\n').filter(Boolean).pop() ?? '{}';
  return JSON.parse(line);
}

// ------------------------------------------------------------------ stages

if (stage === 'cold-scan') {
  // Instance 1: demo scan + fix, then the process exits.
  const { server, base } = await startInstance();
  const demo = await call(base, 'POST', 'demo', {});
  const scan = demo.body.scan;
  const patchable = scan.findings.filter((f) => f.source !== 'issue');

  const fixes = [];
  for (const finding of patchable) {
    const res = await call(base, 'POST', 'fix', { scanId: scan.scanId, findingId: finding.id });
    fixes.push({
      findingId: finding.id,
      rule: finding.ruleId,
      status: res.status,
      immediate: Boolean(res.body.result),
      verified: res.body.result?.verified ?? false,
      fixId: res.body.result?.fixId ?? null,
      ms: res.ms,
    });
  }

  server.close();
  console.log(
    JSON.stringify({
      demoStatus: demo.status,
      demoMs: demo.ms,
      scanId: scan.scanId,
      findings: scan.findings.length,
      quick: scan.stats.autoFixableCount,
      fixes,
    }),
  );
  process.exit(0);
}

if (stage === 'cold-continue') {
  // Instance 2: a brand-new process that has never seen this scan or fix.
  const [scanId, fixId] = process.argv.slice(3);
  const { server, base } = await startInstance();

  const fixResult = await call(base, 'GET', `fix/result/${fixId}`);
  // A fresh process starts a fresh session: the demo fix must still resolve.
  const approve = await call(base, 'POST', 'approve', { fixId, confirm: true });
  const history = await call(base, 'GET', 'history');

  server.close();
  console.log(
    JSON.stringify({
      fixRebuilt: fixResult.status === 200 && fixResult.body.fixId === fixId,
      fixVerified: fixResult.body?.verified ?? false,
      fixChecks: fixResult.body?.verification?.length ?? 0,
      approveStatus: approve.status,
      approveRecord: approve.body?.record?.status ?? null,
      cap: approve.body?.session?.approvalCap ?? null,
      approvalUsed: approve.body?.session?.approvals ?? null,
      history: history.body?.history?.length ?? 0,
      scanIdSeen: scanId,
    }),
  );
  process.exit(0);
}

// ------------------------------------------------------------------ driver

if (stage === 'github-inline') {
  // Optional: proves the real GitHub path also survives serverless mode.
  const repo = process.env.BB_TEST_REPO || 'shaguftahhh/eidolon_memory';
  const token = process.env.BB_TEST_TOKEN;
  if (!token) {
    console.log('{"skipped":"BB_TEST_TOKEN not set"}');
    process.exit(0);
  }

  const { server, base } = await startInstance();
  const connect = await call(base, 'POST', 'auth/pat', { token });
  const scan = await call(base, 'POST', 'scan', { repoFullName: repo });
  const result = scan.body.result;
  server.close();

  console.log(
    JSON.stringify({
      connect: connect.status,
      scanStatus: scan.status,
      inline: Boolean(result),
      filesScanned: result?.stats?.filesScanned ?? 0,
      findings: result?.findings?.length ?? 0,
      ms: scan.ms,
      error: scan.body?.error ?? null,
    }),
  );
  process.exit(scan.status === 200 && result ? 0 : 1);
}

if (stage === 'all') {
  console.log('Stage 1 — cold instance: demo scan + fix inside one request');
  const first = await runStage('cold-scan', []);
  console.log(`  demo: HTTP ${first.demoStatus} in ${first.demoMs}ms · ${first.findings} findings · ${first.quick} quick fixes`);
  console.log(`  scanId is deterministic: ${first.scanId}`);
  for (const fix of first.fixes) {
    console.log(
      `  ${fix.verified ? '✓' : '✗'} ${fix.rule.padEnd(20)} HTTP ${fix.status} · inline result ${fix.immediate} · verified ${fix.verified} · ${fix.ms}ms`,
    );
  }

  const target = first.fixes.find((fix) => fix.verified);
  if (!target) {
    console.error('  ✗ no verified fix to continue with');
    process.exit(1);
  }

  console.log('Stage 2 — NEW process (cold start): rebuild the same fix, then approve');
  const second = await runStage('cold-continue', [first.scanId, target.fixId]);
  console.log(`  fix rebuilt from disk: ${second.fixRebuilt} · verified ${second.fixVerified} · ${second.fixChecks} checks`);
  console.log(`  approve: HTTP ${second.approveStatus} · ${second.approveRecord} · ${second.approvalUsed}/${second.cap}`);
  console.log(`  history entries: ${second.history}`);

  const ok =
    first.fixes.every((fix) => fix.status === 200 && fix.verified) &&
    second.fixRebuilt &&
    second.fixVerified &&
    second.approveStatus === 200 &&
    second.approveRecord === 'dry-run';

  if (process.env.BB_TEST_TOKEN) {
    console.log('Stage 3 — real GitHub repo, inline scan (no warm state)');
    const gh = await runStage('github-inline', []);
    console.log(
      `  connect ${gh.connect} · scan HTTP ${gh.scanStatus} · inline ${gh.inline} · ${gh.filesScanned} files · ${gh.findings} findings · ${gh.ms}ms`,
    );
    if (!gh.inline || gh.scanStatus !== 200) {
      console.log('\nFAIL — GitHub scan did not complete inline.');
      process.exit(1);
    }
  }

  console.log(ok ? '\nPASS — the deployment works with zero warm state.' : '\nFAIL — see above.');
  process.exit(ok ? 0 : 1);
}
