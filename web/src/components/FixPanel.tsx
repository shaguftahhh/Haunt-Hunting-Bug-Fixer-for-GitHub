/**
 * Fix screen: draft → verify → review.
 *
 * Order of information follows the decision the user has to make:
 *   1. what the bug is (title + why it matters),
 *   2. what the patch changes, in plain English,
 *   3. the exact diff, proven to apply,
 *   4. the checks that were run,
 *   5. how to test it,
 *   6. the approve button (never before this point).
 *
 * If no patch can be produced, the error names the reason and the next action
 * (usually: start the model, or pick a card marked "Quick fix").
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { Finding, FixResult, ModelStatus, ScanResult } from '../types';
import { DiffViewer } from './DiffViewer';
import { ErrorBanner } from './ErrorBanner';
import { Ghost } from './Ghost';
import { ModelStatusCard } from './ModelStatusCard';
import {
  ArrowLeftIcon,
  BranchIcon,
  CheckIcon,
  DiffIcon,
  ShieldIcon,
  WrenchIcon,
  XIcon,
} from './Icons';

interface FixPanelProps {
  scan: ScanResult;
  finding: Finding;
  model: ModelStatus | null;
  onCheckModel: () => void;
  dryRun: boolean;
  approvals: number;
  approvalCap: number;
  onBack: () => void;
  onApprove: (fix: FixResult) => void;
}

const STEPS = [
  'Locating the file',
  'Drafting a minimal patch',
  'Verifying the patch',
  'Preparing the pull request',
];

export function FixPanel({
  scan,
  finding,
  model,
  onCheckModel,
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
  const [stalledFor, setStalledFor] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
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
        if (!cancelled.current) setJobId(jobId);

        // Serverless deployments run the fix inside the request.
        if (started.result) {
          if (!cancelled.current) {
            setProgress(100);
            setStep('Verified');
            setFix(started.result);
            setPhase('done');
          }
          return;
        }
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
          setStalledFor(job.stalledForMs ?? 0);
          if (job.status === 'done' && job.result) {
            setFix(job.result);
            setPhase('done');
            return;
          }
          if (job.status === 'error') {
            setError(new ApiError(job.error ?? 'Patch generation failed.', 422, job.hint ?? undefined));
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

  async function cancelFix() {
    if (!jobId) return;
    setCancelling(true);
    try {
      await api.cancelFix(jobId);
      setPhase('error');
      setError(
        new ApiError('Stopped.', 499, 'Nothing was written to GitHub. You can try again or pick another bug.'),
      );
    } catch (err) {
      setError(err);
      setPhase('error');
    } finally {
      setCancelling(false);
    }
  }

  const approvalBlocked = approvals >= approvalCap;
  const stalled = stalledFor > 45_000;
  const passed = fix?.verification.filter((check) => check.ok).length ?? 0;
  const total = fix?.verification.length ?? 0;

  /** A 422 from the server means "no verified patch", which is worth explaining. */
  const patchError = error instanceof ApiError ? error : null;

  return (
    <div className="stack fix-screen">
      <section className="panel" aria-labelledby="fix-title">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <p className="eyebrow">Fix preview · step 3 of 4</p>
            <h1 className="fix-screen__title" id="fix-title">
              {finding.title}
            </h1>
            <p className="row" style={{ gap: '0.5rem', margin: 0 }}>
              <span className={`badge badge--${finding.severity}`}>{finding.severity}</span>
              <code className="finding-card__where">
                {finding.file}:{finding.line}
              </code>
              <span className="small muted">{finding.confidence}% confidence</span>
              {finding.autoFixAvailable ? (
                <span className="badge badge--ghost">
                  <WrenchIcon size={11} /> Quick fix
                </span>
              ) : null}
            </p>
          </div>
          <button type="button" className="btn btn--small" onClick={onBack}>
            <ArrowLeftIcon size={16} /> Back to board
          </button>
        </div>

        <p className="fix-screen__explain">{finding.explanation}</p>
        {finding.fixHint ? (
          <p className="fix-hint">
            <WrenchIcon size={15} />
            <span>
              <strong>How to fix:</strong> {finding.fixHint}
            </span>
          </p>
        ) : null}
        <div className="why-box">
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
            <div
              className="progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <div className="progress-fill" style={{ width: `${Math.max(4, progress)}%` }} />
            </div>
            <p className="tiny dim" style={{ margin: 0 }}>
              The patch is checked on the server before you see it. Nothing is written to GitHub here.
            </p>

            {stalled ? (
              <div className="alert alert--warn" role="status">
                <span className="alert__icon" aria-hidden="true">⏳</span>
                <div>
                  <strong>This is taking longer than usual.</strong> No progress for{' '}
                  {Math.round(stalledFor / 1000)}s — usually a slow model endpoint.
                  <div style={{ marginTop: '0.6rem' }}>
                    <button type="button" className="btn btn--small" onClick={() => void cancelFix()} disabled={cancelling}>
                      {cancelling ? 'Stopping…' : 'Stop'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn--small btn--ghost" onClick={() => void cancelFix()} disabled={cancelling}>
                {cancelling ? 'Stopping…' : 'Stop'}
              </button>
            )}
          </div>
        ) : null}

        {phase === 'error' ? (
          <div className="stack" style={{ marginTop: '1rem' }}>
            <ErrorBanner
              error={error}
              title={
                patchError?.status === 422
                  ? 'No safe patch could be produced'
                  : 'The patch could not be generated'
              }
            />
            {patchError?.status === 422 ? (
              <ModelStatusCard
                status={model}
                onRefresh={() => {
                  onCheckModel();
                  setAttempt((value) => value + 1);
                }}
              />
            ) : null}
            <div className="row">
              <button type="button" className="btn btn--primary" onClick={onBack}>
                Back to the Bug Board
              </button>
              <button type="button" className="btn" onClick={() => setAttempt((value) => value + 1)}>
                Try again
              </button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Cards marked <strong>Quick fix</strong> always work without a model — those patches are
              deterministic and verified the same way.
            </p>
          </div>
        ) : null}
      </section>

      {phase === 'done' && fix ? (
        <>
          <section
            className={`panel verified-banner ${fix.verified ? 'verified-banner--ok' : 'verified-banner--warn'}`}
            aria-labelledby="verification-title"
          >
            <div className="verified-banner__head">
              <span className="verified-banner__icon" aria-hidden="true">
                {fix.verified ? <CheckIcon size={22} /> : <XIcon size={22} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 className="panel__heading" id="verification-title" style={{ marginBottom: '0.15rem' }}>
                  {fix.verified ? 'Patch verified — ready for your review' : 'Patch needs a closer look'}
                </h2>
                <p className="small muted" style={{ margin: 0 }}>
                  {passed}/{total} checks passed ·{' '}
                  {fix.generatedBy === 'llm'
                    ? `drafted by ${fix.model}`
                    : fix.generatedBy === 'cached'
                      ? 'cached demo response'
                      : 'deterministic rule fix (no model)'}
                </p>
              </div>
              <span className={`badge ${fix.verified ? 'badge--low' : 'badge--high'}`}>
                {fix.verified ? 'Verified' : 'Unverified'}
              </span>
            </div>
          </section>

          <div className="fix-grid">
            <section className="panel" aria-labelledby="diff-title">
              <h2 className="panel__heading" id="diff-title" style={{ fontSize: '1.15rem' }}>
                <DiffIcon size={18} /> The patch
              </h2>
              <p className="small muted" style={{ marginBottom: '0.75rem' }}>
                {fix.summary}
              </p>
              <DiffViewer diff={fix.diff} redacted={fix.diffRedacted} />
            </section>

            <aside className="stack" aria-label="Verification and testing">
              <section className="panel panel--tight" aria-labelledby="checks-title">
                <h2 className="panel__heading" id="checks-title" style={{ fontSize: '1.05rem' }}>
                  <ShieldIcon size={16} /> Checks
                </h2>
                <ul className="verification-list">
                  {fix.verification.map((check) => (
                    <li key={check.id}>
                      {check.ok ? (
                        <CheckIcon size={16} className="verify-ok" />
                      ) : (
                        <XIcon size={16} className="verify-fail" />
                      )}
                      <span>
                        <strong>{check.label}</strong>
                        <br />
                        <span className="small muted">{check.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="tiny dim" style={{ marginTop: '0.7rem', marginBottom: 0 }}>
                  Static findings in this file: {fix.staticFindingsBefore} → {fix.staticFindingsAfter}
                </p>
              </section>

              <section className="panel panel--tight" aria-labelledby="test-title">
                <h2 className="panel__heading" id="test-title" style={{ fontSize: '1.05rem' }}>
                  <WrenchIcon size={16} /> How to test it
                </h2>
                <p className="small muted" style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                  {fix.testPlan}
                </p>
              </section>
            </aside>
          </div>

          <section className="panel panel--glow approve-bar" aria-labelledby="approve-title">
            <div className="approve-bar__text">
              <h2 className="panel__heading" id="approve-title" style={{ fontSize: '1.1rem', marginBottom: '0.2rem' }}>
                <BranchIcon size={16} /> Next: approve the pull request
              </h2>
              <p className="small muted" style={{ margin: 0 }}>
                Branch <code>{fix.branchName}</code> · PR title <em>{fix.prTitle}</em>
              </p>
              <p className="small" style={{ margin: '0.35rem 0 0', color: dryRun ? 'var(--pumpkin)' : 'var(--blood)' }}>
                {dryRun
                  ? 'Dry run is ON — approving shows the exact PR and writes nothing.'
                  : 'Dry run is OFF — approving creates the branch, one commit and a pull request.'}
              </p>
            </div>
            <div className="approve-bar__action">
              <Ghost size={48} mood="idle" />
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
          </section>

          {approvalBlocked ? (
            <p className="small" style={{ margin: 0, color: 'var(--blood)' }}>
              Session cap reached: {approvals}/{approvalCap} pull requests. Disconnect and reconnect to start a
              new session. The cap exists so BugBanisher can never become a bulk-PR bot.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
