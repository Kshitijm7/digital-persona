import React from "react";

export function DebugToggle({
  debugMode,
  setDebugMode,
}: {
  debugMode: boolean;
  setDebugMode: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  return (
    <button
      id="debug-mode-toggle"
      onClick={() => setDebugMode((v) => !v)}
      title={debugMode ? "Disable camera debug mode" : "Enable camera debug mode"}
      className={`absolute right-4 top-37 z-20 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold tracking-[0.05em] backdrop-blur-xl transition-colors sm:right-6 sm:top-55 ${
        debugMode
          ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-400"
          : "border-white/12 bg-white/6 text-slate-400 hover:bg-white/10 hover:text-slate-200"
      }`}
    >
      ⚙ {debugMode ? "Config ON" : "Config"}
    </button>
  );
}
