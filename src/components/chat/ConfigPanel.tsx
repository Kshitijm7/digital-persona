"use client";

import { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  useSceneConfig,
  type SceneConfig,
  type FeatureToggles,
  type LightConfig,
} from "@/hooks/SceneConfigContext";
import { Copy, Save, ChevronDown, ChevronRight } from "lucide-react";
import { useAnimationStore } from "@/store/useAnimationStore";
import { type AnimationMeta } from "@/lib/animationRegistry.types";
import {
  DEFAULT_LIPSYNC_TUNING,
  LIPSYNC_PRESETS,
  type LipSyncPresetKey,
  useLipSyncStore,
} from "@/store/useLipSyncStore";

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

function fmt(n: number) {
  return parseFloat(n.toFixed(4));
}

/* ─── Toggle Row ───────────────────────────────────────────────────────────── */

function ToggleSwitch({
  label,
  checked,
  onChange,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-1.5 px-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground/90">{label}</span>
        <button
          onClick={onChange}
          className={cn(
            "relative flex items-center h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            checked ? "bg-cyan-500" : "bg-white/10"
          )}
        >
          <span
            className={cn(
              "pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200",
              checked ? "translate-x-4" : "translate-x-0.5"
            )}
          />
        </button>
      </div>
      {description && <p className="text-[9px] text-muted-foreground/50 leading-tight pr-4">{description}</p>}
    </div>
  );
}

/* ─── Number Input ─────────────────────────────────────────────────────────── */

function NumInput({
  label,
  value,
  onChange,
  step = 0.01,
  min,
  max,
  description,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground/60 w-5 shrink-0">{label}</span>
        <input
          type="number"
          value={fmt(value)}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="flex-1 bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-foreground/90 font-mono focus:outline-none focus:border-cyan-400/40 w-full min-w-0"
        />
      </div>
      {description && <p className="text-[9px] text-muted-foreground/50 leading-tight">{description}</p>}
    </div>
  );
}

/* ─── Color Input ──────────────────────────────────────────────────────────── */

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground/60 shrink-0">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-6 h-6 rounded border border-white/10 bg-transparent cursor-pointer p-0"
      />
      <span className="text-[10px] text-muted-foreground/50 font-mono">{value}</span>
    </div>
  );
}

/* ─── Vec3 Input ───────────────────────────────────────────────────────────── */

function Vec3Input({
  label,
  value,
  onChange,
  step = 0.01,
  description,
}: {
  label: string;
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  step?: number;
  description?: string;
}) {
  const update = (idx: number, v: number) => {
    const next = [...value] as [number, number, number];
    next[idx] = v;
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] text-muted-foreground/60">{label}</p>
      <div className="grid grid-cols-3 gap-1">
        <NumInput label="X" value={value[0]} onChange={(v) => update(0, v)} step={step} />
        <NumInput label="Y" value={value[1]} onChange={(v) => update(1, v)} step={step} />
        <NumInput label="Z" value={value[2]} onChange={(v) => update(2, v)} step={step} />
      </div>
      {description && <p className="text-[9px] text-muted-foreground/50 leading-tight mt-0.5">{description}</p>}
    </div>
  );
}

/* ─── Collapsible Section ──────────────────────────────────────────────────── */

function Section({
  title,
  accent = "#22d3ee",
  children,
  defaultOpen = true,
}: {
  title: string;
  accent?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-white/8 rounded-xl bg-black/20 overflow-hidden shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-white/4 hover:bg-white/8 transition-colors border-b border-transparent data-[open=true]:border-white/5"
        data-open={open}
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: accent }} />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: accent }} />
        )}
        <span
          className="text-[10px] font-bold uppercase tracking-[0.15em] flex-1 text-left"
          style={{ color: accent }}
        >
          {title}
        </span>
      </button>
      {open && <div className="px-3 py-3 flex flex-col gap-3 border-t border-white/5 bg-white/2">{children}</div>}
    </div>
  );
}

/* ─── Light Editor ─────────────────────────────────────────────────────────── */

function LightEditor({
  label,
  light,
  onChange,
}: {
  label: string;
  light: LightConfig;
  onChange: (l: LightConfig) => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-2 bg-white/3 rounded-lg">
      <p className="text-[10px] font-semibold text-muted-foreground/70">{label}</p>
      <Vec3Input
        label="Position"
        value={light.position}
        onChange={(p) => onChange({ ...light, position: p })}
        step={0.1}
        description="Light source coordinates."
      />
      <NumInput
        label="Int"
        value={light.intensity}
        onChange={(v) => onChange({ ...light, intensity: v })}
        step={0.1}
        description="Lumen intensity / brightness."
      />
      <ColorInput
        label="Color"
        value={light.color}
        onChange={(c) => onChange({ ...light, color: c })}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  ConfigPanel                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function ConfigPanel() {
  const { config, setConfig, avatarRegistry } = useSceneConfig();
  const lipSyncTuning = useLipSyncStore((state) => state.tuning);
  const updateLipSyncTuning = useLipSyncStore((state) => state.updateTuning);
  const resetLipSyncTuning = useLipSyncStore((state) => state.resetTuning);
  const [activePreset, setActivePreset] = useState<LipSyncPresetKey>("balanced");
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
    setDraft((prev) => {
      const next = { ...prev, lipSyncTuning: merged };
      setConfig(next);
      return next;
    });
  };

  const applyLipSyncPreset = (preset: LipSyncPresetKey) => {
    const values = LIPSYNC_PRESETS[preset].values;
    setActivePreset(preset);
    updateLipSyncTuning(values);
    setDraft((prev) => {
      const next = { ...prev, lipSyncTuning: { ...values } };
      setConfig(next);
      return next;
    });
  };

  const earlyGuide = useMemo(
    () => [
      "If mouth moves too early: lower Clock Ratio or Max Clock.",
      "If mouth moves too late: increase Clock Ratio slightly, lower analyzer smoothing, or lower persistence.",
      "If motion is jittery: increase Min Switch intervals or slightly increase Antic ms.",
      "If motion is robotic: increase Antic ms/Antic Weight or reduce Lambda P only if closures look abrupt.",
    ],
    [],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-black/10">
      {/* Scrollable Area for Settings */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 thin-scrollbar">

      {/* ── Camera Section ────────────────────────────────────── */}
      <Section title="Camera" accent="#22d3ee">
        <Vec3Input
          label="Position"
          value={draft.camera.position}
          onChange={(p) => patchCamera({ position: p })}
          description="World coordinates of the camera lens."
        />
        <NumInput
          label="FOV"
          value={draft.camera.fov}
          onChange={(v) => patchCamera({ fov: v })}
          step={1}
          description="Field of view (degrees). Wider values show more context."
        />
        <Vec3Input
          label="Target"
          value={draft.camera.target}
          onChange={(t) => patchCamera({ target: t })}
          description="The focal point the camera look at and orbits around."
        />
        <NumInput
          label="Min Dist"
          value={draft.camera.controlsMinDistance ?? 0.5}
          onChange={(v) => patchCamera({ controlsMinDistance: v })}
          step={0.1}
          description="Closest zoom limit (prevents clipping into mesh)."
        />
        <NumInput
          label="Max Dist"
          value={draft.camera.controlsMaxDistance ?? 3.2}
          onChange={(v) => patchCamera({ controlsMaxDistance: v })}
          step={0.1}
          description="Furthest zoom limit (keeps character in frame)."
        />
        <NumInput
          label="Min Polar (rad)"
          value={draft.camera.minPolarAngle ?? 1.4}
          onChange={(v) => patchCamera({ minPolarAngle: v })}
          step={0.05}
          max={3.14}
          description="Lower vertical rotation limit (radians)."
        />
        <NumInput
          label="Max Polar (rad)"
          value={draft.camera.maxPolarAngle ?? 1.4}
          onChange={(v) => patchCamera({ maxPolarAngle: v })}
          step={0.05}
          max={3.14}
          description="Upper vertical rotation limit (radians)."
        />
        <NumInput
          label="Zoom Shift"
          value={draft.camera.zoomTargetShift ?? 0.6}
          onChange={(v) => patchCamera({ zoomTargetShift: v })}
          step={0.05}
          description="How much the focus shifts between chest and face during zoom."
        />
      </Section>

      {/* ── Avatar Section ────────────────────────────────────── */}
      <Section title="Avatar" accent="#a78bfa">
        {/* Model Selector */}
        <div>
          <p className="text-[10px] text-muted-foreground/60 mb-1">Model</p>
          <select
            value={draft.avatar.model}
            onChange={(e) => patchAvatar({ model: e.target.value })}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-foreground/90 font-medium focus:outline-none focus:border-violet-400/50 cursor-pointer appearance-none transition-colors hover:bg-white/8"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239ca3af%27 stroke-width=%272%27%3E%3Cpolyline points=%276 9 12 15 18 9%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            {avatarRegistry.map((a) => (
              <option key={a.id} value={a.id} className="bg-zinc-900 text-white">
                {a.label}
              </option>
            ))}
          </select>
        </div>
        {/* Idle Animation Selector */}
        <div>
          <p className="text-[10px] text-muted-foreground/60 mb-1 mt-2">Idle Animation</p>
          <select
            value={draft.avatar.idleAnimation || "masculine_idle_f_standing_idle_001"}
            onChange={(e) => patchAvatar({ idleAnimation: e.target.value })}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-foreground/90 font-medium focus:outline-none focus:border-violet-400/50 cursor-pointer appearance-none transition-colors hover:bg-white/8"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239ca3af%27 stroke-width=%272%27%3E%3Cpolyline points=%276 9 12 15 18 9%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            {/* Filter registry for idle animations, plus a forced fallback option */}
            <option value="masculine_idle_f_standing_idle_001" className="bg-zinc-900 text-white">Default F Standing Idle 001</option>
            <option value="male-idle" className="bg-zinc-900 text-white">Default Male Idle (male-idle)</option>
            <option value="idle" className="bg-zinc-900 text-white">Default Idle (idle.glb)</option>
            {Object.entries(useAnimationStore.getState().registry as Record<string, AnimationMeta>)
              .filter(([, meta]) => meta.type === "idle" && meta.name !== "male-idle" && meta.name !== "idle")
              .map(([key, meta]) => (
                <option key={key} value={key} className="bg-zinc-900 text-white">
                  {meta.name}
                </option>
              ))}
          </select>
        </div>
        <Vec3Input
          label="Position"
          value={draft.avatar.position}
          onChange={(p) => patchAvatar({ position: p })}
          description="Base offset of the avatar model."
        />
        <Vec3Input
          label="Rotation"
          value={draft.avatar.rotation}
          onChange={(r) => patchAvatar({ rotation: r })}
          description="Euler rotation (radians)."
        />
        <NumInput
          label="Scale"
          value={draft.avatar.scale}
          onChange={(s) => patchAvatar({ scale: s })}
          step={0.05}
          description="Universal size multiplier."
        />
      </Section>

      {/* ── Lighting Section ──────────────────────────────────── */}
      <Section title="Lighting" accent="#fbbf24" defaultOpen={false}>
        <LightEditor
          label="Key Light"
          light={draft.lighting.keyLight}
          onChange={(l) => patchLight("keyLight", l)}
        />
        <LightEditor
          label="Fill Light"
          light={draft.lighting.fillLight}
          onChange={(l) => patchLight("fillLight", l)}
        />
        <LightEditor
          label="Rim Light"
          light={draft.lighting.rimLight}
          onChange={(l) => patchLight("rimLight", l)}
        />
      </Section>

      {/* ── Feature Toggles ───────────────────────────────────── */}
      <Section title="Features" accent="#6ee7b7" defaultOpen={true}>
        {((Object.keys(draft.features) as (keyof FeatureToggles)[]).map((key) => {
          const descriptions: Record<keyof FeatureToggles, string> = {
            lipSync: "Move mouth based on real-time audio analysis.",
            breathing: "Subtle chest expansion and shoulder movement.",
            gazeDrift: "Eye micro-movements to simulate life.",
            blinking: "Replaced by Randomized Idle Expressions.",
            hoverEffect: "Float the avatar slightly on the Y axis.",
            headMovement: "Neck and eyes follow the mouse cursor.",
            googleSearch: "Enable native Google Search grounding via the Live API.",
            proactiveAudio: "Allow spontaneous AI responses based on vision (Proactivity).",
          };
          return (
            <ToggleSwitch
              key={key}
              label={key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
              checked={draft.features[key]}
              onChange={() => toggleFeatureLocal(key)}
              description={descriptions[key]}
            />
          );
        }))}
      </Section>

      <Section title="Lip Sync Tuning" accent="#fb7185" defaultOpen={false}>
        <div className="grid grid-cols-3 gap-1">
          {(Object.keys(LIPSYNC_PRESETS) as LipSyncPresetKey[]).map((presetKey) => (
            <button
              key={presetKey}
              onClick={() => applyLipSyncPreset(presetKey)}
              className={cn(
                "rounded-md border px-2 py-1.5 text-[9.5px] font-semibold transition-colors",
                activePreset === presetKey
                  ? "border-rose-300/70 bg-rose-500/25 text-rose-100"
                  : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10",
              )}
            >
              {LIPSYNC_PRESETS[presetKey].label}
            </button>
          ))}
        </div>
        <ToggleSwitch
          label="Adaptive Noise Floor"
          checked={lipSyncTuning.adaptiveNoiseFloor}
          onChange={() =>
            patchLipSync({ adaptiveNoiseFloor: !lipSyncTuning.adaptiveNoiseFloor })
          }
          description="Auto-calibrate speech threshold to current room noise."
        />
        <NumInput
          label="Clock Ratio"
          value={lipSyncTuning.clockCompensationRatio}
          onChange={(v) =>
            patchLipSync({
              clockCompensationRatio: Math.max(0, Math.min(1.2, v)),
            })
          }
          step={0.01}
          min={0}
          max={1.2}
          description="How much output-device latency is compensated in viseme timing."
        />
        <NumInput
          label="Max Clock"
          value={lipSyncTuning.maxClockCompensationMs}
          onChange={(v) =>
            patchLipSync({
              maxClockCompensationMs: Math.max(0, Math.min(200, v)),
            })
          }
          step={1}
          min={0}
          max={200}
          description="Hard limit for latency compensation (milliseconds)."
        />
        <NumInput
          label="Antic ms"
          value={lipSyncTuning.anticipationWindowMs}
          onChange={(v) =>
            patchLipSync({
              anticipationWindowMs: Math.max(8, Math.min(180, v)),
            })
          }
          step={1}
          min={8}
          max={180}
          description="Lookahead blend window for co-articulation."
        />
        <NumInput
          label="Antic W"
          value={lipSyncTuning.anticipationWeightMax}
          onChange={(v) =>
            patchLipSync({
              anticipationWeightMax: Math.max(0, Math.min(0.5, v)),
            })
          }
          step={0.01}
          min={0}
          max={0.5}
          description="Max co-articulation carry weight for next viseme."
        />
        <NumInput
          label="Sil Hold"
          value={lipSyncTuning.resetSilenceHoldMs}
          onChange={(v) =>
            patchLipSync({
              resetSilenceHoldMs: Math.max(80, Math.min(900, v)),
            })
          }
          step={5}
          min={80}
          max={900}
          description="How long to keep transition context after silence."
        />
        <NumInput
          label="Speech+"
          value={lipSyncTuning.speechThresholdOffset}
          onChange={(v) =>
            patchLipSync({
              speechThresholdOffset: Math.max(0, Math.min(0.08, v)),
            })
          }
          step={0.001}
          min={0}
          max={0.08}
          description="Margin above noise floor to classify active speech."
        />
        <NumInput
          label="Adapt"
          value={lipSyncTuning.noiseFloorAdaptLambda}
          onChange={(v) =>
            patchLipSync({
              noiseFloorAdaptLambda: Math.max(0.1, Math.min(12, v)),
            })
          }
          step={0.1}
          min={0.1}
          max={12}
          description="How quickly ambient floor tracks background audio."
        />
        <NumInput
          label="Release"
          value={lipSyncTuning.noiseFloorReleaseLambda}
          onChange={(v) =>
            patchLipSync({
              noiseFloorReleaseLambda: Math.max(0.05, Math.min(6, v)),
            })
          }
          step={0.05}
          min={0.05}
          max={6}
          description="How quickly floor drifts back after louder speech."
        />
        <NumInput
          label="FloorMin"
          value={lipSyncTuning.noiseFloorMin}
          onChange={(v) =>
            patchLipSync({
              noiseFloorMin: Math.max(0.001, Math.min(0.2, v)),
            })
          }
          step={0.001}
          min={0.001}
          max={0.2}
          description="Lower bound for adaptive ambient-noise floor."
        />
        <NumInput
          label="FloorMax"
          value={lipSyncTuning.noiseFloorMax}
          onChange={(v) =>
            patchLipSync({
              noiseFloorMax: Math.max(0.01, Math.min(0.35, v)),
            })
          }
          step={0.001}
          min={0.01}
          max={0.35}
          description="Upper bound for adaptive ambient-noise floor."
        />
        <NumInput
          label="Sw P"
          value={lipSyncTuning.minSwitchMsPlosive}
          onChange={(v) =>
            patchLipSync({
              minSwitchMsPlosive: Math.max(0, Math.min(80, v)),
            })
          }
          step={1}
          min={0}
          max={80}
          description="Minimum switch interval for plosives (ms)."
        />
        <NumInput
          label="Sw F"
          value={lipSyncTuning.minSwitchMsFricative}
          onChange={(v) =>
            patchLipSync({
              minSwitchMsFricative: Math.max(0, Math.min(120, v)),
            })
          }
          step={1}
          min={0}
          max={120}
          description="Minimum switch interval for fricatives (ms)."
        />
        <NumInput
          label="Sw V"
          value={lipSyncTuning.minSwitchMsVowel}
          onChange={(v) =>
            patchLipSync({
              minSwitchMsVowel: Math.max(0, Math.min(140, v)),
            })
          }
          step={1}
          min={0}
          max={140}
          description="Minimum switch interval for vowels (ms)."
        />
        <NumInput
          label="Sw Sil"
          value={lipSyncTuning.minSwitchMsSilence}
          onChange={(v) =>
            patchLipSync({
              minSwitchMsSilence: Math.max(0, Math.min(200, v)),
            })
          }
          step={1}
          min={0}
          max={200}
          description="Minimum switch interval near silence (ms)."
        />
        <NumInput
          label="Lambda P"
          value={lipSyncTuning.lambdaPlosive}
          onChange={(v) =>
            patchLipSync({
              lambdaPlosive: Math.max(1, Math.min(80, v)),
            })
          }
          step={1}
          min={1}
          max={80}
          description="Plosive damping speed (lower = softer closures)."
        />
        <NumInput
          label="Lambda F"
          value={lipSyncTuning.lambdaFricative}
          onChange={(v) =>
            patchLipSync({
              lambdaFricative: Math.max(1, Math.min(80, v)),
            })
          }
          step={1}
          min={1}
          max={80}
          description="Fricative damping speed."
        />
        <NumInput
          label="Lambda V"
          value={lipSyncTuning.lambdaVowel}
          onChange={(v) =>
            patchLipSync({
              lambdaVowel: Math.max(1, Math.min(80, v)),
            })
          }
          step={1}
          min={1}
          max={80}
          description="Vowel damping speed."
        />
        <NumInput
          label="Lambda S"
          value={lipSyncTuning.lambdaSilence}
          onChange={(v) =>
            patchLipSync({
              lambdaSilence: Math.max(1, Math.min(80, v)),
            })
          }
          step={1}
          min={1}
          max={80}
          description="Silence damping speed."
        />
        <NumInput
          label="Smooth"
          value={lipSyncTuning.analyserSmoothing}
          onChange={(v) =>
            patchLipSync({
              analyserSmoothing: Math.max(0, Math.min(0.95, v)),
            })
          }
          step={0.01}
          min={0}
          max={0.95}
          description="Audio analyser smoothing (higher can feel later)."
        />
        <NumInput
          label="Persist"
          value={lipSyncTuning.visemePersistenceMs}
          onChange={(v) =>
            patchLipSync({
              visemePersistenceMs: Math.max(20, Math.min(260, v)),
            })
          }
          step={1}
          min={20}
          max={260}
          description="How long visemes are kept stable before switching."
        />
        <div className="rounded-md border border-white/10 bg-white/5 px-2 py-2">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-rose-200/90">
            Tuning Guide
          </p>
          <div className="mt-1 space-y-1">
            {earlyGuide.map((line) => (
              <p key={line} className="text-[9px] leading-tight text-muted-foreground/75">
                {line}
              </p>
            ))}
          </div>
        </div>
        <div className="pt-1">
          <button
            onClick={() => {
              resetLipSyncTuning();
              setActivePreset("balanced");
              setDraft((prev) => {
                const next = {
                  ...prev,
                  lipSyncTuning: { ...DEFAULT_LIPSYNC_TUNING },
                };
                setConfig(next);
                return next;
              });
            }}
            className="w-full rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-1.5 text-[10px] font-semibold text-rose-300 transition-colors hover:bg-rose-500/20"
          >
            Reset Lip-Sync Tuning
          </button>
        </div>
      </Section>

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
            {saved ? "✅ Saved!" : "💾 Save to JSON"}
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
            {copied ? "✅ Copied!" : "📋 Copy"}
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
