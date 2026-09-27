import express, { type Request, type Response } from "express";
import path from "node:path";
import dotenv from "dotenv";

// Load .env from the project root directory, not the current working directory
const projectDir = path.resolve(__dirname, "../../");
dotenv.config({ path: path.join(projectDir, ".env") });
import {
  buildCreateLabels,
  buildWorkItemHierarchy,
  existingSlugsFor,
  uniqueSlug,
  validateCreateWorkItem,
  type GitHubIssue,
} from "../shared/workItems";
import {
  AGENT_CONVERSATION_MARKER,
  buildAgentQuestionsComment,
  parseAgentQuestions,
  withAgentAnswers,
  type AgentQuestion,
} from "../shared/agentQuestions";
import {
  addIssueLabels,
  ensureLabelsExist as ensureGitHubLabelsExist,
  fetchIssue,
  fetchIssueComments,
  removeIssueLabel,
  updateIssueComment,
} from "./github";
import { labelColor as agentLabelColor } from "./agentLabels";
import { MistralApiError, checkGitHubPatForMcp, ensureRepoImplementAgent, ensureRepoScopingAgent, findRepoAgent, findRepoScopingAgent, getAgentById, getConversationHistory, listModels, loadAgentPrompt, modelSupportsConnectors } from "./mistralAgents";
import {
  AGENT_RUN_BUDGET_MS,
  MAX_CONCURRENT_AGENT_RUNS,
  activeRunCount,
  getLatestRun,
  hasInProgressLabel,
  isEligibleForImplementation,
  isRunActiveForIssue,
  listAllRuns,
  reapExpiredRuns,
  startAgentRun,
} from "./implementAgent";
import {
  getLatestScopingRun,
  isScopingRunActiveForIssue,
  listAllScopingRuns,
  startScopingRun,
} from "./scopingAgent";

const PORT = Number(process.env.PORT || 3000);
const app = express();
app.use(express.json());

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

function resolveToken(req: Request): string {
  const authHeader = req.get("authorization") || "";
  const headerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  return headerToken || process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || "";
}

function resolveAgentToken(fallback: string): string {
  return process.env.AGENT_GITHUB_TOKEN || fallback;
}

function githubHeaders(token: string, jsonBody = false): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "git-backlog-manager",
    ...(jsonBody ? { "Content-Type": "application/json" } : {}),
  };
}

function labelColor(name: string): string {
  if (name.startsWith("type:")) return "62d9b2";
  if (name.startsWith("status:")) return "f2b56b";
  if (name.startsWith("priority:")) return "e98282";
  return "6e7681";
}

async function ensureLabels(owner: string, repo: string, token: string, labels: string[]): Promise<void> {
  const existing = new Set<string>();
  let page = 1;

  while (true) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/labels`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, { headers: githubHeaders(token) });
    if (!response.ok) throw new GitHubApiError(response.status, await response.text());

    const batch = (await response.json()) as Array<{ name: string }>;
    for (const label of batch) existing.add(label.name.toLowerCase());
    if (batch.length < 100) break;
    page += 1;
  }

  for (const name of labels) {
    if (existing.has(name.toLowerCase())) continue;

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/labels`, {
      method: "POST",
      headers: githubHeaders(token, true),
      body: JSON.stringify({ name, color: labelColor(name) }),
    });

    if (response.ok || response.status === 422) continue;
    throw new GitHubApiError(response.status, await response.text());
  }
}

async function createGitHubIssue(owner: string, repo: string, token: string, title: string, labels: string[]): Promise<GitHubIssue> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: githubHeaders(token, true),
    body: JSON.stringify({ title, labels }),
  });

  if (!response.ok) throw new GitHubApiError(response.status, await response.text());
  return (await response.json()) as GitHubIssue;
}

async function fetchIssues(owner: string, repo: string, state: string, token: string): Promise<GitHubIssue[]> {
  const issues: GitHubIssue[] = [];
  let page = 1;

  while (true) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues`);
    url.searchParams.set("state", state || "all");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, { headers: githubHeaders(token) });
    if (!response.ok) throw new GitHubApiError(response.status, await response.text());

    const batch = (await response.json()) as Array<GitHubIssue & { pull_request?: unknown }>;
    issues.push(...batch.filter((item) => !item.pull_request));

    if (batch.length < 100) break;
    page += 1;
  }

  return issues;
}

async function fetchIssueById(owner: string, repo: string, issueId: number, token: string): Promise<GitHubIssue> {
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues/${issueId}`);

  const response = await fetch(url, { headers: githubHeaders(token) });
  if (!response.ok) throw new GitHubApiError(response.status, await response.text());

  const issue = (await response.json()) as GitHubIssue & { pull_request?: unknown };
  if (issue.pull_request) throw new GitHubApiError(404, "Issue is a pull request");

  return issue;
}

async function fetchRepositoryReadme(owner: string, repo: string, token: string): Promise<string> {
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/readme`);

  const response = await fetch(url, { headers: githubHeaders(token) });
  if (!response.ok) {
    // If README doesn't exist, return empty string (not an error)
    if (response.status === 404) return "";
    throw new GitHubApiError(response.status, await response.text());
  }

  interface ReadmeResponse {
    content: string;
    encoding: string;
  }

  const data = (await response.json()) as ReadmeResponse;
  
  // Decode base64 content
  if (data.encoding === "base64") {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }
  
  return data.content;
}

async function updateGitHubIssue(owner: string, repo: string, issueId: number, token: string, body: string): Promise<GitHubIssue> {
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues/${issueId}`);

  const response = await fetch(url, {
    method: "PATCH",
    headers: githubHeaders(token, true),
    body: JSON.stringify({ body }),
  });

  if (!response.ok) throw new GitHubApiError(response.status, await response.text());

  const issue = (await response.json()) as GitHubIssue & { pull_request?: unknown };
  if (issue.pull_request) throw new GitHubApiError(404, "Issue is a pull request");

  return issue;
}