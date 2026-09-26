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
