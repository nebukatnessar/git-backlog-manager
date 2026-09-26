function normalizeLabelName(label) {
  if (!label) return "";
  if (typeof label === "string") return label;
  if (typeof label.name === "string") return label.name;
  return "";
}

function parseNamespacedLabels(labels) {
  const parsed = {};

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

function mapIssue(issue) {
  const namespacedLabels = parseNamespacedLabels(issue.labels);

  return {
    number: issue.number,
    title: issue.title,
    html_url: issue.html_url,
    state: issue.state,
    labels: namespacedLabels,
  };
}

function buildWorkItemHierarchy(issues) {
  const mappedIssues = (issues || []).map(mapIssue);
  const epicsBySlug = new Map();
  const featuresByPath = new Map();

  const bugs = [];
  const orphanFeatures = [];
  const orphanTasks = [];
  const unclassified = [];

  for (const issue of mappedIssues) {
    if (issue.labels.type === "epic" && issue.labels.epic) {
      const epicNode = {
        ...issue,
        slug: issue.labels.epic,
        features: [],
      };
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

    const featureNode = {
      ...issue,
      slug: featureSlug,
      tasks: [],
    };

    featuresByPath.set(`${epicSlug}/${featureSlug}`, featureNode);

    const parentEpic = epicsBySlug.get(epicSlug);
    if (parentEpic) {
      parentEpic.features.push(featureNode);
    } else {
      orphanFeatures.push(featureNode);
    }
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

      const taskNode = {
        ...issue,
        slug: taskSlug,
      };

      const parentFeature = featuresByPath.get(`${epicSlug}/${featureSlug}`);
      if (parentFeature) {
        parentFeature.tasks.push(taskNode);
      } else {
        orphanTasks.push(taskNode);
      }

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

  const epics = [...epicsBySlug.values()];

  return {
    epics,
    bugs,
    orphanFeatures,
    orphanTasks,
    unclassified,
  };
}

module.exports = {
  parseNamespacedLabels,
  buildWorkItemHierarchy,
};
