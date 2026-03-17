import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { useAnimationStore } from "../store/useAnimationStore";
import { useSceneConfig } from "../hooks/SceneConfigContext";
import { normaliseFbxAnimations } from "../lib/animationUtils";
import { createLogger } from "../lib/logging/logger";

// Type definition from our registry types
import { AnimationMeta } from "../lib/animationRegistry.types";

const log = createLogger("useDynamicAnimations");

const DEFAULT_IDLE_ANIMATION = "masculine_idle_f_standing_idle_001";
const DEFAULT_IDLE_URL = "/animations/masculine/idle/F_Standing_Idle_001.glb";

// ─── Shared async GLB cache ──────────────────────────────────────────────────
// Prevents re-fetching the same GLB file when the same animation is queued
// multiple times or when switching back and forth between animations.
const glbCache = new Map<string, THREE.AnimationClip[]>();
const inflight = new Map<string, Promise<THREE.AnimationClip[]>>();
const loader = new GLTFLoader();

function loadAnimationClips(url: string): Promise<THREE.AnimationClip[]> {
  // Return from cache instantly
  if (glbCache.has(url)) {
    return Promise.resolve(glbCache.get(url)!);
  }
  // Deduplicate in-flight requests
  if (inflight.has(url)) {
    return inflight.get(url)!;
  }

  const promise = new Promise<THREE.AnimationClip[]>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const clips = gltf.animations;
        // Normalise Mixamo naming once at load time
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

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useDynamicAnimations() {
  const currentAnimationName = useAnimationStore((state) => state.currentAnimation);
  const animationQueue = useAnimationStore((state) => state.animationQueue);
  const registry = useAnimationStore((state) => state.registry);
  const advanceQueue = useAnimationStore((state) => state.advanceQueue);

  const [activeClip, setActiveClip] = useState<THREE.AnimationClip | null>(null);

  const { config } = useSceneConfig();
  const configuredIdle = config.avatar.idleAnimation || DEFAULT_IDLE_ANIMATION;

  // Stable ref for the current queue item ID so we can track it in the timer
  const activeQueueIdRef = useRef<string | null>(null);
  // Track previous URL so we don't re-clone when the animation name changes
  // but points to the same physical file
  const prevUrlRef = useRef<string | null>(null);

  // ── Resolve the target URL ────────────────────────────────────────────────
  const resolvedAnimationName =
    currentAnimationName === "idle" ? configuredIdle : currentAnimationName;

  const activeMeta: AnimationMeta | undefined = registry[resolvedAnimationName];
  const defaultIdleMeta: AnimationMeta | undefined =
    registry[DEFAULT_IDLE_ANIMATION] ?? registry["male-idle"] ?? registry.idle;

  const targetUrl = activeMeta?.url || defaultIdleMeta?.url || DEFAULT_IDLE_URL;

  // ── The current queue item (head of queue) ────────────────────────────────
  const headItem = animationQueue.length > 0 ? animationQueue[0] : null;
  const headId = headItem?.id ?? null;
  const headName = headItem?.name ?? null;

  // ── Async load + set active clip ──────────────────────────────────────────
  // This replaces useGLTF which triggers React Suspense and shows a loading
  // screen. We load manually so the avatar keeps playing its current animation
  // until the new one is fully ready.
  useEffect(() => {
    let cancelled = false;

    // Always give each clip instance a unique name so the Three.js mixer
    // creates a distinct AnimationAction for it. This is critical when the
    // same animation (e.g. "wave") is queued twice consecutively — without a
    // unique name, useAnimations returns the *same* action object and
    // Avatar.tsx can't crossfade because previousActionRef === currentAction.
    const uniqueSuffix = headId ?? `idle-${Date.now()}`;
    const clipDisplayName = currentAnimationName;

    loadAnimationClips(targetUrl)
      .then((clips) => {
        if (cancelled || !clips.length) return;

        const clip = clips[0].clone();
        // The clip.name is what useAnimations uses as the key in its
        // `actions` dictionary. We embed the queue ID so each queued
        // instance gets its own action, enabling proper crossfades.
        clip.name = `${clipDisplayName}__${uniqueSuffix}`;

        setActiveClip(clip);
        prevUrlRef.current = targetUrl;

        log.debug(
          { clipName: clip.name, url: targetUrl, duration: clip.duration.toFixed(2) },
          "Loaded animation clip (async, no suspense)."
        );
      })
      .catch((err) => {
        if (!cancelled) {
          log.error({ error: err, url: targetUrl }, "Failed to load animation clip.");
        }
      });

    return () => {
      cancelled = true;
    };
    // We depend on currentAnimationName AND headId so that:
    // - Different animation name → load new file
    // - Same animation name but different queue item → re-clone with new ID
  }, [currentAnimationName, targetUrl, headId]);

  // ── Auto-advance queue timer ──────────────────────────────────────────────
  // Runs after the clip is set. When the current clip finishes playing (based
  // on its physical duration), we advance to the next item in the queue.
  // IMPORTANT: We verify activeClip belongs to the current queue head by
  // checking that the clip name contains the queue item ID. This prevents
  // the timer from using a stale clip's duration (e.g. 24s idle instead of
  // 4.3s dance) when the async load hasn't completed yet.
  useEffect(() => {
    if (!activeClip) return;
    if (!headItem || headName !== currentAnimationName) return;

    // Only start the timer if the clip actually belongs to this queue item
    if (!headId || !activeClip.name.includes(headId)) return;

    // Prevent double-firing for the same queue item
    if (activeQueueIdRef.current === headId) return;
    activeQueueIdRef.current = headId;

    const scale = headItem.timeScale || 1.0;
    const durationMs =
      headItem.durationMs || (activeClip.duration * 1000) / scale;

    log.debug(
      { animation: currentAnimationName, durationMs: Math.round(durationMs), queueId: headId },
      "Starting queue timer for animation."
    );

    const timer = setTimeout(() => {
      activeQueueIdRef.current = null;
      advanceQueue();
    }, durationMs);

    return () => clearTimeout(timer);
  }, [activeClip, headId, headName, currentAnimationName, advanceQueue, headItem]);

  // ── Background preloading for upcoming queue items ────────────────────────
  // Eagerly fetch the next animations in the queue so they're in the cache
  // and play instantly when their turn comes (no stutter or loading).
  const preloadQueued = useCallback(() => {
    if (animationQueue.length <= 1) return;
    const upcoming = animationQueue.slice(1);
    for (const item of upcoming) {
      const meta = registry[item.name];
      const url = meta?.url;
      if (url && !glbCache.has(url)) {
        loadAnimationClips(url).catch(() => {
          /* preload failure is non-fatal */
        });
      }
    }
  }, [animationQueue, registry]);

  useEffect(() => {
    preloadQueued();
  }, [preloadQueued]);

  return { activeClip };
}
