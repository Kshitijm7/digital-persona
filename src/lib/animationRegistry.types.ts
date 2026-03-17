export type AnimationCategory = "idle" | "dance" | "expression" | "gesture" | "misc";

export interface AnimationMeta {
  name: string;
  url: string;
  type?: string;
  category?: AnimationCategory; // legacy

  /**
   * Optional per-animation crossfade duration in milliseconds.
   * When set, Avatar.tsx should use this instead of the global CROSSFADE_DURATION_MS.
   * Recommended ranges:
   *   - Sharp gestures (snap, point):   80–120 ms
   *   - Standard gestures (wave, nod):  150–200 ms
   *   - Slow transitions (dance, idle): 250–300 ms
   */
  crossfadeDurationMs?: number;

  // Semantic metadata for fuzzy matching
  primary_emotion?: string;
  valence?: "positive" | "negative" | "neutral";
  action?: string;
  base_posture?: "standing" | "sitting" | "walking" | "crouched";
  intensity?: number;
  description?: string;
  semantic_tags?: string[];
  exclusion_tags?: string[];
}

export type AnimationRegistry = Record<string, AnimationMeta>;