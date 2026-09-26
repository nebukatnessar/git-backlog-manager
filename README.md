# git-backlog-manager

A lightweight web app that adds an Azure DevOps-style work item view on top of GitHub Issues.

It reads GitHub issues, parses namespaced labels (`type:`, `epic:`, `feature:`, `task:`, `status:`, `priority:`, `actionable:`), and reconstructs a hierarchy:

- Epics (`type:epic` + `epic:<slug>`)
- Features (`type:feature` + `epic:<slug>` + `feature:<slug>`)
- Tasks (`type:task` + `epic:<slug>` + `feature:<slug>` + `task:<slug>`)
- Bugs (`type:bug`) as flat work items

## Architecture

- **TypeScript Node.js backend (Express)**
  - Serves the web UI
  - Lists repositories for the configured GitHub owner through `/api/repos`
  - Calls GitHub Issues API securely (token in request bearer header or `GITHUB_TOKEN` env var)
  - Rebuilds work-item tree from label conventions
- **TypeScript React frontend**
  - Provides a Material UI repository sidebar with search and refresh
  - Loads a repository's work items when selected
  - Filters issues by open, closed, or all state
  - Displays epic/feature/task tree + bug list

## Configuration

Create a local `.env` file from `.env.example`. It is ignored by git and can contain the backend token and default owner:

```env
GITHUB_TOKEN=your_personal_access_token
GITHUB_OWNER=your_github_owner
PORT=3000
```

The configured owner is prefilled in the UI and is also used when the owner query parameter is omitted. The token stays on the backend, so you do not need to enter it in the UI.

You can also set the backend environment variable directly:

```bash
export GITHUB_TOKEN=your_personal_access_token
```

The UI uses the backend-configured token automatically.

## Run locally

```bash
npm install
npm start
```

`npm start` compiles the backend and bundles the browser entry point before starting the server.

Then open: `http://localhost:3000`

## Tests

```bash
npm test
```

Current TypeScript tests cover namespaced label parsing and hierarchy reconstruction. Use `npm run build` to type-check and compile without starting the server.

## Implement agent

The app can spin up a Mistral coding agent (Devstral) that attempts to implement a
single task issue and open a draft PR, or reject the issue with structured
questions when the story lacks information.

### How it works

- Task cards show an **Implement** button, enabled only when the issue has both
  `type:task` and `actionable:ready` labels. The work item detail page shows the
  full agent panel with run status, PR link, and the agent's questions.
- On start, the backend adds `agent:in-progress` (guards against double-firing,
  max 2 concurrent runs globally), builds a prompt from the issue body and
  labels, and starts an agent conversation via the Mistral Agents API.
- The agent has a code-execution connector and a GitHub MCP connector
  (authenticated with the scoped `GITHUB_PAT`) so it can push to
  `agent/<issue-number>` and open a draft PR referencing `Closes #<N>`.
- On success the backend verifies a PR exists, labels the issue
  `actionable:implemented` and removes `agent:in-progress`.
- On rejection the agent posts one comment wrapped in `<!-- AI_CONVERSATION -->`
  with `[question]`/`[dependency]` prefixed lines, and labels the issue
  `actionable:rejected`. The card renders these as structured items; answers are
  submitted from the card, appended inside the same comment, and the issue is
  relabeled `actionable:ready`, which re-enables the button.
- Each run has a time budget (`AGENT_RUN_BUDGET_MS`, default 45 minutes);
  overruns stop gracefully and are reported on the issue.

The agent system prompt lives in `agent-prompt.md` and is editable without
code changes (`AGENT_PROMPT_PATH` to override the location). The current prompt
body is served at `GET /api/agent/prompt`.

### Environment variables

```env
MISTRAL_API_KEY=your_mistral_api_key
GITHUB_PAT=your_scoped_github_pat
# optional
MISTRAL_AGENT_MODEL=devstral-latest
AGENT_PROMPT_PATH=./agent-prompt.md
AGENT_RUN_BUDGET_MS=2700000
MISTRAL_BASE_URL=https://api.mistral.ai/v1
MISTRAL_CONNECTOR_VISIBILITY=private
GITHUB_MCP_SERVER_URL=https://api.githubcopilot.com/mcp/
```

Before bootstrapping the agent, the backend validates `GITHUB_PAT` directly
against the GitHub REST API (`GET /user`) and the GitHub MCP server
(JSON-RPC `initialize` handshake). If either rejects the token, the run is
not started and the exact rejection (status code + GitHub's response body)
is logged server-side and returned in `details`.

The GitHub MCP connector is created with `visibility: private` first and
automatically falls back to `shared_workspace`, then `shared_org`, when the
API key lacks the primitive access scope required for private connectors
(`personal_and_shared`). Set `MISTRAL_CONNECTOR_VISIBILITY` to pin one
explicitly.

If starting a run fails, the server log names the failing Mistral or
GitHub API call, its status code and the API error message (e.g.
`Mistral API update connector credentials ... failed with status 422`).
The same message is returned to the UI in the `details` field of the
error response, so failures show up directly on the agent panel.

#### Troubleshooting `401 Invalid credentials provided`

When Mistral reports `401 {"detail":"Invalid credentials provided"}` during
connector credential setup, it has validated the stored `GITHUB_PAT` against
GitHub's MCP server and GitHub rejected it — but Mistral does not surface the
underlying reason. The backend now preflights the token itself, so the actual
error (bad credentials, expired/revoked token, truncated token, or the MCP
endpoint being unavailable to the account) is reported instead. Common
causes to check:

- The token was copied incompletely (fine-grained tokens are long
  `github_pat_...` strings that wrap easily).
- The token has expired or was revoked.
- The account or organization restricts access to the GitHub MCP endpoint
  (`https://api.githubcopilot.com/mcp/`).

Run `GET /api/agent/check` to pinpoint which step fails: it returns which
step (`rest` or `mcp`) rejected the token, the status code, and GitHub's
response body. `step: "rest"` means the token itself is invalid (check
expiry/revocation/copy-paste); `step: "mcp"` means the token works for the
REST API but not for the MCP endpoint (check account/org access to
`api.githubcopilot.com`). Use `GITHUB_MCP_SERVER_URL` if you need to point
the connector and the preflight at a different GitHub MCP endpoint.

`GITHUB_PAT` must be a **fine-grained personal access token scoped to the
WebDaw repository only**, with these permissions:

| Permission | Access |
| --- | --- |
| Contents | Read and write |
| Pull requests | Read and write |
| Issues | Read and write |

Create it under *GitHub → Settings → Developer settings → Fine-grained
tokens*, select only the WebDaw repository, and grant exactly the permissions
above. The PAT is stored only in the app backend (env var) and is never sent to
the browser; it is passed once to Mistral as the GitHub MCP connector
credential so the agent can act on that repository and nothing else.

`GITHUB_TOKEN` and `GITHUB_PAT` can point to the **same** fine-grained PAT —
the simplest setup is one token scoped to the repositories you manage.
The server resolves the app token as `GITHUB_TOKEN` first, then falls back
to `GITHUB_PAT`, so you can set only `GITHUB_PAT` and everything
(repo listing, issues, comments, labels, and the agent connector) works
with it:

| Env var | Used for | Scope needed |
| --- | --- | --- |
| `GITHUB_TOKEN` | The backlog app itself: listing repositories, issues, comments, labels | Broad — must see every repo you manage |
| `GITHUB_PAT` | The Mistral agent's GitHub MCP connector; also the fallback app token when `GITHUB_TOKEN` is unset | Must include WebDaw with contents/PRs/issues read-write |

One caveat: if the backlog app manages repositories beyond WebDaw and you
use a single WebDaw-only token, the repository list (`GET /api/repos`) will
only show WebDaw — because the token simply cannot see anything else.
If you need the app to manage other repositories, either scope the single
token to all of them, or keep two tokens: a broad `GITHUB_TOKEN` plus a
WebDaw-only `GITHUB_PAT` for the agent (the agent then stays unable to touch
anything but WebDaw).

### API

- `POST /api/repos/:repo/issues/:issueNumber/implement` — start an agent run
- `GET /api/repos/:repo/issues/:issueNumber/agent-run` — run status, parsed
  questions, eligibility, concurrency
- `POST /api/repos/:repo/issues/:issueNumber/answers` — submit answers to the
  agent's questions (relabels the issue `actionable:ready`)
- `GET /api/agent/prompt` — current agent system prompt
- `GET /api/agent/check` — validate `GITHUB_PAT` against the GitHub REST API
  and MCP server; returns `{ ok, step, message, login }` and pinpoints which
  side rejects the token
