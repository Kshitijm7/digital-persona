/**
 * Avatar registry and client-side avatar helpers.
 */

import { DEFAULT_MESH_CONFIG, type MeshConfig } from "@/lib/avatar-control.types";

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

const CLIENT_AVATARS_STORAGE_KEY = "digital-persona.client-avatars.v1";

/** Fallback used before fetch completes or if it fails */
export const DEFAULT_AVATARS: AvatarEntry[] = [
  { id: "female", label: "Female", file: "69b1976bf005c9608fd1e704.glb" },
  { id: "male", label: "Male", file: "69aaa1126e4b038c0e57c672.glb" },
];

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function isReadyPlayerHost(hostname: string): boolean {
  return hostname.includes("readyplayer.me");
}

function withReadyPlayerParams(url: URL, meshConfig: MeshConfig = DEFAULT_MESH_CONFIG): string {
  if (!isReadyPlayerHost(url.hostname)) return url.toString();
  const lod = Math.max(0, Math.min(2, meshConfig.meshLod));
  const textureAtlasValue = meshConfig.textureAtlas || DEFAULT_MESH_CONFIG.textureAtlas;

  url.searchParams.set("morphTargets", meshConfig.morphTargets || DEFAULT_MESH_CONFIG.morphTargets);
  url.searchParams.set("lod", String(lod));
  url.searchParams.set("pose", "A");
  url.searchParams.set("textureAtlas", textureAtlasValue);
  url.searchParams.set("useDracoCompression", String(Boolean(meshConfig.useDracoCompression)));
  url.searchParams.set("useMeshOptCompression", String(Boolean(meshConfig.useMeshOptCompression)));
  
  // RPM API often expects literal commas in the query string and %20 for spaces
  return url.toString().replace(/%2C/g, ",").replace(/\+/g, "%20");
}

function getAvatarIdFromInput(input: string): string | null {
  const trimmed = input.trim();

  if (/^[a-zA-Z0-9_-]{16,64}$/.test(trimmed) && !trimmed.includes(".") && !trimmed.includes("/")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const fromQuery = url.searchParams.get("id");
    if (fromQuery) return fromQuery.trim();

    const fromPath = url.pathname.match(/\/avatar\/([a-zA-Z0-9_-]+)/i)?.[1];
    if (fromPath) return fromPath.trim();
  } catch {
    // Not a URL. Ignore.
  }

  return null;
}

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
    sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl : undefined,
    isCustom: Boolean(record.isCustom),
  };
}

function toDataUrl(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((arrayBuffer) => {
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const mime = blob.type || "model/gltf-binary";
    return `data:${mime};base64,${btoa(binary)}`;
  });
}

/** Fetch the avatar registry from public/avatars/index.json */
export async function fetchAvatarRegistry(): Promise<AvatarEntry[]> {
  try {
    const res = await fetch("/avatars/index.json");
    if (!res.ok) return DEFAULT_AVATARS;
    const raw = await res.json();
    if (!Array.isArray(raw)) return DEFAULT_AVATARS;
    const parsed = raw
      .map(sanitiseAvatarEntry)
      .filter((entry): entry is AvatarEntry => Boolean(entry));
    return parsed.length > 0 ? parsed : DEFAULT_AVATARS;
  } catch {
    return DEFAULT_AVATARS;
  }
}

/** Normalize Ready Player Me URL, direct GLB URL, or plain avatar ID into fetchable URL. */
export function normalizeAvatarUrl(input: string, meshConfig: MeshConfig = DEFAULT_MESH_CONFIG): string {
  const raw = input.trim();
  if (!raw) {
    throw new Error("Avatar URL is empty.");
  }

  const maybeId = getAvatarIdFromInput(raw);
  if (maybeId) {
    return withReadyPlayerParams(new URL(`https://models.readyplayer.me/${maybeId}.glb`), meshConfig);
  }

  let candidate = raw;
  if (!candidate.startsWith("data:") && !candidate.startsWith("blob:") && !isHttpUrl(candidate)) {
    if (candidate.endsWith(".glb") || candidate.includes("readyplayer.me")) {
      candidate = `https://${candidate.replace(/^\/+/, "")}`;
    }
  }

  if (!isHttpUrl(candidate)) {
    throw new Error("Provide a Ready Player Me URL, direct .glb URL, or avatar ID.");
  }

  try {
    const url = new URL(candidate);
    return withReadyPlayerParams(url, meshConfig);
  } catch {
    throw new Error("Avatar URL is invalid.");
  }
}

/** Download a remote avatar and convert it to a local data URL for persistence. */
export async function downloadAvatarAsDataUrl(input: string): Promise<{ sourceUrl: string; dataUrl: string }> {
  const sourceUrl = normalizeAvatarUrl(input, DEFAULT_MESH_CONFIG);
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to download avatar (${response.status}).`);
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw new Error("Avatar download returned an empty file.");
  }

  const dataUrl = await toDataUrl(blob);
  return { sourceUrl, dataUrl };
}

export function loadClientAvatars(): AvatarEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CLIENT_AVATARS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitiseAvatarEntry)
      .filter((entry): entry is AvatarEntry => Boolean(entry))
      .map((entry) => ({ ...entry, isCustom: true }));
  } catch {
    return [];
  }
}

function persistClientAvatars(entries: AvatarEntry[]): AvatarEntry[] {
  if (typeof window === "undefined") return entries;
  try {
    localStorage.setItem(CLIENT_AVATARS_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    throw new Error("Unable to save avatar locally. Browser storage may be full.");
  }
  return entries;
}

export function upsertClientAvatar(entry: AvatarEntry): AvatarEntry[] {
  const current = loadClientAvatars();
  const next = [
    ...current.filter((avatar) => avatar.id !== entry.id),
    { ...entry, isCustom: true },
  ];
  return persistClientAvatars(next);
}

export function removeClientAvatar(id: string): AvatarEntry[] {
  const current = loadClientAvatars();
  const next = current.filter((avatar) => avatar.id !== id);
  return persistClientAvatars(next);
}

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
      return withReadyPlayerParams(new URL(file), meshConfig);
    } catch {
      return file;
    }
  }

  return `/avatars/${file}`;
}

/** Resolve an avatar ID to its registry entry (falls back to first). */
export function getAvatarEntry(id: string, registry: AvatarEntry[]): AvatarEntry {
  return registry.find((avatar) => avatar.id === id) ?? registry[0] ?? DEFAULT_AVATARS[0];
}
