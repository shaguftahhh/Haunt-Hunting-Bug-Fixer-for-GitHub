/**
 * Ollama provider — local open-weight models.
 *
 * Works with any model you have pulled, e.g.:
 *   ollama pull gemma3:4b
 *   ollama pull llama3.2:3b
 *
 * No API key, no data leaving your machine.
 */
import { config } from '../config.js';
import { LLMError, type ChatMessage, type CompletionOptions, type LLMProvider } from './types.js';

export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly model: string;
  readonly endpoint: string;

  constructor(model = config.llm.model) {
    this.model = model;
    this.endpoint = config.llm.ollamaBaseUrl;
  }

  async complete(messages: ChatMessage[], options: CompletionOptions = {}): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);

    try {
      const res = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          ...(options.json ? { format: 'json' } : {}),
          options: {
            temperature: options.temperature ?? 0.1,
            num_predict: options.maxTokens ?? 1200,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (res.status === 404) {
          throw new LLMError(`Ollama does not have the model "${this.model}".`, `Run: ollama pull ${this.model}`);
        }
        throw new LLMError(`Ollama returned ${res.status}.`, body.slice(0, 200) || 'Is Ollama running?');
      }

      const data = (await res.json()) as { message?: { content?: string } };
      const content = data.message?.content;
      if (!content) throw new LLMError('Ollama returned an empty response.');
      return content;
    } catch (error) {
      if (error instanceof LLMError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new LLMError('The local model took too long to answer.', 'Try a smaller model or raise LLM_TIMEOUT_MS.');
      }
      throw new LLMError(
        'Could not reach Ollama.',
        `Is Ollama running at ${this.endpoint}? Set OLLAMA_BASE_URL if it lives elsewhere.`,
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}
