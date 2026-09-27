import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle,
  Divider, Stack, Typography,
} from "@mui/material";
import { OpenInNew, SmartToy } from "@mui/icons-material";

export interface AgentsPopupRun {
  runId: string;
  owner: string;
  repo: string;
  issueNumber: number;
  state: "running" | "done" | "rejected" | "failed";
  startedAt: number;
  finishedAt?: number;
  conversationId?: string;
  pullRequestUrl?: string;
  message?: string;
}

interface AgentDebugResponse {
  configuredModel?: string;
  configuredScopingModel?: string;
  agent?: { id?: string; name?: string; model?: string; tools?: Array<Record<string, unknown>> } | null;
  scopingAgent?: { id?: string; name?: string; model?: string; tools?: Array<Record<string, unknown>> } | null;
  message?: string;
  error?: string;
}

interface AgentRunsResponse {
  implementRuns: AgentsPopupRun[];
  scopingRuns: AgentsPopupRun[];
  concurrency: { activeRuns: number; maxRuns: number };
  error?: string;
}

function toolSummary(tools: Array<Record<string, unknown>> | undefined): string {
  if (!tools || tools.length === 0) return "none";
  return tools
    .map((tool) => {
      if (tool.type === "connector") {
        const connectorId = String(tool.connector_id || "").slice(0, 8);
        return `connector ${connectorId}…`;
      }
      return String(tool.type || "tool");
    })
    .join(", ");
}

function stateColor(state: AgentsPopupRun["state"]): "success" | "warning" | "error" | "info" {
  if (state === "done") return "success";
  if (state === "rejected") return "warning";
  if (state === "failed") return "error";
  return "info";
}

function RunRow({ run, kind }: { run: AgentsPopupRun; kind: string }): React.JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.5, flexWrap: "wrap" }}>
      <Chip size="small" variant="outlined" label={kind} sx={{ height: 20, borderColor: "divider", color: "text.secondary" }} />
      <Chip size="small" label={run.state} color={stateColor(run.state)} variant="outlined" />
      <Typography variant="body2">
        #{run.issueNumber}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {new Date(run.startedAt).toLocaleTimeString()}
      </Typography>
      {run.conversationId && (
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
          {run.conversationId}
        </Typography>
      )}
      {run.pullRequestUrl && (
        <Button size="small" href={run.pullRequestUrl} target="_blank" rel="noreferrer" startIcon={<OpenInNew />} sx={{ minHeight: 24, fontSize: "0.75rem" }}>
          PR
        </Button>
      )}
      {run.state === "running" && <CircularProgress size={14} />}
    </Stack>
  );
}

interface AgentsPopupProps {
  open: boolean;
  owner: string;
  repo: string;
  onClose: () => void;
}

export function AgentsPopup({ open, owner, repo, onClose }: AgentsPopupProps): React.JSX.Element {
  const [debug, setDebug] = useState<AgentDebugResponse | null>(null);
  const [runs, setRuns] = useState<AgentRunsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [debugResponse, runsResponse] = await Promise.all([
        fetch(`/api/agent/debug?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`),
        fetch(`/api/agent/runs?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`),
      ]);
      const debugBody = (await debugResponse.json()) as AgentDebugResponse;
      const runsBody = (await runsResponse.json()) as AgentRunsResponse;
      if (!debugResponse.ok) throw new Error(debugBody.error || "Could not load agent configuration");
      if (!runsResponse.ok) throw new Error(runsBody.error || "Could not load agent runs");
      setDebug(debugBody);
      setRuns(runsBody);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [owner, repo]);

  useEffect(() => {
    if (!open) return;
    void load();
    pollRef.current = setInterval(() => void load(), 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [open, load]);

  const implementRuns = runs?.implementRuns || [];
  const scopingRuns = runs?.scopingRuns || [];
  const activeImplement = implementRuns.filter((run) => run.state === "running");
  const activeScoping = scopingRuns.filter((run) => run.state === "running");

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <SmartToy sx={{ color: "secondary.main" }} fontSize="small" />
          <Typography variant="h6" component="span">Agents · {owner}/{repo}</Typography>
        </Stack>
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {loading && !debug && <CircularProgress size={20} sx={{ mb: 2 }} />}

        <Typography variant="subtitle2" gutterBottom>Agent configuration</Typography>
        <Stack spacing={0.5} sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Implement agent: {debug?.agent ? (
              <>{debug.agent.name} · model <code>{debug.agent.model || debug.configuredModel}</code> · tools: {toolSummary(debug.agent.tools)}</>
            ) : debug?.message || "Not created yet — created on the first Implement run."}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Scoping agent: {debug?.scopingAgent ? (
              <>{debug.scopingAgent.name} · model <code>{debug.scopingAgent.model || debug.configuredScopingModel}</code> · tools: {toolSummary(debug.scopingAgent.tools)}</>
            ) : "Not created yet — created on the first Scope run."}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Concurrency: {runs?.concurrency.activeRuns ?? 0}/{runs?.concurrency.maxRuns ?? 2} implement runs active
          </Typography>
        </Stack>

        <Divider sx={{ my: 1.5, borderColor: "divider" }} />

        <Typography variant="subtitle2" gutterBottom>Running now</Typography>
        {(activeImplement.length || activeScoping.length) ? (
          <Box sx={{ mb: 2 }}>
            {activeImplement.map((run) => <RunRow key={run.runId} run={run} kind="implement" />)}
            {activeScoping.map((run) => <RunRow key={run.runId} run={run} kind="scope" />)}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>No agents currently running.</Typography>
        )}

        <Typography variant="subtitle2" gutterBottom>Recent runs</Typography>
        <Box>
          {[...implementRuns.filter((run) => run.state !== "running"), ...scopingRuns.filter((run) => run.state !== "running")]
            .sort((a, b) => b.startedAt - a.startedAt)
            .slice(0, 10)
            .map((run) => <RunRow key={run.runId} run={run} kind={run.runId.startsWith("scope-") ? "scope" : "implement"} />)}
          {!implementRuns.length && !scopingRuns.length && (
            <Typography variant="body2" color="text.secondary">No runs recorded in this server session.</Typography>
          )}
        </Box>

        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
          <Button size="small" onClick={() => void load()}>Refresh</Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
