/**
 * "Connect GitHub" screen.
 *
 * Two options:
 *  - Fine-grained personal access token (recommended: you pick exactly one repo,
 *    and only Contents + Pull requests permissions).
 *  - OAuth app, if the person running BugBanisher configured one.
 *
 * The permissions we actually use are listed explicitly under the form — the
 * app never asks for more than it can justify.
 */
import { useState, type FormEvent } from 'react';
import type { ConnectResponse } from '../api';
import { api } from '../api';
import { ErrorBanner } from './ErrorBanner';
import { Ghost } from './Ghost';
import { CheckIcon, GitHubIcon, KeyIcon, ShieldIcon, XIcon } from './Icons';

interface ConnectPanelProps {
  oauthAvailable: boolean;
  onConnected: (session: ConnectResponse) => void;
  onStartDemo: () => void;
  demoBusy: boolean;
}

export function ConnectPanel({ oauthAvailable, onConnected, onStartDemo, demoBusy }: ConnectPanelProps) {
  const [tab, setTab] = useState<'pat' | 'oauth'>(oauthAvailable ? 'pat' : 'pat');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.connectWithToken(token);
      setWarnings(session.warnings ?? []);
      setToken('');
      onConnected(session);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connect-grid">
      <section className="panel panel--glow" aria-labelledby="connect-title">
        <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
          <Ghost size={64} mood="idle" />
          <div>
            <p className="eyebrow">Step 1 of 4 · summon access</p>
            <h2 className="panel-title" id="connect-title">
              Connect GitHub
            </h2>
            <p className="muted small" style={{ marginBottom: 0 }}>
              BugBanisher reads one repository you choose and can only write when you approve a fix.
            </p>
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label="Connection method" style={{ marginTop: '1.25rem' }}>
          <button
            type="button"
            role="tab"
            id="tab-pat"
            aria-selected={tab === 'pat'}
            aria-controls="panel-pat"
            className="tab"
            onClick={() => setTab('pat')}
          >
            Fine-grained token <span className="badge badge--ghost">recommended</span>
          </button>
          <button
            type="button"
            role="tab"
            id="tab-oauth"
            aria-selected={tab === 'oauth'}
            aria-controls="panel-oauth"
            className="tab"
            onClick={() => setTab('oauth')}
            disabled={!oauthAvailable}
            title={oauthAvailable ? undefined : 'OAuth is not configured on this server'}
          >
            OAuth app
          </button>
        </div>

        {tab === 'pat' ? (
          <form id="panel-pat" role="tabpanel" aria-labelledby="tab-pat" onSubmit={submit}>
            <label className="field">
              <span className="label">Personal access token</span>
              <span className="token-wrap">
                <input
                  className="input input--mono"
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="github_pat_…"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  aria-describedby="token-help"
                />
                <button
                  type="button"
                  className="btn btn--small token-toggle"
                  onClick={() => setShowToken((value) => !value)}
                  aria-pressed={showToken}
                >
                  {showToken ? 'Hide' : 'Show'}
                </button>
              </span>
              <span className="help" id="token-help">
                Starts with <code>github_pat_</code>. Stored in server memory only — never written to disk,
                never sent to the browser, never logged.
              </span>
            </label>

            <button
              className="btn btn--primary btn--block"
              type="submit"
              disabled={busy || token.trim().length < 20}
            >
              {busy ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Verifying token…
                </>
              ) : (
                <>
                  <KeyIcon size={16} /> Connect with token
                </>
              )}
            </button>

            {warnings.map((warning) => (
              <div key={warning} style={{ marginTop: '0.75rem' }}>
                <ErrorBanner tone="warn" title="Heads up">
                  {warning}
                </ErrorBanner>
              </div>
            ))}
            {error ? (
              <div style={{ marginTop: '0.75rem' }}>
                <ErrorBanner error={error} title="Could not connect" />
              </div>
            ) : null}

            <ol className="steps" style={{ marginTop: '1.1rem' }}>
              <li>
                Open{' '}
                <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
                  github.com/settings/personal-access-tokens/new
                </a>
                .
              </li>
              <li>Repository access: <strong>Only select repositories</strong> → pick the one repo you want banished of bugs.</li>
              <li>
                Permissions: <strong>Contents: Read and write</strong>, <strong>Pull requests: Read and write</strong>.
                Nothing else.
              </li>
              <li>Set a short expiry (7 days is plenty), generate, and paste it above.</li>
            </ol>
          </form>
        ) : (
          <div id="panel-oauth" role="tabpanel" aria-labelledby="tab-oauth">
            <p className="muted small">
              OAuth asks GitHub for the <code>{'repo'}</code> scope. The client secret stays on the server.
            </p>
            <a className="btn btn--primary btn--block" href="/api/auth/github/start">
              <GitHubIcon size={16} /> Continue with GitHub
            </a>
            <p className="help" style={{ marginTop: '0.75rem' }}>
              Note: OAuth grants access to all repositories the token can see. A fine-grained token is
              narrower — and narrower is safer.
            </p>
          </div>
        )}
      </section>

      <aside className="panel" aria-labelledby="permissions-title">
        <p className="eyebrow">Least privilege</p>
        <h2 className="panel-title" id="permissions-title">
          <ShieldIcon size={18} /> Exactly these permissions
        </h2>
        <p className="muted small">No admin rights, no org access, no workflows, no packages.</p>

        <ul className="permission-list">
          <li>
            <CheckIcon size={16} className="check" />
            <span>
              <strong>Contents — read and write</strong>
              <br />
              <span className="muted small">Read your code; write one branch and one commit when you approve.</span>
            </span>
          </li>
          <li>
            <CheckIcon size={16} className="check" />
            <span>
              <strong>Pull requests — read and write</strong>
              <br />
              <span className="muted small">Open a PR for the fix you approved. Never merge it.</span>
            </span>
          </li>
          <li>
            <XIcon size={16} className="no" />
            <span>
              <strong>No admin, secrets, actions or org scopes</strong>
              <br />
              <span className="muted small">BugBanisher cannot change settings, workflows or members.</span>
            </span>
          </li>
          <li>
            <XIcon size={16} className="no" />
            <span>
              <strong>No auto-merge, ever</strong>
              <br />
              <span className="muted small">Every write needs a click on “Open Pull Request”.</span>
            </span>
          </li>
        </ul>

        <hr className="divider" />
        <button type="button" className="btn btn--ghost btn--block" onClick={onStartDemo} disabled={demoBusy}>
          {demoBusy ? <span className="spinner" aria-hidden="true" /> : '👻'} Explore Demo Mode (works offline)
        </button>
        <p className="tiny dim" style={{ marginTop: '0.6rem', marginBottom: 0 }}>
          The demo uses a bundled sample repo with four planted bugs and cached model responses. It needs no
          GitHub account, no model and no internet.
        </p>
      </aside>
    </div>
  );
}
