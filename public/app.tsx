import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, CssBaseline, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, Drawer, IconButton, InputAdornment, LinearProgress,
  List, ListItemButton, ListItemText, Paper, Stack, TextField, ThemeProvider, Tooltip,
  Typography, createTheme,
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
  hierarchy: { epics: Epic[]; bugs: WorkItem[] };
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

function IssueLink({ issue }: { issue: WorkItem }): React.JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.7, flexWrap: "wrap" }}>
      <Typography component="a" href={issue.html_url} target="_blank" rel="noreferrer" sx={{ color: "text.primary", textDecoration: "none", "&:hover": { color: "primary.main" } }}>
        #{issue.number} {issue.title}
      </Typography>
      {issue.labels.status && <Chip label={`status: ${issue.labels.status}`} size="small" variant="outlined" sx={{ height: 22, borderColor: "divider", color: "text.secondary" }} />}
      {issue.labels.priority && <Chip label={`priority: ${issue.labels.priority}`} size="small" variant="outlined" sx={{ height: 22, borderColor: "divider", color: "text.secondary" }} />}
    </Stack>
  );
}

function FeatureBlock({ feature, onAddTask }: { feature: Feature; onAddTask: () => void }): React.JSX.Element {
  return (
    <Box sx={{ ml: 2.5, pl: 2, borderLeft: "1px solid", borderColor: "divider", py: 1 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <ChevronRight sx={{ fontSize: 18, color: "secondary.main" }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="body1" fontWeight={600}>{feature.title}</Typography>
          <Typography variant="caption" color="text.secondary">feature:{feature.slug} · {feature.tasks.length} tasks</Typography>
        </Box>
        <Tooltip title="Add task">
          <IconButton size="small" onClick={onAddTask} aria-label={`Add task to ${feature.title}`}>
            <Add fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ mt: 0.5, ml: 2.75 }}>{feature.tasks.map((task) => <IssueLink key={task.number} issue={task} />)}</Box>
    </Box>
  );
}

function Metric({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }): React.JSX.Element {
  return <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 150, borderColor: "divider" }}><Stack direction="row" spacing={1.5} alignItems="center"><Avatar sx={{ width: 36, height: 36, bgcolor: `${color}22`, color }}>{icon}</Avatar><Box><Typography variant="h6">{value}</Typography><Typography variant="caption" color="text.secondary">{label}</Typography></Box></Stack></Paper>;
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
  const filteredRepos = useMemo(() => repositories.filter((repo) => repo.name.toLowerCase().includes(repositorySearch.toLowerCase())), [repositories, repositorySearch]);

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
    fetch("/api/config").then((response) => response.json() as Promise<{ owner: string }>).then((config) => { setOwner(config.owner); return loadRepositories(config.owner); }).catch((requestError) => setError(requestError instanceof Error ? requestError.message : String(requestError)));
  }, []);

  useEffect(() => { if (selectedRepo) void selectRepository(selectedRepo); }, [state]);

  const selectedDetails = repositories.find((repo) => repo.name === selectedRepo);
  return <ThemeProvider theme={theme}><CssBaseline /><Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
    <Drawer variant="permanent" sx={{ width: 280, flexShrink: 0, "& .MuiDrawer-paper": { width: 280, boxSizing: "border-box", borderRight: "1px solid", borderColor: "divider", bgcolor: "#10161d" } }}>
      <Box sx={{ px: 2.5, py: 2.5 }}><Stack direction="row" spacing={1.5} alignItems="center"><Avatar sx={{ bgcolor: "primary.main", color: "#10241e", width: 34, height: 34 }}><GitHub fontSize="small" /></Avatar><Box><Typography fontWeight={700}>Backlog Manager</Typography><Typography variant="caption" color="text.secondary">{owner || "GitHub workspace"}</Typography></Box></Stack></Box>
      <Divider /><Box sx={{ p: 1.5 }}><TextField fullWidth size="small" placeholder="Find a repository" value={repositorySearch} onChange={(event) => setRepositorySearch(event.target.value)} InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} /></Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2.5, py: 1 }}><Typography variant="overline" color="text.secondary">Repositories <Chip label={repositories.length} size="small" sx={{ ml: 0.5, height: 20 }} /></Typography><Tooltip title="Refresh repositories"><IconButton size="small" onClick={() => void loadRepositories()} disabled={loadingRepos}><Refresh fontSize="small" /></IconButton></Tooltip></Stack>
      {loadingRepos ? <LinearProgress sx={{ mx: 2 }} /> : <List sx={{ pt: 0 }}>{filteredRepos.map((repo) => <ListItemButton key={repo.id} selected={selectedRepo === repo.name} onClick={() => void selectRepository(repo.name)}><Avatar sx={{ width: 28, height: 28, mr: 1.5, bgcolor: selectedRepo === repo.name ? "primary.main" : "#25313a", color: selectedRepo === repo.name ? "#10241e" : "text.secondary" }}><FolderOpen sx={{ fontSize: 16 }} /></Avatar><ListItemText primary={repo.name} secondary={`${repo.open_issues_count} open issues`} primaryTypographyProps={{ noWrap: true, fontSize: 14, fontWeight: selectedRepo === repo.name ? 700 : 500 }} secondaryTypographyProps={{ noWrap: true, fontSize: 11 }} />{repo.private && <Lock sx={{ fontSize: 14, color: "text.secondary" }} />}</ListItemButton>)}</List>}
      {!loadingRepos && !filteredRepos.length && <Box sx={{ px: 2.5, py: 3, textAlign: "center" }}><Inbox sx={{ color: "text.secondary" }} /><Typography variant="body2" color="text.secondary">No repositories found</Typography></Box>}
    </Drawer>
    <Box component="main" sx={{ flexGrow: 1, px: { xs: 3, md: 6 }, py: 5, maxWidth: 1300, mx: "auto", width: "100%" }}>
      {!selectedRepo ? <Box sx={{ minHeight: "80vh", display: "grid", placeItems: "center", textAlign: "center" }}><Box><Avatar sx={{ mx: "auto", mb: 2, width: 64, height: 64, bgcolor: "#1d3733", color: "primary.main" }}><GitHub /></Avatar><Typography variant="h4" gutterBottom>Choose a repository</Typography><Typography color="text.secondary">Select a repository from the left to open its work-item hierarchy.</Typography></Box></Box> : <>
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ md: "center" }} spacing={2} sx={{ mb: 4 }}><Box><Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}><Typography variant="overline" color="primary.main">WORKSPACE / {owner}</Typography>{selectedDetails?.private && <Chip icon={<Lock />} label="Private" size="small" variant="outlined" />}</Stack><Typography variant="h4">{selectedRepo}</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>{selectedDetails?.description || "GitHub work items"}</Typography></Box><TextField select SelectProps={{ native: true }} size="small" label="Issue state" value={state} onChange={(event) => setState(event.target.value)} sx={{ minWidth: 140 }}><option value="all">All issues</option><option value="open">Open</option><option value="closed">Closed</option></TextField></Stack>
        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
        {loadingIssues ? <Box sx={{ py: 10, textAlign: "center" }}><CircularProgress color="primary" /></Box> : data && <><Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 4 }}><Metric icon={<TaskAlt />} label="Total issues" value={data.totals.issues} color="#62d9b2" /><Metric icon={<FolderOpen />} label="Epics" value={data.totals.epics} color="#f2b56b" /><Metric icon={<BugReport />} label="Bugs" value={data.totals.bugs} color="#e98282" /></Stack>
          <Stack direction={{ xs: "column", lg: "row" }} spacing={3} alignItems="flex-start">
            <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, flex: 1, width: "100%", borderColor: "divider" }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Box>
                  <Typography variant="h6">Work item hierarchy</Typography>
                  <Typography variant="body2" color="text.secondary">Epics, features, and tasks</Typography>
                </Box>
                <Button startIcon={<Add />} variant="outlined" onClick={() => { setCreateError(""); setCreateTarget({ type: "epic" }); }}>New epic</Button>
              </Stack>
              {data.hierarchy.epics.map((epic) => (
                <Box key={epic.number} sx={{ py: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Avatar sx={{ width: 34, height: 34, bgcolor: "#3c3020", color: "secondary.main" }}><FolderOpen fontSize="small" /></Avatar>
                    <Box sx={{ flex: 1 }}>
                      <Typography fontWeight={700}>{epic.title}</Typography>
                      <Typography variant="caption" color="text.secondary">epic:{epic.slug} · {epic.features.length} features</Typography>
                    </Box>
                    <Tooltip title="Add feature">
                      <IconButton size="small" onClick={() => { setCreateError(""); setCreateTarget({ type: "feature", epic: epic.slug }); }} aria-label={`Add feature to ${epic.title}`}>
                        <Add fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                  {epic.features.map((feature) => (
                    <FeatureBlock
                      key={feature.number}
                      feature={feature}
                      onAddTask={() => { setCreateError(""); setCreateTarget({ type: "task", epic: epic.slug, feature: feature.slug }); }}
                    />
                  ))}
                </Box>
              ))}
              {!data.hierarchy.epics.length && <Typography color="text.secondary" sx={{ py: 4 }}>No epics found in this repository. Create one to start the tree.</Typography>}
            </Paper>
            <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, width: { lg: 360 }, flexShrink: 0, borderColor: "divider" }}><Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}><BugReport sx={{ color: "error.main" }} /><Box><Typography variant="h6">Bugs</Typography><Typography variant="body2" color="text.secondary">Flat work items</Typography></Box></Stack>{data.hierarchy.bugs.map((bug) => <IssueLink key={bug.number} issue={bug} />)}{!data.hierarchy.bugs.length && <Typography color="text.secondary" sx={{ py: 2 }}>No bugs found.</Typography>}</Paper>
          </Stack>
        </>}
      </>}
    </Box>
    <CreateWorkItemDialog
      target={createTarget}
      submitting={creating}
      error={createError}
      onClose={() => setCreateTarget(null)}
      onSubmit={createWorkItem}
    />
  </Box></ThemeProvider>;
}

createRoot(document.getElementById("root")!).render(<App />);
