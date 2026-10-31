/**
 * Bug Board — one card per finding.
 *
 * Design goals, in order:
 *   1. A beginner must understand *what is wrong* and *what to type* without
 *      opening anything else. That is why every card shows a plain-English
 *      explanation, a one-line fix hint, and the haunted line in context.
 *   2. It must be obvious what can be fixed right now. Cards that a
 *      deterministic patch can fix say "Quick fix"; the rest say "Needs AI" and
 *      explain what to do when no model is running.
 *   3. Finding a specific bug must be fast: severity/source filters, a
 *      fixable-only switch, sorting and search.
 */
import { useMemo, useState } from 'react';
import type { Finding, ModelStatus, ScanResult, Severity } from '../types';
import { ErrorBanner } from './ErrorBanner';
import { Ghost } from './Ghost';
import { ArrowLeftIcon, BookIcon, GitHubIcon, SparkIcon, WrenchIcon } from './Icons';

type SortKey = 'severity' | 'confidence' | 'file';

interface BugBoardProps {
  scan: ScanResult;
  banished?: Set<string>;
  model?: ModelStatus | null;
  backLabel?: string;
  onBack: () => void;
  onRescan: () => void;
  onPickFix: (finding: Finding) => void;
}

const SEVERITY_LABEL: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const SOURCE_LABEL: Record<Finding['source'], string> = {
  static: 'Static check',
  llm: 'AI review',
  issue: 'Bug issue',
  'static+llm': 'Static + AI',
};
const SEVERITY_WEIGHT: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

function codeHref(scan: ScanResult, finding: Finding): string | null {
  if (scan.mode === 'demo' || finding.source === 'issue' || !finding.file.includes('.')) return null;
  if (!scan.repo.htmlUrl) return null;
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
    <span className="confidence" title={`The model/rule is ${value}% confident this is a real bug`}>
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
      {value}%
    </span>
  );
}

export function BugBoard({
  scan,
  banished,
  model,
  backLabel,
  onBack,
  onRescan,
  onPickFix,
}: BugBoardProps) {
  const [severity, setSeverity] = useState<'all' | Severity>('all');
  const [source, setSource] = useState<'all' | 'static' | 'llm' | 'issue'>('all');
  const [fixableOnly, setFixableOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('severity');

  const patchable = (finding: Finding) => finding.source !== 'issue' && finding.line > 0;
  const quickFix = (finding: Finding) => patchable(finding) && Boolean(finding.autoFixAvailable);
  const needsModel = (finding: Finding) => patchable(finding) && !finding.autoFixAvailable;

  const counts = useMemo(() => {
    const base = { all: scan.findings.length, high: 0, medium: 0, low: 0, quick: 0, needsModel: 0 };
    for (const finding of scan.findings) {
      base[finding.severity] += 1;
      if (quickFix(finding)) base.quick += 1;
      if (needsModel(finding)) base.needsModel += 1;
    }
    return base;
  }, [scan.findings]);

  const modelReady = model?.ok ?? false;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = scan.findings.filter((finding) => {
      if (severity !== 'all' && finding.severity !== severity) return false;
      if (source === 'static' && !finding.source.startsWith('static')) return false;
      if (source !== 'all' && source !== 'static' && finding.source !== source) return false;
      if (fixableOnly && !quickFix(finding)) return false;
      if (needle) {
        const haystack =
          `${finding.title} ${finding.file} ${finding.explanation} ${finding.fixHint ?? ''} ${finding.ruleId ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    return rows.sort((a, b) => {
      if (sort === 'confidence') return b.confidence - a.confidence;
      if (sort === 'file') return a.file.localeCompare(b.file) || a.line - b.line;
      return SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] || b.confidence - a.confidence;
    });
  }, [scan.findings, severity, source, fixableOnly, query, sort]);

  const resetFilters = () => {
    setSeverity('all');
    setSource('all');
    setFixableOnly(false);
    setQuery('');
  };

  return (
    <div className="stack">
      <section className="panel board-summary" aria-labelledby="board-title">
        <div className="board-summary__head">
          <div>
            <p className="eyebrow">Bug Board</p>
            <h1 className="board-summary__title" id="board-title">
              {counts.all === 0 ? 'No bugs found' : `${counts.all} bug${counts.all === 1 ? '' : 's'} found`}
            </h1>
            <p className="small muted" style={{ margin: 0 }}>
              {scan.repo.fullName} · {scan.stats.filesScanned} of {scan.stats.filesInRepo} files checked ·{' '}
              {scan.stats.modelUsed ? `AI: ${scan.stats.modelUsed}` : 'static checks only'}
            </p>
          </div>
          <div className="row">
            <button type="button" className="btn btn--small" onClick={onBack}>
              <ArrowLeftIcon size={16} /> {backLabel ?? 'Change repo'}
            </button>
            <button type="button" className="btn btn--small btn--ghost" onClick={onRescan}>
              Rescan
            </button>
          </div>
        </div>

        <ul className="board-stats">
          <li>
            <span className="board-stats__value" style={{ color: 'var(--sev-high)' }}>{counts.high}</span>
            <span className="board-stats__label">high</span>
          </li>
          <li>
            <span className="board-stats__value" style={{ color: 'var(--sev-medium)' }}>{counts.medium}</span>
            <span className="board-stats__label">medium</span>
          </li>
          <li>
            <span className="board-stats__value" style={{ color: 'var(--sev-low)' }}>{counts.low}</span>
            <span className="board-stats__label">low</span>
          </li>
          <li>
            <span className="board-stats__value" style={{ color: 'var(--ghost)' }}>{counts.quick}</span>
            <span className="board-stats__label">quick fix</span>
          </li>
          <li>
            <span className="board-stats__value">{counts.needsModel}</span>
            <span className="board-stats__label">need AI</span>
          </li>
        </ul>

        {counts.needsModel > 0 && !modelReady ? (
          <ErrorBanner tone="warn" title={`${counts.needsModel} bug${counts.needsModel === 1 ? '' : 's'} need an AI model`}>
            Those cards are marked “Needs AI”. Start Ollama (<code>ollama serve</code>) or use the{' '}
            <strong>{counts.quick} quick fix</strong> card{counts.quick === 1 ? '' : 's'} that need no model at all.
          </ErrorBanner>
        ) : null}
      </section>

      {/* Sticky toolbar: the one thing you interact with repeatedly. */}
      <section className="panel panel--tight board-toolbar" aria-label="Filter and sort findings">
        <div className="board-toolbar__row">
          <div className="search">
            <label className="sr-only" htmlFor="finding-search">
              Search findings
            </label>
            <input
              id="finding-search"
              className="input"
              type="search"
              placeholder="Search title, file, rule…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <label className="field field--inline">
            <span className="sr-only">Sort findings</span>
            <select className="select" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
              <option value="severity">Sort: severity</option>
              <option value="confidence">Sort: confidence</option>
              <option value="file">Sort: file name</option>
            </select>
          </label>
          <span className="badge badge--muted" aria-live="polite">
            {filtered.length} shown
          </span>
        </div>

        <div className="board-toolbar__row board-toolbar__row--wrap">
          <div className="filters" role="group" aria-label="Filter by severity">
            {(['all', 'high', 'medium', 'low'] as const).map((level) => (
              <button
                key={level}
                type="button"
                className="chip"
                aria-pressed={severity === level}
                onClick={() => setSeverity(level)}
              >
                {level === 'all' ? `All ${counts.all}` : `${SEVERITY_LABEL[level]} ${counts[level]}`}
              </button>
            ))}
          </div>
          <div className="filters" role="group" aria-label="Filter by source">
            {(['all', 'static', 'llm', 'issue'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className="chip"
                aria-pressed={source === kind}
                onClick={() => setSource(kind)}
              >
                {kind === 'all' ? 'Every source' : kind === 'llm' ? 'AI review' : kind === 'static' ? 'Static' : 'Issues'}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="chip chip--accent"
            aria-pressed={fixableOnly}
            onClick={() => setFixableOnly((value) => !value)}
            title="Show only bugs a deterministic patch can fix without an AI model"
          >
            <SparkIcon size={13} /> Quick fixes only
          </button>
        </div>
      </section>

      {scan.notes.length > 0 ? (
        <details className="panel panel--tight">
          <summary className="small" style={{ cursor: 'pointer', fontWeight: 650 }}>
            Scan details ({scan.notes.length} note{scan.notes.length === 1 ? '' : 's'})
          </summary>
          <ul className="small muted" style={{ marginTop: '0.6rem', paddingLeft: '1.1rem' }}>
            {scan.notes.map((note) => (
              <li key={note} style={{ marginBottom: '0.35rem' }}>
                {note}
              </li>
            ))}
          </ul>
          {scan.stats.lintersDetected.length > 0 ? (
            <p className="small muted" style={{ margin: '0.5rem 0 0' }}>
              Linters detected: <strong>{scan.stats.lintersDetected.join(', ')}</strong>. BugBanisher never
              installs or executes repository code — only safe parsers and its own rules run.
            </p>
          ) : null}
          {Object.keys(scan.stats.skippedReasons).length > 0 ? (
            <p className="small muted" style={{ margin: '0.35rem 0 0' }}>
              Skipped: {Object.entries(scan.stats.skippedReasons)
                .map(([reason, count]) => `${count} × ${reason}`)
                .join(' · ')}
            </p>
          ) : null}
        </details>
      ) : null}

      {filtered.length === 0 ? (
        <section className="panel center" aria-live="polite">
          <Ghost size={84} mood="happy" />
          <h2 className="panel__heading" style={{ marginTop: '0.6rem' }}>
            {scan.findings.length === 0 ? 'This house looks quiet' : 'Nothing matches these filters'}
          </h2>
          <p className="muted small" style={{ maxWidth: '54ch', margin: '0 auto 1rem' }}>
            {scan.findings.length === 0
              ? 'These checks found nothing in the files they scanned. That is not proof the code is clean — scan again after your next change, or try the bundled demo to see the flow.'
              : 'Try clearing the severity, source or “quick fixes only” filters.'}
          </p>
          {scan.findings.length === 0 ? (
            <button type="button" className="btn btn--ghost" onClick={onRescan}>
              Scan again
            </button>
          ) : (
            <button type="button" className="btn btn--small" onClick={resetFilters}>
              Clear filters
            </button>
          )}
        </section>
      ) : (
        <ul className="finding-list">
          {filtered.map((finding) => {
            const isBanished = banished?.has(finding.id) ?? false;
            const href = codeHref(scan, finding);
            const canAutoFix = quickFix(finding);
            const cantPatch = !patchable(finding);
            const blockedByModel = needsModel(finding) && !modelReady;

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
                  <span className={`severity-dot severity-dot--${finding.severity}`} aria-hidden="true" />
                  <span className={`badge badge--${finding.severity}`}>{SEVERITY_LABEL[finding.severity]}</span>
                  {isBanished ? (
                    <span className="badge badge--ghost">
                      <span aria-hidden="true">✦</span> Banished
                    </span>
                  ) : canAutoFix ? (
                    <span className="badge badge--ghost" title="A deterministic patch can fix this without an AI model">
                      <SparkIcon size={12} /> Quick fix
                    </span>
                  ) : cantPatch ? (
                    <span className="badge badge--muted" title="This finding comes from an issue, not a line of code">
                      Needs a file
                    </span>
                  ) : (
                    <span className="badge badge--muted" title="An AI model drafts this patch">
                      Needs AI
                    </span>
                  )}
                  <code className="finding-card__where">
                    {finding.source === 'issue' ? finding.file : `${finding.file}:${finding.line}`}
                  </code>
                  <span className="finding-card__meta">
                    <span className="dim tiny">{SOURCE_LABEL[finding.source]}</span>
                    <Confidence value={finding.confidence} />
                  </span>
                </div>

                <h2 className="finding-card__title">{finding.title}</h2>
                <p className="finding-card__explain">{finding.explanation}</p>

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

                {finding.source === 'issue' && finding.issue ? (
                  <p className="small" style={{ marginBottom: '0.6rem' }}>
                    {finding.issue.url ? (
                      <a href={finding.issue.url} target="_blank" rel="noreferrer">
                        <GitHubIcon size={14} /> Issue #{finding.issue.number} on GitHub
                      </a>
                    ) : (
                      <span className="mono">issue #{finding.issue.number} (bundled demo issue)</span>
                    )}{' '}
                    <span className="dim">· labels: {finding.issue.labels.join(', ') || 'none'}</span>
                  </p>
                ) : (
                  <Snippet finding={finding} />
                )}

                <div className="finding-card__actions">
                  {patchable(finding) ? (
                    <button
                      type="button"
                      className="btn btn--small btn--primary"
                      onClick={() => onPickFix(finding)}
                      disabled={blockedByModel}
                      title={
                        blockedByModel
                          ? 'No AI model is reachable and this rule has no deterministic fix. Start Ollama, or pick a card marked “Quick fix”.'
                          : undefined
                      }
                    >
                      <WrenchIcon size={15} /> {blockedByModel ? 'Needs an AI model' : 'Fix this bug'}
                    </button>
                  ) : (
                    <span className="small dim">Issue-only finding — link it to a file to patch it.</span>
                  )}
                  {href ? (
                    <a className="btn btn--small" href={href} target="_blank" rel="noreferrer">
                      <GitHubIcon size={15} /> View code
                    </a>
                  ) : null}
                  <span className="tiny dim finding-card__rule">
                    <BookIcon size={13} /> {finding.ruleId ?? finding.source}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ErrorBanner tone="warn" title="Read before you approve">
        AI findings can be wrong. Read the explanation, check the diff, and only then open a pull request.
        BugBanisher never merges.
      </ErrorBanner>
    </div>
  );
}
