"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage, type ChatMessageData } from "./ChatMessage";
import { TypingIndicator } from "@/components/shared/TypingIndicator";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface ChatMessageListProps {
  messages: ChatMessageData[];
  isTyping?: boolean;
  className?: string;
}

export function ChatMessageList({
  messages,
  isTyping = false,
  className,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (!bottomRef.current) return;
    // Find the specific scrollable viewport created by ScrollArea
    const viewport = bottomRef.current.closest('[data-slot="scroll-area-viewport"]');
    if (viewport) {
      // Safely scroll only this container to avoid global UI sliding on mobile browsers
      // when the chat panel is translated off-screen
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    } else {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [messages.length, isTyping]);

  return (
    <ScrollArea className={cn("flex-1 min-h-0", className)}>
      <div className="space-y-3 px-3 py-3 sm:space-y-4 sm:px-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 sm:py-12">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted sm:h-12 sm:w-12">
              <span className="text-2xl">💬</span>
            </div>
            <p className="text-xs text-muted-foreground text-center font-mono leading-relaxed">
              Start a conversation with
              <br />
              your Digital Persona
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {isTyping && (
          <div className="pl-8 sm:pl-10">
            <TypingIndicator name="AI Persona" />
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
