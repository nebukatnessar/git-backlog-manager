export const AGENT_IN_PROGRESS_LABEL = "agent:in-progress";
export const IMPLEMENTED_LABEL = "actionable:implemented";

export function agentBranchForIssue(issueNumber: number): string {
  return `agent/${issueNumber}`;
}

export function labelColor(name: string): string {
  if (name.startsWith("type:")) return "62d9b2";
  if (name.startsWith("status:")) return "f2b56b";
  if (name.startsWith("priority:")) return "e98282";
  if (name.startsWith("actionable:")) return "9d8cff";
  if (name.startsWith("agent:")) return "8fd3f4";
  return "6e7681";
}
