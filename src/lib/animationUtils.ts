import { AnimationClip } from "three";

const MIXAMO_PREFIX = "mixamorig";
const POSITION_SUFFIX = ".position";
const MIXAMO_SCALE = 0.01;

// Tracks which clips have already been normalised so that calling this
// function more than once on the same array (e.g. from a shared cache) does
// not apply the position scale a second time and shrink the avatar.
const normalisedClips = new WeakSet<AnimationClip>();

/**
 * Normalises FBX animations, particularly from Mixamo.
 *
 * - Strips the `mixamorig` prefix from bone track names so they match the
 *   bone names in standard glTF/RPM skeletons.
 * - Scales position track values by 0.01 to match glTF unit conventions.
 *
 * Safe to call multiple times on the same clips — subsequent calls are no-ops
 * for clips that have already been normalised.
 */
export function normaliseFbxAnimations(animations: AnimationClip[]): AnimationClip[] {
  for (const clip of animations) {
    if (normalisedClips.has(clip)) continue;

    for (const track of clip.tracks) {
      if (track.name.includes(MIXAMO_PREFIX)) {
        track.name = track.name.replace(MIXAMO_PREFIX, "");
      }
      if (track.name.includes(POSITION_SUFFIX)) {
        for (let j = 0; j < track.values.length; j++) {
          track.values[j] *= MIXAMO_SCALE;
        }
      }
    }

    normalisedClips.add(clip);
  }

  return animations;
}