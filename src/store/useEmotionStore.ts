import { create } from "zustand";
import Sentiment from "sentiment";
import emotionTuning from "@/config/emotion-tuning.json";

// Fix #4: instantiate the analyser once at module level — it is a stateless
// utility class and does not belong in Zustand's serialisable state tree.
const sentimentAnalyzer = new Sentiment();

/** Maximum rolling buffer length (characters). */
const TEXT_BUFFER_MAX_LEN = 150;

/**
 * Minimum number of sentiment-bearing words required in the buffer before
 * the score is updated.  Prevents single-word chunks from causing noisy
 * swings (Fix #5).
 */
const MIN_SENTIMENT_WORDS = 2;

/** Score magnitude below which we treat the value as effectively neutral. */
const DECAY_FLOOR = 0.05;

interface EmotionStore {
  currentScore: number;
  textBuffer: string;
  analyzeText: (text: string) => void;
  decayScore: () => void;
  clearBuffer: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const useEmotionStore = create<EmotionStore>((set, get) => ({
  currentScore: 0,
  textBuffer: "",

  // Fix #5, #7, #8: use a single atomic `set` call so rapid concurrent
  // invocations always operate on the latest committed state; only update
  // `currentScore` when enough sentiment-bearing words are present.
  analyzeText: (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    set((state) => {
      // Rolling buffer — keep the tail so recent context dominates
      const newBuffer = (state.textBuffer + " " + trimmed).slice(
        -TEXT_BUFFER_MAX_LEN
      );

      const result = sentimentAnalyzer.analyze(newBuffer);

      // Fix #8: only update score when there is enough signal
      if (result.words.length < MIN_SENTIMENT_WORDS) {
        return { textBuffer: newBuffer };
      }

      // Fix #5: clamp boosted score to [-1, 1]
      const boosted = Math.max(
        -1,
        Math.min(
          1,
          result.comparative * emotionTuning.sentiment.boostMultiplier
        )
      );

      return { textBuffer: newBuffer, currentScore: boosted };
    });
  },

  // Fix #6: decayScore is now wired — call this from a useEffect in the
  // component that consumes emotion state (e.g. on each turn-complete).
  decayScore: () => {
    set((state) => {
      if (state.currentScore === 0) return state;
      const next = state.currentScore * emotionTuning.sentiment.decayFactor;
      return { currentScore: Math.abs(next) < DECAY_FLOOR ? 0 : next };
    });
  },

  clearBuffer: () => set({ textBuffer: "", currentScore: 0 }),
}));