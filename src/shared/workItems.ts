export interface GitHubLabel {
  name?: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  labels?: Array<GitHubLabel | string>;
}

export interface WorkItem {
  number: number;
  title: string;
  html_url: string;
  state: string;
  labels: Record<string, string>;
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