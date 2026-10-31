/**
 * Scan panel (Phase 1 placeholder).
 * Phase 2 replaces this with the live scan flow: static checks, bug issues and
 * model review with a step-by-step progress bar.
 */
import type { RepoSummary, ScanResult } from '../types';
import { ArrowLeftIcon, BranchIcon, SparkIcon } from './Icons';

interface ScanPanelProps {
  repo: RepoSummary;
  dryRun: boolean;
  onBack: () => void;
  onScanned: (result: ScanResult) => void;
}

export function ScanPanel({ repo, onBack }: ScanPanelProps) {
  return (
    <section className="panel" aria-labelledby="scan-title">
      <div className="spread">
        <div>
          <p className="eyebrow">Step 3 of 4 · sweep the halls</p>
          <h2 className="panel-title" id="scan-title">
            <BranchIcon size={18} /> {repo.fullName}
          </h2>
          <p className="muted small">
            Default branch <code>{repo.defaultBranch}</code>. The scanner reads this repo only.
          </p>
        </div>
        <button type="button" className="btn btn--small" onClick={onBack}>
          <ArrowLeftIcon size={16} /> Back
        </button>
      </div>
      <div className="alert alert--info">
        <span className="alert__icon" aria-hidden="true">
          <SparkIcon size={18} />
        </span>
        <div>
          <strong>Scan engine arrives in the next phase.</strong>
          Connect + repo picker are live; static rules, issue reading and model review come next.
        </div>
      </div>
    </section>
  );
}
