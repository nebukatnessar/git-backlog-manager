import React, { useMemo, useState } from "react";
import {
  Box, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import { DragIndicator, TableChart } from "@mui/icons-material";
import { type Epic, type Feature, type Task } from "../../src/shared/workItems";
import { useStackRankDragOrder } from "./stackRankDragOrder";

interface TaskGridProps {
  tasks: Task[];
  epics: Epic[];
  features: Feature[];
  onViewItem?: (issueNumber: number) => void;
  onStackRankChange?: (issueNumber: number, stackRank: number) => Promise<void>;
  repo?: string;
}

export function TaskGrid({ tasks, epics, features, onViewItem, onStackRankChange, repo }: TaskGridProps): React.JSX.Element {
  const [epicSlug, setEpicSlug] = useState("");
  const [featureSlug, setFeatureSlug] = useState("");

  // Features shown in the Feature filter, narrowed to the selected epic
  const visibleFeatures = useMemo(() => {
    if (!epicSlug) return features;
    return features.filter((feature) => feature.labels.epic === epicSlug);
  }, [features, epicSlug]);

  const handleEpicChange = (value: string): void => {
    setEpicSlug(value);
    const featureStillValid = features.some(
      (feature) => feature.slug === featureSlug && (!value || feature.labels.epic === value)
    );
    if (!featureStillValid) setFeatureSlug("");
  };

  // Feature titles keyed by epic/feature path, since slugs are unique per epic
  const featureTitles = useMemo(() => {
    const titles = new Map<string, string>();
    for (const feature of features) {
      titles.set(`${feature.labels.epic || ""}/${feature.slug}`, feature.title);
    }
    return titles;
  }, [features]);

  const visibleTasks = useMemo(() => {
    const filtered = tasks.filter((task) => {
      if (epicSlug && task.labels.epic !== epicSlug) return false;
      if (featureSlug && task.labels.feature !== featureSlug) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      const aRank = a.stackRank ?? Number.MAX_SAFE_INTEGER;
      const bRank = b.stackRank ?? Number.MAX_SAFE_INTEGER;
      return aRank - bRank;
    });
  }, [tasks, epicSlug, featureSlug]);

  // Drag-and-drop reordering
  const { canReorder, draggedNumber, dropIndex, handleDragStart, handleDragOver, handleDrop, handleDragEnd } =
    useStackRankDragOrder(visibleTasks, onStackRankChange);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderColor: "divider", width: "100%" }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <TableChart sx={{ color: "secondary.main" }} />
        <Box>
          <Typography variant="h6">Task Grid</Typography>
          <Typography variant="body2" color="text.secondary">Flat tasks ordered by stack-rank</Typography>
        </Box>
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
        <Stack spacing={0.5} sx={{ minWidth: 220 }}>
          <Typography variant="caption" color="text.secondary">Epic</Typography>
          <TextField
            select
            SelectProps={{ native: true }}
            size="small"
            value={epicSlug}
            onChange={(event) => handleEpicChange(event.target.value)}
          >
            <option value="">All epics</option>
            {epics.map((epic) => (
              <option key={epic.slug} value={epic.slug}>{epic.title}</option>
            ))}
          </TextField>
        </Stack>
        <Stack spacing={0.5} sx={{ minWidth: 220 }}>
          <Typography variant="caption" color="text.secondary">Feature</Typography>
          <TextField
            select
            SelectProps={{ native: true }}
            size="small"
            value={featureSlug}
            onChange={(event) => setFeatureSlug(event.target.value)}
            disabled={visibleFeatures.length === 0}
          >
            <option value="">All features</option>
            {visibleFeatures.map((feature) => (
              <option key={`${feature.labels.epic || ""}/${feature.slug}`} value={feature.slug}>{feature.title}</option>
            ))}
          </TextField>
        </Stack>
      </Stack>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              {canReorder && <TableCell sx={{ width: 40, px: 1 }} />}
              <TableCell>Task Title</TableCell>
              <TableCell>Parent Feature Title</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleTasks.map((task, index) => (
              <TableRow
                key={task.number}
                hover
                draggable={canReorder}
                onDragStart={canReorder ? (event) => handleDragStart(event, index) : undefined}
                onDragOver={canReorder ? (event) => handleDragOver(event, index) : undefined}
                onDrop={canReorder ? (event) => handleDrop(event) : undefined}
                onDragEnd={canReorder ? handleDragEnd : undefined}
                onClick={onViewItem ? () => onViewItem(task.number) : undefined}
                sx={{
                  cursor: onViewItem ? "pointer" : canReorder ? "grab" : "default",
                  ...(draggedNumber === task.number ? { opacity: 0.5 } : {}),
                  ...(dropIndex === index ? { borderTop: "2px solid", borderTopColor: "primary.main" } : {}),
                  ...(dropIndex === visibleTasks.length && index === visibleTasks.length - 1
                    ? { borderBottom: "2px solid", borderBottomColor: "primary.main" }
                    : {}),
                }}
              >
                {canReorder && (
                  <TableCell sx={{ width: 40, px: 1 }}>
                    <DragIndicator fontSize="small" sx={{ color: "text.secondary" }} />
                  </TableCell>
                )}
                <TableCell>
                  <Typography
                    component="button"
                    variant="body2"
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
                    #{task.number} {task.title}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {featureTitles.get(`${task.labels.epic || ""}/${task.labels.feature || ""}`) || task.labels.feature || "—"}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography
                    component="span"
                    sx={{
                      height: 22,
                      border: "1px solid",
                      borderColor: "divider",
                      color: "text.secondary",
                      fontSize: "0.75rem",
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    {task.labels.status || "—"}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {!visibleTasks.length && (
        <Typography color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
          No tasks found{repo ? ` in ${repo}` : ""}.
        </Typography>
      )}
    </Paper>
  );
}
