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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.focus();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  return (
    <div className={cn("flex w-full items-end gap-1.5 sm:gap-2", className)}>
      <div className="flex flex-1 w-full min-w-0 items-end rounded-3xl border border-white/10 bg-white/5 px-2.5 py-1.5 backdrop-blur-2xl transition-all duration-300 focus-within:border-cyan-500/40 focus-within:ring-1 focus-within:ring-cyan-500/20 sm:px-3 sm:py-2">
        <button
          type="button"
          className="p-2 text-muted-foreground hover:text-white hover:bg-white/10 rounded-full transition-colors shrink-0 disabled:opacity-50 mb-0.5 sm:mb-1"
          disabled={disabled}
          title="Attach file"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <textarea
          ref={inputRef}
          value={value}
          onChange={handleInput}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none disabled:opacity-50 px-2 min-w-0 resize-none py-1.5 sm:py-2 leading-relaxed"
          style={{ minHeight: "36px", maxHeight: "120px" }}
        />
      </div>
      <LiquidButton
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 bg-linear-to-r from-cyan-500 to-emerald-500 p-0 text-white hover:shadow-[0_0_15px_rgba(34,211,238,0.2)] mb-0.5 sm:mb-1"
      >
        <Send className="w-5 h-5 ml-0.5" />
      </LiquidButton>
    </div>
  );
}

