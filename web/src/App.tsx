/**
 * App shell and view state machine.
 *
 * Views:
 *   connect  → GitHub not connected yet
 *   repos    → choose ONE owned repository
 *   scan     → scanning in progress / scan results intro
 *   fix      → patch preview for a chosen finding
 *   history  → PRs opened this session
 *
 * The GitHub token never reaches this file: the browser only holds a session
 * cookie, and all GitHub calls happen on the server.
 */
import { useEffect, useState } from 'react';
import { api } from './api';
import type { ConnectResponse } from './api';
import type { RepoSummary, SessionView } from './types';
import { Header } from './components/Header';
import { ConnectPanel } from './components/ConnectPanel';
import { RepoPicker } from './components/RepoPicker';
import { ErrorBanner } from './components/ErrorBanner';
import { Ghost } from './components/Ghost';
import { HistoryPanel } from './components/HistoryPanel';
import { ScanPanel } from './components/ScanPanel';
import { BugBoard } from './components/BugBoard';
import { FixPanel } from './components/FixPanel';
import type { Finding, FixResult, ScanResult } from './types';

type View = 'connect' | 'repos' | 'scan' | 'board' | 'fix' | 'history';

export default function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<unknown>(null);
  const [view, setView] = useState<View>('connect');
  const [repo, setRepo] = useState<RepoSummary | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [finding, setFinding] = useState<Finding | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Load the session on first paint (and after an OAuth redirect).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auth = params.get('auth');
    if (auth === 'ok') setNotice('GitHub connected. Pick a repository to haunt.');
    if (auth === 'cancelled') setNotice('GitHub sign-in was cancelled. No changes were made.');
    if (auth) window.history.replaceState({}, '', window.location.pathname);

    api
      .session()
      .then((data) => {
        setSession(data);
        setView(data.connected ? 'repos' : 'connect');
      })
      .catch((err) => setBootError(err))
      .finally(() => setBooting(false));
  }, []);

  function handleConnected(next: ConnectResponse) {
    setSession(next);
    setNotice(`Connected as @${next.user?.login ?? 'you'}. Dry run is ${next.dryRun ? 'ON' : 'OFF'}.`);
    setView('repos');
  }

  async function toggleDryRun(next: boolean) {
    try {
      const updated = await api.setDryRun(next);
      setSession(updated);
      setNotice(
        next
          ? 'Dry run ON — approvals will simulate the PR and write nothing to GitHub.'
          : 'Dry run OFF — approvals will create a real branch, commit and pull request. Never on the default branch.',
      );
    } catch (err) {
      setBootError(err);
    }
  }

  async function disconnect() {
    try {
      const updated = await api.disconnect();
      setSession(updated);
      setRepo(null);
      setScan(null);
      setFinding(null);
      setView('connect');
      setNotice('Disconnected. The token was dropped from server memory.');
    } catch (err) {
      setBootError(err);
    }
  }

  function goHome() {
    setView(session?.connected ? (repo ? 'scan' : 'repos') : 'connect');
  }

  function handleRepo(repoSummary: RepoSummary) {
    setRepo(repoSummary);
    setScan(null);
    setFinding(null);
    setView('scan');
  }

  const connected = Boolean(session?.connected);

  return (
    <>
      <Header
        session={session}
        onToggleDryRun={toggleDryRun}
        onGoHistory={() => setView('history')}
        onGoHome={goHome}
      />

      <main className="page" id="main">
        {booting ? (
          <div className="panel" aria-busy="true" aria-live="polite">
            <div className="row">
              <Ghost size={42} />
              <span>Summoning the BugBanisher…</span>
            </div>
          </div>
        ) : null}

        {bootError ? (
          <div style={{ marginBottom: '1rem' }}>
            <ErrorBanner
              error={bootError}
              title="Something went wrong"
              onRetry={() => window.location.reload()}
            />
          </div>
        ) : null}

        {!booting && notice ? (
          <div style={{ marginBottom: '1rem' }}>
            <ErrorBanner tone="info">
              {notice}{' '}
              <button
                type="button"
                className="btn btn--small"
                style={{ marginLeft: '0.5rem' }}
                onClick={() => setNotice(null)}
              >
                Dismiss
              </button>
            </ErrorBanner>
          </div>
        ) : null}

        {!booting && !connected && view !== 'history' ? (
          <>
            <section className="hero">
              <div>
                <p className="eyebrow">AI for open source · human in the loop</p>
                <h1>
                  Banish bugs.<br />
                  <span className="glow-blood">Keep the humans in charge.</span>
                </h1>
                <p>
                  BugBanisher reads one of your repositories, explains each bug in plain English, drafts a
                  minimal fix, and opens a pull request <strong>only after you approve it</strong>. Dry-run
                  is on by default, and nothing is ever merged automatically.
                </p>
                <div className="row">
                  <span className="badge badge--ghost">open-weight model</span>
                  <span className="badge badge--low">3 PRs max / session</span>
                  <span className="badge badge--medium">no auto-merge</span>
                </div>
              </div>
              <div className="hero__art" aria-hidden="true">
                <div className="moon" />
                <Ghost size={104} mood="idle" />
              </div>
            </section>

            <ConnectPanel
              oauthAvailable={session?.oauthAvailable ?? false}
              onConnected={handleConnected}
            />
          </>
        ) : null}

        {!booting && connected && view === 'repos' ? (
          <RepoPicker
            login={session?.user?.login ?? ''}
            onPick={handleRepo}
            onBack={() => setView('connect')}
          />
        ) : null}

        {!booting && connected && view === 'scan' && repo && session ? (
          <ScanPanel
            repo={repo}
            dryRun={session.dryRun}
            llm={session.llm}
            onBack={() => setView('repos')}
            onScanned={(result) => {
              setScan(result);
              setView('board');
            }}
          />
        ) : null}

        {!booting && connected && view === 'board' && scan ? (
          <BugBoard
            scan={scan}
            onBack={() => setView('scan')}
            onRescan={() => setView('scan')}
            onPickFix={(picked) => {
              setFinding(picked);
              setView('fix');
            }}
          />
        ) : null}

        {!booting && connected && view === 'fix' && scan && finding ? (
          <FixPanel
            scan={scan}
            finding={finding}
            dryRun={session?.dryRun ?? true}
            approvals={session?.approvals ?? 0}
            approvalCap={session?.approvalCap ?? 3}
            onBack={() => setView('board')}
            onApprove={(fix: FixResult) => {
              setNotice(`Patch ${fix.fixId} is verified. The approval step arrives in the next phase.`);
            }}
          />
        ) : null}

        {!booting && view === 'history' ? (
          <HistoryPanel
            session={session}
            onBack={goHome}
            onDisconnect={() => {
              void disconnect();
            }}
          />
        ) : null}
      </main>

      <footer className="page" style={{ paddingTop: 0 }}>
        <p className="tiny dim">
          BugBanisher · MIT licensed · open-weight models (Gemma / Llama) via Ollama or any
          OpenAI-compatible endpoint · every pull request is labelled <code>ai-assisted</code> and is never
          merged for you.
        </p>
      </footer>
    </>
  );
}
