/**
 * Avatar Registry & Resolution
 *
 * Manages discovery, URL normalisation, and client-side persistence of
 * Ready Player Me (RPM) avatars and custom GLBs. Every resolved URL is
 * guaranteed to include the morph-target parameters required by
 * EmotionEngine (ARKit blendshapes) and LipSyncEngine (Oculus visemes).
 *
 * Cached registry fetch (5-min TTL) · cached localStorage reads
 * Pure URL builders (no mutation) · post-load capability detection
 */

import {
  DEFAULT_MESH_CONFIG,
  type MeshConfig,
} from "@/lib/avatar-control.types";

// ═══════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════

const CLIENT_AVATARS_KEY = "digital-persona.client-avatars.v1";
const REGISTRY_CACHE_TTL_MS = 5 * 60 * 1000;
const RPM_HOST_RE = /readyplayer\.me$/i;
const RPM_MODELS_ORIGIN = "https://models.readyplayer.me";
const AVATAR_ID_RE = /^[a-zA-Z0-9_-]{16,64}$/;

/**
 * Morph target systems that MUST appear in every RPM URL.
 * EmotionEngine needs ARKit; LipSyncEngine needs Oculus Visemes.
 * `ensureEmotiveMorphTargets()` enforces this at URL-build time.
 */
const REQUIRED_MORPH_SYSTEMS = ["ARKit", "Oculus Visemes"] as const;

/**
 * Morph targets consumed by the emotive pipeline, grouped by subsystem.
 * Used by `detectCapabilities()` after GLB load to determine which
 * engine code paths are available on a given avatar mesh.
 */
export const EMOTIVE_MORPH_TARGETS = {
  /** EmotionEngine: ARKit expression blendshapes */
  emotion: [
    "mouthSmileLeft",
    "mouthSmileRight",
    "cheekSquintLeft",
    "cheekSquintRight",
    "browInnerUp",
    "browDownLeft",
    "browDownRight",
    "mouthFrownLeft",
    "mouthFrownRight",
  ],
  /** LipSyncEngine primary path: 15 standard Oculus visemes */
  lipsyncNative: [
    "viseme_sil",
    "viseme_PP",
    "viseme_FF",
    "viseme_TH",
    "viseme_DD",
    "viseme_kk",
    "viseme_CH",
    "viseme_SS",
    "viseme_nn",
    "viseme_RR",
    "viseme_aa",
    "viseme_E",
    "viseme_I",
    "viseme_O",
    "viseme_U",
  ],
  /** LipSyncEngine fallback path: ARKit mouth shapes */
  lipsyncFallback: [
    "jawOpen",
    "mouthClose",
    "mouthFunnel",
    "mouthPucker",
    "mouthSmileLeft",
    "mouthSmileRight",
    "mouthStretchLeft",
    "mouthStretchRight",
    "mouthPressLeft",
    "mouthPressRight",
    "mouthLowerDownLeft",
    "mouthLowerDownRight",
  ],
} as const;

// ═══════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════

export interface AvatarEntry {
  /** Unique key used in config persistence */
  id: string;
  /** Human-readable name shown in the UI dropdown */
  label: string;
  /** Filename in public/avatars, full URL, data URL, or blob URL */
  file: string;
  /** Original source URL used for imported avatars */
  sourceUrl?: string;
  /** True when avatar came from local client import */
  isCustom?: boolean;
}

/**
 * Post-load capability report populated by `detectCapabilities()`.
 * Engines read this to choose between native vs fallback code paths.
 */
export interface AvatarCapabilities {
  hasOculusVisemes: boolean;
  hasArkitBlendshapes: boolean;
  hasEmotionTargets: boolean;
  morphTargetCount: number;
  missingTargets: string[];
}

// ═══════════════════════════════════════════════════════════════════
//  Defaults
// ═══════════════════════════════════════════════════════════════════

export const DEFAULT_AVATARS: AvatarEntry[] = [
  { id: "female", label: "Female", file: "69b1976bf005c9608fd1e704.glb" },
  { id: "male", label: "Male", file: "69aaa1126e4b038c0e57c672.glb" },
];

// ═══════════════════════════════════════════════════════════════════
//  URL Helpers (pure — no mutation)
// ═══════════════════════════════════════════════════════════════════

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function isReadyPlayerHost(hostname: string): boolean {
  return RPM_HOST_RE.test(hostname);
}

/**
 * Ensures the `morphTargets` query param includes all systems required
 * by the emotive pipeline. Without this, avatars fetched with a bare
 * RPM URL will lack visemes or ARKit blendshapes and engines degrade
 * silently.
 */
function ensureEmotiveMorphTargets(morphTargets: string): string {
  const existing = morphTargets
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const required of REQUIRED_MORPH_SYSTEMS) {
    if (!existing.some((e) => e.toLowerCase() === required.toLowerCase())) {
      existing.push(required);
    }
  }

  return existing.join(",");
}

/**
 * Builds an RPM-compatible URL with all required query parameters.
 * Returns a NEW URL string — never mutates the input.
 */
function buildReadyPlayerUrl(
  input: URL,
  meshConfig: MeshConfig = DEFAULT_MESH_CONFIG,
): string {
  if (!isReadyPlayerHost(input.hostname)) return input.toString();

  // Clone to avoid mutating the caller's URL object
  const url = new URL(input.toString());

  const lod = Math.max(0, Math.min(2, meshConfig.meshLod));
  const morphTargets = ensureEmotiveMorphTargets(
    meshConfig.morphTargets || DEFAULT_MESH_CONFIG.morphTargets,
  );
  const textureAtlas =
    meshConfig.textureAtlas || DEFAULT_MESH_CONFIG.textureAtlas;

  url.searchParams.set("morphTargets", morphTargets);
  url.searchParams.set("lod", String(lod));
  url.searchParams.set("pose", "A");
  url.searchParams.set("textureAtlas", textureAtlas);
  url.searchParams.set(
    "useDracoCompression",
    String(Boolean(meshConfig.useDracoCompression)),
  );
  url.searchParams.set(
    "useMeshOptCompression",
    String(Boolean(meshConfig.useMeshOptCompression)),
  );

  // RPM API expects literal commas and %20 for spaces
  return url.toString().replace(/%2C/g, ",").replace(/\+/g, "%20");
}

/**
 * Extracts a Ready Player Me avatar ID from various input formats:
 * - Raw 24-char hex ID
 * - RPM URL with `/avatar/<id>` path
 * - RPM URL with `?id=<id>` query param
 */
function extractAvatarId(input: string): string | null {
  const trimmed = input.trim();

  // Raw ID (hex string, no dots or slashes)
  if (
    AVATAR_ID_RE.test(trimmed) &&
    !trimmed.includes(".") &&
    !trimmed.includes("/")
  ) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const fromQuery = url.searchParams.get("id");
    if (fromQuery) return fromQuery.trim();

    const fromPath = url.pathname.match(/\/avatar\/([a-zA-Z0-9_-]+)/i)?.[1];
    if (fromPath) return fromPath.trim();
  } catch {
    // Not a URL — fall through
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════
//  Entry Sanitisation
// ═══════════════════════════════════════════════════════════════════

function sanitiseAvatarEntry(value: unknown): AvatarEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const id = typeof record.id === "string" ? record.id.trim() : "";
  const label = typeof record.label === "string" ? record.label.trim() : "";
  const file = typeof record.file === "string" ? record.file.trim() : "";
  if (!id || !label || !file) return null;

  return {
    id,
    label,
    file,
    sourceUrl:
      typeof record.sourceUrl === "string" ? record.sourceUrl : undefined,
    isCustom: Boolean(record.isCustom),
  };
}

// ═══════════════════════════════════════════════════════════════════
//  Registry Fetch (cached, 5-min TTL)
// ═══════════════════════════════════════════════════════════════════

let registryCache: AvatarEntry[] | null = null;
let registryCacheTime = 0;

/**
 * Fetch the avatar registry from `/avatars/index.json`.
 * Results are cached for `REGISTRY_CACHE_TTL_MS` to avoid redundant
 * network requests on re-renders.
 */
export async function fetchAvatarRegistry(
  signal?: AbortSignal,
): Promise<AvatarEntry[]> {
  const now = Date.now();
  if (registryCache && now - registryCacheTime < REGISTRY_CACHE_TTL_MS) {
    return registryCache;
  }

  try {
    const res = await fetch("/avatars/index.json", { signal });
    if (!res.ok) return DEFAULT_AVATARS;

    const raw = await res.json();
    if (!Array.isArray(raw)) return DEFAULT_AVATARS;

    const parsed = raw
      .map(sanitiseAvatarEntry)
      .filter((entry): entry is AvatarEntry => Boolean(entry));

    const result = parsed.length > 0 ? parsed : DEFAULT_AVATARS;
    registryCache = result;
    registryCacheTime = now;
    return result;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return DEFAULT_AVATARS;
  }
}

/** Force-clear the registry cache (e.g. after an avatar import). */
export function invalidateRegistryCache(): void {
  registryCache = null;
  registryCacheTime = 0;
}

// ═══════════════════════════════════════════════════════════════════
//  URL Normalisation
// ═══════════════════════════════════════════════════════════════════

/**
 * Normalize an RPM URL, direct GLB URL, or plain avatar ID into a
 * fetchable URL with all required morph-target parameters.
 */
export function normalizeAvatarUrl(
  input: string,
  meshConfig: MeshConfig = DEFAULT_MESH_CONFIG,
): string {
  const raw = input.trim();
  if (!raw) {
    throw new Error("Avatar URL is empty.");
  }

  // Try extracting an RPM avatar ID
  const maybeId = extractAvatarId(raw);
  if (maybeId) {
    return buildReadyPlayerUrl(
      new URL(`${RPM_MODELS_ORIGIN}/${maybeId}.glb`),
      meshConfig,
    );
  }

  // Accept data: and blob: URLs as-is
  if (raw.startsWith("data:") || raw.startsWith("blob:")) {
    return raw;
  }

  // Try to promote to https if it looks like a URL
  let candidate = raw;
  if (!isHttpUrl(candidate)) {
    if (
      candidate.endsWith(".glb") ||
      candidate.includes("readyplayer.me")
    ) {
      candidate = `https://${candidate.replace(/^\/+/, "")}`;
    }
  }

  if (!isHttpUrl(candidate)) {
    throw new Error(
      "Provide a Ready Player Me URL, direct .glb URL, or avatar ID.",
    );
  }

  try {
    return buildReadyPlayerUrl(new URL(candidate), meshConfig);
  } catch {
    throw new Error("Avatar URL is invalid.");
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Import Helper
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolves an import input to a source URL and file reference.
 * Does NOT download to localStorage (GLBs are too large for base64
 * in localStorage). The browser cache / IndexedDB layer handles
 * asset caching.
 */
export async function resolveImportUrl(
  input: string,
): Promise<{ sourceUrl: string; file: string }> {
  const sourceUrl = normalizeAvatarUrl(input, DEFAULT_MESH_CONFIG);
  return { sourceUrl, file: sourceUrl };
}

/** @deprecated Use `resolveImportUrl` instead. */
export const downloadAvatarAsOrGetUrl = resolveImportUrl;

// ═══════════════════════════════════════════════════════════════════
//  Client Avatar Persistence (localStorage)
// ═══════════════════════════════════════════════════════════════════

let clientAvatarsCache: AvatarEntry[] | null = null;

export function loadClientAvatars(): AvatarEntry[] {
  if (typeof window === "undefined") return [];
  if (clientAvatarsCache) return clientAvatarsCache;

  try {
    const raw = localStorage.getItem(CLIENT_AVATARS_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const result = parsed
      .map(sanitiseAvatarEntry)
      .filter((entry): entry is AvatarEntry => Boolean(entry))
      .map((entry) => ({ ...entry, isCustom: true as const }));

    clientAvatarsCache = result;
    return result;
  } catch {
    return [];
  }
}

function persistClientAvatars(entries: AvatarEntry[]): AvatarEntry[] {
  if (typeof window === "undefined") return entries;
  try {
    localStorage.setItem(CLIENT_AVATARS_KEY, JSON.stringify(entries));
    clientAvatarsCache = entries;
  } catch {
    throw new Error(
      "Unable to save avatar locally. Browser storage may be full.",
    );
  }
  return entries;
}

export function upsertClientAvatar(entry: AvatarEntry): AvatarEntry[] {
  const current = loadClientAvatars();
  const next = [
    ...current.filter((avatar) => avatar.id !== entry.id),
    { ...entry, isCustom: true as const },
  ];
  return persistClientAvatars(next);
}

export function removeClientAvatar(id: string): AvatarEntry[] {
  const current = loadClientAvatars();
  const next = current.filter((avatar) => avatar.id !== id);
  return persistClientAvatars(next);
}

// ═══════════════════════════════════════════════════════════════════
//  Resolution
// ═══════════════════════════════════════════════════════════════════

/** Resolve an avatar ID to a final URL or data URL. */
export function getAvatarUrl(
  id: string,
  registry: AvatarEntry[],
  meshConfig: MeshConfig = DEFAULT_MESH_CONFIG,
): string {
  const entry = registry.find((avatar) => avatar.id === id);
  const file = entry?.file ?? registry[0]?.file ?? DEFAULT_AVATARS[0].file;

  if (file.startsWith("data:") || file.startsWith("blob:")) {
    return file;
  }

  if (isHttpUrl(file)) {
    try {
      return buildReadyPlayerUrl(new URL(file), meshConfig);
    } catch {
      return file;
    }
  }

  return `/avatars/${file}`;
}

/** Resolve an avatar ID to its registry entry (falls back to first). */
export function getAvatarEntry(
  id: string,
  registry: AvatarEntry[],
): AvatarEntry {
  return (
    registry.find((avatar) => avatar.id === id) ??
    registry[0] ??
    DEFAULT_AVATARS[0]
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Capability Detection (post-load)
// ═══════════════════════════════════════════════════════════════════

/**
 * Inspects a loaded mesh's `morphTargetDictionary` and reports which
 * emotive pipeline features the avatar supports.
 *
 * Call this once after GLB load:
 * ```ts
 * const head = nodes.Wolf3D_Head as THREE.SkinnedMesh;
 * const caps = detectCapabilities(head.morphTargetDictionary ?? {});
 * if (!caps.hasOculusVisemes) {
 *   log.warn("Using ARKit fallback — less precise lip sync.");
 * }
 * ```
 */
export function detectCapabilities(
  morphTargetDictionary: Record<string, number>,
): AvatarCapabilities {
  const keys = Object.keys(morphTargetDictionary);
  const has = (name: string) => name in morphTargetDictionary;

  const missingTargets: string[] = [];

  const hasOculusVisemes = EMOTIVE_MORPH_TARGETS.lipsyncNative.every((t) => {
    const present = has(t);
    if (!present) missingTargets.push(t);
    return present;
  });

  const hasArkitBlendshapes = EMOTIVE_MORPH_TARGETS.lipsyncFallback.every(
    (t) => {
      const present = has(t);
      if (!present && !missingTargets.includes(t)) missingTargets.push(t);
      return present;
    },
  );

  const hasEmotionTargets = EMOTIVE_MORPH_TARGETS.emotion.every((t) => {
    const present = has(t);
    if (!present && !missingTargets.includes(t)) missingTargets.push(t);
    return present;
  });

  return {
    hasOculusVisemes,
    hasArkitBlendshapes,
    hasEmotionTargets,
    morphTargetCount: keys.length,
    missingTargets,
  };
}