/**
 * Consistent, readable error/notice banner.
 * Errors always say what happened, why it might have happened, and what to do.
 */
import type { ReactNode } from 'react';
import { ApiError } from '../api';

interface ErrorBannerProps {
  error?: unknown;
  title?: string;
  tone?: 'error' | 'warn' | 'ok' | 'info';
  children?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}

const ICONS: Record<string, string> = {
  error: '☠',
  warn: '⚠',
  ok: '✓',
  info: 'ℹ',
};

export function ErrorBanner({
  error,
  title,
  tone = 'error',
  children,
  onRetry,
  retryLabel = 'Try again',
}: ErrorBannerProps) {
  if (!error && !children) return null;

  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : null;
  const hint = error instanceof ApiError ? error.hint : null;
  const role = tone === 'error' ? 'alert' : 'status';

  return (
    <div className={`alert alert--${tone}`} role={role}>
      <span className="alert__icon" aria-hidden="true">
        {ICONS[tone]}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        {title ? <strong>{title}</strong> : null}
        {message ? <span>{message}</span> : null}
        {hint ? <div className="small" style={{ marginTop: '0.25rem', opacity: 0.9 }}>{hint}</div> : null}
        {children}
        {onRetry ? (
          <div style={{ marginTop: '0.6rem' }}>
            <button type="button" className="btn btn--small" onClick={onRetry}>
              {retryLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
