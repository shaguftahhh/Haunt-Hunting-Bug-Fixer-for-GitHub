/**
 * Confirmation modal — the single moment where BugBanisher can write to GitHub.
 *
 * Shows exactly what will happen (repo, branch, base, title, full PR body) and
 * requires a deliberate click. In dry-run it says loudly that nothing is written.
 * The modal traps focus, closes on Escape, and restores focus to the trigger.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { FixResult, PullRequestRecord, ScanResult, SessionView } from '../types';
import { ErrorBanner } from './ErrorBanner';
import { BranchIcon, CheckIcon, GitHubIcon, ShieldIcon, XIcon } from './Icons';

interface ApproveModalProps {
  fix: FixResult;
  scan: ScanResult;
  dryRun: boolean;
  approvals: number;
  approvalCap: number;
  onClose: () => void;
  onApproved: (result: {
    record: PullRequestRecord;
    session: SessionView;
    note: string;
    labelApplied: boolean;
  }) => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])';

export function ApproveModal({
  fix,
  scan,
  dryRun,
  approvals,
  approvalCap,
  onClose,
  onApproved,
}: ApproveModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<Element | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<PullRequestRecord | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    previousFocus.current = document.activeElement;
    // Focus the confirm action when it is available; otherwise focus the
    // dialog itself (the real-write button is disabled until the checkbox).
    const confirm = confirmRef.current;
    if (confirm && !confirm.disabled) confirm.focus();
    else dialogRef.current?.focus();
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
      if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (node) => node.offsetParent !== null,
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.approve(fix.fixId);
      setDone(result.record);
      setNote((result as { note?: string }).note ?? '');
      onApproved({
        record: result.record,
        session: result.session,
        note: (result as { note?: string }).note ?? '',
        labelApplied: result.labelApplied,
      });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const capReached = approvals >= approvalCap;
  const canConfirm = !busy && !capReached && fix.verified && (dryRun || confirmed);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approve-modal-title"
        aria-describedby="approve-modal-summary"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="modal__head">
          <div>
            <p className="eyebrow">{dryRun ? 'Dry run · nothing will be written' : 'Final check · this writes to GitHub'}</p>
            <h2 className="modal__title" id="approve-modal-title">
              {done ? (done.dryRun ? 'Dry run recorded' : 'Pull request opened') : 'Open a pull request?'}
            </h2>
          </div>
          <button type="button" className="modal__close" onClick={onClose} disabled={busy} aria-label="Close dialog">
            <XIcon size={16} />
          </button>
        </div>

        {done ? (
          <div className="stack">
            <div className={`alert ${done.dryRun ? 'alert--warn' : 'alert--ok'}`}>
              <span className="alert__icon" aria-hidden="true">{done.dryRun ? '⚠' : '✓'}</span>
              <div>
                <strong>
                  {done.dryRun
                    ? 'Simulated only — GitHub was not touched.'
                    : `PR #${done.number} is open on ${done.repoFullName}.`}
                </strong>
                {note ? <div style={{ marginTop: '0.25rem' }}>{note}</div> : null}
              </div>
            </div>
            {done.htmlUrl ? (
              <a className="btn btn--primary" href={done.htmlUrl} target="_blank" rel="noreferrer">
                <GitHubIcon size={16} /> Open PR #{done.number} on GitHub
              </a>
            ) : null}
            <p className="tiny dim" style={{ margin: 0 }}>
              BugBanisher never merges. The pull request is waiting for your review on GitHub.
            </p>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="small muted" id="approve-modal-summary">
              {dryRun
                ? 'Dry run is ON. This will show exactly what would happen and write nothing to GitHub.'
                : 'This will create a new branch, commit one file, and open a pull request. Nothing is merged.'}
            </p>

            {capReached ? (
              <ErrorBanner tone="error" title="Session cap reached">
                {approvals}/{approvalCap} approvals used. BugBanisher stops here by design.
              </ErrorBanner>
            ) : null}

            <dl className="approval-summary">
              <div className="approval-row">
                <dt>Repository</dt>
                <dd className="mono">{scan.repo.fullName}</dd>
              </div>
              <div className="approval-row">
                <dt>Base branch</dt>
                <dd className="mono">{scan.repo.defaultBranch} (read-only)</dd>
              </div>
              <div className="approval-row">
                <dt>New branch</dt>
                <dd className="mono">{fix.branchName}</dd>
              </div>
              <div className="approval-row">
                <dt>PR title</dt>
                <dd>{fix.prTitle}</dd>
              </div>
              <div className="approval-row">
                <dt>Labels</dt>
                <dd>
                  <span className="badge badge--ghost">ai-assisted</span>{' '}
                  <span className="tiny dim">(best effort — needs Issues permission)</span>
                </dd>
              </div>
              <div className="approval-row">
                <dt>File</dt>
                <dd className="mono">
                  {fix.filesChanged.join(', ')} · findings {fix.staticFindingsBefore} → {fix.staticFindingsAfter}
                </dd>
              </div>
              <div className="approval-row">
                <dt>Verification</dt>
                <dd>
                  <span className="badge badge--low">
                    <ShieldIcon size={12} /> {fix.verification.filter((check) => check.ok).length}/
                    {fix.verification.length} checks passed
                  </span>
                </dd>
              </div>
            </dl>

            <p className="small" style={{ marginBottom: '0.35rem' }}>
              PR body preview
            </p>
            <div className="pr-body-preview" tabIndex={0} aria-label="Pull request body preview">
              {fix.prBody}
            </div>

            {error ? (
              <div style={{ marginTop: '0.75rem' }}>
                <ErrorBanner error={error} title="The approval failed" />
              </div>
            ) : null}

            {!dryRun ? (
              <label className="toggle" style={{ marginTop: '1rem' }}>
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                <span className="toggle__track" aria-hidden="true">
                  <span className="toggle__thumb" />
                </span>
                <span className="small">
                  I read the diff and the PR body, and I want to open this pull request.
                </span>
              </label>
            ) : null}

            <div className="modal__actions">
              <button type="button" className="btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                ref={confirmRef}
                type="button"
                className={`btn ${dryRun ? 'btn--ghost' : 'btn--primary'}`}
                onClick={() => void approve()}
                disabled={!canConfirm}
              >
                {busy ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> {dryRun ? 'Simulating…' : 'Opening PR…'}
                  </>
                ) : (
                  <>
                    <BranchIcon size={16} /> {dryRun ? 'Simulate approval (dry run)' : 'Open Pull Request'}
                  </>
                )}
              </button>
            </div>
            {!dryRun ? (
              <p className="tiny dim" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                <CheckIcon size={12} /> Branch is not the default branch. One commit, one PR. No auto-merge.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
