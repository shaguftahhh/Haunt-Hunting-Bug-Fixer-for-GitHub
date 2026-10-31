/**
 * Rebuild Demo Mode state on demand.
 *
 * Demo Mode is fully deterministic: the same bundled sample repo, the same
 * rules, the same cached model responses. That lets a serverless instance —
 * where the process that served `POST /api/demo` may be gone by the next request
 * — regenerate the exact same scan and patch from disk instead of failing with
 * "that scan is no longer in memory".
 *
 * Only bundled sample data goes through here. Real repository scans and patches
 * stay in the session and disappear with it.
 */
import { buildDemoBundle, cachedFixFor, cachedModelName } from './loader.js';
import { rememberDemoFix, rememberDemoScan, getRememberedDemoFix } from './store.js';
import { generateFix } from '../patch/generate.js';
import { demoFixIdFor } from '../patch/generate.js';
import type { JobContext } from '../jobs.js';
import type { FixRecord, ScanRecord } from '../types.js';

const noopContext: JobContext = {
  id: 'demo-rebuild',
  signal: new AbortController().signal,
  step: () => {},
  progress: () => {},
  checkpoint: () => {},
};

/** One build per instance: the sample repo is tiny, but there is no point repeating it. */
let bundlePromise: Promise<ScanRecord> | null = null;

async function demoRecord(): Promise<ScanRecord> {
  if (!bundlePromise) {
    bundlePromise = buildDemoBundle().then((bundle) => ({
      scan: bundle.scan,
      files: bundle.files,
      repo: bundle.repo,
      userLogin: 'demo',
    }));
    bundlePromise.catch(() => {
      bundlePromise = null; // let the next request retry a broken read
    });
  }

  const record = await bundlePromise;
  rememberDemoScan(record);
  return record;
}

/** True when this id belongs to the bundled demo (so rebuilding is safe). */
export function isDemoId(id: string): boolean {
  return id.startsWith('demo-');
}

/** Look up a demo scan, rebuilding it when this instance has never seen it. */
export async function resolveDemoScan(scanId: string): Promise<ScanRecord | null> {
  if (!isDemoId(scanId)) return null;
  const record = await demoRecord();
  return record.scan.scanId === scanId ? record : null;
}

/**
 * Look up a demo fix, regenerating it when this instance has never seen it.
 * Regeneration goes through the same generate + verify pipeline as a first
 * request, so an unverified patch can never be served this way either.
 */
export async function resolveDemoFix(fixId: string): Promise<FixRecord | null> {
  if (!isDemoId(fixId)) return null;

  const cached = getRememberedDemoFix(fixId);
  if (cached) return cached;

  const record = await demoRecord();
  for (const finding of record.scan.findings) {
    if (finding.source === 'issue' || finding.line < 1) continue;
    if (demoFixIdFor(record.scan.scanId, finding.id) !== fixId) continue;

    const file = record.files.find((candidate) => candidate.path === finding.file);
    if (!file) return null;

    const reply = cachedFixFor(finding.id);
    const { record: fixRecord } = await generateFix(
      {
        scanId: record.scan.scanId,
        mode: 'demo',
        repo: record.repo,
        finding,
        path: finding.file,
        beforeContent: file.content,
        cachedFix: reply ? { ...reply, model: `${cachedModelName()} (cached)` } : null,
      },
      noopContext,
    );

    rememberDemoFix(fixRecord);
    return fixRecord;
  }

  return null;
}
