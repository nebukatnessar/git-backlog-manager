import React from "react";
import { Avatar, Box, Paper, Stack, Typography } from "@mui/material";
import { TaskAlt, FolderOpen, BugReport } from "@mui/icons-material";

interface MetricsBarProps {
  issues: number;
  epics: number;
  bugs: number;
}

interface MetricProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}

function Metric({ icon, label, value, color }: MetricProps): React.JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 150, borderColor: "divider" }}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Avatar sx={{ width: 36, height: 36, bgcolor: `${color}22`, color }}>{icon}</Avatar>
        <Box>
          <Typography variant="h6">{value}</Typography>
          <Typography variant="caption" color="text.secondary">{label}</Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

export function MetricsBar({ issues, epics, bugs }: MetricsBarProps): React.JSX.Element {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 4 }}>
      <Metric icon={<TaskAlt />} label="Total issues" value={issues} color="#62d9b2" />
      <Metric icon={<FolderOpen />} label="Epics" value={epics} color="#f2b56b" />
      <Metric icon={<BugReport />} label="Bugs" value={bugs} color="#e98282" />
    </Stack>
  );
}

export { Metric };
