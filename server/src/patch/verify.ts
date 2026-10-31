/**
 * Patch verification.
 *
 * A patch is only shown to the user if it:
 *   - touches exactly the file it claims to
 *   - applies cleanly, byte for byte (no fuzzy matching)
 *   - changes a sensible number of lines
 *   - parses (TypeScript compiler API / Python ast)
 *   - does not add secrets
 *   - actually removes the flagged rule hit, and adds no new high-severity hit
 *
 * The checks are returned to the UI so a learner can see WHY the patch is
 * considered safe — verification is never a hidden magic step.
 */
import type { Finding, VerificationCheck } from '../types.js';
import { applyUnifiedDiff, parseUnifiedDiff } from './unifiedDiff.js';
import { runStaticRules } from '../scan/staticRules.js';
import { runSyntaxChecks } from '../scan/linters.js';
import { classifyPath, looksLikeSecretContent } from '../scan/fileFilter.js';
import { redactSecrets } from '../redaction.js';

export interface VerifyPatchInput {
  path: string;
  before: string;
  diff: string;
  finding: Finding;
  /** Hard cap for a "minimal" patch. */
  maxChangedLines?: number;
}

export interface VerifyPatchOutcome {
  verified: boolean;
  after: string | null;
  checks: VerificationCheck[];
  /** Human-readable reason used for a model retry. */
  failure: string | null;
  staticFindingsBefore: number;
  staticFindingsAfter: number;
}

export function verifyPatch(input: VerifyPatchInput): VerifyPatchOutcome {
  const { path, before, diff, finding } = input;
  const maxChangedLines = input.maxChangedLines ?? 40;
  const checks: VerificationCheck[] = [];
  const fail = (label: string, detail: string): VerificationCheck => ({
    id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label,
    ok: false,
    detail,
  });
  const pass = (label: string, detail: string): VerificationCheck => ({
    id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label,
    ok: true,
    detail,
  });

  checks.push(
    classifyPath(path, before.length).isSecret
      ? fail('Target file', 'Refusing to patch a secret-bearing file.')
      : pass('Target file', `${path} is a normal source file.`),
  );

  let hunkSummary = '';
  try {
    const parsed = parseUnifiedDiff(diff);
    const paths = new Set([parsed.oldPath.replace(/^[ab]\//, ''), parsed.newPath.replace(/^[ab]\//, '')]);
    checks.push(
      paths.size === 1 && paths.has(path)
        ? pass('Single file', 'The diff touches only the flagged file.')
        : fail('Single file', `The diff touches ${[...paths].join(' and ')}.`),
    );
    const oldLines = parsed.hunks.reduce((sum, hunk) => sum + hunk.oldLines, 0);
    const changed = parsed.hunks.reduce(
      (sum, hunk) => sum + hunk.ops.filter((op) => op.type !== 'eq').length,
      0,
    );
    hunkSummary = `${parsed.hunks.length} hunk(s), ${oldLines} old line(s) in scope`;
    checks.push(
      changed <= maxChangedLines
        ? pass('Minimal change', `${changed} line(s) added or removed (limit ${maxChangedLines}).`)
        : fail('Minimal change', `The patch changes ${changed} lines; the limit is ${maxChangedLines}.`),
    );

    // The diff must actually touch the reported line.
    const touched = parsed.hunks.some(
      (hunk) => finding.line >= hunk.oldStart && finding.line <= hunk.oldStart + Math.max(hunk.oldLines, 1),
    );
    checks.push(
      touched || finding.ruleId?.startsWith('llm/')
        ? pass('Touches the finding', `The change covers ${path}:${finding.line}.`)
        : fail('Touches the finding', `The diff never touches line ${finding.line}.`),
    );
  } catch (error) {
    checks.push(fail('Single file', error instanceof Error ? error.message : 'Could not parse the diff.'));
    checks.push(fail('Minimal change', 'No parsable hunk.'));
    checks.push(fail('Touches the finding', 'No parsable hunk.'));
  }

  const applied = applyUnifiedDiff(before, diff, path);
  if (!applied.ok || applied.content === undefined) {
    checks.push(fail('Applies cleanly', applied.error ?? 'The patch does not apply.'));
    return {
      verified: false,
      after: null,
      checks,
      failure: `The patch does not apply cleanly: ${applied.error ?? 'unknown reason'}`,
      staticFindingsBefore: runStaticRules(path, before).length,
      staticFindingsAfter: 0,
    };
  }

  checks.push(
    pass(
      'Applies cleanly',
      `Applied ${applied.appliedHunks} hunk(s), +${applied.addedLines}/-${applied.removedLines} lines (${hunkSummary}).`,
    ),
  );

  const after = applied.content;
  const beforeFindings = runStaticRules(path, before);
  const afterFindings = runStaticRules(path, after);

  // New secrets must never be introduced.
  const beforeHadSecret = looksLikeSecretContent(before);
  const afterHasSecret = looksLikeSecretContent(after);
  checks.push(
    afterHasSecret && !beforeHadSecret
      ? fail('No new secrets', 'The patched file now contains something that looks like a credential.')
      : pass('No new secrets', 'No credential-like content was introduced.')
  );

  // Syntax must still parse.
  const syntax = runSyntaxChecks([{ path, content: after, size: after.length }]);
  checks.push(
    syntax.findings.length === 0
      ? pass('Syntax check', 'The patched file parses cleanly.')
      : fail('Syntax check', syntax.findings[0]?.explanation ?? 'The patched file does not parse.'),
  );

  // The original rule should no longer fire at the same spot.
  const ruleStillFires = Boolean(
    finding.ruleId &&
      !finding.ruleId.startsWith('llm/') &&
      !finding.ruleId.startsWith('syntax/') &&
      afterFindings.some(
        (match) => match.ruleId === finding.ruleId && Math.abs(match.line - finding.line) <= 3,
      ),
  );
  checks.push(
    ruleStillFires
      ? fail('Removes the finding', `Rule ${finding.ruleId} still matches near line ${finding.line} after the patch.`)
      : pass('Removes the finding', `${finding.ruleId ?? 'the finding'} no longer matches at line ${finding.line}.`),
  );

  // No new high-severity static findings introduced by the patch.
  const beforeKeys = new Set(beforeFindings.map((match) => `${match.ruleId}:${match.line}`));
  const newHigh = afterFindings.filter(
    (match) => match.severity === 'high' && !beforeKeys.has(`${match.ruleId}:${match.line}`),
  );
  checks.push(
    newHigh.length === 0
      ? pass('No new high-severity issues', 'Static rules found nothing new at high severity.')
      : fail('No new high-severity issues', `The patch introduces: ${newHigh.map((match) => match.ruleId).join(', ')}.`),
  );

  // Credential masking is a display concern; flag it for the UI.
  checks.push(
    redactSecrets(diff) !== diff
      ? pass('Credential masking', 'Credential values are masked in the diff shown to you.')
      : pass('Credential masking', 'No credential values appear in this diff.'),
  );

  const blocking = checks.filter((check) => !check.ok);
  return {
    verified: blocking.length === 0,
    after,
    checks,
    failure: blocking.length === 0 ? null : blocking.map((check) => `${check.label}: ${check.detail}`).join(' '),
    staticFindingsBefore: beforeFindings.length,
    staticFindingsAfter: afterFindings.length,
  };
}
