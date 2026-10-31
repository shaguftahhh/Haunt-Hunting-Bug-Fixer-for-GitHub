/**
 * Fix generation tests (deterministic path, no model required).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFix } from '../src/patch/generate.js';
import { verifyPatch } from '../src/patch/verify.js';
import { createUnifiedDiff } from '../src/patch/unifiedDiff.js';
import { mechanicalFix } from '../src/patch/mechanical.js';
import type { JobContext } from '../src/jobs.js';
import type { Finding, RepoSummary } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sampleRoot = path.resolve(here, '../../demo/sample-repo');
const ctx: JobContext = { id: 'fix-test', step: () => {}, progress: () => {} };

const repo: RepoSummary = {
  owner: 'demo',
  name: 'moonlit-mailroom',
  fullName: 'demo/moonlit-mailroom',
  private: false,
  archived: false,
  fork: false,
  defaultBranch: 'main',
  description: null,
  language: 'JavaScript',
  stars: 0,
  updatedAt: null,
  htmlUrl: 'https://github.com/demo/moonlit-mailroom',
};

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: 'finding-1',
    source: 'static',
    file: 'src/pagination.js',
    line: 7,
    severity: 'high',
    confidence: 86,
    title: 'Loop can run one item past the end of the array',
    explanation: 'The loop uses <= .length.',
    whyItMatters: 'It reads undefined and can crash.',
    ruleId: 'js/off-by-one',
    ...overrides,
  };
}

test('an off-by-one fix verifies, applies, and removes the finding', async () => {
  const file = 'src/pagination.js';
  const before = fs.readFileSync(path.join(sampleRoot, file), 'utf8');
  const result = await generateFix(
    {
      scanId: 'scan-1',
      mode: 'demo',
      repo,
      finding: finding({}),
      path: file,
      beforeContent: before,
    },
    ctx,
  );

  const fix = result.record.fix;
  assert.equal(fix.verified, true);
  assert.equal(fix.generatedBy, 'mechanical');
  assert.ok(fix.branchName.startsWith('bugbanisher/fix-'));
  assert.notEqual(fix.branchName, repo.defaultBranch);
  assert.equal(fix.staticFindingsAfter, 0);
  assert.ok(fix.prBody.includes('## What was wrong'));
  assert.ok(fix.prBody.includes('## How to test'));
  assert.ok(fix.prBody.includes('ai-assisted'));
  assert.ok(result.record.afterContent.includes('i < orders.length'));
  assert.equal(result.record.beforeContent, before);
  assert.ok(fix.diff.includes('@@'));
});

test('a hardcoded credential is fixed mechanically and masked in the diff', async () => {
  const file = 'src/config.js';
  const before = fs.readFileSync(path.join(sampleRoot, file), 'utf8');
  const secretFinding = finding({
    id: 'finding-secret',
    ruleId: 'js/hardcoded-secret',
    file,
    line: 7,
    title: 'Possible hardcoded credential',
  });

  const result = await generateFix(
    { scanId: 'scan-1', mode: 'demo', repo, finding: secretFinding, path: file, beforeContent: before },
    ctx,
  );

  const fix = result.record.fix;
  assert.equal(fix.verified, true);
  assert.equal(fix.diffRedacted, true);
  assert.ok(!fix.diff.includes('sk-live-moon'), 'the displayed diff must not contain the credential');
  assert.ok(fix.diff.includes('[redacted]'));
  assert.ok(result.record.afterContent.includes('process.env.MOON_API_KEY'));
  assert.ok(!result.record.afterContent.includes('sk-live-moon'));
});

test('a patch that does not apply is rejected', () => {
  const before = fs.readFileSync(path.join(sampleRoot, 'src/pagination.js'), 'utf8');
  const bogus = [
    '--- a/src/pagination.js',
    '+++ b/src/pagination.js',
    '@@ -1,2 +1,2 @@',
    '-this line does not exist',
    '+and neither does this',
  ].join('\n');

  const outcome = verifyPatch({
    path: 'src/pagination.js',
    before,
    diff: bogus,
    finding: finding({}),
  });
  assert.equal(outcome.verified, false);
  assert.ok(outcome.checks.some((check) => !check.ok));
});

test('a patch that breaks syntax is rejected', () => {
  const before = fs.readFileSync(path.join(sampleRoot, 'src/pagination.js'), 'utf8');
  const broken = before.replace('let total = 0;', 'let total = ;');
  const diff = createUnifiedDiff('src/pagination.js', before, broken);
  const outcome = verifyPatch({ path: 'src/pagination.js', before, diff, finding: finding({}) });
  assert.equal(outcome.verified, false);
  assert.ok(outcome.checks.some((check) => !check.ok && /syntax/i.test(check.label)));
});

test('mechanical fixes are only offered where they are safe', () => {
  const before = fs.readFileSync(path.join(sampleRoot, 'src/render.js'), 'utf8');
  assert.equal(mechanicalFix(finding({ file: 'src/render.js', ruleId: 'js/innerhtml', line: 10 }), before), null);
  const pagination = fs.readFileSync(path.join(sampleRoot, 'src/pagination.js'), 'utf8');
  const fixed = mechanicalFix(finding({}), pagination);
  assert.ok(fixed?.content.includes('i < orders.length'));
});
