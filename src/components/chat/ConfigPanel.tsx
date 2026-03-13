"use client";

import { useState, useCallback, useMemo } from "react";
import * as THREE from "three";
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
          className="text-[10px] font-bold uppercase tracking-[0.2em] flex-1 text-left"
          style={{ color: accent }}
        >
          {title}
        </span>
      </button>
      {open && <div className="px-4 py-4 flex flex-col gap-4 border-t border-white/5 bg-white/2">{children}</div>}
    </div>
  );
}

/* ─── Setting Group ─────────────────────────────────────────────────────────── */

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 p-3 bg-white/3 rounded-lg border border-white/5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40">{title}</p>
      <div className="flex flex-col gap-3">
        {children}
      </div>
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

      <Section title="Lip Sync Tuning" accent="#fb7185" defaultOpen={true}>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(LIPSYNC_PRESETS) as LipSyncPresetKey[]).map((presetKey) => (
              <button
                key={presetKey}
                onClick={() => applyLipSyncPreset(presetKey)}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-[10px] font-bold transition-all duration-200 uppercase tracking-wider",
                  activePreset === presetKey
                    ? "border-rose-400/50 bg-rose-500/20 text-rose-100 shadow-[0_0_12px_rgba(244,63,94,0.15)]"
                    : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10 hover:border-white/20"
                )}
              >
                {LIPSYNC_PRESETS[presetKey].label}
              </button>
            ))}
          </div>

          <Group title="General">
            <ToggleSwitch
              label="Adaptive Noise Floor"
              checked={lipSyncTuning.adaptiveNoiseFloor}
              onChange={() =>
                patchLipSync({ adaptiveNoiseFloor: !lipSyncTuning.adaptiveNoiseFloor })
              }
              description="Auto-calibrate speech threshold to current room noise."
            />
            <NumInput
              label="Smooth"
              value={lipSyncTuning.analyserSmoothing}
              onChange={(v) =>
                patchLipSync({
                  analyserSmoothing: THREE.MathUtils.clamp(v, 0, 0.95),
                })
              }
              step={0.01}
              min={0}
              max={0.95}
              description="Audio analyser smoothing (higher = more stable but later)."
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
              description="Stability duration for visemes (ms)."
            />
          </Group>

          <Group title="Temporal & Latency">
            <NumInput
              label="Ratio"
              value={lipSyncTuning.clockCompensationRatio}
              onChange={(v) =>
                patchLipSync({
                  clockCompensationRatio: THREE.MathUtils.clamp(v, 0, 1.2),
                })
              }
              step={0.01}
              min={0}
              max={1.2}
              description="Latency compensation ratio (0.6 is ideal)."
            />
            <NumInput
              label="Clock"
              value={lipSyncTuning.maxClockCompensationMs}
              onChange={(v) =>
                patchLipSync({
                  maxClockCompensationMs: Math.max(0, Math.min(200, v)),
                })
              }
              step={1}
              min={0}
              max={200}
              description="Max latency headroom (ms)."
            />
          </Group>

          <Group title="Co-Articulation">
            <NumInput
              label="Antic"
              value={lipSyncTuning.anticipationWindowMs}
              onChange={(v) =>
                patchLipSync({
                  anticipationWindowMs: Math.max(8, Math.min(180, v)),
                })
              }
              step={1}
              min={8}
              max={180}
              description="Lookahead blend window (ms)."
            />
            <NumInput
              label="Weight"
              value={lipSyncTuning.anticipationWeightMax}
              onChange={(v) =>
                patchLipSync({
                  anticipationWeightMax: THREE.MathUtils.clamp(v, 0, 0.5),
                })
              }
              step={0.01}
              min={0}
              max={0.5}
              description="Max carry weight for next viseme."
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
              description="Post-silence context duration (ms)."
            />
          </Group>

          <Group title="Switch Intervals">
            <div className="grid grid-cols-2 gap-3">
              <NumInput
                label="Plos"
                value={lipSyncTuning.minSwitchMsPlosive}
                onChange={(v) => patchLipSync({ minSwitchMsPlosive: v })}
                step={1}
                min={0}
                max={80}
              />
              <NumInput
                label="Fric"
                value={lipSyncTuning.minSwitchMsFricative}
                onChange={(v) => patchLipSync({ minSwitchMsFricative: v })}
                step={1}
                min={0}
                max={120}
              />
              <NumInput
                label="Vow"
                value={lipSyncTuning.minSwitchMsVowel}
                onChange={(v) => patchLipSync({ minSwitchMsVowel: v })}
                step={1}
                min={0}
                max={140}
              />
              <NumInput
                label="Sil"
                value={lipSyncTuning.minSwitchMsSilence}
                onChange={(v) => patchLipSync({ minSwitchMsSilence: v })}
                step={1}
                min={0}
                max={200}
              />
            </div>
          </Group>

          <Group title="Damping Dynamics (Lambda)">
            <div className="grid grid-cols-2 gap-3">
              <NumInput
                label="P (Plos)"
                value={lipSyncTuning.lambdaPlosive}
                onChange={(v) => patchLipSync({ lambdaPlosive: v })}
                step={1}
                min={1}
                max={80}
              />
              <NumInput
                label="F (Fric)"
                value={lipSyncTuning.lambdaFricative}
                onChange={(v) => patchLipSync({ lambdaFricative: v })}
                step={1}
                min={1}
                max={80}
              />
              <NumInput
                label="V (Vow)"
                value={lipSyncTuning.lambdaVowel}
                onChange={(v) => patchLipSync({ lambdaVowel: v })}
                step={1}
                min={1}
                max={80}
              />
              <NumInput
                label="S (Sil)"
                value={lipSyncTuning.lambdaSilence}
                onChange={(v) => patchLipSync({ lambdaSilence: v })}
                step={1}
                min={1}
                max={80}
              />
            </div>
          </Group>

          <Group title="Noise Floor Tracking">
            <NumInput
              label="Speech+"
              value={lipSyncTuning.speechThresholdOffset}
              onChange={(v) => patchLipSync({ speechThresholdOffset: v })}
              step={0.001}
              description="Margin above noise floor."
            />
            <div className="grid grid-cols-2 gap-3">
              <NumInput
                label="Adapt"
                value={lipSyncTuning.noiseFloorAdaptLambda}
                onChange={(v) => patchLipSync({ noiseFloorAdaptLambda: v })}
                step={0.1}
              />
              <NumInput
                label="Rel"
                value={lipSyncTuning.noiseFloorReleaseLambda}
                onChange={(v) => patchLipSync({ noiseFloorReleaseLambda: v })}
                step={0.05}
              />
              <NumInput
                label="Min"
                value={lipSyncTuning.noiseFloorMin}
                onChange={(v) => patchLipSync({ noiseFloorMin: v })}
                step={0.001}
              />
              <NumInput
                label="Max"
                value={lipSyncTuning.noiseFloorMax}
                onChange={(v) => patchLipSync({ noiseFloorMax: v })}
                step={0.001}
              />
            </div>
          </Group>

          <div className="rounded-xl border border-white/5 bg-black/40 p-4 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-rose-300">
              Tuning Strategy
            </p>
            <div className="space-y-1.5">
              {earlyGuide.map((line) => (
                <p key={line} className="text-[9.5px] leading-relaxed text-muted-foreground/60 flex gap-2">
                  <span className="text-rose-500/50 italic shrink-0">•</span>
                  {line}
                </p>
              ))}
            </div>
          </div>

          <button
            onClick={() => {
              resetLipSyncTuning();
              setActivePresetStore("balanced");
              const next = {
                ...draft,
                lipSyncTuning: { ...DEFAULT_LIPSYNC_TUNING },
              };
              setDraft(next);
              setConfig(next);

            }}
            className="w-full rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-rose-400 transition-all hover:bg-rose-500/15 active:scale-[0.98]"
          >
            Reset to Factory Defaults
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
