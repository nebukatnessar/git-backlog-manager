import React from "react";
import { Stack, Typography } from "@mui/material";
import { type WorkItem } from "../../src/shared/workItems";

interface IssueLinkProps {
  issue: WorkItem;
}

export function IssueLink({ issue }: IssueLinkProps): React.JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.7, flexWrap: "wrap" }}>
      <Typography
        component="a"
        href={issue.html_url}
        target="_blank"
        rel="noreferrer"
        sx={{ color: "text.primary", textDecoration: "none", "&:hover": { color: "primary.main" } }}
      >
        #{issue.number} {issue.title}
      </Typography>
      {issue.labels.status && (
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
          status: {issue.labels.status}
        </Typography>
      )}
      {issue.labels.priority && (
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
          priority: {issue.labels.priority}
        </Typography>
      )}
    </Stack>
  );
}
