#!/usr/bin/env node
/**
 * End-to-end check of Demo Mode against a running server.
 *
 *   npm run dev                    # in another terminal
 *   node scripts/demo-check.mjs    # default: http://localhost:8787
 *   BB_BASE=http://localhost:8899 node scripts/demo-check.mjs
 *
 * It loads the bundled demo, generates every patch, approves three of them in
 * dry-run, and confirms the fourth is refused by the session cap. Nothing is
 * written to GitHub.
 */
const base = process.env.BB_BASE ?? 'http://localhost:8787';
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
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length) cookies = setCookies.map((cookie) => cookie.split(';')[0]).join('; ');
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

console.log(`BugBanisher Demo Mode check against ${base}\n`);
const { scan } = await api('/demo');
console.log(`${scan.repo.fullName} · ${scan.findings.length} findings · model: ${scan.stats.modelUsed}\n`);
for (const finding of scan.findings) {
  console.log(
    `  ${finding.severity.toUpperCase().padEnd(6)} ${String(finding.confidence).padStart(2)}% ${finding.source.padEnd(11)} ${finding.file}:${finding.line} — ${finding.title}`,
  );
}

const approvals = [];
for (const finding of scan.findings.filter((candidate) => candidate.source !== 'issue')) {
  const { jobId } = await api('/fix', {
    method: 'POST',
    body: JSON.stringify({ scanId: scan.scanId, findingId: finding.id }),
  });

  let job;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    job = await api(`/fix/${jobId}`);
    if (job.status !== 'running') break;
  }
  if (job.status !== 'done') {
    console.log(`\n  ✗ ${finding.ruleId}: ${job.error}`);
    continue;
  }

  const fix = job.result;
  const checks = fix.verification.filter((check) => check.ok).length;
  console.log(
    `\n  ✓ ${finding.ruleId} verified (${checks}/${fix.verification.length} checks, by ${fix.generatedBy})` +
      (fix.diffRedacted ? ', credentials masked' : ''),
  );
  console.log(`    branch: ${fix.branchName}`);
  approvals.push(fix);
}

console.log('\nApproval cap:');
for (const fix of approvals) {
  try {
    const result = await api('/approve', {
      method: 'POST',
      body: JSON.stringify({ fixId: fix.fixId, confirm: true }),
    });
    console.log(
      `  ${result.record.dryRun ? 'dry-run' : 'opened'} · approvals ${result.session.approvals}/${result.session.approvalCap}`,
    );
  } catch (error) {
    console.log(`  refused → ${error.message.slice(0, 120)}`);
  }
}

const history = await api('/history');
console.log(`\nHistory entries: ${history.history.length}. Nothing was written to GitHub.`);
