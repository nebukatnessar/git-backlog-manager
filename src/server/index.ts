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