import React, { useState, useMemo } from "react";
import { Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { SmartToy } from "@mui/icons-material";
import { type WorkItem, type Epic, type Feature } from "../../src/shared/workItems";
import { MetricsBar } from "./MetricsBar";
import { WorkItemHierarchy } from "./WorkItemHierarchy";
import { BugsPanel } from "./BugsPanel";
import { WorkItemDetail } from "./WorkItemDetail";
import { AgentsPopup } from "./AgentsPopup";
import { FilterDialog } from "./FilterDialog";

interface RepositoryDetails {
  name: string;
  description: string | null;
  private: boolean;
}

interface ApiData {
  repository: { owner: string; repo: string };
  totals: { issues: number; epics: number; bugs: number };
  hierarchy: {
    epics: Epic[];
    bugs: WorkItem[];
    orphanFeatures: WorkItem[];
    orphanTasks: WorkItem[];
    unclassified: WorkItem[];
  };
}

interface RepositoryContentProps {
  owner: string;
  selectedRepo: string;
  selectedDetails: RepositoryDetails | undefined;
  state: string;
  data: ApiData | null;
  loadingIssues: boolean;
  error: string;
  onStateChange: (value: string) => void;
  onAddEpic: () => void;
  onAddFeature: (epicSlug: string) => void;
  onAddTask: (epicSlug: string, featureSlug: string) => void;
  workItemId?: number;
  workItem?: WorkItem | null;
  loadingWorkItem?: boolean;
  onViewItem?: (issueNumber: number) => void;
  onBackFromDetail?: () => void;
  onSaveWorkItem?: (issueNumber: number, body: string) => Promise<void>;
  onImplement?: (issueNumber: number) => void;
  implementingIssue?: number | null;
  onScope?: (issueNumber: number) => void;
  scopingIssue?: number | null;
}

// Define types for the filter state
interface FilterState {
  githubState: "open" | "closed" | "all";
  statusLabels: string[];
  actionable: string[];
}

// Helper function to check if a work item matches the filters
function matchesFilters(item: WorkItem | Epic | Feature, filters: FilterState): boolean {
  // Check GitHub state
  if (filters.githubState !== "all") {
    if (filters.githubState === "open" && item.state !== "open") return false;
    if (filters.githubState === "closed" && item.state !== "closed") return false;
  }

  // Check custom status labels (from labels with "status:" namespace)
  if (filters.statusLabels.length > 0) {
    const itemStatus = item.labels.status;
    const hasMatchingStatus = filters.statusLabels.some((status) =>
      itemStatus === status.toLowerCase()
    );
    if (!hasMatchingStatus) return false;
  }

  // Check actionable labels
  if (filters.actionable.length > 0) {
    // If "None" is selected, filter for items without any actionable label
    if (filters.actionable.includes("none")) {
      const hasActionableLabel = item.labels.actionable !== undefined;
      if (hasActionableLabel) return false;
    } else {
      // Check for specific actionable labels
      const hasMatchingActionable = filters.actionable.some((actionable) => {
        // Handle special case for "in-progress" (matches both actionable:in-progress and agent:in-progress)
        if (actionable === "in-progress") {
          return (
            item.labels.actionable === "in-progress" ||
            item.labels.actionable === "agent:in-progress"
          );
        }
        return item.labels.actionable === actionable;
      });
      if (!hasMatchingActionable) return false;
    }
  }

  return true;
}

// Helper function to filter a feature's tasks
function filterFeatureTasks(feature: Feature, filters: FilterState): Feature {
  return {
    ...feature,
    tasks: feature.tasks.filter((task) => matchesFilters(task, filters)),
  };
}

// Helper function to filter an epic's features and their tasks
function filterEpicFeatures(epic: Epic, filters: FilterState): Epic {
  return {
    ...epic,
    features: epic.features
      .map((feature) => filterFeatureTasks(feature, filters))
      .filter((feature) => {
        // Keep feature if it matches filters or has tasks that match
        const featureMatches = matchesFilters(feature, filters);
        const hasMatchingTasks = feature.tasks.length > 0;
        return featureMatches || hasMatchingTasks;
      }),
  };
}

export function RepositoryContent({
  owner,
  selectedRepo,
  selectedDetails,
  state,
  data,
  loadingIssues,
  error,
  onStateChange,
  onAddEpic,
  onAddFeature,
  onAddTask,
  workItemId,
  workItem,
  loadingWorkItem,
  onViewItem,
  onBackFromDetail,
  onSaveWorkItem,
  onImplement,
  implementingIssue,
  onScope,
  scopingIssue,
}: RepositoryContentProps): React.JSX.Element {
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    githubState: state as "open" | "closed" | "all",
    statusLabels: [],
    actionable: [],
  });

  // Handle filter changes from FilterDialog
  const handleApplyFilters = (newFilters: FilterState) => {
    setFilters(newFilters);
    // Map githubState to the existing state prop for backward compatibility
    onStateChange(newFilters.githubState);
  };

  // Filter the epics, features, and tasks based on the current filters
  const filteredData = useMemo(() => {
    if (!data) return null;

    return {
      ...data,
      hierarchy: {
        ...data.hierarchy,
        epics: data.hierarchy.epics
          .map((epic) => filterEpicFeatures(epic, filters))
          .filter((epic) => {
            // Keep epic if it matches filters or has features/tasks that match
            const epicMatches = matchesFilters(epic, filters);
            const hasMatchingFeatures = epic.features.length > 0;
            return epicMatches || hasMatchingFeatures;
          }),
      },
    };
  }, [data, filters]);

  // If we're viewing a specific work item detail
  if (workItemId !== undefined && onBackFromDetail) {
    return (
      <>
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ md: "center" }} spacing={2} sx={{ mb: 4 }}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="overline" color="primary.main">WORKSPACE / {owner}</Typography>
              {selectedDetails?.private && (
                <Typography variant="overline" color="text.secondary">
                  · Private
                </Typography>
              )}
            </Stack>
            <Typography variant="h4">{selectedRepo}</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {selectedDetails?.description || "GitHub work items"}
            </Typography>
          </Box>
          <FilterDialog owner={owner} repo={selectedRepo} onApplyFilters={handleApplyFilters} />
        </Stack>
        {loadingWorkItem ? (
          <Box sx={{ py: 10, textAlign: "center" }}>
            <CircularProgress color="primary" />
          </Box>
        ) : workItem ? (
          <WorkItemDetail
            workItem={workItem}
            owner={owner}
            repo={selectedRepo}
            onBack={onBackFromDetail}
            onSave={onSaveWorkItem}
            allEpics={data?.hierarchy.epics.map(e => ({ slug: e.slug, title: e.title, body: e.body })) || []}
            allFeatures={data?.hierarchy.epics.flatMap(e => e.features.map(f => ({ 
              slug: f.slug, 
              title: f.title, 
              body: f.body, 
              epicSlug: e.slug 
            }))) || []}
          />
        ) : (
          <Typography color="text.secondary" sx={{ py: 4 }}>
            Work item not found
          </Typography>
        )}
      </>
    );
  }

  // Normal hierarchy view
  return (
    <>
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ md: "center" }} spacing={2} sx={{ mb: 4 }}>
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="overline" color="primary.main">WORKSPACE / {owner}</Typography>
            {selectedDetails?.private && (
              <Typography variant="overline" color="text.secondary">
                · Private
              </Typography>
            )}
          </Stack>
          <Typography variant="h4">{selectedRepo}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {selectedDetails?.description || "GitHub work items"}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <FilterDialog owner={owner} repo={selectedRepo} onApplyFilters={handleApplyFilters} />
          <Button
            variant="outlined"
            startIcon={<SmartToy />}
            onClick={() => setAgentsOpen(true)}
          >
            Agents
          </Button>
        </Stack>
      </Stack>
      <AgentsPopup open={agentsOpen} owner={owner} repo={selectedRepo} onClose={() => setAgentsOpen(false)} />
      {error && <Typography color="error" sx={{ mb: 3 }}>{error}</Typography>}
      {loadingIssues ? (
        <Box sx={{ py: 10, textAlign: "center" }}>
          <CircularProgress color="primary" />
        </Box>
      ) : filteredData ? (
        <>
          <MetricsBar issues={filteredData.totals.issues} epics={filteredData.totals.epics} bugs={filteredData.totals.bugs} />
          <Stack direction={{ xs: "column", lg: "row" }} spacing={3} alignItems="flex-start">
            <WorkItemHierarchy
              epics={filteredData.hierarchy.epics}
              onAddEpic={onAddEpic}
              onAddFeature={onAddFeature}
              onAddTask={onAddTask}
              onViewItem={onViewItem}
              onImplement={onImplement}
              implementingIssue={implementingIssue}
              onScope={onScope}
              scopingIssue={scopingIssue}
              repo={selectedRepo}
            />
            <BugsPanel bugs={filteredData.hierarchy.bugs} onViewItem={onViewItem} />
          </Stack>
        </>
      ) : null}
    </>
  );
}