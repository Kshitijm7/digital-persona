"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";
import { type SceneConfig } from "@/hooks/SceneConfigContext";
import { ToggleSwitch, NumInput, Section, Group } from "./ui-components";
import {
  DEFAULT_LIPSYNC_TUNING,
  LIPSYNC_PRESETS,
  type LipSyncPresetKey,
  useLipSyncStore,
} from "@/store/useLipSyncStore";

export function LipSyncSection({
  draft,
  patchLipSync,
  applyLipSyncPreset,
  setDraft,
  setConfig,
}: {
  draft: SceneConfig;
  patchLipSync: (patch: Partial<typeof DEFAULT_LIPSYNC_TUNING>) => void;
  applyLipSyncPreset: (preset: LipSyncPresetKey) => void;
  setDraft: (d: any) => void;
  setConfig: (d: any) => void;
}) {
  const lipSyncTuning = useLipSyncStore((state) => state.tuning);
  const activePreset = useLipSyncStore((state) => state.activePreset);
  const resetLipSyncTuning = useLipSyncStore((state) => state.resetTuning);
  const setActivePresetStore = useLipSyncStore((state) => state.setActivePreset);

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
    <Section title="Lip Sync Tuning" accent="#fb7185" defaultOpen={false}>
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
  );
}
