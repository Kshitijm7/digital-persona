"use client";

import { cn } from "@/lib/utils";
import { MessageSquare } from "lucide-react";

interface VideoCallLayoutProps {
  children: React.ReactNode;
  chatPanel: React.ReactNode;
  isChatOpen: boolean;
  onOpenChat: () => void;
  onCloseChat: () => void;
  className?: string;
}

/**
 * Responsive layout: main content area (3D avatar) on left,
 * chat panel on right when open.
 */
export function VideoCallLayout({
  children,
  chatPanel,
  isChatOpen,
  onOpenChat,
  onCloseChat,
  className,
}: VideoCallLayoutProps) {
  return (
    <div 
      className={cn(
        "layout-root relative flex h-dvh w-full overflow-hidden p-2 sm:p-4 bg-background",
        !isChatOpen && "chat-collapsed",
        className
      )}
      onClick={(e) => {
        // Tapping the ::before backdrop (which resolves to the layout-root itself)
        if (e.target === e.currentTarget && isChatOpen) {
          onCloseChat();
        }
      }}
    >
      {/* Background effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-background via-background/95 to-background z-0 pointer-events-none" />
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none z-0 mix-blend-screen" />
      <div className="absolute top-[-20%] left-[-10%] h-[60%] w-[50%] rounded-full bg-cyan-500/10 blur-[120px] pointer-events-none z-0 mix-blend-screen" />
      <div className="absolute bottom-[-20%] right-[-10%] h-[60%] w-[50%] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none z-0 mix-blend-screen" />

      {/* Main content area (Video Card) */}
      <div className="video-panel relative z-10 flex flex-1 min-w-0 flex-col rounded-2xl border border-white/5 bg-black/40 shadow-2xl backdrop-blur-3xl sm:rounded-3xl overflow-hidden">
        {children}
        
        {/* Open Chat Button (visible only when collapsed) */}
        <button
          onClick={onOpenChat}
          aria-label="Open chat"
          aria-expanded={isChatOpen}
          className="chat-open-btn absolute top-1/2 -translate-y-1/2 right-4 z-50 rounded-full bg-white/10 p-3 text-white backdrop-blur-md transition-all duration-300 hover:bg-white/20 active:scale-95"
        >
          <MessageSquare className="h-5 w-5" />
        </button>
      </div>

      {/* Chat panel */}
      <div
        aria-hidden={!isChatOpen}
        inert={!isChatOpen ? true : undefined}
        className="chat-panel-container z-30 flex h-full flex-col"
      >
        {chatPanel}
      </div>
    </div>
  );
}
