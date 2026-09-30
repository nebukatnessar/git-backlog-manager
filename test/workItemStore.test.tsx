import { describe, it, expect, beforeEach } from "vitest";
import { workItemReducer, seedIssues, applyLabelChange, applyBodyChange, rollbackLabels } from "../../public/state/workItemStore";
import type { GitHubIssue, WorkItem } from "../../src/shared/workItems";

// Mock GitHub issues for testing
const mockGitHubIssues: GitHubIssue[] = [
  {
    number: 1,
    title: "Test Epic",
    html_url: "https://github.com/owner/repo/issues/1",
    state: "open",
    labels: ["type:epic", "status:backlog", "priority:medium", "epic:test-epic"],
    body: "This is a test epic",
  },
  {
    number: 2,
    title: "Test Feature",
    html_url: "https://github.com/owner/repo/issues/2",
    state: "open",
    labels: ["type:feature", "status:backlog", "priority:high", "epic:test-epic", "feature:test-feature"],
    body: "This is a test feature",
  },
  {
    number: 3,
    title: "Test Task",
    html_url: "https://github.com/owner/repo/issues/3",
    state: "open",
    labels: ["type:task", "status:in-progress", "priority:low", "epic:test-epic", "feature:test-feature", "task:test-task", "stack-rank:1000"],
    body: "This is a test task",
  },
];

// Initial state for testing
const initialState = {
  issues: {},
  hierarchy: null,
};

describe("workItemStore reducer", () => {
  describe("SEED action", () => {
    it("should seed the store with issues and build hierarchy", () => {
      const action = seedIssues(mockGitHubIssues);
      const newState = workItemReducer(initialState, action);

      // Check that issues are added to the store
      expect(Object.keys(newState.issues).length).toBe(mockGitHubIssues.length);
      expect(newState.issues[1]).toBeDefined();
      expect(newState.issues[2]).toBeDefined();
      expect(newState.issues[3]).toBeDefined();

      // Check that labels are parsed correctly
      expect(newState.issues[1].labels.type).toBe("epic");
      expect(newState.issues[1].labels.status).toBe("backlog");
      expect(newState.issues[1].labels.priority).toBe("medium");
      expect(newState.issues[1].labels.epic).toBe("test-epic");

      // Check that stackRank is parsed correctly
      expect(newState.issues[3].stackRank).toBe(1000);

      // Check that hierarchy is built
      expect(newState.hierarchy).toBeDefined();
      expect(newState.hierarchy?.epics.length).toBeGreaterThan(0);
    });

    it("should replace existing issues with new ones", () => {
      const existingIssue: GitHubIssue = {
        number: 1,
        title: "Existing Issue",
        html_url: "https://github.com/owner/repo/issues/1",
        state: "open",
        labels: ["type:epic", "status:done"],
        body: "Existing body",
      };

      const stateWithExistingIssue = {
        issues: { 1: { ...existingIssue, labels: { type: "epic", status: "done" }, stackRank: undefined } },
        hierarchy: null,
      };

      const updatedIssue: GitHubIssue = {
        ...existingIssue,
        labels: ["type:epic", "status:backlog"],
        body: "Updated body",
      };

      const action = seedIssues([updatedIssue]);
      const newState = workItemReducer(stateWithExistingIssue, action);

      // Check that the issue is updated
      expect(newState.issues[1].labels.status).toBe("backlog");
      expect(newState.issues[1].body).toBe("Updated body");
    });
  });

  describe("APPLY_LABEL_CHANGE action", () => {
    let stateWithIssues: { issues: Record<number, WorkItem>; hierarchy: any };

    beforeEach(() => {
      const action = seedIssues(mockGitHubIssues);
      stateWithIssues = workItemReducer(initialState, action);
    });

    it("should update the label for an existing issue", () => {
      const action = applyLabelChange(1, "status", "in-progress");
      const newState = workItemReducer(stateWithIssues, action);

      expect(newState.issues[1].labels.status).toBe("in-progress");
    });

    it("should add a new label if it doesn't exist", () => {
      const action = applyLabelChange(1, "actionable", "ready");
      const newState = workItemReducer(stateWithIssues, action);

      expect(newState.issues[1].labels.actionable).toBe("ready");
    });

    it("should update stackRank when stack-rank label changes", () => {
      const action = applyLabelChange(3, "stack-rank", "2000");
      const newState = workItemReducer(stateWithIssues, action);

      expect(newState.issues[3].stackRank).toBe(2000);
    });

    it("should update the hierarchy when labels change", () => {
      const action = applyLabelChange(3, "status", "done");
      const newState = workItemReducer(stateWithIssues, action);

      // Check that hierarchy is updated
      expect(newState.hierarchy).toBeDefined();
    });
  });

  describe("APPLY_BODY_CHANGE action", () => {
    let stateWithIssues: { issues: Record<number, WorkItem>; hierarchy: any };

    beforeEach(() => {
      const action = seedIssues(mockGitHubIssues);
      stateWithIssues = workItemReducer(initialState, action);
    });

    it("should update the body for an existing issue", () => {
      const newBody = "Updated body content";
      const action = applyBodyChange(1, newBody);
      const newState = workItemReducer(stateWithIssues, action);

      expect(newState.issues[1].body).toBe(newBody);
    });

    it("should update the hierarchy when body changes", () => {
      const newBody = "Updated body content";
      const action = applyBodyChange(1, newBody);
      const newState = workItemReducer(stateWithIssues, action);

      // Check that hierarchy is updated
      expect(newState.hierarchy).toBeDefined();
    });
  });

  describe("ROLLBACK action", () => {
    let stateWithIssues: { issues: Record<number, WorkItem>; hierarchy: any };

    beforeEach(() => {
      const action = seedIssues(mockGitHubIssues);
      stateWithIssues = workItemReducer(initialState, action);
    });

    it("should revert labels to previous state", () => {
      // First, apply a label change
      let newState = workItemReducer(stateWithIssues, applyLabelChange(1, "status", "in-progress"));
      expect(newState.issues[1].labels.status).toBe("in-progress");

      // Then, rollback to previous labels
      const previousLabels = { type: "epic", status: "backlog", priority: "medium", epic: "test-epic" };
      newState = workItemReducer(newState, rollbackLabels(1, previousLabels));

      expect(newState.issues[1].labels.status).toBe("backlog");
    });

    it("should restore all previous labels", () => {
      // Apply multiple label changes
      let newState = workItemReducer(stateWithIssues, applyLabelChange(1, "status", "in-progress"));
      newState = workItemReducer(newState, applyLabelChange(1, "priority", "high"));

      // Rollback to previous labels
      const previousLabels = { type: "epic", status: "backlog", priority: "medium", epic: "test-epic" };
      newState = workItemReducer(newState, rollbackLabels(1, previousLabels));

      expect(newState.issues[1].labels.status).toBe("backlog");
      expect(newState.issues[1].labels.priority).toBe("medium");
    });
  });
});
