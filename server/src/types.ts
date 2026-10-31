/**
 * Shared server types.
 *
 * These mirror the API payloads the React app consumes. Keeping them in one
 * file makes it easy for the whole team to see the shape of a scan, a fix and
 * a pull request without digging through route handlers.
 */

export type Severity = 'low' | 'medium' | 'high';
export type Mode = 'github' | 'demo';

/** A read-only view of the signed-in GitHub user. Tokens never leave the server. */
export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string;
}

export interface RepoSummary {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  defaultBranch: string;
  description: string | null;
  language: string | null;
  stars: number;
  updatedAt: string | null;
  htmlUrl: string;
}

/** A single source file fetched during a scan. */
export interface RepoFile {
  path: string;
  content: string;
  size: number;
}

export interface Finding {
  id: string;
  /** Where the finding came from: our rules, the model, or an open bug issue. */
  source: 'static' | 'llm' | 'issue' | 'static+llm';
  file: string;
  line: number;
  endLine?: number;
  severity: Severity;
  confidence: number;
  title: string;
  /** Plain-English "why this is a bug". */
  explanation: string;
  /** "Why it matters" for learners. */
  whyItMatters: string;
  snippet?: string;
  /** 1-based line number of the first line in `snippet`. */
  snippetStart?: number;
  ruleId?: string;
  issue?: { number: number; title: string; url: string; labels: string[] };
}

export interface ScanStats {
  filesInRepo: number;
  filesScanned: number;
  filesSkipped: number;
  skippedReasons: Record<string, number>;
  lintersDetected: string[];
  issuesRead: number;
  modelUsed: string | null;
  durationMs: number;
}

export interface ScanResult {
  scanId: string;
  mode: Mode;
  repo: RepoSummary;
  findings: Finding[];
  stats: ScanStats;
  /** Friendly notes, e.g. "LLM review skipped: no provider configured". */
  notes: string[];
  createdAt: string;
}

export interface VerificationCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface FixResult {
  fixId: string;
  scanId: string;
  finding: Finding;
  diff: string;
  summary: string;
  testPlan: string;
  branchName: string;
  prTitle: string;
  prBody: string;
  verification: VerificationCheck[];
  verified: boolean;
  generatedBy: 'llm' | 'mechanical' | 'cached';
  model: string | null;
  filesChanged: string[];
  bannedIssuesBefore: number;
  bannedIssuesAfter: number;
}

export interface PullRequestRecord {
  id: string;
  mode: Mode;
  repoFullName: string;
  number: number | null;
  title: string;
  branchName: string;
  htmlUrl: string | null;
  dryRun: boolean;
  status: 'opened' | 'dry-run';
  createdAt: string;
  findingTitle: string;
  file: string;
  line: number;
}

/** Internal record kept in the session so we can create a PR from a fixId. */
export interface ScanRecord {
  scan: ScanResult;
  files: RepoFile[];
  repo: RepoSummary;
  userLogin: string;
}

export interface FixRecord {
  fix: FixResult;
  scanId: string;
  path: string;
  beforeContent: string;
  afterContent: string;
  /** SHA of the file when the patch was generated, if from GitHub. */
  fileSha?: string;
}

export interface SessionView {
  connected: boolean;
  user: GitHubUser | null;
  oauthAvailable: boolean;
  dryRun: boolean;
  approvals: number;
  approvalCap: number;
  history: PullRequestRecord[];
  demoAvailable: boolean;
  llm: { provider: string; model: string | null };
}

export interface JobView<T> {
  id: string;
  status: 'running' | 'done' | 'error';
  step: string;
  steps: string[];
  progress: number;
  result: T | null;
  error: string | null;
}
