import * as THREE from 'three';
import { PALETTE } from '../palette.ts';

/**
 * Uniforms every city material shares by reference: one write per frame reaches the whole city.
 * Slot Pulse: uPulseTime is when the latest wave left uPulseOrigin (xz); uPulseStrength and uPulseColor say how big.
 * Flash: the light of the latest explosion, so nearby facades light up without real-time lights.
 */
export const SHARED = {
  uTime: { value: 0 },
  uPulseTime: { value: -100 },
  uPulseOrigin: { value: new THREE.Vector2(0, 0) },
  uPulseStrength: { value: 0.35 },
  uPulseColor: { value: new THREE.Color(PALETTE.amber) },
  uFlashPos: { value: new THREE.Vector3(0, -1000, 0) },
  uFlashTime: { value: -100 },
  uFlashColor: { value: new THREE.Color(PALETTE.amber) },
};

export function share(material: THREE.ShaderMaterial): THREE.ShaderMaterial {
  for (const key of Object.keys(SHARED) as (keyof typeof SHARED)[]) {
    material.uniforms[key] = SHARED[key];
  }
  return material;
}

/** GLSL that reads the shared pulse and flash; include it in any material passed through share(). */
export const GLSL_SHARED = /* glsl */ `
uniform float uTime;
uniform float uPulseTime;
uniform vec2 uPulseOrigin;
uniform float uPulseStrength;
uniform vec3 uPulseColor;
uniform vec3 uFlashPos;
uniform float uFlashTime;
uniform vec3 uFlashColor;
float slotPulse(vec3 world) {
  float since = uTime - uPulseTime;
  float r = length(world.xz - uPulseOrigin);
  return exp(-pow((r - since * 70.0) / 5.0, 2.0)) * exp(-since * 0.8) * step(0.0, since) * uPulseStrength;
}
vec3 flashLight(vec3 world, vec3 n) {
  float age = uTime - uFlashTime;
  if (age < 0.0 || age > 3.0) return vec3(0.0);
  vec3 toL = uFlashPos - world;
  float d2 = dot(toL, toL);
  float facing = 0.35 + 0.65 * max(dot(n, normalize(toL)), 0.0);
  return uFlashColor * facing * exp(-age * 2.2) * 900.0 / (60.0 + d2);
}
`;

/** 150 BPM: one beat is 0.4 s and an eighth note is 0.2 s, Solana's slot time since October 2026. */
export const BPM = 150;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
