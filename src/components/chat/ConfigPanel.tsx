"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";

import { useSceneConfig, type SceneConfig, type FeatureToggles, type LightConfig } from "@/hooks/SceneConfigContext";
import { Copy, Save } from "lucide-react";
import { useLipSyncStore, DEFAULT_LIPSYNC_TUNING, LIPSYNC_PRESETS, type LipSyncPresetKey } from "@/store/useLipSyncStore";

import { CameraSection } from "./config/CameraSection";
import { AvatarSection } from "./config/AvatarSection";
import { LightingSection } from "./config/LightingSection";
import { FeaturesSection } from "./config/FeaturesSection";
import { LipSyncSection } from "./config/LipSyncSection";

export function ConfigPanel() {
  const { config, setConfig, avatarRegistry } = useSceneConfig();
  const lipSyncTuning = useLipSyncStore((state) => state.tuning);
  const activePreset = useLipSyncStore((state) => state.activePreset);
  const updateLipSyncTuning = useLipSyncStore((state) => state.updateTuning);
  const resetLipSyncTuning = useLipSyncStore((state) => state.resetTuning);
  const setActivePresetStore = useLipSyncStore((state) => state.setActivePreset);
  
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Local mutable draft state so edits are instant
  const [draft, setDraft] = useState<SceneConfig>(config);

  // Apply draft to context (instant scene update) + persist to disk
  const handleSet = useCallback(async () => {
    setConfig(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);

    try {
      await fetch("/api/camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
    } catch (e) {
      console.error("Failed to save config:", e);
    }
  }, [draft, setConfig]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(draft, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [draft]);

  // Shortcut to update nested draft fields
  const patchCamera = (p: Partial<SceneConfig["camera"]>) => {
    const next = { ...draft, camera: { ...draft.camera, ...p } };
    setDraft(next);
    setConfig(next);
  };
  
  const patchAvatar = (p: Partial<SceneConfig["avatar"]>) => {
    const next = { ...draft, avatar: { ...draft.avatar, ...p } };
    setDraft(next);
    setConfig(next);
  };
  
  const patchLight = (key: "keyLight" | "fillLight" | "rimLight", l: LightConfig) => {
    const next = {
      ...draft,
      lighting: { ...draft.lighting, [key]: l },
    };
    setDraft(next);
    setConfig(next);
  };

  const toggleFeatureLocal = (key: keyof FeatureToggles) => {
    const next = {
      ...draft,
      features: { ...draft.features, [key]: !draft.features[key] },
    };
    setDraft(next);
    setConfig(next);
  };

  const patchLipSync = (patch: Partial<typeof lipSyncTuning>) => {
    const merged = { ...lipSyncTuning, ...patch };
    updateLipSyncTuning(patch);
    const next = { ...draft, lipSyncTuning: merged };
    setDraft(next);
    setConfig(next);
  };

  const applyLipSyncPreset = (preset: LipSyncPresetKey) => {
    const values = LIPSYNC_PRESETS[preset].values;
    setActivePresetStore(preset);
    updateLipSyncTuning(values);
    const next = { ...draft, lipSyncTuning: { ...values } };
    setDraft(next);
    setConfig(next);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-black/10">
      {/* Scrollable Area for Settings */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 thin-scrollbar">
        <CameraSection draft={draft} patchCamera={patchCamera} />
        <AvatarSection draft={draft} patchAvatar={patchAvatar} avatarRegistry={avatarRegistry} />
        <LightingSection draft={draft} patchLight={patchLight} />
        <FeaturesSection draft={draft} toggleFeatureLocal={toggleFeatureLocal} />
        <LipSyncSection 
          draft={draft} 
          patchLipSync={patchLipSync} 
          applyLipSyncPreset={applyLipSyncPreset}
          setDraft={setDraft}
          setConfig={setConfig}
        />
      </div>

      {/* ── Fixed Footer Actions ─────────────────────────────────── */}
      <div className="p-4 bg-black/40 border-t border-white/5 shrink-0 backdrop-blur-xl">
        <div className="flex gap-2">
          <button
            onClick={handleSet}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-semibold transition-all duration-300",
              saved
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                : "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/25 hover:shadow-[0_0_15px_rgba(34,211,238,0.15)] active:scale-[0.98]"
            )}
          >
            <Save className="w-3.5 h-3.5" />
            {saved ? "✅ Saved!" : "Save Config"}
          </button>
          <button
            onClick={handleCopy}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-semibold transition-all duration-300",
              copied
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 hover:text-foreground active:scale-[0.98]"
            )}
          >
            <Copy className="w-3.5 h-3.5" />
            {copied ? "✅ Copied!" : "Copy Config"}
          </button>
        </div>
        
        {/* Helper Hint */}
        <p className="text-[9.5px] text-muted-foreground/40 text-center mt-3 font-medium tracking-wide">
          Changes apply instantly · Save to persist
        </p>
      </div>
    </div>
  );
}
