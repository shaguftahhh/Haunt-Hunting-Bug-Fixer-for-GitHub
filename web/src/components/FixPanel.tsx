/**
 * Fix panel (Phase 1 placeholder — implemented in Phase 3).
 */
import type { Finding, ScanResult, SessionView } from '../types';

interface FixPanelProps {
  scan: ScanResult;
  finding: Finding;
  dryRun: boolean;
  approvals: number;
  approvalCap: number;
  onBack: () => void;
  onOpened: (session: SessionView, message: string) => void;
}

export function FixPanel({ finding, onBack }: FixPanelProps) {
  return (
    <section className="panel">
      <button type="button" className="btn btn--small" onClick={onBack}>
        Back to board
      </button>
      <p style={{ marginTop: '1rem' }}>
        Patch generation for <strong>{finding.title}</strong> arrives in Phase 3.
      </p>
    </section>
  );
}
