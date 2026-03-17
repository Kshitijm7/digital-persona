import { useEffect, useRef, useState, useMemo } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { useAnimationStore } from "../store/useAnimationStore";
import { useSceneConfig } from "../hooks/SceneConfigContext";
import { normaliseFbxAnimations } from "../lib/animationUtils";
import { createLogger } from "../lib/logging/logger";
import { AnimationMeta } from "../lib/animationRegistry.types";

const log = createLogger("useDynamicAnimations");

const DEFAULT_IDLE_ANIMATION = "masculine_idle_f_standing_idle_001";
const DEFAULT_IDLE_URL = "/animations/masculine/idle/F_Standing_Idle_001.glb";

// ─── Crossfade timing ────────────────────────────────────────────────────────
//
// CROSSFADE_DURATION_MS is the blend window: how long Avatar.tsx takes to
// interpolate from the outgoing clip to the incoming clip. Per the RPM/humanoid
// best-practice range of 0.1–0.3 s, we use 200 ms. Shorter feels snappy for
// gestures; longer feels floaty. This constant must match the value passed to
// crossFadeTo() in Avatar.tsx.
//
// ADVANCE_OFFSET_MS is how early we call advanceQueue() before the clip ends,
// giving Avatar.tsx time to start the crossfade before the outgoing clip
// clamps at its last frame. It should be >= CROSSFADE_DURATION_MS.
//
// Keeping them separate means you can tune the blend feel without changing
// when the queue advances.
export const CROSSFADE_DURATION_MS = 200;

// ─── Shared async GLB cache ──────────────────────────────────────────────────
//
// Module-level so it persists across re-renders and component remounts.
// All hook instances share one loader and one cache — no duplicate fetches.

const glbCache = new Map<string, THREE.AnimationClip[]>();
const inflight = new Map<string, Promise<THREE.AnimationClip[]>>();
const loader = new GLTFLoader();

function loadAnimationClips(url: string): Promise<THREE.AnimationClip[]> {
  const cached = glbCache.get(url);
  if (cached) return Promise.resolve(cached);

  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = new Promise<THREE.AnimationClip[]>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const clips = gltf.animations;

        if (!clips.length) {
          // Do not cache — allow a retry next time this URL is requested.
          inflight.delete(url);
          reject(new Error(`No animation clips found in GLB: "${url}"`));
          return;
        }

        // Normalise once at load time. normaliseFbxAnimations is idempotent so
        // calling it again on a cached result via a second load() is safe.
        normaliseFbxAnimations(clips);
        glbCache.set(url, clips);
        inflight.delete(url);
        resolve(clips);
      },
      undefined,
      (err) => {
        inflight.delete(url);
        reject(err);
      }
    );
  });

  inflight.set(url, promise);
  return promise;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UseDynamicAnimationsResult {
  /** The clip Avatar.tsx should play next. Null until the first load completes. */
  activeClip: THREE.AnimationClip | null;
  /**
   * The idle clip, preloaded independently of the queue. Avatar.tsx uses this
   * as the guaranteed fallback when the queue empties, enabling a smooth
   * crossfade back to idle rather than a hard snap.
   */
  idleClip: THREE.AnimationClip | null;
  /** Set when the most recent clip load failed. Cleared on the next success. */
  loadError: Error | null;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useDynamicAnimations(): UseDynamicAnimationsResult {
  const currentAnimationName = useAnimationStore((s) => s.currentAnimation);
  const animationQueue = useAnimationStore((s) => s.animationQueue);
  const registry = useAnimationStore((s) => s.registry);
  const advanceQueue = useAnimationStore((s) => s.advanceQueue);

  const [activeClip, setActiveClip] = useState<THREE.AnimationClip | null>(null);
  // idleClip is kept separate so Avatar.tsx always has a ready crossfade target
  // when the queue drains — it never needs to wait for an async load at that moment.
  const [idleClip, setIdleClip] = useState<THREE.AnimationClip | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const { config } = useSceneConfig();
  const configuredIdle = config.avatar.idleAnimation || DEFAULT_IDLE_ANIMATION;

  // Tracks which queue item's timer is currently running.
  const activeQueueIdRef = useRef<string | null>(null);

  // ── Resolve idle URL ──────────────────────────────────────────────────────
  // Memoised so the identity only changes when the registry or configured idle
  // actually changes — not on every render.
  const idleUrl = useMemo<string>(() => {
    const idleMeta: AnimationMeta | undefined =
      registry[configuredIdle] ??
      registry[DEFAULT_IDLE_ANIMATION] ??
      registry["male-idle"] ??
      registry["idle"];

    if (!idleMeta?.url) {
      log.warn(
        { configuredIdle },
        "Idle animation not found in registry — using hardcoded default URL."
      );
    }

    return idleMeta?.url ?? DEFAULT_IDLE_URL;
  }, [registry, configuredIdle]);

  // ── Resolve active animation URL ──────────────────────────────────────────
  const resolvedAnimationName =
    currentAnimationName === "idle" ? configuredIdle : currentAnimationName;

  const activeMeta: AnimationMeta | undefined = registry[resolvedAnimationName];
  const targetUrl = activeMeta?.url ?? idleUrl;

  // ── Queue head (stable scalars) ───────────────────────────────────────────
  // Avoid putting `headItem` (a new object ref on every render) in effect
  // dependency arrays — destructure to primitives instead.
  const headItem = animationQueue[0] ?? null;
  const headId = headItem?.id ?? null;
  const headName = headItem?.name ?? null;
  const headTimeScale = headItem?.timeScale ?? 1.0;
  const headDurationMs = headItem?.durationMs ?? null;

  // ── Preload idle clip eagerly ─────────────────────────────────────────────
  // Load once on mount (and whenever idleUrl changes) so that when the queue
  // drains Avatar.tsx can crossfade immediately without waiting for a fetch.
  useEffect(() => {
    let cancelled = false;

    loadAnimationClips(idleUrl)
      .then((clips) => {
        if (cancelled) return;
        const clip = clips[0].clone();
        // Fixed name — there is only ever one idle base state.
        clip.name = `idle__${configuredIdle}`;
        setIdleClip(clip);
        log.debug({ url: idleUrl }, "Idle clip preloaded.");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        log.error({ error: err, url: idleUrl }, "Failed to preload idle clip.");
      });

    return () => {
      cancelled = true;
    };
  }, [idleUrl, configuredIdle]);

  // ── Load active clip ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    // Embed the queue item ID in the clip name so the Three.js mixer creates a
    // distinct AnimationAction per queued item. This is what makes crossfading
    // the same animation back-to-back work — without a unique name, useAnimations
    // returns the same action and previousActionRef === currentAction.
    const uniqueSuffix = headId ?? `idle__${configuredIdle}`;

    loadAnimationClips(targetUrl)
      .then((clips) => {
        if (cancelled) return;

        const clip = clips[0].clone();
        clip.name = `${currentAnimationName}__${uniqueSuffix}`;

        setActiveClip(clip);
        setLoadError(null);

        log.debug(
          {
            clipName: clip.name,
            url: targetUrl,
            duration: clip.duration.toFixed(2),
          },
          "Loaded animation clip (async, no suspense)."
        );
      })
      .catch((err: Error) => {
        if (cancelled) return;
        log.error({ error: err, url: targetUrl }, "Failed to load animation clip.");
        setLoadError(err);
      });

    return () => {
      cancelled = true;
    };
    // headId: same name queued twice needs a new clip instance (different action)
    // configuredIdle: changes the idle suffix used when there is no queue item
  }, [currentAnimationName, targetUrl, headId, configuredIdle]);

  // ── Auto-advance queue timer ──────────────────────────────────────────────
  useEffect(() => {
    if (!activeClip) return;
    if (!headItem) return;

    // Guard: the loaded clip must match the current queue head. Without this,
    // a stale clip (e.g. the previous 24 s idle) could drive the wrong timer
    // duration before the correct clip finishes loading.
    if (headName !== currentAnimationName) return;
    if (!headId || !activeClip.name.includes(headId)) return;

    // Prevent a second timer from being started if the effect re-runs while
    // this queue item is still playing.
    if (activeQueueIdRef.current === headId) return;
    activeQueueIdRef.current = headId;

    // In the auto-advance timer effect, replace the rawDurationMs block:
    const crossfadeMs = activeMeta?.crossfadeDurationMs ?? CROSSFADE_DURATION_MS;
    const rawDurationMs = (activeClip.duration * 1000) / headTimeScale;
    const durationMs =
      headDurationMs ??
      Math.max(crossfadeMs, rawDurationMs - crossfadeMs);

    log.debug(
      {
        animation: currentAnimationName,
        durationMs: Math.round(durationMs),
        queueId: headId,
      },
      "Starting queue advance timer."
    );

    const timer = setTimeout(() => {
      activeQueueIdRef.current = null;
      advanceQueue();
    }, durationMs);

    return () => clearTimeout(timer);
  }, [activeClip, headId, headName, headTimeScale, headDurationMs, currentAnimationName, advanceQueue, headItem, activeMeta?.crossfadeDurationMs]);

  // ── Background preload of upcoming queue items ────────────────────────────
  // Fetch future clips into the cache while the current one is playing so
  // they are ready instantly when their turn comes.
  useEffect(() => {
    if (animationQueue.length <= 1) return;

    for (const item of animationQueue.slice(1)) {
      const url = registry[item.name]?.url;
      if (url && !glbCache.has(url)) {
        loadAnimationClips(url).catch(() => {
          // Non-fatal — the clip will load on-demand when its turn arrives.
          log.warn({ url }, "Background preload failed — will retry on demand.");
        });
      }
    }
  }, [animationQueue, registry]);

  return { activeClip, idleClip, loadError };
}