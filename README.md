# git-backlog-manager

A lightweight web app that adds an Azure DevOps-style work item view on top of GitHub Issues.

It reads GitHub issues, parses namespaced labels (`type:`, `epic:`, `feature:`, `task:`, `status:`, `priority:`, `actionable:`), and reconstructs a hierarchy:

- Epics (`type:epic` + `epic:<slug>`)
- Features (`type:feature` + `epic:<slug>` + `feature:<slug>`)
- Tasks (`type:task` + `epic:<slug>` + `feature:<slug>` + `task:<slug>`)
- Bugs (`type:bug`) as flat work items

## Architecture

- **Node.js backend (Express)**
  - Serves the web UI
  - Calls GitHub Issues API securely (token in request bearer header or `GITHUB_TOKEN` env var)
  - Rebuilds work-item tree from label conventions
- **React frontend (browser module)**
  - Lets users choose owner/repo/state
  - Optionally stores a personal token in browser local storage
  - Displays epic/feature/task tree + bug list

## Configuration

Use one of these authentication options:

1. Set backend environment variable:

```bash
export GITHUB_TOKEN=your_personal_access_token
```

2. Or provide token in the web UI (sent as bearer token to backend request only).

## Run locally

```bash
npm install
npm start
```

Then open: `http://localhost:3000`

## Tests

```bash
npm test
```

Current tests cover namespaced label parsing and hierarchy reconstruction.
