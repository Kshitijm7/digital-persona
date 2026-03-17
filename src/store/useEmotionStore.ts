import { create } from "zustand";
import Sentiment from "sentiment";
import emotionTuning from "@/config/emotion-tuning.json";

// Stateless utility — instantiated once at module level, not in Zustand state.
const sentimentAnalyzer = new Sentiment();

const TEXT_BUFFER_MAX_LEN  = 150;
const MIN_SENTIMENT_WORDS  = 2;
const DECAY_FLOOR          = 0.05;

// How long (ms) after the last text chunk before the score begins auto-decaying.
// Prevents the emotion layer staying at peak intensity indefinitely after the
// AI finishes speaking.
const AUTO_DECAY_IDLE_MS = 4000;

interface EmotionStore {
  currentScore: number;
  textBuffer: string;
  /**
   * Timestamp (performance.now()) of the last analyzeText call.
   * Used by startAutoDecay to determine when to begin decaying.
   */
  lastAnalyzedAt: number;

  analyzeText: (text: string) => void;
  decayScore: () => void;
  clearBuffer: () => void;

  /**
   * Start the auto-decay interval. Call once on app mount.
   * Returns a cleanup function — call it on unmount.
   * This keeps decay logic inside the store rather than requiring every
   * consumer to manually wire a useEffect.
   */
  startAutoDecay: () => () => void;
}

export const useEmotionStore = create<EmotionStore>((set, get) => ({
  currentScore:   0,
  textBuffer:     "",
  lastAnalyzedAt: 0,

  analyzeText: (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    set((state) => {
      const newBuffer = (state.textBuffer + " " + trimmed).slice(
        -TEXT_BUFFER_MAX_LEN
      );
      const result = sentimentAnalyzer.analyze(newBuffer);

      if (result.words.length < MIN_SENTIMENT_WORDS) {
        return { textBuffer: newBuffer, lastAnalyzedAt: performance.now() };
      }

      const boosted = Math.max(
        -1,
        Math.min(
          1,
          result.comparative * emotionTuning.sentiment.boostMultiplier
        )
      );

      return {
        textBuffer:     newBuffer,
        currentScore:   boosted,
        lastAnalyzedAt: performance.now(),
      };
    });
  },

  decayScore: () => {
    set((state) => {
      if (state.currentScore === 0) return state;
      const next = state.currentScore * emotionTuning.sentiment.decayFactor;
      return { currentScore: Math.abs(next) < DECAY_FLOOR ? 0 : next };
    });
  },

  clearBuffer: () =>
    set({ textBuffer: "", currentScore: 0, lastAnalyzedAt: 0 }),

  startAutoDecay: () => {
    // Tick every 500 ms. Checks whether enough idle time has elapsed before
    // decaying — this means decay only starts after the AI has been silent
    // for AUTO_DECAY_IDLE_MS, not during active speech.
    const interval = setInterval(() => {
      const state = get();
      if (state.currentScore === 0) return;

      const idleMs = performance.now() - state.lastAnalyzedAt;
      if (idleMs < AUTO_DECAY_IDLE_MS) return;

      state.decayScore();
    }, 500);

    return () => clearInterval(interval);
  },
}));