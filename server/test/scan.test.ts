/**
 * Scanner tests.
 * Run with: npm test -w server
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyPath, looksLikeSecretContent } from '../src/scan/fileFilter.js';
import { runStaticRules } from '../src/scan/staticRules.js';
import { runScan } from '../src/scan/engine.js';
import type { JobContext } from '../src/jobs.js';
import type { RepoFile, RepoSummary } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sampleRoot = path.resolve(here, '../../demo/sample-repo');

const fakeContext: JobContext = {
  id: 'test-job',
  step: () => {},
  progress: () => {},
};

const demoRepo: RepoSummary = {
  owner: 'demo',
  name: 'moonlit-mailroom',
  fullName: 'demo/moonlit-mailroom',
  private: false,
  archived: false,
  fork: false,
  defaultBranch: 'main',
  description: 'A tiny buggy sample service.',
  language: 'JavaScript',
  stars: 0,
  updatedAt: null,
  htmlUrl: 'https://github.com/demo/moonlit-mailroom',
};

function loadSampleRepo(): { paths: string[]; files: RepoFile[] } {
  const paths: string[] = [];
  const files: RepoFile[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = path.relative(sampleRoot, full);
      paths.push(rel);
      const content = fs.readFileSync(full, 'utf8');
      files.push({ path: rel, content, size: content.length });
    }
  };
  walk(sampleRoot);
  return { paths, files };
}

test('secret-looking paths are never read', () => {
  for (const file of ['.env', '.env.local', 'config/.env.production', 'certs/server.pem', 'id_rsa', 'secrets/db.yml', '.npmrc']) {
    const decision = classifyPath(file, 100);
    assert.equal(decision.keep, false, `${file} must be skipped`);
    assert.equal(decision.isSecret, true, `${file} must be marked secret`);
  }
});

test('vendored code, lockfiles and binaries are skipped', () => {
  for (const file of ['node_modules/react/index.js', 'dist/app.js', 'package-lock.json', 'logo.png', 'bundle.min.js']) {
    assert.equal(classifyPath(file, 100).keep, false, `${file} must be skipped`);
  }
  assert.equal(classifyPath('src/app.ts', 100).keep, true);
});

test('secret content is detected before it reaches the model', () => {
  assert.equal(looksLikeSecretContent('-----BEGIN RSA PRIVATE KEY-----\nMIIE...'), true);
  // Built at runtime so the test file itself never contains a key-shaped literal.
  const awsLike = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
  assert.equal(looksLikeSecretContent(`const key = "${awsLike}";`), true);
  assert.equal(looksLikeSecretContent('console.log("hello")'), false);
});

test('rules flag the planted off-by-one with the right line', () => {
  const source = fs.readFileSync(path.join(sampleRoot, 'src/pagination.js'), 'utf8');
  const findings = runStaticRules('src/pagination.js', source);
  const hit = findings.find((finding) => finding.ruleId === 'js/off-by-one');
  assert.ok(hit, 'expected an off-by-one finding');
  assert.equal(hit?.line, 7);
  assert.equal(hit?.severity, 'high');
  assert.ok(hit?.whyItMatters.length > 20, 'learners need a "why it matters"');
});

test('rules flag innerHTML and hardcoded credentials', () => {
  const render = runStaticRules('src/render.js', fs.readFileSync(path.join(sampleRoot, 'src/render.js'), 'utf8'));
  assert.ok(render.some((finding) => finding.ruleId === 'js/innerhtml'));

  const config = runStaticRules('src/config.js', fs.readFileSync(path.join(sampleRoot, 'src/config.js'), 'utf8'));
  const secret = config.find((finding) => finding.ruleId === 'js/hardcoded-secret');
  assert.ok(secret);
  assert.equal(secret?.severity, 'high');
});

test('a demo scan finds exactly the four planted bugs and skips the env file', async () => {
  const { paths, files } = loadSampleRepo();
  const result = await runScan(
    { token: '', repo: demoRepo, mode: 'demo', localFiles: files, localPaths: paths },
    fakeContext,
  );

  const ruleIds = result.findings.map((finding) => finding.ruleId);
  for (const expected of ['js/off-by-one', 'js/innerhtml', 'js/hardcoded-secret', 'js/json-parse']) {
    assert.ok(ruleIds.includes(expected), `expected ${expected} in ${ruleIds.join(', ')}`);
  }

  assert.equal(result.stats.filesScanned, 5);
  assert.ok(result.stats.skippedReasons['env file'] ?? 0 >= 1, 'the .env.example must be skipped');
  assert.ok(
    !JSON.stringify(result.findings).includes('sk-live-moon'),
    'secret values must never be copied into findings',
  );
  const secretFinding = result.findings.find((finding) => finding.ruleId === 'js/hardcoded-secret');
  assert.ok(secretFinding?.snippet?.includes('[redacted]'), 'the snippet must redact the credential');
  assert.ok(result.stats.durationMs >= 0);
  assert.equal(result.mode, 'demo');
});

test('a scan never returns content from .env files', async () => {
  const { paths, files } = loadSampleRepo();
  const result = await runScan(
    { token: '', repo: demoRepo, mode: 'demo', localFiles: files, localPaths: paths },
    fakeContext,
  );
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('MOON_API_KEY=replace-me'), 'env file content must not leak into the scan');
});
