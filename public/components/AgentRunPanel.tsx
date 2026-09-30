import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, LinearProgress, Paper,
  Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import { PlayCircle, SmartToy, OpenInNew, HelpOutline, TravelExplore } from "@mui/icons-material";

// --- Types ---
export interface AgentRunInfo {
  runId: string;
  state: "running" | "done" | "rejected" | "failed";
  startedAt: number;
  finishedAt?: number;
  pullRequestUrl?: string;
  questionsCommentUrl?: string;
  message?: string;
}

export interface AgentQuestionInfo {
  kind: "question" | "dependency";
  text: string;
  answers: string[];
}

interface ScopingRunInfo {
  runId: string;
  state: "running" | "done" | "rejected" | "failed";
  startedAt: number;
  finishedAt?: number;
  conversationId?: string;
  message?: string;
}

interface AgentRunStatusResponse {
  run: AgentRunInfo | null;
  eligibility: { isTask: boolean; actionable: string; inProgress: boolean };
  questions: AgentQuestionInfo[];
  questionsCommentId: number | null;
  concurrency: { activeRuns: number; maxRuns: number };
  budgetMs: number;
  error?: string;
}

interface ScopingRunResponse {
  run: ScopingRunInfo | null;
  error?: string;
}

// --- Hook ---
interface UseAgentRunProps {
  owner: string;
  repo: string;
  issueNumber: number;
  issueType?: string;
  actionableLabel?: string;
  onRunFinished?: () => Promise<void>;
}

export interface UseAgentRunReturn {
  // State
  status: AgentRunStatusResponse | null;
  loading: boolean;
  starting: boolean;
  scoping: boolean;
  error: string;
  scopingRun: ScopingRunInfo | null;
  answers: string[];
  submittingAnswers: boolean;
  
  // Computed
  canImplement: boolean;
  canScope: boolean;
  isRunning: boolean;
  globalLimitReached: boolean;
  
  // Handlers
  handleStart: () => Promise<void>;
  handleScope: () => Promise<void>;
  handleSubmitAnswers: () => Promise<void>;
  setAnswers: React.Dispatch<React.SetStateAction<string[]>>;
  
  // Refresh
  refreshStatus: () => Promise<void>;
}

export function useAgentRun({ owner, repo, issueNumber, issueType, actionableLabel, onRunFinished }: UseAgentRunProps): UseAgentRunReturn {
  const [status, setStatus] = useState<AgentRunStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<string[]>([]);
  const [submittingAnswers, setSubmittingAnswers] = useState(false);
  const [scopingRun, setScopingRun] = useState<ScopingRunInfo | null>(null);
  const [scoping, setScoping] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async (): Promise<AgentRunStatusResponse | null> => {
    try {
      const response = await fetch(
        `/api/repos/${encodeURIComponent(repo)}/issues/${issueNumber}/agent-run?owner=${encodeURIComponent(owner)}`
      );
      const body = (await response.json()) as AgentRunStatusResponse;
      if (!response.ok) throw new Error(body.error || "Could not load agent run status");
      return body;
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      return null;
    }
  }, [owner, repo, issueNumber]);

  const fetchScopingRun = useCallback(async (): Promise<ScopingRunInfo | null> => {
    try {
      const response = await fetch(
        `/api/repos/${encodeURIComponent(repo)}/issues/${issueNumber}/scoping-run?owner=${encodeURIComponent(owner)}`
      );
      const body = (await response.json()) as ScopingRunResponse;
      if (!response.ok) throw new Error(body.error || "Could not load scoping run status");
      return body.run || null;
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      return null;
    }
  }, [owner, repo, issueNumber]);

  const refreshStatus = useCallback(async (): Promise<void> => {
    const body = await fetchStatus();
    if (body) {
      setStatus(body);
      setError("");
      const questionCount = body.questions.length;
      setAnswers((prev) => (prev.length === questionCount ? prev : Array(questionCount).fill("")));
    }
  }, [fetchStatus]);

  // Check if a run just finished and trigger onRunFinished
  const checkRunFinished = useCallback(async (prevRun: AgentRunInfo | null, currentRun: AgentRunInfo | null) => {
    if (!onRunFinished) return;
    
    // If there was no previous run and now there is a finished run, trigger the callback
    if (!prevRun && currentRun && (currentRun.state === "done" || currentRun.state === "rejected" || currentRun.state === "failed")) {
      await onRunFinished();
    }
    // If the previous run was running and now it's finished, trigger the callback
    else if (prevRun?.state === "running" && currentRun && (currentRun.state === "done" || currentRun.state === "rejected" || currentRun.state === "failed")) {
      await onRunFinished();
    }
  }, [onRunFinished]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const body = await fetchStatus();
      if (!cancelled && body) {
        setStatus(body);
        setError("");
        const questionCount = body.questions.length;
        setAnswers((prev) => (prev.length === questionCount ? prev : Array(questionCount).fill("")));
      }
      if (!cancelled) setLoading(false);
    };

    void load();
    pollRef.current = setInterval(() => {
      if (status?.run?.state === "running") void load();
    }, 15000);

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus, status?.run?.state]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const run = await fetchScopingRun();
      if (!cancelled && run) setScopingRun(run);
    };

    void load();
    const timer = setInterval(() => {
      if (scopingRun?.state === "running") void load();
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [fetchScopingRun, scopingRun?.state]);

  // Check for run completion and trigger onRunFinished
  useEffect(() => {
    if (status?.run) {
      void checkRunFinished(null, status.run);
    }
  }, [status?.run, checkRunFinished]);

  // Check for scoping run completion and trigger onRunFinished
  useEffect(() => {
    if (scopingRun && (scopingRun.state === "done" || scopingRun.state === "rejected" || scopingRun.state === "failed")) {
      if (onRunFinished) {
        void onRunFinished();
      }
    }
  }, [scopingRun, onRunFinished]);

  const canImplement =
    Boolean(issueType === "task") &&
    actionableLabel === "ready" &&
    !status?.eligibility.inProgress &&
    status?.run?.state !== "running";

  const canScope =
    Boolean(issueType === "task") &&
    Boolean(actionableLabel) &&
    actionableLabel !== "ready" &&
    actionableLabel !== "implemented" &&
    scopingRun?.state !== "running";

  const handleStart = useCallback(async () => {
    setStarting(true);
    setError("");
    try {
      const response = await fetch(
        `/api/repos/${encodeURIComponent(repo)}/issues/${issueNumber}/implement?owner=${encodeURIComponent(owner)}`,
        { method: "POST" }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error([body.error, body.details].filter(Boolean).join(" ") || "Could not start agent run");
      }
      await refreshStatus();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setStarting(false);
    }
  }, [owner, repo, issueNumber, refreshStatus]);

  const handleSubmitAnswers = useCallback(async () => {
    setSubmittingAnswers(true);
    setError("");
    try {
      const response = await fetch(
        `/api/repos/${encodeURIComponent(repo)}/issues/${issueNumber}/answers?owner=${encodeURIComponent(owner)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner, repo, answers }),
        }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not submit answers");
      await refreshStatus();
      setAnswers(Array(status?.questions.length || 0).fill(""));
      if (onRunFinished) {
        await onRunFinished();
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmittingAnswers(false);
    }
  }, [owner, repo, issueNumber, answers, refreshStatus, status?.questions.length, onRunFinished]);

  const handleScope = useCallback(async () => {
    setScoping(true);
    setError("");
    try {
      const response = await fetch(
        `/api/repos/${encodeURIComponent(repo)}/issues/${issueNumber}/scope?owner=${encodeURIComponent(owner)}`,
        { method: "POST" }
      );
      const body = (await response.json()) as { run?: ScopingRunInfo; error?: string; details?: string };
      if (!response.ok) {
        throw new Error([body.error, body.details].filter(Boolean).join(" ") || "Could not start scoping run");
      }
      if (body.run) setScopingRun(body.run);
    } catch (scopeError) {
      setError(scopeError instanceof Error ? scopeError.message : String(scopeError));
    } finally {
      setScoping(false);
    }
  }, [owner, repo, issueNumber]);

  const run = status?.run || null;
  const isRunning = run?.state === "running";
  const globalLimitReached = (status?.concurrency.activeRuns || 0) >= (status?.concurrency.maxRuns || 2);

  return {
    status,
    loading,
    starting,
    scoping,
    error,
    scopingRun,
    answers,
    submittingAnswers,
    canImplement,
    canScope,
    isRunning,
    globalLimitReached,
    handleStart,
    handleScope,
    handleSubmitAnswers,
    setAnswers,
    refreshStatus,
  };
}

// --- Component ---
interface AgentRunPanelProps {
  owner: string;
  repo: string;
  issueNumber: number;
  issueType?: string;
  actionableLabel?: string;
  onRunFinished?: () => Promise<void>;
}

function stateLabel(state: AgentRunInfo["state"]): string {
  switch (state) {
    case "running":
      return "Running";
    case "done":
      return "Done — draft PR opened";
    case "rejected":
      return "Rejected — questions posted";
    default:
      return "Failed";
  }
}

export function AgentRunPanel({ owner, repo, issueNumber, issueType, actionableLabel, onRunFinished }: AgentRunPanelProps): React.JSX.Element {
  const {
    status,
    loading,
    starting,
    scoping,
    error,
    scopingRun,
    answers,
    submittingAnswers,
    canImplement,
    canScope,
    isRunning,
    globalLimitReached,
    handleStart,
    handleScope,
    handleSubmitAnswers,
    setAnswers,
  } = useAgentRun({ owner, repo, issueNumber, issueType, actionableLabel, onRunFinished });

  if (loading) {
    return (
      <Paper variant="outlined" sx={{ p: 2, borderColor: "divider" }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">Loading agent status…</Typography>
        </Stack>
      </Paper>
    );
  }

  const run = status?.run || null;
  const questions = status?.questions || [];

  return (
    <Paper variant="outlined" sx={{ p: 2, borderColor: "divider" }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <SmartToy sx={{ color: "secondary.main" }} fontSize="small" />
        <Typography variant="subtitle1" fontWeight={700}>Implement agent</Typography>
        <Tooltip title={`Max ${status?.concurrency.maxRuns ?? 2} concurrent runs. ${status?.concurrency.activeRuns ?? 0} active.`}>
          <Chip size="small" variant="outlined" label={`${status?.concurrency.activeRuns ?? 0}/${status?.concurrency.maxRuns ?? 2} active`} sx={{ height: 22, borderColor: "divider", color: "text.secondary" }} />
        </Tooltip>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}

      {issueType !== "task" && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Only task issues can be implemented by the agent.
        </Typography>
      )}

      {issueType === "task" && actionableLabel && actionableLabel !== "ready" && !isRunning && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            This task is <code>actionable:{actionableLabel}</code>. Relabel it <code>actionable:ready</code> to enable implementation — or let the scoping agent decide.
          </Typography>
          {scopingRun && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Chip
                size="small"
                variant="outlined"
                label={scopingRun.state === "running" ? "Scoping…" : scopingRun.state === "done" ? "Scoped — actionable" : scopingRun.state === "rejected" ? "Not actionable — questions posted" : "Scoping failed"}
                color={scopingRun.state === "done" ? "success" : scopingRun.state === "rejected" ? "warning" : scopingRun.state === "failed" ? "error" : "info"}
              />
              <Typography variant="caption" color="text.secondary">
                {new Date(scopingRun.startedAt).toLocaleTimeString()}
              </Typography>
              {scopingRun.conversationId && (
                <Button
                  size="small"
                  href={`/api/agent/conversations/${scopingRun.conversationId}/history`}
                  target="_blank"
                  rel="noreferrer"
                  startIcon={<OpenInNew />}
                  sx={{ minHeight: 24, fontSize: "0.75rem", fontFamily: "monospace" }}
                >
                  {scopingRun.conversationId.slice(0, 8)}…
                </Button>
              )}
            </Stack>
          )}
          {scopingRun?.state === "running" && <LinearProgress sx={{ mb: 1 }} />}
          <Button
            variant="outlined"
            size="small"
            startIcon={scopingRun?.state === "running" ? <CircularProgress size={16} color="inherit" /> : <TravelExplore />}
            disabled={!canScope || scoping}
            onClick={() => void handleScope()}
          >
            {scopingRun?.state === "running" ? "Scoping agent running…" : scoping ? "Starting…" : "Scope"}
          </Button>
        </Box>
      )}

      {run && (
        <Box sx={{ mb: 1.5 }}>
          {isRunning && <LinearProgress sx={{ mb: 1 }} />}
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              size="small"
              label={stateLabel(run.state)}
              color={run.state === "done" ? "success" : run.state === "rejected" ? "warning" : run.state === "failed" ? "error" : "info"}
              variant="outlined"
            />
            <Typography variant="caption" color="text.secondary">
              started {new Date(run.startedAt).toLocaleTimeString()}
            </Typography>
          </Stack>
          {run.message && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{run.message}</Typography>
          )}
          {run.pullRequestUrl && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<OpenInNew />}
              href={run.pullRequestUrl}
              target="_blank"
              rel="noreferrer"
              sx={{ mt: 1 }}
            >
              View draft PR
            </Button>
          )}
        </Box>
      )}

      {questions.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Divider sx={{ my: 1, borderColor: "divider" }} />
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <HelpOutline sx={{ color: "warning.main" }} fontSize="small" />
            <Typography variant="body2" fontWeight={600}>Agent questions</Typography>
          </Stack>
          {questions.map((question, index) => (
            <Box key={index} sx={{ mb: 1.5 }}>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                <Chip size="small" label={question.kind} variant="outlined" sx={{ height: 20, mr: 1, borderColor: "divider", color: "text.secondary" }} />
                {question.text}
              </Typography>
              {question.answers.map((answer, answerIndex) => (
                <Typography key={answerIndex} variant="body2" color="text.secondary" sx={{ pl: 3, fontStyle: "italic" }}>
                  → {answer}
                </Typography>
              ))}
              <TextField
                fullWidth
                size="small"
                placeholder="Your answer…"
                value={answers[index] || ""}
                onChange={(event) => {
                  const next = [...answers];
                  next[index] = event.target.value;
                  setAnswers(next);
                }}
                sx={{ mt: 0.5 }}
              />
            </Box>
          ))}
          <Button
            variant="contained"
            size="small"
            disabled={submittingAnswers || !answers.some((answer) => answer.trim())}
            onClick={() => void handleSubmitAnswers()}
          >
            {submittingAnswers ? "Submitting…" : "Submit answers and mark ready"}
          </Button>
        </Box>
      )}

      {issueType === "task" && (
        <Button
          variant="contained"
          startIcon={isRunning ? <CircularProgress size={16} color="inherit" /> : <PlayCircle />}
          disabled={!canImplement || starting || globalLimitReached}
          onClick={() => void handleStart()}
          sx={{ mt: questions.length || run ? 1 : 0 }}
        >
          {isRunning ? "Agent running…" : starting ? "Starting…" : "Implement"}
        </Button>
      )}

      {globalLimitReached && !isRunning && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Global concurrent run limit reached; wait for a running agent to finish.
        </Typography>
      )}
    </Paper>
  );
}
