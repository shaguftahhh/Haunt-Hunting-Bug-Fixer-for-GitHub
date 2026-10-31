/**
 * OpenAI-compatible provider.
 *
 * Points at any server that speaks /v1/chat/completions: vLLM, LM Studio,
 * llama.cpp's server, Ollama's /v1 shim, OpenRouter, Groq, or OpenAI itself.
 * BugBanisher's default configuration uses an open-weight model either way.
 */
import { config } from '../config.js';
import { LLMError, type ChatMessage, type CompletionOptions, type LLMProvider } from './types.js';

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = 'openai';
  readonly model: string;
  readonly endpoint: string;
  private readonly apiKey: string;

  constructor() {
    this.model = config.llm.model;
    this.endpoint = config.llm.openaiBaseUrl;
    this.apiKey = config.llm.openaiApiKey;
  }

  async complete(messages: ChatMessage[], options: CompletionOptions = {}): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);

    try {
      const res = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options.temperature ?? 0.1,
          max_tokens: options.maxTokens ?? 1500,
          ...(options.json && config.llm.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new LLMError(
          `Model endpoint returned ${res.status}.`,
          body.slice(0, 240) || `Check OPENAI_BASE_URL (${this.endpoint}) and the model name.`,
        );
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new LLMError('The model returned an empty response.');
      return content;
    } catch (error) {
      if (error instanceof LLMError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new LLMError('The model took too long to answer.', 'Raise LLM_TIMEOUT_MS or use a smaller model.');
      }
      throw new LLMError(
        'Could not reach the OpenAI-compatible endpoint.',
        `Is ${this.endpoint} running? Set OPENAI_BASE_URL to your server's /v1 URL.`,
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}
