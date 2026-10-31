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
