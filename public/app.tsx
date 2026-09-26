import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert, Avatar, Box, Button, CircularProgress, CssBaseline, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, IconButton, LinearProgress, Paper,
  Stack, TextField, ThemeProvider, Tooltip, Typography, createTheme,
} from "@mui/material";
import {
  Add, BugReport, ChevronRight, FolderOpen, GitHub, Inbox, Lock, Refresh,
  Search, TaskAlt,
} from "@mui/icons-material";
import {
  slugify,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_STATUSES,
  type Epic,
  type Feature,
  type WorkItem,
  type WorkItemPriority,
  type WorkItemStatus,
} from "../src/shared/workItems";

import { RepositorySidebar } from "./components/RepositorySidebar";
import { RepositoryContent } from "./components/RepositoryContent";

interface Repository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  stargazers_count: number;
  open_issues_count: number;
  updated_at: string;
}

interface ApiData {
  repository: { owner: string; repo: string };
  totals: { issues: number; epics: number; bugs: number };
  hierarchy: {
    epics: Epic[];
    bugs: WorkItem[];
    orphanFeatures: WorkItem[];
    orphanTasks: WorkItem[];
    unclassified: WorkItem[];
  };
}

type CreateTarget =
  | { type: "epic" }
  | { type: "feature"; epic: string }
  | { type: "task"; epic: string; feature: string };

const theme = createTheme({
  palette: {
    mode: "dark",
    background: { default: "#0d1117", paper: "#151b23" },
    primary: { main: "#62d9b2" },
    secondary: { main: "#f2b56b" },
    text: { primary: "#f1f5f4", secondary: "#91a19f" },
    divider: "#28333b",
  },
  typography: { fontFamily: "'DM Sans', 'Segoe UI', sans-serif", h4: { fontWeight: 700, letterSpacing: "-0.02em" }, h6: { fontWeight: 700 } },
  shape: { borderRadius: 10 },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiListItemButton: { styleOverrides: { root: { borderRadius: 8, margin: "2px 10px" } } },
  },
});

function parentPath(target: CreateTarget): string {
  if (target.type === "epic") return "Repository root";
  if (target.type === "feature") return `epic:${target.epic}`;
  return `epic:${target.epic} / feature:${target.feature}`;
}

function CreateWorkItemDialog({
  target,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  target: CreateTarget | null;
  submitting: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (payload: { title: string; slug: string; status: WorkItemStatus; priority: WorkItemPriority }) => Promise<void>;
}): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [status, setStatus] = useState<WorkItemStatus>("backlog");
  const [priority, setPriority] = useState<WorkItemPriority>("medium");

  useEffect(() => {
    if (!target) return;
    setTitle("");
    setSlug("");
    setSlugEdited(false);
    setStatus("backlog");
    setPriority("medium");
  }, [target]);

  function updateTitle(value: string): void {
    setTitle(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  return (
    <Dialog open={Boolean(target)} onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>New {target?.type || "work item"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Parent" value={target ? parentPath(target) : ""} size="small" InputProps={{ readOnly: true }} />
          <TextField autoFocus label="Title" value={title} onChange={(event) => updateTitle(event.target.value)} required />
          <TextField
            label="Slug"
            value={slug}
            helperText="Used for hierarchy labels. Leave blank to derive from the title."
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(event.target.value);
            }}
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField select SelectProps={{ native: true }} label="Status" value={status} onChange={(event) => setStatus(event.target.value as WorkItemStatus)} fullWidth>
              {WORK_ITEM_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
            </TextField>
            <TextField select SelectProps={{ native: true }} label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as WorkItemPriority)} fullWidth>
              {WORK_ITEM_PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </TextField>
          </Stack>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button variant="contained" disabled={submitting || !title.trim()} onClick={() => void onSubmit({ title, slug, status, priority })}>
          {submitting ? "Creating…" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function App(): React.JSX.Element {
  const [owner, setOwner] = useState("");
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repositorySearch, setRepositorySearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [state, setState] = useState("all");
  const [data, setData] = useState<ApiData | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [error, setError] = useState("");
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Sync state with URL
  function updateUrl(): void {
    const params = new URLSearchParams();
    if (selectedRepo) params.set("repo", selectedRepo);
    if (state !== "all") params.set("state", state);
    const searchString = params.toString();
    const newUrl = searchString ? `?${searchString}` : window.location.pathname;
    window.history.pushState({}, "", newUrl);
  }

  function readUrlParams(): { repo?: string; state?: string } {
    const params = new URLSearchParams(window.location.search);
    return {
      repo: params.get("repo") || undefined,
      state: params.get("state") || undefined,
    };
  }

  async function loadRepositories(configuredOwner = owner): Promise<void> {
    if (!configuredOwner) return;
    setLoadingRepos(true); setError("");
    try {
      const response = await fetch(`/api/repos?owner=${encodeURIComponent(configuredOwner)}`);
      const body = await response.json() as { repositories?: Repository[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load repositories");
      setRepositories(body.repositories || []);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { setLoadingRepos(false); }
  }

  async function selectRepository(repo: string): Promise<void> {
    setSelectedRepo(repo); setLoadingIssues(true); setError("");
    try {
      const response = await fetch(`/api/issues?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&state=${encodeURIComponent(state)}`);
      const body = await response.json() as ApiData & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load work items");
      setData(body);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { setLoadingIssues(false); }
  }

  async function createWorkItem(payload: { title: string; slug: string; status: WorkItemStatus; priority: WorkItemPriority }): Promise<void> {
    if (!createTarget) return;
    setCreating(true); setCreateError("");
    try {
      const bodyPayload: Record<string, string> = {
        owner,
        repo: selectedRepo,
        type: createTarget.type,
        title: payload.title,
        slug: payload.slug,
        status: payload.status,
        priority: payload.priority,
        state,
      };
      if (createTarget.type === "feature" || createTarget.type === "task") bodyPayload.epic = createTarget.epic;
      if (createTarget.type === "task") bodyPayload.feature = createTarget.feature;

      const response = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      });
      const body = await response.json() as ApiData & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not create work item");
      setData(body);
      setCreateTarget(null);
    } catch (requestError) {
      setCreateError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    // Initialize from URL on app load
    const { repo, state: urlState } = readUrlParams();
    if (repo) setSelectedRepo(repo);
    if (urlState) setState(urlState);

    fetch("/api/config").then((response) => response.json() as Promise<{ owner: string }>).then((config) => { setOwner(config.owner); return loadRepositories(config.owner); }).catch((requestError) => setError(requestError instanceof Error ? requestError.message : String(requestError)));
  }, []);

  useEffect(() => { if (selectedRepo) { updateUrl(); void selectRepository(selectedRepo); } }, [state]);

  // Update URL when selectedRepo changes
  useEffect(() => { 
    if (selectedRepo) { 
      updateUrl(); 
      void selectRepository(selectedRepo); 
    } else { 
      updateUrl(); 
      setData(null); 
    } 
  }, [selectedRepo]);

  const selectedDetails = repositories.find((repo) => repo.name === selectedRepo);
  
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
        <RepositorySidebar
          owner={owner}
          repositories={repositories}
          repositorySearch={repositorySearch}
          selectedRepo={selectedRepo}
          loadingRepos={loadingRepos}
          onRepositorySearchChange={setRepositorySearch}
          onSelectRepository={selectRepository}
          onRefreshRepositories={loadRepositories}
        />
        <Box component="main" sx={{ flexGrow: 1, px: { xs: 3, md: 6 }, py: 5, maxWidth: 1300, mx: "auto", width: "100%" }}>
          {!selectedRepo ? (
            <Box sx={{ minHeight: "80vh", display: "grid", placeItems: "center", textAlign: "center" }}>
              <Box>
                <Avatar sx={{ mx: "auto", mb: 2, width: 64, height: 64, bgcolor: "#1d3733", color: "primary.main" }}>
                  <GitHub />
                </Avatar>
                <Typography variant="h4" gutterBottom>Choose a repository</Typography>
                <Typography color="text.secondary">Select a repository from the left to open its work-item hierarchy.</Typography>
              </Box>
            </Box>
          ) : (
            <RepositoryContent
              owner={owner}
              selectedRepo={selectedRepo}
              selectedDetails={selectedDetails}
              state={state}
              data={data}
              loadingIssues={loadingIssues}
              error={error}
              onStateChange={setState}
              onAddEpic={() => { setCreateError(""); setCreateTarget({ type: "epic" }); }}
              onAddFeature={(epicSlug) => { setCreateError(""); setCreateTarget({ type: "feature", epic: epicSlug }); }}
              onAddTask={(epicSlug, featureSlug) => { setCreateError(""); setCreateTarget({ type: "task", epic: epicSlug, feature: featureSlug }); }}
            />
          )}
        </Box>
        <CreateWorkItemDialog
          target={createTarget}
          submitting={creating}
          error={createError}
          onClose={() => setCreateTarget(null)}
          onSubmit={createWorkItem}
        />
      </Box>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
