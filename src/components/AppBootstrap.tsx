"use client";

import { useEffect } from "react";
import { patchOrbitControlsPassiveListeners } from "@/lib/patchOrbitControls";
import { useEmotionStore } from "@/store/useEmotionStore";

/**
 * AppBootstrap
 *
 * A single client-side mount point for one-time browser-only side effects
 * that cannot run in Server Components or at module level.
 *
 * Responsibilities:
 *   1. OrbitControls passive listener patch — must run after the DOM is ready
 *      and only in the browser. Previously guarded by `typeof window !==
 *      "undefined"` at module level in layout.tsx, which is a Server Component
 *      in the App Router — the guard prevented a crash but the call never ran.
 *
 *   2. Emotion score auto-decay — starts a 500 ms interval that decays the
 *      sentiment score after 4 s of AI silence. Must be started once for the
 *      entire app lifetime and cleaned up on unmount. Previously the store
 *      exposed `startAutoDecay` but nothing called it.
 *
 * Renders nothing — this component is purely behavioural.
 */
export function AppBootstrap() {
  useEffect(() => {
    // ── 1. OrbitControls passive listener patch ─────────────────────────────
    // Suppresses browser warnings about non-passive wheel/touch listeners
    // attached by Three.js OrbitControls. Must run once after first paint.
    patchOrbitControlsPassiveListeners();

    // ── 2. Emotion auto-decay ───────────────────────────────────────────────
    // Starts the decay interval and returns a cleanup function that clears it
    // when the app unmounts (e.g. hot-reload, tab close).
    const stopDecay = useEmotionStore.getState().startAutoDecay();

    return () => {
      stopDecay();
    };
  }, []); // empty deps — runs exactly once on mount

  return null;
}