import React, { useState, useCallback, useEffect, FormEvent, ChangeEvent } from "react";
import ReactMarkdown from "react-markdown";
import { Box, Button, CircularProgress, Divider, Paper, Stack, TextField, Typography } from "@mui/material";
import { SmartToy } from "@mui/icons-material";

interface Message {
  role: "user" | "model";
  content: string;
}

interface AdditionalContext {
  workItemTitle?: string;
  parentEpic?: { title: string; description: string };
  parentFeature?: { title: string; description: string };
  repositoryReadme?: string;
}

interface AIAssistantPanelProps {
  description: string;
  additionalContext?: AdditionalContext;
  onApplySuggestion: (updatedDescription: string) => void;
  conversation?: Message[];
  onConversationChange?: (conversation: Message[]) => void;
}

// Helper to extract the updated work item text from the model's output
const extractUpdatedDescription = (text: string): string | null => {
  const match = text.match(/```work_item_update\n([\s\S]*?)\n```/);
  return match ? match[1] : null;
};

const extractSuggestions = (text: string): string[] => {
  const suggestions: string[] = [];
  // Look for bullet points or numbered items
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("-") || trimmed.startsWith("*") || /^\d+\./.test(trimmed)) {
      suggestions.push(trimmed.replace(/^[-\*\d.\s]+/, "").trim());
    }
  }
  return suggestions.filter((s) => s.length > 0);
};

export function AIAssistantPanel({ 
  description, 
  additionalContext, 
  onApplySuggestion,
  conversation = [],
  onConversationChange
}: AIAssistantPanelProps): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>(conversation);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Sync internal state with prop changes
  useEffect(() => {
    setMessages(conversation);
  }, [conversation]);

  // Notify parent of conversation changes
  useEffect(() => {
    onConversationChange?.(messages);
  }, [messages, onConversationChange]);

  const handleSendMessage = useCallback(
    async (e: FormEvent<HTMLFormElement>): Promise<void> => {
      e.preventDefault();
      if (!inputMessage.trim() || isLoading) return;

      const userText = inputMessage;
      setInputMessage("");

      const updatedHistory: Message[] = [...messages, { role: "user", content: userText }];
      setMessages(updatedHistory);
      setIsLoading(true);

      try {
        const response = await fetch("/api/ai/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: userText,
            context: description || "",
            history: messages.map((m) => ({ role: m.role, content: m.content })),
            additionalContext,
          }),
        });

        interface AiSuggestionResponse {
          response?: string;
          error?: string;
        }

        const data: AiSuggestionResponse = await response.json();

        if (data.error) {
          throw new Error(data.error);
        }

        const aiReply = data.response || "Sorry, I couldn't process that.";

        setMessages((prev) => [...prev, { role: "model", content: aiReply }]);
      } catch (err) {
        console.error("AI API Error:", err);
        setMessages((prev) => [
          ...prev,
          { role: "model", content: "Error communicating with AI service. Please check the server configuration." },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, inputMessage, description, isLoading]
  );

  const handleApplyLastSuggestion = useCallback(() => {
    const lastModelMessage = messages.slice().reverse().find((m) => m.role === "model");
    if (lastModelMessage) {
      const proposedUpdate = extractUpdatedDescription(lastModelMessage.content);
      if (proposedUpdate) {
        onApplySuggestion(proposedUpdate);
      }
    }
  }, [messages, onApplySuggestion]);

  // Check if the last model message has a work_item_update block
  const hasSuggestion = (): boolean => {
    const lastModelMessage = messages.slice().reverse().find((m) => m.role === "model");
    return lastModelMessage ? extractUpdatedDescription(lastModelMessage.content) !== null : false;
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderColor: "divider",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <SmartToy sx={{ color: "primary.main" }} />
        <Typography variant="h6">AI Assistant</Typography>
      </Stack>

      <Divider sx={{ my: 1, borderColor: "divider" }} />

      {/* Chat Log */}
      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          mb: 2,
          minHeight: 200,
        }}
      >
        {messages.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
            Ask me to help write acceptance criteria, improve your description, add edge cases, or refine the scope!
          </Typography>
        ) : (
          messages.map((m, idx) => {
            const displayText = m.content.replace(/```work_item_update[\s\S]*?```/g, "").trim();

            return (
              <Stack
                key={idx}
                spacing={1}
                sx={{
                  mb: 2,
                  alignItems: m.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <Box
                  sx={{
                    maxWidth: "90%",
                    p: 1.5,
                    borderRadius: 1,
                    bgcolor: m.role === "user" ? "primary.main" : "background.paper",
                    color: m.role === "user" ? "primary.contrastText" : "text.primary",
                    fontSize: "0.875rem",
                    border: m.role === "model" ? "1px solid" : undefined,
                    borderColor: m.role === "model" ? "divider" : undefined,
                  }}
                >
                  {m.role === "model" ? (
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <Typography sx={{ mb: 1, fontSize: "inherit", color: "inherit" }}>{children}</Typography>,
                        h1: ({ children }) => <Typography variant="h6" sx={{ mt: 1, mb: 1, fontSize: "inherit", color: "inherit" }}>{children}</Typography>,
                        h2: ({ children }) => <Typography variant="subtitle1" sx={{ mt: 1, mb: 1, fontSize: "inherit", color: "inherit", fontWeight: 600 }}>{children}</Typography>,
                        h3: ({ children }) => <Typography variant="subtitle2" sx={{ mt: 1, mb: 1, fontSize: "inherit", color: "inherit" }}>{children}</Typography>,
                        ul: ({ children }) => <Box component="ul" sx={{ pl: 2, m: 0 }}>{children}</Box>,
                        ol: ({ children }) => <Box component="ol" sx={{ pl: 2, m: 0 }}>{children}</Box>,
                        li: ({ children }) => <Typography component="li" sx={{ fontSize: "inherit", color: "inherit", display: "list-item" }}>{children}</Typography>,
                        code: ({ children }) => <Box component="code" sx={{ fontFamily: "monospace", fontSize: "0.8em", bgcolor: "action.selected", px: 0.5, borderRadius: 0.5 }}>{children}</Box>,
                        pre: ({ children }) => <Box sx={{ bgcolor: "#1d1d1d", p: 1.5, borderRadius: 1, overflow: "auto", my: 1, fontSize: "0.8em", fontFamily: "monospace" }}>{children}</Box>,
                        strong: ({ children }) => <Typography component="span" sx={{ fontWeight: 600, fontSize: "inherit", color: "inherit" }}>{children}</Typography>,
                        em: ({ children }) => <Typography component="span" sx={{ fontStyle: "italic", fontSize: "inherit", color: "inherit" }}>{children}</Typography>,
                        hr: () => <Divider sx={{ my: 1, borderColor: "inherit" }} />,
                        blockquote: ({ children }) => <Box sx={{ borderLeft: "3px solid", borderColor: "divider", pl: 1.5, my: 1 }}>{children}</Box>,
                      }}
                    >
                      {displayText}
                    </ReactMarkdown>
                  ) : (
                    <Typography sx={{ whiteSpace: "pre-wrap" }}>{displayText}</Typography>
                  )}
                </Box>
              </Stack>
            );
          })
        )}
      </Box>

      {/* Single Apply Button - appears only when latest model message has a suggestion */}
      {hasSuggestion() && (
        <Button
          size="small"
          variant="contained"
          onClick={handleApplyLastSuggestion}
          sx={{ mb: 1, alignSelf: "flex-start" }}
        >
          Apply latest suggestion to description
        </Button>
      )}

      <Divider sx={{ my: 1, borderColor: "divider" }} />

      {/* Input Controls */}
      <form onSubmit={handleSendMessage}>
        <Stack direction="row" spacing={1}>
          <TextField
            fullWidth
            size="small"
            placeholder="Ask for help with this work item..."
            value={inputMessage}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setInputMessage(e.target.value)}
            disabled={isLoading}
            InputProps={{
              sx: { fontSize: "0.875rem" },
            }}
          />
          <Button type="submit" variant="contained" disabled={isLoading || !inputMessage.trim()}>
            {isLoading ? <CircularProgress size={20} color="inherit" /> : "Send"}
          </Button>
        </Stack>
      </form>
    </Paper>
  );
}
