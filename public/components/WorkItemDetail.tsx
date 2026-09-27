import React, { useState, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Avatar, Box, Button, Chip, CircularProgress, Divider, Paper, Stack, TextField, Typography } from "@mui/material";
import { ArrowBack, BugReport, Edit, FolderOpen, Save, TaskAlt } from "@mui/icons-material";
import { type WorkItem } from "../../src/shared/workItems";
import { AIAssistantPanel } from "./AIAssistantPanel";
import { AgentRunPanel } from "./AgentRunPanel";

interface WorkItemDetailProps {
  workItem: WorkItem | null;
  owner: string;
  repo: string;
  onBack: () => void;
  onSave: (issueNumber: number, body: string) => Promise<void>;
  allEpics?: Array<{ slug: string; title: string; body?: string }>;
  allFeatures?: Array<{ slug: string; title: string; body?: string; epicSlug?: string }>;
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

export function WorkItemDetail({ workItem, owner, repo, onBack, onSave, allEpics = [], allFeatures = [] }: WorkItemDetailProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [repositoryReadme, setRepositoryReadme] = useState("");
  const [loadingReadme, setLoadingReadme] = useState(false);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);

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

  if (!workItem) {
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <Typography color="text.secondary">Work item not found</Typography>
      </Box>
    );
  }

  const type = workItem.labels.type;
  const status = workItem.labels.status;
  const priority = workItem.labels.priority;
  const epicSlug = workItem.labels.epic;
  const featureSlug = workItem.labels.feature;
  const taskSlug = workItem.labels.task;

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
      // Refresh the work item to get the latest data
      // This would require a prop to refetch, but for now just toggle editing
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

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
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
        <Chip
          icon={getTypeIcon(type)}
          label={getTypeLabel(type)}
          variant="outlined"
          sx={{ borderColor: "divider", color: "text.secondary" }}
        />
      </Stack>

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
              <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                {type && (
                  <Chip label={`type: ${type}`} size="small" variant="outlined" sx={{ height: 22, borderColor: "divider", color: "text.secondary" }} />
                )}
                {status && (
                  <Chip label={`status: ${status}`} size="small" variant="outlined" sx={{ height: 22, borderColor: "divider", color: "text.secondary" }} />
                )}
                {priority && (
                  <Chip label={`priority: ${priority}`} size="small" variant="outlined" sx={{ height: 22, borderColor: "divider", color: "text.secondary" }} />
                )}
                {epicSlug && (
                  <Chip label={`epic: ${epicSlug}`} size="small" variant="outlined" sx={{ height: 22, borderColor: "divider", color: "text.secondary" }} />
                )}
                {featureSlug && (
                  <Chip label={`feature: ${featureSlug}`} size="small" variant="outlined" sx={{ height: 22, borderColor: "divider", color: "text.secondary" }} />
                )}
                {taskSlug && (
                  <Chip label={`task: ${taskSlug}`} size="small" variant="outlined" sx={{ height: 22, borderColor: "divider", color: "text.secondary" }} />
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

        {/* AI Assistant Panel - on the right side */}
        <Box sx={{ width: { lg: 360 }, flexShrink: 0 }}>
          <Stack spacing={2}>
            {type === "task" && (
              <AgentRunPanel
                owner={owner}
                repo={repo}
                issueNumber={workItem.number}
                issueType={type}
                actionableLabel={workItem.labels.actionable}
              />
            )}
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
