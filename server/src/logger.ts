/**
 * Tiny logger with secret redaction.
 *
 * Rule of thumb: log events, repo names and counts — never tokens, auth
 * headers, environment values or file contents. `redact()` is a final safety
 * net, not a license to log secrets.
 */

import { redactSecrets } from './redaction.js';

const ENV_ASSIGNMENT = /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*)\S+/g;

export function redact(input: unknown): string {
  const text = typeof input === 'string' ? input : safeStringify(input);
  return redactSecrets(text).replace(ENV_ASSIGNMENT, '$1[redacted]');
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
