export const AGENT_CONVERSATION_MARKER = "<!-- AI_CONVERSATION -->";

export type AgentQuestionKind = "question" | "dependency";

export interface AgentQuestion {
  kind: AgentQuestionKind;
  text: string;
  answers: string[];
}

const QUESTION_PATTERN = /^\[(question|dependency)\]\s*(.+)$/;
const ANSWER_PATTERN = /^\[answer\]\s*(.+)$/;

export function parseAgentQuestions(body: string): AgentQuestion[] {
  const markerIndex = body.indexOf(AGENT_CONVERSATION_MARKER);
  if (markerIndex === -1) return [];

  const lines = body.slice(markerIndex + AGENT_CONVERSATION_MARKER.length).split("\n");
  const questions: AgentQuestion[] = [];
  let foundQuestion = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const questionMatch = line.match(QUESTION_PATTERN);
    if (questionMatch) {
      foundQuestion = true;
      questions.push({
        kind: questionMatch[1] as AgentQuestionKind,
        text: questionMatch[2].trim(),
        answers: [],
      });
      continue;
    }

    if (!foundQuestion) return [];

    const answerMatch = line.match(ANSWER_PATTERN);
    if (answerMatch) {
      if (questions.length > 0) questions[questions.length - 1].answers.push(answerMatch[1].trim());
      continue;
    }

    return questions;
  }

  return questions;
}

export function looksLikeAgentQuestionsComment(body: string): boolean {
  return parseAgentQuestions(body).length > 0;
}

export function buildAgentQuestionsComment(questions: AgentQuestion[]): string {
  const lines = [AGENT_CONVERSATION_MARKER, ""];
  for (const question of questions) {
    lines.push(`[${question.kind}] ${question.text}`);
    for (const answer of question.answers) lines.push(`[answer] ${answer}`);
  }
  return lines.join("\n");
}

export function withAgentAnswers(questions: AgentQuestion[], answers: string[]): AgentQuestion[] {
  return questions.map((question, index) => {
    const answer = (answers[index] || "").trim();
    return answer ? { ...question, answers: [...question.answers, answer] } : question;
  });
}
