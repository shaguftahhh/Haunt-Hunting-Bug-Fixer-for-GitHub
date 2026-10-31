/**
 * A very small GitHub REST client.
 *
 * It only exposes the endpoints BugBanisher actually needs:
 *   - read the signed-in user
 *   - list repositories the user owns
 *   - read a repo tree and file contents
 *   - read open issues labelled "bug"
 *   - (gated) create a branch, commit one file and open a PR
 *
 * Tokens are passed as arguments and are never logged.
 */
import type { GitHubUser, RepoFile, RepoSummary } from '../types.js';
import { config } from '../config.js';

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  accept?: string;
  token: string;
  timeoutMs?: number;
}

async function githubRequest<T>(
  path: string,
  opts: RequestOptions,
): Promise<{ data: T; headers: Headers }> {
  const url = path.startsWith('http') ? path : `${config.github.apiBase}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);

  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: opts.accept ?? 'application/vnd.github+json',
        Authorization: `Bearer ${opts.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'BugBanisher/1.0',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      let message = `GitHub API request failed (${res.status})`;
      let hint: string | undefined;
      try {
        const payload = (await res.json()) as { message?: string; documentation_url?: string };
        if (payload.message) message = payload.message;
        if (res.status === 401) hint = 'Your token was rejected. It may be expired or revoked.';
        if (res.status === 403) {
          hint =
            'The token is missing a permission, or you hit a rate limit. BugBanisher needs Contents (read/write) and Pull requests (read/write).';
        }
        if (res.status === 404) hint = 'Not found. The token may not have access to this repository.';
      } catch {
        /* response was not JSON */
      }
      throw new GitHubError(message, res.status, hint);
    }

    const data = (await res.json()) as T;
    return { data, headers: res.headers };
  } catch (error) {
    if (error instanceof GitHubError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GitHubError('GitHub took too long to respond. Try again.', 504);
    }
    throw new GitHubError('Could not reach GitHub. Check your internet connection.', 502);
  } finally {
    clearTimeout(timer);
  }
}

const raw = (value: string) => value.replace(/[^\x20-\x7E]/g, '').trim();

export async function getAuthenticatedUser(token: string): Promise<{
  user: GitHubUser;
  scopes: string[];
  tokenKind: 'pat' | 'oauth';
}> {
  const { data, headers } = await githubRequest<{
    login: string;
    name: string | null;
    avatar_url: string;
    html_url: string;
  }>('/user', { token });

  const scopesHeader = headers.get('x-oauth-scopes') ?? '';
  const scopes = scopesHeader ? scopesHeader.split(',').map((s) => s.trim()).filter(Boolean) : [];
  // Fine-grained PATs do not send x-oauth-scopes. Treat any token that starts
  // with github_pat_ as a PAT; OAuth tokens (gho_) get their scopes header.
  const tokenKind: 'pat' | 'oauth' = token.startsWith('gho_') ? 'oauth' : 'pat';

  return {
    user: {
      login: data.login,
      name: data.name,
      avatarUrl: data.avatar_url,
      htmlUrl: data.html_url,
    },
    scopes,
    tokenKind,
  };
}

function toRepoSummary(repo: {
  name: string;
  full_name: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  default_branch: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  updated_at: string | null;
  html_url: string;
  owner: { login: string };
}): RepoSummary {
  return {
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    archived: repo.archived,
    fork: repo.fork,
    defaultBranch: repo.default_branch,
    description: repo.description,
    language: repo.language,
    stars: repo.stargazers_count,
    updatedAt: repo.updated_at,
    htmlUrl: repo.html_url,
  };
}

/**
 * List repos the signed-in user owns. We deliberately request `affiliation=owner`
 * and then double-check `owner.login === user.login`, so a token that can see
 * organisation repos still never shows repos the user does not own unless they
 * explicitly grant access to them (fine-grained PAT selection).
 */
export async function listOwnedRepos(token: string, login: string): Promise<RepoSummary[]> {
  const repos: RepoSummary[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const { data } = await githubRequest<
      Array<Parameters<typeof toRepoSummary>[0] & { permissions?: { push?: boolean } }>
    >(
      `/user/repos?affiliation=owner&sort=updated&per_page=100&page=${page}`,
      { token },
    );
    for (const repo of data) {
      if (repo.owner.login.toLowerCase() !== login.toLowerCase()) continue;
      if (repo.archived) continue;
      repos.push(toRepoSummary(repo));
    }
    if (data.length < 100) break;
  }
  return repos;
}

export async function getRepo(token: string, owner: string, name: string): Promise<RepoSummary> {
  const { data } = await githubRequest<Parameters<typeof toRepoSummary>[0]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    { token },
  );
  return toRepoSummary(data);
}

interface RepoTree {
  tree: Array<{ path: string; type: 'blob' | 'tree' | 'commit'; size?: number }>;
  truncated: boolean;
}

export async function getRepoTree(
  token: string,
  owner: string,
  name: string,
  branch: string,
): Promise<RepoTree> {
  const { data } = await githubRequest<RepoTree>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { token },
  );
  return { tree: data.tree ?? [], truncated: data.truncated };
}

/** Fetch one file as raw text. Binary-ish files are rejected by the scanner. */
export async function getFile(
  token: string,
  owner: string,
  name: string,
  path: string,
  ref: string,
): Promise<RepoFile | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(
      `${config.github.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}?ref=${encodeURIComponent(ref)}`,
      {
        headers: {
          Accept: 'application/vnd.github.raw+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'BugBanisher/1.0',
        },
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new GitHubError(`Could not read ${path} (${res.status})`, res.status);
    }
    const content = await res.text();
    return { path, content, size: new TextEncoder().encode(content).length };
  } finally {
    clearTimeout(timer);
  }
}

/** Gets a file's blob SHA plus decoded text; used to avoid overwriting changes. */
export async function getFileWithSha(
  token: string,
  owner: string,
  name: string,
  path: string,
  ref: string,
): Promise<{ content: string; sha: string } | null> {
  const { data } = await githubRequest<{ content: string; sha: string; encoding: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?ref=${encodeURIComponent(ref)}`,
    { token },
  );
  if (data.encoding !== 'base64') return null;
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { content, sha: data.sha };
}

export interface BugIssue {
  number: number;
  title: string;
  body: string | null;
  htmlUrl: string;
  labels: string[];
}

export async function listBugIssues(token: string, owner: string, name: string): Promise<BugIssue[]> {
  const { data } = await githubRequest<
    Array<{
      number: number;
      title: string;
      body: string | null;
      html_url: string;
      labels: Array<{ name: string }>;
      pull_request?: unknown;
    }>
  >(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues?state=open&labels=bug&per_page=10&sort=updated`,
    { token },
  );
  return data
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      htmlUrl: issue.html_url,
      labels: issue.labels.map((l) => l.name),
    }));
}

export async function getBranchSha(
  token: string,
  owner: string,
  name: string,
  branch: string,
): Promise<string> {
  const { data } = await githubRequest<{ object: { sha: string } }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/ref/heads/${encodeURIComponent(branch)}`,
    { token },
  );
  return data.object.sha;
}

export async function createBranch(
  token: string,
  owner: string,
  name: string,
  branch: string,
  fromSha: string,
): Promise<void> {
  await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs`,
    { token, method: 'POST', body: { ref: `refs/heads/${branch}`, sha: fromSha } },
  );
}

export async function commitFile(
  token: string,
  owner: string,
  name: string,
  opts: { path: string; content: string; message: string; branch: string; sha?: string },
): Promise<{ commitSha: string }> {
  const { data } = await githubRequest<{ commit: { sha: string } }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${opts.path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
    {
      token,
      method: 'PUT',
      body: {
        message: opts.message,
        content: Buffer.from(opts.content, 'utf8').toString('base64'),
        branch: opts.branch,
        ...(opts.sha ? { sha: opts.sha } : {}),
      },
    },
  );
  return { commitSha: data.commit.sha };
}

export async function openPullRequest(
  token: string,
  owner: string,
  name: string,
  opts: { title: string; head: string; base: string; body: string; draft?: boolean },
): Promise<{ number: number; htmlUrl: string }> {
  const { data } = await githubRequest<{ number: number; html_url: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`,
    {
      token,
      method: 'POST',
      body: {
        title: opts.title,
        head: opts.head,
        base: opts.base,
        body: opts.body,
        draft: opts.draft ?? false,
      },
    },
  );
  return { number: data.number, htmlUrl: data.html_url };
}

/**
 * Best-effort label. Fine-grained tokens limited to Contents + Pull requests
 * cannot write labels; in that case we return false and the PR body still says
 * "ai-assisted".
 */
export async function addLabel(
  token: string,
  owner: string,
  name: string,
  issueNumber: number,
  label: string,
): Promise<boolean> {
  try {
    await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${issueNumber}/labels`,
      { token, method: 'POST', body: { labels: [label] } },
    );
    return true;
  } catch {
    return false;
  }
}

export function sanitizeScopes(scopes: string[]): string[] {
  return scopes.map(raw);
}
