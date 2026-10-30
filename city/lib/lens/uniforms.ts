import * as THREE from 'three';
import { PALETTE } from '../palette.ts';

/**
 * What the Lens tells the towers' shaders (CITY-86). Each tower's own level (1 looked at, −1 sunk, 0 untouched) rides
 * with the tower: row 3, w of the skyline's tower texture, `aLens` on the procedural towers. These uniforms are shared by
 * reference: `uLensMove` 0 keeps every tower where it stands (reduced motion: the light changes, nothing moves),
 * `uLensMix` is how far the lens is on (the rails dim with it).
 */
export const LENS_RISE = 0.04;
export const LENS_SINK = 0.6;

export const LENS_UNIFORMS = {
  uLensMove: { value: 1 },
  uLensMix: { value: 0 },
  uLensRim: { value: new THREE.Color(PALETTE.violet).multiplyScalar(1.6) },
  uLensInk: { value: new THREE.Color(PALETTE.inkDeep) },
};

export function shareLens<T extends THREE.ShaderMaterial>(material: T): T {
  Object.assign(material.uniforms, LENS_UNIFORMS);
  return material;
}

/**
 * GLSL for a tower under the lens. lensY: a height already scaled by the tower's build, risen a little or sunk into the
 * ground by its level. lensColor: the violet rim light on a tower looked at, the ink haze on one sunk.
 */
export const GLSL_LENS = /* glsl */ `
uniform float uLensMove;
uniform vec3 uLensRim;
uniform vec3 uLensInk;
float lensY(float y, float height, float lens) {
  float f = max(lens, 0.0) * uLensMove;
  float d = max(-lens, 0.0) * uLensMove;
  return y * (1.0 + ${LENS_RISE.toFixed(3)} * f) - ${LENS_SINK.toFixed(3)} * d * height;
}
vec3 lensColor(vec3 color, vec3 n, vec3 v, float y01, float lens) {
  float f = max(lens, 0.0);
  float d = max(-lens, 0.0);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 2.4);
  color += uLensRim * f * (0.05 + rim * 1.3) * (0.5 + 0.5 * y01);
  return mix(color, uLensInk, d * 0.78);
}
`;

/** The same on the CPU, for what stands on a tower or over it (crowns, signs, halos): a point y up a tower this tall. */
export function lensY(y: number, height: number, lens: number, move: number): number {
  const f = Math.max(lens, 0) * move;
  const d = Math.max(-lens, 0) * move;
  return y * (1 + LENS_RISE * f) - LENS_SINK * d * height;
}

/** The lens's ease: fast out, soft landing, about 700 ms end to end. */
export const LENS_MS = 700;
export const easeLens = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
