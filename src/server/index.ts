import "dotenv/config";
import express, { type Request, type Response } from "express";
import path from "node:path";
import { buildWorkItemHierarchy, type GitHubIssue } from "../shared/workItems";

const PORT = Number(process.env.PORT || 3000);
const app = express();

class GitHubApiError extends Error {
  constructor(public statusCode: number, public details: string) {
    super("GitHub API request failed");
  }
}

interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  stargazers_count: number;
  open_issues_count: number;
  updated_at: string;
}

function isValidRepoPart(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value);
}

async function fetchIssues(owner: string, repo: string, state: string, token: string): Promise<GitHubIssue[]> {
  const issues: GitHubIssue[] = [];
  let page = 1;

  while (true) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues`);
    url.searchParams.set("state", state || "all");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "git-backlog-manager",
      },
    });

    if (!response.ok) throw new GitHubApiError(response.status, await response.text());

    const batch = (await response.json()) as Array<GitHubIssue & { pull_request?: unknown }>;
    issues.push(...batch.filter((item) => !item.pull_request));

    if (batch.length < 100) break;
    page += 1;
  }

  return issues;
}

async function fetchRepositories(owner: string, token: string): Promise<GitHubRepository[]> {
  const repositories: GitHubRepository[] = [];
  let page = 1;

  while (true) {
    const url = new URL(`https://api.github.com/users/${owner}/repos`);
    url.searchParams.set("type", "all");
    url.searchParams.set("sort", "updated");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "git-backlog-manager",
      },
    });

    if (!response.ok) throw new GitHubApiError(response.status, await response.text());

    const batch = (await response.json()) as GitHubRepository[];
    repositories.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  return repositories;
}

app.use(express.static(path.join(__dirname, "../../public")));

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get("/api/config", (_req: Request, res: Response) => {
  res.json({ owner: process.env.GITHUB_OWNER || "" });
});

app.get("/api/repos", async (req: Request, res: Response) => {
  const owner = String(req.query.owner || process.env.GITHUB_OWNER || "").trim();
  const authHeader = req.get("authorization") || "";
  const headerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const token = headerToken || process.env.GITHUB_TOKEN;

  if (!owner || !isValidRepoPart(owner)) {
    return res.status(400).json({ error: "Configure a valid GITHUB_OWNER value." });
  }
  if (!token) return res.status(401).json({ error: "No GitHub token configured." });

  try {
    return res.json({ repositories: await fetchRepositories(owner, token) });
  } catch (error) {
    const apiError = error instanceof GitHubApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(apiError?.statusCode || 500).json({
      error: "Failed to load repositories from GitHub.",
      details: apiError?.details || message,
    });
  }
});

app.get("/api/issues", async (req: Request, res: Response) => {
  const owner = String(req.query.owner || process.env.GITHUB_OWNER || "").trim();
  const repo = String(req.query.repo || "").trim();
  const state = String(req.query.state || "all").trim();

  if (!owner || !repo || !isValidRepoPart(owner) || !isValidRepoPart(repo)) {
    return res.status(400).json({ error: "Provide valid owner and repo query parameters." });
  }

  const authHeader = req.get("authorization") || "";
  const headerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const token = headerToken || process.env.GITHUB_TOKEN;

  if (!token) {
    return res.status(401).json({ error: "No GitHub token configured. Provide a bearer token or set GITHUB_TOKEN in the server environment." });
  }

  try {
    const issues = await fetchIssues(owner, repo, state, token);
    const hierarchy = buildWorkItemHierarchy(issues);
    return res.json({
      repository: { owner, repo },
      totals: { issues: issues.length, epics: hierarchy.epics.length, bugs: hierarchy.bugs.length },
      hierarchy,
    });
  } catch (error) {
    const apiError = error instanceof GitHubApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(apiError?.statusCode || 500).json({
      error: "Failed to load issues from GitHub.",
      details: apiError?.details || message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`git-backlog-manager listening on http://localhost:${PORT}`);
});