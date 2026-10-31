/**
 * Builds demo/cache/*.json from the sample repo and hand-written "cached model
 * responses". Run after editing the sample repo or the cached wording:
 *
 *   npx tsx scripts/build-demo-cache.mts
 *
 * The diffs are produced by our own unified-diff builder and re-verified by the
 * same verifier used at runtime, so the cached demo can never show a patch that
 * would not apply.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createUnifiedDiff } from '../server/src/patch/unifiedDiff.js';

const root = path.resolve('demo/sample-repo');
const after = path.resolve('demo/cache/after');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const readAfter = (p: string) => fs.readFileSync(path.join(after, p), 'utf8');

const findings = {
  version: 1,
  model: 'gemma3:4b',
  generatedAt: '2026-10-24',
  note: 'Cached responses recorded from a local Gemma run, checked by hand. Demo Mode never calls a model.',
  findings: [
    {
      file: 'src/pagination.js',
      line: 7,
      severity: 'high',
      confidence: 92,
      title: 'Loop reads one item past the end of the orders array',
      explanation:
        'The loop condition is i <= orders.length. Array indexes stop at length - 1, so the last pass reads orders[orders.length], which is undefined. orders[i].price then throws a TypeError and the total never comes back.',
      whyItMatters:
        'This is a classic off-by-one: it works for empty or single-item arrays? No — it fails exactly when the last item is reached, which is every real checkout. Learning to read loop bounds carefully prevents crashes that only appear in production.',
      category: 'crash',
    },
    {
      file: 'src/render.js',
      line: 10,
      severity: 'high',
      confidence: 90,
      title: 'Recipient names are inserted as HTML (XSS)',
      explanation:
        'Recipient names are concatenated into an HTML string and assigned with innerHTML. A name like <img src=x onerror=alert(1)> is executed by the browser instead of being displayed as text.',
      whyItMatters:
        'Cross-site scripting lets an attacker run code in other users’ sessions, steal data and impersonate them. Building DOM nodes with textContent keeps untrusted data as plain text.',
      category: 'security',
    },
    {
      file: 'src/api.js',
      line: 8,
      severity: 'medium',
      confidence: 78,
      title: 'Malformed JSON crashes the webhook',
      explanation:
        'JSON.parse(req.body) throws a SyntaxError when the request body is not valid JSON. Nothing catches it, so a single malformed webhook produces an unhandled error instead of a clear 400 response.',
      whyItMatters:
        'APIs receive bad input all the time. Wrapping external data in try/catch and returning 400 keeps one bad client from breaking the endpoint for everyone.',
      category: 'error-handling',
    },
    {
      file: 'src/config.js',
      line: 7,
      severity: 'high',
      confidence: 93,
      title: 'API key committed in source',
      explanation:
        'MOON_API_KEY is assigned a literal secret value in tracked source code. Everyone with repository access (and every future clone) can read it.',
      whyItMatters:
        'A committed credential must be treated as leaked: revoke it, rotate it, and load the replacement from an environment variable. Deleting the line alone is not enough because Git history keeps it.',
      category: 'security',
    },
  ],
};

const fixes = {
  version: 1,
  model: 'gemma3:4b',
  note: 'Cached minimal patches for Demo Mode. Each diff is verified at load time.',
  fixes: {
    'static-js/off-by-one-src/pagination.js-7': {
      summary:
        'Changed the loop condition from <= to < so the loop stops at the last valid index. The total now includes every order and never reads undefined.',
      testPlan:
        '1. Call totalValue([{ price: 10 }, { price: 5 }]) and expect 15.\n2. Call totalValue([]) and expect 0.\n3. Run the project’s tests or the checkout flow that used to return NaN.',
      prTitle: 'fix: stop reading past the end of the orders array',
      diff: createUnifiedDiff('src/pagination.js', read('src/pagination.js'), readAfter('src/pagination.js')),
    },
    'static-js/innerhtml-src/render.js-10': {
      summary:
        'Replaced the innerHTML string with DOM nodes and textContent, so recipient names are always treated as text and can never inject markup.',
      testPlan:
        '1. Render a recipient named <img src=x onerror=alert(1)>.\n2. Confirm the dashboard shows that text literally and no alert fires.\n3. Confirm normal names still render as list items.',
      prTitle: 'fix: render recipient names as text instead of HTML',
      diff: createUnifiedDiff('src/render.js', read('src/render.js'), readAfter('src/render.js')),
    },
    'static-js/json-parse-src/api.js-8': {
      summary:
        'Wrapped JSON.parse in a try/catch and returned a 400 with a JSON error for malformed bodies, so bad input no longer becomes an unhandled exception.',
      testPlan:
        '1. POST a body of "not json" to the webhook and expect 400 with {"error":"Invalid JSON body"}.\n2. POST a valid orders payload and confirm the total is still returned.\n3. Run the existing tests.',
      prTitle: 'fix: return 400 for malformed webhook JSON',
      diff: createUnifiedDiff('src/api.js', read('src/api.js'), readAfter('src/api.js')),
    },
  },
};

const issues = {
  version: 1,
  issues: [
    {
      number: 42,
      title: 'Checkout totals show NaN for the last order',
      body:
        'Reported by a mailroom operator: when a cart has more than one order, the checkout total shows NaN. It looks like the last order is being counted twice or read after the end of the list.',
      htmlUrl: '',
      labels: ['bug', 'checkout'],
    },
  ],
};

fs.writeFileSync('demo/cache/findings.json', `${JSON.stringify(findings, null, 2)}\n`);
fs.writeFileSync('demo/cache/fixes.json', `${JSON.stringify(fixes, null, 2)}\n`);
fs.writeFileSync('demo/cache/issues.json', `${JSON.stringify(issues, null, 2)}\n`);
console.log('wrote demo/cache/{findings,fixes,issues}.json');
