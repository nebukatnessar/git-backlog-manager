import React, { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Avatar, Box, Button, Chip, CircularProgress, Divider, Paper, Stack, TextField, Typography } from "@mui/material";
import { ArrowBack, BugReport, Edit, FolderOpen, Save, TaskAlt } from "@mui/icons-material";
import { type WorkItem } from "../../src/shared/workItems";

interface WorkItemDetailProps {
  workItem: WorkItem | null;
  owner: string;
  repo: string;
  onBack: () => void;
  onSave: (issueNumber: number, body: string) => Promise<void>;
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

export function WorkItemDetail({ workItem, owner, repo, onBack, onSave }: WorkItemDetailProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

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
      setIsEditing(false);
      // Refresh the work item to get the latest data
      // This would require a prop to refetch, but for now just toggle editing
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [onSave, workItem.number, editBody]);

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
          onSave && (
            <Button startIcon={<Edit />} variant="outlined" onClick={handleStartEdit}>
              Edit
            </Button>
          )
        )}
        <Chip
          icon={getTypeIcon(type)}
          label={getTypeLabel(type)}
          variant="outlined"
          sx={{ borderColor: "divider", color: "text.secondary" }}
        />
      </Stack>

      <Paper variant="outlined" sx={{ p: 3, borderColor: "divider", mb: 3 }}>
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
    </Box>
  );
}
