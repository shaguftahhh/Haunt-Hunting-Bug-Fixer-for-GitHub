# prompts/

Every model prompt lives here as Markdown so it can be reviewed, diffed and
improved without touching application code.

| File           | Used by                 | Returns                                                |
| -------------- | ----------------------- | ------------------------------------------------------ |
| `findings.md`  | `server/src/llm/findings.ts` | Strict JSON: `{ findings: [...] }`                |
| `fix.md`       | `server/src/llm/fix.ts`      | Strict JSON: `{ summary, testPlan, prTitle, diff }` |

## Conventions

- `{{placeholders}}` are replaced by `server/src/llm/prompts.ts`. Unknown
  placeholders are left untouched.
- Prompts ask for **JSON only**; the server validates every field before use and
  rejects anything that does not match (see `validation.ts`).
- Never add instructions that could leak secrets, and never include tokens in a
  prompt. File contents that look like secrets are filtered out before the model
  is called (`scan/fileFilter.ts`).
- Changing a prompt changes model behaviour: update the demo cache in
  `demo/cache/` only if the cached responses are still representative.
