/**
 * useSkinTexture — loads & caches PBR textures for a SkinPreset.
 * Returns a THREE.MeshPhysicalMaterial configured for photorealistic skin.
 *
 * Uses MeshPhysicalMaterial properties:
 *   - transmission + thickness → subsurface scattering (light through skin)
 *   - clearcoat → sebum/oil micro-layer on skin surface
 *   - sheen → silk-like micro-fiber scattering
 */

import * as THREE from "three";
import { useMemo, useEffect, useRef } from "react";
import { SkinPreset } from "@/lib/skinConfig";

export function useSkinMaterial(
  baseMaterial: THREE.MeshStandardMaterial | undefined,
  preset: SkinPreset | null
): THREE.MeshPhysicalMaterial | null {
  // Keep a stable material reference across renders
  const materialRef = useRef<THREE.MeshPhysicalMaterial | null>(null);

  // Create or update the material whenever the preset changes
  const material = useMemo(() => {
    if (preset?.id === "raw" || !baseMaterial) {
      return null;
    }

    // Clone the base material to preserve the base texture map (eyebrows, lips, shadows),
    // then convert it to a MeshPhysicalMaterial for subsurface scattering.
    // We use the MeshStandardMaterial prototype to copy to avoid TypeError on undefined physical maps.
    const physMat = new THREE.MeshPhysicalMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(physMat, baseMaterial);

    if (preset) {
      physMat.color = new THREE.Color(preset.color);
      physMat.roughness = preset.roughness;
      physMat.metalness = 0.0;         // Skin is NOT metallic
      // Subsurface scattering (SSS)
      physMat.thickness = preset.thickness;
      physMat.transmission = preset.transmission;
      // Oil/sebum surface layer
      physMat.clearcoat = preset.clearcoat;
      physMat.clearcoatRoughness = preset.clearcoatRoughness;
      // Micro-sheen
      physMat.sheenColor = new THREE.Color(preset.sheenColor);
      physMat.sheen = 0.3;
      physMat.side = THREE.FrontSide;
    }

    return physMat;
  }, [preset, baseMaterial]);

  // When a preset has an `albedo` (base64 data URL or path), load it as texture
  useEffect(() => {
    if (!preset?.albedo || !material) return;

    const loader = new THREE.TextureLoader();
    loader.load(
      preset.albedo,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.flipY = false; // REQUIRED for applying typical GLTF UV maps correctly
        material.map = texture;
        material.needsUpdate = true;
      },
      undefined,
      (err) => {
        console.warn("[useSkinTexture] Failed to load albedo texture:", err);
      }
    );

    return () => {
      // Cleanup: remove texture when preset changes
      if (material.map) {
        material.map.dispose();
        material.map = null;
        material.needsUpdate = true;
      }
    };
  }, [preset?.albedo, material]);

  // Dispose old material when a new one replaces it
  useEffect(() => {
    const old = materialRef.current;
    materialRef.current = material;
    return () => {
      // Don't auto-dispose the `map` inside standard unmount if it came from the original GLTF!
      // But we DO need to dispose the created MeshPhysicalMaterial itself.
      if (old && old !== material) old.dispose();
    };
  }, [material]);

  return material;
}
