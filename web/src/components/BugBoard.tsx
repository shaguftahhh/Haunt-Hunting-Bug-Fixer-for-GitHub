/**
 * Bug Board (Phase 1 placeholder — implemented in Phase 2).
 */
import type { Finding, ScanResult } from '../types';
import { ArrowLeftIcon } from './Icons';

interface BugBoardProps {
  scan: ScanResult;
  onBack: () => void;
  onRescan: () => void;
  onPickFix: (finding: Finding) => void;
}

export function BugBoard({ scan, onBack }: BugBoardProps) {
  return (
    <section className="panel">
      <button type="button" className="btn btn--small" onClick={onBack}>
        <ArrowLeftIcon size={16} /> Back
      </button>
      <p style={{ marginTop: '1rem' }}>Scanned {scan.repo.fullName}. The Bug Board UI lands in Phase 2.</p>
    </section>
  );
}
