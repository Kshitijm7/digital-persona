import { AnimationRegistry, AnimationMeta } from "./animationRegistry.types";

const DEFAULT_MIN_SIMILARITY_SCORE = 0.25;

const INTENT_ALIASES: Record<string, string[]> = {
        happy: ["joy", "smile", "cheerful", "glad", "rejoice", "laugh"],
        sad: ["depressed", "unhappy", "frown", "cry", "upset", "sorrow"],
        wave: ["greet", "hello", "hi", "welcome", "gesture"],
        dance: ["groove", "move", "swing", "celebrate", "rhythmic", "sway", "bouncy", "spirited", "club"],
        angry: ["mad", "furious", "annoyed", "grumpy"],
        focus: ["listen", "attentive", "concentrate", "professional", "calm"],
        nod: ["agree", "affirm", "yes", "understand"],
        shake: ["disagree", "no", "deny", "awkward"],
        expression: ["react", "face", "emote", "talking", "variation"],
};

const ACTION_CANONICALS = new Set([
        "wave",
        "dance",
        "nod",
        "shake",
        "greet",
        "gesture",
        "move",
        "celebrate",
]);

const registryVectorCache = new WeakMap<AnimationRegistry, Map<string, Map<string, number>>>();

type AnimationMatcherOptions = {
    minScore?: number;
    disallowTypes?: string[];
    allowCategoryFallback?: boolean;
    contextTexts?: string[];
    sentimentScore?: number;
};

/**
 * Basic Porter-style suffix stripping for robust matching (e.g., 'dancing' -> 'danc')
 */
function simpleStem(word: string): string {
    const w = word.toLowerCase();
    if (w.length <= 3) return w;
    if (w.endsWith('ing')) return w.slice(0, -3);
    if (w.endsWith('ed')) return w.slice(0, -2);
    if (w.endsWith('es')) return w.slice(0, -2);
    if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
}

/**
 * Levenshtein distance for string typo correction
 */
function levenshteinSimilarity(s: string, t: string): number {
    if (!s.length) return t.length === 0 ? 1 : 0;
    if (!t.length) return 0;
    
    const matrix = [];
    for (let i = 0; i <= t.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= s.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= t.length; i++) {
        for (let j = 1; j <= s.length; j++) {
            if (t.charAt(i - 1) === s.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    
    const maxLen = Math.max(s.length, t.length);
    const distance = matrix[t.length][s.length];
    return 1 - (distance / maxLen);
}

/**
 * Normalizes text for consistent matching by lowercasing and splitting into core words.
 */
function normalizeText(text: string): string[] {
  if (!text) return [];
  const normalized = text.toLowerCase().replace(/[^\w\s-]/g, ' ');
  return normalized.split(/[\s-]+/).filter(t => t.length > 2 && t !== 'the' && t !== 'and' && t !== 'with');
}

function expandTokens(tokens: string[]): string[] {
    if (!tokens.length) return tokens;
    const expanded = new Set<string>(tokens);

    for (const token of tokens) {
        for (const [canonical, aliases] of Object.entries(INTENT_ALIASES)) {
            if (token === canonical || aliases.includes(token)) {
                expanded.add(canonical);
                for (const alias of aliases) {
                    expanded.add(alias);
                }
            }
        }
    }

    return Array.from(expanded);
}

function tokenizeWithAliases(text: string): string[] {
    return expandTokens(normalizeText(text));
}

function upsertVectorWeight(vector: Map<string, number>, token: string, weight: number): void {
    vector.set(token, (vector.get(token) ?? 0) + weight);
}

function buildWeightedVector(tokens: string[], boostActions = false): Map<string, number> {
    const vector = new Map<string, number>();

    for (const token of tokens) {
        const tokenWeight = token.length >= 7 ? 1.8 : token.length >= 5 ? 1.4 : 1.1;
        const actionWeight = boostActions && ACTION_CANONICALS.has(token) ? 2.5 : 1;
        upsertVectorWeight(vector, token, tokenWeight * actionWeight);
    }

    return vector;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
    if (!a.size || !b.size) return 0;

    let dot = 0;
    let magA = 0;
    let magB = 0;

    for (const [, value] of a) {
        magA += value * value;
    }
    for (const [, value] of b) {
        magB += value * value;
    }

    const smaller = a.size <= b.size ? a : b;
    const larger = a.size <= b.size ? b : a;
    for (const [token, value] of smaller) {
        const bValue = larger.get(token);
        if (bValue !== undefined) {
            dot += value * bValue;
        }
    }

    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function getOrCreateAnimationVector(
    registry: AnimationRegistry,
    key: string,
    anim: AnimationMeta,
): Map<string, number> {
    let cache = registryVectorCache.get(registry);
    if (!cache) {
        cache = new Map<string, Map<string, number>>();
        registryVectorCache.set(registry, cache);
    }

    const existing = cache.get(key);
    if (existing) {
        return existing;
    }

    const nameTokens = tokenizeWithAliases(anim.name || "");
    const emotionTokens = tokenizeWithAliases(anim.primary_emotion || "");
    const actionTokens = tokenizeWithAliases(anim.action || "");
    const tagTokens = (anim.semantic_tags || []).flatMap((t) => tokenizeWithAliases(t));
    const descTokens = tokenizeWithAliases(anim.description || "");

    const vector = new Map<string, number>();

    for (const [tokens, multiplier, boostActions] of [
        [nameTokens, 1.3, false],
        [emotionTokens, 1.15, false],
        [actionTokens, 1.9, true],
        [tagTokens, 1.6, true],
        [descTokens, 1.1, false],
    ] as const) {
        const weighted = buildWeightedVector(tokens, boostActions);
        for (const [token, weight] of weighted) {
            upsertVectorWeight(vector, token, weight * multiplier);
        }
    }

    cache.set(key, vector);
    return vector;
}

/**
 * True if tokens match literally, by stem, or by >80% Levenshtein similarity (typos)
 */
function isHybridMatch(t1: string, t2: string): boolean {
    if (t1 === t2) return true;
    if (simpleStem(t1) === simpleStem(t2)) return true;
    if (levenshteinSimilarity(t1, t2) >= 0.8) return true;
    return false;
}

/**
 * Calculates weighted Jaccard similarity between two arrays of tokens using Hybrid Matches.
 */
function weightedHybridJaccardSimilarity(tokens1: string[], tokens2: string[]): number {
  if (!tokens1.length || !tokens2.length) return 0.0;
  
  // Give heavier weight to longer, more specific descriptive words
  const weight = (t: string) => t.length >= 5 ? 2.0 : t.length >= 3 ? 1.5 : 1.0;

  let intersectionWeight = 0;
  let unionWeight = 0;

  // Use a string set for union to avoid massive duplication
  const unionSet = new Set([...tokens1, ...tokens2]);
  const union = Array.from(unionSet);
  
  union.forEach(t => {
    const w = weight(t);
    unionWeight += w;
    
    const hasInT1 = tokens1.some(t1 => isHybridMatch(t, t1));
    const hasInT2 = tokens2.some(t2 => isHybridMatch(t, t2));
    
    if (hasInT1 && hasInT2) {
      intersectionWeight += w;
    }
  });

  return unionWeight === 0 ? 0 : intersectionWeight / unionWeight;
}

/**
 * Quick pre-filter: do items share any salient words (checking hybrid stems)?
 */
function hasSalientOverlap(tokens1: string[], tokens2: string[]): boolean {
  const salient1 = tokens1.filter(t => t.length >= 3);
  const salient2 = tokens2.filter(t => t.length >= 3);
  return salient1.some(t1 => salient2.some(t2 => isHybridMatch(t1, t2)));
}

/**
 * Calculates the multi-factor similarity score between an LLM's requested string and an animation profile.
 */
function calculateSimilarity(
        intentTokens: string[],
        intentVector: Map<string, number>,
        anim: AnimationMeta,
        animVector: Map<string, number>,
        sentimentScore: number,
): number {
  if (!anim) return 0;

    const exclusionTokens = (anim.exclusion_tags || []).flatMap((tag) => tokenizeWithAliases(tag));
    if (exclusionTokens.length > 0 && exclusionTokens.some((tag) => intentTokens.some((t) => isHybridMatch(t, tag)))) {
        return 0;
    }
  
  // Extract all searchable text from the animation metadata
    const nameTokens = tokenizeWithAliases(anim.name || "");
    const emotionTokens = tokenizeWithAliases(anim.primary_emotion || "");
    const actionTokens = tokenizeWithAliases(anim.action || "");
    const tagTokens = (anim.semantic_tags || []).flatMap(t => tokenizeWithAliases(t));
    const descTokens = tokenizeWithAliases(anim.description || "");
  
  // Combine all animation tokens into a single heavily-weighted semantic profile
  const semanticProfile = [
      ...emotionTokens, 
      ...actionTokens, 
      ...tagTokens,
      ...descTokens
  ];
  
  // 1. Salient Overlap Filter - if there are absolutely no shared words, don't bother scoring deeply
  if (!hasSalientOverlap(intentTokens, [...nameTokens, ...semanticProfile])) {
    return 0;
  }

  // 2. Multi-Factor Scoring Weightings
  // Giving massive priority to semantic tags and primary actions
    const nameSim = weightedHybridJaccardSimilarity(intentTokens, nameTokens);
    const tagsSim = weightedHybridJaccardSimilarity(intentTokens, tagTokens);
    const emotionSim = weightedHybridJaccardSimilarity(intentTokens, emotionTokens);
    const actionSim = weightedHybridJaccardSimilarity(intentTokens, actionTokens);
    const semanticVectorSim = cosineSimilarity(intentVector, animVector);

    let sentimentAlignment = 0;
    if (typeof sentimentScore === "number" && Math.abs(sentimentScore) >= 0.12) {
        if (anim.valence === "positive" && sentimentScore > 0) sentimentAlignment = 0.08;
        else if (anim.valence === "negative" && sentimentScore < 0) sentimentAlignment = 0.08;
        else if (anim.valence && anim.valence !== "neutral") sentimentAlignment = -0.08;
    }
  
  // 3. Final Weighted Score
    const lexicalScore = (nameSim * 0.2) + (tagsSim * 0.35) + (emotionSim * 0.15) + (actionSim * 0.3);
    const blended = (semanticVectorSim * 0.55) + (lexicalScore * 0.45) + sentimentAlignment;
    return Math.max(0, Math.min(1, blended));
}

/**
 * Finds the best matching animation file key for a given semantic intent from the LLM.
 */
export function findBestAnimationMatch(
    intent: string,
    registry: AnimationRegistry,
    options?: AnimationMatcherOptions,
): string {
    const keys = Object.keys(registry);
    if (!keys.length) return "idle";

    const minScore = options?.minScore ?? DEFAULT_MIN_SIMILARITY_SCORE;
    const disallowTypes = new Set((options?.disallowTypes ?? []).map((t) => t.toLowerCase()));
    const allowCategoryFallback = options?.allowCategoryFallback ?? false;
    const sentimentScore = options?.sentimentScore ?? 0;
    
    const cleanIntent = intent.trim().toLowerCase();
    
    // 1. Direct key match (O(1)) - Fast path
    if (registry[cleanIntent]) {
        const directType = registry[cleanIntent]?.type?.toLowerCase();
        if (directType && disallowTypes.has(directType)) {
            console.log(
                `[FuzzyMatcher] Exact match '${cleanIntent}' blocked by disallowTypes; returning idle.`,
            );
            return "idle";
        }
        console.log(`[FuzzyMatcher] Exact match found for '${intent}'`);
        return cleanIntent;
    }
    
    // Normalize intent for fuzzy matching
    const contextTokens = (options?.contextTexts ?? []).flatMap((text) => tokenizeWithAliases(text || ""));
    const intentTokens = expandTokens([...normalizeText(intent), ...contextTokens]);
    if (intentTokens.length === 0) return "idle";
    const intentVector = buildWeightedVector(intentTokens, true);
    
    // Setup Tracking Variables
    let bestMatchKey = "idle";
    let highestScore = 0;
    const fallbackCategoryMatches: string[] = []; 
    
    const isDanceIntent = intentTokens.some(t => isHybridMatch(t, 'dance'));
    const isExpressionIntent = intentTokens.some(t => isHybridMatch(t, 'talk') || isHybridMatch(t, 'expression'));
    
    // 2 & 3. Iterate through registry and score
    for (const key of keys) {
        const anim = registry[key];
        const animType = anim.type?.toLowerCase();

        if (animType && disallowTypes.has(animType)) {
            continue;
        }
        
        if (anim.type) {
             if (isDanceIntent && anim.type === 'dance') fallbackCategoryMatches.push(key);
             if (isExpressionIntent && anim.type === 'expression') fallbackCategoryMatches.push(key);
        }
        
        const animVector = getOrCreateAnimationVector(registry, key, anim);
        const score = calculateSimilarity(intentTokens, intentVector, anim, animVector, sentimentScore);
        
        if (score > highestScore) {
            highestScore = score;
            bestMatchKey = key;
        }
    }
    
    console.log(
        `[FuzzyMatcher] Intent '${intent}' highest matched score: ${highestScore.toFixed(3)} -> ${bestMatchKey} (threshold=${minScore.toFixed(3)})`,
    );

    if (highestScore < minScore) {
        console.log(
            `[FuzzyMatcher] Best score ${highestScore.toFixed(3)} below threshold ${minScore.toFixed(3)} for '${intent}'. Returning idle.`,
        );
        return "idle";
    }

    if (highestScore === 0) {
        if (allowCategoryFallback && fallbackCategoryMatches.length > 0) {
            const randomPick = fallbackCategoryMatches[Math.floor(Math.random() * fallbackCategoryMatches.length)];
            console.log(`[FuzzyMatcher] No semantic matches for '${intent}'. Falling back to random category match: ${randomPick}`);
            return randomPick;
        }
        return "idle"; 
    }
    
    return bestMatchKey;
}
