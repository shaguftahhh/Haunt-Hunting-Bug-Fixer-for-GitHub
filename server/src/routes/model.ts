/**
 * Model status route.
 *
 * The UI uses this to tell people, before they click anything, whether an AI
 * model is actually reachable — and what to run if it is not. Without it, a
 * "Craft fix" click on a model-only bug ends in a vague error.
 */
import { Router } from 'express';
import { asyncHandler } from '../http.js';
import { config } from '../config.js';
import { checkLLMProvider, getLLMProvider } from '../llm/index.js';

export const modelRouter = Router();

modelRouter.get(
  '/model/status',
  asyncHandler(async (_req, res) => {
    const provider = getLLMProvider();

    if (!provider) {
      res.json({
        provider: 'none',
        model: null,
        ok: false,
        detail: 'No model provider is configured (LLM_PROVIDER=none). Static checks still work.',
        setup: [
          'Install Ollama: https://ollama.com',
          `ollama pull ${config.llm.model}`,
          'Set LLM_PROVIDER=ollama in .env and restart the server',
        ],
      });
      return;
    }

    const health = await checkLLMProvider(provider);
    res.json({
      provider: provider.id,
      model: provider.model,
      endpoint: provider.endpoint,
      ok: health.ok,
      detail: health.detail,
      setup: health.ok
        ? []
        : [
            provider.id === 'ollama'
              ? `Start Ollama (ollama serve), then run: ollama pull ${provider.model}`
              : `Start your OpenAI-compatible server at ${provider.endpoint}`,
            'BugBanisher health-checks the endpoint before every scan; no restart is needed',
            'Findings marked "Quick fix" work with no model at all',
          ],
    });
  }),
);
