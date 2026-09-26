import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Epic, WorkItem } from "../src/shared/workItems";

interface ApiData {
  repository: { owner: string; repo: string };
  totals: { issues: number; epics: number; bugs: number };
  hierarchy: { epics: Epic[]; bugs: WorkItem[] };
}

function IssueLine({ issue }: { issue: WorkItem }): React.JSX.Element {
  const status = issue.labels.status ? `status:${issue.labels.status}` : "";
  const priority = issue.labels.priority ? `priority:${issue.labels.priority}` : "";
  return <li><a href={issue.html_url} target="_blank" rel="noreferrer">#{issue.number} {issue.title}</a><span className="meta"> {status} {priority}</span></li>;
}

function App(): React.JSX.Element {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [state, setState] = useState("all");
  const [token, setToken] = useState(localStorage.getItem("gbm_token") || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<ApiData | null>(null);
  const canLoad = useMemo(() => Boolean(owner.trim() && repo.trim()), [owner, repo]);

  async function loadIssues(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canLoad) return;
    setLoading(true);
    setError("");
    try {
      localStorage.setItem("gbm_token", token);
      const response = await fetch(`/api/issues?owner=${encodeURIComponent(owner.trim())}&repo=${encodeURIComponent(repo.trim())}&state=${encodeURIComponent(state)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await response.json() as ApiData & { error?: string };
      if (!response.ok) throw new Error(body.error || "Request failed");
      setData(body);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setLoading(false);
    }
  }

  return <>
    <form onSubmit={loadIssues}>
      <label>Owner<input value={owner} onChange={(event) => setOwner(event.target.value)} required /></label>
      <label>Repository<input value={repo} onChange={(event) => setRepo(event.target.value)} required /></label>
      <label>State<select value={state} onChange={(event) => setState(event.target.value)}><option value="all">all</option><option value="open">open</option><option value="closed">closed</option></select></label>
      <label>GitHub Token (optional if backend has GITHUB_TOKEN)<input value={token} onChange={(event) => setToken(event.target.value)} type="password" /></label>
      <button type="submit" disabled={!canLoad || loading}>{loading ? "Loading..." : "Load Work Items"}</button>
    </form>
    {error && <p style={{ color: "crimson" }}>{error}</p>}
    {data && <section>
      <h2>{data.repository.owner}/{data.repository.repo}</h2>
      <p>Issues: {data.totals.issues} | Epics: {data.totals.epics} | Bugs: {data.totals.bugs}</p>
      <h3>Epics</h3>
      <ul>{data.hierarchy.epics.map((epic) => <li key={`epic-${epic.number}`}><strong>{epic.title} ({epic.slug})</strong><ul>{epic.features.map((feature) => <li key={`feature-${feature.number}`}>{feature.title} ({feature.slug})<ul>{feature.tasks.map((task) => <IssueLine key={`task-${task.number}`} issue={task} />)}</ul></li>)}</ul></li>)}</ul>
      <h3>Bugs</h3>
      <ul>{data.hierarchy.bugs.map((bug) => <IssueLine key={`bug-${bug.number}`} issue={bug} />)}</ul>
    </section>}
  </>;
}

createRoot(document.getElementById("root")!).render(<App />);