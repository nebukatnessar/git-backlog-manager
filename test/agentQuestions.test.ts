import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_CONVERSATION_MARKER,
  buildAgentQuestionsComment,
  parseAgentQuestions,
  withAgentAnswers,
} from "../src/shared/agentQuestions";

test("parseAgentQuestions returns empty for comments without the marker", () => {
  assert.deepEqual(parseAgentQuestions("Just a normal comment"), []);
  assert.deepEqual(parseAgentQuestions(""), []);
});

test("parseAgentQuestions extracts prefixed questions after the marker", () => {
  const body = `Some intro text.
${AGENT_CONVERSATION_MARKER}
[question] Should the cache size be configurable or hard-coded?
[dependency] Blocked on #42 landing first.
`;
  const questions = parseAgentQuestions(body);
  assert.equal(questions.length, 2);
  assert.deepEqual(questions[0], { kind: "question", text: "Should the cache size be configurable or hard-coded?", answers: [] });
  assert.deepEqual(questions[1], { kind: "dependency", text: "Blocked on #42 landing first.", answers: [] });
});

test("parseAgentQuestions stops at non-question content after questions started", () => {
  const body = `${AGENT_CONVERSATION_MARKER}
[question] Should X be configurable?
Some trailing prose that is not part of the exchange.
[question] Should not be picked up.
`;
  const questions = parseAgentQuestions(body);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].text, "Should X be configurable?");
});

test("parseAgentQuestions ignores an empty marker block", () => {
  assert.deepEqual(parseAgentQuestions(`${AGENT_CONVERSATION_MARKER}\n\n`), []);
});

test("buildAgentQuestionsComment round-trips through parseAgentQuestions", () => {
  const questions = [
    { kind: "question" as const, text: "Should X be configurable?", answers: [] },
    { kind: "dependency" as const, text: "Blocked on #42.", answers: [] },
  ];
  const comment = buildAgentQuestionsComment(questions);
  assert.ok(comment.includes(AGENT_CONVERSATION_MARKER));
  assert.deepEqual(parseAgentQuestions(comment), questions);
});

test("withAgentAnswers appends answers and preserves unanswered questions", () => {
  const questions = [
    { kind: "question" as const, text: "Q1?", answers: [] },
    { kind: "dependency" as const, text: "D1.", answers: ["existing"] },
  ];
  const updated = withAgentAnswers(questions, ["first answer", ""]);
  assert.deepEqual(updated[0].answers, ["first answer"]);
  assert.deepEqual(updated[1].answers, ["existing"]);
});

test("answered comments round-trip with answers intact", () => {
  const questions = withAgentAnswers(
    [
      { kind: "question" as const, text: "Q1?", answers: [] },
      { kind: "dependency" as const, text: "D1.", answers: [] },
    ],
    ["yes", "unblocked now"],
  );
  const comment = buildAgentQuestionsComment(questions);
  assert.deepEqual(parseAgentQuestions(comment), questions);
});
