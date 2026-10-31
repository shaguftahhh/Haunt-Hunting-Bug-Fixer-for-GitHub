/**
 * Scan panel: starts a read-only scan and narrates each step.
 *
 * The server does the work in a background job; this component polls it every
 * 800ms and turns the job state into a visible, understandable checklist.
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { ModelStatus, RepoSummary, ScanResult } from '../types';
import { ErrorBanner } from './ErrorBanner';
import { Ghost } from './Ghost';
import { ArrowLeftIcon, BugIcon, CheckIcon, SparkIcon, WrenchIcon } from './Icons';
import { ModelStatusCard } from './ModelStatusCard';
import { SUPPORTED_TYPES } from '../constants';

interface ScanPanelProps {
  repo: RepoSummary;
  dryRun: boolean;
  model: ModelStatus | null;
  modelLoading: boolean;
  onCheckModel: () => void;
  onBack: () => void;
  onScanned: (result: ScanResult) => void;
}

const FALLBACK_STEPS = [
  'Reading the repository tree',
  'Skipping secrets and binaries',
  'Fetching source files',
  'Running static checks',
  'Reading open bug issues',
  'Asking the model to review',
  'Scoring findings',
];

export function ScanPanel({
  repo,
  dryRun,
  model,
  modelLoading,
  onCheckModel,
  onBack,
  onScanned,
}: ScanPanelProps) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [step, setStep] = useState('');
  const [steps, setSteps] = useState<string[]>(FALLBACK_STEPS);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  // Poll the job while it runs.
  useEffect(() => {
    if (!jobId || phase !== 'running') return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const job = await api.scanStatus(jobId as string);
        if (cancelled.current) return;
        setStep(job.step);
        setSteps(job.steps.length > 0 ? job.steps : FALLBACK_STEPS);
        setProgress(job.progress);

        if (job.status === 'done' && job.result) {
          setResult(job.result);
          setPhase('done');
          setProgress(100);
          return;
        }
        if (job.status === 'error') {
          setError(new ApiError(job.error ?? 'The scan failed.', 500));
          setPhase('error');
          return;
        }
        timer = setTimeout(poll, 800);
      } catch (err) {
        if (cancelled.current) return;
        setError(err);
        setPhase('error');
      }
    }

    void poll();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [jobId, phase]);

  async function startScan() {
    setPhase('running');
    setError(null);
    setProgress(2);
    setStep(FALLBACK_STEPS[0] ?? '');
    setSteps(FALLBACK_STEPS);
    try {
      const { jobId: id } = await api.startScan(repo.fullName);
      setJobId(id);
    } catch (err) {
      setError(err);
      setPhase('error');
    }
  }

  const activeIndex = Math.max(
    0,
    steps.findIndex((candidate) => candidate === step),
  );

  return (
    <div className="stack">
      <section className="panel" aria-labelledby="scan-title">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <p className="eyebrow">Step 3 of 4 · sweep the halls</p>
            <h2 className="panel-title" id="scan-title">
              <BugIcon size={18} /> {repo.fullName}
            </h2>
            <p className="muted small" style={{ marginBottom: 0 }}>
              Default branch <code>{repo.defaultBranch}</code> · {repo.language ?? 'unknown language'} ·{' '}
              {repo.private ? 'private' : 'public'}
            </p>
          </div>
          <button type="button" className="btn btn--small" onClick={onBack} disabled={phase === 'running'}>
            <ArrowLeftIcon size={16} /> Choose another
          </button>
        </div>

        {phase === 'idle' ? (
          <div className="stack" style={{ marginTop: '1.25rem' }}>
            <div className="alert alert--info">
              <span className="alert__icon" aria-hidden="true">
                <SparkIcon size={18} />
              </span>
              <div>
                <strong>Read-only scan.</strong> Nothing is written to GitHub. BugBanisher reads the repo
                through the API, runs its checks, and asks the model to review the most suspicious files.
              </div>
            </div>
            <ModelStatusCard status={model} loading={modelLoading} onRefresh={onCheckModel} />
            <div className="row">
              <button type="button" className="btn btn--primary" onClick={() => void startScan()}>
                <BugIcon size={16} /> Scan for bugs
              </button>
              <span className="small dim">
                {dryRun ? 'Dry run is ON — approvals will simulate PRs.' : 'Dry run is OFF — approvals will open real PRs.'}
              </span>
            </div>
          </div>
        ) : null}

        {phase === 'running' ? (
          <div className="stack" style={{ marginTop: '1.25rem' }} aria-live="polite">
            <div className="scan-progress">
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
                aria-label="Scan progress"
              >
                <div className="progress-fill" style={{ width: `${Math.max(3, progress)}%` }} />
              </div>
            </div>
            <ol className="scan-steps">
              {steps.map((candidate, index) => (
                <li
                  key={candidate}
                  className={
                    index < activeIndex ? 'is-done' : index === activeIndex ? 'is-active' : undefined
                  }
                >
                  {index < activeIndex ? (
                    <CheckIcon size={14} />
                  ) : index === activeIndex ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : (
                    <span className="dim" aria-hidden="true">
                      ○
                    </span>
                  )}
                  {candidate}
                </li>
              ))}
            </ol>
            <p className="tiny dim" style={{ margin: 0 }}>
              Local models can take a while. The whole scan is read-only; you can leave this page and come back.
            </p>
          </div>
        ) : null}

        {phase === 'error' ? (
          <div className="stack" style={{ marginTop: '1rem' }}>
            <ErrorBanner
              error={error}
              title="The scan hit a snag"
              onRetry={() => void startScan()}
              retryLabel="Run scan again"
            />
            <div>
              <button type="button" className="btn btn--small" onClick={() => setPhase('idle')}>
                Back to scan settings
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'done' && result ? (
          <div className="stack" style={{ marginTop: '1.25rem' }}>
            <div className="alert alert--ok">
              <span className="alert__icon" aria-hidden="true">✓</span>
              <div>
                <strong>Scan complete — {result.findings.length} finding(s).</strong>
                Nothing has been changed. Review the Bug Board next.
              </div>
            </div>
            <div className="stat-grid">
              <div className="stat">
                <div className="stat__value">{result.stats.filesScanned}</div>
                <div className="stat__label">files scanned</div>
              </div>
              <div className="stat">
                <div className="stat__value">{result.findings.length}</div>
                <div className="stat__label">bugs found</div>
              </div>
              <div className="stat">
                <div className="stat__value">{result.stats.autoFixableCount}</div>
                <div className="stat__label">quick fixes</div>
              </div>
              <div className="stat">
                <div className="stat__value">{Math.round(result.stats.durationMs / 100) / 10}s</div>
                <div className="stat__label">scan time</div>
              </div>
            </div>
            {result.findings.length === 0 ? (
              <div className="alert alert--warn">
                <span className="alert__icon" aria-hidden="true">
                  <WrenchIcon size={18} />
                </span>
                <div>
                  <strong>Nothing matched in this repo.</strong> BugBanisher reads source files only
                  ({SUPPORTED_TYPES}). Repos that are mostly docs, images or vendored code produce few
                  findings. Try Demo Mode to see the full flow on a known-buggy sample.
                </div>
              </div>
            ) : null}
            <div className="row">
              <button type="button" className="btn btn--primary" onClick={() => onScanned(result)}>
                <BugIcon size={16} /> Open the Bug Board
              </button>
              <Ghost size={40} mood="happy" />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
