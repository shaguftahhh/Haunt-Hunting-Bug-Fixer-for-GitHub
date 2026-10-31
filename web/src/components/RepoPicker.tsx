/**
 * Repo picker — shows repositories you own, plus (optionally) repositories you
 * have write access to, like an organisation repo or one a fine-grained token
 * was explicitly scoped to.
 *
 * There is still no free-text repo field: you must select one repository from
 * this list, and the server re-checks access before every scan and write.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { RepoSummary } from '../types';
import { ErrorBanner } from './ErrorBanner';
import { ArrowLeftIcon, BranchIcon, SearchIcon, ShieldIcon, SparkIcon } from './Icons';

interface RepoPickerProps {
  login: string;
  onPick: (repo: RepoSummary) => void;
  onBack: () => void;
}

export function RepoPicker({ login, onPick, onBack }: RepoPickerProps) {
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  const [includeWritable, setIncludeWritable] = useState(false);

  const load = useCallback(() => {
    setError(null);
    setRepos(null);
    api
      .repos(includeWritable)
      .then((data) => setRepos(data.repos))
      .catch((err) => setError(err));
  }, [includeWritable]);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    if (!repos) return [];
    const needle = query.trim().toLowerCase();
    return repos
      .filter((repo) =>
        needle
          ? repo.name.toLowerCase().includes(needle) ||
            (repo.description ?? '').toLowerCase().includes(needle)
          : true,
      )
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }, [repos, query]);

  return (
    <section className="panel" aria-labelledby="repos-title">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <p className="eyebrow">Step 2 of 4 · choose the haunted house</p>
          <h1 className="panel__heading" id="repos-title" style={{ fontSize: '1.6rem' }}>
            <BranchIcon size={20} /> Pick one repository
          </h1>
          <p className="muted small" style={{ maxWidth: '64ch', marginBottom: 0 }}>
            Signed in as <strong>@{login}</strong>. BugBanisher only ever reads and writes the one repository
            you choose here.
          </p>
        </div>
        <button type="button" className="btn btn--small" onClick={onBack}>
          <ArrowLeftIcon size={16} /> Back
        </button>
      </div>

      <div className="repo-toolbar" style={{ marginTop: '1rem' }}>
        <div className="search">
          <SearchIcon size={16} />
          <label className="sr-only" htmlFor="repo-search">
            Search your repositories
          </label>
          <input
            id="repo-search"
            className="input"
            type="search"
            placeholder="Search repositories…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className="badge badge--muted">{repos ? `${filtered.length} of ${repos.length}` : 'loading'}</span>
      </div>

      <label className="toggle" style={{ marginBottom: '0.9rem' }}>
        <input
          type="checkbox"
          checked={includeWritable}
          onChange={(event) => setIncludeWritable(event.target.checked)}
        />
        <span className="toggle__track" aria-hidden="true">
          <span className="toggle__thumb" />
        </span>
        <span className="small">
          Include repositories I can write to (organisation repos)
          <span className="help" style={{ display: 'block', marginTop: 0 }}>
            Only repos where you have write access are listed. You still choose exactly one.
          </span>
        </span>
      </label>

      {error ? <ErrorBanner error={error} title="Could not load your repositories" onRetry={load} /> : null}

      {!repos && !error ? (
        <div aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading your repositories…</span>
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : null}

      {repos && filtered.length === 0 ? (
        <div className="empty">
          <p style={{ marginBottom: '0.25rem' }}>
            <strong>No repositories match.</strong>
          </p>
          <p className="small" style={{ marginBottom: '0.75rem' }}>
            A fine-grained token only sees the repositories you added to it. Check the token's
            “Repository access” list, or scan the bundled demo instead.
          </p>
          {query ? (
            <button type="button" className="btn btn--small" onClick={() => setQuery('')}>
              Clear search
            </button>
          ) : null}
        </div>
      ) : null}

      {repos && filtered.length > 0 ? (
        <ul className="repo-list">
          {filtered.map((repo) => {
            const ownsRepo = repo.owner.toLowerCase() === login.toLowerCase();
            return (
              <li key={repo.fullName}>
                <button
                  type="button"
                  className="repo-card"
                  onClick={() => onPick(repo)}
                  aria-label={`Scan ${repo.fullName}`}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'rgba(126,247,181,0.1)',
                      border: '1px solid rgba(126,247,181,0.25)',
                      color: 'var(--ghost)',
                      flex: 'none',
                    }}
                  >
                    <SparkIcon size={16} />
                  </span>
                  <span className="repo-card__main">
                    <span className="repo-card__name">
                      {ownsRepo ? repo.name : repo.fullName}
                    </span>
                    <span className="repo-card__desc">{repo.description ?? 'No description'}</span>
                  </span>
                  <span className="repo-card__meta">
                    {!ownsRepo ? (
                      <span className="badge badge--medium" title="You have write access, but you do not own this repo">
                        <ShieldIcon size={11} /> write access
                      </span>
                    ) : null}
                    {repo.language ? <span className="badge badge--muted">{repo.language}</span> : null}
                    <span className={`badge ${repo.private ? 'badge--medium' : 'badge--ghost'}`}>
                      {repo.private ? 'private' : 'public'}
                    </span>
                    <span className="tiny dim mono">{repo.defaultBranch}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
