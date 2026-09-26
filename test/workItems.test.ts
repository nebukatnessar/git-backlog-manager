import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkItemHierarchy, parseNamespacedLabels } from "../src/shared/workItems";

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