"use client";

import { cn } from "@/lib/utils";

interface VideoCallLayoutProps {
  children: React.ReactNode;
  chatPanel: React.ReactNode;
  isChatOpen: boolean;
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
  className,
}: VideoCallLayoutProps) {
  return (
    <div className={cn("relative flex h-dvh w-full overflow-hidden gap-2 bg-background p-2 sm:gap-4 sm:p-4", className)}>
      {/* Background effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-background via-background/95 to-background z-0 pointer-events-none" />
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none z-0 mix-blend-screen" />
      <div className="absolute top-[-20%] left-[-10%] h-[60%] w-[50%] rounded-full bg-cyan-500/10 blur-[120px] pointer-events-none z-0 mix-blend-screen" />
      <div className="absolute bottom-[-20%] right-[-10%] h-[60%] w-[50%] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none z-0 mix-blend-screen" />

      {/* Main content area (Video Card) */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col rounded-2xl border border-white/5 bg-black/40 shadow-2xl backdrop-blur-3xl sm:rounded-3xl overflow-hidden">
        {children}
      </div>

      {/* Chat panel */}
      <div
        className={cn(
          "absolute inset-y-2 left-2 right-2 z-30 flex min-h-0 flex-col transition-[transform,opacity,width] duration-400 ease-[cubic-bezier(0.32,0.72,0,1)] sm:inset-y-4 sm:left-4 sm:right-4 md:static md:inset-auto md:z-20 md:h-full md:max-w-[24rem] md:flex-none",
          isChatOpen
            ? "translate-x-0 opacity-100 pointer-events-auto md:w-[24rem]"
            : "pointer-events-none translate-x-[105%] opacity-0 md:w-0 md:translate-x-0 md:overflow-hidden md:opacity-0"
        )}
      >
        {chatPanel}
      </div>
    </div>
  );
}
