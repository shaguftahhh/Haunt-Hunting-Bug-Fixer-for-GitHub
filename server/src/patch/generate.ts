/**
 * Fix generation pipeline.
 *
 *   1. Pick a strategy: mechanical (safe + deterministic) or model review.
 *   2. Ask for a minimal diff (model) or compute it (mechanical).
 *   3. Verify the diff. If it fails, retry once with the failure as feedback.
 *   4. Fall back to a mechanical fix when the model cannot produce a safe patch.
 *
 * Files that look like they contain credentials are never sent to a model.
 */
import crypto from 'node:crypto';
import type { Finding, FixResult, Mode, RepoSummary } from '../types.js';
import type { JobContext } from '../jobs.js';
import type { FixRecord } from '../types.js';
import { checkLLMProvider, getLLMProvider } from '../llm/index.js';
import { requestFix } from '../llm/fix.js';
import { containsSecretLikeText, redactSecrets } from '../redaction.js';
import { createUnifiedDiff } from './unifiedDiff.js';
import { verifyPatch, type VerifyPatchOutcome } from './verify.js';
import { mechanicalFix, type MechanicalResult } from './mechanical.js';
import { HttpError } from '../http.js';
import { config } from '../config.js';
import { assertSafeBranch, buildPrDraft } from '../pr/draft.js';
import { log } from '../logger.js';

export interface GenerateFixInput {
  scanId: string;
  mode: Mode;
  repo: RepoSummary;
  finding: Finding;
  path: string;
  beforeContent: string;
  fileSha?: string;
  signal?: AbortSignal;
  /** Demo Mode: a pre-recorded response, still verified before use. */
  cachedFix?: {
    summary: string;
    testPlan: string;
    prTitle: string;
    diff: string;
    model: string;
  } | null;
}

export interface GeneratedFix {
  record: FixRecord;
}

const SECRET_RULE_IDS = new Set(['js/hardcoded-secret', 'generic/private-key']);

export async function generateFix(input: GenerateFixInput, ctx: JobContext): Promise<GeneratedFix> {
  const { finding, path, beforeContent } = input;
  const provider = getLLMProvider();
  const fixId = crypto.randomBytes(10).toString('base64url');

  const fileLooksSecret = containsSecretLikeText(beforeContent);
  const ruleIsSecret = finding.ruleId ? SECRET_RULE_IDS.has(finding.ruleId) : false;
  // Demo Mode never calls a model: it replays cached responses instead.
  const allowModel = input.mode === 'github' && provider !== null && !fileLooksSecret && !ruleIsSecret;

  // Health-check the endpoint first: without this, an unreachable Ollama looks
  // like "the model produced a bad patch" and the user waits for a timeout.
  let providerUsable = provider !== null;
  let unreachableDetail = '';
  if (provider && input.mode === 'github' && !fileLooksSecret && !ruleIsSecret) {
    const health = await checkLLMProvider(provider);
    if (!health.ok) {
      providerUsable = false;
      unreachableDetail = health.detail;
    }
  }

  let chosen: VerifyPatchOutcome | null = null;
  let diff = '';
  let summary = '';
  let testPlan = '';
  let prTitle = '';
  let generatedBy: 'llm' | 'mechanical' | 'cached' = 'mechanical';
  let model: string | null = null;
  let lastFailure: string | null = null;

  const mechanical = mechanicalFix(finding, beforeContent);
  const mechanicalOutcome = (candidate: MechanicalResult): VerifyPatchOutcome => {
    const mechanicalDiff = createUnifiedDiff(path, beforeContent, candidate.content);
    return verifyPatch({ path, before: beforeContent, diff: mechanicalDiff, finding });
  };

  // ------------------------------------------------------- cached demo reply
  if (input.mode === 'demo' && input.cachedFix) {
    ctx.step('Replaying the cached patch');
    const candidate = input.cachedFix;
    const outcome = verifyPatch({ path, before: beforeContent, diff: candidate.diff, finding });
    if (outcome.verified) {
      chosen = outcome;
      diff = candidate.diff;
      summary = candidate.summary;
      testPlan = candidate.testPlan;
      prTitle = candidate.prTitle;
      generatedBy = 'cached';
      model = candidate.model;
    } else {
      lastFailure = `The cached patch no longer applies: ${outcome.failure ?? 'verification failed'}`;
      log.warn('Cached demo patch failed verification', { path, failure: lastFailure });
    }
  }

  // ---------------------------------------------------------------- the model
  if (!chosen && allowModel && provider) {
    ctx.step('Drafting a minimal patch');
    for (let attempt = 0; attempt < 2 && !chosen; attempt += 1) {
      try {
        const reply = await requestFix(provider, {
          repoFullName: input.repo.fullName,
          finding,
          fileContent: beforeContent,
          signal: input.signal,
          previousFailure: attempt === 0 ? null : lastFailure,
        });

        if (!reply.diff) {
          lastFailure = reply.summary || 'The model did not return a usable diff.';
          continue;
        }

        const outcome = verifyPatch({ path, before: beforeContent, diff: reply.diff, finding });
        if (outcome.verified) {
          chosen = outcome;
          diff = reply.diff;
          summary = reply.summary;
          testPlan = reply.testPlan;
          prTitle = reply.prTitle;
          generatedBy = 'llm';
          model = provider.model;
        } else {
          lastFailure = outcome.failure ?? 'Verification failed.';
          log.warn('Model patch failed verification', { path, attempt, failure: lastFailure });
        }
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : 'The model call failed.';
        log.warn('Model patch request failed', { path, message: lastFailure });
        break; // endpoint is unreachable; don't waste another timeout
      }
    }
  } else if (provider === null) {
    ctx.step('Drafting a minimal patch (mechanically)');
  }

  // ------------------------------------------------------------ mechanical
  if (!chosen && mechanical) {
    ctx.step('Preparing a deterministic fix');
    const outcome = mechanicalOutcome(mechanical);
    if (outcome.verified) {
      chosen = outcome;
      diff = createUnifiedDiff(path, beforeContent, mechanical.content);
      summary = mechanical.summary;
      testPlan =
        '1. Apply the patch on a branch.\n2. Run the project’s tests (or the affected flow).\n3. Confirm the reported behaviour no longer occurs.';
      prTitle = `fix: ${finding.title}`;
      generatedBy = 'mechanical';
      model = null;
    } else {
      lastFailure = outcome.failure ?? 'The deterministic fix did not verify.';
    }
  }

  if (!chosen || !chosen.after) {
    // Structured failure so the UI can show the right next step instead of a
    // dead end: no model reachable vs. model could not produce a safe patch.
    const blockedBySecret = ruleIsSecret || fileLooksSecret;
    const noModel = !blockedBySecret && (provider === null || !allowModel || !providerUsable);
    const reason = blockedBySecret
      ? 'BugBanisher will not send a credential-bearing file to a model, and this line has no safe automatic rewrite.'
      : noModel
        ? `This bug needs an AI model to draft the patch, and none is reachable right now.${unreachableDetail ? ` (${unreachableDetail})` : ''}`
        : 'The model could not produce a patch that passes verification.';

    throw new HttpError(
      422,
      reason,
      blockedBySecret
        ? 'Remove the credential by hand: move the value to an environment variable, rotate it, and load it at runtime.'
        : noModel
          ? `Start the local model, then press "Check model": ollama serve && ollama pull ${config.llm.model}. Findings marked "Quick fix" never need a model.`
          : 'Try again, or pick a finding marked "Quick fix" — those are fixed deterministically without the model.',
    );
  }

  ctx.step('Preparing the pull request');
  const draft = buildPrDraft({
    repo: input.repo,
    finding,
    fixId,
    summary,
    testPlan,
    model,
    generatedBy,
    diff,
    prTitle,
  });
  assertSafeBranch(draft.branchName, input.repo.defaultBranch);

  const displayedDiff = redactSecrets(diff);
  const diffRedacted = displayedDiff !== diff;

  const fix: FixResult = {
    fixId,
    scanId: input.scanId,
    finding,
    diff: diffRedacted ? displayedDiff : diff,
    summary,
    testPlan,
    branchName: draft.branchName,
    prTitle: draft.prTitle,
    prBody: draft.prBody,
    verification: chosen.checks,
    verified: chosen.verified,
    generatedBy,
    model,
    filesChanged: [path],
    staticFindingsBefore: chosen.staticFindingsBefore,
    staticFindingsAfter: chosen.staticFindingsAfter,
    diffRedacted,
  };

  // The real (unredacted) content is kept server-side for applying the patch.
  const record: FixRecord = {
    fix,
    scanId: input.scanId,
    path,
    beforeContent,
    afterContent: chosen.after,
    fileSha: input.fileSha,
  };

  log.info('Fix generated', {
    fixId,
    path,
    generatedBy,
    model,
    checks: fix.verification.length,
    verified: fix.verified,
  });

  return { record };
}
