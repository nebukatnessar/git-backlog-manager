import React from "react";
import { Stack, Typography } from "@mui/material";
import { type WorkItem } from "../../src/shared/workItems";

interface IssueLinkProps {
  issue: WorkItem;
  onClick?: () => void;
}

export function IssueLink({ issue, onClick }: IssueLinkProps): React.JSX.Element {
  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.7, flexWrap: "wrap" }}>
      <Typography
        component={onClick ? "button" : "a"}
        href={onClick ? undefined : issue.html_url}
        onClick={handleClick}
        target={onClick ? undefined : "_blank"}
        rel={onClick ? undefined : "noreferrer"}
        sx={{
          color: "text.primary",
          textDecoration: "none",
          "&:hover": { color: "primary.main", cursor: "pointer" },
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          font: "inherit",
          textAlign: "left",
        }}
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
