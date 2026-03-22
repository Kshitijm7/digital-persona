"use client";

import { useCallback, useRef, useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  /** True while speech-recognition chunks are still accumulating */
  pending?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Silence window before auto-finalizing a pending user message */
const USER_TRANSCRIPT_FINALIZE_DELAY_MS = 2_000;

/** Gap between chunks that triggers a new utterance instead of appending */
const USER_UTTERANCE_BREAK_MS = 4_000;

// ─── Merge helpers ────────────────────────────────────────────────────────────

/**
 * Merge streaming assistant text via overlap detection.
 * Assistant transcripts tend to arrive as progressively-longer strings
 * with overlapping prefixes — this handles that pattern.
 */
function mergeStreamingText(existing: string, incoming: string): string {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (existing.endsWith(incoming)) return existing;

  const maxOverlap = Math.min(existing.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (existing.slice(-overlap) === incoming.slice(0, overlap)) {
      return existing + incoming.slice(overlap);
    }
  }

  return existing + incoming;
}

/**
 * Merge a user transcript chunk into the accumulated text.
 *
 * Handles three speech-engine patterns:
 *
 * 1. **Cumulative / replacement** — incoming starts with what we have.
 *    → Replace with the longer incoming string.
 *
 * 2. **Overlapping delta** — shared suffix/prefix at the boundary.
 *    → Stitch at the overlap point.
 *
 * 3. **Raw delta** — no overlap at all (Gemini Live, etc.).
 *    → Concatenate. Preserve the original spacing from the engine.
 *      If neither side has whitespace at the boundary and incoming
 *      starts with a lowercase letter, assume mid-word split (no space).
 *      Otherwise insert a space (word boundary).
 *
 * NOTE: Upstream callers must NOT trim the incoming text — leading/trailing
 * spaces carry word-boundary information. Cleanup happens once during
 * finalization, not here.
 */
function mergeUserTranscriptChunk(
  existing: string,
  incoming: string
): string {
  if (!incoming) return existing;
  if (!existing) return incoming;

  // ── Pattern 1: Cumulative / replacement ─────────────────────────────────
  // Incoming is a superset of existing (common with interim → interim → final).
  const trimmedExisting = existing.trimEnd();
  if (incoming.startsWith(trimmedExisting)) {
    return incoming;
  }

  // Also check if incoming without leading space starts with existing
  const incomingTrimmedStart = incoming.trimStart();
  if (incomingTrimmedStart.startsWith(trimmedExisting)) {
    return incomingTrimmedStart;
  }

  // ── Pattern 2: Overlapping continuation ─────────────────────────────────
  const maxOverlap = Math.min(existing.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (existing.slice(-overlap) === incoming.slice(0, overlap)) {
      return existing + incoming.slice(overlap);
    }
  }

  // ── Pattern 3: Raw delta — no overlap ───────────────────────────────────
  const lastChar = existing[existing.length - 1];
  const firstChar = incoming[0];

  // If either side already has whitespace, just concat
  if (/\s/.test(lastChar) || /\s/.test(firstChar)) {
    return existing + incoming;
  }

  // Mid-word continuation: both sides are letters and incoming starts lowercase
  // e.g. "hel" + "lo" → "hello", "abo" + "ut" → "about"
  if (/[a-zA-Z]/.test(lastChar) && /[a-z]/.test(firstChar)) {
    return existing + incoming;
  }

  // Punctuation glued to previous word: "word" + "," → "word,"
  if (/[.,!?;:)}\]]/.test(firstChar)) {
    return existing + incoming;
  }

  // Default: word boundary — insert space
  return existing + " " + incoming;
}

/**
 * Clean up finalized message text:
 * - Collapse runs of whitespace
 * - Trim leading/trailing whitespace
 */
function cleanupFinalText(text: string): string {
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Chat messages management hook.
 *
 * Handles:
 * - Complete user messages (typed input)
 * - Buffered user transcript assembly (speech chunks → single message)
 * - Streaming assistant text (overlap-merged)
 * - Proper ordering (user finalized before assistant appears)
 */
export function useChatMessages() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  // ── Pending user message tracking ───────────────────────────────────────
  // These refs live OUTSIDE the state updater functions to avoid StrictMode
  // double-invocation issues. State updaters must be pure — ref mutations
  // happen in the useCallback body, before/after the setMessages call.
  const pendingUserIdRef = useRef<string | null>(null);
  const userFinalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const lastUserChunkTsRef = useRef<number>(0);

  // ── Timer management ────────────────────────────────────────────────────

  const clearUserFinalizeTimer = useCallback(() => {
    if (userFinalizeTimerRef.current !== null) {
      clearTimeout(userFinalizeTimerRef.current);
      userFinalizeTimerRef.current = null;
    }
  }, []);

  const scheduleUserFinalize = useCallback(
    (fn: () => void, delayMs: number) => {
      clearUserFinalizeTimer();
      userFinalizeTimerRef.current = setTimeout(() => {
        userFinalizeTimerRef.current = null;
        fn();
      }, delayMs);
    },
    [clearUserFinalizeTimer]
  );

  // ── Finalize pending user message ───────────────────────────────────────

  /**
   * Seal the current pending user message (if any).
   * - Cleans up the text (collapse whitespace, trim)
   * - Drops empty messages
   * - Resets pending tracking state
   *
   * Safe to call multiple times — no-ops if nothing is pending.
   */
  const finalizeUserMessage = useCallback(() => {
    clearUserFinalizeTimer();

    const pendingId = pendingUserIdRef.current;
    if (!pendingId) return;

    // Clear the ref BEFORE the state update so concurrent calls don't
    // try to finalize the same message twice.
    pendingUserIdRef.current = null;

    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === pendingId);
      if (idx === -1) return prev;

      const msg = prev[idx];
      if (!msg.pending) return prev; // already finalized

      const cleaned = cleanupFinalText(msg.content);

      // Drop empty messages entirely
      if (!cleaned) {
        return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
      }

      const updated = [...prev];
      updated[idx] = { ...msg, content: cleaned, pending: false };
      return updated;
    });
  }, [clearUserFinalizeTimer]);

  // ── addUserMessage (typed input) ────────────────────────────────────────

  /**
   * Add a complete user message from typed chat input.
   * Finalizes any in-progress speech transcript first.
   */
  const addUserMessage = useCallback(
    (content: string) => {
      finalizeUserMessage();

      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: new Date(),
        pending: false,
      };
      setMessages((prev) => [...prev, message]);
      setIsTyping(true);
      return message;
    },
    [finalizeUserMessage]
  );

  // ── appendUserTranscript (speech chunks) ────────────────────────────────

  /**
   * Append a user speech-recognition chunk.
   *
   * Chunks are merged into a single pending message using intelligent
   * pattern detection (replacement, overlap, raw delta with spacing).
   *
   * The message auto-finalizes after a silence window, or immediately
   * when `isFinal` is true, or when the assistant starts responding.
   *
   * IMPORTANT: Do NOT trim the `content` before passing it here —
   * leading/trailing spaces carry word-boundary information that the
   * merge logic depends on.
   */
  const appendUserTranscript = useCallback(
    (content: string, isFinal = false) => {
      // Only strip completely empty strings; preserve whitespace otherwise
      if (!content || content.trim().length === 0) return;

      clearUserFinalizeTimer();

      const now = Date.now();
      const gap = now - lastUserChunkTsRef.current;
      lastUserChunkTsRef.current = now;

      // If enough time has passed, treat this as a new utterance
      if (pendingUserIdRef.current !== null && gap > USER_UTTERANCE_BREAK_MS) {
        finalizeUserMessage();
      }

      // If there's a pending message, try to extend it
      const existingPendingId = pendingUserIdRef.current;

      if (existingPendingId) {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === existingPendingId);
          if (idx === -1 || !prev[idx].pending) {
            // Pending ref points to a message that no longer exists or is
            // already finalized. This shouldn't happen, but handle gracefully
            // by falling through to "create new" below.
            return prev;
          }

          const existing = prev[idx];
          const merged = mergeUserTranscriptChunk(existing.content, content);
          if (merged === existing.content) return prev; // no change

          const updated = [...prev];
          updated[idx] = { ...existing, content: merged };
          return updated;
        });
      }

      // If no pending message exists (or the ref was stale), create one.
      // We check the ref again because the state update above is synchronous
      // with React 18 batching inside event handlers.
      if (!pendingUserIdRef.current) {
        const id = crypto.randomUUID();
        pendingUserIdRef.current = id;

        setMessages((prev) => [
          ...prev,
          {
            id,
            role: "user" as const,
            content: content.trimStart(), // only trim leading space on first chunk
            timestamp: new Date(),
            pending: true,
          },
        ]);
      }

      // If the speech engine signals final, finalize after the state settles
      if (isFinal) {
        queueMicrotask(() => finalizeUserMessage());
        return;
      }

      // Schedule auto-finalization after silence window
      scheduleUserFinalize(finalizeUserMessage, USER_TRANSCRIPT_FINALIZE_DELAY_MS);
    },
    [clearUserFinalizeTimer, finalizeUserMessage, scheduleUserFinalize]
  );

  // ── addAssistantMessage (complete) ──────────────────────────────────────

  /**
   * Add a complete assistant message (non-streaming).
   * Finalizes any pending user transcript first to preserve ordering.
   */
  const addAssistantMessage = useCallback(
    (content: string) => {
      finalizeUserMessage();

      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content,
        timestamp: new Date(),
        pending: false,
      };
      setMessages((prev) => [...prev, message]);
      setIsTyping(false);
      return message;
    },
    [finalizeUserMessage]
  );

  // ── appendAssistantMessage (streaming) ──────────────────────────────────

  /**
   * Append streaming assistant text via overlap merge.
   *
   * Does NOT finalize pending user messages — this is intentional.
   * In fast-paced exchanges the assistant transcript stream can overlap
   * with the tail end of the user's speech. Finalizing here would cut
   * the user's message short. Instead, finalization is triggered by:
   *   - The silence timer in appendUserTranscript
   *   - The isTyping transition watcher in page.tsx
   *   - Explicit calls (disconnect, typed input, etc.)
   */
  const appendAssistantMessage = useCallback(
    (content: string) => {
      if (!content) return;

      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1];

        // Extend the last assistant message if it exists and is not pending-user
        if (
          lastMessage &&
          lastMessage.role === "assistant" &&
          !lastMessage.pending
        ) {
          const merged = mergeStreamingText(lastMessage.content, content);
          if (merged === lastMessage.content) return prev; // no change

          return [
            ...prev.slice(0, -1),
            { ...lastMessage, content: merged },
          ];
        }

        // Create a new assistant message
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content,
            timestamp: new Date(),
            pending: false,
          },
        ];
      });
      setIsTyping(false);
    },
    []
  );

  // ── clearMessages ───────────────────────────────────────────────────────

  /**
   * Clear all messages and reset all internal state.
   */
  const clearMessages = useCallback(() => {
    clearUserFinalizeTimer();
    pendingUserIdRef.current = null;
    lastUserChunkTsRef.current = 0;
    setMessages([]);
    setIsTyping(false);
  }, [clearUserFinalizeTimer]);

  // ── Return ──────────────────────────────────────────────────────────────

  return {
    messages,
    isTyping,
    addUserMessage,
    appendUserTranscript,
    addAssistantMessage,
    appendAssistantMessage,
    finalizeUserMessage,
    clearMessages,
    setIsTyping,
  };
}
