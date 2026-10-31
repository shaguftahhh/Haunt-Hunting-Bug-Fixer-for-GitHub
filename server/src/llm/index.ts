/**
 * Provider factory. One place decides which open-weight model we talk to.
 *
 *   LLM_PROVIDER=ollama  → local Ollama (default, Gemma/Llama)
 *   LLM_PROVIDER=openai  → any OpenAI-compatible endpoint
 *   LLM_PROVIDER=none    → static checks only (no model calls)
 */
import { config } from '../config.js';
import { log } from '../logger.js';
import { OllamaProvider } from './ollama.js';
import { OpenAICompatibleProvider } from './openai.js';
import type { LLMProvider } from './types.js';

let cached: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider | null {
  if (config.llm.provider === 'none') return null;
  if (cached) return cached;

  cached =
    config.llm.provider === 'ollama'
      ? new OllamaProvider()
      : new OpenAICompatibleProvider();

  log.info('Model provider ready', { provider: cached.id, model: cached.model, endpoint: cached.endpoint });
  return cached;
}

export type { LLMProvider };

/**
 * Fast reachability check so a scan never waits 3 minutes on a dead endpoint.
 * Ollama: GET /api/tags, and we also check the configured model is pulled.
 * OpenAI-compatible: GET /models (any HTTP answer means the server is up).
 */
export async function checkLLMProvider(provider: LLMProvider): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_500);
  try {
    if (provider.id === 'ollama') {
      const res = await fetch(`${config.llm.ollamaBaseUrl}/api/tags`, { signal: controller.signal });
      if (!res.ok) return { ok: false, detail: `Ollama answered ${res.status}.` };
      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      const names = (data.models ?? []).map((model) => model.name ?? '');
      const wanted = provider.model;
      const present = names.some((name) => name === wanted || name.startsWith(`${wanted}:`) || name.split(':')[0] === wanted.split(':')[0]);
      return present
        ? { ok: true, detail: `Ollama is reachable and ${wanted} is available.` }
        : { ok: false, detail: `Ollama is running but "${wanted}" is not pulled (run: ollama pull ${wanted}).` };
    }

    const res = await fetch(`${config.llm.openaiBaseUrl}/models`, {
      signal: controller.signal,
      headers: config.llm.openaiApiKey ? { Authorization: `Bearer ${config.llm.openaiApiKey}` } : {},
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, detail: 'The OpenAI-compatible endpoint rejected the API key.' };
    }
    return { ok: true, detail: `Endpoint answered ${res.status}; model "${provider.model}" will be used.` };
  } catch {
    return { ok: false, detail: `No model server answered at ${provider.endpoint}.` };
  } finally {
    clearTimeout(timer);
  }
}
