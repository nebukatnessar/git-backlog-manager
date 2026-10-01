import type { Express, Request, Response } from "express";
import {
  buildAgentQuestionsComment,
  parseAgentQuestions,
  withAgentAnswers,
  type AgentQuestion,
} from "../../shared/agentQuestions";
import {
  addIssueLabels,
  ensureLabelsExist as ensureGitHubLabelsExist,
  fetchIssueComments,
  removeIssueLabel,
  updateIssueComment,
} from "../github";
import { labelColor as agentLabelColor } from "../agentLabels";
import {
  MistralApiError,
  checkGitHubPatForMcp,
  ensureRepoImplementAgent,
  ensureRepoScopingAgent,
  findRepoAgent,
  findRepoScopingAgent,
  getAgentById,
  getConversationHistory,
  listModels,
  loadAgentPrompt,
  modelSupportsConnectors,
} from "../mistralAgents";
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
} from "../implementAgent";
import {
  getLatestScopingRun,
  isScopingRunActiveForIssue,
  listAllScopingRuns,
  startScopingRun,
} from "../scopingAgent";
import { resolveAgentToken, resolveIssueTarget, resolveToken } from "../requestContext";
import { GitHubApiError, fetchIssueById } from "../githubRest";

interface AgentBootstrap {
  agentId: string;
  connectorId: string;
}

export function registerAgentRoutes(app: Express, projectDir: string): void {
  const agentBootstraps = new Map<string, AgentBootstrap>();
  const scopingBootstraps = new Map<string, AgentBootstrap>();
  let modelValidated = false;
  let scopingModelValidated = false;

  async function getImplementAgent(token: string, owner: string, repo: string): Promise<AgentBootstrap> {
    const mistralApiKey = process.env.MISTRAL_API_KEY || "";
    if (!mistralApiKey) throw new Error("MISTRAL_API_KEY is not configured in the server environment.");
    const githubPat = resolveAgentToken(process.env.GITHUB_PAT || token);
    if (!githubPat) throw new Error("No GitHub token available. Set AGENT_GITHUB_TOKEN, GITHUB_PAT or GITHUB_TOKEN.");

    const cacheKey = `${owner}/${repo}`.toLowerCase();
    if (agentBootstraps.has(cacheKey)) {
      return agentBootstraps.get(cacheKey)!;
    }

    const patCheck = await checkGitHubPatForMcp(githubPat);
    if (!patCheck.ok) {
      throw new Error(patCheck.message);
    }
    console.log(`Implement agent GitHub token validated for MCP (login: ${patCheck.login || "unknown"})`);

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
    console.log(`Scoping agent GitHub token validated for MCP (login: ${patCheck.login || "unknown"})`);

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

  app.post("/api/repos/:repo/issues/:issueNumber/implement", async (req: Request, res: Response) => {
    const target = resolveIssueTarget(req);
    if ("error" in target) return res.status(400).json({ error: target.error });
    const { owner, repo, issueNumber } = target;

    const token = resolveToken(req);
    if (!token) return res.status(401).json({ error: "No GitHub token configured." });

    try {
      const issue = await fetchIssueById(owner, repo, issueNumber, token);
      if (!isEligibleForImplementation(issue)) {
        return res.status(409).json({ error: "Issue needs both type:task or type:bug and actionable:ready labels to be implemented." });
      }
      if (hasInProgressLabel(issue)) {
        if (isRunActiveForIssue(owner, repo, issueNumber)) {
          return res.status(409).json({ error: "An agent run is already in progress for this issue." });
        }
        console.log(`Stale agent:in-progress label found on ${owner}/${repo}#${issueNumber} with no active run; clearing it.`);
        await removeIssueLabel(token, owner, repo, issueNumber, "agent:in-progress");
      }

      const bootstrap = await getImplementAgent(token, owner, repo);
      const run = await startAgentRun(process.env.MISTRAL_API_KEY || "", bootstrap.agentId, resolveAgentToken(process.env.GITHUB_PAT || token), owner, repo, issueNumber);
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
          isTask: (issue.labels || []).some((label) => (typeof label === "string" ? label : label.name)?.toLowerCase() === "type:task" || (typeof label === "string" ? label : label.name)?.toLowerCase() === "type:bug"),
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
      if (!labels.includes("type:task") && !labels.includes("type:bug")) {
        return res.status(409).json({ error: "Only task or bug issues can be scoped by the agent." });
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
    const githubPat = resolveAgentToken(process.env.GITHUB_PAT || token);
    if (!githubPat) return res.status(401).json({ error: "No GitHub token configured." });

    try {
      const result = await checkGitHubPatForMcp(githubPat);
      return res.status(result.ok ? 200 : 400).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: message });
    }
  });
}
