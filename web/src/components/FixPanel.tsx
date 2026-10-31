/**
 * Fix panel: generate a patch, show it only after server-side verification, and
 * hand the user off to the approval modal.
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { Finding, FixResult, ScanResult } from '../types';
import { DiffViewer } from './DiffViewer';
import { ErrorBanner } from './ErrorBanner';
import { Ghost } from './Ghost';
import { ArrowLeftIcon, BranchIcon, CheckIcon, DiffIcon, ShieldIcon, WrenchIcon, XIcon } from './Icons';

interface FixPanelProps {
  scan: ScanResult;
  finding: Finding;
  dryRun: boolean;
  approvals: number;
  approvalCap: number;
  onBack: () => void;
  onApprove: (fix: FixResult) => void;
}

const STEPS = ['Locating the file', 'Drafting a minimal patch', 'Verifying the patch', 'Preparing the pull request'];

export function FixPanel({
  scan,
  finding,
  dryRun,
  approvals,
  approvalCap,
  onBack,
  onApprove,
}: FixPanelProps) {
  const [phase, setPhase] = useState<'running' | 'done' | 'error'>('running');
  const [step, setStep] = useState(STEPS[0] ?? '');
  const [progress, setProgress] = useState(3);
  const [fix, setFix] = useState<FixResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let jobId: string | null = null;

    async function run() {
      setPhase('running');
      setError(null);
      setProgress(3);
      setStep(STEPS[0] ?? '');
      try {
        const started = await api.startFix(scan.scanId, finding.id);
        jobId = started.jobId;
      } catch (err) {
        if (!cancelled.current) {
          setError(err);
          setPhase('error');
        }
        return;
      }

      const poll = async () => {
        if (!jobId || cancelled.current) return;
        try {
          const job = await api.fixStatus(jobId);
          if (cancelled.current) return;
          setStep(job.step);
          setProgress(job.progress);
          if (job.status === 'done' && job.result) {
            setFix(job.result);
            setPhase('done');
            return;
          }
          if (job.status === 'error') {
            setError(new ApiError(job.error ?? 'Patch generation failed.', 422));
            setPhase('error');
            return;
          }
          timer = setTimeout(() => void poll(), 700);
        } catch (err) {
          if (!cancelled.current) {
            setError(err);
            setPhase('error');
          }
        }
      };

      void poll();
    }

    void run();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [scan.scanId, finding.id, attempt]);

  const approvalBlocked = approvals >= approvalCap;

  return (
    <div className="stack">
      <section className="panel" aria-labelledby="fix-title">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <p className="eyebrow">Phase 3 · patch preview</p>
            <h2 className="panel-title" id="fix-title">
              <WrenchIcon size={18} /> {finding.title}
            </h2>
            <p className="small muted" style={{ marginBottom: '0.35rem' }}>
              <span className={`badge badge--${finding.severity}`}>{finding.severity}</span>{' '}
              <span className="mono finding-card__where">
                {finding.file}:{finding.line}
              </span>{' '}
              · {finding.confidence}% confidence
            </p>
          </div>
          <button type="button" className="btn btn--small" onClick={onBack}>
            <ArrowLeftIcon size={16} /> Back to board
          </button>
        </div>

        <div className="why-box" style={{ marginTop: '0.75rem' }}>
          <strong>Why it matters</strong>
          {finding.whyItMatters}
        </div>

        {phase === 'running' ? (
          <div className="scan-progress" style={{ marginTop: '1rem' }} aria-live="polite">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small">
                <span className="spinner" aria-hidden="true" style={{ display: 'inline-block', marginRight: '0.5rem' }} />
                {step}
              </span>
              <span className="small dim mono">{progress}%</span>
            </div>
            <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className="progress-fill" style={{ width: `${Math.max(4, progress)}%` }} />
            </div>
            <ol className="scan-steps">
              {STEPS.map((candidate) => (
                <li key={candidate} className={candidate === step ? 'is-active' : undefined}>
                  {candidate === step ? <span className="spinner" aria-hidden="true" /> : <span aria-hidden="true">○</span>}
                  {candidate}
                </li>
              ))}
            </ol>
            <p className="tiny dim" style={{ margin: 0 }}>
              The patch is checked server-side before you see it. Nothing is written to GitHub in this step.
            </p>
          </div>
        ) : null}

        {phase === 'error' ? (
          <div className="stack" style={{ marginTop: '1rem' }}>
            <ErrorBanner
              error={error}
              title="No verified patch was produced"
              onRetry={() => setAttempt((value) => value + 1)}
              retryLabel="Try again"
            />
            <div className="row">
              <button type="button" className="btn btn--small" onClick={onBack}>
                Choose another finding
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {phase === 'done' && fix ? (
        <>
          <section className="panel" aria-labelledby="verification-title">
            <div className="spread">
              <h3 className="panel-title" id="verification-title" style={{ marginBottom: 0 }}>
                <ShieldIcon size={18} /> Verification
                <span className={`badge ${fix.verified ? 'badge--low' : 'badge--high'}`}>
                  {fix.verified ? 'passed' : 'needs review'}
                </span>
              </h3>
              <span className="small dim">
                {fix.generatedBy === 'llm'
                  ? `Drafted by ${fix.model}`
                  : fix.generatedBy === 'cached'
                    ? 'Cached demo response'
                    : 'Deterministic rule fix (no model)'}
              </span>
            </div>
            <ul className="verification-list" style={{ marginTop: '0.75rem' }}>
              {fix.verification.map((check) => (
                <li key={check.id}>
                  {check.ok ? (
                    <CheckIcon size={16} className="verify-ok" />
                  ) : (
                    <XIcon size={16} className="verify-fail" />
                  )}
                  <span>
                    <strong>{check.label}.</strong> <span className="muted">{check.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="tiny dim" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              Static findings in this file: {fix.staticFindingsBefore} before → {fix.staticFindingsAfter} after.
            </p>
          </section>

          <section className="panel" aria-labelledby="diff-title">
            <h3 className="panel-title" id="diff-title">
              <DiffIcon size={18} /> Proposed patch
            </h3>
            <p className="small muted">{fix.summary}</p>
            <DiffViewer diff={fix.diff} redacted={fix.diffRedacted} />
            <details style={{ marginTop: '0.75rem' }}>
              <summary className="small muted" style={{ cursor: 'pointer' }}>
                How to test this fix
              </summary>
              <p className="small" style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>
                {fix.testPlan}
              </p>
            </details>
          </section>

          <section className="panel panel--glow" aria-labelledby="approve-title">
            <div className="spread" style={{ alignItems: 'flex-start' }}>
              <div>
                <h3 className="panel-title" id="approve-title">
                  <BranchIcon size={18} /> Ready for your decision
                </h3>
                <p className="small muted" style={{ marginBottom: '0.4rem' }}>
                  Branch <code>{fix.branchName}</code>
                  <br />
                  PR title <em>{fix.prTitle}</em>
                </p>
                <p className="tiny dim" style={{ margin: 0 }}>
                  {dryRun
                    ? 'Dry run is ON: approving will show the exact PR and write nothing.'
                    : 'Dry run is OFF: approving will create this branch, one commit, and a pull request on your repo.'}
                </p>
              </div>
              <div className="row">
                <Ghost size={54} mood="idle" />
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => onApprove(fix)}
                  disabled={!fix.verified || approvalBlocked}
                  title={
                    approvalBlocked
                      ? 'The session cap of 3 approvals has been reached.'
                      : !fix.verified
                        ? 'Verification must pass before a PR can be approved.'
                        : undefined
                  }
                >
                  <BranchIcon size={16} /> Review &amp; approve
                </button>
              </div>
            </div>
            {approvalBlocked ? (
              <p className="small" style={{ marginTop: '0.75rem', marginBottom: 0, color: 'var(--blood)' }}>
                Session cap reached: {approvals}/{approvalCap} pull requests. Start a new session (disconnect and
                reconnect) to keep going. This cap exists so BugBanisher can never become a bulk-PR bot.
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
