"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";

import { useSceneConfig, type SceneConfig, type FeatureToggles, type LightConfig } from "@/hooks/SceneConfigContext";
import { Copy, Save, RotateCcw } from "lucide-react";
import { useLipSyncStore, LIPSYNC_PRESETS, type LipSyncPresetKey } from "@/store/useLipSyncStore";

import { CameraSection } from "./config/CameraSection";
import { AvatarSection } from "./config/AvatarSection";
import { LightingSection } from "./config/LightingSection";
import { FeaturesSection } from "./config/FeaturesSection";
import { LipSyncSection } from "./config/LipSyncSection";
import { AvatarRealismSection } from "./config/AvatarRealismSection";
import { ModeSection } from "./config/ModeSection";

export function ConfigPanel() {
  const { config, setConfig, resetConfig, avatarRegistry } = useSceneConfig();
  const lipSyncTuning = useLipSyncStore((state) => state.tuning);
  const updateLipSyncTuning = useLipSyncStore((state) => state.updateTuning);
  const setActivePresetStore = useLipSyncStore((state) => state.setActivePreset);
  const resetLipSyncTuning = useLipSyncStore((state) => state.resetTuning);
  
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Local mutable draft state so edits are instant
  const [draft, setDraft] = useState<SceneConfig>(config);

  // Apply draft to context (instant scene update) and localStorage
  const handleSet = useCallback(async () => {
    setConfig(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [draft, setConfig]);

  const handleReset = useCallback(() => {
    if (!confirm("Are you sure you want to reset all configurations to the server defaults?")) return;
    setResetting(true);
    resetConfig();
    resetLipSyncTuning();
    // Assuming context provides the INITIAL_CONFIG somehow... instead we can just reload the page or read the latest from context on next effect
    setTimeout(() => {
      window.location.reload();
    }, 500);
  }, [resetConfig, resetLipSyncTuning]);

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

  const patchAvatarControls = (
    patch: {
      emotionControl?: Partial<SceneConfig["emotionControl"]>;
      ocularTuning?: Partial<SceneConfig["ocularTuning"]>;
      meshPostProcessing?: Partial<SceneConfig["meshPostProcessing"]>;
      headDynamics?: Partial<SceneConfig["headDynamics"]>;
      anatomicalPostProcessing?: Partial<SceneConfig["anatomicalPostProcessing"]>;
      visemeOverrides?: Partial<SceneConfig["visemeOverrides"]>;
      aiStyleControl?: Partial<SceneConfig["aiStyleControl"]>;
      meshConfig?: Partial<SceneConfig["meshConfig"]>;
    },
  ) => {
    const next: SceneConfig = {
      ...draft,
      emotionControl: patch.emotionControl
        ? { ...draft.emotionControl, ...patch.emotionControl }
        : draft.emotionControl,
      ocularTuning: patch.ocularTuning
        ? { ...draft.ocularTuning, ...patch.ocularTuning }
        : draft.ocularTuning,
      meshPostProcessing: patch.meshPostProcessing
        ? { ...draft.meshPostProcessing, ...patch.meshPostProcessing }
        : draft.meshPostProcessing,
      headDynamics: patch.headDynamics
        ? { ...draft.headDynamics, ...patch.headDynamics }
        : draft.headDynamics,
      anatomicalPostProcessing: patch.anatomicalPostProcessing
        ? { ...draft.anatomicalPostProcessing, ...patch.anatomicalPostProcessing }
        : draft.anatomicalPostProcessing,
      visemeOverrides: patch.visemeOverrides
        ? { ...draft.visemeOverrides, ...patch.visemeOverrides }
        : draft.visemeOverrides,
      aiStyleControl: patch.aiStyleControl
        ? { ...draft.aiStyleControl, ...patch.aiStyleControl }
        : draft.aiStyleControl,
      meshConfig: patch.meshConfig
        ? { ...draft.meshConfig, ...patch.meshConfig }
        : draft.meshConfig,
    };

    setDraft(next);
    setConfig(next);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-black/10">
      {/* Scrollable Area for Settings */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 thin-scrollbar">
        <ModeSection />
        <CameraSection draft={draft} patchCamera={patchCamera} />
        <AvatarSection draft={draft} patchAvatar={patchAvatar} avatarRegistry={avatarRegistry} />
        <LightingSection draft={draft} patchLight={patchLight} />
        <FeaturesSection draft={draft} toggleFeatureLocal={toggleFeatureLocal} />
        <AvatarRealismSection draft={draft} patchAvatarControls={patchAvatarControls} />
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
            {copied ? "✅ Copied!" : "Copy"}
          </button>
          <button
            onClick={handleReset}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-semibold transition-all duration-300",
              resetting
                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                : "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:text-red-300 active:scale-[0.98]"
            )}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {resetting ? "Resetting..." : "Reset"}
          </button>
        </div>
        
        {/* Helper Hint */}
        <p className="text-[9.5px] text-muted-foreground/40 text-center mt-3 font-medium tracking-wide">
          Changes apply instantly · Save to persist locally
        </p>
      </div>
    </div>
  );
}
