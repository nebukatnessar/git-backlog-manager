import React from "react";
import { Box, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import { type WorkItem, type Epic, type Feature } from "../../src/shared/workItems";
import { MetricsBar } from "./MetricsBar";
import { WorkItemHierarchy } from "./WorkItemHierarchy";
import { BugsPanel } from "./BugsPanel";
import { WorkItemDetail } from "./WorkItemDetail";

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
}: RepositoryContentProps): React.JSX.Element {
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
          <TextField
            select
            SelectProps={{ native: true }}
            size="small"
            label="Issue state"
            value={state}
            onChange={(event) => onStateChange(event.target.value)}
            sx={{ minWidth: 140 }}
          >
            <option value="all">All issues</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </TextField>
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
        <TextField
          select
          SelectProps={{ native: true }}
          size="small"
          label="Issue state"
          value={state}
          onChange={(event) => onStateChange(event.target.value)}
          sx={{ minWidth: 140 }}
        >
          <option value="all">All issues</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </TextField>
      </Stack>
      {error && <Typography color="error" sx={{ mb: 3 }}>{error}</Typography>}
      {loadingIssues ? (
        <Box sx={{ py: 10, textAlign: "center" }}>
          <CircularProgress color="primary" />
        </Box>
      ) : data ? (
        <>
          <MetricsBar issues={data.totals.issues} epics={data.totals.epics} bugs={data.totals.bugs} />
          <Stack direction={{ xs: "column", lg: "row" }} spacing={3} alignItems="flex-start">
            <WorkItemHierarchy
              epics={data.hierarchy.epics}
              onAddEpic={onAddEpic}
              onAddFeature={onAddFeature}
              onAddTask={onAddTask}
              onViewItem={onViewItem}
              repo={selectedRepo}
            />
            <BugsPanel bugs={data.hierarchy.bugs} onViewItem={onViewItem} />
          </Stack>
        </>
      ) : null}
    </>
  );
}
