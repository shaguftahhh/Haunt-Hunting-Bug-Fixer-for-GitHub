/**
 * The scan engine.
 *
 * Pipeline (each step is reported to the UI):
 *   1. read the repo tree through the GitHub API
 *   2. drop secrets, binaries, vendored code and lockfiles
 *   3. fetch the remaining source files (bounded count + size)
 *   4. run built-in rules, syntax checks and ruff (when available)
 *   5. read open issues labelled "bug"
 *   6. ask the open-weight model to review the most suspicious files
 *
 * The engine only reads. It never writes to GitHub.
 */
import crypto from 'node:crypto';
import type {
  Finding,
  Mode,
  RepoFile,
  RepoSummary,
  ScanResult,
  ScanStats,
  Severity,
} from '../types.js';
import { config } from '../config.js';
import { log, redact } from '../logger.js';
import { redactSecrets } from '../redaction.js';
import { getRepoTree, getFile, listBugIssues } from '../github/client.js';
import type { JobContext } from '../jobs.js';
import { checkLLMProvider, getLLMProvider } from '../llm/index.js';
import { reviewFilesWithLLM } from '../llm/findings.js';
import { classifyPath, languageOf, looksLikeSecretContent, isProbablyBinary } from './fileFilter.js';
import { runStaticRules } from './staticRules.js';
import { mechanicalFix } from '../patch/mechanical.js';
import { detectLinters, runRuff, runSyntaxChecks } from './linters.js';

const SEVERITY_WEIGHT: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
const MAX_FINDINGS = 40;

export interface ScanInput {
  token: string;
  repo: RepoSummary;
  mode: Mode;
  /** Demo scans only have a local file list and skip GitHub calls. */
  localFiles?: RepoFile[];
  localPaths?: string[];
  /** Hand the fetched, filtered files back to the caller (patch stage). */
  onFiles?: (files: RepoFile[]) => void;
}

function snippetAround(content: string, line: number, radius = 2): { snippet: string; snippetStart: number } {
  const lines = content.split('\n');
  const start = Math.max(1, line - radius);
  const end = Math.min(lines.length, line + radius);
  return {
    // A finding about a secret must not print the secret back to the reader.
    snippet: redactSecrets(lines.slice(start - 1, end).join('\n')),
    snippetStart: start,
  };
}

/** Prefer application source; de-prioritise tests and nested config. */
function filePriority(path: string): number {
  const lower = path.toLowerCase();
  let score = 0;
  if (/(^|\/)src\//.test(lower)) score += 30;
  if (/(^|\/)(lib|app|server|api|core)\//.test(lower)) score += 20;
  if (/\.(ts|tsx|js|jsx|py)$/.test(lower)) score += 12;
  if (/(test|spec|__tests__)/.test(lower)) score -= 25;
  if (/(^|\/)(config|settings)\.[a-z]+$/.test(lower)) score += 5;
  score -= Math.min(10, path.split('/').length);
  return score;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await fn(item, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function mergeLlmFindings(base: Finding[], llm: Finding[]): Finding[] {
  const merged = [...base];
  const consumed = new Set<number>();

  for (const candidate of llm) {
    const matchIndex = merged.findIndex(
      (finding, index) =>
        !consumed.has(index) &&
        finding.file === candidate.file &&
        Math.abs(finding.line - candidate.line) <= 3,
    );

    if (matchIndex === -1) {
      merged.push(candidate);
      continue;
    }

    consumed.add(matchIndex);
    const existing = merged[matchIndex];
    if (!existing) continue;
    merged[matchIndex] = {
      ...existing,
      source: 'static+llm',
      severity:
        SEVERITY_WEIGHT[candidate.severity] > SEVERITY_WEIGHT[existing.severity]
          ? candidate.severity
          : existing.severity,
      confidence: Math.min(95, Math.max(existing.confidence, candidate.confidence) + 8),
      // The model's wording is usually more specific; the rule keeps the anchor.
      title: candidate.title,
      explanation: candidate.explanation,
      whyItMatters: candidate.whyItMatters,
    };
  }

  return merged;
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}:${finding.title.toLowerCase().slice(0, 50)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

export async function runScan(input: ScanInput, ctx: JobContext, signal?: AbortSignal): Promise<ScanResult> {
  const started = Date.now();
  const { repo, token, mode } = input;
  const notes: string[] = [];
  const skippedReasons: Record<string, number> = {};
  const skip = (reason: string) => {
    skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
  };

  ctx.step('Reading the repository tree');

  let paths: string[] = input.localPaths ?? [];
  let treeSizes = new Map<string, number>();
  let treeTruncated = false;

  if (!input.localFiles) {
    const tree = await getRepoTree(token, repo.owner, repo.name, repo.defaultBranch);
    treeTruncated = tree.truncated;
    for (const entry of tree.tree) {
      if (entry.type !== 'blob') continue;
      paths.push(entry.path);
      treeSizes.set(entry.path, entry.size ?? 0);
    }
    if (treeTruncated) notes.push('GitHub truncated the file tree, so very large repos may be partially scanned.');
  }

  ctx.step('Skipping secrets and binaries');
  const candidates: string[] = [];
  for (const path of paths) {
    const decision = classifyPath(path, treeSizes.get(path) ?? (input.localFiles ? 1 : 0), config.scan.maxFileBytes);
    if (!decision.keep) {
      skip(decision.reason ?? 'skipped');
      continue;
    }
    candidates.push(path);
  }

  // Rank, then bound the scan. This keeps the scan fast and the demo predictable.
  const ranked = [...candidates].sort((a, b) => filePriority(b) - filePriority(a));
  const selectedPaths = ranked.slice(0, config.scan.maxFiles);
  for (let index = config.scan.maxFiles; index < ranked.length; index += 1) {
    skip('scan limit reached');
  }
  if (ranked.length > selectedPaths.length) {
    notes.push(
      `Scanned the ${selectedPaths.length} highest-priority files out of ${ranked.length} candidates (SCAN_MAX_FILES).`,
    );
  }

  ctx.step('Fetching source files');
  let files: RepoFile[] = [];

  if (input.localFiles) {
    const byPath = new Map(input.localFiles.map((file) => [file.path, file]));
    files = selectedPaths
      .map((path) => byPath.get(path))
      .filter((file): file is RepoFile => Boolean(file));
  } else {
    let fetched = 0;
    const fetchedFiles = await mapLimit(selectedPaths, 4, async (path) => {
      try {
        const file = await getFile(token, repo.owner, repo.name, path, repo.defaultBranch);
        fetched += 1;
        ctx.progress(55 + Math.round((fetched / Math.max(1, selectedPaths.length)) * 15));
        return file;
      } catch (error) {
        log.warn('Could not read file', { path, message: error instanceof Error ? error.message : String(error) });
        return null;
      }
    });
    files = fetchedFiles.filter((file): file is RepoFile => Boolean(file));
  }

  // Second line of defence: never carry secret-looking content any further.
  files = files.filter((file) => {
    if (looksLikeSecretContent(file.content) || isProbablyBinary(file.content)) {
      skip('possible secret content');
      return false;
    }
    return true;
  });

  input.onFiles?.(files);

  if (files.length === 0) {
    notes.push(
      'No readable source files were found. The repo may be empty, all in unsupported languages, or everything was filtered out.',
    );
  }

  ctx.step('Running static checks');
  // Config files (package.json, tsconfig.json, .eslintrc…) are not source files,
  // but their presence is what tells the user which linters the repo uses.
  const linters = detectLinters(paths);
  const findings: Finding[] = [];

  for (const file of files) {
    for (const match of runStaticRules(file.path, file.content)) {
      const { snippet, snippetStart } = snippetAround(file.content, match.line);
      findings.push({
        id: `static-${match.ruleId}-${file.path}-${match.line}`,
        source: 'static',
        file: file.path,
        line: match.line,
        severity: match.severity,
        confidence: match.confidence,
        title: match.title,
        explanation: match.explanation,
        whyItMatters: match.whyItMatters,
        ruleId: match.ruleId,
        snippet,
        snippetStart,
        fixHint: match.fixHint,
      });
    }
  }

  const syntax = runSyntaxChecks(files);
  for (const finding of syntax.findings) {
    const file = files.find((f) => f.path === finding.file);
    if (file) {
      const { snippet, snippetStart } = snippetAround(file.content, finding.line);
      findings.push({ ...finding, snippet, snippetStart });
    } else {
      findings.push(finding);
    }
  }

  const ruff = runRuff(files);
  for (const finding of ruff.findings) {
    const file = files.find((f) => f.path === finding.file);
    const snippet = file ? snippetAround(file.content, finding.line) : null;
    findings.push(snippet ? { ...finding, ...snippet } : finding);
  }

  const safetyChecks = [
    ...syntax.checks,
    ...(ruff.check ? [ruff.check] : []),
    {
      label: 'Secret and binary filter',
      ok: true,
      detail: `${Object.values(skippedReasons).reduce((sum, n) => sum + n, 0)} file(s) skipped before reading.`,
    },
  ];

  ctx.step('Reading open bug issues');
  let issuesRead = 0;
  if (token) {
    try {
      const issues = await listBugIssues(token, repo.owner, repo.name);
      issuesRead = issues.length;
      for (const issue of issues) {
        const body = redact(issue.body ?? '').slice(0, 500);
        findings.push({
          id: `issue-${issue.number}`,
          source: 'issue',
          file: `issue #${issue.number}`,
          line: 0,
          severity: 'medium',
          confidence: 45,
          title: issue.title.slice(0, 120),
          explanation: body || 'This issue is labelled "bug" but has no description.',
          whyItMatters:
            'Open bug issues are real-world evidence: someone already hit this. Closing the loop with a tested fix is how a small project earns trust.',
          ruleId: 'issue/bug',
          issue: {
            number: issue.number,
            title: issue.title,
            url: issue.htmlUrl,
            labels: issue.labels,
          },
        });
      }
    } catch (error) {
      notes.push(`Could not read bug issues: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  ctx.step('Asking the model to review');
  let modelUsed: string | null = null;
  let llmFindings: Finding[] = [];

  const provider = getLLMProvider();
  const scanForLLM =
    mode === 'github' && provider !== null && !signal?.aborted
      ? selectForModel(files)
      : [];

  if (provider === null) {
    notes.push('Model review skipped: LLM_PROVIDER=none. Static checks and issues were still scanned.');
  } else if (mode === 'github') {
    const health = await checkLLMProvider(provider);
    if (!health.ok) {
      notes.push(`Model review skipped: ${health.detail} Static checks and issues were still scanned.`);
    } else {
      try {
        const result = await reviewFilesWithLLM(provider, repo.fullName, scanForLLM, signal);
        llmFindings = result.findings;
        modelUsed = result.filesReviewed > 0 ? result.model : null;
        notes.push(...result.notes);
        if (result.filesReviewed === 0 && result.notes.length === 0) {
          notes.push('The model reviewed no files (nothing suspicious enough or nothing supported).');
        }
      } catch (error) {
        notes.push(`Model review failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
  }

  ctx.step('Scoring findings');
  let finalFindings = mergeLlmFindings(findings, llmFindings);

  // Attach snippets to model-only findings too.
  for (const finding of finalFindings) {
    if (!finding.snippet) {
      const file = files.find((f) => f.path === finding.file);
      if (file && finding.line > 0) {
        const { snippet, snippetStart } = snippetAround(file.content, finding.line);
        finding.snippet = snippet;
        finding.snippetStart = snippetStart;
      }
    }
  }

  for (const finding of finalFindings) {
    finding.title = redactSecrets(finding.title);
    finding.explanation = redactSecrets(finding.explanation);
    finding.whyItMatters = redactSecrets(finding.whyItMatters);
  }

  finalFindings = dedupe(finalFindings)
    .sort((a, b) => {
      const severity = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
      if (severity !== 0) return severity;
      return b.confidence - a.confidence;
    })
    .slice(0, MAX_FINDINGS);

  // Tell the UI which findings a deterministic patch can fix right now.
  for (const finding of finalFindings) {
    const file = files.find((candidate) => candidate.path === finding.file);
    if (file && finding.line > 0 && finding.source !== 'issue') {
      finding.autoFixAvailable = mechanicalFix(finding, file.content) !== null;
    } else {
      finding.autoFixAvailable = false;
    }
  }

  const stats: ScanStats = {
    filesInRepo: paths.length,
    filesScanned: files.length,
    filesSkipped: Object.values(skippedReasons).reduce((sum, n) => sum + n, 0),
    skippedReasons,
    lintersDetected: linters.map((linter) =>
      linter.configPath ? `${linter.name} (${linter.configPath})` : linter.name,
    ),
    issuesRead,
    modelUsed,
    modelAvailable: Boolean(modelUsed),
    autoFixableCount: finalFindings.filter((finding) => finding.autoFixAvailable).length,
    durationMs: Date.now() - started,
  };

  if (linters.some((linter) => linter.id === 'eslint')) {
    notes.push('ESLint config detected, but it is not executed: repository ESLint configs are code. Built-in rules cover similar ground.');
  }
  if (safetyChecks.some((check) => !check.ok)) {
    for (const check of safetyChecks.filter((c) => !c.ok)) notes.push(`${check.label}: ${check.detail}`);
  }

  return {
    scanId: crypto.randomBytes(12).toString('base64url'),
    mode,
    repo,
    findings: finalFindings,
    stats,
    notes,
    createdAt: new Date().toISOString(),
  };
}

/** Files worth spending model tokens on. */
function selectForModel(files: RepoFile[]): RepoFile[] {
  const supported = files.filter((file) => ['javascript', 'typescript', 'python'].includes(languageOf(file.path)));
  const appCode = supported.filter((file) => !/(test|spec|__tests__)/i.test(file.path));
  const pool = appCode.length > 0 ? appCode : supported;
  return [...pool].sort((a, b) => filePriority(b.path) - filePriority(a.path)).slice(0, config.scan.llmMaxFiles);
}
