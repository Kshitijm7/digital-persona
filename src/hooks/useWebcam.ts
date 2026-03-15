"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIO_CONFIG } from "@/lib/constants";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("useWebcam");

/**
 * Manages the webcam stream and captures frames as base64 JPEG.
 */
export function useWebcam() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const onFrameRef = useRef<((base64: string) => void) | null>(null);

  const start = useCallback(async (forcedFacingMode?: "user" | "environment") => {
    const mode = forcedFacingMode || facingMode;
    setError(null);
    try {
      // Explicitly check permissions on browsers that support it
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const perm = await navigator.permissions.query({ name: "camera" as PermissionName });
          if (perm.state === "denied") {
            throw new Error("Camera access is explicitly denied in browser settings.");
          }
        } catch (e) {
          // Ignore if browser doesn't support 'camera' permission query
          log.info({ e }, "Permission query skipped");
        }
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: mode },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }

      // Create an offscreen canvas for frame capture
      if (!canvasRef.current) {
        canvasRef.current = document.createElement("canvas");
        canvasRef.current.width = 640;
        canvasRef.current.height = 480;
      }

      // Capture frames at configured FPS
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", AUDIO_CONFIG.video_quality);
        // Strip the data:image/jpeg;base64, prefix
        const base64 = dataUrl.split(",")[1];
        onFrameRef.current?.(base64);
      }, 1000 / AUDIO_CONFIG.video_fps);

      setIsActive(true);
      setStream(mediaStream);
      setFacingMode(mode);
      log.info({ facingMode: mode }, "Webcam started successfully");
      return true;
    } catch (err) {
      log.error({ err, facingMode: mode }, "Webcam access denied or unavailable");
      let errorMsg = "Could not access camera.";
      if (err instanceof DOMException) {
        if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          errorMsg = "No camera found. Please plug one in.";
        } else if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          errorMsg = "Camera access was denied. Please allow it in settings.";
        } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
          errorMsg = "Camera is already in use by another application.";
        }
      } else if (err instanceof Error) {
        errorMsg = err.message;
      }
      setError(new Error(errorMsg));
      return false;
    }
  }, [facingMode]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (videoRef.current?.srcObject) {
      const currentStream = videoRef.current.srcObject as MediaStream;
      currentStream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsActive(false);
  }, []);

  const switchCamera = useCallback(async () => {
    const nextMode = facingMode === "user" ? "environment" : "user";
    log.info({ from: facingMode, to: nextMode }, "Switching camera facing mode.");
    stop();
    await start(nextMode);
  }, [facingMode, start, stop]);

  useEffect(() => {
    return () => {
      setStream(null);
      log.info("Webcam stopped explicitly");
    }
  }, [stream]);

  return { videoRef, isActive, facingMode, permissionError: error, start, stop, switchCamera, onFrameRef };
}
