/**
 * Demo Mode tests: the offline demo must contain the four planted bugs, a
 * bundled issue, and cached patches that actually pass verification.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoBundle, cachedFixFor } from '../src/demo/loader.js';
import { verifyPatch } from '../src/patch/verify.js';

const bundle = await buildDemoBundle();

test('demo bundle has the four planted bugs plus the bundled issue', () => {
  const rules = bundle.scan.findings.map((finding) => finding.ruleId ?? '');
  for (const expected of ['js/off-by-one', 'js/innerhtml', 'js/hardcoded-secret', 'js/json-parse']) {
    assert.ok(rules.includes(expected), `missing ${expected}`);
  }
  assert.ok(bundle.scan.findings.some((finding) => finding.source === 'issue'));
  assert.equal(bundle.scan.mode, 'demo');
  assert.match(bundle.scan.stats.modelUsed ?? '', /cached/);
});

test('demo findings are merged with cached model explanations', () => {
  const pagination = bundle.scan.findings.find((finding) => finding.file === 'src/pagination.js');
  assert.equal(pagination?.source, 'static+llm');
  assert.match(pagination?.title ?? '', /past the end/i);
  assert.ok((pagination?.confidence ?? 0) >= 90);
});

test('cached patches apply and pass the same verifier used in production', () => {
  const fixes = bundle.scan.findings
    .filter((finding) => finding.source !== 'issue')
    .map((finding) => ({ finding, cached: cachedFixFor(finding.id) }))
    .filter((entry) => entry.cached !== null);

  assert.ok(fixes.length >= 3, 'expected at least three cached patches');
  for (const { finding, cached } of fixes) {
    const file = bundle.files.find((candidate) => candidate.path === finding.file);
    assert.ok(file);
    const outcome = verifyPatch({
      path: finding.file,
      before: file?.content ?? '',
      diff: cached?.diff ?? '',
      finding,
    });
    assert.equal(outcome.verified, true, `${finding.file}: ${outcome.failure ?? 'unknown failure'}`);
  }
});

test('the credential bug has no cached model patch (it is fixed mechanically)', () => {
  const secret = bundle.scan.findings.find((finding) => finding.ruleId === 'js/hardcoded-secret');
  assert.ok(secret);
  assert.equal(cachedFixFor(secret?.id ?? ''), null);
});

test('demo scans never include env-file content', () => {
  const serialized = JSON.stringify(bundle.scan);
  assert.ok(!serialized.includes('MOON_API_KEY=replace-me'));
  assert.ok(bundle.scan.stats.skippedReasons['env file'] ?? 0 >= 1);
});
