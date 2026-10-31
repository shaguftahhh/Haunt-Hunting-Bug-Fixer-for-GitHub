/**
 * Frontend mirrors of the server types.
 * (Kept tiny and hand-written so the code is easy to read in a classroom.)
 */

export type Severity = 'low' | 'medium' | 'high';
export type Mode = 'github' | 'demo';

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

export interface Finding {
  id: string;
  source: 'static' | 'llm' | 'issue' | 'static+llm';
  file: string;
  line: number;
  endLine?: number;
  severity: Severity;
  confidence: number;
  title: string;
  explanation: string;
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
