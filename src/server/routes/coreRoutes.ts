import type { Express, Request, Response } from "express";
import {
  buildCreateLabels,
  buildWorkItemHierarchy,
  existingSlugsFor,
  uniqueSlug,
  validateCreateWorkItem,
} from "../../shared/workItems";
import { isValidRepoPart, resolveToken, tokenSource } from "../requestContext";
import { AUTH_CONFIGURED, publicUser } from "../auth";
import {
  GitHubApiError,
  createGitHubIssue,
  ensureLabels,
  fetchIssueById,
  fetchIssues,
  fetchRepositories,
  fetchRepositoryReadme,
  updateGitHubIssue,
} from "../githubRest";
import { fetchConversationComments, saveConversationComment, type ConversationMessage } from "../conversationStore";
import { getAIResponse } from "../aiAssistant";

export function registerCoreRoutes(app: Express): void {
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.get("/api/config", (req: Request, res: Response) => {
    res.json({
      owner: process.env.GITHUB_OWNER || "",
      authRequired: AUTH_CONFIGURED,
      authenticated: AUTH_CONFIGURED ? Boolean(req.authSession) : true,
      user: req.authSession ? publicUser(req.authSession.user) : null,
    });
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
}
