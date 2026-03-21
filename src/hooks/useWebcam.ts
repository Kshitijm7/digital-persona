"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIO_CONFIG } from "@/lib/constants";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("useWebcam");

export function useWebcam() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onFrameRef = useRef<((base64: string) => void) | null>(null);

  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const facingModeRef = useRef<"user" | "environment">("user");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  const activeStreamRef = useRef<MediaStream | null>(null);
  const isStartingRef = useRef(false);

  // FIX(1): Generation counter — bumped by stopInternal, checked after
  // every await in start(). Detects stale async continuations so we can
  // kill orphaned MediaStreams instead of leaking them.
  const genRef = useRef(0);

  // ── Internal stop ─────────────────────────────────────────────────────────
  const stopInternal = useCallback(() => {
    // FIX(1): Invalidate any in-flight start()
    genRef.current++;

    // FIX(3): Unlock so a new start() isn't permanently blocked
    isStartingRef.current = false;

    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((t) => t.stop());
      activeStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // ── start ─────────────────────────────────────────────────────────────────
  const start = useCallback(
    async (
      forcedFacingMode?: "user" | "environment",
      fpsOverride?: number,
    ): Promise<boolean> => {
      if (isStartingRef.current) {
        log.warn("start() called while already starting; ignoring.");
        return false;
      }
      isStartingRef.current = true;

      const mode = forcedFacingMode ?? facingModeRef.current;
      setError(null);

      // Stop existing stream, then snapshot the generation AFTER the bump
      stopInternal();
      // Re-acquire the lock (stopInternal clears it)
      isStartingRef.current = true;
      const gen = genRef.current;

      try {
        // Permission pre-flight
        if (navigator.permissions?.query) {
          try {
            const perm = await navigator.permissions.query({
              name: "camera" as PermissionName,
            });
            if (perm.state === "denied") {
              throw new Error(
                "Camera access is explicitly denied in browser settings.",
              );
            }
          } catch (e) {
            log.debug({ err: e }, "Camera permission query skipped.");
          }
        }

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: mode },
        });

        // FIX(1): If stop() or another start() fired while we were awaiting
        // getUserMedia, the generation has changed — discard the stream.
        if (gen !== genRef.current) {
          mediaStream.getTracks().forEach((t) => t.stop());
          isStartingRef.current = false;
          log.info("start() cancelled by concurrent stop/start; stream discarded.");
          return false;
        }

        // Attach to video element
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          await videoRef.current.play().catch((playErr) => {
            log.warn({ err: playErr }, "Video play() was interrupted.");
          });
        }

        // FIX(1): Check again after second await
        if (gen !== genRef.current) {
          mediaStream.getTracks().forEach((t) => t.stop());
          if (videoRef.current) videoRef.current.srcObject = null;
          isStartingRef.current = false;
          return false;
        }

        // FIX(2): Detect external camera loss (permission revoked, device
        // unplugged). Without this, isActive stays true and the interval
        // keeps firing on a dead stream.
        const videoTrack = mediaStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.addEventListener(
            "ended",
            () => {
              log.warn("Camera track ended externally (revoked / unplugged).");
              stopInternal();
              setIsActive(false);
              setError(
                new Error("Camera was disconnected or permission was revoked."),
              );
            },
            { once: true },
          );
        }

        // Create canvas once
        if (!canvasRef.current) {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          canvasRef.current = canvas;
        }

        // Clear stale interval before starting a new one
        if (intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }

        intervalRef.current = setInterval(() => {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas || video.readyState < 2) return;

          const ctx2d = canvas.getContext("2d");
          if (!ctx2d) return;

          ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL(
            "image/jpeg",
            AUDIO_CONFIG.video_quality,
          );
          const base64 = dataUrl.split(",")[1];
          if (base64) onFrameRef.current?.(base64);
        }, 1000 / (fpsOverride ?? AUDIO_CONFIG.video_fps));

        activeStreamRef.current = mediaStream;
        facingModeRef.current = mode;
        setFacingMode(mode);
        setIsActive(true);
        isStartingRef.current = false;

        log.info({ facingMode: mode }, "Webcam started successfully.");
        return true;
      } catch (err) {
        isStartingRef.current = false;
        log.error({ err, facingMode: mode }, "Webcam access denied or unavailable.");

        let errorMsg = "Could not access camera.";
        if (err instanceof DOMException) {
          switch (err.name) {
            case "NotFoundError":
            case "DevicesNotFoundError":
              errorMsg = "No camera found. Please plug one in.";
              break;
            case "NotAllowedError":
            case "PermissionDeniedError":
              errorMsg =
                "Camera access was denied. Please allow it in settings.";
              break;
            case "NotReadableError":
            case "TrackStartError":
              errorMsg = "Camera is already in use by another application.";
              break;
          }
        } else if (err instanceof Error) {
          errorMsg = err.message;
        }
        setError(new Error(errorMsg));
        return false;
      }
    },
    [stopInternal],
  );

  // ── stop ──────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    stopInternal();
    setIsActive(false);
    log.info("Webcam stopped explicitly.");
  }, [stopInternal]);

  // ── switchCamera ──────────────────────────────────────────────────────────
  const switchCamera = useCallback(async (): Promise<boolean> => {
    const nextMode =
      facingModeRef.current === "user" ? "environment" : "user";
    log.info(
      { from: facingModeRef.current, to: nextMode },
      "Switching camera facing mode.",
    );

    stopInternal();
    setIsActive(false);

    // Yield so the OS releases the camera hardware mutex
    await new Promise<void>((resolve) => setTimeout(resolve, 120));

    const success = await start(nextMode);

    // FIX(4): Simplified — start() only updates facingModeRef on success,
    // so on failure the ref is still the previous mode. The original
    // ternary always resolved to this same value.
    if (!success) {
      log.warn(
        { nextMode },
        "Camera switch failed; attempting to restore previous camera.",
      );
      await start(facingModeRef.current);
    }
    return success;
  }, [start, stopInternal]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopInternal();
      canvasRef.current = null;
      log.info("Webcam unmounted; resources released.");
    };
  }, [stopInternal]);

  return {
    videoRef,
    isActive,
    facingMode,
    permissionError: error,
    start,
    stop,
    switchCamera,
    onFrameRef,
  };
}