# 👻 BugBanisher

> **Banish bugs. Keep the humans in charge.**
> A spooky, beginner-friendly "AI for open source" tool that finds bugs in **one** of your GitHub
> repositories, explains each one in plain English, drafts a minimal verified fix, and opens a pull
> request **only after you approve it**.

Built with React + TypeScript on the front, Node.js + TypeScript on the back, and **open-weight
models** (Gemma or Llama) through a pluggable provider layer. Dry-run is on by default. Nothing is
ever merged automatically.

---

## Why it exists

Open-source maintainers are drowning in small, boring, high-value bugs. Beginners want to help but
do not always know where to start. BugBanisher sits between them: it finds a concrete bug, explains
*why* it is a bug and *why it matters*, writes the smallest possible patch, proves the patch applies
and parses, and leaves the final decision to a person.

It is deliberately narrow:

- **one repository at a time**, only one you own;
- **one bug at a time**, reviewed by you;
- **three pull requests per session**, maximum;
- **zero auto-merges**, ever.

---

## The flow

1. **Connect GitHub** with a fine-grained personal access token (recommended) or an OAuth app.
   The exact permissions used are listed in the UI: *Contents: read/write*, *Pull requests:
   read/write*. Nothing else.
2. **Pick a repository.** Only repositories you own (or explicitly included in your fine-grained
   token) are listed. There is no free-text repo field.
3. **Scan.** The server reads the repo through the GitHub API, filters out secrets and binaries, runs
   static checks and safe syntax parsers, reads open issues labelled `bug`, and asks the local model
   to review the most suspicious files.
4. **Bug Board.** Each finding is a card: file and line, severity, confidence, a plain-English
   explanation, a "why it matters" note for learners, and the haunted line in context.
5. **Fix.** For one finding, the model (or a deterministic rule fix) produces a minimal unified diff.
   The server proves it **applies byte-for-byte**, **parses**, **removes the flagged finding**, and
   **adds no new high-severity issue** before the diff is shown side-by-side.
6. **Approve.** A confirmation dialog shows the branch name, PR title and the full PR body. Only the
   explicit **Open Pull Request** click creates a branch + commit + PR. The PR is labelled
   `ai-assisted` (best effort, see [limitations](#honest-limitations)) and is **never merged**.
7. **History.** Every approval this session is listed with a link.

---

## Quick start

Requirements: **Node.js 20+** and npm. Optional: [Ollama](https://ollama.com) for local model review.

```bash
git clone https://github.com/shaguftahhh/Haunt-Hunting-Bug-Fixer-for-GitHub.git
cd Haunt-Hunting-Bug-Fixer-for-GitHub
npm install
cp .env.example .env        # the defaults already work for Demo Mode

npm run dev                 # API on :8787, web app on :5173
```

Open **http://localhost:5173**.

The two dev servers run together (`concurrently`). Vite proxies `/api` to the Express server, so the
browser only ever talks to one origin and never sees a GitHub token.

### Production-style run

```bash
npm run build     # builds web/dist and server/dist
npm start         # one Express process serves the API and the built UI on :8787
```

---

## Demo Mode (the 3-minute live demo)

Demo Mode needs **no GitHub account, no model and no internet**. It loads a bundled sample repository
with **four deliberately planted bugs** and **cached model responses** that were recorded from a local
Gemma run and checked by hand.

1. Open http://localhost:5173 and click **👻 Demo Mode** in the header (or *Explore Demo Mode* on the
   connect card).
2. You land on the Bug Board: four high/medium findings plus a bundled open issue (#42) that explains
   the user-visible symptom.
3. Click **Craft fix** on *“Loop reads one item past the end of the orders array”*. Watch the patch
   verification checklist pass, then inspect the side-by-side diff.
4. Click **Review & approve** → the confirmation dialog shows the branch, title and PR body. Dry-run
   is forced ON in Demo Mode, so the button says **Simulate approval**.
5. Back on the board, the card is marked **✦ banished**. Repeat for the XSS and JSON fixes; the fourth
   approval is refused by the session cap so you can show the safety rail live.
6. Open **History** in the header to see the simulated approvals.

The credential bug is fixed **mechanically** (no model), and the secret value is masked in the diff —
a good moment to explain the redaction rules.

---

## Connecting a real GitHub repository

### Option A — fine-grained personal access token (recommended)

1. Go to <https://github.com/settings/personal-access-tokens/new>.
2. **Repository access → Only select repositories** → pick the single repo you want to work on.
3. **Permissions → Repository permissions:**
   - **Contents: Read and write** (read code, write one branch/commit on approval)
   - **Pull requests: Read and write** (open the PR)
   - *Metadata: Read-only* is added automatically by GitHub.
4. Set a short expiry (7 days is plenty), generate, paste the token into BugBanisher.

BugBanisher validates the token against GitHub, keeps it **in server memory only** (never disk, never
`localStorage`, never logs), and forgets it when the server restarts or you click *Disconnect*.

> Adding the `ai-assisted` label needs **Issues: Read and write**. BugBanisher deliberately does *not*
> ask for it: it tries to add the label, and if GitHub refuses, the PR body still carries the full
> AI-assistance disclosure.

### Option B — OAuth app (optional)

1. Create an OAuth app at <https://github.com/settings/developers>.
2. Authorization callback URL: `http://localhost:8787/api/auth/github/callback` (or your deployed URL).
3. Put `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `.env`, restart the server.
4. The **OAuth app** tab becomes available on the connect screen.

OAuth's `repo` scope grants all repos the account can see, which is why the token method is the
default recommendation.

---

## Choosing the model (open weights by default)

The provider layer lives in `server/src/llm/`. Prompts live in `prompts/`.

### Local Ollama (default)

```bash
ollama pull gemma3:4b          # or: llama3.2:3b, qwen2.5-coder:7b, …
# .env
LLM_PROVIDER=ollama
LLM_MODEL=gemma3:4b
OLLAMA_BASE_URL=http://localhost:11434
```

A 4B–7B model is a good balance for a laptop. Larger models produce noticeably better diffs.

### Any OpenAI-compatible endpoint

Works with vLLM, LM Studio, llama.cpp's server, Ollama's `/v1` shim, OpenRouter, Groq, or OpenAI.

```bash
# .env
LLM_PROVIDER=openai
LLM_MODEL=gemma3:4b
OPENAI_BASE_URL=http://localhost:1234/v1
OPENAI_API_KEY=                # only if your endpoint needs one
LLM_JSON_MODE=true             # set false if the server rejects response_format
```

### No model at all

```bash
LLM_PROVIDER=none
```

Static rules, syntax checks, issue reading and deterministic mechanical fixes still work. BugBanisher
reports that model review was skipped — it never fakes it.

A fast health check (3.5s) runs before model review, so a stopped Ollama will not stall a scan.

---

## Environment variables

Copy `.env.example` to `.env`. Real values must never be committed; `.env*` is git-ignored.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API (and production UI) port. |
| `NODE_ENV` | `development` | `production` enables secure cookies. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | empty | Optional OAuth app. Leave blank to use PATs only. |
| `GITHUB_OAUTH_SCOPE` | `repo` | OAuth scope. |
| `LLM_PROVIDER` | `ollama` | `ollama`, `openai`, or `none`. |
| `LLM_MODEL` | `gemma3:4b` | Any open-weight model available on your endpoint. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Local Ollama. |
| `OPENAI_BASE_URL` | `http://localhost:1234/v1` | OpenAI-compatible base URL. |
| `OPENAI_API_KEY` | empty | Sent as a Bearer token; never logged. |
| `LLM_JSON_MODE` | `true` | Request JSON output. |
| `LLM_TIMEOUT_MS` | `120000` | Per-call model timeout. |
| `SCAN_MAX_FILES` | `25` | Max files fetched per scan. |
| `SCAN_MAX_FILE_BYTES` | `60000` | Per-file size limit. |
| `LLM_MAX_FILES` | `6` | Files sent to the model per scan. |
| `LLM_MAX_FILE_CHARS` | `6000` | Prompt budget per file. |

The **3 PRs per session** cap is intentionally *not* configurable.

---

## Safety model

BugBanisher is designed so that the scariest action — writing to your repository — needs a human
click and can be rehearsed first.

| Rule | Where it is enforced |
| --- | --- |
| **Dry-run ON by default** | Every new session starts with `dryRun: true` (`server/src/session.ts`). Approvals in dry-run return a simulated record and never call a GitHub write endpoint. |
| **Hard cap of 3 approvals per session** | `server/src/routes/approve.ts` checks `session.approvals` before anything is written. Dry-run approvals count too, so the cap cannot be rehearsed away. Not environment-configurable. |
| **No auto-merge** | There is no merge code anywhere in the repository. The only write endpoints used are create-ref, create-commit, create-PR and an optional label add. |
| **Never push to the default branch** | Branch names must start with `bugbanisher/`; `assertSafeBranch()` rejects the default branch, and the PR is opened against it. |
| **Only repos you own** | Repo list uses `affiliation=owner`, and the scan route re-lists owned repos and re-checks `repo.owner === login`. |
| **Secrets are never read or shown** | `.env`, `*.pem`, keys, credential files and secret-looking content are filtered before reading; findings, snippets, diffs and logs run through `redactSecrets()`. Secret-bearing files are never sent to a model. |
| **Token stays server-side** | In-memory session, httpOnly cookie, never logged, never returned by any endpoint. |
| **Untrusted model output** | Every finding and diff is validated. Diffs must apply byte-for-byte, parse, and remove the flagged finding before the UI shows them. |
| **No untrusted code execution** | Repository scripts, ESLint configs and plugins are never executed or installed. Only safe parsers run (TypeScript compiler API, Python `ast`, optional `ruff`). |

See [SECURITY notes](#privacy--security) below for the session model.

---

## What the scanner actually checks

Because BugBanisher reads repositories through the GitHub API (it does not clone and run your
`npm install`), it combines:

- **~25 built-in rules** (`server/src/scan/staticRules.ts`) covering classics: off-by-one loops, loose
  equality, `innerHTML`/XSS, `eval`, command injection, hardcoded credentials, unguarded `JSON.parse`,
  empty catches, `parseInt` without radix, Python bare `except`, `shell=True`, SQL f-strings, mutable
  default arguments, `pickle.loads`, `os.system`, `== None`, and committed private keys. Each rule
  ships a learner-friendly "why it matters".
- **Real syntax checks** with the TypeScript compiler API and Python's `ast` module (parse errors are
  high-confidence findings).
- **`ruff`** when its binary is installed, fed each Python file through stdin.
- **Linter detection** for ESLint, Prettier, Biome, mypy, pytest, `go vet` and `tsc`, shown in the scan
  summary. ESLint is detected but **not executed**, because its config and plugins are JavaScript and
  running a stranger's code to review it would be a security hole. This is documented in the UI too.
- **Open issues labelled `bug`** (up to 10), shown as findings that link to the issue. They cannot be
  auto-patched because they do not point at a file.
- **Model review** of up to 6 suspicious files, using the strict JSON schema in
  `prompts/findings.md`. Findings near a static hit are merged into "static + AI" with a confidence
  boost.

### Verification checklist (shown before you see a diff)

1. Target is a normal source file (never a secret file).
2. The diff touches exactly one file.
3. The change is small (`≤ 40` changed lines by default).
4. The diff touches the reported line.
5. The patch **applies cleanly** to the exact current file content.
6. No new credential-like content.
7. The patched file **parses**.
8. The rule no longer fires at that line.
9. No new high-severity rule hit is introduced.
10. Credential values are masked in the displayed diff (if any).

If a model patch fails verification, BugBanisher retries once **with the failure as feedback**, then
falls back to a deterministic mechanical fix if one exists. If nothing verifies, it shows an error
instead of a patch.

---

## Architecture

```
bugbanisher/
├── prompts/                 # model prompts, reviewed like code
│   ├── findings.md          #   strict JSON findings
│   ├── fix.md               #   strict JSON + unified diff
│   └── README.md
├── demo/
│   ├── sample-repo/         # bundled repo with 4 planted bugs
│   └── cache/               # cached model findings, fixes and bug issue
├── server/
│   └── src/
│       ├── index.ts         # express app, security headers, static UI
│       ├── config.ts        # env parsing (secrets never logged)
│       ├── session.ts       # in-memory sessions, dry-run default, approval cap
│       ├── jobs.ts          # background scan/fix jobs + progress
│       ├── logger.ts        # redacting logger
│       ├── redaction.ts     # secret masking for text, snippets and diffs
│       ├── github/client.ts # the only GitHub REST surface
│       ├── llm/             # provider interface, Ollama, OpenAI-compatible, validation
│       ├── scan/            # file filter, static rules, linters, engine
│       ├── patch/           # unified diff, verification, mechanical fixes, generation
│       ├── pr/draft.ts      # branch names + PR body
│       ├── demo/loader.ts   # offline demo bundle
│       └── routes/          # auth, settings, scan, fix, approve, demo
├── web/
│   └── src/
│       ├── App.tsx          # view state machine
│       ├── api.ts           # typed fetch client (same-origin)
│       ├── components/      # Header, Ghost, Bats, ConnectPanel, RepoPicker,
│       │                    # ScanPanel, BugBoard, FixPanel, DiffViewer,
│       │                    # ApproveModal, HistoryPanel
│       └── styles/          # spooky theme + component styles
└── scripts/                 # dev utilities (demo cache, sample scan, live check)
```

### API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness, provider name (no secrets). |
| `GET` | `/api/session` | Connection, dry-run, approvals, history. |
| `POST` | `/api/auth/pat` | Validate a token and store it in memory. |
| `GET` | `/api/auth/github/start` | OAuth redirect (if configured). |
| `GET` | `/api/repos` | Repos the user owns. |
| `POST` | `/api/scan` | Start a read-only scan job. |
| `GET` | `/api/scan/:jobId` | Job progress + result. |
| `POST` | `/api/fix` | Generate + verify a patch job. |
| `GET` | `/api/fix/:jobId` | Patch job progress + result. |
| `POST` | `/api/approve` | The only write path (requires `confirm: true`). |
| `GET` | `/api/history` | Approvals this session. |
| `GET` | `/api/demo` | Bundled sample scan (offline). |

---

## Testing

```bash
npm test                 # 34 tests: scanner, diff engine, verification, demo, UI render
npm run typecheck        # strict TypeScript for server and web
npm run build            # production build of both workspaces

# Scan the bundled sample repo from the CLI (no server needed):
npm run scan:sample

# End-to-end Demo Mode check against a running server (no GitHub, no model):
node scripts/demo-check.mjs

# End-to-end read-only check against a real repo, using the gh CLI token:
node scripts/live-check.mjs <your-login>/<your-repo>

# Rebuild the demo cache after editing the sample repo:
npm run demo:cache
```

Tests cover the security promises too: secret values never appear in findings or diffs, `<= .length`
is flagged at the right line, bad diffs are rejected rather than guessed, patches that break syntax
are refused, and the demo's cached patches pass the same verifier as real ones.

---

## Honest limitations

- **Static rules are heuristics.** They can produce false positives, and the UI says so. Read the code.
- **Models can be wrong.** Every patch is verified for *applicability and syntax*, not for *semantic
  correctness*. That is why the human approval step exists and why nothing is auto-merged.
- **No repository install or test execution.** BugBanisher never runs `npm install` or your tests on
  the server: that would execute untrusted code. Instead it suggests a test plan and runs safe parsers.
- **The `ai-assisted` label needs Issues permission.** With the recommended minimal token it usually
  cannot be added; the PR body always contains the disclosure.
- **In-memory sessions.** Restarting the server forgets tokens, scans and patches (by design). A
  session lives for 12 hours of inactivity.
- **Caps are per browser session.** Disconnecting and reconnecting starts a new session; the cap is a
  guardrail against automation, not a billing meter.
- **Large repos are sampled.** Up to 25 files are scanned, up to 6 go to the model.

---

## Privacy & security

- The GitHub token is stored in a server-side `Map` keyed by a random httpOnly session cookie. It is
  never written to disk, never logged, and never sent to the browser.
- All model calls happen server-side. Files are filtered (no `.env`, no keys, no binaries) and
  redacted before they are used in snippets or displayed diffs.
- Logs pass through `redact()`; GitHub error messages are returned without headers.
- Cookies are `httpOnly`, `SameSite=Lax`, and `Secure` in production. State-changing requests reject
  a mismatched `Origin` header.
- No analytics, no telemetry, no third-party scripts or fonts.

If you find a security issue, please open a private report rather than a public issue.

---

## AI tools used

- **Built with [Arena AI](https://arena.ai) Agent Mode.** Arena's coding agent scaffolded the project,
  wrote the code, tests and documentation, and ran the build/test loop. A human reviewed the result.
- **Runtime model:** an **open-weight model** — Gemma or Llama by default, served locally through
  Ollama (or any OpenAI-compatible endpoint). BugBanisher ships **no hosted-model API keys** and works
  fully offline with `LLM_PROVIDER=none`.
- **Demo cache:** `demo/cache/*.json` contains model-style findings and patches recorded from a local
  `gemma3:4b` run and checked by hand. They are replayed offline and still pass the production patch
  verifier at load time.
- **Prompts:** all model instructions live in [`prompts/`](prompts) so they can be reviewed and
  improved like code.
- No proprietary model generated code at runtime; the tool is a harness around open-weight models.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Small, focused pull requests with tests are very welcome —
especially new static rules (with a "why it matters" note) and provider adapters.

## License

[MIT](LICENSE). The bundled sample repo is fictional; its "API key" is fake.
