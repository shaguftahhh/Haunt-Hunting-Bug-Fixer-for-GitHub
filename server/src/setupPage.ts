/**
 * The "API only" page.
 *
 * When a deployment has no built frontend, opening the root URL used to show
 * `{"error":"No API route for GET /","status":404}` — technically correct, and
 * completely opaque. This page explains the situation in plain language, points
 * at the working API endpoints, and lists the two settings that fix it.
 *
 * It is self-contained (inline CSS, no fonts, no scripts) so it renders even on
 * a broken deployment, and it needs no build step.
 */

interface SetupPageOptions {
  /** Public, non-secret facts only. */
  serverless: boolean;
}

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 2rem 1.25rem;
    background: radial-gradient(1200px 600px at 50% -10%, #2a1030 0%, #0b0710 60%, #070509 100%);
    color: #fbf9fe;
    font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  main { width: 100%; max-width: 720px; }
  .card {
    background: rgba(24, 17, 33, 0.92); border: 1px solid #3a2c4d; border-radius: 14px;
    padding: clamp(1.25rem, 3vw, 2rem); box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  }
  .ghost { font-size: 2.4rem; line-height: 1; }
  h1 { font-size: clamp(1.5rem, 3.4vw, 2rem); line-height: 1.2; margin: 0.6rem 0 0.35rem; }
  p { margin: 0 0 0.85rem; color: #d2ccdd; }
  .tag {
    display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.78rem;
    font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
    color: #ffb066; border: 1px solid rgba(255, 155, 61, 0.45); background: rgba(255, 155, 61, 0.12);
  }
  h2 { font-size: 1rem; margin: 1.4rem 0 0.5rem; color: #7ef7b5; letter-spacing: 0.02em; }
  ol { margin: 0; padding-left: 1.25rem; color: #e7e2f0; }
  li { margin-bottom: 0.55rem; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em;
    background: rgba(7, 5, 10, 0.7); border: 1px solid #3a2c4d; border-radius: 5px; padding: 0.1rem 0.35rem;
    overflow-wrap: anywhere;
  }
  .links { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 1.4rem; }
  a.btn {
    display: inline-flex; align-items: center; gap: 0.4rem; text-decoration: none;
    padding: 0.6rem 1rem; border-radius: 10px; font-weight: 700; font-size: 0.95rem;
    border: 1px solid #4a3a60; color: #fbf9fe; background: #241a31;
  }
  a.btn--primary { background: #c2182b; border-color: #e0334a; }
  a.btn:hover { filter: brightness(1.15); }
  footer { margin-top: 1.25rem; color: #b0a8c2; font-size: 0.85rem; }
`;

export function apiOnlyPage(options: SetupPageOptions = { serverless: false }): string {
  const environment = options.serverless ? 'Vercel' : 'this host';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BugBanisher — the API is running, the UI is not built</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <div class="card">
    <div class="ghost" aria-hidden="true">👻</div>
    <span class="tag">API only</span>
    <h1>The API is running — the web UI is not deployed here</h1>
    <p>
      This address answered with BugBanisher's API, so the backend is deployed correctly. What is
      missing is the built React app, which is why the root page has nothing to show.
    </p>

    <h2>Fix it on ${environment}</h2>
    <ol>
      <li>
        In the Vercel project: <strong>Settings → General → Root Directory</strong> must be the
        <strong>repository root</strong> (leave it empty), <em>not</em> <code>server</code>. Pointing it at
        <code>server</code> deploys only the API and hides <code>vercel.json</code>.
      </li>
      <li>
        Check that the deployed commit contains <code>vercel.json</code> and <code>api/index.ts</code>.
        If your default branch does not have them yet, deploy the branch that does.
      </li>
      <li>
        <strong>Framework Preset: Vite</strong>, Build Command <code>npm run build -w web</code>,
        Output Directory <code>web/dist</code>. <code>vercel.json</code> already sets these — clear any
        overrides in the dashboard and redeploy.
      </li>
      <li>
        <strong>Node.js Version</strong> should be <strong>22.x</strong>. An older runtime cannot load
        this project's ES modules from the API function, which fails every <code>/api/*</code> route
        with <code>500 FUNCTION_INVOCATION_FAILED</code>.
      </li>
    </ol>

    <h2>The API works right now</h2>
    <p>These endpoints answer on this same address:</p>
    <div class="links">
      <a class="btn btn--primary" href="/api/health">/api/health</a>
      <a class="btn" href="/api/model/status">/api/model/status</a>
      <a class="btn" href="/api/session">/api/session</a>
    </div>

    <footer>
      BugBanisher is read-only until you approve: it never merges and never pushes to a default branch.
    </footer>
  </div>
</main>
</body>
</html>`;
}
