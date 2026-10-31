#!/usr/bin/env node
/**
 * Live smoke test against the running BugBanisher server.
 *
 * Uses the token from the GitHub CLI (`gh auth token`) so no secret is typed
 * into a shell or written to disk. The token is only sent to localhost and is
 * never printed.
 *
 *   npm run dev            # in one terminal
 *   node scripts/live-check.mjs shaguftahhh/Haunt-Hunting-Bug-Fixer-for-GitHub
 */
import { execFileSync } from 'node:child_process';

const repo = process.argv[2];
if (!repo) {
  console.error('Usage: node scripts/live-check.mjs <owner/repo>');
  process.exit(1);
}

const base = process.env.BB_BASE ?? 'http://localhost:8787';
const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
if (!token) {
  console.error('No gh token available. Run `gh auth login` first.');
  process.exit(1);
}

let cookies = '';
async function api(pathname, init = {}) {
  const res = await fetch(`${base}/api${pathname}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(cookies ? { Cookie: cookies } : {}),
      ...(init.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookies = setCookie.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${res.status}: ${typeof body === 'object' ? body.error : text}`);
  return body;
}

const session = await api('/auth/pat', { method: 'POST', body: JSON.stringify({ token }) });
console.log(`connected as @${session.user.login} (dryRun=${session.dryRun})`);

const repos = await api('/repos');
console.log(`owned repos: ${repos.repos.length}; looking for ${repo}…`);
if (!repos.repos.some((r) => r.fullName.toLowerCase() === repo.toLowerCase())) {
  console.error('Repo not in owned list. Fine-grained tokens only see selected repos.');
  process.exit(1);
}

const { jobId } = await api('/scan', { method: 'POST', body: JSON.stringify({ repoFullName: repo }) });
console.log(`scan job ${jobId} started`);

for (let i = 0; i < 120; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const job = await api(`/scan/${jobId}`);
  process.stdout.write(`\r[${String(job.progress).padStart(3)}%] ${job.step.padEnd(40)}`);
  if (job.status === 'done') {
    console.log('\n--- findings ---');
    for (const finding of job.result.findings) {
      console.log(`${finding.severity.toUpperCase().padEnd(6)} ${finding.file}:${finding.line} — ${finding.title} [${finding.ruleId}]`);
    }
    console.log('--- stats ---');
    console.log(job.result.stats);
    console.log('--- notes ---');
    for (const note of job.result.notes) console.log('-', note);
    process.exit(0);
  }
  if (job.status === 'error') {
    console.error(`\nscan failed: ${job.error}`);
    process.exit(1);
  }
}
console.error('\nTimed out waiting for the scan.');
process.exit(1);
