import crypto from "node:crypto";
import type { Express, Request, Response } from "express";

/**
 * GitHub OAuth login service.
 *
 * Enables "Sign in with GitHub" for the app. When GITHUB_CLIENT_ID and
 * GITHUB_CLIENT_SECRET are configured, all /api/* routes (except health,
 * config and auth-status) require a logged-in user, and GitHub API calls
 * run with the logged-in user's OAuth token instead of the server-wide
 * GITHUB_TOKEN/GITHUB_PAT.
 *
 * Sessions are stateless: a signed HttpOnly cookie holds the GitHub login
 * and OAuth access token (HMAC-SHA256 with SESSION_SECRET). No database
 * needed, which fits the single-service Render deployment.
 */

export interface AuthUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string | null;
  token: string;
}

export interface AuthSession {
  user: AuthUser;
  issuedAt: number;
}

const SESSION_COOKIE = "gbm_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export const AUTH_CONFIGURED = Boolean(
  process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET,
);

const SESSION_SECRET = process.env.SESSION_SECRET || "";
const OAUTH_STATE_COOKIE = "gbm_oauth_state";
const OAUTH_STATE_MAX_AGE_SECONDS = 600;

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(value: string): string {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("base64url");
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.get("cookie") || "";
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

function encodeSession(session: AuthSession): string {
  const payload = base64Url(JSON.stringify(session));
  return `${payload}.${sign(payload)}`;
}

function decodeSession(raw: string | undefined): AuthSession | null {
  if (!raw || !SESSION_SECRET) return null;
  const dot = raw.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf-8"),
    ) as AuthSession;
    if (
      !session ||
      typeof session.issuedAt !== "number" ||
      !session.user ||
      typeof session.user.token !== "string" ||
      !session.user.token
    ) {
      return null;
    }
    // Reject sessions older than the max age.
    if (Date.now() / 1000 - session.issuedAt > SESSION_MAX_AGE_SECONDS) return null;
    return session;
  } catch {
    return null;
  }
}

declare module "express-serve-static-core" {
  interface Request {
    authSession?: AuthSession;
  }
}

/** Attaches req.authSession when a valid session cookie is present. */
export function attachAuth(req: Request, _res: Response, next: () => void): void {
  if (!AUTH_CONFIGURED) return next();
  const cookies = parseCookies(req);
  req.authSession = decodeSession(cookies[SESSION_COOKIE]) || undefined;
  next();
}

/** Blocks /api/* routes until logged in (only when auth is configured). */
export function requireApiAuth(req: Request, res: Response, next: () => void): void {
  if (!AUTH_CONFIGURED) return next();
  if (req.authSession) return next();
  res.status(401).json({ error: "Sign in with GitHub to use this app." });
}

function resolveBaseUrl(req: Request): string {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  }
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost:3000";
  const proto = req.get("x-forwarded-proto") || (String(host).startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function exchangeCodeForToken(code: string): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "git-backlog-manager",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { access_token?: string; error?: string; error_description?: string };
  if (body.error || !body.access_token) {
    throw new Error(body.error_description || body.error || "GitHub did not return an access token.");
  }
  return body.access_token;
}

async function fetchGithubUser(token: string): Promise<AuthUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "git-backlog-manager",
    },
  });
  if (!response.ok) {
    throw new Error(`Could not load GitHub user: ${response.status}`);
  }
  const user = (await response.json()) as {
    login: string;
    name: string | null;
    avatar_url: string | null;
    html_url: string | null;
  };
  return {
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    htmlUrl: user.html_url,
    token,
  };
}

export function publicUser(user: AuthUser) {
  return {
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    htmlUrl: user.htmlUrl,
  };
}

/** Registers the OAuth + auth-status routes on the app. */
export function registerAuthRoutes(app: Express): void {
  // Status and logout always exist so the client has a consistent contract.
  app.get("/api/auth/status", (req: Request, res: Response) => {
    res.json({
      authRequired: AUTH_CONFIGURED,
      authenticated: AUTH_CONFIGURED ? Boolean(req.authSession) : true,
      user: req.authSession ? publicUser(req.authSession.user) : null,
    });
  });

  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  if (!AUTH_CONFIGURED) return;

  // Step 1: redirect the user to GitHub's consent screen with a CSRF state.
  app.get("/auth/github", (req: Request, res: Response) => {
    const state = crypto.randomBytes(16).toString("base64url");
    res.setHeader(
      "Set-Cookie",
      serializeCookie(OAUTH_STATE_COOKIE, state, OAUTH_STATE_MAX_AGE_SECONDS),
    );
    const params = new URLSearchParams({
      client_id: String(process.env.GITHUB_CLIENT_ID),
      redirect_uri: `${resolveBaseUrl(req)}/auth/github/callback`,
      scope: "repo read:user",
      state,
    });
    res.redirect(302, `https://github.com/login/oauth/authorize?${params.toString()}`);
  });

  // Step 2: GitHub redirects back here; exchange the code and sign the user in.
  app.get("/auth/github/callback", async (req: Request, res: Response) => {
    const cookies = parseCookies(req);
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    const expectedState = cookies[OAUTH_STATE_COOKIE] || "";

    const fail = (message: string) =>
      res.redirect(302, `/?auth_error=${encodeURIComponent(message)}`);

    if (!code) return fail("Missing code from GitHub.");
    if (!expectedState || state !== expectedState) {
      return fail("Login session expired or state mismatch. Please try again.");
    }

    try {
      const token = await exchangeCodeForToken(code);
      const user = await fetchGithubUser(token);
      const session: AuthSession = { user, issuedAt: Math.floor(Date.now() / 1000) };
      res.setHeader("Set-Cookie", [
        serializeCookie(SESSION_COOKIE, encodeSession(session), SESSION_MAX_AGE_SECONDS),
        `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      ]);
      return res.redirect(302, "/");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("GitHub OAuth callback failed:", message);
      return fail("GitHub sign-in failed. Please try again.");
    }
  });
}
