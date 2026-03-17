import { AnimationRegistry, AnimationMeta } from "./animationRegistry.types";
import { createLogger } from "./logging/logger";

const log = createLogger("animationMatcher");

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
  inquisitive: ["tilt", "curious", "question", "wondering", "thinking", "head_tilt"],
  tilt: ["inquisitive", "curious", "lean", "head_tilt", "question"],
  explain: ["explain_hands", "hands", "gesture", "talking"],
  shrug: ["unsure", "dunno", "uncertain", "shoulders"],
  point: ["point_forward", "forward", "indicate", "direct"],
  shake_head: ["shake", "no", "disagree", "deny"],
};

// Fix #13: include short alias tokens that were previously filtered out by
// the `t.length > 2` guard in `normalizeText`.
const SHORT_ALIAS_WHITELIST = new Set(["hi", "no", "yes"]);

const ACTION_CANONICALS = new Set([
  "wave", "dance", "nod", "shake", "greet",
  "gesture", "move", "celebrate",
]);

// Fix #11: cache keyed on registry identity (WeakMap) AND a stable per-key
// string so that a new registry object (e.g. after a refetch) rebuilds only
// what changed, not the entire cache.
const registryVectorCache = new WeakMap<
  AnimationRegistry,
  Map<string, Map<string, number>>
>();

// Fix #15: separate cache for pre-tokenized animation fields so
// `calculateSimilarity` can reuse them without re-tokenizing.
interface AnimationTokenCache {
  nameTokens: string[];
  emotionTokens: string[];
  actionTokens: string[];
  tagTokens: string[];
  descTokens: string[];
  exclusionTokens: string[];
}
const animationTokenCache = new WeakMap<
  AnimationRegistry,
  Map<string, AnimationTokenCache>
>();

export type AnimationMatcherOptions = {
  minScore?: number;
  disallowTypes?: string[];
  allowCategoryFallback?: boolean;
  contextTexts?: string[];
  sentimentScore?: number;
};

// ─── Text utilities ───────────────────────────────────────────────────────────

function simpleStem(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 3) return w;
  if (w.endsWith("ing")) return w.slice(0, -3);
  if (w.endsWith("ed")) return w.slice(0, -2);
  if (w.endsWith("es")) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/**
 * Fix #9: O(n) space, O(n×m) time Levenshtein using two alternating rows
 * instead of a full matrix — allocates 2×max(n,m) instead of n×m.
 */
function levenshteinSimilarity(s: string, t: string): number {
  if (s === t) return 1;
  if (!s.length) return t.length === 0 ? 1 : 0;
  if (!t.length) return 0;

  const sLen = s.length;
  const tLen = t.length;

  let prev = Array.from({ length: sLen + 1 }, (_, i) => i);
  let curr = new Array<number>(sLen + 1);

  for (let i = 1; i <= tLen; i++) {
    curr[0] = i;
    for (let j = 1; j <= sLen; j++) {
      const cost = t[i - 1] === s[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return 1 - prev[sLen] / Math.max(sLen, tLen);
}

/**
 * Fix #13: allow short tokens that appear in the alias whitelist through
 * the length filter.
 */
function normalizeText(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(
      (t) =>
        (t.length > 2 || SHORT_ALIAS_WHITELIST.has(t)) &&
        t !== "the" &&
        t !== "and" &&
        t !== "with"
    );
}

function expandTokens(tokens: string[]): string[] {
  if (!tokens.length) return tokens;
  const expanded = new Set<string>(tokens);
  for (const token of tokens) {
    for (const [canonical, aliases] of Object.entries(INTENT_ALIASES)) {
      if (token === canonical || aliases.includes(token)) {
        expanded.add(canonical);
        for (const alias of aliases) expanded.add(alias);
      }
    }
  }
  return Array.from(expanded);
}

function tokenizeWithAliases(text: string): string[] {
  return expandTokens(normalizeText(text));
}

function upsertVectorWeight(
  vector: Map<string, number>,
  token: string,
  weight: number
): void {
  vector.set(token, (vector.get(token) ?? 0) + weight);
}

function buildWeightedVector(
  tokens: string[],
  boostActions = false
): Map<string, number> {
  const vector = new Map<string, number>();
  for (const token of tokens) {
    const tokenWeight =
      token.length >= 7 ? 1.8 : token.length >= 5 ? 1.4 : 1.1;
    const actionWeight =
      boostActions && ACTION_CANONICALS.has(token) ? 2.5 : 1;
    upsertVectorWeight(vector, token, tokenWeight * actionWeight);
  }
  return vector;
}

function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>
): number {
  if (!a.size || !b.size) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const v of a.values()) magA += v * v;
  for (const v of b.values()) magB += v * v;
  if (magA === 0 || magB === 0) return 0;

  // Iterate over the smaller map for the dot product (keeps this O(min(a,b)))
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const [token, value] of smaller) {
    const other = larger.get(token);
    if (other !== undefined) dot += value * other;
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function isHybridMatch(t1: string, t2: string): boolean {
  if (t1 === t2) return true;
  if (simpleStem(t1) === simpleStem(t2)) return true;
  if (levenshteinSimilarity(t1, t2) >= 0.8) return true;
  return false;
}

/**
 * Fix #10: avoid re-building the union array with `Array.from(new Set(...))`.
 * Instead iterate each set once and compute intersection weight by checking
 * membership in the other — O(n + m) instead of O(n × m × k).
 */
function weightedHybridJaccardSimilarity(
  tokens1: string[],
  tokens2: string[]
): number {
  if (!tokens1.length || !tokens2.length) return 0;

  const weight = (t: string) =>
    t.length >= 5 ? 2.0 : t.length >= 3 ? 1.5 : 1.0;

  // Build a map of stemmed → original for tokens2 to avoid O(n) `.some()`
  const stems2 = new Map<string, string>();
  for (const t of tokens2) stems2.set(simpleStem(t), t);

  let intersectionWeight = 0;
  let unionWeight = 0;

  // Contribution from tokens1
  const matchedInT2 = new Set<string>();
  for (const t1 of tokens1) {
    const w = weight(t1);
    unionWeight += w;
    const stem1 = simpleStem(t1);
    // Check exact, stem, or Levenshtein match against tokens2
    for (const [stem2, orig2] of stems2) {
      if (
        t1 === orig2 ||
        stem1 === stem2 ||
        levenshteinSimilarity(t1, orig2) >= 0.8
      ) {
        intersectionWeight += w;
        matchedInT2.add(orig2);
        break;
      }
    }
  }

  // Contribution from unmatched tokens2
  for (const t2 of tokens2) {
    if (!matchedInT2.has(t2)) {
      unionWeight += weight(t2);
    }
  }

  return unionWeight === 0 ? 0 : intersectionWeight / unionWeight;
}

function hasSalientOverlap(tokens1: string[], tokens2: string[]): boolean {
  const salient1 = tokens1.filter((t) => t.length >= 3);
  const salient2 = tokens2.filter((t) => t.length >= 3);
  // Build a stem set for tokens2 to keep this O(n + m)
  const stems2 = new Set(salient2.map(simpleStem));
  return salient1.some(
    (t1) =>
      stems2.has(simpleStem(t1)) ||
      salient2.some((t2) => levenshteinSimilarity(t1, t2) >= 0.8)
  );
}

// ─── Per-animation caching ────────────────────────────────────────────────────

function getOrCreateAnimationTokens(
  registry: AnimationRegistry,
  key: string,
  anim: AnimationMeta
): AnimationTokenCache {
  let cache = animationTokenCache.get(registry);
  if (!cache) {
    cache = new Map();
    animationTokenCache.set(registry, cache);
  }
  const existing = cache.get(key);
  if (existing) return existing;

  const entry: AnimationTokenCache = {
    nameTokens: tokenizeWithAliases(anim.name ?? ""),
    emotionTokens: tokenizeWithAliases(anim.primary_emotion ?? ""),
    actionTokens: tokenizeWithAliases(anim.action ?? ""),
    tagTokens: (anim.semantic_tags ?? []).flatMap(tokenizeWithAliases),
    descTokens: tokenizeWithAliases(anim.description ?? ""),
    exclusionTokens: (anim.exclusion_tags ?? []).flatMap(tokenizeWithAliases),
  };
  cache.set(key, entry);
  return entry;
}

function getOrCreateAnimationVector(
  registry: AnimationRegistry,
  key: string,
  tokens: AnimationTokenCache
): Map<string, number> {
  let cache = registryVectorCache.get(registry);
  if (!cache) {
    cache = new Map();
    registryVectorCache.set(registry, cache);
  }
  const existing = cache.get(key);
  if (existing) return existing;

  const vector = new Map<string, number>();

  const fields: [string[], number, boolean][] = [
    [tokens.nameTokens, 1.3, false],
    [tokens.emotionTokens, 1.15, false],
    [tokens.actionTokens, 1.9, true],
    [tokens.tagTokens, 1.6, true],
    [tokens.descTokens, 1.1, false],
  ];

  for (const [fieldTokens, multiplier, boostActions] of fields) {
    const weighted = buildWeightedVector(fieldTokens, boostActions);
    for (const [token, weight] of weighted) {
      upsertVectorWeight(vector, token, weight * multiplier);
    }
  }

  cache.set(key, vector);
  return vector;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function calculateSimilarity(
  intentTokens: string[],
  intentVector: Map<string, number>,
  tokens: AnimationTokenCache,
  animVector: Map<string, number>,
  anim: AnimationMeta,
  sentimentScore: number
): number {
  // Fix #15: use pre-cached tokens rather than re-tokenizing
  const { nameTokens, emotionTokens, actionTokens, tagTokens, exclusionTokens } =
    tokens;

  // Exclusion check
  if (
    exclusionTokens.length > 0 &&
    exclusionTokens.some((tag) =>
      intentTokens.some((t) => isHybridMatch(t, tag))
    )
  ) {
    return 0;
  }

  // Fix #14: hasSalientOverlap is now called once with the combined semantic
  // profile built from already-cached token arrays — no re-tokenization.
  const semanticProfile = [
    ...nameTokens,
    ...emotionTokens,
    ...actionTokens,
    ...tagTokens,
  ];
  if (!hasSalientOverlap(intentTokens, semanticProfile)) return 0;

  const nameSim = weightedHybridJaccardSimilarity(intentTokens, nameTokens);
  const tagsSim = weightedHybridJaccardSimilarity(intentTokens, tagTokens);
  const emotionSim = weightedHybridJaccardSimilarity(
    intentTokens,
    emotionTokens
  );
  const actionSim = weightedHybridJaccardSimilarity(
    intentTokens,
    actionTokens
  );
  const semanticVectorSim = cosineSimilarity(intentVector, animVector);

  let sentimentAlignment = 0;
  if (typeof sentimentScore === "number" && Math.abs(sentimentScore) >= 0.12) {
    if (anim.valence === "positive" && sentimentScore > 0)
      sentimentAlignment = 0.08;
    else if (anim.valence === "negative" && sentimentScore < 0)
      sentimentAlignment = 0.08;
    else if (anim.valence && anim.valence !== "neutral")
      sentimentAlignment = -0.08;
  }

  const lexicalScore =
    nameSim * 0.2 + tagsSim * 0.35 + emotionSim * 0.15 + actionSim * 0.3;
  const blended =
    semanticVectorSim * 0.55 + lexicalScore * 0.45 + sentimentAlignment;
  return Math.max(0, Math.min(1, blended));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function findBestAnimationMatch(
  intent: string,
  registry: AnimationRegistry,
  options?: AnimationMatcherOptions
): string {
  const keys = Object.keys(registry);
  if (!keys.length) return "idle";

  const minScore = options?.minScore ?? DEFAULT_MIN_SIMILARITY_SCORE;
  const disallowTypes = new Set(
    (options?.disallowTypes ?? []).map((t) => t.toLowerCase())
  );
  const allowCategoryFallback = options?.allowCategoryFallback ?? false;
  const sentimentScore = options?.sentimentScore ?? 0;

  const cleanIntent = intent.trim().toLowerCase();

  // Exact match fast-path
  if (registry[cleanIntent]) {
    const directType = registry[cleanIntent]?.type?.toLowerCase();
    if (directType && disallowTypes.has(directType)) {
      log.debug(
        `[FuzzyMatcher] Exact match '${cleanIntent}' blocked by disallowTypes.`
      );
      return "idle";
    }
    log.debug(`[FuzzyMatcher] Exact match found for '${intent}'.`);
    return cleanIntent;
  }

  const contextTokens = (options?.contextTexts ?? []).flatMap((text) =>
    tokenizeWithAliases(text ?? "")
  );
  const intentTokens = expandTokens([
    ...normalizeText(intent),
    ...contextTokens,
  ]);
  if (!intentTokens.length) return "idle";

  const intentVector = buildWeightedVector(intentTokens, true);

  let bestMatchKey = "idle";
  let highestScore = 0;

  // Fix #12: categoryFallback only applies when NO match exceeds minScore,
  // so we collect candidates throughout the loop and use them at the end.
  const categoryFallbackCandidates: string[] = [];

  const isDanceIntent = intentTokens.some((t) => isHybridMatch(t, "dance"));
  const isExpressionIntent = intentTokens.some(
    (t) => isHybridMatch(t, "talk") || isHybridMatch(t, "expression")
  );

  for (const key of keys) {
    const anim = registry[key];
    const animType = anim.type?.toLowerCase();

    if (animType && disallowTypes.has(animType)) continue;

    // Collect category fallback candidates as we go
    if (allowCategoryFallback && anim.type) {
      if (isDanceIntent && anim.type === "dance")
        categoryFallbackCandidates.push(key);
      if (isExpressionIntent && anim.type === "expression")
        categoryFallbackCandidates.push(key);
    }

    // Fix #15: get pre-cached token arrays; build vector from them
    const tokenCache = getOrCreateAnimationTokens(registry, key, anim);
    const animVector = getOrCreateAnimationVector(registry, key, tokenCache);

    const score = calculateSimilarity(
      intentTokens,
      intentVector,
      tokenCache,
      animVector,
      anim,
      sentimentScore
    );

    if (score > highestScore) {
      highestScore = score;
      bestMatchKey = key;
    }
  }

  log.debug(
    `[FuzzyMatcher] Intent '${intent}' → best='${bestMatchKey}' score=${highestScore.toFixed(3)} threshold=${minScore.toFixed(3)}`
  );

  // Fix #12: only use category fallback when score is truly zero (no overlap
  // at all), not just below threshold — below-threshold means something was
  // found but wasn't confident enough, and a random pick would be worse.
  if (highestScore === 0 && allowCategoryFallback && categoryFallbackCandidates.length > 0) {
    const pick =
      categoryFallbackCandidates[
        Math.floor(Math.random() * categoryFallbackCandidates.length)
      ];
    log.debug(
      `[FuzzyMatcher] No semantic match for '${intent}'. Category fallback: '${pick}'.`
    );
    return pick;
  }

  if (highestScore < minScore) {
    log.debug(
      `[FuzzyMatcher] Score ${highestScore.toFixed(3)} below threshold ${minScore.toFixed(3)}. Returning idle.`
    );
    return "idle";
  }

  return bestMatchKey;
}