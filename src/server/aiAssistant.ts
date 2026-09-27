// AI Assistant - System instruction
const AI_SYSTEM_INSTRUCTION = `
You are an expert Agile Product Owner and writing assistant built directly into a work-item editor.
Your task is to help the user refine, detail, and polish their work item description.

RULES:
1. Ground your suggestions in the current description and all context provided.
2. When the user asks for suggestions or improvements, offer 2-3 specific options or actionable questions (e.g., acceptance criteria, edge cases, scope constraints). And provide numbers to each option for clarity.
3. Whenever you propose an updated version of the description, wrap the complete, updated text inside a triple-backtick markdown block tagged with \`work_item_update\` like this:

\`\`\`work_item_update
[Refined text goes here...]
\`\`\`

4. Keep chat responses concise, helpful, and collaborative.
5. Try to not ask more then 1 question at a time.
`;

export async function getAIResponse(
  prompt: string,
  context: string,
  history: Array<{ role: string; content: string }>,
  additionalContext: { workItemTitle?: string; parentEpic?: { title: string; description: string }; parentFeature?: { title: string; description: string }; repositoryReadme?: string } = {}
): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY || "";
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY is not configured in the server environment.");
  }

  // Build enriched context for the AI
  const contextParts: string[] = [];

  if (additionalContext.workItemTitle) {
    contextParts.push(`[WORK ITEM TITLE]: ${additionalContext.workItemTitle}`);
  }

  if (additionalContext.parentEpic) {
    contextParts.push(`[PARENT EPIC]: ${additionalContext.parentEpic.title}`);
    if (additionalContext.parentEpic.description) {
      contextParts.push(`[EPIC DESCRIPTION]: ${additionalContext.parentEpic.description}`);
    }
  }

  if (additionalContext.parentFeature) {
    contextParts.push(`[PARENT FEATURE]: ${additionalContext.parentFeature.title}`);
    if (additionalContext.parentFeature.description) {
      contextParts.push(`[FEATURE DESCRIPTION]: ${additionalContext.parentFeature.description}`);
    }
  }

  if (additionalContext.repositoryReadme) {
    contextParts.push(`[REPOSITORY README]:\n${additionalContext.repositoryReadme}`);
  }

  contextParts.push(`[CURRENT WORK ITEM DESCRIPTION]:\n${context || "(Empty)"}`);

  const fullContext = contextParts.join("\n\n");

  const messages = [
    {
      role: "system",
      content: `${AI_SYSTEM_INSTRUCTION}\n\n${fullContext}`,
    },
    ...history.map((msg) => ({
      role: msg.role === "model" ? "assistant" : "user",
      content: msg.content,
    })),
    { role: "user", content: prompt },
  ];

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.MISTRAL_MODEL || "mistral-large-latest",
      messages,
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mistral API error: ${response.status} - ${errorText}`);
  }

  interface AiResponse {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  }

  const data: AiResponse = await response.json();
  return data.choices?.[0]?.message?.content || "Sorry, I couldn't process that.";
}
