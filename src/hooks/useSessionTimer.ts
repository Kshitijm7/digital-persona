"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Counts elapsed seconds while `isActive` is true.
 * Resets to zero when `isActive` becomes false.
 */
export function useSessionTimer(isActive: boolean) {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Clear any existing interval before potentially starting a new one
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (isActive) {
      intervalRef.current = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1_000);
    } else {
      // Reset happens here — after the interval is already cleared above,
      // so there is no race between the final tick and the reset.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeconds(0);
      
    }

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isActive]);

  // Fix #3: derive formatted string only when `seconds` changes.
  const formatted = useMemo(() => {
    const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
    const ss = (seconds % 60).toString().padStart(2, "0");
    return `${mm}:${ss}`;
  }, [seconds]);

  return { seconds, formatted };
}