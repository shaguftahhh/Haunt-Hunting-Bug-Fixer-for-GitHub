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
  /** The signed-in user has write access (true for owned and selected org repos). */
  pushAccess?: boolean;
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
  /** Plain-English "what to change" for this finding. */
  fixHint?: string;
  /** True when a deterministic patch exists (no model needed). */
  autoFixAvailable?: boolean;
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
  /** Whether a model endpoint answered during this scan. */
  modelAvailable: boolean;
  /** Findings a deterministic patch can fix without a model. */
  autoFixableCount: number;
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
  /** Static findings in the file before/after the patch. */
  staticFindingsBefore: number;
  staticFindingsAfter: number;
  /** True when credential values were masked in the displayed diff. */
  diffRedacted: boolean;
}

export interface PullRequestRecord {
  id: string;
  mode: Mode;
  fixId: string;
  findingId: string;
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

/** Health of the configured AI provider (reported by GET /api/model/status). */
export interface ModelStatus {
  provider: string;
  model: string | null;
  endpoint?: string;
  ok: boolean;
  detail: string;
  setup: string[];
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
