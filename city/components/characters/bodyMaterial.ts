import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY, FOG_FALLOFF, GLSL_COMMON, GLSL_FOG_PARS } from '@/city/lib/city/glsl';
import { GLSL_SHARED, share } from '@/city/lib/city/shared';
import { CH } from '@/city/lib/characters/expression';
import { PALETTE } from '@/city/lib/palette';
import type { BodySkin } from './model';

/**
 * One material for the whole character, so a guardian costs one draw call. The vertex shader places every vertex with
 * its bone's matrix (12 numbers a bone, read as three vec4 rows); the fragment shader lights each surface as metal,
 * paint or carbon would be lit in the city — the afterglow from the north as a strong rim, the zenith's violet from
 * above, the street's amber from below, reflections of a night sky and a lit horizon — and draws the face on the
 * visor from the expression's numbers. Lights on the body (seams, the core, vents, the beacon) burn above 1 and bloom.
 */

const VERTEX = /* glsl */ `
  attribute vec2 aPart;
  #ifdef TEXTURED
    attribute vec4 tangent;
    varying vec4 vTangentW;
  #endif
  uniform vec4 uBones[BONES * 3];
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vChar;
  varying vec3 vCharN;
  varying vec3 vLocal;
  varying vec3 vLocalN;
  varying vec2 vUv;
  varying float vMat;

  void main() {
    int b = int(aPart.x + 0.5) * 3;
    vec4 r0 = uBones[b];
    vec4 r1 = uBones[b + 1];
    vec4 r2 = uBones[b + 2];
    vec4 p = vec4(position, 1.0);
    vec3 cp = vec3(dot(r0, p), dot(r1, p), dot(r2, p));
    vec3 cn = vec3(dot(r0.xyz, normal), dot(r1.xyz, normal), dot(r2.xyz, normal));
    vec4 world = modelMatrix * vec4(cp, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * cn);
    #ifdef TEXTURED
      vec3 ct = vec3(dot(r0.xyz, tangent.xyz), dot(r1.xyz, tangent.xyz), dot(r2.xyz, tangent.xyz));
      vTangentW = vec4(normalize(mat3(modelMatrix) * ct), tangent.w);
    #endif
    vChar = cp;
    vCharN = cn;
    vLocal = position;
    vLocalN = normal;
    vUv = uv;
    vMat = aPart.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uAmber;
  uniform vec3 uWarm;
  uniform vec3 uViolet;
  uniform vec3 uZenith;
  uniform vec3 uFlare;
  uniform vec3 uInk;
  uniform vec3 uFaceColor;
  // glow, open, arc, slant | size, gazeX, gazeY, mouth | smile, wide, talk, scan | glitch, cross, core, seams | beacon, silhouette
  uniform vec4 uFace0;
  uniform vec4 uFace1;
  uniform vec4 uFace2;
  uniform vec4 uFace3;
  uniform vec2 uFace4;
  // The light: a key, a rim and a fill (the city's by default; the studio sets its own), and how wide the visor is.
  uniform vec3 uKeyDir;
  uniform vec3 uKeyCol;
  uniform vec3 uRimDir;
  uniform vec3 uRimCol;
  uniform vec3 uFillDir;
  uniform vec3 uFillCol;
  uniform float uVisorAspect;
  uniform float uGround;
  #ifdef TEXTURED
    uniform sampler2D uBaseMap;
    uniform sampler2D uOrmMap;
    uniform sampler2D uNormalMap;
    // The crowd level reads its textures a few mip levels down: simplified, its UVs smear; far away they should.
    uniform float uTexBias;
    varying vec4 vTangentW;
  #endif
  #ifdef ENVMAP
    // An HDR environment, prefiltered (PMREM): reflections and the light from everywhere.
    #define ENVMAP_TYPE_CUBE_UV
    uniform sampler2D envMap;
    uniform float uEnvIntensity;
    #include <cube_uv_reflection_fragment>
  #endif

  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vChar;
  varying vec3 vCharN;
  varying vec3 vLocal;
  varying vec3 vLocalN;
  varying vec2 vUv;
  varying float vMat;

  ${GLSL_SHARED}
  ${GLSL_COMMON}
  ${GLSL_FOG_PARS}

  const float PI = 3.14159265;

  bool isMat(float id) { return abs(vMat - id) < 0.5; }

  // ——— Light: GGX specular, split-sum environment (Karis' fit), the city's three lights ———
  float dGGX(float noh, float a) {
    float a2 = a * a;
    float d = noh * noh * (a2 - 1.0) + 1.0;
    // A small floor only: a larger one flattens the highlight of glazed ceramic and glass to nothing.
    return a2 / (PI * d * d + 1e-7);
  }
  float vSmith(float nov, float nol, float a) {
    float a2 = a * a;
    float gv = nol * sqrt(nov * nov * (1.0 - a2) + a2);
    float gl = nov * sqrt(nol * nol * (1.0 - a2) + a2);
    return 0.5 / max(gv + gl, 1e-4);
  }
  vec3 envBRDF(vec3 f0, float rough, float nov) {
    const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
    const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
    vec4 r = rough * c0 + c1;
    float a004 = min(r.x * r.x, exp2(-9.28 * nov)) * r.x + r.y;
    vec2 ab = vec2(-1.04, 1.04) * a004 + r.zw;
    return f0 * ab.x + ab.y;
  }

  // The night around the character, as a mirror sees it: zenith violet overhead, a band of the city's amber on the
  // horizon with lit windows in it, the afterglow brightest in the north, dark streets below.
  vec3 envColor(vec3 r, float rough) {
    float y = r.y;
    float sharp = 1.0 - rough;
    vec3 sky = mix(uViolet * 0.16, uZenith * 0.9, smoothstep(0.05, 0.75, y));
    float north = smoothstep(0.2, -1.0, r.z) * smoothstep(-0.05, 0.25, y) * (1.0 - smoothstep(0.25, 0.9, y));
    sky += mix(uViolet, uWarm, 0.3) * north * 0.55;
    float band = exp(-abs(y - 0.03) * mix(5.0, 22.0, sharp));
    vec3 horizon = uAmber * band * 0.5;
    float a = atan(r.x, r.z);
    float windows = step(0.55, vnoise(vec2(a * 14.0, floor(y * 40.0)))) * exp(-abs(y - 0.06) * 18.0) * smoothstep(0.62, 0.85, sharp);
    horizon += uWarm * windows * 0.6;
    vec3 ground = mix(uAmber * 0.07, uInk * 0.4, smoothstep(0.0, -0.5, y));
    vec3 c = y > 0.0 ? sky : ground;
    // A broad soft light overhead and in front, as from the lit plaza: it gives plates their sheen.
    c += uWarm * 0.12 * smoothstep(0.4, 1.0, dot(r, normalize(vec3(0.0, 0.6, 0.8)))) * (0.4 + 0.6 * sharp);
    return c + horizon;
  }

  vec3 shade(vec3 base, float metal, float rough, float spec, vec3 n, vec3 v, float ao) {
    float a = max(rough * rough, 0.004);
    float nov = max(dot(n, v), 1e-3);
    vec3 f0 = mix(vec3(spec), base, metal);
    vec3 diff = base * (1.0 - metal);
    vec3 col = vec3(0.0);
    // Key, rim and fill (CITY_LIGHT below: in the city the lit square, the afterglow in the north, a low violet).
    for (int i = 0; i < 3; i++) {
      vec3 l = i == 0 ? uKeyDir : i == 1 ? uRimDir : uFillDir;
      vec3 lc = i == 0 ? uKeyCol : i == 1 ? uRimCol : uFillCol;
      float nol = max(dot(n, l), 0.0);
      if (nol <= 0.0) continue;
      vec3 h = normalize(l + v);
      float noh = max(dot(n, h), 0.0);
      float voh = max(dot(v, h), 0.0);
      vec3 f = f0 + (1.0 - f0) * pow(1.0 - voh, 5.0);
      vec3 s = dGGX(noh, a) * vSmith(nov, nol, a) * f;
      col += (diff * (1.0 - f) / PI + s) * lc * nol * (i == 0 ? mix(0.4, 1.0, ao) : 1.0);
    }
    vec3 r = reflect(-v, n);
    #ifdef ENVMAP
      col += diff * textureCubeUV(envMap, n, 1.0).rgb * uEnvIntensity * ao;
      col += textureCubeUV(envMap, r, rough).rgb * uEnvIntensity * envBRDF(f0, rough, nov) * mix(0.25, 1.0, ao);
    #else
      // Ambient: the zenith from above, the street's amber from below (fading up the body).
      float street = (1.0 - smoothstep(0.0, 3.2, vWorld.y)) * (0.55 - 0.45 * n.y);
      vec3 irr = uViolet * 0.08 * (0.5 + 0.5 * n.y) + uAmber * 0.22 * street + vec3(0.012);
      col += diff * irr * ao;
      // Reflections.
      col += envColor(r, rough) * envBRDF(f0, rough, nov) * mix(0.3, 1.0, ao) * (1.0 + 0.6 * street * metal);
    #endif
    // The violet rim of the city's materials.
    col += uViolet * pow(1.0 - nov, 5.0) * 0.12 * ao;
    return col;
  }

  // ——— The face on the visor ———
  float sdBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  float sdSeg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  float eye(vec2 p, float side) {
    float open = uFace0.y;
    float arc = uFace0.z;
    float slant = uFace0.w;
    float size = uFace1.x;
    float cross = uFace3.y;
    p.x *= side;
    // Inner end toward the nose is −x after the mirror; a stern slant drops it, a worried one lifts it.
    float a = -slant * 0.32;
    p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
    float w = 0.2 * size;
    float h = 0.12 * open;
    float bar = sdBox(p, vec2(w, max(h, 0.014)), min(max(h, 0.014), 0.06));
    // Happy: an arc bowed upward (^).
    float ring = abs(length(p - vec2(0.0, -0.17)) - 0.24) - 0.045;
    ring = max(ring, -(p.y + 0.02));
    float d = mix(bar, ring, arc);
    float x = min(sdSeg(p, vec2(-0.13, -0.11), vec2(0.13, 0.11)), sdSeg(p, vec2(-0.13, 0.11), vec2(0.13, -0.11))) - 0.035;
    return mix(d, x, cross);
  }
  float mouth(vec2 p) {
    float m = uFace1.w;
    float smile = uFace2.x;
    float w = 0.36 * uFace2.y;
    float talk = uFace2.z;
    float x = clamp(p.x, -w, w);
    float k = 1.0 - (x * x) / (w * w);
    float y = smile * 0.09 * ((x * x) / (w * w) - 0.4);
    y += sin(x * 34.0 - uTime * 21.0) * 0.035 * talk * k;
    float open = max(m * 0.15 * k, 0.022);
    return max(abs(p.y - y) - open, abs(p.x) - w - 0.02);
  }
  vec3 visor(vec2 uv, vec3 n, vec3 v) {
    float glitch = uFace3.x;
    vec2 p = (uv - 0.5) * vec2(uVisorAspect, 1.0);
    // A broken visor tears in bands and flickers.
    float row = floor(p.y * 9.0 + floor(uTime * 13.0) * 3.1);
    p.x += glitch * (hash11(row) - 0.5) * 0.35 * step(0.55, hash11(row + 7.0));
    float flicker = 1.0 - glitch * 0.75 * step(0.6, hash11(floor(uTime * 17.0)));
    vec2 gaze = vec2(uFace1.y * 0.16, uFace1.z * 0.08);
    float d = min(eye(p - vec2(0.52, 0.1) - gaze, 1.0), eye(p - vec2(-0.52, 0.1) - gaze, -1.0));
    // At rest the mouth is gone and the face is the slit alone; it shows when the guardian speaks or feels.
    float mouthOn = smoothstep(0.04, 0.2, uFace1.w + max(abs(uFace2.x) - 0.12, 0.0) * 1.5 + uFace2.z);
    d = min(d, mouth(p - vec2(0.0, -0.27)) + (1.0 - mouthOn) * 0.5);
    float aa = fwidth(d) * 1.2;
    float shape = 1.0 - smoothstep(-aa, aa, d);
    float halo = exp(-max(d, 0.0) * 45.0) * 0.22;
    // The slit: a thread of light across the whole glass at the eyes' height, fading toward the sides.
    float edge = 0.5 * uVisorAspect;
    float slit = exp(-pow((p.y - 0.1 - gaze.y) / 0.022, 2.0)) * (1.0 - smoothstep(0.55, 0.98, abs(p.x) / edge));
    // Thinking: a bar of light sweeps the visor.
    float sweep = exp(-pow((p.x - sin(uTime * 2.4) * 1.15) / 0.07, 2.0)) * uFace2.w;
    float lines = 0.75 + 0.25 * step(0.5, fract(uv.y * 26.0));
    vec3 light = uFaceColor * uFace0.x * flicker * (shape * 2.8 * lines + halo + slit * 1.6 + sweep * 0.9);
    // Black glass over it, as glossy as the helmet round it.
    vec3 glass = shade(vec3(0.014, 0.014, 0.017), 0.0, 0.07, 0.05, n, v, 1.0);
    return glass + light;
  }

  // ——— Carbon fibre: a 2×2 twill whose bundles tilt the normal across their width ———
  vec3 weave(vec3 n, out float mask) {
    vec3 an = abs(vLocalN);
    vec2 q = an.x > an.y && an.x > an.z ? vLocal.zy : an.y > an.z ? vLocal.xz : vLocal.xy;
    q /= 0.022;
    vec2 cell = floor(q);
    vec2 f = fract(q);
    bool across = mod(cell.x + cell.y, 4.0) < 2.0;
    float u = across ? f.y : f.x;
    float bulge = cos((u - 0.5) * PI);
    mask = bulge;
    // Far away the pattern blurs to its average instead of shimmering.
    float fade = 1.0 - smoothstep(0.35, 1.0, length(fwidth(q)));
    vec3 t = normalize(dFdx(vWorld));
    vec3 bt = normalize(cross(n, t));
    vec3 tilt = (across ? bt : t) * (u - 0.5) * 0.6 * fade;
    return normalize(n + tilt);
  }

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vWorld);
    if (!gl_FrontFacing) n = -n;
    float glow = uFace0.x;
    float coreK = uFace3.z;
    float seamK = uFace3.w;
    float beacon = uFace4.x;
    float pulse = slotPulse(vWorld);

    #ifdef SILHOUETTE
      gl_FragColor = vec4(vec3(0.0), 1.0);
      return;
    #endif
    #ifdef SHADOWCAST
      // For the contact shadow (contactShadow.ts): as dark as the surface is low over the ground.
      float lift = max(vWorld.y - uGround, 0.0);
      gl_FragColor = vec4(vec3(0.0), pow(1.0 - smoothstep(0.0, 1.1, lift), 2.0));
      return;
    #endif

    // Occlusion, cheaply: faces turned toward the body's axis, undersides and the joints between plates are darker.
    vec2 axis = vChar.xz - vec2(0.0, -0.05);
    float inward = dot(normalize(vCharN.xz + 1e-4), -normalize(axis + 1e-4)) * smoothstep(0.08, 0.35, length(axis));
    float ao = (1.0 - 0.45 * max(inward, 0.0)) * (0.75 + 0.25 * smoothstep(-0.8, 0.2, vCharN.y));
    ao *= 0.8 + 0.2 * smoothstep(0.0, 0.6, vChar.y);

    // Worn edges: where the normal turns fast, the paint is rubbed down to the metal.
    float curvature = length(fwidth(vNormalW)) / max(length(fwidth(vWorld)), 1e-5);
    float grain = vnoise(vLocal.xy * 23.0 + vLocal.z * 17.0);
    float wear = smoothstep(14.0, 34.0, curvature + grain * 5.0) * (1.0 - smoothstep(0.4, 1.4, length(fwidth(vWorld)) * 60.0)) * 0.85;

    vec3 color;
    #ifdef TEXTURED
    if (vMat < 0.5) {
      // Baked in Blender: base colour, occlusion · roughness · metal, and the fine relief in tangent space.
      vec3 base = texture2D(uBaseMap, vUv, uTexBias).rgb;
      vec3 orm = texture2D(uOrmMap, vUv, uTexBias).rgb;
      vec3 tn = texture2D(uNormalMap, vUv, uTexBias).xyz * 2.0 - 1.0;
      tn.z = sqrt(max(1e-4, 1.0 - dot(tn.xy, tn.xy)));
      vec3 t = vTangentW.xyz - n * dot(n, vTangentW.xyz);
      float tl = length(t);
      vec3 nm = n;
      if (tl > 1e-4) {
        t /= tl;
        vec3 b = cross(n, t) * (gl_FrontFacing ? vTangentW.w : -vTangentW.w);
        nm = normalize(t * tn.x + b * tn.y + n * tn.z);
      }
      color = shade(base, orm.b, max(orm.g, 0.06), 0.045, nm, v, orm.r);
    } else
    #endif
    if (isMat(0.0)) {
      // Armour: deep gunmetal paint under a clear coat; on the sharpest edges it is rubbed down to bright steel.
      vec3 paint = vec3(0.034, 0.032, 0.045) * (0.92 + 0.16 * grain);
      color = shade(mix(paint, vec3(0.55, 0.54, 0.58), wear), wear, mix(0.34 + 0.06 * grain, 0.24, wear), 0.06, n, v, ao);
        } else if (isMat(1.0)) {
      float mask;
      vec3 nw = weave(n, mask);
      color = shade(vec3(0.014, 0.014, 0.019) * (0.7 + 0.5 * mask), 0.0, 0.22, 0.06, nw, v, ao);
    } else if (isMat(2.0)) {
      color = shade(vec3(0.56, 0.55, 0.6), 1.0, 0.26 + 0.1 * grain, 0.04, n, v, ao);
    } else if (isMat(3.0)) {
      color = shade(vec3(0.012, 0.011, 0.016), 0.0, 0.75, 0.03, n, v, ao * 0.8);
    } else if (isMat(4.0)) {
      // Old bronze: the vault's gold, darker in the hollows, bright where hands have worn it.
      vec3 bronze = mix(vec3(0.42, 0.25, 0.09), vec3(0.62, 0.4, 0.16), wear);
      color = shade(bronze, 1.0, mix(0.36, 0.22, wear) + 0.08 * grain, 0.04, n, v, ao);
    } else if (isMat(5.0)) {
      // Seams: the state's light, a light pulse running along them while busy.
      float run = 0.75 + 0.25 * sin(vChar.y * 9.0 - uTime * 5.0 * seamK);
      color = uFaceColor * (0.25 + 2.2 * seamK * run) + pulse * uAmber * 1.5;
    } else if (isMat(6.0)) {
      // The core: a lens with a hot centre and a ring, breathing with the state (its UVs span the disc).
      float r = length(vUv - 0.5) * 2.0;
      float heart = 1.0 - smoothstep(0.0, 0.75, r);
      float ring = exp(-pow((r - 0.8) / 0.12, 2.0));
      float flicker = 1.0 - uFace3.x * 0.7 * step(0.5, hash11(floor(uTime * 23.0)));
      color = (uFaceColor * (0.35 + 2.6 * coreK) * (0.55 + 0.45 * ring) + uWarm * heart * coreK * 1.6) * flicker + pulse * uAmber;
    } else if (isMat(7.0)) {
      color = visor(vUv, n, v);
    } else if (isMat(8.0)) {
      // The beacon: dark red glass; in an alarm a light turning inside it.
      float a = atan(vLocal.x, vLocal.z) - uTime * 7.0;
      float beam = pow(max(cos(a), 0.0), 6.0);
      vec3 glass = shade(uFlare * 0.06, 0.0, 0.1, 0.05, n, v, ao);
      color = glass + uFlare * beacon * (0.6 + 3.5 * beam);
    } else if (isMat(10.0)) {
      // White ceramic: a glossy pale shell; on its sharpest edges a chip shows the grey primer.
      vec3 white = mix(vec3(0.68, 0.665, 0.63) * (0.97 + 0.06 * grain), vec3(0.13, 0.13, 0.14), wear * 0.5);
      color = shade(white, 0.0, mix(0.06 + 0.03 * grain, 0.45, wear * 0.5), 0.05, n, v, ao);
    } else if (isMat(11.0)) {
      // Black glass: mirror-glossy, its worn edges only losing the shine.
      color = shade(vec3(0.014, 0.014, 0.017), 0.0, 0.07 + 0.12 * wear, 0.05, n, v, ao);
    } else {
      // Vents: warm light deep in the stacks, brighter as the machine works.
      color = uAmber * (0.5 + 0.9 * seamK) * (0.8 + 0.2 * sin(uTime * 3.0 + vChar.x * 9.0));
    }
    color += pulse * uAmber * 0.04 + flashLight(vWorld, n) * 0.3;

    #ifdef ATLAS
      // For the impostor's picture: no haze, gently encoded so darks keep their steps in 8 bits.
      gl_FragColor = vec4(sqrt(clamp(color, 0.0, 1.0)), 1.0);
      return;
    #endif
    gl_FragColor = vec4(applyFog(color, vWorld, cameraPosition), 1.0);
  }
`;

/** The city's light on a body: key (the lit square), rim (the afterglow in the north), fill (a low violet). */
export const CITY_LIGHT = {
  key: { dir: new THREE.Vector3(0.55, 0.55, 0.62).normalize(), color: new THREE.Color(PALETTE.warmWhite).lerp(new THREE.Color(PALETTE.amber), 0.3).multiplyScalar(2.1) },
  rim: { dir: new THREE.Vector3(0.15, 0.5, -1.0).normalize(), color: new THREE.Color(PALETTE.violet).lerp(new THREE.Color(PALETTE.warmWhite), 0.25).multiplyScalar(3.4) },
  fill: { dir: new THREE.Vector3(-0.75, 0.15, 0.45).normalize(), color: new THREE.Color(PALETTE.violet).multiplyScalar(0.55) },
};
export type BodyLight = typeof CITY_LIGHT;

export type BodyUniforms = {
  uBones: { value: Float32Array };
  uTexBias: { value: number };
  uFaceColor: { value: THREE.Color };
  uFace0: { value: THREE.Vector4 };
  uFace1: { value: THREE.Vector4 };
  uFace2: { value: THREE.Vector4 };
  uFace3: { value: THREE.Vector4 };
  uFace4: { value: THREE.Vector2 };
};

export type BodyOptions = {
  /** The textures of a body modelled in Blender (`model.ts`); without them the code-built surfaces are drawn. */
  skin?: BodySkin | null;
  /** A prefiltered HDR environment (PMREMGenerator) for reflections and ambient light — the studio's. */
  env?: THREE.Texture | null;
  envIntensity?: number;
  light?: BodyLight;
};

/** A body material for a rig of `bones` bones. Each character gets its own (its own bones and face). */
export function createBodyMaterial(bones: number, mode: 'scene' | 'atlas' | 'silhouette' | 'shadow' = 'scene', options: BodyOptions = {}): THREE.ShaderMaterial & { uniforms: BodyUniforms } {
  const { skin = null, env = null, envIntensity = 1, light = CITY_LIGHT } = options;
  const defines: Record<string, string | number> = { BONES: bones };
  if (mode === 'atlas') defines.ATLAS = 1;
  if (mode === 'silhouette') defines.SILHOUETTE = 1;
  if (mode === 'shadow') defines.SHADOWCAST = 1;
  if (skin) defines.TEXTURED = 1;
  if (env) Object.assign(defines, { ENVMAP: 1, ...cubeUvDefines(env) });
  const material = new THREE.ShaderMaterial({
    defines,
    uniforms: {
      uKeyDir: { value: light.key.dir.clone() },
      uKeyCol: { value: light.key.color.clone() },
      uRimDir: { value: light.rim.dir.clone() },
      uRimCol: { value: light.rim.color.clone() },
      uFillDir: { value: light.fill.dir.clone() },
      uFillCol: { value: light.fill.color.clone() },
      uVisorAspect: { value: skin?.visorAspect ?? 2.67 },
      uGround: { value: 0 },
      uBaseMap: { value: skin?.base ?? null },
      uOrmMap: { value: skin?.orm ?? null },
      uNormalMap: { value: skin?.normal ?? null },
      uTexBias: { value: 0 },
      envMap: { value: env },
      uEnvIntensity: { value: envIntensity },
      uBones: { value: new Float32Array(bones * 12) },
      uFaceColor: { value: new THREE.Color(PALETTE.amber) },
      uFace0: { value: new THREE.Vector4(1, 1, 0, 0) },
      uFace1: { value: new THREE.Vector4(1, 0, 0, 0) },
      uFace2: { value: new THREE.Vector4(0.1, 1, 0, 0) },
      uFace3: { value: new THREE.Vector4(0, 0, 0.8, 0.6) },
      uFace4: { value: new THREE.Vector2(0, 0) },
      uAmber: { value: new THREE.Color(PALETTE.amber) },
      uWarm: { value: new THREE.Color(PALETTE.warmWhite) },
      uViolet: { value: new THREE.Color(PALETTE.violet) },
      uZenith: { value: new THREE.Color(PALETTE.zenith) },
      uFlare: { value: new THREE.Color(PALETTE.flare) },
      uInk: { value: new THREE.Color(PALETTE.ink) },
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: mode === 'scene' ? FOG_DENSITY : 0 },
      uFogFalloff: { value: FOG_FALLOFF },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
  return share(material) as THREE.ShaderMaterial & { uniforms: BodyUniforms };
}

/** The sizes three.js gives a prefiltered (cube-UV) environment, as its own materials get them. */
function cubeUvDefines(env: THREE.Texture): Record<string, string> {
  const height = (env.image as { height: number }).height;
  const maxMip = Math.log2(height) - 2;
  const texelHeight = 1 / height;
  const texelWidth = 1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16));
  return { CUBEUV_MAX_MIP: `${maxMip}.0`, CUBEUV_TEXEL_WIDTH: `${texelWidth}`, CUBEUV_TEXEL_HEIGHT: `${texelHeight}` };
}

/** Copies an animator's bones and expression into a body material. */
export function writeBody(u: BodyUniforms, mats: Float32Array, face: Float32Array): void {
  u.uBones.value.set(mats);
  u.uFaceColor.value.setRGB(face[CH.r]!, face[CH.g]!, face[CH.b]!, THREE.LinearSRGBColorSpace);
  u.uFace0.value.set(face[CH.glow]!, face[CH.open]!, face[CH.arc]!, face[CH.slant]!);
  u.uFace1.value.set(face[CH.size]!, face[CH.gazeX]!, face[CH.gazeY]!, face[CH.mouth]!);
  u.uFace2.value.set(face[CH.smile]!, face[CH.wide]!, face[CH.talk]!, face[CH.scan]!);
  u.uFace3.value.set(face[CH.glitch]!, face[CH.cross]!, face[CH.core]!, face[CH.seams]!);
  u.uFace4.value.set(face[CH.beacon]!, 0);
}
