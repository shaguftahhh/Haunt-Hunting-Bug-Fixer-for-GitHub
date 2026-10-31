/**
 * "Is the AI awake?" panel.
 *
 * Shows the configured provider/model, whether the endpoint answered, and the
 * exact commands to fix it. Also states plainly that "Quick fix" findings work
 * without a model at all — which is what makes the app usable offline.
 */
import type { ModelStatus } from '../types';
import { CheckIcon, ShieldIcon, SparkIcon, XIcon } from './Icons';

interface ModelStatusCardProps {
  status: ModelStatus | null;
  loading?: boolean;
  onRefresh: () => void;
  compact?: boolean;
}

export function ModelStatusCard({ status, loading, onRefresh, compact }: ModelStatusCardProps) {
  if (!status && !loading) return null;

  const ok = status?.ok ?? false;
  const tone = loading ? 'info' : ok ? 'ok' : 'warn';

  return (
    <section className={`model-card model-card--${tone}`} aria-live="polite">
      <div className="model-card__head">
        <span className="model-card__icon" aria-hidden="true">
          {loading ? <span className="spinner" /> : ok ? <CheckIcon size={16} /> : <XIcon size={16} />}
        </span>
        <div className="model-card__text">
          <strong>
            {loading
              ? 'Checking the AI model…'
              : ok
                ? 'AI model ready'
                : status?.provider === 'none'
                  ? 'No AI model configured'
                  : 'AI model not reachable'}
          </strong>
          <span className="small muted">
            {loading
              ? 'One moment.'
              : ok
                ? `${status?.model} via ${status?.provider}. AI findings and model-written patches are available.`
                : status?.detail}
          </span>
        </div>
        <button type="button" className="btn btn--small" onClick={onRefresh} disabled={loading}>
          {loading ? 'Checking…' : 'Check model'}
        </button>
      </div>

      {!loading && !ok && status ? (
        <>
          {compact ? null : (
            <ol className="model-card__steps">
              {status.setup.map((step) => (
                <li key={step}>
                  <code>{step}</code>
                </li>
              ))}
            </ol>
          )}
          <p className="small muted" style={{ margin: '0.5rem 0 0' }}>
            <ShieldIcon size={14} /> BugBanisher still scans and fixes everything marked{' '}
            <span className="badge badge--ghost" style={{ verticalAlign: 'middle' }}>
              <SparkIcon size={11} /> Quick fix
            </span>{' '}
            without a model.
          </p>
        </>
      ) : null}
    </section>
  );
}
