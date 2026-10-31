/**
 * Central configuration, read once from environment variables.
 *
 * Secrets (PATs, OAuth client secret, API keys) are read here but are NEVER
 * logged and never included in the /api/config response sent to the browser.
 */
import 'dotenv/config';

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

export const config = {
  port: num('PORT', 8787),
  nodeEnv: str('NODE_ENV', 'development'),
  isProduction: str('NODE_ENV') === 'production',

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
    timeoutMs: num('LLM_TIMEOUT_MS', 180_000),
  },

  scan: {
    maxFiles: num('SCAN_MAX_FILES', 25),
    maxFileBytes: num('SCAN_MAX_FILE_BYTES', 60_000),
    llmMaxFiles: num('LLM_MAX_FILES', 6),
    llmMaxFileChars: num('LLM_MAX_FILE_CHARS', 6000),
  },

  safety: {
    /** Hard cap. Intentionally not environment-configurable. */
    approvalCap: 3,
    branchPrefix: 'bugbanisher/',
    defaultBranchForbidden: true,
  },

  /** Absolute path to the prompts/ folder. */
  promptsDir: str('PROMPTS_DIR') || new URL('../../prompts/', import.meta.url).pathname,
  demoDir: new URL('../../demo/', import.meta.url).pathname,
  webDistDir: new URL('../../web/dist/', import.meta.url).pathname,
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
