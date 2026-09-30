import React, { createContext, useContext, useReducer, useMemo, ReactNode } from "react";
import {
  type WorkItem,
  type ParsedLabels,
  parseNamespacedLabels,
  getStackRankFromLabels,
  buildWorkItemHierarchy,
  type ApiData,
  type GitHubIssue,
  mapIssue,
} from "../../src/shared/workItems";

// Define the shape of the store state
interface WorkItemStoreState {
  issues: Record<number, WorkItem>; // Keyed by issue number
  hierarchy: ApiData["hierarchy"] | null;
}

// Define actions for the reducer
type WorkItemAction =
  | { type: "SEED"; payload: GitHubIssue[] }
  | { type: "APPLY_LABEL_CHANGE"; payload: { issueNumber: number; namespace: string; value: string } }
  | { type: "APPLY_BODY_CHANGE"; payload: { issueNumber: number; body: string } }
  | { type: "ROLLBACK"; payload: { issueNumber: number; previousLabels: ParsedLabels } };

// Helper to recompute derived fields for a work item
function recomputeWorkItem(issue: GitHubIssue): WorkItem {
  return mapIssue(issue);
}

// Reducer to handle state transitions
function workItemReducer(state: WorkItemStoreState, action: WorkItemAction): WorkItemStoreState {
  switch (action.type) {
    case "SEED": {
      const issuesRecord: Record<number, WorkItem> = {};
      action.payload.forEach((issue) => {
        issuesRecord[issue.number] = recomputeWorkItem(issue);
      });
      const hierarchy = buildWorkItemHierarchy(action.payload);
      return {
        ...state,
        issues: issuesRecord,
        hierarchy,
      };
    }

    case "APPLY_LABEL_CHANGE": {
      const { issueNumber, namespace, value } = action.payload;
      const issue = state.issues[issueNumber];
      if (!issue) return state;

      // Create a new labels object with the updated namespace
      const updatedLabels: ParsedLabels = {
        ...issue.labels,
        [namespace]: value,
      };

      // Recompute the work item with updated labels
      const updatedGitHubIssue: GitHubIssue = {
        ...issue,
        number: issue.number,
        title: issue.title,
        html_url: issue.html_url,
        state: issue.state,
        labels: Object.entries(updatedLabels).map(([ns, val]) => `${ns}:${val}`),
        body: issue.body,
      };

      const recomputedIssue = recomputeWorkItem(updatedGitHubIssue);

      // Update the hierarchy
      const allIssues = Object.values(state.issues).map((i) =>
        i.number === issueNumber ? updatedGitHubIssue : (i as unknown as GitHubIssue)
      );
      const hierarchy = buildWorkItemHierarchy(allIssues);

      return {
        ...state,
        issues: {
          ...state.issues,
          [issueNumber]: recomputedIssue,
        },
        hierarchy,
      };
    }

    case "APPLY_BODY_CHANGE": {
      const { issueNumber, body } = action.payload;
      const issue = state.issues[issueNumber];
      if (!issue) return state;

      const updatedGitHubIssue: GitHubIssue = {
        ...issue,
        number: issue.number,
        title: issue.title,
        html_url: issue.html_url,
        state: issue.state,
        labels: Object.entries(issue.labels).map(([ns, val]) => `${ns}:${val}`),
        body,
      };

      const updatedIssue = recomputeWorkItem(updatedGitHubIssue);

      // Update the hierarchy
      const allIssues = Object.values(state.issues).map((i) =>
        i.number === issueNumber ? updatedGitHubIssue : (i as unknown as GitHubIssue)
      );
      const hierarchy = buildWorkItemHierarchy(allIssues);

      return {
        ...state,
        issues: {
          ...state.issues,
          [issueNumber]: updatedIssue,
        },
        hierarchy,
      };
    }

    case "ROLLBACK": {
      const { issueNumber, previousLabels } = action.payload;
      const issue = state.issues[issueNumber];
      if (!issue) return state;

      // Revert to previous labels
      const updatedGitHubIssue: GitHubIssue = {
        ...issue,
        number: issue.number,
        title: issue.title,
        html_url: issue.html_url,
        state: issue.state,
        labels: Object.entries(previousLabels).map(([ns, val]) => `${ns}:${val}`),
        body: issue.body,
      };

      const recomputedIssue = recomputeWorkItem(updatedGitHubIssue);

      // Update the hierarchy
      const allIssues = Object.values(state.issues).map((i) =>
        i.number === issueNumber ? updatedGitHubIssue : (i as unknown as GitHubIssue)
      );
      const hierarchy = buildWorkItemHierarchy(allIssues);

      return {
        ...state,
        issues: {
          ...state.issues,
          [issueNumber]: recomputedIssue,
        },
        hierarchy,
      };
    }

    default:
      return state;
  }
}

// Initial state
const initialState: WorkItemStoreState = {
  issues: {},
  hierarchy: null,
};

// Create the context
const WorkItemStoreContext = createContext<{
  state: WorkItemStoreState;
  dispatch: React.Dispatch<WorkItemAction>;
} | null>(null);

// Provider component
interface WorkItemStoreProviderProps {
  children: ReactNode;
}

export function WorkItemStoreProvider({ children }: WorkItemStoreProviderProps): React.JSX.Element {
  const [state, dispatch] = useReducer(workItemReducer, initialState);

  // Memoize the value to prevent unnecessary re-renders
  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);

  return (
    <WorkItemStoreContext.Provider value={value}>
      {children}
    </WorkItemStoreContext.Provider>
  );
}

// Custom hook to use the store
export function useWorkItemStore(): {
  state: WorkItemStoreState;
  dispatch: React.Dispatch<WorkItemAction>;
} {
  const context = useContext(WorkItemStoreContext);
  if (!context) {
    throw new Error("useWorkItemStore must be used within a WorkItemStoreProvider");
  }
  return context;
}

// Action creators for convenience
export function seedIssues(issues: GitHubIssue[]): WorkItemAction {
  return { type: "SEED", payload: issues };
}

export function applyLabelChange(
  issueNumber: number,
  namespace: string,
  value: string
): WorkItemAction {
  return { type: "APPLY_LABEL_CHANGE", payload: { issueNumber, namespace, value } };
}

export function applyBodyChange(issueNumber: number, body: string): WorkItemAction {
  return { type: "APPLY_BODY_CHANGE", payload: { issueNumber, body } };
}

export function rollbackLabels(
  issueNumber: number,
  previousLabels: ParsedLabels
): WorkItemAction {
  return { type: "ROLLBACK", payload: { issueNumber, previousLabels } };
}
