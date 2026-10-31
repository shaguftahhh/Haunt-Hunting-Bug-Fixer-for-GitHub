# Contributing to BugBanisher 👻

Thanks for wanting to make the haunted house nicer. This project is intentionally small and readable:
every file should be explainable by any teammate in a few sentences. Please keep it that way.

By participating you agree to be kind, patient and constructive. Beginners are explicitly welcome —
"why does this work?" questions are useful bug reports about our documentation.

---

## 1. Set up

```bash
npm install
cp .env.example .env
npm run dev          # API :8787 + Vite :5173
```

Optional for model work:

```bash
ollama pull gemma3:4b
```

Required for understanding a change: read `README.md` → *Architecture* and *Safety model* first.

---

## 2. Before you start

- **Open an issue** for anything non-trivial (new rule, provider, UI change). It saves you rework.
- **Never commit a real token, key or `.env` file.** `.env*` is git-ignored; use `.env.example` for
  documented defaults only.
- **BugBanisher's safety promises are not negotiable.** A PR that adds an automatic write, auto-merge,
  a way around the 3-PR cap, or that logs/returns a token will be closed.

The invariants you must preserve:

1. Dry-run is ON for new sessions.
2. At most 3 approvals per session, checked server-side.
3. No auto-merge, ever. No writes to the default branch.
4. Only repositories the signed-in user owns are scanned.
5. Secrets are never read, logged, displayed, prompted or committed.
6. Nothing is written to GitHub without `confirm: true` from the approval dialog.
7. Model output is always validated before it is used.
8. Session continuity must survive blocked cookies: the cookie is primary, but the
   `X-BB-Session` header fallback must keep working (see `server/test/session.test.ts`).

---

## 3. Project layout

| Folder | What lives there |
| --- | --- |
| `server/src/routes/` | Express handlers. `approve.ts` is the only write path. |
| `server/src/scan/` | File filter, static rules, safe syntax checks, scan engine. |
| `server/src/patch/` | Unified diff, verification, mechanical fixes, generation. |
| `server/src/llm/` | Provider interface + Ollama/OpenAI-compatible adapters + validation. |
| `server/src/github/` | Every GitHub REST call lives in one file. |
| `prompts/` | Model prompts as Markdown, with `{{placeholders}}`. |
| `demo/` | Sample repo with four planted bugs and cached responses. |
| `web/src/components/` | One component per responsibility, heavily commented. |
| `scripts/` | Developer utilities (not shipped in the app). |

---

## 4. Add a static rule

1. Add a `Rule` in `server/src/scan/staticRules.ts`:

```ts
{
  id: 'js/await-missing',
  title: 'Promise used without await',
  severity: 'medium',
  confidence: 60,
  pattern: 'some-regex',
  languages: ['javascript', 'typescript'],
  explanation: 'Plain English: what is wrong, referencing the actual code.',
  whyItMatters: 'Why a beginner should care and what breaks in production.',
}
```

2. Rules must be **dependency-free**, safe to run in-process, and must not include secrets in titles or
   explanations. `maxPerFile` defaults to 1 — raise it only if the pattern is rare.
3. Add a test in `server/test/scan.test.ts` with a small before/after example, including the expected
   line number.
4. Run `npm test`.

A rule is only useful if a beginner understands it: write `explanation` and `whyItMatters` for a
person who has never seen the bug before.

---

## 5. Add a model provider

1. Implement the `LLMProvider` interface in `server/src/llm/` (`id`, `model`, `endpoint`,
   `complete()`).
2. Handle errors with `LLMError` and give actionable hints. **Never include the API key**, request
   headers or file contents in an error message.
3. Add the provider to `getLLMProvider()` and `checkLLMProvider()` in `server/src/llm/index.ts`.
4. Document the environment variables in `.env.example` and `README.md`.
5. Test the JSON validation path — a provider that returns prose instead of JSON must produce a clear
   error, not a crash.

Providers must default to **open-weight models**. Do not add a provider that requires shipping a
hosted API key with the app.

---

## 6. Change a prompt

Prompts are code:

1. Edit `prompts/findings.md` or `prompts/fix.md`.
2. Keep the output schema and the "JSON only, no fences" instruction.
3. If the model output shape changes, update `server/src/llm/validation.ts` and its tests.
4. Regenerate the demo cache if cached wording would no longer be representative:

```bash
npm run demo:cache
```

5. Never ask a model to reveal, repeat or store secrets.

---

## 7. Tests and checks

```bash
npm test               # server tests (scanner, diff engine, verification, demo)
npm run typecheck      # strict TS for server + web
npm run build          # production build
npm run scan:sample    # scan the offline sample repo from the CLI
```

If you change the diff engine or the verifier, add a test for the failure case — bad patches must be
**rejected**, never guessed at.

If you change UI text, check the accessibility basics:

- every interactive element is reachable by keyboard and has a visible focus ring;
- colour is never the only signal (severity also has a word; diff lines have +/− and screen-reader text);
- new motion is disabled under `prefers-reduced-motion`;
- no `aria-label` that duplicates visible text unnecessarily.

---

## 8. Commits and pull requests

Small, meaningful commits. A good message says what changed and why:

```
fix(scan): cap JSON.parse rule at two hits per file

The rule fired on every parse in large handlers and buried real findings.
Two hits per file keeps the board readable without hiding the pattern.
```

PRs should include:

- what changed and why;
- how you tested it (commands and, for UI, which screen/states);
- a note if a safety invariant is touched (`approve`, `session`, `redaction`, `github/client`);
- screenshots or a short recording for visual changes, if you can.

Keep PRs focused: one concern per PR. Reviewers are volunteers; a 300-line PR with a clear intent is
much easier than a 2,000-line one.

---

## 9. Reporting bugs and security issues

- Functional bugs: open an issue with reproduction steps, expected vs actual, and the scan notes from
  the Bug Board (they contain no secrets).
- Security problems (token leakage, patch escape, verification bypass): **do not open a public issue**.
  Contact the maintainer privately so a fix can land first.

---

## 10. Code style

- TypeScript strict mode; no `any` unless you explain why in a comment.
- Comments explain *why*, not *what*. File headers should tell a newcomer what the file is for.
- Prefer dependency-free solutions in the scan/patch core. Every dependency is a security surface.
- Keep the UI theme tokens in `web/src/styles/theme.css`; do not hard-code colours in components.

Happy hunting. 🕯️
