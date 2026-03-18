import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { sanitizeControlPatch, type AvatarControlOverrides } from "@/lib/avatar-control.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(req: Request) {
  try {
    const data = await req.json();

    const configPath = path.join(process.cwd(), "src", "config", "scene.json");
    
    // Read the existing file to merge settings (so we don't accidentally overwrite fields we aren't changing)
    let existingData = {};
    try {
      const fileData = await fs.readFile(configPath, "utf-8");
      existingData = JSON.parse(fileData);
    } catch {
      console.warn("Could not read existing scene.json, creating new one.");
    }

    const existing = isRecord(existingData) ? existingData : {};
    const incoming = isRecord(data) ? data : {};

    // Persistence boundary: baseline only. Ignore all session-ephemeral keys.
    const ephemeralKeys = new Set([
      "sessionOverrides",
      "sessionAvatarOverrides",
      "runtimeOverrides",
      "overrideTTLms",
    ]);
    const baselineIncoming = Object.fromEntries(
      Object.entries(incoming).filter(([key]) => !ephemeralKeys.has(key))
    );

    const topLevelPatch = {
      camera: baselineIncoming.camera,
      avatar: baselineIncoming.avatar,
      lighting: baselineIncoming.lighting,
      features: baselineIncoming.features,
      lipSyncTuning: baselineIncoming.lipSyncTuning,
    };

    type ConfigNode = Record<string, unknown>;
    const e = existing as Record<string, ConfigNode>;
    const i = baselineIncoming as Record<string, ConfigNode>;

    const sanitizedControls = sanitizeControlPatch({
      emotionControl: isRecord(i.emotionControl) ? (i.emotionControl as AvatarControlOverrides["emotionControl"]) : undefined,
      ocularTuning: isRecord(i.ocularTuning) ? (i.ocularTuning as AvatarControlOverrides["ocularTuning"]) : undefined,
      meshPostProcessing: isRecord(i.meshPostProcessing) ? (i.meshPostProcessing as AvatarControlOverrides["meshPostProcessing"]) : undefined,
      headDynamics: isRecord(i.headDynamics) ? (i.headDynamics as AvatarControlOverrides["headDynamics"]) : undefined,
      anatomicalPostProcessing: isRecord(i.anatomicalPostProcessing)
        ? (i.anatomicalPostProcessing as AvatarControlOverrides["anatomicalPostProcessing"])
        : undefined,
      visemeOverrides: isRecord(i.visemeOverrides) ? (i.visemeOverrides as AvatarControlOverrides["visemeOverrides"]) : undefined,
      aiStyleControl: isRecord(i.aiStyleControl) ? (i.aiStyleControl as AvatarControlOverrides["aiStyleControl"]) : undefined,
      meshConfig: isRecord(i.meshConfig) ? (i.meshConfig as AvatarControlOverrides["meshConfig"]) : undefined,
    });

    // Deep merge the data
    const mergedData = {
      ...existing,
      camera: { ...(e.camera || {}), ...(topLevelPatch.camera as ConfigNode || {}) },
      avatar: { ...(e.avatar || {}), ...(topLevelPatch.avatar as ConfigNode || {}) },
      lighting: { ...(e.lighting || {}), ...(topLevelPatch.lighting as ConfigNode || {}) },
      features: { ...(e.features || {}), ...(topLevelPatch.features as ConfigNode || {}) },
      lipSyncTuning: { ...(e.lipSyncTuning || {}), ...(topLevelPatch.lipSyncTuning as ConfigNode || {}) },
      emotionControl: { ...(e.emotionControl || {}), ...(sanitizedControls.emotionControl || {}) },
      ocularTuning: { ...(e.ocularTuning || {}), ...(sanitizedControls.ocularTuning || {}) },
      meshPostProcessing: { ...(e.meshPostProcessing || {}), ...(sanitizedControls.meshPostProcessing || {}) },
      headDynamics: { ...(e.headDynamics || {}), ...(sanitizedControls.headDynamics || {}) },
      anatomicalPostProcessing: {
        ...(e.anatomicalPostProcessing || {}),
        ...(sanitizedControls.anatomicalPostProcessing || {}),
      },
      visemeOverrides: { ...(e.visemeOverrides || {}), ...(sanitizedControls.visemeOverrides || {}) },
      aiStyleControl: { ...(e.aiStyleControl || {}), ...(sanitizedControls.aiStyleControl || {}) },
      meshConfig: { ...(e.meshConfig || {}), ...(sanitizedControls.meshConfig || {}) },
    };
    
    // Removed saving back to the config file so that server defaults remain pristine.
    // We now rely purely on localStorage in the client to persist user-level config overrides.
    // await fs.writeFile(
    //   configPath,
    //   JSON.stringify(mergedData, null, 2),
    //   "utf-8"
    // );

    return NextResponse.json({ success: true, data: mergedData, note: "Server file edit disabled per user request. Use localStorage logic." });
  } catch (error) {
    console.error("Failed to save camera settings:", error);
    return NextResponse.json(
      { error: "Failed to save camera settings" },
      { status: 500 }
    );
  }
}
