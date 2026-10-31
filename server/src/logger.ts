/**
 * Tiny logger with secret redaction.
 *
 * Rule of thumb: log events, repo names and counts — never tokens, auth
 * headers, environment values or file contents. `redact()` is a final safety
 * net, not a license to log secrets.
 */

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bgh[pousr]_[A-Za-z0-9_]{10,}\b/g, '[redacted-github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{10,}\b/g, '[redacted-github-token]'],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted-api-key]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]'],
  [/((?:token|secret|password|api[_-]?key)\s*[:=]\s*)["']?[^\s"',}]+/gi, '$1[redacted]'],
];

export function redact(input: unknown): string {
  let text = typeof input === 'string' ? input : safeStringify(input);
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stamp(): string {
  return new Date().toISOString();
}

export const log = {
  info(message: string, meta?: Record<string, unknown>): void {
    const suffix = meta ? ` ${redact(meta)}` : '';
    console.log(`[${stamp()}] INFO  ${redact(message)}${suffix}`);
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    const suffix = meta ? ` ${redact(meta)}` : '';
    console.warn(`[${stamp()}] WARN  ${redact(message)}${suffix}`);
  },
  error(message: string, meta?: Record<string, unknown>): void {
    const suffix = meta ? ` ${redact(meta)}` : '';
    console.error(`[${stamp()}] ERROR ${redact(message)}${suffix}`);
  },
};

/** Error messages safe to return to the browser (never include secrets). */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return redact(error.message);
  return redact(String(error));
}
