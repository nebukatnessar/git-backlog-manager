import React, { useState, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, Divider, IconButton, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { ArrowBack, BugReport, Edit, FolderOpen, Info, Save, TaskAlt, PlayCircle, TravelExplore } from "@mui/icons-material";
import { type WorkItem } from "../../src/shared/workItems";
import { AIAssistantPanel } from "./AIAssistantPanel";
import { AgentRunPanel } from "./AgentRunPanel";
import { Alert } from "@mui/material";

interface WorkItemDetailProps {
  workItem: WorkItem | null;
  owner: string;
  repo: string;
  onBack: () => void;
  onSave: (issueNumber: number, body: string) => Promise<void>;
  allEpics?: Array<{ slug: string; title: string; body?: string }>;
  allFeatures?: Array<{ slug: string; title: string; body?: string; epicSlug?: string }>;
  onStatusChange?: (issueNumber: number, status: string) => Promise<void>;
  onPriorityChange?: (issueNumber: number, priority: string) => Promise<void>;
  onRunFinished?: () => Promise<void>;
}

function getTypeIcon(type: string | undefined): React.JSX.Element {
  switch (type) {
    case "epic":
      return <FolderOpen sx={{ color: "secondary.main" }} />;
    case "bug":
      return <BugReport sx={{ color: "error.main" }} />;
    default:
      return <TaskAlt sx={{ color: "primary.main" }} />;
  }
}

function getTypeLabel(type: string | undefined): string {
  switch (type) {
    case "epic":
      return "Epic";
    case "feature":
      return "Feature";
    case "task":
      return "Task";
    case "bug":
      return "Bug";
    default:
      return "Work Item";
  }
}

interface ConversationMessage {
  role: "user" | "model";
  content: string;
}

// Status and priority options as per issue #12
const STATUS_OPTIONS = ["backlog", "in-progress", "removed", "ready-for-review", "approved", "done"] as const;
const PRIORITY_OPTIONS = ["low", "medium", "high"] as const;

export function WorkItemDetail({ 
  workItem, 
  owner, 
  repo, 
  onBack, 
  onSave, 
  allEpics = [], 
  allFeatures = [],
  onStatusChange,
  onPriorityChange,
  onRunFinished,
}: WorkItemDetailProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [repositoryReadme, setRepositoryReadme] = useState("");
  const [loadingReadme, setLoadingReadme] = useState(false);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  
  // State for label dropdowns
  const [statusValue, setStatusValue] = useState<string>("");
  const [priorityValue, setPriorityValue] = useState<string>("");
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [updatingPriority, setUpdatingPriority] = useState(false);
  const [statusError, setStatusError] = useState<string>("");
  const [priorityError, setPriorityError] = useState<string>("");
  const [labelsDialogOpen, setLabelsDialogOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [scoping, setScoping] = useState(false);
  const [agentError, setAgentError] = useState("");

  // State for stack rank field
  const [stackRankValue, setStackRankValue] = useState<string>("");
  const [updatingStackRank, setUpdatingStackRank] = useState(false);
  const [stackRankError, setStackRankError] = useState<string>("");

  // Handler for starting implementation
  const handleStart = useCallback(async () => {
    if (!workItem || !owner || !repo) return;
    setStarting(true);
    setAgentError("");
    try {
      const response = await fetch(
        `/api/repos/${encodeURIComponent(repo)}/issues/${workItem.number}/implement?owner=${encodeURIComponent(owner)}`,
        { method: "POST" }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error([body.error, body.details].filter(Boolean).join(" ") || "Could not start agent run");
      }
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }, [workItem, owner, repo]);

  // Handler for starting scoping
  const handleScope = useCallback(async () => {
    if (!workItem || !owner || !repo) return;
    setScoping(true);
    setAgentError("");
    try {
      const response = await fetch(
        `/api/repos/${encodeURIComponent(repo)}/issues/${workItem.number}/scope?owner=${encodeURIComponent(owner)}`,
        { method: "POST" }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error([body.error, body.details].filter(Boolean).join(" ") || "Could not start scoping run");
      }
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : String(error));
    } finally {
      setScoping(false);
    }
  }, [workItem, owner, repo]);

  // Fetch repository README when component mounts or repo changes
  useEffect(() => {
    if (!owner || !repo) return;
    
    const fetchReadme = async () => {
      setLoadingReadme(true);
      try {
        const response = await fetch(`/api/repos/${encodeURIComponent(repo)}/readme?owner=${encodeURIComponent(owner)}`);
        const data = await response.json();
        if (data.readme) {
          setRepositoryReadme(data.readme);
        }
      } catch (error) {
        console.warn("Could not fetch README:", error);
      } finally {
        setLoadingReadme(false);
      }
    };
    
    void fetchReadme();
  }, [owner, repo]);

  // Fetch AI conversation from GitHub issue comments
  useEffect(() => {
    if (!workItem || !owner || !repo) return;

    const fetchConversation = async () => {
      try {
        const response = await fetch(
          `/api/repos/${encodeURIComponent(repo)}/issues/${workItem.number}/conversation?owner=${encodeURIComponent(owner)}`
        );
        const data = await response.json();
        if (data.conversation && Array.isArray(data.conversation)) {
          setConversation(data.conversation);
        }
      } catch (error) {
        console.warn("Could not fetch conversation:", error);
      }
    };

    void fetchConversation();
  }, [workItem, owner, repo]);

  // Initialize label dropdowns and stack rank when workItem changes
  useEffect(() => {
    if (workItem) {
      const rawStatus = workItem.labels.status || "";
      const rawPriority = workItem.labels.priority || "";
      setStatusValue(rawStatus.startsWith("status:") ? rawStatus.substring(7) : rawStatus);
      setPriorityValue(rawPriority.startsWith("priority:") ? rawPriority.substring(9) : rawPriority);
      
      // Initialize stack rank from the stack-rank label
      const rawStackRank = workItem.labels["stack-rank"] || "";
      setStackRankValue(rawStackRank.startsWith("stack-rank:") ? rawStackRank.substring(11) : rawStackRank);
    }
  }, [workItem]);

  if (!workItem) {
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <Typography color="text.secondary">Work item not found</Typography>
      </Box>
    );
  }

  const type = workItem.labels.type;
  const rawStatus = workItem.labels.status || "";
  const status = rawStatus.startsWith("status:") ? rawStatus.substring(7) : rawStatus;
  const rawPriority = workItem.labels.priority || "";
  const priority = rawPriority.startsWith("priority:") ? rawPriority.substring(9) : rawPriority;
  const epicSlug = workItem.labels.epic;
  const featureSlug = workItem.labels.feature;
  const taskSlug = workItem.labels.task;
  const actionableLabel = workItem.labels.actionable;
  
  // Prepare parent epic and feature data in the format expected by AIAssistantPanel
  const foundEpic = epicSlug ? allEpics.find(e => e.slug === epicSlug) : undefined;
  const foundFeature = featureSlug ? allFeatures.find(f => f.slug === featureSlug && f.epicSlug === epicSlug) : undefined;

  const parentEpic = foundEpic ? { title: foundEpic.title, description: foundEpic.body || "" } : undefined;
  const parentFeature = foundFeature ? { title: foundFeature.title, description: foundFeature.body || "" } : undefined;

  const handleStartEdit = useCallback(() => {
    setIsEditing(true);
    setEditBody(workItem.body || "");
    setSaveError("");
  }, [workItem.body]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setSaveError("");
  }, []);

  const handleSave = useCallback(async () => {
    if (!onSave) return;
    setSaving(true);
    setSaveError("");
    try {
      await onSave(workItem.number, editBody);
      
      // Save AI conversation to GitHub issue comment
      if (conversation.length > 0) {
        try {
          await fetch(`/api/repos/${encodeURIComponent(repo)}/issues/${workItem.number}/conversation`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              owner,
              conversation,
            }),
          });
        } catch (convError) {
          console.warn("Failed to save conversation:", convError);
        }
      }
      
      setIsEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [onSave, workItem.number, editBody, conversation, owner, repo]);

  const handleApplyAISuggestion = useCallback((updatedDescription: string) => {
    if (isEditing) {
      setEditBody(updatedDescription);
    } else {
      // If not in edit mode, enter edit mode and set the description
      setIsEditing(true);
      setEditBody(updatedDescription);
    }
  }, [isEditing]);

  // Handle status dropdown change
  const handleStatusChange = useCallback(async (newStatus: string) => {
    if (!workItem || !onStatusChange) return;
    
    setUpdatingStatus(true);
    setStatusError("");
    
    try {
      // Optimistically update the UI
      setStatusValue(newStatus);
      
      // Call the parent handler to dispatch the action
      await onStatusChange(workItem.number, newStatus);
    } catch (error) {
      // Revert the UI on error
      setStatusValue(status || "");
      setStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdatingStatus(false);
    }
  }, [workItem, onStatusChange, status]);

  // Handle priority dropdown change
  const handlePriorityChange = useCallback(async (newPriority: string) => {
    if (!workItem || !onPriorityChange) return;
    
    setUpdatingPriority(true);
    setPriorityError("");
    
    try {
      // Optimistically update the UI
      setPriorityValue(newPriority);
      
      // Call the parent handler to dispatch the action
      await onPriorityChange(workItem.number, newPriority);
    } catch (error) {
      // Revert the UI on error
      setPriorityValue(priority || "");
      setPriorityError(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdatingPriority(false);
    }
  }, [workItem, onPriorityChange, priority]);

  // Handle stack rank field change
  const handleStackRankChange = useCallback(async (newValue: string) => {
    if (!workItem || !owner || !repo) return;
    
    // Validate input: must be a positive integer
    if (newValue === "") {
      // Empty input: clear the field and remove the label
      setUpdatingStackRank(true);
      setStackRankError("");
      
      try {
        // Optimistically update the UI
        const previousValue = stackRankValue;
        setStackRankValue("");
        
        // Call the API to remove the stack-rank label
        const label = `stack-rank:`;
        const response = await fetch(
          `/api/repos/${encodeURIComponent(repo)}/issues/${workItem.number}/label/${encodeURIComponent(label)}?owner=${encodeURIComponent(owner)}`,
          { method: "POST" }
        );
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to update stack rank");
        }
      } catch (error) {
        // Revert the UI on error
        setStackRankValue(stackRankValue);
        setStackRankError(error instanceof Error ? error.message : String(error));
      } finally {
        setUpdatingStackRank(false);
      }
      return;
    }
    
    const numericValue = parseInt(newValue, 10);
    if (isNaN(numericValue) || numericValue < 0 || !Number.isInteger(numericValue)) {
      setStackRankError("Stack rank must be a positive integer");
      return;
    }
    
    setUpdatingStackRank(true);
    setStackRankError("");
    
    try {
      // Optimistically update the UI
      const previousValue = stackRankValue;
      setStackRankValue(newValue);
      
      // Call the API to update the label
      const label = `stack-rank:${numericValue}`;
      const response = await fetch(
        `/api/repos/${encodeURIComponent(repo)}/issues/${workItem.number}/label/${encodeURIComponent(label)}?owner=${encodeURIComponent(owner)}`,
        { method: "POST" }
      );
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update stack rank");
      }
    } catch (error) {
      // Revert the UI on error
      setStackRankValue(stackRankValue);
      setStackRankError(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdatingStackRank(false);
    }
  }, [workItem, owner, repo, stackRankValue]);

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3, flexWrap: "wrap" }}>
        <Button startIcon={<ArrowBack />} variant="outlined" onClick={onBack}>
          Back to hierarchy
        </Button>
        <Typography variant="h5" sx={{ flex: 1 }}>
          #{workItem.number} {workItem.title}
        </Typography>
        {isEditing ? (
          <>
            <Button startIcon={<Save />} variant="contained" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button startIcon={<ArrowBack />} variant="outlined" onClick={handleCancelEdit} disabled={saving}>
              Cancel
            </Button>
          </>
        ) : (
          <Button startIcon={<Edit />} variant="outlined" onClick={handleStartEdit}>
            Edit
          </Button>
        )}
        {/* Scope and Implement buttons for task issues */}
        {type === "task" && (
          <>
            {actionableLabel && actionableLabel !== "ready" && actionableLabel !== "implemented" && (
              <Button
                variant="contained"
                startIcon={scoping ? <CircularProgress size={16} color="inherit" /> : <TravelExplore />}
                disabled={scoping}
                onClick={() => void handleScope()}
                color="secondary"
              >
                {scoping ? "Scoping..." : "Scope"}
              </Button>
            )}
            {actionableLabel === "ready" && (
              <Button
                variant="contained"
                startIcon={starting ? <CircularProgress size={16} color="inherit" /> : <PlayCircle />}
                disabled={starting}
                onClick={() => void handleStart()}
              >
                {starting ? "Running..." : "Implement"}
              </Button>
            )}
          </>
        )}
        <Chip
          icon={getTypeIcon(type)}
          label={getTypeLabel(type)}
          variant="outlined"
          sx={{ borderColor: "divider", color: "text.secondary" }}
        />
      </Stack>

      {/* Agent error alert (shared with panel) */}
      {agentError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {agentError}
        </Alert>
      )}

      <Stack direction={{ xs: "column", lg: "row" }} spacing={3} alignItems="flex-start">
        <Paper variant="outlined" sx={{ p: 3, borderColor: "divider", flex: 1, width: "100%" }}>
          <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
            <Avatar sx={{ width: 48, height: 48, bgcolor: type === "epic" ? "#3c3020" : type === "bug" ? "#4a1d1d" : "#1d3733", color: type === "epic" ? "secondary.main" : type === "bug" ? "error.main" : "primary.main" }}>
              {getTypeIcon(type)}
            </Avatar>
            <Box>
              <Typography variant="h4" fontWeight={700}>
                #{workItem.number} {workItem.title}
              </Typography>
              <Stack direction="row" spacing={2} sx={{ mt: 1, alignItems: "center" }}>
                {/* Type label - read-only text */}
                {type && (
                  <Typography variant="body2" color="text.secondary">
                    type: {type}
                  </Typography>
                )}
                
                {/* Status dropdown */}
                <Box sx={{ minWidth: 180 }}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    label="Status"
                    value={statusValue}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    disabled={updatingStatus}
                    error={!!statusError}
                    helperText={statusError}
                    InputProps={{
                      startAdornment: updatingStatus ? <CircularProgress size={20} /> : null,
                    }}
                  >
                    <MenuItem value="">Select status</MenuItem>
                    {STATUS_OPTIONS.map((option) => (
                      <MenuItem key={option} value={option}>
                        {option}
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>
                
                {/* Priority dropdown */}
                <Box sx={{ minWidth: 150 }}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    label="Priority"
                    value={priorityValue}
                    onChange={(e) => handlePriorityChange(e.target.value)}
                    disabled={updatingPriority}
                    error={!!priorityError}
                    helperText={priorityError}
                    InputProps={{
                      startAdornment: updatingPriority ? <CircularProgress size={20} /> : null,
                    }}
                  >
                    <MenuItem value="">Select priority</MenuItem>
                    {PRIORITY_OPTIONS.map((option) => (
                      <MenuItem key={option} value={option}>
                        {option}
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>

                {/* Stack rank field */}
                <Box sx={{ minWidth: 120 }}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Stack rank"
                    type="number"
                    inputMode="numeric"
                    value={stackRankValue}
                    onChange={(e) => setStackRankValue(e.target.value)}
                    onBlur={() => handleStackRankChange(stackRankValue)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleStackRankChange(stackRankValue);
                      }
                    }}
                    disabled={updatingStackRank}
                    error={!!stackRankError}
                    helperText={stackRankError}
                    InputProps={{
                      startAdornment: updatingStackRank ? <CircularProgress size={20} /> : null,
                    }}
                  />
                </Box>
                
                {/* Other labels - moved to dialog to save space */}
                {(epicSlug || featureSlug || taskSlug) && (
                  <IconButton
                    size="small"
                    onClick={() => setLabelsDialogOpen(true)}
                    title="View hierarchy labels"
                    sx={{ height: 22, width: 22, borderColor: "divider", color: "text.secondary" }}
                  >
                    <Info fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            </Box>
          </Stack>

          <Divider sx={{ my: 2, borderColor: "divider" }} />

          <Typography variant="h6" sx={{ mb: 2 }}>Description</Typography>
          {saveError && (
            <Typography color="error" sx={{ mb: 2 }}>{saveError}</Typography>
          )}
          {isEditing ? (
            <TextField
              fullWidth
              multiline
              rows={10}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              variant="outlined"
              sx={{
                bgcolor: "background.paper",
                borderRadius: 1,
                borderColor: "divider",
                mb: 2,
              }}
              InputProps={{
                sx: {
                  fontFamily: "monospace",
                  fontSize: "0.875rem",
                },
              }}
            />
          ) : workItem.body ? (
            <Box
              sx={{
                p: 2,
                bgcolor: "background.paper",
                borderRadius: 1,
                border: "1px solid",
                borderColor: "divider",
              }}
            >
              <ReactMarkdown
                components={{
                  p: ({ children }) => <Typography sx={{ mb: 1, fontSize: "0.875rem", color: "text.primary" }}>{children}</Typography>,
                  h1: ({ children }) => <Typography variant="h4" sx={{ mt: 2, mb: 1 }}>{children}</Typography>,
                  h2: ({ children }) => <Typography variant="h5" sx={{ mt: 2, mb: 1 }}>{children}</Typography>,
                  h3: ({ children }) => <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>{children}</Typography>,
                  ul: ({ children }) => <Box component="ul" sx={{ pl: 2, m: 0 }}>{children}</Box>,
                  ol: ({ children }) => <Box component="ol" sx={{ pl: 2, m: 0 }}>{children}</Box>,
                  li: ({ children }) => <Typography component="li" sx={{ fontSize: "0.875rem", color: "text.primary" }}>{children}</Typography>,
                  code: ({ children }) => <Box component="code" sx={{ fontFamily: "monospace", fontSize: "0.875rem", bgcolor: "action.selected", px: 0.5, borderRadius: 0.5 }}>{children}</Box>,
                  pre: ({ children }) => <Box sx={{ bgcolor: "#1d1d1d", p: 2, borderRadius: 1, overflow: "auto", my: 1 }}><code>{children}</code></Box>,
                  a: ({ children, href }) => <Typography component="a" href={href} sx={{ color: "primary.main", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}>{children}</Typography>,
                }}
              >
                {workItem.body}
              </ReactMarkdown>
            </Box>
          ) : (
            <Typography color="text.secondary" sx={{ fontStyle: "italic" }}>
              No description provided
            </Typography>
          )}

          <Divider sx={{ my: 2, borderColor: "divider" }} />

          <Box>
            <Typography variant="body2" color="text.secondary">
              Repository: {owner}/{repo}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              State: {workItem.state}
            </Typography>
            <Button
              variant="outlined"
              href={workItem.html_url}
              target="_blank"
              rel="noreferrer"
              sx={{ mt: 2 }}
            >
              View on GitHub
            </Button>
          </Box>
        </Paper>

        {/* Labels Dialog */}
        <Dialog open={labelsDialogOpen} onClose={() => setLabelsDialogOpen(false)}>
          <DialogTitle>Hierarchy Labels</DialogTitle>
          <DialogContent>
            <Stack direction="column" spacing={1} sx={{ pt: 1 }}>
              {epicSlug && (
                <Chip label={`epic: ${epicSlug}`} size="small" variant="outlined" sx={{ borderColor: "divider", color: "text.secondary" }} />
              )}
              {featureSlug && (
                <Chip label={`feature: ${featureSlug}`} size="small" variant="outlined" sx={{ borderColor: "divider", color: "text.secondary" }} />
              )}
              {taskSlug && (
                <Chip label={`task: ${taskSlug}`} size="small" variant="outlined" sx={{ borderColor: "divider", color: "text.secondary" }} />
              )}
            </Stack>
          </DialogContent>
        </Dialog>

        {/* AI Assistant Panel - on the right side */}
        <Box sx={{ width: { lg: 360 }, flexShrink: 0 }}>
          <Stack spacing={2}>
            {/* AgentRunPanel now rendered for all work item types */}
            <AgentRunPanel
              owner={owner}
              repo={repo}
              issueNumber={workItem.number}
              issueType={type}
              actionableLabel={actionableLabel}
              onRunFinished={onRunFinished}
            />
            <AIAssistantPanel
            key={`ai-assistant-${workItem.number}`}
            description={isEditing ? editBody : (workItem.body || "")}
            additionalContext={{
              workItemTitle: workItem.title,
              parentEpic,
              parentFeature,
              repositoryReadme: repositoryReadme || undefined,
            }}
            onApplySuggestion={handleApplyAISuggestion}
            conversation={conversation}
            onConversationChange={setConversation}
          />
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}
