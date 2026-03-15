"use client";

import { type SceneConfig } from "@/hooks/SceneConfigContext";
import { Group, NumInput, Section, ToggleSwitch } from "./ui-components";
import { type EmotionState } from "@/lib/avatar-control.types";

type AvatarControlPatch = {
  emotionControl?: Partial<SceneConfig["emotionControl"]>;
  ocularTuning?: Partial<SceneConfig["ocularTuning"]>;
  meshPostProcessing?: Partial<SceneConfig["meshPostProcessing"]>;
  headDynamics?: Partial<SceneConfig["headDynamics"]>;
  anatomicalPostProcessing?: Partial<SceneConfig["anatomicalPostProcessing"]>;
  visemeOverrides?: Partial<SceneConfig["visemeOverrides"]>;
  aiStyleControl?: Partial<SceneConfig["aiStyleControl"]>;
  meshConfig?: Partial<SceneConfig["meshConfig"]>;
};

const EMOTION_OPTIONS: EmotionState[] = [
  "neutral",
  "joy",
  "anger",
  "sadness",
  "surprised",
  "fear",
  "disgust",
];

export function AvatarRealismSection({
  draft,
  patchAvatarControls,
}: {
  draft: SceneConfig;
  patchAvatarControls: (patch: AvatarControlPatch) => void;
}) {
  return (
    <Section title="Avatar Realism" accent="#f59e0b" defaultOpen={false}>
      <Group title="Emotion Control">
        <div>
          <p className="text-[10px] text-muted-foreground/60 mb-1">Emotion State</p>
          <select
            value={draft.emotionControl.emotionState}
            onChange={(e) => patchAvatarControls({ emotionControl: { emotionState: e.target.value as EmotionState } })}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-foreground/90 font-medium focus:outline-none focus:border-amber-400/50 cursor-pointer appearance-none transition-colors hover:bg-white/8"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239ca3af%27 stroke-width=%272%27%3E%3Cpolyline points=%276 9 12 15 18 9%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            {EMOTION_OPTIONS.map((emotion) => (
              <option key={emotion} value={emotion} className="bg-zinc-900 text-white">
                {emotion}
              </option>
            ))}
          </select>
        </div>

        <NumInput
          label="Intensity"
          value={draft.emotionControl.emotionIntensity}
          onChange={(v) => patchAvatarControls({ emotionControl: { emotionIntensity: v } })}
          step={0.01}
          min={0}
          max={1}
          description="Base emotional intensity when no explicit expression is active."
        />

        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground/60">Text Conditioning</span>
          <input
            type="text"
            value={draft.emotionControl.textConditioning}
            onChange={(e) => patchAvatarControls({ emotionControl: { textConditioning: e.target.value } })}
            className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-foreground/90 focus:outline-none focus:border-amber-400/40 transition-colors hover:bg-white/8"
            placeholder="speaks with calm neutral expression"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground/60">Fine Grained AUs (comma separated)</span>
          <input
            type="text"
            value={draft.emotionControl.fineGrainedAUs.join(", ")}
            onChange={(e) =>
              patchAvatarControls({
                emotionControl: {
                  fineGrainedAUs: e.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                },
              })
            }
            className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-foreground/90 focus:outline-none focus:border-amber-400/40 transition-colors hover:bg-white/8"
            placeholder="browInnerUp, mouthSmileLeft"
          />
        </div>
      </Group>

      <Group title="Ocular + Head Dynamics">
        <ToggleSwitch
          label="Look At IK"
          checked={draft.ocularTuning.lookAtIK}
          onChange={() => patchAvatarControls({ ocularTuning: { lookAtIK: !draft.ocularTuning.lookAtIK } })}
        />
        <ToggleSwitch
          label="Generate Idle Motion"
          checked={draft.headDynamics.generateIdleMotion}
          onChange={() => patchAvatarControls({ headDynamics: { generateIdleMotion: !draft.headDynamics.generateIdleMotion } })}
        />

        <NumInput
          label="Saccade"
          value={draft.ocularTuning.saccadeStrength}
          onChange={(v) => patchAvatarControls({ ocularTuning: { saccadeStrength: v } })}
          step={0.01}
          min={0}
          max={2}
        />
        <NumInput
          label="Blink Interval"
          value={draft.ocularTuning.blinkIntervalMs}
          onChange={(v) => patchAvatarControls({ ocularTuning: { blinkIntervalMs: v } })}
          step={10}
          min={500}
          max={12000}
        />
        <NumInput
          label="Blink Duration"
          value={draft.ocularTuning.blinkDurationMs}
          onChange={(v) => patchAvatarControls({ ocularTuning: { blinkDurationMs: v } })}
          step={5}
          min={60}
          max={450}
        />
        <NumInput
          label="Eyelid Offset"
          value={draft.ocularTuning.eyelidOpenOffset}
          onChange={(v) => patchAvatarControls({ ocularTuning: { eyelidOpenOffset: v } })}
          step={0.01}
          min={-0.25}
          max={0.25}
        />
        <NumInput
          label="Head Accel Limit"
          value={draft.headDynamics.headMotionAccelerationLimit}
          onChange={(v) => patchAvatarControls({ headDynamics: { headMotionAccelerationLimit: v } })}
          step={0.01}
          min={0.01}
          max={0.8}
        />

        <div className="grid grid-cols-2 gap-3">
          <NumInput
            label="Pitch Min"
            value={draft.headDynamics.pitchRange[0]}
            onChange={(v) => patchAvatarControls({ headDynamics: { pitchRange: [v, draft.headDynamics.pitchRange[1]] } })}
            step={1}
            min={-45}
            max={45}
          />
          <NumInput
            label="Pitch Max"
            value={draft.headDynamics.pitchRange[1]}
            onChange={(v) => patchAvatarControls({ headDynamics: { pitchRange: [draft.headDynamics.pitchRange[0], v] } })}
            step={1}
            min={-45}
            max={45}
          />
          <NumInput
            label="Yaw Min"
            value={draft.headDynamics.yawRange[0]}
            onChange={(v) => patchAvatarControls({ headDynamics: { yawRange: [v, draft.headDynamics.yawRange[1]] } })}
            step={1}
            min={-60}
            max={60}
          />
          <NumInput
            label="Yaw Max"
            value={draft.headDynamics.yawRange[1]}
            onChange={(v) => patchAvatarControls({ headDynamics: { yawRange: [draft.headDynamics.yawRange[0], v] } })}
            step={1}
            min={-60}
            max={60}
          />
        </div>
      </Group>

      <Group title="Lipsync + Style Controls">
        <NumInput
          label="Driving Scale"
          value={draft.visemeOverrides.drivingDataScale}
          onChange={(v) => patchAvatarControls({ visemeOverrides: { drivingDataScale: v } })}
          step={0.01}
          min={0}
          max={2}
        />
        <div className="grid grid-cols-2 gap-3">
          <NumInput
            label="BMP"
            value={draft.visemeOverrides.strengthBMP}
            onChange={(v) => patchAvatarControls({ visemeOverrides: { strengthBMP: v } })}
            step={1}
            min={0}
            max={300}
          />
          <NumInput
            label="FV"
            value={draft.visemeOverrides.strengthFV}
            onChange={(v) => patchAvatarControls({ visemeOverrides: { strengthFV: v } })}
            step={1}
            min={0}
            max={300}
          />
          <NumInput
            label="WOo"
            value={draft.visemeOverrides.strengthWOo}
            onChange={(v) => patchAvatarControls({ visemeOverrides: { strengthWOo: v } })}
            step={1}
            min={0}
            max={300}
          />
          <NumInput
            label="SZTD"
            value={draft.visemeOverrides.strengthSZTD}
            onChange={(v) => patchAvatarControls({ visemeOverrides: { strengthSZTD: v } })}
            step={1}
            min={0}
            max={300}
          />
        </div>

        <NumInput
          label="AI Emotion Intensity"
          value={draft.aiStyleControl.emotionIntensity}
          onChange={(v) => patchAvatarControls({ aiStyleControl: { emotionIntensity: v } })}
          step={0.01}
          min={0}
          max={1.5}
        />
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground/60">AI Emotion Prompt</span>
          <input
            type="text"
            value={draft.aiStyleControl.emotionTextPrompt}
            onChange={(e) => patchAvatarControls({ aiStyleControl: { emotionTextPrompt: e.target.value } })}
            className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-foreground/90 focus:outline-none focus:border-amber-400/40 transition-colors hover:bg-white/8"
            placeholder="neutral professional expression"
          />
        </div>
        <NumInput
          label="CFG Scale"
          value={draft.aiStyleControl.cfgScale}
          onChange={(v) => patchAvatarControls({ aiStyleControl: { cfgScale: v } })}
          step={0.1}
          min={0.5}
          max={6}
        />
        <NumInput
          label="Coarticulation"
          value={draft.aiStyleControl.coarticulationWindowSize}
          onChange={(v) => patchAvatarControls({ aiStyleControl: { coarticulationWindowSize: v } })}
          step={1}
          min={1}
          max={12}
        />
      </Group>

      <Group title="Mesh Processing + Anatomical">
        <NumInput
          label="Upper Smooth"
          value={draft.meshPostProcessing.upperFaceSmoothing}
          onChange={(v) => patchAvatarControls({ meshPostProcessing: { upperFaceSmoothing: v } })}
          step={0.0001}
          min={0}
          max={0.05}
        />
        <NumInput
          label="Lower Smooth"
          value={draft.meshPostProcessing.lowerFaceSmoothing}
          onChange={(v) => patchAvatarControls({ meshPostProcessing: { lowerFaceSmoothing: v } })}
          step={0.0001}
          min={0}
          max={0.06}
        />
        <NumInput
          label="Skin Strength"
          value={draft.meshPostProcessing.skinStrength}
          onChange={(v) => patchAvatarControls({ meshPostProcessing: { skinStrength: v } })}
          step={0.01}
          min={0}
          max={2}
        />
        <NumInput
          label="Jaw Strength"
          value={draft.meshPostProcessing.jawStrength}
          onChange={(v) => patchAvatarControls({ meshPostProcessing: { jawStrength: v } })}
          step={0.01}
          min={0}
          max={2}
        />
        <NumInput
          label="Lip Open Offset"
          value={draft.meshPostProcessing.lipOpenOffset}
          onChange={(v) => patchAvatarControls({ meshPostProcessing: { lipOpenOffset: v } })}
          step={0.001}
          min={-0.08}
          max={0.08}
        />

        <div className="grid grid-cols-2 gap-3">
          <NumInput
            label="Lower Face"
            value={draft.anatomicalPostProcessing.lowerFaceStrength}
            onChange={(v) => patchAvatarControls({ anatomicalPostProcessing: { lowerFaceStrength: v } })}
            step={0.01}
            min={0.2}
            max={2.5}
          />
          <NumInput
            label="Upper Face"
            value={draft.anatomicalPostProcessing.upperFaceStrength}
            onChange={(v) => patchAvatarControls({ anatomicalPostProcessing: { upperFaceStrength: v } })}
            step={0.01}
            min={0.2}
            max={2.5}
          />
          <NumInput
            label="Face Mask Level"
            value={draft.anatomicalPostProcessing.faceMaskLevel}
            onChange={(v) => patchAvatarControls({ anatomicalPostProcessing: { faceMaskLevel: v } })}
            step={0.01}
            min={0}
            max={1}
          />
          <NumInput
            label="Face Mask Soft"
            value={draft.anatomicalPostProcessing.faceMaskSoftness}
            onChange={(v) => patchAvatarControls({ anatomicalPostProcessing: { faceMaskSoftness: v } })}
            step={0.0005}
            min={0}
            max={0.05}
          />
          <NumInput
            label="Anatomical Jaw"
            value={draft.anatomicalPostProcessing.jawStrength}
            onChange={(v) => patchAvatarControls({ anatomicalPostProcessing: { jawStrength: v } })}
            step={0.01}
            min={0}
            max={2}
          />
          <NumInput
            label="Jaw Height"
            value={draft.anatomicalPostProcessing.jawHeight}
            onChange={(v) => patchAvatarControls({ anatomicalPostProcessing: { jawHeight: v } })}
            step={0.01}
            min={-0.25}
            max={0.25}
          />
          <NumInput
            label="Jaw Depth"
            value={draft.anatomicalPostProcessing.jawDepth}
            onChange={(v) => patchAvatarControls({ anatomicalPostProcessing: { jawDepth: v } })}
            step={0.01}
            min={-0.25}
            max={0.25}
          />
          <NumInput
            label="Tongue Strength"
            value={draft.anatomicalPostProcessing.tongueStrength}
            onChange={(v) => patchAvatarControls({ anatomicalPostProcessing: { tongueStrength: v } })}
            step={0.01}
            min={0}
            max={2}
          />
          <NumInput
            label="Tongue Height"
            value={draft.anatomicalPostProcessing.tongueHeight}
            onChange={(v) => patchAvatarControls({ anatomicalPostProcessing: { tongueHeight: v } })}
            step={0.01}
            min={-0.2}
            max={0.2}
          />
          <NumInput
            label="Tongue Depth"
            value={draft.anatomicalPostProcessing.tongueDepth}
            onChange={(v) => patchAvatarControls({ anatomicalPostProcessing: { tongueDepth: v } })}
            step={0.01}
            min={-0.2}
            max={0.2}
          />
        </div>
      </Group>

      <Group title="Mesh Config">
        <div>
          <p className="text-[10px] text-muted-foreground/60 mb-1">Mesh LOD</p>
          <select
            value={draft.meshConfig.meshLod}
            onChange={(e) => patchAvatarControls({ meshConfig: { meshLod: Number(e.target.value) as 0 | 1 | 2 } })}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-foreground/90 font-medium focus:outline-none focus:border-amber-400/50 cursor-pointer appearance-none transition-colors hover:bg-white/8"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239ca3af%27 stroke-width=%272%27%3E%3Cpolyline points=%276 9 12 15 18 9%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            <option value={0} className="bg-zinc-900 text-white">0 (Highest)</option>
            <option value={1} className="bg-zinc-900 text-white">1 (Balanced)</option>
            <option value={2} className="bg-zinc-900 text-white">2 (Performance)</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground/60">Morph Targets</span>
          <input
            type="text"
            value={draft.meshConfig.morphTargets}
            onChange={(e) => patchAvatarControls({ meshConfig: { morphTargets: e.target.value } })}
            className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-foreground/90 focus:outline-none focus:border-amber-400/40 transition-colors hover:bg-white/8"
          />
        </div>

        <div>
          <p className="text-[10px] text-muted-foreground/60 mb-1">Texture Atlas</p>
          <select
            value={draft.meshConfig.textureAtlas}
            onChange={(e) => patchAvatarControls({ meshConfig: { textureAtlas: e.target.value as "none" | "1024" } })}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-foreground/90 font-medium focus:outline-none focus:border-amber-400/50 cursor-pointer appearance-none transition-colors hover:bg-white/8"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239ca3af%27 stroke-width=%272%27%3E%3Cpolyline points=%276 9 12 15 18 9%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            <option value="none" className="bg-zinc-900 text-white">none</option>
            <option value="1024" className="bg-zinc-900 text-white">1024</option>
          </select>
        </div>

        <ToggleSwitch
          label="Draco Compression"
          checked={draft.meshConfig.useDracoCompression}
          onChange={() => patchAvatarControls({ meshConfig: { useDracoCompression: !draft.meshConfig.useDracoCompression } })}
        />
        <ToggleSwitch
          label="MeshOpt Compression"
          checked={draft.meshConfig.useMeshOptCompression}
          onChange={() => patchAvatarControls({ meshConfig: { useMeshOptCompression: !draft.meshConfig.useMeshOptCompression } })}
        />
      </Group>
    </Section>
  );
}
