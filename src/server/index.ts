import {
  buildCreateLabels,
  buildWorkItemHierarchy,
  existingSlugsFor,
  uniqueSlug,
  validateCreateWorkItem,
  parseNamespacedLabels,
  type GitHubIssue,
} from "../shared/workItems";