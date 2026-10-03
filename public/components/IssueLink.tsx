import React from "react";
import { Button, Stack, Tooltip, Typography } from "@mui/material";
import { PlayCircle, TravelExplore } from "@mui/icons-material";
import { type WorkItem } from "../../src/shared/workItems";

interface IssueLinkProps {
  issue: WorkItem;
  onClick?: () => void;
  onImplement?: (issueNumber: number) => void;
  implementingIssue?: number | null;
  onScope?: (issueNumber: number) => void;
  scopingIssue?: number | null;
}

// Helper function to check if a work item type is agentable (task or bug)
function isAgentable(type: string | undefined): boolean {
  return type === "task" || type === "bug";
}

export function IssueLink({ issue, onClick, onImplement, implementingIssue, onScope, scopingIssue }: IssueLinkProps): React.JSX.Element {
  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ py: 0.7, flexWrap: "wrap" }}>
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
      {onImplement && isAgentable(issue.labels.type) && issue.labels.actionable === "ready" && (
        <Tooltip title={implementingIssue === issue.number ? "Agent run in progress" : "Run the implement agent on this task or bug"}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<PlayCircle fontSize="small" />}
            disabled={implementingIssue === issue.number}
            onClick={(event) => {
              event.stopPropagation();
              onImplement(issue.number);
            }}
            sx={{ ml: "auto", minHeight: 24, fontSize: "0.75rem" }}
          >
            {implementingIssue === issue.number ? "Running…" : "Implement"}
          </Button>
        </Tooltip>
      )}
      {onScope && isAgentable(issue.labels.type) && issue.labels.actionable && issue.labels.actionable !== "ready" && issue.labels.actionable !== "implemented" && (
        <Tooltip title={scopingIssue === issue.number ? "Scoping agent in progress" : "Let the scoping agent decide if this task or bug is actionable"}>
          <Button
            size="small"
            variant="outlined"
            color="secondary"
            startIcon={<TravelExplore fontSize="small" />}
            disabled={scopingIssue === issue.number}
            onClick={(event) => {
              event.stopPropagation();
              onScope(issue.number);
            }}
            sx={{ ml: "auto", minHeight: 24, fontSize: "0.75rem" }}
          >
            {scopingIssue === issue.number ? "Scoping…" : "Scope"}
          </Button>
        </Tooltip>
      )}
    </Stack>
  );
}
