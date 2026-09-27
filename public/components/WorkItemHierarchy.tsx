import React, { useState } from "react";
import { Avatar, Box, Button, Chip, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { Add, ChevronRight, ExpandMore, FolderOpen } from "@mui/icons-material";
import { type Epic, type Feature } from "../../src/shared/workItems";
import { IssueLink } from "./IssueLink";

interface WorkItemHierarchyProps {
  epics: Epic[];
  onAddEpic: () => void;
  onAddFeature: (epicSlug: string) => void;
  onAddTask: (epicSlug: string, featureSlug: string) => void;
  onViewItem?: (issueNumber: number) => void;
  onImplement?: (issueNumber: number) => void;
  implementingIssue?: number | null;
  onScope?: (issueNumber: number) => void;
  scopingIssue?: number | null;
  repo?: string;
}

interface FeatureBlockProps {
  feature: Feature;
  onAddTask: () => void;
  onViewItem?: (issueNumber: number) => void;
  isExpanded: boolean;
  onToggle: () => void;
  indentLevel: number;
  onImplement?: (issueNumber: number) => void;
  implementingIssue?: number | null;
  onScope?: (issueNumber: number) => void;
  scopingIssue?: number | null;
}

function FeatureBlock({ feature, onAddTask, onViewItem, isExpanded, onToggle, indentLevel, onImplement, implementingIssue, onScope, scopingIssue }: FeatureBlockProps): React.JSX.Element {
  return (
    <Box sx={{ ml: indentLevel, pl: 2, borderLeft: "1px solid", borderColor: "divider", py: 1 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box
          component="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          sx={{ background: "none", border: "none", cursor: "pointer", p: 0, m: 0 }}
        >
          {isExpanded ? (
            <ExpandMore sx={{ fontSize: 18, color: "secondary.main" }} />
          ) : (
            <ChevronRight sx={{ fontSize: 18, color: "secondary.main" }} />
          )}
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography
            component="button"
            onClick={(e) => { if (onViewItem) { e.preventDefault(); onViewItem(feature.number); } }}
            variant="body1"
            fontWeight={600}
            sx={{
              color: "text.primary",
              textDecoration: "none",
              "&:hover": { color: "primary.main", cursor: onViewItem ? "pointer" : "default" },
              background: "none",
              border: "none",
              padding: 0,
              margin: 0,
              font: "inherit",
              textAlign: "left",
            }}
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
      {isExpanded && (
        <Box sx={{ mt: 0.5, ml: 4.25 }}>
          {feature.tasks.map((task) => (
            <IssueLink
              key={task.number}
              issue={task}
              onClick={onViewItem ? () => onViewItem(task.number) : undefined}
              onImplement={onImplement}
              implementingIssue={implementingIssue}
              onScope={onScope}
              scopingIssue={scopingIssue}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

interface EpicBlockProps {
  epic: Epic;
  onAddFeature: (epicSlug: string) => void;
  onAddTask: (epicSlug: string, featureSlug: string) => void;
  onViewItem?: (issueNumber: number) => void;
  isExpanded: boolean;
  onToggle: () => void;
  onImplement?: (issueNumber: number) => void;
  implementingIssue?: number | null;
  onScope?: (issueNumber: number) => void;
  scopingIssue?: number | null;
}

function EpicBlock({ epic, onAddFeature, onAddTask, onViewItem, isExpanded, onToggle, onImplement, implementingIssue, onScope, scopingIssue }: EpicBlockProps): React.JSX.Element {
  const [expandedFeatures, setExpandedFeatures] = useState<Record<string, boolean>>({});

  const toggleFeature = (featureSlug: string) => {
    setExpandedFeatures((prev) => ({
      ...prev,
      [featureSlug]: !prev[featureSlug],
    }));
  };

  return (
    <Box key={epic.number} sx={{ py: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box
          component="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          sx={{ background: "none", border: "none", cursor: "pointer", p: 0, m: 0 }}
        >
          {isExpanded ? (
            <ExpandMore sx={{ fontSize: 18, color: "secondary.main" }} />
          ) : (
            <ChevronRight sx={{ fontSize: 18, color: "secondary.main" }} />
          )}
        </Box>
        <Avatar sx={{ width: 34, height: 34, bgcolor: "#3c3020", color: "secondary.main" }}>
          <FolderOpen fontSize="small" />
        </Avatar>
        <Box sx={{ flex: 1 }}>
          <Typography
            component="button"
            onClick={(e) => { if (onViewItem) { e.preventDefault(); onViewItem(epic.number); } }}
            fontWeight={700}
            sx={{
              color: "text.primary",
              textDecoration: "none",
              "&:hover": { color: "primary.main", cursor: onViewItem ? "pointer" : "default" },
              background: "none",
              border: "none",
              padding: 0,
              margin: 0,
              font: "inherit",
              textAlign: "left",
            }}
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
      {isExpanded && (
        <>
          {epic.features.map((feature) => (
            <FeatureBlock
              key={feature.number}
              feature={feature}
              onAddTask={() => onAddTask(epic.slug, feature.slug)}
              onViewItem={onViewItem}
              isExpanded={expandedFeatures[feature.slug] !== false}
              onToggle={() => toggleFeature(feature.slug)}
              indentLevel={2.5}
              onImplement={onImplement}
              implementingIssue={implementingIssue}
              onScope={onScope}
              scopingIssue={scopingIssue}
            />
          ))}
        </>
      )}
    </Box>
  );
}

export function WorkItemHierarchy({
  epics,
  onAddEpic,
  onAddFeature,
  onAddTask,
  onViewItem,
  onImplement,
  implementingIssue,
  onScope,
  scopingIssue,
  repo,
}: WorkItemHierarchyProps): React.JSX.Element {
  const [expandedEpics, setExpandedEpics] = useState<Record<string, boolean>>({});

  const toggleEpic = (epicSlug: string) => {
    setExpandedEpics((prev) => ({
      ...prev,
      [epicSlug]: !prev[epicSlug],
    }));
  };

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
        <EpicBlock
          key={epic.number}
          epic={epic}
          onAddFeature={onAddFeature}
          onAddTask={onAddTask}
          onViewItem={onViewItem}
          isExpanded={expandedEpics[epic.slug] !== false}
          onToggle={() => toggleEpic(epic.slug)}
          onImplement={onImplement}
          implementingIssue={implementingIssue}
          onScope={onScope}
          scopingIssue={scopingIssue}
        />
      ))}
      {!epics.length && (
        <Typography color="text.secondary" sx={{ py: 4 }}>
          No epics found in this repository. Create one to start the tree.
        </Typography>
      )}
    </Paper>
  );
}
