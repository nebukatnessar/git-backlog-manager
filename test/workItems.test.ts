import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateLabels,
  buildWorkItemHierarchy,
  existingSlugsFor,
  itemMatchesQuery,
  parseNamespacedLabels,
  slugify,
  uniqueSlug,
  validateCreateWorkItem,
} from "../src/shared/workItems";

test("parseNamespacedLabels extracts valid namespace:value labels", () => {
  const labels = [{ name: "Type:Task" }, { name: "epic:core-audio" }, { name: "invalid" }, { name: "priority:high" }];

  assert.deepEqual(parseNamespacedLabels(labels), {
    type: "task",
    epic: "core-audio",
    priority: "high",
  });
});

test("buildWorkItemHierarchy links epics, features, tasks and bugs", () => {
  const issues = [
    { number: 1, title: "Epic: Core Audio", html_url: "e1", state: "open", labels: [{ name: "type:epic" }, { name: "epic:core-audio" }] },
    { number: 2, title: "Feature: WAV", html_url: "f1", state: "open", labels: [{ name: "type:feature" }, { name: "epic:core-audio" }, { name: "feature:wav-import" }] },
    { number: 3, title: "Task: Decode", html_url: "t1", state: "open", labels: [{ name: "type:task" }, { name: "epic:core-audio" }, { name: "feature:wav-import" }, { name: "task:decode-wav-headers" }, { name: "status:backlog" }] },
    { number: 4, title: "Bug: Click", html_url: "b1", state: "open", labels: [{ name: "type:bug" }, { name: "status:in-progress" }] },
  ];

  const result = buildWorkItemHierarchy(issues);

  assert.equal(result.epics.length, 1);
  assert.equal(result.epics[0].features.length, 1);
  assert.equal(result.epics[0].features[0].tasks.length, 1);
  assert.equal(result.bugs.length, 1);
  assert.equal(result.orphanFeatures.length, 0);
  assert.equal(result.orphanTasks.length, 0);
});

test("slugify and uniqueSlug produce parser-safe identifiers", () => {
  assert.equal(slugify("WAV Import"), "wav-import");
  assert.equal(uniqueSlug("wav-import", ["wav-import", "wav-import-2"]), "wav-import-3");
});

test("validateCreateWorkItem requires parents for nested types", () => {
  const feature = validateCreateWorkItem({ type: "feature", title: "WAV Import" });
  assert.equal(feature.ok, false);

  const task = validateCreateWorkItem({
    type: "task",
    title: "Decode headers",
    epic: "core-audio",
    feature: "wav-import",
    status: "backlog",
    priority: "high",
  });
  assert.equal(task.ok, true);
  if (task.ok) {
    assert.deepEqual(buildCreateLabels(task.value), [
      "type:task",
      "status:backlog",
      "priority:high",
      "actionable:needs-scoping",
      "epic:core-audio",
      "feature:wav-import",
      "task:decode-headers",
    ]);
  }
});

test("existingSlugsFor scopes uniqueness to the parent node", () => {
  const hierarchy = buildWorkItemHierarchy([
    { number: 1, title: "Epic", html_url: "e1", state: "open", labels: [{ name: "type:epic" }, { name: "epic:core-audio" }] },
    { number: 2, title: "Feature", html_url: "f1", state: "open", labels: [{ name: "type:feature" }, { name: "epic:core-audio" }, { name: "feature:wav-import" }] },
  ]);

  assert.deepEqual(existingSlugsFor(hierarchy, "epic"), ["core-audio"]);
  assert.deepEqual(existingSlugsFor(hierarchy, "feature", { epic: "core-audio" }), ["wav-import"]);
  assert.deepEqual(existingSlugsFor(hierarchy, "task", { epic: "core-audio", feature: "wav-import" }), []);
});

// Tests for itemMatchesQuery
test("itemMatchesQuery matches title case-insensitively", () => {
  const item = {
    number: 1,
    title: "Fix Dropdowns",
    html_url: "url",
    state: "open",
    labels: { type: "task", epic: "core-audio", feature: "wav-import", task: "fix-dropdowns" },
  };
  assert.equal(itemMatchesQuery(item, "dropdowns"), true);
  assert.equal(itemMatchesQuery(item, "DROPDOWNS"), true);
  assert.equal(itemMatchesQuery(item, "Fix"), true);
  assert.equal(itemMatchesQuery(item, "fix"), true);
});

test("itemMatchesQuery matches issue number", () => {
  const item = {
    number: 44,
    title: "Some Issue",
    html_url: "url",
    state: "open",
    labels: { type: "task", epic: "core-audio" },
  };
  assert.equal(itemMatchesQuery(item, "44"), true);
  assert.equal(itemMatchesQuery(item, "4"), true);
  assert.equal(itemMatchesQuery(item, "5"), false);
});

test("itemMatchesQuery matches label slugs and namespaces", () => {
  const item = {
    number: 1,
    title: "Some Issue",
    html_url: "url",
    state: "open",
    labels: { type: "task", epic: "core-audio", feature: "wav-import", task: "fix-dropdowns", status: "backlog" },
  };
  assert.equal(itemMatchesQuery(item, "fix-dropdowns"), true);
  assert.equal(itemMatchesQuery(item, "ai-integration"), false);
  assert.equal(itemMatchesQuery(item, "backlog"), true);
  assert.equal(itemMatchesQuery(item, "epic:core-audio"), true);
  assert.equal(itemMatchesQuery(item, "core-audio"), true);
});

test("itemMatchesQuery returns true for empty query", () => {
  const item = {
    number: 1,
    title: "Some Issue",
    html_url: "url",
    state: "open",
    labels: { type: "task" },
  };
  assert.equal(itemMatchesQuery(item, ""), true);
});

test("itemMatchesQuery matches slug for Epic/Feature/Task", () => {
  const epic = {
    number: 1,
    title: "Core Audio",
    html_url: "url",
    state: "open",
    labels: { type: "epic", epic: "core-audio" },
    slug: "core-audio",
    features: [],
  };
  assert.equal(itemMatchesQuery(epic, "core-audio"), true);

  const feature = {
    number: 2,
    title: "WAV Import",
    html_url: "url",
    state: "open",
    labels: { type: "feature", epic: "core-audio", feature: "wav-import" },
    slug: "wav-import",
    tasks: [],
  };
  assert.equal(itemMatchesQuery(feature, "wav-import"), true);
});
