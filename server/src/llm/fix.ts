/**
 * Ask the model for a minimal unified diff.
 *
 * The reply is parsed as JSON, validated, and then re-checked by the patch
 * verifier. The model never gets to decide whether its own patch is safe.
 */
import type { Finding } from '../types.js';
import { config } from '../config.js';
import { fillPrompt, loadPrompt, withLineNumbers } from './prompts.js';
import type { LLMProvider } from './types.js';
import { extractJson } from './types.js';
import { validatePatchResponse, type ValidatedPatch } from './validation.js';

export interface FixRequest {
  repoFullName: string;
  finding: Finding;
  fileContent: string;
  signal?: AbortSignal;
  /** Second attempt: tell the model exactly why the first patch failed. */
  previousFailure?: string | null;
}

export async function requestFix(provider: LLMProvider, request: FixRequest): Promise<ValidatedPatch> {
  const { finding, fileContent } = request;
  const template = await loadPrompt('fix');
  const { text } = withLineNumbers(fileContent, config.scan.llmMaxFileChars * 2);

  const basePrompt = fillPrompt(template, {
    file: finding.file,
    line: finding.line,
    severity: finding.severity,
    title: finding.title,
    explanation: finding.explanation,
    fileContent: text,
  });

  const messages = [
    { role: 'user' as const, content: basePrompt },
    ...(request.previousFailure
      ? [
          {
            role: 'user' as const,
            content: `Your previous patch failed verification: ${request.previousFailure}\nReturn ONLY corrected JSON with a diff that applies exactly to the Before content.`,
          },
        ]
      : []),
  ];

  const raw = await provider.complete(messages, {
    json: true,
    temperature: 0,
    maxTokens: 1800,
    signal: request.signal,
  });

  const trimmed = raw.trim();
  let parsed: unknown = null;
  try {
    parsed = extractJson(trimmed);
  } catch {
    // Fallback path in validatePatchResponse can still rescue a bare diff.
    parsed = null;
  }

  return validatePatchResponse(trimmed, parsed);
}
