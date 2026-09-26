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
  return headerToken || process.env.GITHUB_TOKEN || "";
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

// AI Assistant - System instruction
const AI_SYSTEM_INSTRUCTION = `
You are an expert Agile Product Owner and writing assistant built directly into a work-item editor.
Your task is to help the user refine, detail, and polish their work item description.

RULES:
1. Ground your suggestions in the current description and all context provided.
2. When the user asks for suggestions or improvements, offer 2-3 specific options or actionable questions (e.g., acceptance criteria, edge cases, scope constraints).
3. Whenever you propose an updated version of the description, wrap the complete, updated text inside a triple-backtick markdown block tagged with \`work_item_update\` like this:

\`\`\`work_item_update
[Refined text goes here...]
\`\`\`

4. Keep chat responses concise, helpful, and collaborative.
`;

async function getAIResponse(
  prompt: string, 
  context: string, 
  history: Array<{ role: string; content: string }>,
  additionalContext: { workItemTitle?: string; parentEpic?: { title: string; description: string }; parentFeature?: { title: string; description: string }; repositoryReadme?: string } = {}
): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY || "";
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY is not configured in the server environment.");
  }

  // Build enriched context for the AI
  const contextParts: string[] = [];
  
  if (additionalContext.workItemTitle) {
    contextParts.push(`[WORK ITEM TITLE]: ${additionalContext.workItemTitle}`);
  }
  
  if (additionalContext.parentEpic) {
    contextParts.push(`[PARENT EPIC]: ${additionalContext.parentEpic.title}`);
    if (additionalContext.parentEpic.description) {
      contextParts.push(`[EPIC DESCRIPTION]: ${additionalContext.parentEpic.description}`);
    }
  }
  
  if (additionalContext.parentFeature) {
    contextParts.push(`[PARENT FEATURE]: ${additionalContext.parentFeature.title}`);
    if (additionalContext.parentFeature.description) {
      contextParts.push(`[FEATURE DESCRIPTION]: ${additionalContext.parentFeature.description}`);
    }
  }
  
  if (additionalContext.repositoryReadme) {
    contextParts.push(`[REPOSITORY README]:\n${additionalContext.repositoryReadme}`);
  }
  
  contextParts.push(`[CURRENT WORK ITEM DESCRIPTION]:\n${context || "(Empty)"}`);
  
  const fullContext = contextParts.join("\n\n");

  const messages = [
    {
      role: "system",
      content: `${AI_SYSTEM_INSTRUCTION}\n\n${fullContext}`,
    },
    ...history.map((msg) => ({
      role: msg.role === "model" ? "assistant" : "user",
      content: msg.content,
    })),
    { role: "user", content: prompt },
  ];

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.MISTRAL_MODEL || "mistral-large-latest",
      messages,
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mistral API error: ${response.status} - ${errorText}`);
  }

  interface AiResponse {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  }

  const data: AiResponse = await response.json();
  return data.choices?.[0]?.message?.content || "Sorry, I couldn't process that.";
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

    const response = await fetch(url, { headers: githubHeaders(token) });
    if (!response.ok) throw new GitHubApiError(response.status, await response.text());

    const batch = (await response.json()) as GitHubRepository[];
    repositories.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  return repositories;
}

app.use(express.static(path.join(__dirname, "../../public")));

// Middleware to parse JSON
app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get("/api/config", (_req: Request, res: Response) => {
  res.json({ owner: process.env.GITHUB_OWNER || "" });
});

app.post("/api/ai/suggest", async (req: Request, res: Response) => {
  const { prompt, context, history, additionalContext } = req.body || {};

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required." });
  }

  try {
    const aiResponse = await getAIResponse(prompt, context || "", history || [], additionalContext || {});
    return res.json({ response: aiResponse });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

app.get("/api/repos", async (req: Request, res: Response) => {
  const owner = String(req.query.owner || process.env.GITHUB_OWNER || "").trim();
  const token = resolveToken(req);

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

app.get("/api/repos/:repo/readme", async (req: Request, res: Response) => {
  const owner = String(req.query.owner || process.env.GITHUB_OWNER || "").trim();
  const repo = String(req.params.repo).trim();
  const token = resolveToken(req);

  if (!owner || !repo || !isValidRepoPart(owner) || !isValidRepoPart(repo)) {
    return res.status(400).json({ error: "Provide valid owner and repo parameters." });
  }
  if (!token) return res.status(401).json({ error: "No GitHub token configured." });

  try {
    const readme = await fetchRepositoryReadme(owner, repo, token);
    return res.json({ readme });
  } catch (error) {
    const apiError = error instanceof GitHubApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(apiError?.statusCode || 500).json({
      error: "Failed to load repository README.",
      details: apiError?.details || message,
    });
  }
});

app.get("/api/issues/:id", async (req: Request, res: Response) => {
  const owner = String(req.query.owner || process.env.GITHUB_OWNER || "").trim();
  const repo = String(req.query.repo || "").trim();
  const issueId = Number(req.params.id);

  if (!owner || !repo || !isValidRepoPart(owner) || !isValidRepoPart(repo)) {
    return res.status(400).json({ error: "Provide valid owner and repo query parameters." });
  }
  if (!issueId || issueId <= 0) {
    return res.status(400).json({ error: "Provide a valid issue ID." });
  }

  const token = resolveToken(req);
  if (!token) {
    return res.status(401).json({ error: "No GitHub token configured." });
  }

  try {
    const issue = await fetchIssueById(owner, repo, issueId, token);
    return res.json({ issue });
  } catch (error) {
    const apiError = error instanceof GitHubApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(apiError?.statusCode || 500).json({
      error: "Failed to load issue from GitHub.",
      details: apiError?.details || message,
    });
  }
});

app.patch("/api/issues/:id", async (req: Request, res: Response) => {
  const owner = String(req.query.owner || process.env.GITHUB_OWNER || "").trim();
  const repo = String(req.query.repo || "").trim();
  const issueId = Number(req.params.id);
  const body = String(req.body?.body || "").trim();

  if (!owner || !repo || !isValidRepoPart(owner) || !isValidRepoPart(repo)) {
    return res.status(400).json({ error: "Provide valid owner and repo query parameters." });
  }
  if (!issueId || issueId <= 0) {
    return res.status(400).json({ error: "Provide a valid issue ID." });
  }

  const token = resolveToken(req);
  if (!token) {
    return res.status(401).json({ error: "No GitHub token configured." });
  }

  try {
    const issue = await updateGitHubIssue(owner, repo, issueId, token, body);
    return res.json({ issue });
  } catch (error) {
    const apiError = error instanceof GitHubApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(apiError?.statusCode || 500).json({
      error: "Failed to update issue on GitHub.",
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

  const token = resolveToken(req);

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

app.post("/api/issues", async (req: Request, res: Response) => {
  const owner = String(req.body?.owner || process.env.GITHUB_OWNER || "").trim();
  const repo = String(req.body?.repo || "").trim();

  if (!owner || !repo || !isValidRepoPart(owner) || !isValidRepoPart(repo)) {
    return res.status(400).json({ error: "Provide valid owner and repo values." });
  }

  const token = resolveToken(req);
  if (!token) {
    return res.status(401).json({ error: "No GitHub token configured. Provide a bearer token or set GITHUB_TOKEN in the server environment." });
  }

  const parsed = validateCreateWorkItem(req.body || {});
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  try {
    const issues = await fetchIssues(owner, repo, "all", token);
    const hierarchy = buildWorkItemHierarchy(issues);

    if (parsed.value.type === "feature" && !hierarchy.epics.some((epic) => epic.slug === parsed.value.epic)) {
      return res.status(400).json({ error: `Epic "${parsed.value.epic}" was not found in this repository.` });
    }
    if (parsed.value.type === "task") {
      const epic = hierarchy.epics.find((item) => item.slug === parsed.value.epic);
      const feature = epic?.features.find((item) => item.slug === parsed.value.feature);
      if (!feature) {
        return res.status(400).json({ error: `Feature "${parsed.value.epic}/${parsed.value.feature}" was not found in this repository.` });
      }
    }

    const workItem = {
      ...parsed.value,
      slug: uniqueSlug(parsed.value.slug, existingSlugsFor(hierarchy, parsed.value.type, parsed.value)),
    };
    const labels = buildCreateLabels(workItem);
    await ensureLabels(owner, repo, token, labels);
    const issue = await createGitHubIssue(owner, repo, token, workItem.title, labels);
    const updatedIssues = await fetchIssues(owner, repo, String(req.body?.state || "all"), token);
    
    // Ensure the newly created issue is in the list (handle potential GitHub API race conditions)
    const issueAlreadyInList = updatedIssues.some((i) => i.number === issue.number);
    if (!issueAlreadyInList) {
      updatedIssues.push(issue);
    }
    
    const updatedHierarchy = buildWorkItemHierarchy(updatedIssues);

    return res.status(201).json({
      repository: { owner, repo },
      totals: { issues: updatedIssues.length, epics: updatedHierarchy.epics.length, bugs: updatedHierarchy.bugs.length },
      hierarchy: updatedHierarchy,
    });
  } catch (error) {
    const apiError = error instanceof GitHubApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(apiError?.statusCode || 500).json({
      error: "Failed to create work item on GitHub.",
      details: apiError?.details || message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`git-backlog-manager listening on http://localhost:${PORT}`);
});