"use client";

import { useCallback, useState } from "react";
import { IconButton } from "@/components/shared/IconButton";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { cn } from "@/lib/utils";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Phone,
  MessageSquare,
  RefreshCw,
} from "lucide-react";

interface CallControlsProps {
  isConnected: boolean;
  isMicActive: boolean;
  isCameraActive: boolean;
  isChatOpen: boolean;
  onToggleConnection: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleChat: () => void;
  /** May be async — the button shows a pending state until it resolves. */
  onSwitchCamera: () => Promise<boolean> | void;
}

export function CallControls({
  isConnected,
  isMicActive,
  isCameraActive,
  isChatOpen,
  onToggleConnection,
  onToggleMic,
  onToggleCamera,
  onToggleChat,
  onSwitchCamera,
}: CallControlsProps) {
  // Fix #17: track in-flight camera switch so the button can't be tapped
  // multiple times while the OS is switching lenses.
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);

  const handleSwitchCamera = useCallback(async () => {
    if (isSwitchingCamera) return;
    setIsSwitchingCamera(true);
    try {
      await onSwitchCamera();
    } finally {
      setIsSwitchingCamera(false);
    }
  }, [isSwitchingCamera, onSwitchCamera]);

  return (
    // Fix #16: removed the competing `absolute bottom-3 left-1/2 -translate-x-1/2`
    // from the footer — positioning is now entirely owned by the parent in
    // page.tsx so this component is layout-agnostic and reusable.
    <div className="flex items-center gap-1.5 rounded-full border border-white/6 bg-white/5 px-2.5 py-2 backdrop-blur-2xl shadow-2xl sm:gap-2 sm:px-4 sm:py-2.5">
      {/* Chat toggle */}
      <IconButton
        icon={MessageSquare}
        label={isChatOpen ? "Close chat" : "Open chat"}
        active={isChatOpen}
        variant={isChatOpen ? "primary" : "ghost"}
        size="sm"
        onClick={onToggleChat}
        className="hover:bg-cyan-500/10 rounded-full"
      />

      <div className="mx-1 h-6 w-px bg-white/10" />

      {/* Microphone */}
      <IconButton
        icon={isMicActive ? Mic : MicOff}
        label={isMicActive ? "Mute microphone" : "Unmute microphone"}
        active={!isMicActive}
        variant={isMicActive ? "ghost" : "danger"}
        size="sm"
        onClick={onToggleMic}
        className="rounded-full"
      />

      {/* Camera */}
      <IconButton
        icon={isCameraActive ? Video : VideoOff}
        label={isCameraActive ? "Turn off camera" : "Turn on camera"}
        active={!isCameraActive}
        variant={isCameraActive ? "ghost" : "danger"}
        size="sm"
        onClick={onToggleCamera}
        className="rounded-full"
      />

      {/* Fix #17: flip camera — disabled while a switch is in progress.
          Fix #18: enabled regardless of isCameraActive so the user can
          pre-select the facing mode before enabling the camera. */}
      <IconButton
        icon={RefreshCw}
        label={isSwitchingCamera ? "Switching camera…" : "Flip camera"}
        variant="ghost"
        size="sm"
        onClick={handleSwitchCamera}
        disabled={isSwitchingCamera}
        className={cn(
          "rounded-full transition-transform",
          isSwitchingCamera && "animate-spin opacity-50",
          !isSwitchingCamera && "active:rotate-180"
        )}
      />

      {/* Connect / Disconnect */}
      <LiquidButton
        onClick={onToggleConnection}
        className={cn(
          "ml-1 flex h-9 w-9 items-center justify-center rounded-full border-0 shadow-xl transition-all duration-500 active:scale-90 sm:size-10",
          isConnected
            ? "bg-destructive hover:bg-destructive/90 shadow-destructive/20 text-destructive-foreground"
            : "bg-linear-to-r from-cyan-500 to-emerald-500 text-primary-foreground hover:shadow-[0_0_20px_rgba(34,211,238,0.3)] hover:scale-105"
        )}
        title={isConnected ? "End session" : "Start session"}
      >
        {isConnected ? (
          <PhoneOff className="h-4 w-4" />
        ) : (
          <Phone className="h-4 w-4" />
        )}
      </LiquidButton>
    </div>
  );
}