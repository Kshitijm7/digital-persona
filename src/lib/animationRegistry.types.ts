export type AnimationCategory = "idle" | "dance" | "expression" | "gesture" | "misc";

export interface AnimationMeta {
  name: string;
  url: string;
  type?: string; 
  category?: AnimationCategory; // legacy
  
  // Semantic Metadata for Fuzzy Matching
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
