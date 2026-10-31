/**
 * Top bar: brand + mascot, connection status, dry-run switch and history link.
 * The dry-run switch is the most important control in the app, so it lives
 * permanently in the header and is labelled in plain words.
 */
import type { SessionView } from '../types';
import { Bats } from './Bats';
import { Ghost } from './Ghost';
import { HistoryIcon } from './Icons';

interface HeaderProps {
  session: SessionView | null;
  demoMode: boolean;
  demoBusy?: boolean;
  onToggleDryRun: (next: boolean) => void;
  onToggleDemo: () => void;
  onGoHistory: () => void;
  onGoHome: () => void;
  busy?: boolean;
}

export function Header({
  session,
  demoMode,
  demoBusy,
  onToggleDryRun,
  onToggleDemo,
  onGoHistory,
  onGoHome,
  busy,
}: HeaderProps) {
  const connected = Boolean(session?.connected);
  return (
    <header className="site-header">
      <Bats />
      <div className="site-header__inner">
        <a
          className="brand"
          href="#main"
          onClick={(event) => {
            event.preventDefault();
            onGoHome();
          }}
        >
          <Ghost size={38} animate={false} title="BugBanisher ghost mascot" />
          <span className="brand__text">
            <span className="brand__name">
              Bug<em>Banisher</em>
            </span>
            <span className="brand__tag">human-approved AI bug fixing</span>
          </span>
        </a>

        <div className="header-actions">
          {demoMode ? (
            <span className="status-chip" title="Offline sample repository with cached model responses">
              <span className="status-dot status-dot--dry" aria-hidden="true" />
              Demo Mode
            </span>
          ) : null}

          {connected && session ? (
            <>
              <span className="status-chip" title="The GitHub account connected to this session">
                <span className="status-dot status-dot--live" aria-hidden="true" />
                @{session.user?.login}
              </span>

              <label
                className="toggle"
                title={
                  demoMode
                    ? 'Demo Mode is always a dry run — there is no GitHub repository to write to'
                    : 'Dry run shows what would happen without writing to GitHub'
                }
              >
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={session.dryRun}
                  checked={demoMode ? true : session.dryRun}
                  disabled={busy || demoMode}
                  onChange={(event) => onToggleDryRun(event.target.checked)}
                />
                <span className="toggle__track" aria-hidden="true">
                  <span className="toggle__thumb" />
                </span>
                <span className="small">
                  Dry run <span className={session.dryRun ? 'badge badge--medium' : 'badge badge--high'}>
                    {session.dryRun ? 'ON' : 'OFF'}
                  </span>
                </span>
              </label>

              <span className="status-chip" title="Hard cap of 3 pull requests per session">
                PRs {session.approvals}/{session.approvalCap}
              </span>

              <button type="button" className="btn btn--small btn--ghost" onClick={onGoHistory}>
                <HistoryIcon size={16} />
                History
              </button>
            </>
          ) : demoMode && session ? (
            <>
              <span className="status-chip" title="Demo Mode never writes to GitHub">
                <span className="status-dot status-dot--dry" aria-hidden="true" />
                dry run ON
              </span>
              <span className="status-chip" title="Hard cap of 3 approvals per session">
                PRs {session.approvals}/{session.approvalCap}
              </span>
              <button type="button" className="btn btn--small btn--ghost" onClick={onGoHistory}>
                <HistoryIcon size={16} />
                History
              </button>
            </>
          ) : (
            <span className="status-chip">
              <span className="status-dot" aria-hidden="true" />
              Not connected
            </span>
          )}

          <button
            type="button"
            className={`btn btn--small ${demoMode ? 'btn--primary' : 'btn--ghost'}`}
            aria-pressed={demoMode}
            onClick={onToggleDemo}
            disabled={demoBusy || busy}
            title={demoMode ? 'Leave Demo Mode and return to your repositories' : 'Try the offline sample repository'}
          >
            {demoBusy ? <span className="spinner" aria-hidden="true" /> : '👻'}
            {demoMode ? 'Exit demo' : 'Demo Mode'}
          </button>
        </div>
      </div>
    </header>
  );
}
