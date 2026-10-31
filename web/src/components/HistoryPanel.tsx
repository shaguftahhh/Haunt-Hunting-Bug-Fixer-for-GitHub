/**
 * History tab: every pull request BugBanisher opened (or simulated) this
 * session, with links, the branch, and how many approvals remain.
 */
import type { SessionView } from '../types';
import { Ghost } from './Ghost';
import { ArrowLeftIcon, BranchIcon, GitHubIcon, HistoryIcon, ShieldIcon } from './Icons';

interface HistoryPanelProps {
  session: SessionView | null;
  onBack: () => void;
  onDisconnect: () => void;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function HistoryPanel({ session, onBack, onDisconnect }: HistoryPanelProps) {
  const history = session?.history ?? [];
  const approvals = session?.approvals ?? 0;
  const cap = session?.approvalCap ?? 3;

  return (
    <div className="stack">
      <section className="panel" aria-labelledby="history-title">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <p className="eyebrow">Session history</p>
            <h2 className="panel-title" id="history-title">
              <HistoryIcon size={18} /> Pull requests from this session
            </h2>
            <p className="small muted" style={{ marginBottom: 0 }}>
              {approvals}/{cap} approvals used. BugBanisher keeps at most {cap} pull requests per session and
              never merges them.
            </p>
          </div>
          <div className="row">
            <button type="button" className="btn btn--small" onClick={onBack}>
              <ArrowLeftIcon size={16} /> Back
            </button>
            {session?.connected ? (
              <button type="button" className="btn btn--small btn--danger" onClick={onDisconnect}>
                Disconnect GitHub
              </button>
            ) : null}
          </div>
        </div>

        <div
          className="progress-track"
          style={{ marginTop: '1rem' }}
          role="progressbar"
          aria-label="Approvals used"
          aria-valuemin={0}
          aria-valuemax={cap}
          aria-valuenow={approvals}
        >
          <div className="progress-fill" style={{ width: `${Math.min(100, (approvals / cap) * 100)}%` }} />
        </div>
        <p className="tiny dim" style={{ marginTop: '0.4rem', marginBottom: 0 }}>
          <ShieldIcon size={12} /> The cap counts simulated (dry-run) approvals too, so you cannot rehearse an
          unlimited number of PRs.
        </p>
      </section>

      {history.length === 0 ? (
        <section className="panel center">
          <Ghost size={84} mood="idle" />
          <h3 style={{ marginTop: '0.75rem' }}>No pull requests yet</h3>
          <p className="muted small">
            When you approve a verified fix, it appears here with a link. Nothing is ever merged automatically.
          </p>
          <button type="button" className="btn btn--small" onClick={onBack}>
            Back to the hunt
          </button>
        </section>
      ) : (
        <section className="panel" aria-label="Pull requests this session">
          <ul className="history-list">
            {history.map((entry) => (
              <li key={entry.id} className="history-item">
                <div className="history-item__main">
                  <div className="row" style={{ gap: '0.5rem', marginBottom: '0.15rem' }}>
                    {entry.dryRun ? (
                      <span className="badge badge--medium">dry run</span>
                    ) : (
                      <span className="badge badge--low">opened</span>
                    )}
                    <strong>{entry.title}</strong>
                  </div>
                  <p className="small muted" style={{ margin: 0 }}>
                    {entry.findingTitle} · <span className="mono">{entry.file}{entry.line ? `:${entry.line}` : ''}</span>
                    <br />
                    <span className="tiny dim">
                      <BranchIcon size={12} /> {entry.branchName} · {entry.repoFullName} · {when(entry.createdAt)}
                    </span>
                  </p>
                </div>
                <div className="row">
                  {entry.htmlUrl ? (
                    <a className="btn btn--small btn--ghost" href={entry.htmlUrl} target="_blank" rel="noreferrer">
                      <GitHubIcon size={15} /> PR #{entry.number}
                    </a>
                  ) : (
                    <span className="small dim">simulated — no PR created</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
