import type { AgentRun } from "./implementAgent";
import {
  createIssueComment,
  fetchCheckRunAnnotations,
  fetchPullRequestForBranch,
  fetchCheckRunsForRef,
  fetchWorkflowRunLogsForRef,
  type GitHubCheckAnnotation,
  type GitHubCheckRun,
  type GitHubPullRequest,
} from "./github";

const CI_POLL_INTERVAL_MS = Number(process.env.CI_POLL_INTERVAL_MS || 30_000);
const CI_WATCH_BUDGET_MS = Number(process.env.CI_WATCH_BUDGET_MS || 30 * 60 * 1000);
export const MAX_CI_FIX_CYCLES = Number(process.env.CI_MAX_FIX_CYCLES || 3);
const CI_LOG_TAIL_CHARS = Number(process.env.CI_LOG_TAIL_CHARS || 4000);

export interface CiWatchOptions {
  githubPat: string;
  launchFix: (failureLogs: string, failingCheckRuns: GitHubCheckRun[]) => Promise<void>;
}

function tail(text: string, maxChars: number): string {
  return text.length > maxChars ? `...(truncated)...\n${text.slice(-maxChars)}` : text;
}

interface FailureDiagnostics {
  /** Prompt-ready text of all diagnostics; empty string when nothing usable was collected. */
  text: string;
  /** Human-readable notes about diagnostics that could NOT be collected, for escalation comments. */
  collectionErrors: string[];
}

async function collectFailureLogs(
  githubPat: string,
  owner: string,
  repo: string,
  failed: GitHubCheckRun[],
): Promise<FailureDiagnostics> {
  const parts: string[] = [];
  const collectionErrors: string[] = [];

  // Fetch job logs once for the head commit shared by all check runs.
  const headSha = failed.find((checkRun) => checkRun.head_sha)?.head_sha;
  let workflowLogs: string | null = null;
  if (headSha) {
    try {
      workflowLogs = await fetchWorkflowRunLogsForRef(githubPat, owner, repo, headSha);
    } catch (error) {
      collectionErrors.push(`workflow job logs (${error instanceof Error ? error.message : String(error)})`);
    }
  } else {
    collectionErrors.push("workflow job logs (check runs carried no head SHA)");
  }

  for (const checkRun of failed) {
    const sections: string[] = [];

    const annotations: GitHubCheckAnnotation[] = [];
    try {
      const fetched = await fetchCheckRunAnnotations(githubPat, owner, repo, checkRun.id);
      annotations.push(...fetched);
    } catch (error) {
      collectionErrors.push(`annotations for check "${checkRun.name}" (${error instanceof Error ? error.message : String(error)})`);
    }

    if (annotations.length > 0) {
      sections.push(
        annotations
          .map((annotation) => `- ${annotation.path ? `${annotation.path}:${annotation.start_line ?? "?"}: ` : ""}${annotation.message}`)
          .join("\n"),
      );
    }

    if (workflowLogs) sections.push(tail(workflowLogs, CI_LOG_TAIL_CHARS));

    parts.push(
      `### Failing check: ${checkRun.name} ([run](${checkRun.html_url}))\n${sections.length > 0 ? sections.join("\n\n") : "(no diagnostics available)"}`,
    );
  }

  const usableSections = parts.filter((part) => !part.endsWith("(no diagnostics available)"));
  return { text: usableSections.length > 0 ? usableSections.join("\n\n") : "", collectionErrors };
}

/**
 * Poll the CI check runs for the agent branch after a run finishes.
 * On failure, either launch a fix run (via launchFix) or escalate on the issue
 * once MAX_CI_FIX_CYCLES is exhausted.
 */
export function watchPullRequestCi(run: AgentRun, branch: string, options: CiWatchOptions): void {
  const startedAt = Date.now();
  console.log(`CI watch started for ${run.owner}/${run.repo}#${run.issueNumber} on branch ${branch}`);

  const schedule = (): void => {
    if (Date.now() - startedAt > CI_WATCH_BUDGET_MS) {
      console.warn(`CI watch for ${run.owner}/${run.repo}#${run.issueNumber} exceeded its budget; giving up.`);
      return;
    }
    setTimeout(() => void poll(), CI_POLL_INTERVAL_MS);
  };

  const poll = async (): Promise<void> => {
    try {
      const checkRuns = await fetchCheckRunsForRef(options.githubPat, run.owner, run.repo, branch);
      const relevant = checkRuns.filter((checkRun) => checkRun.app?.slug === "github-actions");
      if (relevant.length === 0 || relevant.some((checkRun) => checkRun.status !== "completed")) {
        schedule();
        return;
      }

      const failed = relevant.filter((checkRun) => checkRun.conclusion === "failure");
      if (failed.length === 0) {
        console.log(`CI passed for ${run.owner}/${run.repo}#${run.issueNumber} on branch ${branch}`);
        return;
      }

      const cycle = run.ciFixCycle || 0;
      if (cycle >= MAX_CI_FIX_CYCLES) {
        console.warn(`CI still failing for ${run.owner}/${run.repo}#${run.issueNumber} after ${cycle} fix cycles; escalating.`);
        const pullRequest = await fetchPullRequestForBranch(options.githubPat, run.owner, run.repo, branch);
        const targetNumber = pullRequest?.number ?? run.issueNumber;
        await createIssueComment(
          options.githubPat,
          run.owner,
          run.repo,
          targetNumber,
          [
            `CI is still failing on \`${branch}\` after ${MAX_CI_FIX_CYCLES} fix cycles. Stopping automatic fixes; this needs a human.`,
            "",
            ...failed.map((checkRun) => `- Failing check: [${checkRun.name}](${checkRun.html_url})`),
          ].join("\n"),
        );
        return;
      }

      const diagnostics = await collectFailureLogs(options.githubPat, run.owner, run.repo, failed);
      if (diagnostics.text.trim().length === 0) {
        // Never spend a fix cycle on an agent that would be flying blind.
        console.warn(
          `CI failed for ${run.owner}/${run.repo}#${run.issueNumber} but no diagnostics could be collected; escalating instead of relaunching.`,
        );
        const pullRequest = await fetchPullRequestForBranch(options.githubPat, run.owner, run.repo, branch);
        const targetNumber = pullRequest?.number ?? run.issueNumber;
        await createIssueComment(
          options.githubPat,
          run.owner,
          run.repo,
          targetNumber,
          [
            `CI failed on \`${branch}\` (check(s): ${failed.map((checkRun) => checkRun.name).join(", ")}), but the backend could not collect any failure logs or annotations. Skipping the automatic fix cycle so no blind fix is attempted.`,
            "",
            ...failed.map((checkRun) => `- Failing check: [${checkRun.name}](${checkRun.html_url})`),
            diagnostics.collectionErrors.length > 0
              ? `\nLog collection errors:\n${diagnostics.collectionErrors.map((entry) => `- ${entry}`).join("\n")}`
              : "",
          ].join("\n"),
        );
        return;
      }

      await options.launchFix(diagnostics.text, failed);
    } catch (error) {
      console.warn(`CI watch poll for ${run.owner}/${run.repo}#${run.issueNumber} failed:`, error);
      schedule();
    }
  };

  schedule();
}
