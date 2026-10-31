/**
 * Ask the open-weight model to review suspicious files.
 *
 * Files arrive pre-filtered (no secrets, no binaries). Each reply is validated
 * against the real file length before any finding is accepted.
 */
import type { Finding, RepoFile } from '../types.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { fillPrompt, loadPrompt, withLineNumbers } from './prompts.js';
import type { LLMProvider } from './types.js';
import { extractJson } from './types.js';
import { validateFindings } from './validation.js';
import { languageOf } from '../scan/fileFilter.js';

export interface LlmReviewResult {
  findings: Finding[];
  filesReviewed: number;
  notes: string[];
  model: string;
  durationMs: number;
}

export async function reviewFilesWithLLM(
  provider: LLMProvider,
  repoFullName: string,
  files: RepoFile[],
  signal?: AbortSignal,
  /** Wall-clock deadline for the whole review phase (ms since epoch). */
  deadline?: number,
): Promise<LlmReviewResult> {
  const started = Date.now();
  const notes: string[] = [];
  const findings: Finding[] = [];
  let filesReviewed = 0;

  const template = await loadPrompt('findings');
  const selected = files.slice(0, config.scan.llmMaxFiles);

  for (const file of selected) {
    if (signal?.aborted) break;

    // Stop cleanly when the review budget is spent: better a partial review
    // with a note than a scan that looks frozen for minutes.
    if (deadline !== undefined && Date.now() >= deadline) {
      notes.push(
        `Model review stopped after the ${Math.round(config.scan.llmBudgetMs / 1000)}s budget (LLM_BUDGET_MS); ${filesReviewed} of ${selected.length} files reviewed.`,
      );
      break;
    }

    const { text, truncated } = withLineNumbers(file.content, config.scan.llmMaxFileChars);
    const lineCount = file.content.split('\n').length;
    const prompt = fillPrompt(template, {
      repo: repoFullName,
      file: file.path,
      language: languageOf(file.path),
      lineCount,
      fileContent: text,
    });

    try {
      const raw = await provider.complete([{ role: 'user', content: prompt }], {
        json: true,
        temperature: 0.1,
        maxTokens: 1400,
        signal,
      });

      const parsed = extractJson(raw);
      const { findings: valid, rejected } = validateFindings(parsed, lineCount);
      filesReviewed += 1;

      if (rejected > 0) {
        log.warn('Dropped invalid model findings', { file: file.path, rejected });
      }

      for (const [index, item] of valid.entries()) {
        findings.push({
          id: `llm-${file.path}-${item.line}-${index}`,
          source: 'llm',
          file: file.path,
          line: item.line,
          endLine: item.endLine,
          severity: item.severity,
          confidence: item.confidence,
          title: item.title,
          explanation: item.explanation,
          whyItMatters: item.whyItMatters,
          ruleId: `llm/${item.category}`,
        });
      }

      if (truncated) notes.push(`${file.path} was truncated before review (large file).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notes.push(`Model review stopped at ${file.path}: ${message}`);
      log.warn('Model review failed', { file: file.path, message });
      break; // do not burn the timeout once per file
    }
  }

  return {
    findings,
    filesReviewed,
    notes,
    model: provider.model,
    durationMs: Date.now() - started,
  };
}
