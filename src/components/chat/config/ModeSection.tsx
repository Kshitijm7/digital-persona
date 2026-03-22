"use client";

import { Section, Group } from "./ui-components";
import { useEmotiveSpeechStore } from "@/store/useEmotiveSpeechStore";
import { EMOTIVE_SPEECH_MODES, type EmotiveSpeechMode } from "@/lib/emotive-speech-config";
import { cn } from "@/lib/utils";

export function ModeSection() {
  const mode = useEmotiveSpeechStore((s) => s.mode);
  const setMode = useEmotiveSpeechStore((s) => s.setMode);

  const modeDescriptions: Record<EmotiveSpeechMode, string> = {
    intimate: "Casual, softer voice tone, smaller facial expressions. Best for 1:1 chatting.",
    broadcast: "Focus, clear articulation, moderate expressions. Best for standard answers.",
    energetic: "Presentation, passionate, wider expression range. Best for storytelling."
  };

  return (
    <Section title="Persona Mode" accent="#a855f7" defaultOpen={true}>
      <Group title="Active Mode">
        <div className="flex flex-col gap-2">
          {EMOTIVE_SPEECH_MODES.map((m) => {
            const isActive = m === mode;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "flex flex-col items-start gap-1.5 p-3 rounded-lg border transition-all text-left",
                  isActive
                    ? "bg-purple-500/20 border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.15)]"
                    : "bg-white/5 border-white/10 hover:bg-white/10"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-[11px] font-bold uppercase tracking-wider",
                    isActive ? "text-purple-400" : "text-muted-foreground/80"
                  )}>
                    {m}
                  </span>
                  {isActive && (
                    <span className="flex h-1.5 w-1.5 rounded-full bg-purple-500 animate-pulse" />
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground/60 leading-relaxed">
                  {modeDescriptions[m]}
                </span>
              </button>
            );
          })}
        </div>
      </Group>
    </Section>
  );
}
