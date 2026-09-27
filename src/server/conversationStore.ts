import { GitHubApiError, githubHeaders } from "./githubRest";

// AI Conversation storage
export const AI_CONVERSATION_MARKER = "<!-- AI_CONVERSATION -->";

export interface ConversationMessage {
  role: "user" | "model";
  content: string;
}

export async function fetchConversationComments(owner: string, repo: string, issueId: number, token: string): Promise<ConversationMessage[]> {
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues/${issueId}/comments`);

  const response = await fetch(url, { headers: githubHeaders(token) });
  if (!response.ok) throw new GitHubApiError(response.status, await response.text());

  interface GitHubComment {
    id: number;
    body: string;
    user?: { login: string };
  }

  const comments = (await response.json()) as GitHubComment[];

  // Find the comment that contains our AI conversation marker
  const conversationComment = comments.find((c) => c.body.includes(AI_CONVERSATION_MARKER));

  if (!conversationComment) return [];

  try {
    // Extract JSON from the comment body
    const body = conversationComment.body;
    const jsonStart = body.indexOf("{");
    const jsonEnd = body.lastIndexOf("}") + 1;

    if (jsonStart === -1 || jsonEnd <= jsonStart) return [];

    const jsonStr = body.slice(jsonStart, jsonEnd);
    const parsed = JSON.parse(jsonStr) as { conversation?: ConversationMessage[] };
    return parsed.conversation || [];
  } catch (error) {
    console.warn("Failed to parse conversation from comment:", error);
    return [];
  }
}

export async function saveConversationComment(
  owner: string,
  repo: string,
  issueId: number,
  token: string,
  conversation: ConversationMessage[]
): Promise<void> {
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues/${issueId}/comments`);

  // First, try to find and update existing conversation comment
  try {
    const comments = await fetchConversationComments(owner, repo, issueId, token);
    const existingComment = comments.length > 0;

    if (existingComment) {
      // We need to find the comment ID to update it
      const commentsUrl = new URL(`https://api.github.com/repos/${owner}/${repo}/issues/${issueId}/comments`);
      const commentsResponse = await fetch(commentsUrl, { headers: githubHeaders(token) });
      if (!commentsResponse.ok) throw new GitHubApiError(commentsResponse.status, await commentsResponse.text());

      interface GitHubComment {
        id: number;
        body: string;
      }

      const allComments = (await commentsResponse.json()) as GitHubComment[];
      const conversationComment = allComments.find((c) => c.body.includes(AI_CONVERSATION_MARKER));

      if (conversationComment) {
        // Update existing comment
        const updateUrl = new URL(`https://api.github.com/repos/${owner}/${repo}/issues/comments/${conversationComment.id}`);
        await fetch(updateUrl, {
          method: "PATCH",
          headers: githubHeaders(token, true),
          body: JSON.stringify({
            body: `${AI_CONVERSATION_MARKER}\n${JSON.stringify({ conversation })}`
          }),
        });
        return;
      }
    }
  } catch (error) {
    // If we can't find existing comment, just create a new one
    console.warn("Could not update existing conversation comment, creating new one:", error);
  }

  // Create new comment
  await fetch(url, {
    method: "POST",
    headers: githubHeaders(token, true),
    body: JSON.stringify({
      body: `${AI_CONVERSATION_MARKER}\n${JSON.stringify({ conversation })}`
    }),
  });
}
