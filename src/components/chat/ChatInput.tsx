"use client";

import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { Send, Paperclip } from "lucide-react";
import { useState, useRef } from "react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = "Write your message...",
  className,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
    inputRef.current?.focus();
  };

  return (
    <div className={cn("flex items-center gap-1.5 sm:gap-2", className)}>
      <div className="flex flex-1 items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 backdrop-blur-2xl transition-all duration-300 focus-within:border-cyan-500/40 focus-within:ring-1 focus-within:ring-cyan-500/20 sm:px-3 sm:py-2">
        <button
          type="button"
          className="p-2 text-muted-foreground hover:text-white hover:bg-white/10 rounded-full transition-colors shrink-0 disabled:opacity-50"
          disabled={disabled}
          title="Attach file"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none disabled:opacity-50 px-2 min-w-0"
        />
      </div>
      <LiquidButton
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 bg-linear-to-r from-cyan-500 to-emerald-500 p-0 text-white hover:shadow-[0_0_15px_rgba(34,211,238,0.2)] sm:size-10"
      >
        <Send className="w-4 h-4" />
      </LiquidButton>
    </div>
  );
}

