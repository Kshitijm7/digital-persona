"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIO_CONFIG } from "@/lib/constants";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("useWebcam");

export function useWebcam() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Fix W7: canvasRef as a hook ref so it's cleaned up with the component
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onFrameRef = useRef<((base64: string) => void) | null>(null);

  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Fix W1, W9: facingMode as a ref + state pair.
  // The ref is read by start/switchCamera callbacks so they never
  // need facingMode in their dep arrays — eliminating stale closure issues.
  // The state is only for consumers that need to re-render on change.
  const facingModeRef = useRef<"user" | "environment">("user");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  // Fix W8: track the active stream in a ref (not state) to avoid
  // triggering re-renders and the cleanup effect on every start call.
  const activeStreamRef = useRef<MediaStream | null>(null);

  // Fix W4: lock to prevent concurrent start calls during switchCamera
  const isStartingRef = useRef(false);

  // ── Internal stop (does not touch state unless explicit) ──────────────────
  const stopInternal = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    // Fix W3: always stop the ref-tracked stream, not the video element's srcObject
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
    async (forcedFacingMode?: "user" | "environment"): Promise<boolean> => {
      // Fix W4: prevent concurrent starts
      if (isStartingRef.current) {
        log.warn("start() called while already starting; ignoring.");
        return false;
      }
      isStartingRef.current = true;

      const mode = forcedFacingMode ?? facingModeRef.current;
      setError(null);

      try {
        // Permission pre-flight
        if (navigator.permissions?.query) {
          try {
            const perm = await navigator.permissions.query({
              name: "camera" as PermissionName,
            });
            if (perm.state === "denied") {
              throw new Error(
                "Camera access is explicitly denied in browser settings."
              );
            }
          } catch (e) {
            log.debug({ err: e }, "Camera permission query skipped.");
          }
        }

        // Fix W8: stop any existing stream before starting a new one
        stopInternal();

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: mode },
        });

        // Attach to video element
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          await videoRef.current.play().catch((playErr) => {
            log.warn({ err: playErr }, "Video play() was interrupted.");
          });
        }

        // Fix W7: create canvas once, keep in ref
        if (!canvasRef.current) {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          canvasRef.current = canvas;
        }

        // Clear any stale interval before starting a new one (Fix W6)
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
            AUDIO_CONFIG.video_quality
          );
          const base64 = dataUrl.split(",")[1];
          if (base64) onFrameRef.current?.(base64);
        }, 1000 / AUDIO_CONFIG.video_fps);

        // Fix W1, W9: update both ref and state atomically after success
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
          if (
            err.name === "NotFoundError" ||
            err.name === "DevicesNotFoundError"
          ) {
            errorMsg = "No camera found. Please plug one in.";
          } else if (
            err.name === "NotAllowedError" ||
            err.name === "PermissionDeniedError"
          ) {
            errorMsg =
              "Camera access was denied. Please allow it in settings.";
          } else if (
            err.name === "NotReadableError" ||
            err.name === "TrackStartError"
          ) {
            errorMsg = "Camera is already in use by another application.";
          }
        } else if (err instanceof Error) {
          errorMsg = err.message;
        }
        setError(new Error(errorMsg));
        return false;
      }
    },
    // Fix W5, W9: facingMode removed from deps — read via facingModeRef instead
    [stopInternal]
  );

  // ── stop ──────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    stopInternal();
    setIsActive(false);
    log.info("Webcam stopped explicitly.");
  }, [stopInternal]);

  // ── switchCamera (Fix W4, W5) ─────────────────────────────────────────────
  // Does not depend on `start` or `facingMode` state — reads mode via ref.
  const switchCamera = useCallback(async (): Promise<boolean> => {
    const nextMode =
      facingModeRef.current === "user" ? "environment" : "user";
    log.info(
      { from: facingModeRef.current, to: nextMode },
      "Switching camera facing mode."
    );

    // Fix W4: stop the current stream and wait one microtask so the OS
    // camera mutex is released before we request the new stream.
    stopInternal();
    setIsActive(false);

    // Yield to allow the OS to release the camera hardware mutex
    await new Promise<void>((resolve) => setTimeout(resolve, 120));

    const success = await start(nextMode);
    if (!success) {
      log.warn(
        { nextMode },
        "Camera switch failed; attempting to restore previous facing mode."
      );
      // Try to restore the previous camera
      await start(facingModeRef.current === nextMode
        ? (nextMode === "user" ? "environment" : "user")
        : facingModeRef.current
      );
    }
    return success;
  }, [start, stopInternal]);

  // ── Cleanup on unmount (Fix W1, W2) ──────────────────────────────────────
  // Single cleanup effect — no stream state dependency, so it runs
  // only on unmount, not on every camera start.
  useEffect(() => {
    return () => {
      stopInternal();
      // Fix W7: release canvas reference
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