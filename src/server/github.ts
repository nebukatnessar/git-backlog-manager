import type { GitHubIssue } from "../shared/workItems";

export class GitHubApiError extends Error {
  constructor(public statusCode: number, public details: string) {
    super("GitHub API request failed");
  }
}

export interface GitHubComment {
  id: number;
  body: string;
  user?: { login?: string };
}

export interface GitHubPullRequest {
  number: number;
  html_url: string;
  draft?: boolean;
  head?: { ref?: string };
}

export function githubHeaders(token: string, jsonBody = false): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "git-backlog-manager",
    ...(jsonBody ? { "Content-Type": "application/json" } : {}),
  };
}

async function githubFetch<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...githubHeaders(token, Boolean(init.body)), ...(init.headers as Record<string, string>) },
  });
  if (!response.ok) throw new GitHubApiError(response.status, await response.text());
  return (await response.json()) as T;
}

export async function fetchIssue(token: string, owner: string, repo: string, issueNumber: number): Promise<GitHubIssue> {
  const issue = await githubFetch<GitHubIssue & { pull_request?: unknown }>(
    token,
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
  );
  if (issue.pull_request) throw new GitHubApiError(404, "Issue is a pull request");
  return issue;
}

export async function fetchIssueComments(token: string, owner: string, repo: string, issueNumber: number): Promise<GitHubComment[]> {
  return githubFetch<GitHubComment[]>(
    token,
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`,
  );
}

export async function createIssueComment(token: string, owner: string, repo: string, issueNumber: number, body: string): Promise<GitHubComment> {
  return githubFetch<GitHubComment>(token, `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function updateIssueComment(token: string, owner: string, repo: string, commentId: number, body: string): Promise<GitHubComment> {
  return githubFetch<GitHubComment>(token, `https://api.github.com/repos/${owner}/${repo}/issues/comments/${commentId}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
}

export async function addIssueLabels(token: string, owner: string, repo: string, issueNumber: number, labels: string[]): Promise<void> {
  await githubFetch(token, `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels }),
  });
}

export async function removeIssueLabel(token: string, owner: string, repo: string, issueNumber: number, label: string): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
    { method: "DELETE", headers: githubHeaders(token) },
  );
  if (!response.ok && response.status !== 404) throw new GitHubApiError(response.status, await response.text());
}

export async function fetchPullRequestForBranch(token: string, owner: string, repo: string, branch: string): Promise<GitHubPullRequest | null> {
  const pulls = await githubFetch<GitHubPullRequest[]>(
    token,
    `https://api.github.com/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all`,
  );
  return pulls[0] || null;
}

export async function ensureLabelsExist(token: string, owner: string, repo: string, labels: string[], colorFor: (name: string) => string): Promise<void> {
  const existing = new Set<string>();
  let page = 1;

  while (true) {
    const batch = await githubFetch<Array<{ name: string }>>(
      token,
      `https://api.github.com/repos/${owner}/${repo}/labels?per_page=100&page=${page}`,
    );
    for (const label of batch) existing.add(label.name.toLowerCase());
    if (batch.length < 100) break;
    page += 1;
  }

  for (const name of labels) {
    if (existing.has(name.toLowerCase())) continue;
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/labels`, {
      method: "POST",
      headers: githubHeaders(token, true),
      body: JSON.stringify({ name, color: colorFor(name) }),
    });
    if (!response.ok && response.status !== 422) throw new GitHubApiError(response.status, await response.text());
  }
}
