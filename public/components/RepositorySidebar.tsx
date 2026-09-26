import React, { useMemo } from "react";
import {
  Avatar, Box, Chip, Divider, Drawer, IconButton, InputAdornment, LinearProgress,
  List, ListItemButton, ListItemText, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import { FolderOpen, GitHub, Inbox, Lock, Refresh, Search } from "@mui/icons-material";

interface Repository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  stargazers_count: number;
  open_issues_count: number;
  updated_at: string;
}

interface RepositorySidebarProps {
  owner: string;
  repositories: Repository[];
  repositorySearch: string;
  selectedRepo: string;
  loadingRepos: boolean;
  onRepositorySearchChange: (value: string) => void;
  onSelectRepository: (repo: string) => void;
  onRefreshRepositories: () => void;
}

export function RepositorySidebar({
  owner,
  repositories,
  repositorySearch,
  selectedRepo,
  loadingRepos,
  onRepositorySearchChange,
  onSelectRepository,
  onRefreshRepositories,
}: RepositorySidebarProps): React.JSX.Element {
  const filteredRepos = useMemo(
    () => repositories.filter((repo) => repo.name.toLowerCase().includes(repositorySearch.toLowerCase())),
    [repositories, repositorySearch]
  );

  return (
    <Drawer variant="permanent" sx={{ width: 280, flexShrink: 0, "& .MuiDrawer-paper": { width: 280, boxSizing: "border-box", borderRight: "1px solid", borderColor: "divider", bgcolor: "#10161d" } }}>
      <Box sx={{ px: 2.5, py: 2.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Avatar sx={{ bgcolor: "primary.main", color: "#10241e", width: 34, height: 34 }}>
            <GitHub fontSize="small" />
          </Avatar>
          <Box>
            <Typography fontWeight={700}>Backlog Manager</Typography>
            <Typography variant="caption" color="text.secondary">{owner || "GitHub workspace"}</Typography>
          </Box>
        </Stack>
      </Box>
      <Divider />
      <Box sx={{ p: 1.5 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Find a repository"
          value={repositorySearch}
          onChange={(event) => onRepositorySearchChange(event.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2.5, py: 1 }}>
        <Typography variant="overline" color="text.secondary">
          Repositories <Chip label={repositories.length} size="small" sx={{ ml: 0.5, height: 20 }} />
        </Typography>
        <Tooltip title="Refresh repositories">
          <IconButton size="small" onClick={() => void onRefreshRepositories()} disabled={loadingRepos}>
            <Refresh fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      {loadingRepos ? (
        <LinearProgress sx={{ mx: 2 }} />
      ) : (
        <List sx={{ pt: 0 }}>
          {filteredRepos.map((repo) => (
            <ListItemButton
              key={repo.id}
              selected={selectedRepo === repo.name}
              onClick={() => void onSelectRepository(repo.name)}
            >
              <Avatar
                sx={{
                  width: 28,
                  height: 28,
                  mr: 1.5,
                  bgcolor: selectedRepo === repo.name ? "primary.main" : "#25313a",
                  color: selectedRepo === repo.name ? "#10241e" : "text.secondary",
                }}
              >
                <FolderOpen sx={{ fontSize: 16 }} />
              </Avatar>
              <ListItemText
                primary={repo.name}
                secondary={`${repo.open_issues_count} open issues`}
                primaryTypographyProps={{ noWrap: true, fontSize: 14, fontWeight: selectedRepo === repo.name ? 700 : 500 }}
                secondaryTypographyProps={{ noWrap: true, fontSize: 11 }}
              />
              {repo.private && <Lock sx={{ fontSize: 14, color: "text.secondary" }} />}
            </ListItemButton>
          ))}
        </List>
      )}
      {!loadingRepos && !filteredRepos.length && (
        <Box sx={{ px: 2.5, py: 3, textAlign: "center" }}>
          <Inbox sx={{ color: "text.secondary" }} />
          <Typography variant="body2" color="text.secondary">No repositories found</Typography>
        </Box>
      )}
    </Drawer>
  );
}
