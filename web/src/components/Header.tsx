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
  onToggleDryRun: (next: boolean) => void;
  onGoHistory: () => void;
  onGoHome: () => void;
  busy?: boolean;
}

export function Header({ session, onToggleDryRun, onGoHistory, onGoHome, busy }: HeaderProps) {
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
          {connected && session ? (
            <>
              <span className="status-chip" title="The GitHub account connected to this session">
                <span className="status-dot status-dot--live" aria-hidden="true" />
                @{session.user?.login}
              </span>

              <label className="toggle" title="Dry run shows what would happen without writing to GitHub">
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={session.dryRun}
                  checked={session.dryRun}
                  disabled={busy}
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
          ) : (
            <span className="status-chip">
              <span className="status-dot" aria-hidden="true" />
              Not connected
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
