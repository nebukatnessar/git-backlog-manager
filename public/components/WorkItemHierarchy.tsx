import React from "react";
import { Avatar, Box, Button, Chip, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { Add, ChevronRight, FolderOpen } from "@mui/icons-material";
import { type Epic, type Feature } from "../../src/shared/workItems";
import { IssueLink } from "./IssueLink";

interface WorkItemHierarchyProps {
  epics: Epic[];
  onAddEpic: () => void;
  onAddFeature: (epicSlug: string) => void;
  onAddTask: (epicSlug: string, featureSlug: string) => void;
}

interface FeatureBlockProps {
  feature: Feature;
  onAddTask: () => void;
}

function FeatureBlock({ feature, onAddTask }: FeatureBlockProps): React.JSX.Element {
  return (
    <Box sx={{ ml: 2.5, pl: 2, borderLeft: "1px solid", borderColor: "divider", py: 1 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <ChevronRight sx={{ fontSize: 18, color: "secondary.main" }} />
        <Box sx={{ flex: 1 }}>
          <Typography
            component="a"
            href={feature.html_url}
            target="_blank"
            rel="noreferrer"
            variant="body1"
            fontWeight={600}
            sx={{ color: "text.primary", textDecoration: "none", "&:hover": { color: "primary.main" } }}
          >
            #{feature.number} {feature.title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            feature:{feature.slug} · {feature.tasks.length} tasks
          </Typography>
        </Box>
        <Tooltip title="Add task">
          <Chip
            icon={<Add fontSize="small" />}
            label="Add"
            size="small"
            onClick={onAddTask}
            sx={{ cursor: "pointer", borderColor: "divider", color: "text.secondary" }}
          />
        </Tooltip>
      </Stack>
      <Box sx={{ mt: 0.5, ml: 2.75 }}>
        {feature.tasks.map((task) => (
          <IssueLink key={task.number} issue={task} />
        ))}
      </Box>
    </Box>
  );
}

export function WorkItemHierarchy({
  epics,
  onAddEpic,
  onAddFeature,
  onAddTask,
}: WorkItemHierarchyProps): React.JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, flex: 1, width: "100%", borderColor: "divider" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6">Work item hierarchy</Typography>
          <Typography variant="body2" color="text.secondary">Epics, features, and tasks</Typography>
        </Box>
        <Button startIcon={<Add />} variant="outlined" onClick={onAddEpic}>
          New epic
        </Button>
      </Stack>
      {epics.map((epic) => (
        <Box key={epic.number} sx={{ py: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar sx={{ width: 34, height: 34, bgcolor: "#3c3020", color: "secondary.main" }}>
              <FolderOpen fontSize="small" />
            </Avatar>
            <Box sx={{ flex: 1 }}>
              <Typography
                component="a"
                href={epic.html_url}
                target="_blank"
                rel="noreferrer"
                fontWeight={700}
                sx={{ color: "text.primary", textDecoration: "none", "&:hover": { color: "primary.main" } }}
              >
                #{epic.number} {epic.title}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                epic:{epic.slug} · {epic.features.length} features
              </Typography>
            </Box>
            <Tooltip title="Add feature">
              <Chip
                icon={<Add fontSize="small" />}
                label="Add"
                size="small"
                onClick={() => onAddFeature(epic.slug)}
                sx={{ cursor: "pointer", borderColor: "divider", color: "text.secondary" }}
              />
            </Tooltip>
          </Stack>
          {epic.features.map((feature) => (
            <FeatureBlock
              key={feature.number}
              feature={feature}
              onAddTask={() => onAddTask(epic.slug, feature.slug)}
            />
          ))}
        </Box>
      ))}
      {!epics.length && (
        <Typography color="text.secondary" sx={{ py: 4 }}>
          No epics found in this repository. Create one to start the tree.
        </Typography>
      )}
    </Paper>
  );
}
