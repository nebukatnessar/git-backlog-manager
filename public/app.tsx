import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert, Avatar, Box, Button, CircularProgress, CssBaseline, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, IconButton, LinearProgress, Paper,
  Stack, TextField, ThemeProvider, Tooltip, Typography, createTheme,
} from "@mui/material";
import {
  Add, BugReport, ChevronRight, FolderOpen, GitHub, Inbox, Lock, Logout, Refresh,
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
  type GitHubIssue,
  mapIssue,
} from "../src/shared/workItems";

import { RepositorySidebar } from "./components/RepositorySidebar";
import { RepositoryContent } from "./components/RepositoryContent";
import { WorkItemStoreProvider, useWorkItemStore, seedIssues, applyLabelChange, applyBodyChange, rollbackLabels } from "./state/workItemStore";

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

function AppContent(): React.JSX.Element {
  const [owner, setOwner] = useState("");
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repositorySearch, setRepositorySearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [state, setState] = useState("all");
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [error, setError] = useState("");
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [workItemId, setWorkItemId] = useState<number | undefined>(undefined);
  const [loadingWorkItem, setLoadingWorkItem] = useState(false);
  const [workItemError, setWorkItemError] = useState("");
  const [implementingIssue, setImplementingIssue] = useState<number | null>(null);
  const [scopingIssue, setScopingIssue] = useState<number | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState<{ login: string; name: string | null; avatarUrl: string | null; htmlUrl: string | null } | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [authError, setAuthError] = useState("");

  const { state: storeState, dispatch } = useWorkItemStore();

  // Read URL params
  function readUrlParams(): { repo?: string; state?: string; workItemId?: number } {
    const params = new URLSearchParams(window.location.search);
    return {
      repo: params.get("repo") || undefined,
      state: params.get("state") || undefined,
      workItemId: params.get("work-item-id") ? Number(params.get("work-item-id")) : undefined,
    };
  }

  // Update URL based on current state
  function updateUrl(): void {
    const params = new URLSearchParams();
    if (selectedRepo) params.set("repo", selectedRepo);
    if (state !== "all") params.set("state", state);
    if (workItemId) params.set("work-item-id", String(workItemId));
    const searchString = params.toString();
    const newUrl = searchString ? `?${searchString}` : window.location.pathname;
    window.history.pushState({}, "", newUrl);
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

  async function fetchRepositoryIssues(repo: string): Promise<void> {
    setLoadingIssues(true); setError("");
    try {
      const response = await fetch(`/api/issues?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&state=${encodeURIComponent(state)}`);
      const body = await response.json() as { issues?: GitHubIssue[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load work items");
      dispatch(seedIssues(body.issues || []));
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { setLoadingIssues(false); }
  }

  async function selectRepository(repo: string): Promise<void> {
    setSelectedRepo(repo);
    setWorkItemId(undefined);
    await fetchRepositoryIssues(repo);
  }

  async function fetchWorkItem(issueId: number): Promise<void> {
    if (!selectedRepo) return;
    setLoadingWorkItem(true); setWorkItemError("");
    try {
      const response = await fetch(`/api/issues/${issueId}?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(selectedRepo)}`);
      const body = await response.json() as { issue?: GitHubIssue; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load work item");
      if (body.issue) {
        // If the issue is not in the store, add it
        if (!storeState.issues[body.issue.number]) {
          dispatch(seedIssues([body.issue]));
        }
      }
    } catch (requestError) { setWorkItemError(requestError instanceof Error ? requestError.message : String(requestError)); }
    finally { setLoadingWorkItem(false); }
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
      const body = await response.json() as { issues?: GitHubIssue[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not create work item");
      dispatch(seedIssues(body.issues || []));
      setCreateTarget(null);
    } catch (requestError) {
      setCreateError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    // Initialize from URL on app load
    const { repo, state: urlState, workItemId: urlWorkItemId } = readUrlParams();
    
    // Set all state at once to avoid triggering useEffects prematurely
    if (repo) {
      setSelectedRepo(repo);
    }
    if (urlState) {
      setState(urlState);
    }
    if (urlWorkItemId) {
      setWorkItemId(urlWorkItemId);
    }

    // Check login state first; skip data loading until signed in (when required).
    fetch("/api/auth/status")
      .then((response) => response.json() as Promise<{ authRequired?: boolean; authenticated?: boolean; user?: typeof authUser }>)
      .then((status) => {
        setAuthRequired(Boolean(status.authRequired));
        setAuthUser(status.user || null);
        setAuthChecked(true);
        if (status.authRequired && !status.authenticated) return;
        fetch("/api/config").then((response) => response.json() as Promise<{ owner: string }>).then((config) => { setOwner(config.owner); return loadRepositories(config.owner); }).catch((requestError) => setError(requestError instanceof Error ? requestError.message : String(requestError)));
      })
      .catch((requestError) => {
        setAuthChecked(true);
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      });

    // Show OAuth errors redirected back from GitHub
    const authErrorParam = new URLSearchParams(window.location.search).get("auth_error");
    if (authErrorParam) {
      setAuthError(authErrorParam);
      window.history.replaceState({}, "", window.location.pathname);
    }

    // Handle browser back/forward navigation
    const handlePopState = () => {
      const { repo, state: urlState, workItemId: urlWorkItemId } = readUrlParams();
      if (repo !== undefined) setSelectedRepo(repo);
      if (urlState !== undefined) setState(urlState);
      if (urlWorkItemId !== undefined) {
        setWorkItemId(urlWorkItemId);
      } else {
        setWorkItemId(undefined);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Update URL whenever state that affects URL changes
  useEffect(() => {
    updateUrl();
  }, [selectedRepo, state, workItemId]);

  // Fetch repository issues when selectedRepo or state changes
  useEffect(() => { 
    if (selectedRepo) { 
      void fetchRepositoryIssues(selectedRepo); 
    } 
  }, [selectedRepo, state]);

  // Fetch work item when workItemId changes
  useEffect(() => {
    if (workItemId && selectedRepo) {
      void fetchWorkItem(workItemId);
    }
  }, [workItemId, selectedRepo]);

  const selectedDetails = repositories.find((repo) => repo.name === selectedRepo);

  const handleViewItem = useCallback((issueNumber: number) => {
    setWorkItemId(issueNumber);
  }, []);

  const handleBackFromDetail = useCallback(() => {
    setWorkItemId(undefined);
  }, []);

  const handleRunFinished = useCallback(async () => {
    if (selectedRepo) {
      await fetchRepositoryIssues(selectedRepo);
    }
  }, [selectedRepo]);

  const handleImplementIssue = useCallback(async (issueNumber: number) => {
    setImplementingIssue(issueNumber);
    try {
      const response = await fetch(
        `/api/repos/${encodeURIComponent(selectedRepo)}/issues/${issueNumber}/implement?owner=${encodeURIComponent(owner)}`,
        { method: "POST" }
      );
      const body = await response.json();
      if (!response.ok) throw new Error([body.error, body.details].filter(Boolean).join(" ") || "Could not start agent run");
      // Refetch issues to update the store
      await fetchRepositoryIssues(selectedRepo);
    } catch (implementError) {
      setError(implementError instanceof Error ? implementError.message : String(implementError));
    } finally {
      setImplementingIssue(null);
    }
  }, [selectedRepo, owner]);

  const handleScopeIssue = useCallback(async (issueNumber: number) => {
    setScopingIssue(issueNumber);
    try {
      const response = await fetch(
        `/api/repos/${encodeURIComponent(selectedRepo)}/issues/${issueNumber}/scope?owner=${encodeURIComponent(owner)}`,
        { method: "POST" }
      );
      const body = await response.json();
      if (!response.ok) throw new Error([body.error, body.details].filter(Boolean).join(" ") || "Could not start scoping run");
      // Refetch issues to update the store
      await fetchRepositoryIssues(selectedRepo);
    } catch (scopeError) {
      setError(scopeError instanceof Error ? scopeError.message : String(scopeError));
    } finally {
      setScopingIssue(null);
    }
  }, [selectedRepo, owner]);

  const handleSaveWorkItem = useCallback(async (issueNumber: number, body: string) => {
    if (!selectedRepo) return;
    setLoadingWorkItem(true);
    setWorkItemError("");
    try {
      const issue = storeState.issues[issueNumber];
      if (!issue) {
        throw new Error("Issue not found in store");
      }

      // Optimistic update
      const previousBody = issue.body;
      dispatch(applyBodyChange(issueNumber, body));

      const response = await fetch(`/api/issues/${issueNumber}?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(selectedRepo)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const result = await response.json() as { issue?: GitHubIssue; error?: string };
      if (!response.ok) {
        // Revert on failure
        dispatch(applyBodyChange(issueNumber, previousBody || ""));
        throw new Error(result.error || "Could not save work item");
      }
    } catch (error) {
      setWorkItemError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingWorkItem(false);
    }
  }, [selectedRepo, owner, storeState.issues, dispatch]);

  const handleStatusChange = useCallback(async (issueNumber: number, status: string) => {
    if (!selectedRepo) return;
    try {
      const issue = storeState.issues[issueNumber];
      if (!issue) {
        throw new Error("Issue not found in store");
      }

      // Optimistic update
      const previousLabels = { ...issue.labels };
      dispatch(applyLabelChange(issueNumber, "status", status));

      const response = await fetch(
        `/api/repos/${encodeURIComponent(selectedRepo)}/issues/${issueNumber}/label/status:${status}?owner=${encodeURIComponent(owner)}`,
        { method: "POST" }
      );
      if (!response.ok) {
        // Revert on failure
        dispatch(rollbackLabels(issueNumber, previousLabels));
        const body = await response.json();
        throw new Error([body.error, body.details].filter(Boolean).join(" ") || "Could not update status");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [selectedRepo, owner, storeState.issues, dispatch]);

  const handlePriorityChange = useCallback(async (issueNumber: number, priority: string) => {
    if (!selectedRepo) return;
    try {
      const issue = storeState.issues[issueNumber];
      if (!issue) {
        throw new Error("Issue not found in store");
      }

      // Optimistic update
      const previousLabels = { ...issue.labels };
      dispatch(applyLabelChange(issueNumber, "priority", priority));

      const response = await fetch(
        `/api/repos/${encodeURIComponent(selectedRepo)}/issues/${issueNumber}/label/priority:${priority}?owner=${encodeURIComponent(owner)}`,
        { method: "POST" }
      );
      if (!response.ok) {
        // Revert on failure
        dispatch(rollbackLabels(issueNumber, previousLabels));
        const body = await response.json();
        throw new Error([body.error, body.details].filter(Boolean).join(" ") || "Could not update priority");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [selectedRepo, owner, storeState.issues, dispatch]);

  const handleActionableChange = useCallback(async (issueNumber: number, actionable: string) => {
    if (!selectedRepo) return;
    try {
      const issue = storeState.issues[issueNumber];
      if (!issue) {
        throw new Error("Issue not found in store");
      }

      // Optimistic update
      const previousLabels = { ...issue.labels };
      dispatch(applyLabelChange(issueNumber, "actionable", actionable));

      const response = await fetch(
        `/api/repos/${encodeURIComponent(selectedRepo)}/issues/${issueNumber}/label/actionable:${actionable}?owner=${encodeURIComponent(owner)}`,
        { method: "POST" }
      );
      if (!response.ok) {
        // Revert on failure
        dispatch(rollbackLabels(issueNumber, previousLabels));
        const body = await response.json();
        throw new Error([body.error, body.details].filter(Boolean).join(" ") || "Could not update actionable label");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [selectedRepo, owner, storeState.issues, dispatch]);

  const handleStackRankChange = useCallback(async (issueNumber: number, stackRank: number) => {
    if (!selectedRepo) return;
    try {
      const issue = storeState.issues[issueNumber];
      if (!issue) {
        throw new Error("Issue not found in store");
      }

      // Optimistic update
      const previousLabels = { ...issue.labels };
      dispatch(applyLabelChange(issueNumber, "stack-rank", String(stackRank)));

      const response = await fetch(
        `/api/repos/${encodeURIComponent(selectedRepo)}/issues/${issueNumber}/label/stack-rank:${stackRank}?owner=${encodeURIComponent(owner)}`,
        { method: "POST" }
      );
      if (!response.ok) {
        // Revert on failure
        dispatch(rollbackLabels(issueNumber, previousLabels));
        const body = await response.json();
        throw new Error([body.error, body.details].filter(Boolean).join(" ") || "Could not update stack-rank");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [selectedRepo, owner, storeState.issues, dispatch]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/";
    }
  }, []);

  // Get the work item from the store
  const workItem = useMemo(() => {
    if (workItemId !== undefined) {
      return storeState.issues[workItemId] || null;
    }
    return null;
  }, [workItemId, storeState.issues]);

  // Get the data for RepositoryContent
  const data = useMemo(() => {
    if (!storeState.hierarchy) return null;
    return {
      repository: { owner, repo: selectedRepo },
      totals: {
        issues: Object.keys(storeState.issues).length,
        epics: storeState.hierarchy.epics.length,
        bugs: storeState.hierarchy.bugs.length,
      },
      hierarchy: storeState.hierarchy,
    };
  }, [storeState.hierarchy, storeState.issues, owner, selectedRepo]);

  if (authRequired && !authUser) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", bgcolor: "background.default" }}>
          <Box sx={{ textAlign: "center", maxWidth: 420, px: 3 }}>
            <Avatar sx={{ mx: "auto", mb: 3, width: 72, height: 72, bgcolor: "#1d3733", color: "primary.main" }}>
              <GitHub />
            </Avatar>
            <Typography variant="h4" gutterBottom>Sign in to continue</Typography>
            <Typography color="text.secondary" sx={{ mb: 1 }}>
              Git Backlog Manager uses your GitHub account to load repositories and manage work items.
            </Typography>
            {authError ? (
              <Alert severity="error" sx={{ my: 2, textAlign: "left" }}>{authError}</Alert>
            ) : null}
            {!authChecked ? (
              <CircularProgress size={28} sx={{ mt: 3 }} />
            ) : (
              <Button
                variant="contained"
                size="large"
                startIcon={<GitHub />}
                href="/auth/github"
                sx={{ mt: 3, textTransform: "none" }}
              >
                Sign in with GitHub
              </Button>
            )}
          </Box>
        </Box>
      </ThemeProvider>
    );
  }

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
        <Box component="main" sx={{ flexGrow: 1, px: { xs: 3, md: 6 }, py: 5, mx: "auto", width: "100%" }}>
          {authUser ? (
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end" sx={{ mb: -3 }}>
              <Avatar src={authUser.avatarUrl || undefined} alt={authUser.login} sx={{ width: 28, height: 28 }} />
              <Typography variant="body2" color="text.secondary">@{authUser.login}</Typography>
              <Tooltip title="Sign out">
                <IconButton size="small" onClick={() => { void handleLogout(); }}>
                  <Logout />
                </IconButton>
              </Tooltip>
            </Stack>
          ) : null}
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
              error={error || workItemError}
              onStateChange={setState}
              onAddEpic={() => { setCreateError(""); setCreateTarget({ type: "epic" }); }}
              onAddFeature={(epicSlug) => { setCreateError(""); setCreateTarget({ type: "feature", epic: epicSlug }); }}
              onAddTask={(epicSlug, featureSlug) => { setCreateError(""); setCreateTarget({ type: "task", epic: epicSlug, feature: featureSlug }); }}
              workItemId={workItemId}
              workItem={workItem}
              loadingWorkItem={loadingWorkItem}
              onViewItem={handleViewItem}
              onBackFromDetail={handleBackFromDetail}
              onSaveWorkItem={handleSaveWorkItem}
              onImplement={(issueNumber) => { void handleImplementIssue(issueNumber); }}
              implementingIssue={implementingIssue}
              onScope={(issueNumber) => { void handleScopeIssue(issueNumber); }}
              scopingIssue={scopingIssue}
              onStatusChange={handleStatusChange}
              onPriorityChange={handlePriorityChange}
              onActionableChange={handleActionableChange}
              onStackRankChange={handleStackRankChange}
              onRunFinished={handleRunFinished}
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

function App(): React.JSX.Element {
  return (
    <WorkItemStoreProvider>
      <AppContent />
    </WorkItemStoreProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
