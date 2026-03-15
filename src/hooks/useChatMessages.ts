"use client";

import { useCallback, useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

function mergeStreamingText(existing: string, incoming: string): string {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (existing.endsWith(incoming)) return existing;

  const maxOverlap = Math.min(existing.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (existing.slice(-overlap) === incoming.slice(0, overlap)) {
      return existing + incoming.slice(overlap);
    }
  }

  return existing + incoming;
}

/**
 * Chat messages management hook
 * Handles message state and operations
 */
export function useChatMessages() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  const addUserMessage = useCallback((content: string) => {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, message]);
    setIsTyping(true);
    return message;
  }, []);

  const addAssistantMessage = useCallback((content: string) => {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, message]);
    setIsTyping(false);
    return message;
  }, []);

  const appendAssistantMessage = useCallback((content: string) => {
    if (!content) return;

    setMessages((prev) => {
      const lastMessage = prev[prev.length - 1];
      if (lastMessage && lastMessage.role === "assistant") {
        const merged = mergeStreamingText(lastMessage.content, content);
        if (merged === lastMessage.content) {
          return prev;
        }

        return [
          ...prev.slice(0, -1),
          { ...lastMessage, content: merged },
        ];
      } else {
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content,
            timestamp: new Date(),
          },
        ];
      }
    });
    setIsTyping(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setIsTyping(false);
  }, []);

  return {
    messages,
    isTyping,
    addUserMessage,
    addAssistantMessage,
    appendAssistantMessage,
    clearMessages,
    setIsTyping,
  };
}
