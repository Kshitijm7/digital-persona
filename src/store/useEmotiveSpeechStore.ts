import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EmotiveSpeechMode } from "@/lib/emotive-speech-config";
import { EMOTIVE_SPEECH_MODES, DEFAULT_MODE } from "@/lib/emotive-speech-config";

interface EmotiveSpeechStore {
  mode: EmotiveSpeechMode;
  setMode: (mode: EmotiveSpeechMode) => void;
}

export const useEmotiveSpeechStore = create<EmotiveSpeechStore>()(
  persist(
    (set) => ({
      mode: DEFAULT_MODE,
      setMode: (mode) => {
        if (EMOTIVE_SPEECH_MODES.includes(mode)) {
          set({ mode });
        }
      },
    }),
    {
      name: "emotive-speech-mode",
    },
  ),
);
