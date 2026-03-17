import { create } from "zustand";
import { AnimationRegistry } from "../lib/animationRegistry.types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QueuedAnimation {
  /** Fix AN4: crypto-grade unique ID */
  id: string;
  name: string;
  durationMs?: number;
  timeScale?: number;
}

interface AnimationState {
  currentAnimation: string;
  animationQueue: QueuedAnimation[];
  registry: AnimationRegistry;
  isTransitioning: boolean;
  isLoadingRegistry: boolean;
  error: Error | null;

  setAnimation: (name: string) => void;
  playSequence: (
    sequence: Omit<QueuedAnimation, "id">[],
    options?: PlaySequenceOptions
  ) => void;
  advanceQueue: () => void;
  clearSequence: () => void;
  setTransitioning: (isTransitioning: boolean) => void;
  loadRegistry: (registryData: AnimationRegistry) => void;
  setLoadingRegistry: (isLoading: boolean) => void;
  setError: (error: Error | null) => void;
}

export interface PlaySequenceOptions {
  /**
   * Maximum number of pending items allowed in the queue before the new
   * sequence is dropped.  Prevents stale animation backlogs during rapid
   * tool-call bursts.  Defaults to 3.
   */
  maxQueueDepth?: number;
  /**
   * When true the existing queue is cleared before the new sequence is
   * appended — useful for high-priority interruptions like `end_call`.
   */
  interrupt?: boolean;
}

// ─── ID generation (Fix AN4) ─────────────────────────────────────────────────
// Use crypto.randomUUID where available; fall back to a collision-resistant
// timestamp + random combination.
function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAnimationStore = create<AnimationState>((set) => ({
  currentAnimation: "idle",
  animationQueue: [],
  registry: {},
  isTransitioning: false,
  // Fix AN5: start as false — registry is populated synchronously by
  // useAnimationRegistry; consumers should check registry emptiness, not
  // isLoadingRegistry, to gate tool calls.
  isLoadingRegistry: false,
  error: null,

  // Hard-set the current animation and flush the queue.
  setAnimation: (name) => set({ currentAnimation: name, animationQueue: [] }),

  // Fix AN1, AN2, AN3
  playSequence: (sequenceParams, options = {}) => {
    const { maxQueueDepth = 10, interrupt = false } = options;

    set((state) => {
      // Interrupt mode: clear the existing queue first
      const baseQueue: QueuedAnimation[] = interrupt
        ? []
        : state.animationQueue;

      // Fix AN1: enforce queue depth cap to prevent stale animation backlog
      if (!interrupt && baseQueue.length >= maxQueueDepth) {
        // Queue is full — drop the incoming sequence silently.
        // Callers that need guaranteed playback should pass { interrupt: true }.
        return state;
      }

      const incoming: QueuedAnimation[] = sequenceParams.map((p) => ({
        ...p,
        id: generateId(), // Fix AN4
      }));

      const newQueue = [...baseQueue, ...incoming];

      // Fix AN2: always reflect the next animation that will play,
      // regardless of whether we're currently idle or not.
      // If the avatar is mid-animation, `currentAnimation` is updated to the
      // first new item only when the queue was previously empty (so we don't
      // override an in-progress animation). The avatar component drives actual
      // playback via `animationQueue[0]` — `currentAnimation` is the display
      // name for consumers.
      const isCurrentlyIdle =
        state.currentAnimation === "idle" ||
        state.animationQueue.length === 0;

      return {
        animationQueue: newQueue,
        // Fix AN2: show the incoming animation name immediately if idle,
        // or if we interrupted the queue
        currentAnimation:
          isCurrentlyIdle || interrupt
            ? (newQueue[0]?.name ?? "idle")
            : state.currentAnimation,
      };
    });
  },

  // Fix AN3: transition to idle only if the queue is truly empty after advance
  advanceQueue: () =>
    set((state) => {
      if (state.animationQueue.length <= 1) {
        // Queue drained — return to idle
        return { animationQueue: [], currentAnimation: "idle" };
      }
      const nextQueue = state.animationQueue.slice(1);
      return {
        animationQueue: nextQueue,
        currentAnimation: nextQueue[0].name,
      };
    }),

  clearSequence: () => set({ animationQueue: [], currentAnimation: "idle" }),

  setTransitioning: (isTransitioning) => set({ isTransitioning }),

  loadRegistry: (registryData) =>
    set({ registry: registryData, isLoadingRegistry: false }),

  // Fix AN5: expose setter so useAnimationRegistry can signal loading start
  setLoadingRegistry: (isLoading) => set({ isLoadingRegistry: isLoading }),

  setError: (error) => set({ error }),
}));