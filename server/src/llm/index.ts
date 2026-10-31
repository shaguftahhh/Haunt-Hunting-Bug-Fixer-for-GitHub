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
