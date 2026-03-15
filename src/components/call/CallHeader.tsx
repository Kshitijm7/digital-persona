"use client";

import { GlassPanel } from "@/components/shared/GlassPanel";
import { StatusDot } from "@/components/shared/StatusDot";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";
import type { GeminiStatus } from "@/hooks/useGeminiLive";


interface CallHeaderProps {
  status: GeminiStatus;
  sessionTime?: string;
}

export function CallHeader({ status, sessionTime }: CallHeaderProps) {
  const statusMap: Record<GeminiStatus, "online" | "connecting" | "offline" | "error"> = {
    connected: "online",
    connecting: "connecting",
    disconnected: "offline",
    error: "error",
  };

  const statusLabel: Record<GeminiStatus, string> = {
    connected: "Live",
    connecting: "Connecting...",
    disconnected: "Offline",
    error: "Error",
  };

  return (
    <header className="flex flex-col gap-2.5 sm:gap-3">
      <div className="flex items-center gap-2 sm:gap-3">
        <GlassPanel rounded="xl" className="flex items-center gap-2 bg-white/5 px-2.5 py-2.5 shadow-xl border-white/5 sm:gap-3 sm:px-3.5 sm:py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary shadow-[0_0_20px_rgba(var(--primary-rgb),0.3)] sm:h-9 sm:w-9">
            <Logo className="h-4 w-4 text-primary-foreground sm:h-5 sm:w-5" />
          </div>
          <div className="pr-1 sm:pr-2">
            <h1 className="text-[11px] font-bold tracking-wider text-foreground sm:text-[13px]">
              DIGITAL PERSONA
            </h1>
            <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-muted-foreground opacity-70 sm:text-[9px] sm:tracking-[0.2em]">
              Substrate v1.0
            </p>
          </div>
        </GlassPanel>
      </div>

      {/* Status Badges */}
      <div className="flex flex-wrap items-center gap-2 pl-1 sm:pl-2">
        <GlassPanel rounded="xl" className="flex items-center gap-2 bg-white/5 border-white/5 px-2.5 py-1.5 sm:gap-2.5 sm:px-3.5 sm:py-2">
          <StatusDot status={statusMap[status]} pulse={status === "connected"} />
          <span
            className={cn(
              "text-[9px] font-bold tracking-wide uppercase sm:text-[10px]",
              status === "connected"
                ? "text-emerald-500"
                : status === "connecting"
                ? "text-amber-500"
                : status === "error"
                ? "text-destructive"
                : "text-muted-foreground"
            )}
          >
            {statusLabel[status]}
          </span>
        </GlassPanel>

        {sessionTime && status === "connected" && (
          <GlassPanel rounded="xl" className="flex items-center gap-1.5 bg-white/5 border-white/5 px-2.5 py-1.5 sm:gap-2 sm:px-3.5 sm:py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
            <span className="mt-0.5 font-mono text-[9px] leading-none font-bold text-primary sm:text-[10px]">
              {sessionTime}
            </span>
          </GlassPanel>
        )}
      </div>
    </header>
  );
}
