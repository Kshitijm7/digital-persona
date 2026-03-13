import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

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

    const existing = existingData as Record<string, unknown>;
    const incoming = data as Record<string, unknown>;

    type ConfigNode = Record<string, unknown>;
    const e = existing as Record<string, ConfigNode>;
    const i = incoming as Record<string, ConfigNode>;

    // Deep merge the data
    const mergedData = {
      ...existing,
      ...incoming,
      camera: { ...(e.camera || {}), ...(i.camera || {}) },
      avatar: { ...(e.avatar || {}), ...(i.avatar || {}) },
      lighting: { ...(e.lighting || {}), ...(i.lighting || {}) },
      features: { ...(e.features || {}), ...(i.features || {}) },
      lipSyncTuning: { ...(e.lipSyncTuning || {}), ...(i.lipSyncTuning || {}) },
    };
    
    // Write back to the config file
    await fs.writeFile(
      configPath,
      JSON.stringify(mergedData, null, 2),
      "utf-8"
    );

    return NextResponse.json({ success: true, data: mergedData });
  } catch (error) {
    console.error("Failed to save camera settings:", error);
    return NextResponse.json(
      { error: "Failed to save camera settings" },
      { status: 500 }
    );
  }
}
