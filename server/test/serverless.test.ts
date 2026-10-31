/**
 * Serverless (Vercel) behaviour tests.
 *
 * A function instance can disappear between two requests, so Demo Mode must be
 * fully reproducible from the bundled files. These tests prove that:
 *   - the demo scan id is deterministic,
 *   - a demo fix can be rebuilt by a process that never saw it,
 *   - non-demo ids are never resurrected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoBundle, demoScanId } from '../src/demo/loader.js';
import { demoFixIdFor } from '../src/patch/generate.js';
import { resolveDemoFix, resolveDemoScan } from '../src/demo/rebuild.js';

test('the demo scan id is deterministic and stable across builds', async () => {
  const first = await buildDemoBundle();
  const second = await buildDemoBundle();

  assert.equal(first.scan.scanId, second.scan.scanId);
  assert.equal(first.scan.scanId, demoScanId(first.scan.findings.map((finding) => finding.id)));
  assert.match(first.scan.scanId, /^demo-[0-9a-f]{16}$/);
});

test('a cold instance can resolve a demo scan it has never seen', async () => {
  const { scan } = await buildDemoBundle();
  const resolved = await resolveDemoScan(scan.scanId);

  assert.ok(resolved, 'the demo scan must be recoverable from disk');
  assert.equal(resolved?.scan.mode, 'demo');
  assert.equal(resolved?.scan.findings.length, scan.findings.length);

  assert.equal(await resolveDemoScan('not-a-demo-id'), null);
  assert.equal(await resolveDemoScan('demo-0000000000000000'), null);
});

test('a cold instance can rebuild a demo fix from its deterministic id', async () => {
  const { scan } = await buildDemoBundle();
  const finding = scan.findings.find((candidate) => candidate.ruleId === 'js/off-by-one');
  assert.ok(finding, 'the sample repo must still contain the off-by-one bug');

  const fixId = demoFixIdFor(scan.scanId, finding.id);
  assert.match(fixId, /^demo-[0-9a-f]{16}$/);

  const rebuilt = await resolveDemoFix(fixId);
  assert.ok(rebuilt, 'the fix must be rebuildable');
  assert.equal(rebuilt?.fix.fixId, fixId);
  assert.equal(rebuilt?.fix.verified, true, 'a rebuilt patch is verified exactly like a fresh one');
  assert.ok((rebuilt?.fix.verification.length ?? 0) > 0);
});

test('a fix id that does not belong to the demo is never resurrected', async () => {
  assert.equal(await resolveDemoFix('demo-ffffffffffffffff'), null);
  assert.equal(await resolveDemoFix('abcd1234'), null);
});

/**
 * Regression guard for a production outage:
 *
 * Vercel compiles `api/index.ts` to CommonJS, while `server/` is an ES module
 * package. A *static* import of the server from the entry point was emitted as
 * `require('../server/src/app.js')`, which throws ERR_REQUIRE_ESM on Node
 * runtimes without require(esm) support — the module crashed while loading, so
 * every route answered 500 FUNCTION_INVOCATION_FAILED, including /api/health.
 *
 * The entry must therefore load the app with a dynamic import(), which Vercel's
 * CommonJS output preserves.
 */
test('the Vercel entry never statically imports the ESM server package', () => {
  // Resolve from this test file, not the working directory: `npm test -w server`
  // runs with cwd = server/.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const entry = fs.readFileSync(path.join(repoRoot, 'api/index.ts'), 'utf8');
  const code = entry
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n');

  const staticServerImport = /^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]\.\.\/server\//m;
  assert.equal(
    staticServerImport.test(code),
    false,
    'api/index.ts must not statically import ../server/* — Vercel turns that into require() of an ES module (ERR_REQUIRE_ESM)',
  );

  assert.match(
    code,
    /import\(\s*['"]\.\.\/server\/src\/app\.js['"]\s*\)/,
    'api/index.ts must load the app with a dynamic import()',
  );
});
