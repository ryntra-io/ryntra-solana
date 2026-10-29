import * as THREE from 'three';
import { PALETTE } from '@/city/lib/palette';

/** The moon: 24° west of north and 13° up, upper left of the establishing shot; its light falls on the west faces. */
export const MOON_DIR = new THREE.Vector3(-0.396, 0.225, -0.89).normalize();

/**
 * The night's light, shared by every skyline material by reference (CITY-56): the moon, the afterglow in the north,
 * the street's amber from below, and the city's reflection — a cube captured once from inside the skyline
 * (`Reflections.tsx`), sampled through a sphere around the island so a facade sees its neighbours where they stand.
 * Before the cube exists (and on the Lite tier) glass reflects an analytic sky of the same colours.
 */
export const LIGHT = {
  /** The Blender detail tiles (`kit.ts`), on once the kit has arrived. */
  uConcrete: { value: null as THREE.Texture | null },
  uMetal: { value: null as THREE.Texture | null },
  uAsphalt: { value: null as THREE.Texture | null },
  uSmudge: { value: null as THREE.Texture | null },
  uDetailOn: { value: 0 },
  uEnv: { value: null as THREE.Texture | null },
  uEnvOn: { value: 0 },
  uEnvPos: { value: new THREE.Vector3(0, 22, 0) },
  uEnvRadius: { value: 96 },
  /** Texels of the cube per radian of view (its face size over a quarter turn). */
  uEnvTexels: { value: 128 / (Math.PI / 2) },
  uMoonDir: { value: MOON_DIR.clone() },
  uInk: { value: new THREE.Color(PALETTE.ink) },
  uGraphite: { value: new THREE.Color(PALETTE.graphite) },
  uPearl: { value: new THREE.Color(PALETTE.pearl) },
  uAmber: { value: new THREE.Color(PALETTE.amber) },
  uWarm: { value: new THREE.Color(PALETTE.warmWhite) },
  uViolet: { value: new THREE.Color(PALETTE.violet) },
  uHaze: { value: new THREE.Color(PALETTE.violetHaze) },
  uZenith: { value: new THREE.Color(PALETTE.zenith) },
  uIce: { value: new THREE.Color(PALETTE.ice) },
};

export function shareLight(material: THREE.ShaderMaterial): THREE.ShaderMaterial {
  for (const key of Object.keys(LIGHT) as (keyof typeof LIGHT)[]) material.uniforms[key] = LIGHT[key];
  return material;
}

/** GLSL for the shared light: the sky as glass sees it, the city's reflection, and diffuse light on a surface. */
export const GLSL_LIGHT = /* glsl */ `
uniform sampler2D uConcrete;
uniform sampler2D uMetal;
uniform sampler2D uAsphalt;
uniform sampler2D uSmudge;
uniform float uDetailOn;
uniform samplerCube uEnv;
uniform float uEnvOn;
uniform vec3 uEnvPos;
uniform float uEnvRadius;
uniform float uEnvTexels;
uniform vec3 uMoonDir;
uniform vec3 uInk;
uniform vec3 uGraphite;
uniform vec3 uPearl;
uniform vec3 uAmber;
uniform vec3 uWarm;
uniform vec3 uViolet;
uniform vec3 uHaze;
uniform vec3 uZenith;
uniform vec3 uIce;

const vec3 NORTH = vec3(0.0, 0.2, -0.98);

// The sky's own gradient (materials/skyMaterials.ts without its moon, stars and clouds): violet haze to zenith, the
// afterglow's warm band on the horizon, brightest in the north. The water's far edge melts into it (no horizon step).
vec3 skyDome(vec3 d) {
  float h = d.y;
  vec3 c = mix(uHaze, uZenith, smoothstep(0.0, 0.55, h));
  c = mix(c, uZenith * 0.5, smoothstep(0.55, 1.0, h));
  c = mix(c, uHaze * 0.55, smoothstep(0.0, -0.2, h));
  float north = 0.55 + 0.45 * max(0.0, -d.z);
  c += uAmber * exp(-abs(h) * 20.0) * 0.55 * north;
  c += mix(uViolet, uAmber, 0.35) * exp(-abs(h - 0.05) * 7.0) * 0.16 * north;
  return c;
}

// The moon in a mirror: its disc and a faint halo.
vec3 moonGlint(vec3 r) {
  float m = max(dot(r, uMoonDir), 0.0);
  return uIce * (pow(m, 900.0) * 3.0 + pow(m, 40.0) * 0.05);
}

// The night sky as a mirror sees it: the sky's gradient and the moon's glint.
vec3 skyMirror(vec3 r) {
  return skyDome(r) + moonGlint(r);
}

// How far the reflection turns across one pixel (radians), set by a material's main before it mirrors; 0 leaves the
// roughness alone. A curved facade far off swings its reflection over many texels of the cube within a pixel, and the
// cube is then read that much blurrier, so its lit windows never sparkle as the camera moves.
float gMirrorSpread = 0.0;
// The surface point's screen derivatives, set by a material's main in uniform control flow; zero leaves the detail
// tiles to the hardware's own derivatives.
vec3 gWorldDx = vec3(0.0);
vec3 gWorldDy = vec3(0.0);

// The city in a mirror at p looking along r: the captured cube, corrected through a sphere round the island so a
// facade reflects its neighbours where they stand; the analytic sky until the cube exists. rough: 0 sharp … 1 matte.
// A ray that misses the sphere, or meets it only behind the mirror, sees the open sky, not the cube: read through the
// sphere it would look at the cube's own floor, and the water round the island drew the sphere's rim as a pale dome
// on 28.10. The cube fades out toward the rays that graze the sphere, so no edge is left.
vec3 cityMirror(vec3 p, vec3 r, float rough) {
  // A rough mirror spreads the moon's disc into a pale blot: it keeps the moon only while it is nearly sharp.
  vec3 sky = skyDome(r) + moonGlint(r) * pow(1.0 - clamp(rough * 3.0, 0.0, 1.0), 2.0);
  if (uEnvOn < 0.5) return sky;
  vec3 oc = p - uEnvPos;
  float b = dot(oc, r);
  float c = dot(oc, oc) - uEnvRadius * uEnvRadius;
  float disc = b * b - c;
  float t = -b + sqrt(max(disc, 0.0));
  vec3 dir = normalize(oc + r * max(t, 0.0));
  float meet = smoothstep(0.0, 0.35, disc / (uEnvRadius * uEnvRadius)) * smoothstep(0.0, 0.3 * uEnvRadius, t);
  // The cube holds every lamp and lit window brighter than white; a mirror at night returns a dimmer world.
  float lod = max(rough * 6.0, log2(max(gMirrorSpread * uEnvTexels * 1.5, 1.0)));
  return mix(sky, textureLod(uEnv, dir, lod).rgb * 0.6, meet);
}

// A detail tile on a surface, mapped by the face's direction: walls by (along the wall, height), floors by (x, z).
// rgba: albedo variation, roughness, normal x and y; a flat 0.5 grey before the tiles arrive.
vec4 detailAt(sampler2D tile, vec3 p, vec3 n, float scale) {
  if (uDetailOn < 0.5) return vec4(0.5, 0.5, 0.5, 0.5);
  vec2 uv, gx, gy;
  if (abs(n.y) > 0.7) { uv = p.xz; gx = gWorldDx.xz; gy = gWorldDy.xz; }
  else {
    vec2 tg = normalize(vec2(-n.z, n.x) + vec2(1e-5, 0.0));
    uv = vec2(dot(p.xz, tg), p.y);
    gx = vec2(dot(gWorldDx.xz, tg), gWorldDx.y);
    gy = vec2(dot(gWorldDy.xz, tg), gWorldDy.y);
  }
  if (dot(gx, gx) + dot(gy, gy) > 0.0) return textureGrad(tile, uv * scale, gx * scale, gy * scale);
  return texture2D(tile, uv * scale);
}

// The normal bent by a tile's normal (strength 0..1).
vec3 detailNormal(vec3 n, vec4 d, float strength) {
  vec3 t = abs(n.y) > 0.7 ? vec3(1.0, 0.0, 0.0) : normalize(vec3(-n.z, 0.0, n.x) + vec3(1e-5, 0.0, 0.0));
  vec3 b = abs(n.y) > 0.7 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  return normalize(n + (t * (d.b * 2.0 - 1.0) + b * (d.a * 2.0 - 1.0)) * strength);
}

// Light on a matte surface at night: the violet sky above, the moon, the afterglow on north faces and the street's
// amber from below, fading with height; baked is the module's own lamps (from Blender), ao its baked occlusion.
vec3 nightLight(vec3 n, vec3 p, float ao, float baked) {
  float up = n.y * 0.5 + 0.5;
  vec3 sky = mix(uHaze * 0.55, uZenith * 1.3 + uHaze * 0.25, up);
  float moon = max(dot(n, uMoonDir), 0.0);
  float north = max(dot(n, NORTH), 0.0);
  float street = exp(-max(p.y, 0.0) * 0.16);
  vec3 l = sky * 1.05 + uIce * moon * 0.1 + mix(uViolet, uAmber, 0.35) * north * 0.12;
  l += uAmber * street * (0.1 + 0.25 * max(-n.y, 0.0));
  return l * ao + uWarm * baked * 0.85;
}
`;
