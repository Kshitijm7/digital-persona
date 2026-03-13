import { create } from 'zustand';
import Sentiment from 'sentiment';
import emotionTuning from '@/config/emotion-tuning.json';

interface EmotionStore {
  sentimentAnalyzer: Sentiment;
  currentScore: number;
  textBuffer: string;
  analyzeText: (text: string) => void;
  decayScore: () => void;
  clearBuffer: () => void;
}

export const useEmotionStore = create<EmotionStore>((set, get) => ({
  sentimentAnalyzer: new Sentiment(),
  currentScore: 0,
  textBuffer: '',

  analyzeText: (text: string) => {
    if (!text.trim()) return;
    const { sentimentAnalyzer, textBuffer } = get();
    
    // Accumulate a rolling window of recent text to get better context
    // Keep roughly the last 150 characters for chunk-based analysis
    const newBuffer = (textBuffer + " " + text).slice(-150);
    set({ textBuffer: newBuffer });

    // Calculate sentiment score over the accumulated buffer
    const result = sentimentAnalyzer.analyze(newBuffer);

    // Only update if it found meaningful words
    if (result.words.length > 0) {
      // Clamp and boost the score using JSON config multiplier
      let boostedScore = result.comparative * emotionTuning.sentiment.boostMultiplier;
      boostedScore = Math.max(-1, Math.min(1, boostedScore));
      set({ currentScore: boostedScore });
    }
  },

  decayScore: () => {
    set((state) => {
      if (state.currentScore === 0) return state;
      const newScore = state.currentScore * emotionTuning.sentiment.decayFactor;
      if (Math.abs(newScore) < 0.05) {
        return { currentScore: 0 };
      }
      return { currentScore: newScore };
    });
  },

  clearBuffer: () => {
    set({ textBuffer: '', currentScore: 0 });
  }
}));
