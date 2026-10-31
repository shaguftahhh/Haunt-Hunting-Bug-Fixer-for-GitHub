/**
 * Central configuration, read once from environment variables.
 *
 * Secrets (PATs, OAuth client secret, API keys) are read here but are NEVER
 * logged and never included in the /api/config response sent to the browser.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve a folder that ships with the repo (prompts/, demo/, web/dist/).
 *
 * Order matters for portability:
 *   1. an explicit environment override,
 *   2. relative to the working directory (local dev, `npm start`, and the
 *      serverless bundle, where the repo is copied to the working directory),
 *   3. relative to this module (belt and braces; import.meta is not always
 *      available once a bundler targets CommonJS).
 */
function resolveDir(envValue: string, cwdRelative: string, moduleRelative: string): string {
  if (envValue) return envValue;
  const fromCwd = path.join(process.cwd(), cwdRelative);
  if (fs.existsSync(fromCwd)) return fromCwd.endsWith(path.sep) ? fromCwd : fromCwd + path.sep;
  try {
    return new URL(moduleRelative, import.meta.url).pathname;
  } catch {
    return fromCwd;
  }
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function str(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

const provider = (str('LLM_PROVIDER', 'ollama').toLowerCase() as 'ollama' | 'openai' | 'none');
const validProvider = ['ollama', 'openai', 'none'].includes(provider) ? provider : 'ollama';

/**
 * Serverless (Vercel) mode.
 *
 * Two behaviours change, both because a function instance can vanish between
 * requests:
 *   - scans and fixes run inline and return their result, instead of returning a
 *     job id that a different instance would not know about;
 *   - bundled Demo Mode data is rebuilt from disk on demand instead of relying
 *     on a warm process.
 */
const serverless = process.env.VERCEL === '1' || str('SERVERLESS') === '1';

export const config = {
  port: num('PORT', 8787),
  nodeEnv: str('NODE_ENV', 'development'),
  isProduction: str('NODE_ENV') === 'production',
  serverless,

  // GitHub OAuth app (optional).
  github: {
    clientId: str('GITHUB_CLIENT_ID'),
    clientSecret: str('GITHUB_CLIENT_SECRET'),
    oauthScope: str('GITHUB_OAUTH_SCOPE', 'repo'),
    apiBase: str('GITHUB_API_BASE', 'https://api.github.com'),
  },

  // Pluggable open-weight model provider.
  llm: {
    provider: validProvider as 'ollama' | 'openai' | 'none',
    model: str('LLM_MODEL', 'gemma3:4b'),
    ollamaBaseUrl: str('OLLAMA_BASE_URL', 'http://localhost:11434').replace(/\/$/, ''),
    openaiBaseUrl: str('OPENAI_BASE_URL', 'http://localhost:1234/v1').replace(/\/$/, ''),
    openaiApiKey: str('OPENAI_API_KEY'),
    jsonMode: str('LLM_JSON_MODE', 'true').toLowerCase() !== 'false',
    // Per-file model timeout. A whole scan must never sit on one slow file.
    timeoutMs: num('LLM_TIMEOUT_MS', 30_000),
  },

  scan: {
    // Static rules are cheap: scan the whole repo instead of a sample. Only the
    // model review is bounded (llmMaxFiles) because that is what costs time.
    maxFiles: num('SCAN_MAX_FILES', 80),
    maxFileBytes: num('SCAN_MAX_FILE_BYTES', 120_000),
    llmMaxFiles: num('LLM_MAX_FILES', 6),
    llmMaxFileChars: num('LLM_MAX_FILE_CHARS', 6000),
    /** Total wall-clock budget for the AI review phase of one scan. */
    llmBudgetMs: num('LLM_BUDGET_MS', 45_000),
    /**
     * Hard deadline for a whole scan. Serverless platforms cap a request at
     * ~60s, so the default is shorter there.
     */
    timeoutMs: num('SCAN_TIMEOUT_MS', serverless ? 50_000 : 150_000),
    /** How many files to download in parallel (GitHub allows this easily). */
    fileConcurrency: num('SCAN_FILE_CONCURRENCY', 6),
  },

  safety: {
    /** Hard cap. Intentionally not environment-configurable. */
    approvalCap: 3,
    branchPrefix: 'bugbanisher/',
    defaultBranchForbidden: true,
  },

  /** Absolute path to the prompts/ folder. */
  promptsDir: resolveDir(str('PROMPTS_DIR'), 'prompts', '../../prompts/'),
  demoDir: resolveDir(str('DEMO_DIR'), 'demo', '../../demo/'),
  webDistDir: resolveDir(str('WEB_DIST_DIR'), 'web/dist', '../../web/dist/'),
} as const;

export function oauthAvailable(): boolean {
  return Boolean(config.github.clientId && config.github.clientSecret);
}

/** Safe public projection used by GET /api/config and GET /api/session. */
export function publicRuntimeInfo() {
  return {
    oauthAvailable: oauthAvailable(),
    llm: {
      provider: config.llm.provider,
      model: config.llm.provider === 'none' ? null : config.llm.model,
      jsonMode: config.llm.jsonMode,
    },
    approvalCap: config.safety.approvalCap,
    demoAvailable: true,
  };
}
