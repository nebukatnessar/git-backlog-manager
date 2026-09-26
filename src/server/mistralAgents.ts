import path from "node:path";
import fs from "node:fs";

const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";

export const GITHUB_MCP_SERVER_URL = "https://api.githubcopilot.com/mcp/";
export const IMPLEMENT_AGENT_NAME = "webdaw-implement-agent";
export const GITHUB_CONNECTOR_NAME = "webdaw-github-mcp";

export class MistralApiError extends Error {
  constructor(public statusCode: number, public details: string) {
    super("Mistral API request failed");
  }
}

interface MistralConnector {
  id: string;
  name: string;
  object?: string;
}

interface MistralAgent {
  id: string;
  name: string;
  object?: string;
}

export interface AgentSetupResult {
  agentId: string;
  connectorId: string;
}

function mistralHeaders(apiKey: string, jsonBody = false): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...(jsonBody ? { "Content-Type": "application/json" } : {}),
  };
}

async function mistralFetch<T>(apiKey: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...mistralHeaders(apiKey, Boolean(init.body)), ...(init.headers as Record<string, string>) },
  });
  if (!response.ok) throw new MistralApiError(response.status, await response.text());
  return (await response.json()) as T;
}

export async function listConnectors(apiKey: string): Promise<MistralConnector[]> {
  const connectors: MistralConnector[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${MISTRAL_BASE_URL}/connectors`);
    url.searchParams.set("page_size", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = await mistralFetch<{ items?: MistralConnector[]; pagination?: { next_cursor?: string | null } }>(
      apiKey,
      url.toString(),
    );
    connectors.push(...(page.items || []));
    cursor = page.pagination?.next_cursor || undefined;
  } while (cursor);

  return connectors;
}

export async function listAgents(apiKey: string): Promise<MistralAgent[]> {
  const agents: MistralAgent[] = [];
  let page = 0;

  while (true) {
    const url = new URL(`${MISTRAL_BASE_URL}/agents`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", "100");
    const result = await mistralFetch<{ data?: MistralAgent[] }>(apiKey, url.toString());
    const batch = result.data || [];
    agents.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  return agents;
}

async function ensureGitHubConnector(apiKey: string, githubPat: string): Promise<string> {
  const connectors = await listConnectors(apiKey);
  const existing = connectors.find((connector) => connector.name === GITHUB_CONNECTOR_NAME);
  const connectorId = existing ? existing.id : await createGitHubConnector(apiKey);
  await storeConnectorCredential(apiKey, connectorId, githubPat);
  await activateConnector(apiKey, connectorId);
  return connectorId;
}

async function createGitHubConnector(apiKey: string): Promise<string> {
  const connector = await mistralFetch<MistralConnector>(apiKey, `${MISTRAL_BASE_URL}/connectors`, {
    method: "POST",
    body: JSON.stringify({
      name: GITHUB_CONNECTOR_NAME,
      title: "WebDaw GitHub MCP",
      description: "GitHub MCP tools for the WebDaw repository, authenticated with a scoped PAT.",
      server: GITHUB_MCP_SERVER_URL,
      visibility: "private",
      protocol: "mcp",
      auth_methods: [{ method_type: "bearer" }],
    }),
  });
  return connector.id;
}

async function storeConnectorCredential(apiKey: string, connectorId: string, githubPat: string): Promise<void> {
  await mistralFetch(apiKey, `${MISTRAL_BASE_URL}/connectors/${connectorId}/user/credentials`, {
    method: "PATCH",
    body: JSON.stringify({
      name: "github-pat",
      title: "WebDaw scoped PAT",
      credentials: { bearer_token: githubPat },
    }),
  });
}

async function activateConnector(apiKey: string, connectorId: string): Promise<void> {
  await mistralFetch(apiKey, `${MISTRAL_BASE_URL}/connectors/${connectorId}/user/activate`, { method: "POST" });
}

export function loadAgentPrompt(projectDir: string): string {
  const promptPath = process.env.AGENT_PROMPT_PATH || path.join(projectDir, "agent-prompt.md");
  let raw = "";
  try {
    raw = fs.readFileSync(promptPath, "utf-8");
  } catch (error) {
    console.warn(`Could not read agent prompt from ${promptPath}:`, error);
  }
  const marker = "## PROMPT BODY BELOW";
  const markerIndex = raw.indexOf(marker);
  const body = markerIndex === -1 ? raw : raw.slice(markerIndex + marker.length);
  return body.trim();
}

export async function ensureImplementAgent(apiKey: string, githubPat: string, projectDir: string): Promise<AgentSetupResult> {
  const connectorId = await ensureGitHubConnector(apiKey, githubPat);

  const agents = await listAgents(apiKey);
  const existing = agents.find((agent) => agent.name === IMPLEMENT_AGENT_NAME);

  const tools = [{ type: "code_interpreter" }, { type: "connector", connector_id: connectorId }];
  const payload = {
    model: process.env.MISTRAL_AGENT_MODEL || "devstral-latest",
    name: IMPLEMENT_AGENT_NAME,
    description: "Implements a single WebDaw task issue and opens a draft PR, or rejects it with structured questions.",
    instructions: loadAgentPrompt(projectDir),
    tools,
  };

  if (existing) {
    const updated = await mistralFetch<MistralAgent>(apiKey, `${MISTRAL_BASE_URL}/agents/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    return { agentId: updated.id, connectorId };
  }

  const created = await mistralFetch<MistralAgent>(apiKey, `${MISTRAL_BASE_URL}/agents`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return { agentId: created.id, connectorId };
}

export interface ConversationOutputEntry {
  type?: string;
  content?: string | Array<{ type?: string; text?: string }>;
}

export interface ConversationStartResult {
  conversationId: string;
  outputs: ConversationOutputEntry[];
}

export async function startAgentConversation(
  apiKey: string,
  agentId: string,
  inputs: string,
): Promise<ConversationStartResult> {
  const response = await mistralFetch<ConversationStartResult>(apiKey, `${MISTRAL_BASE_URL}/conversations`, {
    method: "POST",
    body: JSON.stringify({
      agent_id: agentId,
      inputs,
      store: true,
    }),
  });
  return response;
}

export async function getConversation(apiKey: string, conversationId: string): Promise<{ agentId?: string | null }> {
  return mistralFetch<{ agentId?: string | null }>(apiKey, `${MISTRAL_BASE_URL}/conversations/${conversationId}`);
}
