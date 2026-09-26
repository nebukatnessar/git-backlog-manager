import React from "react";
import { Box, Paper, Stack, Typography } from "@mui/material";
import { BugReport } from "@mui/icons-material";
import { type WorkItem } from "../../src/shared/workItems";
import { IssueLink } from "./IssueLink";

interface BugsPanelProps {
  bugs: WorkItem[];
  onViewItem?: (issueNumber: number) => void;
}

export function BugsPanel({ bugs, onViewItem }: BugsPanelProps): React.JSX.Element {
  return (
    <Paper
      variant="outlined"
      sx={{ p: { xs: 2, md: 3 }, width: { lg: 360 }, flexShrink: 0, borderColor: "divider" }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <BugReport sx={{ color: "error.main" }} />
        <Box>
          <Typography variant="h6">Bugs</Typography>
          <Typography variant="body2" color="text.secondary">Flat work items</Typography>
        </Box>
      </Stack>
      {bugs.map((bug) => (
        <IssueLink key={bug.number} issue={bug} onClick={onViewItem ? () => onViewItem(bug.number) : undefined} />
      ))}
      {!bugs.length && (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          No bugs found.
        </Typography>
      )}
    </Paper>
  );
}
