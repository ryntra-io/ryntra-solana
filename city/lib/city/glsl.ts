/** GLSL shared by every city material: hashes, value noise and the violet height fog. */

export const GLSL_COMMON = /* glsl */ `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

/**
 * One haze for every material: violet lit by the city, thin enough that the skyline still glows from across the water.
 * Since 28.10 lighter and thinner.
 */
export const FOG_COLOR = '#24173f';
export const FOG_DENSITY = 0.0019;
export const FOG_FALLOFF = 0.05;

/**
 * Height fog: dense near the ground, thin up high, so towers rise out of a violet haze.
 * uFogColor is the haze, uFogDensity the overall thickness, uFogFalloff how fast it thins with height.
 */
export const GLSL_FOG_PARS = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogFalloff;
vec3 applyFog(vec3 color, vec3 worldPos, vec3 camPos) {
  float dist = length(worldPos - camPos);
  float heightFactor = exp(-max(worldPos.y, 0.0) * uFogFalloff);
  float fog = 1.0 - exp(-dist * uFogDensity * (0.35 + heightFactor));
  return mix(color, uFogColor, clamp(fog, 0.0, 0.96));
}
`;
