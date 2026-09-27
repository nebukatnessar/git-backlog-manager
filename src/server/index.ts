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

// AI Conversation storage
const AI_CONVERSATION_MARKER = "<!-- AI_CONVERSATION -->";

interface ConversationMessage {
  role: "user" | "model";
  content: string;
}

async function fetchConversationComments(owner: string, repo: string, issueId: number, token: string): Promise<ConversationMessage[]> {
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues/${issueId}/comments`);

  const response = await fetch(url, { headers: githubHeaders(token) });
  if (!response.ok) throw new GitHubApiError(response.status, await response.text());

  interface GitHubComment {
    id: number;
    body: string;
    user?: { login: string };
  }

  const comments = (await response.json()) as GitHubComment[];
  
  // Find the comment that contains our AI conversation marker
  const conversationComment = comments.find((c) => c.body.includes(AI_CONVERSATION_MARKER));
  
  if (!conversationComment) return [];
  
  try {
    // Extract JSON from the comment body
    const body = conversationComment.body;
    const jsonStart = body.indexOf("{");
    const jsonEnd = body.lastIndexOf("}") + 1;
    
    if (jsonStart === -1 || jsonEnd <= jsonStart) return [];
    
    const jsonStr = body.slice(jsonStart, jsonEnd);
    const parsed = JSON.parse(jsonStr) as { conversation?: ConversationMessage[] };
    return parsed.conversation || [];
  } catch (error) {
    console.warn("Failed to parse conversation from comment:", error);
    return [];
  }
}

async function saveConversationComment(
  owner: string, 
  repo: string, 
  issueId: number, 
  token: string,
  conversation: ConversationMessage[]
): Promise<void> {
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues/${issueId}/comments`);
  
  // First, try to find and update existing conversation comment
  try {
    const comments = await fetchConversationComments(owner, repo, issueId, token);
    const existingComment = comments.length > 0;
    
    if (existingComment) {
      // We need to find the comment ID to update it
      const commentsUrl = new URL(`https://api.github.com/repos/${owner}/${repo}/issues/${issueId}/comments`);
      const commentsResponse = await fetch(commentsUrl, { headers: githubHeaders(token) });
      if (!commentsResponse.ok) throw new GitHubApiError(commentsResponse.status, await commentsResponse.text());
      
      interface GitHubComment {
        id: number;
        body: string;
      }
      
      const allComments = (await commentsResponse.json()) as GitHubComment[];
      const conversationComment = allComments.find((c) => c.body.includes(AI_CONVERSATION_MARKER));
      
      if (conversationComment) {
        // Update existing comment
        const updateUrl = new URL(`https://api.github.com/repos/${owner}/${repo}/issues/comments/${conversationComment.id}`);
        await fetch(updateUrl, {
          method: "PATCH",
          headers: githubHeaders(token, true),
          body: JSON.stringify({
            body: `${AI_CONVERSATION_MARKER}\n${JSON.stringify({ conversation })}`
          }),
        });
        return;
      }
    }
  } catch (error) {
    // If we can't find existing comment, just create a new one
    console.warn("Could not update existing conversation comment, creating new one:", error);
  }

  // Create new comment
  await fetch(url, {
    method: "POST",
    headers: githubHeaders(token, true),
    body: JSON.stringify({
      body: `${AI_CONVERSATION_MARKER}\n${JSON.stringify({ conversation })}`
    }),
  });
}

// AI Assistant - System instruction
const AI_SYSTEM_INSTRUCTION = `
You are an expert Agile Product Owner and writing assistant built directly into a work-item editor.
Your task is to help the user refine, detail, and polish their work item description.

RULES:
1. Ground your suggestions in the current description and all context provided.
2. When the user asks for suggestions or improvements, offer 2-3 specific options or actionable questions (e.g., acceptance criteria, edge cases, scope constraints). And provide numbers to each option for clarity.
3. Whenever you propose an updated version of the description, wrap the complete, updated text inside a triple-backtick markdown block tagged with \`work_item_update\` like this:

\`\`\`work_item_update
[Refined text goes here...]
\`\`\`

4. Keep chat responses concise, helpful, and collaborative.
5. Try to not ask more then 1 question at a time.
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

function tokenSource(req: Request): { source: "authorization-header" | "GITHUB_TOKEN" | "GITHUB_PAT" | "none"; masked: string } {
  const authHeader = req.get("authorization") || "";
  const headerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (headerToken) return { source: "authorization-header", masked: maskToken(headerToken) };
  if (process.env.GITHUB_TOKEN) return { source: "GITHUB_TOKEN", masked: maskToken(process.env.GITHUB_TOKEN) };
  if (process.env.GITHUB_PAT) return { source: "GITHUB_PAT", masked: maskToken(process.env.GITHUB_PAT) };
  return { source: "none", masked: "" };
}

function maskToken(token: string): string {
  if (token.length <= 8) return `${token.slice(0, 2)}...`;
  return `${token.slice(0, 4)}...${token.slice(-4)} (len ${token.length})`;
}

app.get("/api/token/check", async (req: Request, res: Response) => {
  const info = tokenSource(req);
  const token = resolveToken(req);
  if (!token) {
    return res.json({ configured: false, source: info.source, masked: info.masked, message: "No GitHub token configured. Set GITHUB_TOKEN or GITHUB_PAT." });
  }

  try {
    const rest = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "git-backlog-manager", Accept: "application/vnd.github+json" },
    });
    if (!rest.ok) {
      const body = await rest.text();
      return res.status(400).json({
        configured: true,
        source: info.source,
        masked: info.masked,
        valid: false,
        message: `GitHub REST API rejected the ${info.source} token (status ${rest.status}): ${body.slice(0, 300)}`,
      });
    }
    const user = (await rest.json()) as { login?: string };
    return res.json({ configured: true, source: info.source, masked: info.masked, valid: true, login: user.login });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ configured: true, source: info.source, masked: info.masked, valid: false, message });
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

// AI Conversation endpoints
app.get("/api/repos/:repo/issues/:issueNumber/conversation", async (req: Request, res: Response) => {
  const owner = String(req.query.owner || process.env.GITHUB_OWNER || "").trim();
  const repo = String(req.params.repo).trim();
  const issueNumber = Number(req.params.issueNumber);

  if (!owner || !repo || !isValidRepoPart(owner) || !isValidRepoPart(repo)) {
    return res.status(400).json({ error: "Provide valid owner and repo parameters." });
  }
  if (!issueNumber || issueNumber <= 0) {
    return res.status(400).json({ error: "Provide a valid issue number." });
  }

  const token = resolveToken(req);
  if (!token) {
    return res.status(401).json({ error: "No GitHub token configured." });
  }

  try {
    const conversation = await fetchConversationComments(owner, repo, issueNumber, token);
    return res.json({ conversation });
  } catch (error) {
    const apiError = error instanceof GitHubApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(apiError?.statusCode || 500).json({
      error: "Failed to load conversation from GitHub.",
      details: apiError?.details || message,
    });
  }
});

app.post("/api/repos/:repo/issues/:issueNumber/conversation", async (req: Request, res: Response) => {
  const owner = String(req.query.owner || req.body?.owner || process.env.GITHUB_OWNER || "").trim();
  const repo = String(req.params.repo).trim();
  const issueNumber = Number(req.params.issueNumber);
  const conversation: ConversationMessage[] = req.body?.conversation || [];

  if (!owner || !repo || !isValidRepoPart(owner) || !isValidRepoPart(repo)) {
    return res.status(400).json({ error: "Provide valid owner and repo parameters." });
  }
  if (!issueNumber || issueNumber <= 0) {
    return res.status(400).json({ error: "Provide a valid issue number." });
  }

  const token = resolveToken(req);
  if (!token) {
    return res.status(401).json({ error: "No GitHub token configured." });
  }

  try {
    await saveConversationComment(owner, repo, issueNumber, token, conversation);
    return res.json({ ok: true, message: "Conversation saved successfully." });
  } catch (error) {
    const apiError = error instanceof GitHubApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(apiError?.statusCode || 500).json({
      error: "Failed to save conversation to GitHub.",
      details: apiError?.details || message,
    });
  }
});

// Implement agent endpoints

interface AgentBootstrap {
  agentId: string;
  connectorId: string;
}

const agentBootstraps = new Map<string, AgentBootstrap>();
const scopingBootstraps = new Map<string, AgentBootstrap>();
let modelValidated = false;
let scopingModelValidated = false;

async function getImplementAgent(token: string, owner: string, repo: string): Promise<AgentBootstrap> {
  const mistralApiKey = process.env.MISTRAL_API_KEY || "";
  if (!mistralApiKey) throw new Error("MISTRAL_API_KEY is not configured in the server environment.");
  const githubPat = process.env.GITHUB_PAT || token;
  if (!githubPat) throw new Error("No GitHub token available. Set GITHUB_PAT or GITHUB_TOKEN.");

  const cacheKey = `${owner}/${repo}`.toLowerCase();
  if (agentBootstraps.has(cacheKey)) {
    return agentBootstraps.get(cacheKey)!;
  }

  const patCheck = await checkGitHubPatForMcp(githubPat);
  if (!patCheck.ok) {
    throw new Error(patCheck.message);
  }
  console.log(`GITHUB_PAT validated for the MCP agent (login: ${patCheck.login || "unknown"})`);

  const configuredModel = process.env.MISTRAL_AGENT_MODEL || "devstral-2-latest";
  if (!modelValidated) {
    const models = await listModels(mistralApiKey);
    const match = models.find((model) => model.id === configuredModel);
    if (match && !modelSupportsConnectors(match)) {
      throw new Error(
        `MISTRAL_AGENT_MODEL '${configuredModel}' does not support connectors (needed for the GitHub MCP tools); pick a function-calling model from GET /api/agent/models — e.g. devstral-2-latest.`,
      );
    }
    modelValidated = true;
  }

  const bootstrap = await ensureRepoImplementAgent(mistralApiKey, githubPat, projectDir, owner, repo);
  agentBootstraps.set(cacheKey, bootstrap);
  return bootstrap;
}

async function getScopingAgent(token: string, owner: string, repo: string): Promise<AgentBootstrap> {
  const mistralApiKey = process.env.MISTRAL_API_KEY || "";
  if (!mistralApiKey) throw new Error("MISTRAL_API_KEY is not configured in the server environment.");
  const githubPat = process.env.GITHUB_PAT || token;
  if (!githubPat) throw new Error("No GitHub token available. Set GITHUB_PAT or GITHUB_TOKEN.");

  const cacheKey = `${owner}/${repo}`.toLowerCase();
  if (scopingBootstraps.has(cacheKey)) {
    return scopingBootstraps.get(cacheKey)!;
  }

  const patCheck = await checkGitHubPatForMcp(githubPat);
  if (!patCheck.ok) {
    throw new Error(patCheck.message);
  }
  console.log(`GITHUB_PAT validated for the MCP agent (login: ${patCheck.login || "unknown"})`);

  const configuredModel = process.env.MISTRAL_SCOPING_MODEL || process.env.MISTRAL_AGENT_MODEL || "devstral-2-latest";
  if (!scopingModelValidated) {
    const models = await listModels(mistralApiKey);
    const match = models.find((model) => model.id === configuredModel);
    if (match && !modelSupportsConnectors(match)) {
      throw new Error(
        `MISTRAL_SCOPING_MODEL '${configuredModel}' does not support connectors (needed for the GitHub MCP tools); pick a function-calling model from GET /api/agent/models — e.g. devstral-2-latest.`,
      );
    }
    scopingModelValidated = true;
  }

  const bootstrap = await ensureRepoScopingAgent(mistralApiKey, githubPat, projectDir, owner, repo);
  scopingBootstraps.set(cacheKey, bootstrap);
  return bootstrap;
}

function resolveIssueTarget(req: Request): { owner: string; repo: string; issueNumber: number } | { error: string } {
  const owner = String(req.query.owner || req.body?.owner || process.env.GITHUB_OWNER || "").trim();
  const repo = String(req.params.repo || req.query.repo || req.body?.repo || "").trim();
  const issueNumber = Number(req.params.issueNumber || req.query.issueNumber);

  if (!owner || !isValidRepoPart(owner) || !repo || !isValidRepoPart(repo)) {
    return { error: "Provide valid owner and repo parameters." };
  }
  if (!issueNumber || issueNumber <= 0) {
    return { error: "Provide a valid issue number." };
  }
  return { owner, repo, issueNumber };
}

app.post("/api/repos/:repo/issues/:issueNumber/implement", async (req: Request, res: Response) => {
  const target = resolveIssueTarget(req);
  if ("error" in target) return res.status(400).json({ error: target.error });
  const { owner, repo, issueNumber } = target;

  const token = resolveToken(req);
  if (!token) return res.status(401).json({ error: "No GitHub token configured." });

  try {
    const issue = await fetchIssueById(owner, repo, issueNumber, token);
    if (!isEligibleForImplementation(issue)) {
      return res.status(409).json({ error: "Issue needs both type:task and actionable:ready labels to be implemented." });
    }
    if (hasInProgressLabel(issue)) {
      if (isRunActiveForIssue(owner, repo, issueNumber)) {
        return res.status(409).json({ error: "An agent run is already in progress for this issue." });
      }
      console.log(`Stale agent:in-progress label found on ${owner}/${repo}#${issueNumber} with no active run; clearing it.`);
      await removeIssueLabel(token, owner, repo, issueNumber, "agent:in-progress");
    }

    const bootstrap = await getImplementAgent(token, owner, repo);
    const run = await startAgentRun(process.env.MISTRAL_API_KEY || "", bootstrap.agentId, process.env.GITHUB_PAT || token, owner, repo, issueNumber);
    return res.status(202).json({ run });
  } catch (error) {
    const githubError = error instanceof GitHubApiError ? error : null;
    const mistralError = error instanceof MistralApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);

    console.error(
      `Failed to start implement agent run for ${owner}/${repo}#${issueNumber}:`,
      githubError || mistralError || error,
    );
    if (!githubError && !mistralError && !(error instanceof Error)) {
      console.error("Raw error value:", error);
    }

    const status = githubError?.statusCode || mistralError?.statusCode || (error instanceof Error ? 500 : 500);
    const details = githubError?.details || mistralError?.details || message;
    return res.status(status).json({
      error: "Failed to start agent run.",
      details,
    });
  }
});

app.get("/api/repos/:repo/issues/:issueNumber/agent-run", async (req: Request, res: Response) => {
  const target = resolveIssueTarget(req);
  if ("error" in target) return res.status(400).json({ error: target.error });
  const { owner, repo, issueNumber } = target;

  const token = resolveToken(req);
  if (!token) return res.status(401).json({ error: "No GitHub token configured." });

  try {
    reapExpiredRuns();
    const issue = await fetchIssueById(owner, repo, issueNumber, token);
    const run = getLatestRun(owner, repo, issueNumber);

    const comments = await fetchIssueComments(token, owner, repo, issueNumber);
    const questionsComment = [...comments]
      .reverse()
      .find((comment) => parseAgentQuestions(comment.body).length > 0);
    const questions = questionsComment ? parseAgentQuestions(questionsComment.body) : [];

    return res.json({
      run: run || null,
      eligibility: {
        isTask: (issue.labels || []).some((label) => (typeof label === "string" ? label : label.name)?.toLowerCase() === "type:task"),
        actionable: (issue.labels || []).map((label) => (typeof label === "string" ? label : label.name)).find((label) => String(label).toLowerCase().startsWith("actionable:")) || "",
        inProgress: hasInProgressLabel(issue),
      },
      questions,
      questionsCommentId: questionsComment?.id || null,
      concurrency: { activeRuns: activeRunCount(), maxRuns: MAX_CONCURRENT_AGENT_RUNS },
      budgetMs: AGENT_RUN_BUDGET_MS,
    });
  } catch (error) {
    const apiError = error instanceof GitHubApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(apiError?.statusCode || 500).json({
      error: "Failed to load agent run status.",
      details: apiError?.details || message,
    });
  }
});

app.post("/api/repos/:repo/issues/:issueNumber/scope", async (req: Request, res: Response) => {
  const target = resolveIssueTarget(req);
  if ("error" in target) return res.status(400).json({ error: target.error });
  const { owner, repo, issueNumber } = target;

  const token = resolveToken(req);
  if (!token) return res.status(401).json({ error: "No GitHub token configured." });

  try {
    const issue = await fetchIssueById(owner, repo, issueNumber, token);
    const labels = (issue.labels || []).map((label) =>
      typeof label === "string" ? label.toLowerCase() : (label.name || "").toLowerCase(),
    );
    if (!labels.includes("type:task")) {
      return res.status(409).json({ error: "Only task issues can be scoped by the agent." });
    }
    const actionable = labels.find((label) => label.startsWith("actionable:"));
    if (actionable === "actionable:ready") {
      return res.status(409).json({ error: "Issue is already actionable:ready; no scoping needed." });
    }
    if (isScopingRunActiveForIssue(owner, repo, issueNumber)) {
      return res.status(409).json({ error: "A scoping run is already in progress for this issue." });
    }

    const bootstrap = await getScopingAgent(token, owner, repo);
    const run = await startScopingRun(
      process.env.MISTRAL_API_KEY || "",
      bootstrap.agentId,
      process.env.GITHUB_PAT || token,
      owner,
      repo,
      issueNumber,
      issue.title || "",
      issue.body || "",
    );
    return res.status(202).json({ run });
  } catch (error) {
    const githubError = error instanceof GitHubApiError ? error : null;
    const mistralError = error instanceof MistralApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);

    console.error(
      `Failed to start scoping agent run for ${owner}/${repo}#${issueNumber}:`,
      githubError || mistralError || error,
    );

    const status = githubError?.statusCode || mistralError?.statusCode || 500;
    const details = githubError?.details || mistralError?.details || message;
    return res.status(status).json({
      error: "Failed to start scoping run.",
      details,
    });
  }
});

app.get("/api/repos/:repo/issues/:issueNumber/scoping-run", async (req: Request, res: Response) => {
  const target = resolveIssueTarget(req);
  if ("error" in target) return res.status(400).json({ error: target.error });
  const { owner, repo, issueNumber } = target;

  const run = getLatestScopingRun(owner, repo, issueNumber);
  return res.json({ run: run || null });
});

app.get("/api/agent/runs", async (req: Request, res: Response) => {
  reapExpiredRuns();
  const owner = String(req.query.owner || "").trim().toLowerCase();
  const repo = String(req.query.repo || "").trim().toLowerCase();

  const scopeRuns = <T extends { owner: string; repo: string }>(runs: T[]): T[] =>
    owner && repo ? runs.filter((run) => run.owner.toLowerCase() === owner && run.repo.toLowerCase() === repo) : runs;

  return res.json({
    implementRuns: scopeRuns(listAllRuns()),
    scopingRuns: scopeRuns(listAllScopingRuns()),
    concurrency: { activeRuns: activeRunCount(), maxRuns: MAX_CONCURRENT_AGENT_RUNS },
    budgetMs: AGENT_RUN_BUDGET_MS,
  });
});

app.post("/api/repos/:repo/issues/:issueNumber/answers", async (req: Request, res: Response) => {
  const target = resolveIssueTarget(req);
  if ("error" in target) return res.status(400).json({ error: target.error });
  const { owner, repo, issueNumber } = target;

  const token = resolveToken(req);
  if (!token) return res.status(401).json({ error: "No GitHub token configured." });

  const answers: unknown = req.body?.answers;
  if (!Array.isArray(answers) || answers.some((answer) => typeof answer !== "string")) {
    return res.status(400).json({ error: "Provide answers as an array of strings." });
  }

  try {
    const comments = await fetchIssueComments(token, owner, repo, issueNumber);
    const questionsComment = [...comments]
      .reverse()
      .find((comment) => parseAgentQuestions(comment.body).length > 0);
    if (!questionsComment) {
      return res.status(404).json({ error: "No agent questions comment found on this issue." });
    }

    const questions: AgentQuestion[] = parseAgentQuestions(questionsComment.body);
    const updated = withAgentAnswers(questions, answers as string[]);
    if (!updated.some((question) => question.answers.length > 0)) {
      return res.status(400).json({ error: "Provide at least one non-empty answer." });
    }

    await updateIssueComment(token, owner, repo, questionsComment.id, buildAgentQuestionsComment(updated));
    await ensureGitHubLabelsExist(token, owner, repo, ["actionable:ready", "actionable:rejected"], agentLabelColor);
    await addIssueLabels(token, owner, repo, issueNumber, ["actionable:ready"]);
    await removeIssueLabel(token, owner, repo, issueNumber, "actionable:rejected");

    return res.json({ ok: true, questions: updated });
  } catch (error) {
    const apiError = error instanceof GitHubApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(apiError?.statusCode || 500).json({
      error: "Failed to save answers on GitHub.",
      details: apiError?.details || message,
    });
  }
});

app.get("/api/agent/prompt", (_req: Request, res: Response) => {
  res.json({ prompt: loadAgentPrompt(projectDir) });
});

app.get("/api/agent/debug", async (req: Request, res: Response) => {
  const mistralApiKey = process.env.MISTRAL_API_KEY || "";
  if (!mistralApiKey) return res.status(400).json({ error: "MISTRAL_API_KEY is not configured in the server environment." });

  const owner = String(req.query.owner || process.env.GITHUB_OWNER || "").trim().toLowerCase();
  const repo = String(req.query.repo || "").trim().toLowerCase();
  if (!owner || !repo) {
    return res.status(400).json({ error: "Provide owner and repo query parameters, e.g. /api/agent/debug?owner=X&repo=Y." });
  }

  try {
    const [agent, scopingAgent] = await Promise.all([
      findRepoAgent(mistralApiKey, owner, repo),
      findRepoScopingAgent(mistralApiKey, owner, repo),
    ]);
    const full = agent ? await getAgentById(mistralApiKey, agent.id) : null;
    const fullScoping = scopingAgent ? await getAgentById(mistralApiKey, scopingAgent.id) : null;
    return res.json({
      configuredModel: process.env.MISTRAL_AGENT_MODEL || "devstral-2-latest",
      configuredScopingModel: process.env.MISTRAL_SCOPING_MODEL || process.env.MISTRAL_AGENT_MODEL || "devstral-2-latest",
      agent: full,
      scopingAgent: fullScoping,
    });
  } catch (error) {
    const mistralError = error instanceof MistralApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(mistralError?.statusCode || 500).json({
      error: "Failed to load agent configuration.",
      details: mistralError?.details || message,
    });
  }
});

app.get("/api/agent/conversations/:conversationId/history", async (req: Request, res: Response) => {
  const mistralApiKey = process.env.MISTRAL_API_KEY || "";
  if (!mistralApiKey) return res.status(400).json({ error: "MISTRAL_API_KEY is not configured in the server environment." });

  const conversationId = String(req.params.conversationId || "").trim();
  if (!/^conv_[A-Za-z0-9]+$/.test(conversationId)) {
    return res.status(400).json({ error: "Provide a valid conversation id (conv_...)." });
  }

  try {
    const entries = await getConversationHistory(mistralApiKey, conversationId);
    const summarized = entries.map((entry) => ({
      type: entry.type || entry.object || "entry",
      role: entry.role || null,
      name: entry.name || null,
      content: typeof entry.content === "string" ? entry.content : entry.content || null,
      output: entry.output || null,
    }));
    return res.json({ conversationId, entryCount: entries.length, entries: summarized });
  } catch (error) {
    const mistralError = error instanceof MistralApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(mistralError?.statusCode || 500).json({
      error: "Failed to load conversation history.",
      details: mistralError?.details || message,
    });
  }
});

app.get("/api/agent/models", async (_req: Request, res: Response) => {
  const mistralApiKey = process.env.MISTRAL_API_KEY || "";
  if (!mistralApiKey) return res.status(400).json({ error: "MISTRAL_API_KEY is not configured in the server environment." });

  try {
    const models = await listModels(mistralApiKey);
    const configuredModel = process.env.MISTRAL_AGENT_MODEL || "devstral-2-latest";
    return res.json({
      configuredModel,
      configuredModelSupportsConnectors: models.filter((m) => m.id === configuredModel).some(modelSupportsConnectors),
      models: models
        .map((model) => ({
          id: model.id,
          name: model.name,
          description: model.description,
          supportsConnectors: modelSupportsConnectors(model),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
  } catch (error) {
    const mistralError = error instanceof MistralApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(mistralError?.statusCode || 500).json({
      error: "Failed to list available Mistral models.",
      details: mistralError?.details || message,
    });
  }
});

app.get("/api/agent/check", async (req: Request, res: Response) => {
  const token = resolveToken(req);
  const githubPat = process.env.GITHUB_PAT || token;
  if (!githubPat) return res.status(401).json({ error: "No GitHub token configured." });

  try {
    const result = await checkGitHubPatForMcp(githubPat);
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`git-backlog-manager listening on http://localhost:${PORT}`);
});