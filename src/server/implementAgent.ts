import type { GitHubIssue } from "../shared/workItems";
import {
  AGENT_IN_PROGRESS_LABEL,
  IMPLEMENTED_LABEL,
  agentBranchForIssue,
  labelColor,
} from "./agentLabels";
import {
  addIssueLabels,
  createIssueComment,
  ensureLabelsExist,
  fetchIssue,
  fetchIssueComments,
  fetchPullRequestForBranch,
  removeIssueLabel,
} from "./github";
import { appendAgentConversation, startAgentConversation, type ConversationOutputEntry } from "./mistralAgents";

export const MAX_CONCURRENT_AGENT_RUNS = 2;
export const AGENT_RUN_BUDGET_MS = Number(process.env.AGENT_RUN_BUDGET_MS || 45 * 60 * 1000);
const MAX_AGENT_TURNS = Number(process.env.AGENT_MAX_TURNS || 20);
const TURN_TIMEOUT_MS = Number(process.env.AGENT_TURN_TIMEOUT_MS || 10 * 60 * 1000);
const CONTINUE_PROMPT = "Continue working on the issue. Use your tools to explore the repository, write the code, run the tests, then push the branch and open the draft pull request. Do not stop to narrate — act. If you cannot proceed, follow the rejection protocol instead.";

function outputText(outputs: ConversationOutputEntry[]): string {
  return outputs
    .map((entry) =>
      typeof entry.content === "string"
        ? entry.content
        : Array.isArray(entry.content)
          ? entry.content.map((part) => part.text || "").join("")
          : "",
    )
    .filter(Boolean)
    .join("\n");
}

export type AgentRunState = "running" | "done" | "rejected" | "failed";

export interface AgentRun {
  runId: string;
  owner: string;
  repo: string;
  issueNumber: number;
  state: AgentRunState;
  startedAt: number;
  finishedAt?: number;
  conversationId?: string;
  pullRequestUrl?: string;
  questionsCommentUrl?: string;
  message?: string;
}

const runs = new Map<string, AgentRun>();

function runsForIssue(owner: string, repo: string, issueNumber: number): AgentRun[] {
  return [...runs.values()].filter((run) => run.owner === owner && run.repo === repo && run.issueNumber === issueNumber);
}

export function activeRunCount(): number {
  return [...runs.values()].filter((run) => run.state === "running").length;
}

export function getRun(runId: string): AgentRun | undefined {
  return runs.get(runId);
}

export function getLatestRun(owner: string, repo: string, issueNumber: number): AgentRun | undefined {
  const issueRuns = runsForIssue(owner, repo, issueNumber);
  return issueRuns.length ? issueRuns[issueRuns.length - 1] : undefined;
}

export function isEligibleForImplementation(issue: GitHubIssue): boolean {
  const labels = (issue.labels || []).map((label) =>
    typeof label === "string" ? label.toLowerCase() : (label.name || "").toLowerCase(),
  );
  return labels.includes("type:task") && labels.includes("actionable:ready");
}

export function hasInProgressLabel(issue: GitHubIssue): boolean {
  const labels = (issue.labels || []).map((label) =>
    typeof label === "string" ? label.toLowerCase() : (label.name || "").toLowerCase(),
  );
  return labels.includes(AGENT_IN_PROGRESS_LABEL);
}

export function buildIssuePrompt(issue: GitHubIssue): string {
  const labels = (issue.labels || [])
    .map((label) => (typeof label === "string" ? label : label.name))
    .filter(Boolean)
    .join(", ");
  return [
    `Implement GitHub issue #${issue.number} in the repository you are configured for.`,
    "",
    `Title: ${issue.title}`,
    "",
    "Body:",
    issue.body || "(empty)",
    "",
    `Labels: ${labels || "(none)"}`,
    "",
    "Run your mandatory pre-flight check first. If the story is underspecified, follow the rejection protocol.",
  ].join("\n");
}

async function finalizeSuccess(run: AgentRun, githubPat: string): Promise<void> {
  const branch = agentBranchForIssue(run.issueNumber);
  const pullRequest = await fetchPullRequestForBranch(githubPat, run.owner, run.repo, branch);
  if (!pullRequest) {
    await setRunFailed(run, githubPat, "Agent finished but no pull request was found on branch " + branch);
    return;
  }

  await ensureLabelsExist(githubPat, run.owner, run.repo, [IMPLEMENTED_LABEL], labelColor);
  await addIssueLabels(githubPat, run.owner, run.repo, run.issueNumber, [IMPLEMENTED_LABEL]);
  await removeIssueLabel(githubPat, run.owner, run.repo, run.issueNumber, AGENT_IN_PROGRESS_LABEL);

  run.state = "done";
  run.pullRequestUrl = pullRequest.html_url;
  run.finishedAt = Date.now();
}

async function setRunFailed(run: AgentRun, githubPat: string, message: string, cause?: unknown): Promise<void> {
  run.state = "failed";
  run.message = message;
  run.finishedAt = Date.now();
  console.error(
    `Agent run ${run.runId} for ${run.owner}/${run.repo}#${run.issueNumber} failed: ${message}`,
    cause instanceof Error ? cause : "",
  );
  try {
    await removeIssueLabel(githubPat, run.owner, run.repo, run.issueNumber, AGENT_IN_PROGRESS_LABEL);
    await createIssueComment(
      githubPat,
      run.owner,
      run.repo,
      run.issueNumber,
      `Agent run ${run.runId} stopped without success: ${message}`,
    );
  } catch (error) {
    console.warn(`Failed to record failure of agent run ${run.runId} on the issue:`, error);
  }
}

async function checkRejection(run: AgentRun, githubPat: string): Promise<boolean> {
  const comments = await fetchIssueComments(githubPat, run.owner, run.repo, run.issueNumber);
  const rejectionComment = [...comments]
    .reverse()
    .find((comment) => comment.body.includes("<!-- AI_CONVERSATION -->"));

  if (!rejectionComment) return false;

  await removeIssueLabel(githubPat, run.owner, run.repo, run.issueNumber, AGENT_IN_PROGRESS_LABEL);

  run.state = "rejected";
  run.questionsCommentUrl = `https://github.com/${run.owner}/${run.repo}/issues/${run.issueNumber}#issuecomment-${rejectionComment.id}`;
  run.finishedAt = Date.now();
  return true;
}

export async function startAgentRun(
  mistralApiKey: string,
  agentId: string,
  githubPat: string,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<AgentRun> {
  const issue = await fetchIssue(githubPat, owner, repo, issueNumber);
  if (!isEligibleForImplementation(issue)) {
    throw new Error("Issue is not eligible for implementation: it needs labels type:task and actionable:ready.");
  }
  if (hasInProgressLabel(issue)) {
    throw new Error("Issue already has an agent run in progress.");
  }
  if (activeRunCount() >= MAX_CONCURRENT_AGENT_RUNS) {
    throw new Error("Global concurrent agent run limit reached. Try again later.");
  }

  const existingRun = getLatestRun(owner, repo, issueNumber);
  if (existingRun && existingRun.state === "running") {
    throw new Error("An agent run is already active for this issue.");
  }

  await ensureLabelsExist(githubPat, owner, repo, [AGENT_IN_PROGRESS_LABEL], labelColor);
  await addIssueLabels(githubPat, owner, repo, issueNumber, [AGENT_IN_PROGRESS_LABEL]);

  const run: AgentRun = {
    runId: `run-${issueNumber}-${Date.now()}`,
    owner,
    repo,
    issueNumber,
    state: "running",
    startedAt: Date.now(),
  };
  runs.set(run.runId, run);
  console.log(`Agent run ${run.runId} started for ${owner}/${repo}#${issueNumber} (active runs: ${activeRunCount()})`);

  void executeRun(run, mistralApiKey, agentId, githubPat).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await setRunFailed(run, githubPat, message, error);
  });

  return run;
}

async function executeRun(run: AgentRun, mistralApiKey: string, agentId: string, githubPat: string): Promise<void> {
  const issueUrl = `https://github.com/${run.owner}/${run.repo}/issues/${run.issueNumber}`;
  try {
    const issue = await fetchIssue(githubPat, run.owner, run.repo, run.issueNumber);

    console.log(`Agent run ${run.runId} starting conversation (turn 1) for ${issueUrl}`);
    const conversation = await withTurnTimeout(
      startAgentConversation(mistralApiKey, agentId, buildIssuePrompt(issue)),
    );
    run.conversationId = conversation.conversationId;
    console.log(`Agent run ${run.runId} turn 1 finished (conversation ${conversation.conversationId})`);

    for (let turn = 2; turn <= MAX_AGENT_TURNS; turn += 1) {
      if (Date.now() - run.startedAt > AGENT_RUN_BUDGET_MS) {
        await setRunFailed(run, githubPat, "Run exceeded its time budget between turns.");
        return;
      }
      if (await checkRejection(run, githubPat)) return;
      if (await findPullRequest(run, githubPat)) {
        await finalizeSuccess(run, githubPat);
        return;
      }

      console.log(`Agent run ${run.runId} turn ${turn}: no result yet, asking the agent to continue`);
      const appended = await withTurnTimeout(
        appendAgentConversation(mistralApiKey, conversation.conversationId, CONTINUE_PROMPT),
      );
      const output = outputText(appended.outputs);
      console.log(`Agent run ${run.runId} turn ${turn} finished. Output: ${output.slice(0, 500) || "(no text)"}`);
    }

    await setRunFailed(run, githubPat, `Agent did not produce a pull request or a rejection within ${MAX_AGENT_TURNS} turns.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setRunFailed(run, githubPat, message, error);
  }
}

function withTurnTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Agent turn exceeded ${TURN_TIMEOUT_MS / 60000} minutes.`)), TURN_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function findPullRequest(run: AgentRun, githubPat: string): Promise<boolean> {
  const branch = agentBranchForIssue(run.issueNumber);
  const pullRequest = await fetchPullRequestForBranch(githubPat, run.owner, run.repo, branch);
  return Boolean(pullRequest);
}

export function reapExpiredRuns(): void {
  const now = Date.now();
  for (const run of runs.values()) {
    if (run.state !== "running") continue;
    if (now - run.startedAt <= AGENT_RUN_BUDGET_MS) continue;
    run.state = "failed";
    run.message = "Run exceeded its time budget.";
    run.finishedAt = now;
  }
}




