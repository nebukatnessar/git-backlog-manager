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