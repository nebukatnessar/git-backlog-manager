import React, { useState, useEffect } from "react";
import { Avatar, Box, Button, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { Add, ChevronRight, ExpandMore, ExpandLess, FolderOpen } from "@mui/icons-material";
import { type Epic, type Feature } from "../../src/shared/workItems";
import { IssueLink } from "./IssueLink";
import { useStackRankDragOrder, type StackRankDragOrder } from "./stackRankDragOrder";

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
  onStackRankChange?: (issueNumber: number, stackRank: number) => Promise<void>;
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
  onStackRankChange?: (issueNumber: number, stackRank: number) => Promise<void>;
  featureIndex: number;
  featureDragOrder: StackRankDragOrder;
}

function FeatureBlock({ feature, onAddTask, onViewItem, isExpanded, onToggle, indentLevel, onImplement, implementingIssue, onScope, scopingIssue, onStackRankChange, featureIndex, featureDragOrder }: FeatureBlockProps): React.JSX.Element {
  const taskDragOrder = useStackRankDragOrder(feature.tasks, onStackRankChange);

  return (
    <Box
      sx={{
        ml: indentLevel,
        pl: 2,
        borderLeft: "1px solid",
        borderColor: "divider",
        py: 1,
        ...(featureDragOrder.canReorder ? {
          cursor: "grab",
          ...(featureDragOrder.draggedNumber === feature.number ? { opacity: 0.5 } : {}),
          ...(featureDragOrder.dropIndex === featureIndex ? { borderTop: "2px solid", borderTopColor: "primary.main" } : {}),
          ...(featureDragOrder.dropIndex === featureDragOrder.length && featureIndex === featureDragOrder.length - 1
            ? { borderBottom: "2px solid", borderBottomColor: "primary.main" }
            : {}),
        } : {}),
      }}
      draggable={featureDragOrder.canReorder}
      onDragStart={featureDragOrder.canReorder ? (event) => featureDragOrder.handleDragStart(event, featureIndex) : undefined}
      onDragOver={featureDragOrder.canReorder ? (event) => featureDragOrder.handleDragOver(event, featureIndex) : undefined}
      onDrop={featureDragOrder.canReorder ? (event) => featureDragOrder.handleDrop(event) : undefined}
      onDragEnd={featureDragOrder.canReorder ? featureDragOrder.handleDragEnd : undefined}
    >
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
          <Button
            size="small"
            variant="outlined"
            startIcon={<Add fontSize="small" />}
            onClick={onAddTask}
            sx={{ minHeight: 24, fontSize: "0.75rem" }}
          >
            Add
          </Button>
        </Tooltip>
      </Stack>
      {isExpanded && (
        <Box sx={{ mt: 0.5, ml: 4.25 }}>
          {feature.tasks.map((task, index) => (
            <Box
              key={task.number}
              draggable={taskDragOrder.canReorder}
              onDragStart={taskDragOrder.canReorder ? (event) => taskDragOrder.handleDragStart(event, index) : undefined}
              onDragOver={taskDragOrder.canReorder ? (event) => taskDragOrder.handleDragOver(event, index) : undefined}
              onDrop={taskDragOrder.canReorder ? (event) => taskDragOrder.handleDrop(event) : undefined}
              onDragEnd={taskDragOrder.canReorder ? taskDragOrder.handleDragEnd : undefined}
              sx={{
                ...(taskDragOrder.canReorder ? { cursor: "grab" } : {}),
                ...(taskDragOrder.draggedNumber === task.number ? { opacity: 0.5 } : {}),
                ...(taskDragOrder.dropIndex === index ? { borderTop: "2px solid", borderTopColor: "primary.main" } : {}),
                ...(taskDragOrder.dropIndex === taskDragOrder.length && index === taskDragOrder.length - 1
                  ? { borderBottom: "2px solid", borderBottomColor: "primary.main" }
                  : {}),
              }}
            >
              <IssueLink
                issue={task}
                onClick={onViewItem ? () => onViewItem(task.number) : undefined}
                onImplement={onImplement}
                implementingIssue={implementingIssue}
                onScope={onScope}
                scopingIssue={scopingIssue}
              />
            </Box>
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
  onStackRankChange?: (issueNumber: number, stackRank: number) => Promise<void>;
  expandedFeatures: Record<string, boolean>;
  onFeatureToggle: (featureSlug: string) => void;
  epicIndex: number;
  epicDragOrder: StackRankDragOrder;
}

function EpicBlock({ epic, onAddFeature, onAddTask, onViewItem, isExpanded, onToggle, onImplement, implementingIssue, onScope, scopingIssue, expandedFeatures, onFeatureToggle, onStackRankChange, epicIndex, epicDragOrder }: EpicBlockProps): React.JSX.Element {
  const featureDragOrder = useStackRankDragOrder(epic.features, onStackRankChange);

  return (
    <Box
      key={epic.number}
      sx={{
        py: 1.5,
        borderTop: "1px solid",
        borderColor: "divider",
        ...(epicDragOrder.canReorder ? {
          cursor: "grab",
          ...(epicDragOrder.draggedNumber === epic.number ? { opacity: 0.5 } : {}),
          ...(epicDragOrder.dropIndex === epicIndex ? { borderTop: "2px solid", borderTopColor: "primary.main" } : {}),
          ...(epicDragOrder.dropIndex === epicDragOrder.length && epicIndex === epicDragOrder.length - 1
            ? { borderBottom: "2px solid", borderBottomColor: "primary.main" }
            : {}),
        } : {}),
      }}
      draggable={epicDragOrder.canReorder}
      onDragStart={epicDragOrder.canReorder ? (event) => epicDragOrder.handleDragStart(event, epicIndex) : undefined}
      onDragOver={epicDragOrder.canReorder ? (event) => epicDragOrder.handleDragOver(event, epicIndex) : undefined}
      onDrop={epicDragOrder.canReorder ? (event) => epicDragOrder.handleDrop(event) : undefined}
      onDragEnd={epicDragOrder.canReorder ? epicDragOrder.handleDragEnd : undefined}
    >
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
          <Button
            size="small"
            variant="outlined"
            startIcon={<Add fontSize="small" />}
            onClick={() => onAddFeature(epic.slug)}
            sx={{ minHeight: 24, fontSize: "0.75rem" }}
          >
            Add
          </Button>
        </Tooltip>
      </Stack>
      {isExpanded && (
        <>
          {epic.features.map((feature, index) => (
            <FeatureBlock
              key={feature.number}
              feature={feature}
              onAddTask={() => onAddTask(epic.slug, feature.slug)}
              onViewItem={onViewItem}
              isExpanded={expandedFeatures[`${epic.slug}/${feature.slug}`] === true}
              onToggle={() => onFeatureToggle(feature.slug)}
              indentLevel={2.5}
              onImplement={onImplement}
              implementingIssue={implementingIssue}
              onScope={onScope}
              scopingIssue={scopingIssue}
              onStackRankChange={onStackRankChange}
              featureIndex={index}
              featureDragOrder={featureDragOrder}
            />
          ))}
        </>
      )}
    </Box>
  );
}

interface CollapseAllButtonProps {
  isAllCollapsed: boolean;
  onToggle: () => void;
}

function CollapseAllButton({ isAllCollapsed, onToggle }: CollapseAllButtonProps): React.JSX.Element {
  return (
    <Tooltip title={isAllCollapsed ? "Expand All" : "Collapse All"}>
      <Button
        startIcon={isAllCollapsed ? <ExpandMore /> : <ExpandLess />}
        variant="outlined"
        size="small"
        onClick={onToggle}
        sx={{ textTransform: "none" }}
      >
        {isAllCollapsed ? "Expand All" : "Collapse All"}
      </Button>
    </Tooltip>
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
  onStackRankChange,
  repo,
}: WorkItemHierarchyProps): React.JSX.Element {
  const [expandedEpics, setExpandedEpics] = useState<Record<string, boolean>>({});
  const [expandedFeatures, setExpandedFeatures] = useState<Record<string, boolean>>({});
  const epicDragOrder = useStackRankDragOrder(epics, onStackRankChange);

  // Initialize all epics and features as expanded
  useEffect(() => {
    if (epics.length > 0) {
      const initialExpandedEpics: Record<string, boolean> = {};
      const initialExpandedFeatures: Record<string, boolean> = {};
      epics.forEach((epic) => {
        initialExpandedEpics[epic.slug] = true;
        epic.features.forEach((feature) => {
          initialExpandedFeatures[`${epic.slug}/${feature.slug}`] = true;
        });
      });
      setExpandedEpics(initialExpandedEpics);
      setExpandedFeatures(initialExpandedFeatures);
    }
  }, [epics]);

  const toggleEpic = (epicSlug: string) => {
    setExpandedEpics((prev) => ({
      ...prev,
      [epicSlug]: !prev[epicSlug],
    }));
  };

  const toggleFeature = (epicSlug: string, featureSlug: string) => {
    setExpandedFeatures((prev) => ({
      ...prev,
      [`${epicSlug}/${featureSlug}`]: !prev[`${epicSlug}/${featureSlug}`],
    }));
  };

  const toggleAll = () => {
    const allEpicsCollapsed = Object.values(expandedEpics).every((expanded) => !expanded);
    if (allEpicsCollapsed) {
      // Expand all epics and features
      const newExpandedEpics: Record<string, boolean> = {};
      const newExpandedFeatures: Record<string, boolean> = {};
      epics.forEach((epic) => {
        newExpandedEpics[epic.slug] = true;
        epic.features.forEach((feature) => {
          newExpandedFeatures[`${epic.slug}/${feature.slug}`] = true;
        });
      });
      setExpandedEpics(newExpandedEpics);
      setExpandedFeatures(newExpandedFeatures);
    } else {
      // Collapse all epics and features
      setExpandedEpics({});
      setExpandedFeatures({});
    }
  };

  const allCollapsed = Object.values(expandedEpics).every((expanded) => !expanded);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, flex: 1, width: "100%", borderColor: "divider" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6">Work item hierarchy</Typography>
          <Typography variant="body2" color="text.secondary">Epics, features, and tasks</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <CollapseAllButton isAllCollapsed={allCollapsed} onToggle={toggleAll} />
          <Button startIcon={<Add />} variant="outlined" size="small" onClick={onAddEpic}>
            New epic
          </Button>
        </Stack>
      </Stack>
      {epics.map((epic, index) => (
        <EpicBlock
          key={epic.number}
          epic={epic}
          onAddFeature={onAddFeature}
          onAddTask={onAddTask}
          onViewItem={onViewItem}
          isExpanded={expandedEpics[epic.slug] === true}
          onToggle={() => toggleEpic(epic.slug)}
          onImplement={onImplement}
          implementingIssue={implementingIssue}
          onScope={onScope}
          scopingIssue={scopingIssue}
          onStackRankChange={onStackRankChange}
          expandedFeatures={expandedFeatures}
          onFeatureToggle={(featureSlug: string) => toggleFeature(epic.slug, featureSlug)}
          epicIndex={index}
          epicDragOrder={epicDragOrder}
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