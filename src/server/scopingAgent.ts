import { parseAgentQuestions } from "../shared/agentQuestions";
import { type GitHubIssue } from "../shared/workItems";
import { labelColor } from "./agentLabels";
import {
  addIssueLabels,
  ensureLabelsExist,
  fetchIssue,
  fetchIssueComments,
} from "./github";
import { appendAgentConversation, startAgentConversation, type ConversationOutputEntry } from "./mistralAgents";

const SCOPING_MAX_TURNS = Number(process.env.SCOPING_MAX_TURNS || 10);
const SCOPING_TURN_TIMEOUT_MS = Number(process.env.SCOPING_TURN_TIMEOUT_MS || 10 * 60 * 1000);

export type ScopingRunState = "running" | "done" | "rejected" | "failed";

export interface ScopingRun {
  runId: string;
  owner: string;
  repo: string;
  issueNumber: number;
  state: ScopingRunState;
  startedAt: number;
  finishedAt?: number;
  conversationId?: string;
  message?: string;
}

const scopingRuns = new Map<string, ScopingRun>();

function scopingRunsForIssue(owner: string, repo: string, issueNumber: number): ScopingRun[] {
  return [...scopingRuns.values()].filter((run) => run.owner === owner && run.repo === repo && run.issueNumber === issueNumber);
}

export function isScopingRunActiveForIssue(owner: string, repo: string, issueNumber: number): boolean {
  return scopingRunsForIssue(owner, repo, issueNumber).some((run) => run.state === "running");
}

export function getLatestScopingRun(owner: string, repo: string, issueNumber: number): ScopingRun | undefined {
  const runsSorted = scopingRunsForIssue(owner, repo, issueNumber).sort((a, b) => b.startedAt - a.startedAt);
  return runsSorted[0];
}

export function listAllScopingRuns(): ScopingRun[] {
  return [...scopingRuns.values()].sort((a, b) => b.startedAt - a.startedAt);
}

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

function withTurnTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs / 60000} minutes.`)), timeoutMs);
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

function buildScopingPrompt(issueBody: string, issueTitle: string, issueNumber: number, owner: string, repo: string): string {
  return [
    `Decide whether GitHub issue #${issueNumber} in the repository ${owner}/${repo} is actionable.`,
    "",
    `Title: ${issueTitle}`,
    "",
    "Body:",
    issueBody || "(empty)",
    "",
    "Inspect the repository as needed, then follow the outcome protocol: label the issue actionable:ready or actionable:rejected and post the single wrapped comment. Your update-issue tool REPLACES the whole label set: pass every current label plus the new actionable label, then re-read the issue and verify nothing was lost.",
  ].join("\n");
}

function labelNames(issue: GitHubIssue): string[] {
  return (issue.labels || [])
    .map((label) => (typeof label === "string" ? label : label.name || ""))
    .filter(Boolean);
}

// The agent may only change the actionable: namespace; everything else must
// survive the run. This snapshot is the baseline restored after the run.
async function snapshotProtectedLabels(githubPat: string, owner: string, repo: string, issueNumber: number): Promise<string[]> {
  const issue = await fetchIssue(githubPat, owner, repo, issueNumber);
  return labelNames(issue).filter((name) => !name.toLowerCase().startsWith("actionable:"));
}

async function restoreMissingLabels(run: ScopingRun, githubPat: string, snapshotLabels: string[]): Promise<void> {
  if (!snapshotLabels.length) return;

  let currentNames: string[];
  try {
    const issue = await fetchIssue(githubPat, run.owner, run.repo, run.issueNumber);
    currentNames = labelNames(issue);
  } catch (error) {
    console.error(
      `Scoping run ${run.runId}: could not verify labels on issue #${run.issueNumber}:`,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  const currentSet = new Set(currentNames.map((name) => name.toLowerCase()));
  const missing = snapshotLabels.filter((name) => !currentSet.has(name.toLowerCase()));
  if (!missing.length) return;

  console.warn(`Scoping run ${run.runId}: agent dropped labels [${missing.join(", ")}] from issue #${run.issueNumber}; restoring them`);
  await addIssueLabels(githubPat, run.owner, run.repo, run.issueNumber, missing);
}

async function checkOutcome(run: ScopingRun, githubPat: string): Promise<boolean> {
  const issue = await fetchIssue(githubPat, run.owner, run.repo, run.issueNumber);
  const labels = (issue.labels || []).map((label) =>
    typeof label === "string" ? label.toLowerCase() : (label.name || "").toLowerCase(),
  );
  if (labels.includes("actionable:ready")) {
    run.state = "done";
    run.finishedAt = Date.now();
    console.log(`Scoping run ${run.runId}: issue #${run.issueNumber} is actionable (ready)`);
    return true;
  }
  if (labels.includes("actionable:rejected")) {
    run.state = "rejected";
    run.finishedAt = Date.now();
    console.log(`Scoping run ${run.runId}: issue #${run.issueNumber} is not actionable (rejected)`);
    return true;
  }
  const comments = await fetchIssueComments(githubPat, run.owner, run.repo, run.issueNumber);
  const decisionComment = [...comments]
    .reverse()
    .find((comment) => parseAgentQuestions(comment.body).length > 0);
  if (decisionComment) {
    run.state = "rejected";
    run.finishedAt = Date.now();
    console.log(`Scoping run ${run.runId}: rejection comment found on issue #${run.issueNumber}`);
    return true;
  }
  return false;
}

async function failRun(run: ScopingRun, githubPat: string, message: string, cause?: unknown): Promise<void> {
  run.state = "failed";
  run.message = message;
  run.finishedAt = Date.now();
  console.error(`Scoping run ${run.runId} for ${run.owner}/${run.repo}#${run.issueNumber} failed: ${message}`, cause instanceof Error ? cause : "");
}

export async function startScopingRun(
  mistralApiKey: string,
  agentId: string,
  githubPat: string,
  owner: string,
  repo: string,
  issueNumber: number,
  issueTitle: string,
  issueBody: string,
): Promise<ScopingRun> {
  if (isScopingRunActiveForIssue(owner, repo, issueNumber)) {
    throw new Error("A scoping run is already active for this issue.");
  }

  await ensureLabelsExist(githubPat, owner, repo, ["actionable:ready", "actionable:rejected"], labelColor);
  const protectedLabels = await snapshotProtectedLabels(githubPat, owner, repo, issueNumber);

  const run: ScopingRun = {
    runId: `scope-${issueNumber}-${Date.now()}`,
    owner,
    repo,
    issueNumber,
    state: "running",
    startedAt: Date.now(),
  };
  scopingRuns.set(run.runId, run);
  console.log(`Scoping run ${run.runId} started for ${owner}/${repo}#${issueNumber}`);

  void executeScopingRun(run, mistralApiKey, agentId, githubPat, issueTitle, issueBody)
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await failRun(run, githubPat, message, error);
    })
    .finally(() => {
      void restoreMissingLabels(run, githubPat, protectedLabels).catch((error) => {
        console.error(
          `Scoping run ${run.runId}: failed to restore labels on issue #${issueNumber}:`,
          error instanceof Error ? error.message : String(error),
        );
      });
    });

  return run;
}

async function executeScopingRun(
  run: ScopingRun,
  mistralApiKey: string,
  agentId: string,
  githubPat: string,
  issueTitle: string,
  issueBody: string,
): Promise<void> {
  try {
    const prompt = buildScopingPrompt(issueBody, issueTitle, run.issueNumber, run.owner, run.repo);
    console.log(`Scoping run ${run.runId} starting conversation (turn 1)`);
    const conversation = await withTurnTimeout(
      startAgentConversation(mistralApiKey, agentId, prompt),
      SCOPING_TURN_TIMEOUT_MS,
      "Scoping turn",
    );
    run.conversationId = conversation.conversationId;
    console.log(`Scoping run ${run.runId} turn 1 finished (conversation ${conversation.conversationId})`);

    for (let turn = 2; turn <= SCOPING_MAX_TURNS; turn += 1) {
      if (await checkOutcome(run, githubPat)) return;

      console.log(`Scoping run ${run.runId} turn ${turn}: no outcome yet, asking the agent to continue`);
      const appended = await withTurnTimeout(
        appendAgentConversation(mistralApiKey, conversation.conversationId, "Continue: inspect the repository and the issue, then apply the outcome protocol now — label the issue and post the single wrapped comment. Do not stop to narrate; act. When labeling, include every existing label plus the new actionable label (your label update replaces the whole set), then verify nothing was lost."),
        SCOPING_TURN_TIMEOUT_MS,
        "Scoping turn",
      );
      const output = outputText(appended.outputs);
      console.log(`Scoping run ${run.runId} turn ${turn} finished. Output: ${output.slice(0, 500) || "(no text)"}`);
    }

    if (await checkOutcome(run, githubPat)) return;
    await failRun(run, githubPat, `Scoping agent did not reach a decision within ${SCOPING_MAX_TURNS} turns.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRun(run, githubPat, message, error);
  }
}
