"use client";

import { useEffect, useRef, useCallback } from "react";
import { useThree } from "@react-three/fiber";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("WebGLContextGuard");

/**
 * Place this inside the R3F <Canvas> component tree.
 * Detects WebGL context loss and triggers a full renderer reset.
 */
export function WebGLContextGuard({
  onContextLost,
  onContextRestored,
}: {
  onContextLost?: () => void;
  onContextRestored?: () => void;
}) {
  const { gl } = useThree();
  const restoredRef = useRef(false);

  const handleContextLost = useCallback(
    (e: Event) => {
      e.preventDefault(); // Required — tells browser we will handle restoration
      restoredRef.current = false;
      log.warn("WebGL context lost — suspending render loop.");
      onContextLost?.();
    },
    [onContextLost]
  );

  const handleContextRestored = useCallback(() => {
    restoredRef.current = true;
    log.info("WebGL context restored — resuming render loop.");
    // Force Three.js to reinitialize its internal state
    gl.setSize(gl.domElement.width, gl.domElement.height);
    onContextRestored?.();
  }, [gl, onContextRestored]);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
    };
  }, [gl, handleContextLost, handleContextRestored]);

  return null;
}
