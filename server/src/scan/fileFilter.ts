/**
 * Decides which files are safe to read and analyse.
 *
 * Hard rules:
 *  - Never read anything that looks like a secret (.env, keys, credentials).
 *  - Never read binaries, vendored code or lockfiles.
 *  - Skip generated/minified bundles so findings point at real source.
 *
 * The filter also returns a machine-readable reason, which the UI shows as a
 * "files skipped" breakdown — useful for the learner ("we skipped 3 .env files").
 */

/** Extensions we can reason about. Anything else is skipped as "binary". */
export const CODE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.java',
  '.php',
  '.rs',
  '.c',
  '.h',
  '.cpp',
  '.cs',
  '.sh',
]);

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.java': 'java',
  '.php': 'php',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.sh': 'shell',
};

/** Human-readable list used by empty-state guidance in the UI. */
export const SUPPORTED_EXTENSIONS = [...CODE_EXTENSIONS].join(', ');

export function languageOf(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'text';
  return LANGUAGE_BY_EXT[path.slice(dot).toLowerCase()] ?? 'text';
}

/** Paths that never contain app source. */
const SKIP_PATH_PATTERNS: Array<[RegExp, string]> = [
  [/(^|\/)node_modules\//, 'vendored dependencies'],
  [/(^|\/)(dist|build|out|coverage|\.next|\.nuxt|\.venv|venv|__pycache__|target)\//, 'build output'],
  [/(^|\/)vendor\//, 'vendored dependencies'],
  [/(^|\/)\.git\//, 'git internals'],
  [/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Gemfile\.lock)$/i, 'lockfile'],
  [/\.min\.(js|css)$/i, 'minified bundle'],
  [/\.(map|snap)$/i, 'generated file'],
  [/(^|\/)test(s)?\/fixtures\//i, 'test fixtures'],
  // BugBanisher ships a deliberately buggy sample repo for Demo Mode; when
  // someone scans this project, those planted bugs are not real findings.
  [/(^|\/)demo\/(sample-repo|cache)\//i, 'bundled demo fixture'],
];

/** Names that suggest credentials. We refuse to read these, period. */
const SECRET_PATH_PATTERNS: Array<[RegExp, string]> = [
  [/(^|\/)\.env($|\.)/i, 'env file'],
  [/\.(pem|key|p12|pfx|jks|keystore)$/i, 'key material'],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.|$)/i, 'ssh key'],
  [/(^|\/)secrets?(\/|\.|$)/i, 'secrets path'],
  [/(^|\/)credentials?(\/|\.|$)/i, 'credentials path'],
  [/(^|\/)(\.npmrc|\.netrc|\.pypirc|\.htpasswd)$/i, 'credential file'],
  [/(^|\/)(service-account|serviceaccount)[^/]*\.json$/i, 'service account key'],
];

/**
 * Content that looks like a real secret. If we spot this, the file is skipped
 * and its content is never sent to a model or shown in the UI.
 */
const SECRET_CONTENT_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/, // GitHub token
  /\bsk-[A-Za-z0-9]{32,}\b/, // OpenAI-style key (long, not our fake demo key)
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack token
];

export type SkipReason =
  | 'secret file'
  | 'key material'
  | 'possible secret content'
  | 'binary/unsupported'
  | 'no file extension'
  | 'vendored dependencies'
  | 'build output'
  | 'lockfile'
  | 'minified bundle'
  | 'generated file'
  | 'test fixtures'
  | 'bundled demo fixture'
  | 'git internals'
  | 'credential file'
  | 'env file'
  | 'secrets path'
  | 'credentials path'
  | 'service account key'
  | 'ssh key'
  | 'too large'
  | 'empty file';

export interface FilterDecision {
  keep: boolean;
  reason?: SkipReason;
  language?: string;
  isSecret?: boolean;
}

export function classifyPath(path: string, size = 0, maxBytes = 60_000): FilterDecision {
  const lower = path.toLowerCase();

  for (const [pattern, reason] of SECRET_PATH_PATTERNS) {
    if (pattern.test(path)) return { keep: false, reason: reason as SkipReason, isSecret: true };
  }

  for (const [pattern, reason] of SKIP_PATH_PATTERNS) {
    if (pattern.test(path)) return { keep: false, reason: reason as SkipReason };
  }

  const dot = lower.lastIndexOf('.');
  const slash = lower.lastIndexOf('/');
  if (dot <= slash) return { keep: false, reason: 'no file extension' };
  const ext = lower.slice(dot);
  if (!CODE_EXTENSIONS.has(ext)) return { keep: false, reason: 'binary/unsupported' };

  if (size === 0) return { keep: false, reason: 'empty file' };
  if (size > maxBytes) return { keep: false, reason: 'too large' };

  return { keep: true, language: languageOf(path) };
}

/** Second line of defence: inspect the text before we use it anywhere. */
export function looksLikeSecretContent(content: string): boolean {
  return SECRET_CONTENT_PATTERNS.some((pattern) => pattern.test(content));
}

export function isProbablyBinary(content: string): boolean {
  // A NUL byte in the first 1000 chars is a strong binary signal.
  return content.slice(0, 1000).includes('\u0000');
}
