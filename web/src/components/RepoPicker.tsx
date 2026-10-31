/**
 * Repo picker — shows only repositories the signed-in user OWNS.
 * There is no free-text repo field anywhere: a repo must come from this list,
 * which is fetched with affiliation=owner and re-checked server-side.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { RepoSummary } from '../types';
import { ErrorBanner } from './ErrorBanner';
import { ArrowLeftIcon, BranchIcon, SearchIcon, SparkIcon } from './Icons';

interface RepoPickerProps {
  login: string;
  onPick: (repo: RepoSummary) => void;
  onBack: () => void;
}

export function RepoPicker({ login, onPick, onBack }: RepoPickerProps) {
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  const [onlyOwn, setOnlyOwn] = useState(true);

  function load() {
    setError(null);
    setRepos(null);
    api
      .repos()
      .then((data) => setRepos(data.repos))
      .catch((err) => setError(err));
  }

  useEffect(load, []);

  const filtered = useMemo(() => {
    if (!repos) return [];
    const needle = query.trim().toLowerCase();
    return repos
      .filter((repo) => (onlyOwn ? repo.owner.toLowerCase() === login.toLowerCase() : true))
      .filter((repo) =>
        needle ? repo.name.toLowerCase().includes(needle) || (repo.description ?? '').toLowerCase().includes(needle) : true,
      )
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }, [repos, query, login, onlyOwn]);

  return (
    <section className="panel" aria-labelledby="repos-title">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <p className="eyebrow">Step 2 of 4 · choose the haunted house</p>
          <h2 className="panel-title" id="repos-title">
            <BranchIcon size={18} /> Pick one repository
          </h2>
          <p className="muted small" style={{ maxWidth: '62ch' }}>
            Only repositories owned by <strong>@{login}</strong> are listed. BugBanisher never touches anything
            else — there is no way to type in a repo it cannot see.
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
            placeholder="Search your repositories…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className="badge badge--muted">{repos ? `${filtered.length} of ${repos.length}` : 'loading'}</span>
      </div>

      {error ? (
        <ErrorBanner error={error} title="Could not load your repositories" onRetry={load} />
      ) : null}

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
          <p style={{ marginBottom: '0.25rem' }}>No repositories match.</p>
          <p className="small">
            If your fine-grained token is limited to one repo, that repo is the only one you will see.
          </p>
        </div>
      ) : null}

      {repos && filtered.length > 0 ? (
        <ul className="repo-list">
          {filtered.map((repo) => (
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
                    width: 34,
                    height: 34,
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
                  <span className="repo-card__name">{repo.name}</span>
                  <span className="repo-card__desc">
                    {repo.description ?? 'No description'}
                  </span>
                </span>
                <span className="repo-card__meta">
                  {repo.language ? <span className="badge badge--muted">{repo.language}</span> : null}
                  <span className={`badge ${repo.private ? 'badge--medium' : 'badge--ghost'}`}>
                    {repo.private ? 'private' : 'public'}
                  </span>
                  <span className="tiny dim mono">{repo.defaultBranch}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="toggle" style={{ marginTop: '0.9rem' }}>
        <input type="checkbox" checked={onlyOwn} onChange={(event) => setOnlyOwn(event.target.checked)} />
        <span className="toggle__track" aria-hidden="true">
          <span className="toggle__thumb" />
        </span>
        <span className="small muted">Only show repositories I personally own</span>
      </label>
    </section>
  );
}
