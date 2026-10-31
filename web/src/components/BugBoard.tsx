/**
 * Bug Board — a card per finding with severity, confidence, plain-English
 * explanation, "why it matters" for learners, and the haunted line in context.
 *
 * Every card is read-only until the user clicks "Craft fix". Issue-only
 * findings cannot be patched automatically because they do not point at a file.
 */
import { useMemo, useState } from 'react';
import type { Finding, ScanResult, Severity } from '../types';
import { ErrorBanner } from './ErrorBanner';
import { Ghost } from './Ghost';
import { ArrowLeftIcon, BookIcon, BugIcon, GitHubIcon, SparkIcon, WrenchIcon } from './Icons';

interface BugBoardProps {
  scan: ScanResult;
  banished?: Set<string>;
  onBack: () => void;
  onRescan: () => void;
  onPickFix: (finding: Finding) => void;
}

const SEVERITY_LABEL: Record<Severity, string> = { high: 'high', medium: 'medium', low: 'low' };
const SOURCE_LABEL: Record<Finding['source'], string> = {
  static: 'static check',
  llm: 'AI review',
  issue: 'bug issue',
  'static+llm': 'static + AI',
};

function codeHref(scan: ScanResult, finding: Finding): string | null {
  if (finding.source === 'issue' || !finding.file.includes('.')) return null;
  return `${scan.repo.htmlUrl}/blob/${scan.repo.defaultBranch}/${finding.file}#L${finding.line}`;
}

function Snippet({ finding }: { finding: Finding }) {
  if (!finding.snippet) return null;
  const start = finding.snippetStart ?? Math.max(1, finding.line - 2);
  const end = finding.endLine ?? finding.line;

  return (
    <pre className="code-block" aria-label={`Code around line ${finding.line} of ${finding.file}`}>
      {finding.snippet.split('\n').map((line, index) => {
        const lineNumber = start + index;
        const haunted = lineNumber >= finding.line && lineNumber <= end;
        return (
          <span key={lineNumber} className={`code-line${haunted ? ' code-line--haunted' : ''}`}>
            <span className="dim" aria-hidden="true">
              {String(lineNumber).padStart(4, ' ')} │{' '}
            </span>
            {line || ' '}
          </span>
        );
      })}
    </pre>
  );
}

function Confidence({ value }: { value: number }) {
  return (
    <span className="confidence">
      <span
        className="confidence__bar"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-label={`Confidence ${value}%`}
      >
        <span className="confidence__fill" style={{ width: `${Math.min(100, Math.max(4, value))}%` }} />
      </span>
      {value}% confident
    </span>
  );
}

export function BugBoard({ scan, banished, onBack, onRescan, onPickFix }: BugBoardProps) {
  const [severity, setSeverity] = useState<'all' | Severity>('all');
  const [source, setSource] = useState<'all' | 'static' | 'llm' | 'issue'>('all');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const base: Record<'all' | Severity, number> = { all: scan.findings.length, high: 0, medium: 0, low: 0 };
    for (const finding of scan.findings) base[finding.severity] += 1;
    return base;
  }, [scan.findings]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scan.findings.filter((finding) => {
      if (severity !== 'all' && finding.severity !== severity) return false;
      if (source === 'static' && !finding.source.startsWith('static')) return false;
      if (source !== 'all' && source !== 'static' && finding.source !== source) return false;
      if (needle) {
        const haystack = `${finding.title} ${finding.file} ${finding.explanation} ${finding.ruleId ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [scan.findings, severity, source, query]);

  return (
    <div className="stack">
      <section className="panel" aria-labelledby="board-title">
        <div className="board-head">
          <div>
            <p className="eyebrow">Step 4 of 4 · the Bug Board</p>
            <h2 className="panel-title" id="board-title" style={{ marginBottom: '0.2rem' }}>
              <BugIcon size={18} /> {scan.repo.fullName}
            </h2>
            <p className="small muted" style={{ margin: 0 }}>
              {counts.all} finding{counts.all === 1 ? '' : 's'} · {scan.stats.filesScanned} file
              {scan.stats.filesScanned === 1 ? '' : 's'} scanned ·{' '}
              {scan.stats.modelUsed ? `model ${scan.stats.modelUsed}` : 'static checks only'}
            </p>
          </div>
          <div className="row">
            <button type="button" className="btn btn--small" onClick={onBack}>
              <ArrowLeftIcon size={16} /> Change repo
            </button>
            <button type="button" className="btn btn--small btn--ghost" onClick={onRescan}>
              Rescan
            </button>
          </div>
        </div>

        <div className="divider" />

        <div className="filters" role="group" aria-label="Filter by severity">
          {(['all', 'high', 'medium', 'low'] as const).map((level) => (
            <button
              key={level}
              type="button"
              className="chip"
              aria-pressed={severity === level}
              onClick={() => setSeverity(level)}
            >
              {level === 'all' ? 'All' : SEVERITY_LABEL[level]} ({counts[level]})
            </button>
          ))}
          <span className="dim small" style={{ marginInline: '0.25rem' }} aria-hidden="true">
            |
          </span>
          {(['all', 'static', 'llm', 'issue'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className="chip"
              aria-pressed={source === kind}
              onClick={() => setSource(kind)}
            >
              {kind === 'all' ? 'Every source' : kind === 'llm' ? 'AI review' : kind === 'static' ? 'Static checks' : 'Issues'}
            </button>
          ))}
        </div>

        <div className="repo-toolbar" style={{ marginTop: '0.75rem' }}>
          <div className="search">
            <label className="sr-only" htmlFor="finding-search">
              Search findings
            </label>
            <input
              id="finding-search"
              className="input"
              type="search"
              placeholder="Search findings, files, rule ids…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <span className="badge badge--muted" aria-live="polite">
            {filtered.length} shown
          </span>
        </div>

        {scan.notes.length > 0 ? (
          <details style={{ marginTop: '0.75rem' }}>
            <summary className="small muted" style={{ cursor: 'pointer' }}>
              Scan notes ({scan.notes.length})
            </summary>
            <ul className="small muted" style={{ marginTop: '0.5rem' }}>
              {scan.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
        ) : null}

        {scan.stats.lintersDetected.length > 0 ? (
          <p className="tiny dim" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            Linters detected in this repo: {scan.stats.lintersDetected.join(', ')}. BugBanisher never installs
            or executes repository code — only safe parsers and its own rules run.
          </p>
        ) : null}
      </section>

      {filtered.length === 0 ? (
        <section className="panel center" aria-live="polite">
          <Ghost size={80} mood="happy" />
          <h3 style={{ marginTop: '0.75rem' }}>No bugs match this view</h3>
          <p className="muted small">
            Either the house is quiet, or the findings are hidden by a filter. An empty scan is not proof of a
            clean repo — it means these checks found nothing.
          </p>
          <button
            type="button"
            className="btn btn--small"
            onClick={() => {
              setSeverity('all');
              setSource('all');
              setQuery('');
            }}
          >
            Clear filters
          </button>
        </section>
      ) : (
        <ul className="finding-list">
          {filtered.map((finding) => {
            const isBanished = banished?.has(finding.id) ?? false;
            const href = codeHref(scan, finding);
            const patchable = finding.source !== 'issue' && finding.line > 0;

            return (
              <li
                key={finding.id}
                className={[
                  'finding-card',
                  `finding-card--${finding.severity}`,
                  isBanished ? 'finding-card--banished' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className="finding-card__top">
                  <span className={`badge badge--${finding.severity}`}>{SEVERITY_LABEL[finding.severity]}</span>
                  <span className="badge badge--muted">{SOURCE_LABEL[finding.source]}</span>
                  {isBanished ? <span className="badge badge--ghost">✓ banished</span> : null}
                  <span className="finding-card__where">
                    {finding.source === 'issue' ? finding.file : `${finding.file}:${finding.line}`}
                  </span>
                  <span style={{ marginLeft: 'auto' }}>
                    <Confidence value={finding.confidence} />
                  </span>
                </div>

                <h3 className="finding-card__title">{finding.title}</h3>
                <p className="finding-card__explain">{finding.explanation}</p>

                <div className="why-box">
                  <strong>Why it matters</strong>
                  {finding.whyItMatters}
                </div>

                {finding.source === 'issue' && finding.issue ? (
                  <p className="small" style={{ marginBottom: '0.6rem' }}>
                    <a href={finding.issue.url} target="_blank" rel="noreferrer">
                      <GitHubIcon size={14} /> Issue #{finding.issue.number} on GitHub
                    </a>{' '}
                    <span className="dim">· labels: {finding.issue.labels.join(', ') || 'none'}</span>
                  </p>
                ) : (
                  <Snippet finding={finding} />
                )}

                <div className="row" style={{ marginTop: '0.75rem' }}>
                  {patchable ? (
                    <button type="button" className="btn btn--small btn--primary" onClick={() => onPickFix(finding)}>
                      <WrenchIcon size={15} /> {isBanished ? 'Craft another fix' : 'Craft fix'}
                    </button>
                  ) : (
                    <span className="small dim">
                      Issue-only finding — link it to a file before a patch can be drafted.
                    </span>
                  )}
                  {href ? (
                    <a className="btn btn--small" href={href} target="_blank" rel="noreferrer">
                      <GitHubIcon size={15} /> View on GitHub
                    </a>
                  ) : null}
                  <span className="tiny dim">
                    <BookIcon size={13} /> {finding.ruleId ?? finding.source}
                  </span>
                  <SparkIcon size={14} className="dim" />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ErrorBanner tone="warn" title="Read before you approve">
        AI findings can be wrong. Read the explanation, read the diff, and check that the fix applies before
        opening a PR. BugBanisher never merges.
      </ErrorBanner>
    </div>
  );
}
