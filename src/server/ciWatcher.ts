import type { AgentRun } from "./implementAgent";
import {
  createIssueComment,
  fetchCheckRunLog,
  fetchCheckRunsForRef,
  type GitHubCheckRun,
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

async function collectFailureLogs(githubPat: string, owner: string, repo: string, failed: GitHubCheckRun[]): Promise<string> {
  const parts: string[] = [];
  for (const checkRun of failed) {
    let log = null;
    try {
      log = await fetchCheckRunLog(githubPat, owner, repo, checkRun.id);
    } catch (error) {
      console.warn(`Failed to fetch logs for check run ${checkRun.name}:`, error);
    }
    parts.push(`### Failing check: ${checkRun.name}\n${log ? tail(log, CI_LOG_TAIL_CHARS) : "(logs unavailable)"}`);
  }
  return parts.join("\n\n");
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
        await createIssueComment(
          options.githubPat,
          run.owner,
          run.repo,
          run.issueNumber,
          [
            `CI is still failing on \`${branch}\` after ${MAX_CI_FIX_CYCLES} fix cycles. Stopping automatic fixes; this needs a human.`,
            "",
            ...failed.map((checkRun) => `- Failing check: [${checkRun.name}](${checkRun.html_url})`),
          ].join("\n"),
        );
        return;
      }

      const failureLogs = await collectFailureLogs(options.githubPat, run.owner, run.repo, failed);
      await options.launchFix(failureLogs, failed);
    } catch (error) {
      console.warn(`CI watch poll for ${run.owner}/${run.repo}#${run.issueNumber} failed:`, error);
      schedule();
    }
  };

  schedule();
}
