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
```

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

### API

- `POST /api/repos/:repo/issues/:issueNumber/implement` — start an agent run
- `GET /api/repos/:repo/issues/:issueNumber/agent-run` — run status, parsed
  questions, eligibility, concurrency
- `POST /api/repos/:repo/issues/:issueNumber/answers` — submit answers to the
  agent's questions (relabels the issue `actionable:ready`)
- `GET /api/agent/prompt` — current agent system prompt
