import type { GitHubIssue } from "../shared/workItems";

export class GitHubApiError extends Error {
  constructor(public statusCode: number, public details: string) {
    let apiMessage = details;
    try {
      const parsed = JSON.parse(details) as { message?: string };
      apiMessage = parsed.message || details;
    } catch {
      // keep raw body as the message
    }
    super(`GitHub API request failed (${statusCode}): ${apiMessage}`);
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
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...githubHeaders(token, Boolean(init.body)), ...(init.headers as Record<string, string>) },
    });
  } catch (networkError) {
    console.error(`GitHub API ${init.method || "GET"} ${url} network error:`, networkError);
    throw networkError;
  }
  if (!response.ok) {
    const details = await response.text();
    console.error(`GitHub API ${init.method || "GET"} ${url} failed with status ${response.status}:`, details.slice(0, 500));
    throw new GitHubApiError(response.status, details);
  }
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

export interface GitHubCheckRun {
  id: number;
  name: string;
  html_url: string;
  status: string;
  conclusion: string | null;
  head_sha?: string;
  app?: { slug?: string };
}

export async function fetchCheckRunsForRef(token: string, owner: string, repo: string, ref: string): Promise<GitHubCheckRun[]> {
  const payload = await githubFetch<{ check_runs?: GitHubCheckRun[] }>(
    token,
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`,
  );
  return payload.check_runs || [];
}

export interface GitHubCheckAnnotation {
  message: string;
  path?: string;
  start_line?: number;
}

/**
 * Fetch the annotations attached to a check run. For compile/lint failures these
 * usually contain exact `file:line: error` messages, which is the most useful
 * diagnostic for a fix agent.
 */
export async function fetchCheckRunAnnotations(token: string, owner: string, repo: string, checkRunId: number): Promise<GitHubCheckAnnotation[]> {
  try {
    return await githubFetch<GitHubCheckAnnotation[]>(
      token,
      `https://api.github.com/repos/${owner}/${repo}/check-runs/${checkRunId}/annotations?per_page=100`,
    );
  } catch (error) {
    if (error instanceof GitHubApiError && error.statusCode === 404) return [];
    throw error;
  }
}

/**
 * Fetch the combined logs of the latest workflow run's jobs for a given ref.
 * GitHub does not expose logs through the check-runs API; the working path is
 * the Actions runs API: list runs for the head sha, then fetch each job's logs.
 */
export async function fetchWorkflowRunLogsForRef(token: string, owner: string, repo: string, ref: string): Promise<string | null> {
  const runs = await githubFetch<{ workflow_runs?: Array<{ id: number; status: string }> }>(
    token,
    `https://api.github.com/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(ref)}&per_page=5`,
  );

  const latestRun = (runs.workflow_runs || []).find((workflowRun) => workflowRun.status === "completed");
  if (!latestRun) return null;

  const jobs = await githubFetch<{ jobs?: Array<{ id: number; name: string; conclusion: string | null }> }>(
    token,
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${latestRun.id}/jobs?per_page=100`,
  );

  const parts: string[] = [];
  for (const job of jobs.jobs || []) {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`,
      { headers: githubHeaders(token), redirect: "follow" },
    );
    if (!response.ok) {
      if (response.status === 404) continue;
      throw new GitHubApiError(response.status, await response.text());
    }
    parts.push(`### Job: ${job.name}\n${await response.text()}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

export async function fetchRepoFile(token: string, owner: string, repo: string, path: string): Promise<string | null> {
  try {
    const file = await githubFetch<{ content?: string; encoding?: string }>(
      token,
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      { headers: { Accept: "application/vnd.github.raw" } },
    );
    if (typeof file.content === "string" && (!file.encoding || file.encoding === "base64")) {
      if (file.encoding === "base64") {
        return Buffer.from(file.content, "base64").toString("utf-8");
      }
      return file.content;
    }
    return typeof file.content === "string" ? file.content : null;
  } catch (error) {
    if (error instanceof GitHubApiError && error.statusCode === 404) return null;
    throw error;
  }
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
