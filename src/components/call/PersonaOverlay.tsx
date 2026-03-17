"use client";

import { GlassPanel } from "@/components/shared/GlassPanel";
import { AudioWaveform } from "./AudioWaveform";
import React from "react";

interface PersonaOverlayProps {
  audioLevelRef: React.RefObject<number>;
  isConnected: boolean;
}

/** Speaking threshold for audio level */
const SPEAKING_THRESHOLD = 0.05;

export const PersonaOverlay = React.memo(function PersonaOverlay({
  audioLevelRef,
  isConnected,
}: PersonaOverlayProps) {
  if (!isConnected) return null;

  return (
    <div className="absolute bottom-6 left-6 z-10">
      <GlassPanel rounded="xl" className="px-4 py-2.5">
        <div className="flex items-center gap-3">
          <AudioWaveform
            audioLevelRef={audioLevelRef}
            isActive={isConnected}
          />
          <div>
            <p className="text-sm font-medium text-foreground">AI Persona</p>
            <SpeakingStatus audioLevelRef={audioLevelRef} />
          </div>
        </div>
      </GlassPanel>
    </div>
  );
});

/** Small component that reads audio level via rAF for speaking status */
function SpeakingStatus({ audioLevelRef }: { audioLevelRef: React.RefObject<number> }) {
  const textRef = React.useRef<HTMLParagraphElement>(null);

  React.useEffect(() => {
    let raf: number;
    const TARGET_FPS_ACTIVE = 60;
    const TARGET_FPS_IDLE = 15;
    const MS_PER_FRAME_ACTIVE = 1000 / TARGET_FPS_ACTIVE;
    const MS_PER_FRAME_IDLE = 1000 / TARGET_FPS_IDLE;
    
    let lastFrameTime = 0;

    const update = (timestamp: number) => {
      const level = audioLevelRef.current ?? 0;
      const isIdle = level < 0.01;
      const targetInterval = isIdle ? MS_PER_FRAME_IDLE : MS_PER_FRAME_ACTIVE;

      if (timestamp - lastFrameTime >= targetInterval) {
        lastFrameTime = timestamp;
        if (textRef.current) {
          textRef.current.textContent = level > SPEAKING_THRESHOLD ? "Speaking" : "Listening";
        }
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [audioLevelRef]);

  return (
    <p
      ref={textRef}
      className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest"
    >
      Listening
    </p>
  );
}
