import React, { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Typography,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Divider,
  Checkbox,
  Box,
} from "@mui/material";
import { FilterList } from "@mui/icons-material";

// Define types for the filter state
interface FilterState {
  githubState: "open" | "closed" | "all";
  statusLabels: string[]; // Custom status labels (e.g., "To Do", "In Progress")
  actionable: string[]; // Actionable labels (e.g., "ready", "in-progress")
}

interface FilterDialogProps {
  owner: string;
  repo: string;
  onApplyFilters: (filters: FilterState) => void;
}

// Default filter state
const defaultFilterState: FilterState = {
  githubState: "all",
  statusLabels: [],
  actionable: [],
};

// List of custom status labels to display in the dialog
const customStatusOptions = [
  "To Do",
  "In Progress",
  "Done",
  "Blocked",
  "Backlog",
];

// List of actionable labels to display in the dialog
const actionableOptions = [
  { value: "ready", label: "Ready" },
  { value: "in-progress", label: "In Progress" },
  { value: "implemented", label: "Implemented" },
  { value: "rejected", label: "Rejected" },
  { value: "none", label: "None" },
];

// Generate a unique key for localStorage per repository
function getStorageKey(owner: string, repo: string): string {
  return `filterDialogState_${owner}_${repo}`;
}

// Load saved filter state from localStorage
function loadSavedFilters(owner: string, repo: string): FilterState | null {
  const key = getStorageKey(owner, repo);
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      return JSON.parse(saved) as FilterState;
    } catch {
      return null;
    }
  }
  return null;
}

// Save filter state to localStorage
function saveFilters(owner: string, repo: string, filters: FilterState): void {
  const key = getStorageKey(owner, repo);
  localStorage.setItem(key, JSON.stringify(filters));
}

export function FilterDialog({
  owner,
  repo,
  onApplyFilters,
}: FilterDialogProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(defaultFilterState);

  // Load saved filters when the component mounts or when the repo changes
  useEffect(() => {
    const savedFilters = loadSavedFilters(owner, repo);
    if (savedFilters) {
      setFilters(savedFilters);
      onApplyFilters(savedFilters);
    } else {
      // Apply default filters (e.g., show all issues)
      onApplyFilters(defaultFilterState);
    }
  }, [owner, repo, onApplyFilters]);

  // Handle changes to GitHub state filter
  const handleGitHubStateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newState = event.target.value as "open" | "closed" | "all";
    const newFilters = { ...filters, githubState: newState };
    setFilters(newFilters);
    saveFilters(owner, repo, newFilters);
    onApplyFilters(newFilters);
  };

  // Handle changes to custom status labels filter
  const handleStatusLabelChange = (label: string) => {
    const newStatusLabels = filters.statusLabels.includes(label)
      ? filters.statusLabels.filter((l) => l !== label)
      : [...filters.statusLabels, label];
    const newFilters = { ...filters, statusLabels: newStatusLabels };
    setFilters(newFilters);
    saveFilters(owner, repo, newFilters);
    onApplyFilters(newFilters);
  };

  // Handle changes to actionable filter
  const handleActionableChange = (value: string) => {
    const newActionable = filters.actionable.includes(value)
      ? filters.actionable.filter((a) => a !== value)
      : [...filters.actionable, value];
    const newFilters = { ...filters, actionable: newActionable };
    setFilters(newFilters);
    saveFilters(owner, repo, newFilters);
    onApplyFilters(newFilters);
  };

  // Reset filters to default
  const handleReset = () => {
    const newFilters = defaultFilterState;
    setFilters(newFilters);
    saveFilters(owner, repo, newFilters);
    onApplyFilters(newFilters);
  };

  // Apply filters and close the dialog
  const handleClose = () => {
    setOpen(false);
  };

  // Open the dialog
  const handleOpen = () => {
    setOpen(true);
  };

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<FilterList />}
        onClick={handleOpen}
        sx={{ textTransform: "none" }}
      >
        Filter
      </Button>
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>Filter Work Items</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {/* GitHub State Section */}
            <FormControl>
              <FormLabel>GitHub State</FormLabel>
              <RadioGroup
                row
                value={filters.githubState}
                onChange={handleGitHubStateChange}
              >
                <FormControlLabel
                  value="all"
                  control={<Radio />}
                  label="All"
                />
                <FormControlLabel
                  value="open"
                  control={<Radio />}
                  label="Open"
                />
                <FormControlLabel
                  value="closed"
                  control={<Radio />}
                  label="Closed"
                />
              </RadioGroup>
            </FormControl>

            <Divider />

            {/* Custom Status Labels Section */}
            <FormControl>
              <FormLabel>Custom Status Labels</FormLabel>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1 }}>
                {customStatusOptions.map((label) => (
                  <FormControlLabel
                    key={label}
                    control={
                      <Checkbox
                        checked={filters.statusLabels.includes(label)}
                        onChange={() => handleStatusLabelChange(label)}
                      />
                    }
                    label={label}
                  />
                ))}
              </Box>
            </FormControl>

            <Divider />

            {/* Actionable Section */}
            <FormControl>
              <FormLabel>Actionable</FormLabel>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1 }}>
                {actionableOptions.map((option) => (
                  <FormControlLabel
                    key={option.value}
                    control={
                      <Checkbox
                        checked={filters.actionable.includes(option.value)}
                        onChange={() => handleActionableChange(option.value)}
                      />
                    }
                    label={option.label}
                  />
                ))}
              </Box>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleReset} color="secondary">
            Reset
          </Button>
          <Button onClick={handleClose} variant="contained" color="primary">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
