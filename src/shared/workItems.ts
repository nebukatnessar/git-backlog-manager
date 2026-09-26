export interface GitHubLabel {
  name?: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  labels?: Array<GitHubLabel | string>;
  body?: string;
}

export interface WorkItem {
  number: number;
  title: string;
  html_url: string;
  state: string;
  labels: Record<string, string>;
  body?: string;
}

export interface Task extends WorkItem {
  slug: string;
}

export interface Feature extends WorkItem {
  slug: string;
  tasks: Task[];
}

export interface Epic extends WorkItem {
  slug: string;
  features: Feature[];
}

export interface WorkItemHierarchy {
  epics: Epic[];
  bugs: WorkItem[];
  orphanFeatures: WorkItem[];
  orphanTasks: WorkItem[];
  unclassified: WorkItem[];
}

export const WORK_ITEM_TYPES = ["epic", "feature", "task"] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

export const WORK_ITEM_STATUSES = ["backlog", "in-progress", "done"] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const WORK_ITEM_PRIORITIES = ["low", "medium", "high"] as const;
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];

export interface CreateWorkItemInput {
  type: WorkItemType;
  title: string;
  slug: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  epic?: string;
  feature?: string;
}

const SLUG_PATTERN = /^[a-z0-9-]+$/;

export function isWorkItemType(value: string): value is WorkItemType {
  return (WORK_ITEM_TYPES as readonly string[]).includes(value);
}

export function isWorkItemStatus(value: string): value is WorkItemStatus {
  return (WORK_ITEM_STATUSES as readonly string[]).includes(value);
}

export function isWorkItemPriority(value: string): value is WorkItemPriority {
  return (WORK_ITEM_PRIORITIES as readonly string[]).includes(value);
}

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

export function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || "item";
}

export function uniqueSlug(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function existingSlugsFor(
  hierarchy: WorkItemHierarchy,
  type: WorkItemType,
  parents: { epic?: string; feature?: string } = {},
): string[] {
  if (type === "epic") return hierarchy.epics.map((epic) => epic.slug);

  const epic = hierarchy.epics.find((item) => item.slug === parents.epic);
  if (type === "feature") return epic?.features.map((feature) => feature.slug) || [];

  const feature = epic?.features.find((item) => item.slug === parents.feature);
  return feature?.tasks.map((task) => task.slug) || [];
}

export function validateCreateWorkItem(input: {
  type?: string;
  title?: string;
  slug?: string;
  status?: string;
  priority?: string;
  epic?: string;
  feature?: string;
}): { ok: true; value: CreateWorkItemInput } | { ok: false; error: string } {
  const title = (input.title || "").trim();
  if (!title) return { ok: false, error: "Title is required." };

  const type = (input.type || "").trim().toLowerCase();
  if (!isWorkItemType(type)) return { ok: false, error: "Type must be epic, feature, or task." };

  const status = (input.status || "backlog").trim().toLowerCase();
  if (!isWorkItemStatus(status)) return { ok: false, error: "Status must be backlog, in-progress, or done." };

  const priority = (input.priority || "medium").trim().toLowerCase();
  if (!isWorkItemPriority(priority)) return { ok: false, error: "Priority must be low, medium, or high." };

  const slug = slugify(input.slug || title);
  if (!isValidSlug(slug)) return { ok: false, error: "Slug must use lowercase letters, numbers, and hyphens." };

  const epic = (input.epic || "").trim().toLowerCase();
  const feature = (input.feature || "").trim().toLowerCase();

  if (type === "feature" && !isValidSlug(epic)) {
    return { ok: false, error: "A feature requires a parent epic slug." };
  }
  if (type === "task" && (!isValidSlug(epic) || !isValidSlug(feature))) {
    return { ok: false, error: "A task requires parent epic and feature slugs." };
  }

  return {
    ok: true,
    value: {
      type,
      title,
      slug,
      status,
      priority,
      ...(type === "feature" || type === "task" ? { epic } : {}),
      ...(type === "task" ? { feature } : {}),
    },
  };
}

export function buildCreateLabels(input: CreateWorkItemInput): string[] {
  const labels = [`type:${input.type}`, `status:${input.status}`, `priority:${input.priority}`];

  // Add actionable label based on type
  if (input.type === "task") {
    labels.push(`actionable:needs-scoping`);
  } else {
    labels.push(`actionable:not-applicable`);
  }

  if (input.type === "epic") {
    labels.push(`epic:${input.slug}`);
  } else if (input.type === "feature") {
    labels.push(`epic:${input.epic}`, `feature:${input.slug}`);
  } else {
    labels.push(`epic:${input.epic}`, `feature:${input.feature}`, `task:${input.slug}`);
  }

  return labels;
}

function normalizeLabelName(label: GitHubLabel | string | undefined): string {
  if (!label) return "";
  if (typeof label === "string") return label;
  if (typeof label.name === "string") return label.name;
  return "";
}

export function parseNamespacedLabels(labels: GitHubIssue["labels"]): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const label of labels || []) {
    const name = normalizeLabelName(label).trim().toLowerCase();
    const splitIndex = name.indexOf(":");

    if (splitIndex <= 0 || splitIndex === name.length - 1) continue;

    const namespace = name.slice(0, splitIndex);
    const value = name.slice(splitIndex + 1);

    if (!/^[a-z0-9-]+$/.test(namespace)) continue;
    if (!/^[a-z0-9-]+$/.test(value)) continue;

    parsed[namespace] = value;
  }

  return parsed;
}

function mapIssue(issue: GitHubIssue): WorkItem {
  return {
    number: issue.number,
    title: issue.title,
    html_url: issue.html_url,
    state: issue.state,
    labels: parseNamespacedLabels(issue.labels),
    body: issue.body,
  };
}

export function buildWorkItemHierarchy(issues: GitHubIssue[] = []): WorkItemHierarchy {
  const mappedIssues = issues.map(mapIssue);
  const epicsBySlug = new Map<string, Epic>();
  const featuresByPath = new Map<string, Feature>();

  const bugs: WorkItem[] = [];
  const orphanFeatures: WorkItem[] = [];
  const orphanTasks: WorkItem[] = [];
  const unclassified: WorkItem[] = [];

  for (const issue of mappedIssues) {
    if (issue.labels.type === "epic" && issue.labels.epic) {
      const epicNode: Epic = { ...issue, slug: issue.labels.epic, features: [] };
      epicsBySlug.set(issue.labels.epic, epicNode);
    }
  }

  for (const issue of mappedIssues) {
    if (issue.labels.type !== "feature") continue;

    const epicSlug = issue.labels.epic;
    const featureSlug = issue.labels.feature;

    if (!epicSlug || !featureSlug) {
      orphanFeatures.push(issue);
      continue;
    }

    const featureNode: Feature = { ...issue, slug: featureSlug, tasks: [] };
    featuresByPath.set(`${epicSlug}/${featureSlug}`, featureNode);

    const parentEpic = epicsBySlug.get(epicSlug);
    if (parentEpic) parentEpic.features.push(featureNode);
    else orphanFeatures.push(featureNode);
  }

  for (const issue of mappedIssues) {
    if (issue.labels.type === "task") {
      const epicSlug = issue.labels.epic;
      const featureSlug = issue.labels.feature;
      const taskSlug = issue.labels.task;

      if (!epicSlug || !featureSlug || !taskSlug) {
        orphanTasks.push(issue);
        continue;
      }

      const taskNode: Task = { ...issue, slug: taskSlug };
      const parentFeature = featuresByPath.get(`${epicSlug}/${featureSlug}`);
      if (parentFeature) parentFeature.tasks.push(taskNode);
      else orphanTasks.push(taskNode);
      continue;
    }

    if (issue.labels.type === "bug") {
      bugs.push(issue);
      continue;
    }

    if (issue.labels.type !== "epic" && issue.labels.type !== "feature") {
      unclassified.push(issue);
    }
  }

  return {
    epics: [...epicsBySlug.values()],
    bugs,
    orphanFeatures,
    orphanTasks,
    unclassified,
  };
}