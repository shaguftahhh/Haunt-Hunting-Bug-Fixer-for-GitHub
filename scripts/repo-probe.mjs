/**
 * Diagnostic: scan a repo and try to fix its findings, reporting every error.
 * Usage: node scripts/repo-probe.mjs owner/repo
 */
const repo = process.argv[2];
const base = process.env.BB_BASE ?? 'http://localhost:8787';
const { execFileSync } = await import('node:child_process');
const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
let sid = null;
const api = async (p, init = {}) => {
  const res = await fetch(`${base}/api${p}`, { ...init, headers: { 'Content-Type': 'application/json', ...(sid ? { 'X-BB-Session': sid } : {}), ...(init.headers ?? {}) } });
  const s = res.headers.get('X-BB-Session'); if (s) sid = s;
  const t = await res.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${b?.error ?? t}`), { body: b });
  return b;
};
await api('/auth/pat', { method: 'POST', body: JSON.stringify({ token }) });
const { jobId } = await api('/scan', { method: 'POST', body: JSON.stringify({ repoFullName: repo }) });
let job; for (let i = 0; i < 200; i++) { await new Promise(r => setTimeout(r, 400)); job = await api(`/scan/${jobId}`); if (job.status !== 'running') break; }
if (job.status !== 'done') { console.log('SCAN FAILED:', job.error); process.exit(1); }
const scan = job.result;
console.log(`scan: ${scan.stats.filesScanned}/${scan.stats.filesInRepo} files, ${scan.findings.length} findings, linters=${JSON.stringify(scan.stats.lintersDetected)}`);
console.log('skipped:', scan.stats.skippedReasons);
for (const f of scan.findings) console.log(`  ${f.severity.padEnd(6)} ${String(f.confidence).padStart(2)}% ${f.ruleId} ${f.file}:${f.line} — ${f.title}`);
for (const f of scan.findings.filter(x => x.line > 0).slice(0, 6)) {
  try {
    const r = await api('/fix', { method: 'POST', body: JSON.stringify({ scanId: scan.scanId, findingId: f.id }) });
    let fj; for (let i = 0; i < 120; i++) { await new Promise(res => setTimeout(res, 300)); fj = await api(`/fix/${r.jobId}`); if (fj.status !== 'running') break; }
    console.log(fj.status === 'done' ? `  fix OK   ${f.ruleId} (${fj.result.generatedBy})` : `  fix FAIL ${f.ruleId}: ${fj.error}`);
  } catch (e) { console.log(`  fix FAIL ${f.ruleId}: ${e.message}`); if (e.body?.hint) console.log(`           hint: ${e.body.hint}`); }
}
