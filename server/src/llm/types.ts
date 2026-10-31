/**
 * The pluggable model-provider contract.
 *
 * Everything downstream (finding review, patch generation) only knows about
 * this interface, so adding a new backend means adding one file:
 *
 *   OllamaProvider   → any local open-weight model (Gemma, Llama, Qwen, ...)
 *   OpenAIProvider   → any OpenAI-compatible server (vLLM, LM Studio, ...)
 *
 * BugBanisher never ships a hosted-model API key and defaults to a local model.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  /** Ask the server for JSON output when supported. */
  json?: boolean;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LLMProvider {
  /** Short id used in logs and the UI, e.g. "ollama". */
  readonly id: string;
  /** Model name, e.g. "gemma3:4b". */
  readonly model: string;
  /** Human-readable endpoint description (never includes secrets). */
  readonly endpoint: string;
  complete(messages: ChatMessage[], options?: CompletionOptions): Promise<string>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

/** Pull the first JSON object/array out of a model reply, fences included. */
export function extractJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new LLMError('The model did not return valid JSON.', 'Try again, or switch to a stronger model.');
  }
}
