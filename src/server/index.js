const express = require("express");
const path = require("path");
const { buildWorkItemHierarchy } = require("../shared/workItems");

const PORT = Number(process.env.PORT || 3000);
const app = express();

function isValidRepoPart(value) {
  return /^[A-Za-z0-9_.-]+$/.test(value);
}

async function fetchIssues(owner, repo, state, token) {
  const issues = [];
  let page = 1;

  while (true) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues`);
    url.searchParams.set("state", state || "all");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: ["Bearer", token].join(" "),
        "User-Agent": "git-backlog-manager",
      },
    });

    if (!response.ok) {
      const details = await response.text();
      const error = new Error("GitHub API request failed");
      error.statusCode = response.status;
      error.details = details;
      throw error;
    }

    const batch = await response.json();
    const issueOnlyBatch = batch.filter((item) => !item.pull_request);
    issues.push(...issueOnlyBatch);

    if (batch.length < 100) break;
    page += 1;
  }

  return issues;
}

app.use(express.static(path.join(__dirname, "../../public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/issues", async (req, res) => {
  const owner = String(req.query.owner || "").trim();
  const repo = String(req.query.repo || "").trim();
  const state = String(req.query.state || "all").trim();

  if (!owner || !repo || !isValidRepoPart(owner) || !isValidRepoPart(repo)) {
    return res.status(400).json({
      error: "Provide valid owner and repo query parameters.",
    });
  }

  const authHeader = req.get("authorization") || "";
  const headerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const token = headerToken || process.env.GITHUB_TOKEN;

  if (!token) {
    return res.status(401).json({
      error:
        "No GitHub token configured. Provide a bearer token or set GITHUB_TOKEN in the server environment.",
    });
  }

  try {
    const issues = await fetchIssues(owner, repo, state, token);
    const hierarchy = buildWorkItemHierarchy(issues);

    return res.json({
      repository: { owner, repo },
      totals: {
        issues: issues.length,
        epics: hierarchy.epics.length,
        bugs: hierarchy.bugs.length,
      },
      hierarchy,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: "Failed to load issues from GitHub.",
      details: error.details || error.message,
    });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`git-backlog-manager listening on http://localhost:${PORT}`);
});
