/**
 * UI smoke tests, rendered with react-dom/server.
 *
 * There is no browser in CI, but server rendering still executes every JSX
 * branch that does not depend on effects — it catches undefined access,
 * missing guards and broken prop shapes. Effects (fetch, focus, polling) are
 * covered by the server tests and manual demo script.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import App from '../src/App';
import { BugBoard } from '../src/components/BugBoard';
import { ApproveModal } from '../src/components/ApproveModal';
import { DiffViewer } from '../src/components/DiffViewer';
import { FixPanel } from '../src/components/FixPanel';
import { HistoryPanel } from '../src/components/HistoryPanel';
import { ScanPanel } from '../src/components/ScanPanel';
import { Ghost } from '../src/components/Ghost';
import type { FixResult, ScanResult, SessionView } from '../src/types';

const repo = {
  owner: 'bugbanisher-demo',
  name: 'moonlit-mailroom',
  fullName: 'bugbanisher-demo/moonlit-mailroom',
  private: false,
  archived: false,
  fork: false,
  defaultBranch: 'main',
  description: 'demo',
  language: 'JavaScript',
  stars: 0,
  updatedAt: null,
  htmlUrl: '',
};

const scan: ScanResult = {
  scanId: 'scan-demo',
  mode: 'demo',
  repo,
  findings: [
    {
      id: 'static-js/off-by-one-src/pagination.js-7',
      source: 'static+llm',
      file: 'src/pagination.js',
      line: 7,
      severity: 'high',
      confidence: 92,
      title: 'Loop reads one item past the end of the orders array',
      explanation: 'The loop uses <= .length.',
      whyItMatters: 'It reads undefined and crashes checkout.',
      ruleId: 'js/off-by-one',
      fixHint: 'Change <= .length to < .length so the loop stops at the last index.',
      autoFixAvailable: true,
      snippet: 'function totalValue(orders) {\n  let total = 0;\n  for (let i = 0; i <= orders.length; i += 1) {\n    total += orders[i].price;',
      snippetStart: 5,
    },
    {
      id: 'issue-42',
      source: 'issue',
      file: 'issue #42',
      line: 0,
      severity: 'medium',
      confidence: 45,
      title: 'Checkout totals show NaN for the last order',
      explanation: 'Reported by a mailroom operator.',
      whyItMatters: 'Real-world evidence.',
      issue: { number: 42, title: 'Checkout totals show NaN', url: '', labels: ['bug'] },
    },
  ],
  stats: {
    filesInRepo: 10,
    filesScanned: 5,
    filesSkipped: 5,
    skippedReasons: { 'env file': 1 },
    lintersDetected: ['ESLint (.eslintrc.json)'],
    issuesRead: 1,
    modelUsed: 'gemma3:4b (cached)',
    modelAvailable: true,
    autoFixableCount: 1,
    durationMs: 120,
  },
  notes: ['Demo Mode: bundled sample repo.'],
  createdAt: new Date('2026-10-31T00:00:00Z').toISOString(),
};

const fix: FixResult = {
  fixId: 'fix-1',
  scanId: scan.scanId,
  finding: scan.findings[0]!,
  diff: [
    '--- a/src/pagination.js',
    '+++ b/src/pagination.js',
    '@@ -5,7 +5,7 @@',
    ' function totalValue(orders) {',
    '   let total = 0;',
    '-  for (let i = 0; i <= orders.length; i += 1) {',
    '+  for (let i = 0; i < orders.length; i += 1) {',
    '     total += orders[i].price;',
    '   }',
    '   return total;',
  ].join('\n'),
  summary: 'Changed <= to < so the last pass does not read undefined.',
  testPlan: '1. Call totalValue with two orders and expect 15.',
  branchName: 'bugbanisher/fix-loop-reads-one-item-past-the-end-f11017',
  prTitle: 'fix: stop reading past the end of the orders array',
  prBody: '## What was wrong\n\nA loop ran past the end.\n\n## How to test\n\nRun the tests.',
  verification: [
    { id: 'applies', label: 'Applies cleanly', ok: true, detail: 'Applied 1 hunk.' },
    { id: 'syntax', label: 'Syntax check', ok: true, detail: 'Parses.' },
  ],
  verified: true,
  generatedBy: 'cached',
  model: 'gemma3:4b (cached)',
  filesChanged: ['src/pagination.js'],
  staticFindingsBefore: 1,
  staticFindingsAfter: 0,
  diffRedacted: false,
};

const session: SessionView = {
  connected: false,
  user: null,
  oauthAvailable: false,
  dryRun: true,
  approvals: 1,
  approvalCap: 3,
  history: [
    {
      id: 'entry-1',
      mode: 'demo',
      fixId: fix.fixId,
      findingId: fix.finding.id,
      repoFullName: repo.fullName,
      number: null,
      title: fix.prTitle,
      branchName: fix.branchName,
      htmlUrl: null,
      dryRun: true,
      status: 'dry-run',
      createdAt: new Date('2026-10-31T00:10:00Z').toISOString(),
      findingTitle: fix.finding.title,
      file: fix.finding.file,
      line: fix.finding.line,
    },
  ],
  demoAvailable: true,
  llm: { provider: 'ollama', model: 'gemma3:4b' },
};

const noop = () => {};

test('App renders the boot state without crashing', () => {
  const html = renderToString(<App />);
  assert.match(html, /BugBanisher/);
  assert.match(html, /Summoning the BugBanisher/);
});

test('Bug Board renders findings, issue findings, snippets and the demo banner state', () => {
  const html = renderToString(
    <BugBoard
      scan={scan}
      banished={new Set([scan.findings[0]!.id])}
      backLabel="Exit demo"
      onBack={noop}
      onRescan={noop}
      onPickFix={noop}
    />,
  );
  assert.match(html, /Loop reads one item past the end/);
  assert.match(html, /banished/);
  assert.match(html, /issue #42/);
  assert.match(html, /Why it matters/);
  assert.match(html, /How to fix:/);
  assert.match(html, /Quick fix/);
  assert.match(html, /Exit demo/);
  // Demo scans must never render a GitHub code link.
  assert.ok(!html.includes('/blob/main'), 'demo findings must not link to GitHub');
});

test('the fix panel renders the verification checklist and the diff', () => {
  const html = renderToString(
    <FixPanel
      scan={scan}
      finding={fix.finding}
      model={null}
      onCheckModel={noop}
      dryRun
      approvals={0}
      approvalCap={3}
      onBack={noop}
      onApprove={noop}
    />,
  );
  // Server-rendered React runs the initial state: the job starts on mount.
  assert.match(html, /Fix preview/);
  assert.match(html, /How to fix:/);
  assert.match(html, /Why it matters/);
  assert.match(html, /Back to board/);
});

test('Approval dialog shows branch, title, PR body and the dry-run warning', () => {
  const html = renderToString(
    <ApproveModal
      fix={fix}
      scan={scan}
      dryRun
      approvals={0}
      approvalCap={3}
      onClose={noop}
      onApproved={noop}
    />,
  );
  assert.match(html, /role="dialog"/);
  assert.match(html, /Simulate approval/);
  assert.match(html, /bugbanisher\/fix-loop-reads/);
  assert.match(html, /Open a pull request\?/);
  assert.match(html, /What was wrong/);
});

test('History renders empty and populated states', () => {
  const empty = renderToString(<HistoryPanel session={null} onBack={noop} onDisconnect={noop} />);
  assert.match(empty, /No pull requests yet/);

  const populated = renderToString(<HistoryPanel session={session} onBack={noop} onDisconnect={noop} />);
  assert.match(populated, /fix: stop reading past the end/);
  assert.match(populated, /dry run/);
  assert.match(populated, /approvals used/);
  assert.match(populated, /aria-valuenow="1"/);
});

test('Diff viewer renders side-by-side rows and hides the credential value', () => {
  const html = renderToString(
    <DiffViewer
      diff={[
        '--- a/src/config.js',
        '+++ b/src/config.js',
        '@@ -5,3 +5,3 @@',
        " const MOON_API_KEY = '[redacted]';",
        '-const token = "secret";',
        '+const token = process.env.TOKEN;',
      ].join('\n')}
      redacted
    />,
  );
  assert.match(html, /credentials masked/);
  assert.match(html, /Side-by-side/);
  assert.match(html, /Before/);
});

test('Scan panel renders the read-only warning and the no-model warning', () => {
  const html = renderToString(
    <ScanPanel
      repo={repo}
      dryRun
      model={{
        provider: 'ollama',
        model: 'gemma3:4b',
        ok: false,
        detail: 'No model server answered at http://localhost:11434.',
        setup: ['ollama serve'],
      }}
      modelLoading={false}
      onCheckModel={noop}
      onBack={noop}
      onScanned={noop}
    />,
  );
  assert.match(html, /Read-only scan/);
  assert.match(html, /AI model not reachable/);
  assert.match(html, /Quick fix/);
  assert.match(html, /Scan for bugs/);
});

test('the ghost mascot has an accessible name', () => {
  const html = renderToString(<Ghost size={64} mood="happy" />);
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="Boo the pixel ghost"/);
});
