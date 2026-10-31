/**
 * Demo Mode fallback store.
 *
 * Demo scans and fixes are built from bundled, read-only sample data, so there
 * is nothing sensitive in them. Keeping a small process-level copy means the
 * demo keeps working even if the browser drops its session (blocked cookies in
 * an iframe, a hard reload mid-demo, a new tab).
 *
 * This is deliberately demo-only: real repository scans and patches stay in the
 * session and disappear with it.
 */
import type { FixRecord, ScanRecord } from '../types.js';

const MAX_SCANS = 20;
const MAX_FIXES = 50;

const demoScans = new Map<string, ScanRecord>();
const demoFixes = new Map<string, FixRecord>();

function trim<T>(map: Map<string, T>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export function rememberDemoScan(record: ScanRecord): void {
  if (record.scan.mode !== 'demo') return;
  demoScans.delete(record.scan.scanId);
  demoScans.set(record.scan.scanId, record);
  trim(demoScans, MAX_SCANS);
}

export function getRememberedDemoScan(scanId: string): ScanRecord | null {
  return demoScans.get(scanId) ?? null;
}

export function rememberDemoFix(record: FixRecord): void {
  demoFixes.delete(record.fix.fixId);
  demoFixes.set(record.fix.fixId, record);
  trim(demoFixes, MAX_FIXES);
}

export function getRememberedDemoFix(fixId: string): FixRecord | null {
  return demoFixes.get(fixId) ?? null;
}
