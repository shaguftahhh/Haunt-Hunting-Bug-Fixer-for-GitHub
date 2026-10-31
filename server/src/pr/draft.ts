/**
 * Branch names and PR text.
 *
 * The PR body is written for a human reviewer: what the bug was, what changed,
 * how to test it, and an explicit AI disclosure. It is shown in the approval
 * modal exactly as it will appear on GitHub.
 */
import crypto from 'node:crypto';
import type { Finding, RepoSummary } from '../types.js';
import { config } from '../config.js';

export interface PrDraft {
  branchName: string;
  prTitle: string;
  prBody: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function buildBranchName(finding: Finding, fixId: string): string {
  const suffix = crypto.createHash('sha256').update(`${fixId}:${finding.id}`).digest('hex').slice(0, 6);
  const slug = slugify(finding.title) || 'bug-fix';
  return `${config.safety.branchPrefix}fix-${slug}-${suffix}`;
}

export function assertSafeBranch(branchName: string, defaultBranch: string): void {
  if (!branchName.startsWith(config.safety.branchPrefix)) {
    throw new Error(`Refusing to push to "${branchName}": branch must start with ${config.safety.branchPrefix}.`);
  }
  if (branchName === defaultBranch) {
    throw new Error('Refusing to push to the default branch.');
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branchName)) {
    throw new Error('Branch name contains unsupported characters.');
  }
}

export function buildPrDraft(input: {
  repo: RepoSummary;
  finding: Finding;
  fixId: string;
  summary: string;
  testPlan: string;
  model: string | null;
  generatedBy: 'llm' | 'mechanical' | 'cached';
  diff: string;
  prTitle?: string;
}): PrDraft {
  const { repo, finding, fixId, summary, testPlan, model, generatedBy, diff } = input;
  const branchName = buildBranchName(finding, fixId);

  const rawTitle = input.prTitle?.trim() || `fix: ${finding.title}`;
  const prTitle = rawTitle.length > 72 ? `${rawTitle.slice(0, 69)}…` : rawTitle;

  const added = diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
  const removed = diff.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---')).length;

  const issueLine =
    finding.issue && finding.source === 'issue' ? `\nFixes #${finding.issue.number}\n` : '';

  const prBody = `## What was wrong

**${finding.title}** — \`${finding.file}${finding.line ? `:${finding.line}` : ''}\` · ${finding.severity} severity · ${finding.confidence}% confidence
${issueLine}
${finding.explanation}

**Why it matters:** ${finding.whyItMatters}

## What changed

${summary}

- File: \`${finding.file}\`
- Diff: +${added} / -${removed} lines
- Base branch: \`${repo.defaultBranch}\` (BugBanisher never pushes to it directly)

## How to test

${testPlan}

## AI-assisted disclosure

This pull request was drafted by **BugBanisher** and reviewed by a human before it was opened.
- Model: \`${model ?? 'none (deterministic rule fix)'}\` (${generatedBy})
- The patch was verified server-side: it applies cleanly, parses, and removes the flagged finding.
- Label: \`ai-assisted\` · BugBanisher **never merges** pull requests.

---

<sub>🤖 Generated with BugBanisher · human-approved, never auto-merged</sub>
`;

  return { branchName, prTitle, prBody };
}
