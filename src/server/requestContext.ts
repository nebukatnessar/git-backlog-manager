import type { Request } from "express";

export function isValidRepoPart(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value);
}

export function resolveToken(req: Request): string {
  // Prefer the signed-in user's GitHub OAuth token.
  if (req.authSession?.user.token) return req.authSession.user.token;
  const authHeader = req.get("authorization") || "";
  const headerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  return headerToken || process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || "";
}

export function resolveAgentToken(fallback: string): string {
  return process.env.AGENT_GITHUB_TOKEN || fallback;
}

function maskToken(token: string): string {
  if (token.length <= 8) return `${token.slice(0, 2)}...`;
  return `${token.slice(0, 4)}...${token.slice(-4)} (len ${token.length})`;
}

export function tokenSource(req: Request): { source: "authorization-header" | "session" | "GITHUB_TOKEN" | "GITHUB_PAT" | "none"; masked: string } {
  if (req.authSession?.user.token) {
    return { source: "session", masked: maskToken(req.authSession.user.token) };
  }
  const authHeader = req.get("authorization") || "";
  const headerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (headerToken) return { source: "authorization-header", masked: maskToken(headerToken) };
  if (process.env.GITHUB_TOKEN) return { source: "GITHUB_TOKEN", masked: maskToken(process.env.GITHUB_TOKEN) };
  if (process.env.GITHUB_PAT) return { source: "GITHUB_PAT", masked: maskToken(process.env.GITHUB_PAT) };
  return { source: "none", masked: "" };
}

export function resolveIssueTarget(req: Request): { owner: string; repo: string; issueNumber: number } | { error: string } {
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
