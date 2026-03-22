// File: src/components/chat/ChatMessage.tsx

"use client";

import { cn } from "@/lib/utils";
import { Bot, User } from "lucide-react";
import React from "react";

import type { ChatMessage as ChatMessageData } from "@/hooks/useChatMessages";

export type { ChatMessageData };

interface ChatMessageProps {
  message: ChatMessageData;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Individual chat message bubble.
 *
 * React.memo comparison: re-renders only when the message reference changes.
 * Since pending messages get new object references on each content update
 * (immutable state), this will correctly re-render as chunks arrive, and
 * stop re-rendering once finalized.
 */
export const ChatMessage = React.memo(function ChatMessage({
  message,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const isPending = Boolean(message.pending);

  return (
    <div
      className={cn(
        "flex gap-2.5 max-w-full",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full sm:h-8 sm:w-8",
          isUser
            ? "bg-secondary/10 border border-secondary/10"
            : "bg-primary/10 border border-primary/10"
        )}
      >
        {isUser ? (
          <User className="h-3.5 w-3.5 text-emerald-400 sm:h-4 sm:w-4" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-primary sm:h-4 sm:w-4" />
        )}
      </div>

      {/* Bubble */}
      <div className="flex max-w-[85%] flex-col gap-1.5 sm:max-w-[80%]">
        <div
          className={cn(
            "wrap-break-word rounded-2xl px-3 py-2.5 text-sm leading-relaxed shadow-sm sm:px-4 sm:py-3 transition-opacity duration-300",
            isUser
              ? "bg-primary text-primary-foreground border-primary/20 rounded-tr-sm"
              : "bg-muted/50 text-foreground border border-white/5 backdrop-blur-sm rounded-tl-sm",
            isPending && "opacity-60"
          )}
        >
          {message.content}
          {isPending && (
            <span
              className="inline-block ml-1 w-1.5 h-3.5 bg-current animate-pulse rounded-sm align-text-bottom"
              aria-label="Transcribing…"
            />
          )}
        </div>

        {/* Timestamp — only show for finalized messages */}
        {!isPending && (
          <span
            className={cn(
              "text-[10px] text-muted-foreground font-medium opacity-60",
              isUser ? "text-right" : "text-left"
            )}
          >
            {formatTime(message.timestamp)}
          </span>
        )}

        {/* Pending indicator replaces timestamp while assembling */}
        {isPending && (
          <span
            className={cn(
              "text-[10px] text-muted-foreground font-medium opacity-40 italic",
              isUser ? "text-right" : "text-left"
            )}
          >
            listening…
          </span>
        )}
      </div>
    </div>
  );
});