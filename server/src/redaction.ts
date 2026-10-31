/**
 * Secret redaction.
 *
 * Safety rule: BugBanisher must never display, log or commit a secret.
 * Detection is not enough — a finding about a hardcoded key would otherwise
 * quote the key back to the user in its code snippet. We mask the value while
 * keeping the structure of the line, so the finding still makes sense:
 *
 *   const MOON_API_KEY = 'sk-live-…'   →   const MOON_API_KEY = '[redacted]'
 *
 * Diffs are redacted for display only. Patch verification always runs against
 * the real in-memory file content on the server.
 */

const TOKEN_PATTERNS: Array<[RegExp, string]> = [
  [/\bgh[pousr]_[A-Za-z0-9_]{10,}\b/g, '[redacted-github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{10,}\b/g, '[redacted-github-token]'],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted-api-key]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-aws-key]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[redacted-slack-token]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '[redacted-jwt]'],
  [/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, '$1 [redacted] $2'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]'],
];

/** `password = "hunter2"`, `apiKey: 'abc123'`, `TOKEN=abc…` → masked value. */
const ASSIGNMENT_PATTERN =
  /((?:api[_-]?key|access[_-]?key|secret|client[_-]?secret|password|passwd|pwd|token|auth[_-]?token)\s*[:=]\s*)(['"`])([^'"`\n]{4,})\2/gi;

/** `postgres://user:password@host` → password masked. */
const URL_CREDENTIAL_PATTERN = /((?:[a-z][a-z0-9+.-]*):\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi;

export function redactSecrets(input: string): string {
  let text = input;
  for (const [pattern, replacement] of TOKEN_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(ASSIGNMENT_PATTERN, (_match, prefix: string, quote: string) => `${prefix}${quote}[redacted]${quote}`);
  text = text.replace(URL_CREDENTIAL_PATTERN, (_match, prefix: string, _secret: string, at: string) => `${prefix}[redacted]${at}`);
  return text;
}

/** True when redaction actually changed the text (used for UI badges). */
export function containsSecretLikeText(input: string): boolean {
  return redactSecrets(input) !== input;
}
