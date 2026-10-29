import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLSL_COMMON } from '@/city/lib/city/glsl';
import { GLSL_SHARED, share } from '@/city/lib/city/shared';
import { PALETTE } from '@/city/lib/palette';

/**
 * The light a character makes around itself, each one draw call: the hologram it reads while thinking, the sparks of
 * a defeat, and the ground under it — a soft contact shadow under the body and feet, dust rings where a heavy foot
 * lands, the pool of its own light, and the ring of a celebration.
 */

const kindAttr = (g: THREE.BufferGeometry, kind: number) => {
  const n = g.attributes.position!.count;
  g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(n).fill(kind), 1));
  for (const name of Object.keys(g.attributes)) if (!['position', 'uv', 'aKind'].includes(name)) g.deleteAttribute(name);
  return g.index ? g.toNonIndexed() : g;
};

/**
 * The hologram over the palm: a projector cone, two turning rings, a turning lock at the centre and three panels of
 * scrolling figures around it. Built about its own origin (the palm), up +y.
 */
export function holoGeometry(): THREE.BufferGeometry {
  const cone = new THREE.CylinderGeometry(0.16, 0.02, 0.26, 24, 1, true);
  cone.translate(0, 0.13, 0);
  const ringA = new THREE.RingGeometry(0.15, 0.165, 48, 1);
  ringA.rotateX(-Math.PI / 2);
  ringA.translate(0, 0.27, 0);
  const ringB = new THREE.RingGeometry(0.2, 0.208, 64, 1);
  ringB.rotateX(-Math.PI / 2);
  ringB.translate(0, 0.37, 0);
  const lock = new THREE.OctahedronGeometry(0.055, 0);
  lock.translate(0, 0.37, 0);
  const panels: THREE.BufferGeometry[] = [];
  for (const a of [-0.7, 0, 0.7]) {
    const p = new THREE.PlaneGeometry(0.17, 0.12);
    p.translate(0, 0, 0.24);
    p.rotateY(a);
    p.translate(0, 0.42 + (a === 0 ? 0.04 : 0), 0);
    panels.push(kindAttr(p, 4));
  }
  return mergeGeometries([kindAttr(cone, 0), kindAttr(ringA, 1), kindAttr(ringB, 2), kindAttr(lock, 3), ...panels])!;
}

export function holoMaterial(): THREE.ShaderMaterial & { uniforms: { uHolo: { value: number } } } {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uHolo: { value: 0 },
      uViolet: { value: new THREE.Color(PALETTE.violet) },
      uWarm: { value: new THREE.Color(PALETTE.warmWhite) },
      uAmber: { value: new THREE.Color(PALETTE.amber) },
    },
    vertexShader: /* glsl */ `
      attribute float aKind;
      uniform float uHolo;
      ${GLSL_SHARED}
      varying vec2 vUv;
      varying float vKind;
      varying vec3 vLocal;
      vec3 spinY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
      void main() {
        vec3 p = position;
        if (aKind > 0.5 && aKind < 1.5) p = spinY(p, uTime * 1.3);
        if (aKind > 1.5 && aKind < 2.5) p = spinY(p, -uTime * 0.8);
        if (aKind > 2.5 && aKind < 3.5) {
          p.y -= 0.37;
          p = spinY(p, uTime * 2.0);
          float c = cos(uTime * 1.3), s = sin(uTime * 1.3);
          p.xy = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
          p.y += 0.37;
        }
        if (aKind > 3.5) p = spinY(p, sin(uTime * 0.6) * 0.25);
        // It grows out of the palm as it appears.
        p *= 0.35 + 0.65 * uHolo;
        vUv = uv;
        vKind = aKind;
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uHolo;
      uniform vec3 uViolet;
      uniform vec3 uWarm;
      uniform vec3 uAmber;
      ${GLSL_SHARED}
      ${GLSL_COMMON}
      varying vec2 vUv;
      varying float vKind;
      varying vec3 vLocal;
      void main() {
        vec3 c;
        if (vKind < 0.5) {
          // The projector: violet light thinning as it rises, with scanlines running up.
          float fade = pow(1.0 - vUv.y, 1.6);
          c = uViolet * (0.35 * fade + 0.25 * fade * step(0.6, fract(vUv.y * 18.0 - uTime * 3.0)));
        } else if (vKind < 2.5) {
          // Rings: dashes of warm light, turning with the ring.
          float a = atan(vLocal.z, vLocal.x) / 6.2831853;
          float dash = step(0.4, fract(a * (vKind < 1.5 ? 18.0 : 30.0)));
          c = mix(uAmber, uWarm, 0.5) * 1.5 * dash;
        } else if (vKind < 3.5) {
          c = uWarm * 1.8;
        } else {
          // Panels: a violet frame, rows of figures that change, a scan line running down.
          vec2 e = min(vUv, 1.0 - vUv);
          float frame = 1.0 - smoothstep(0.02, 0.05, min(e.x, e.y));
          float row = floor(vUv.y * 7.0);
          float len = 0.25 + 0.65 * hash11(row + floor(uTime * 2.5) * 7.0);
          float bar = step(0.12, vUv.x) * step(vUv.x, 0.12 + len * 0.76) * step(0.3, fract(vUv.y * 7.0)) * step(fract(vUv.y * 7.0), 0.75);
          float scan = exp(-pow((fract(-uTime * 0.6) - vUv.y) / 0.04, 2.0));
          c = uViolet * (0.12 + frame * 1.6) + uWarm * bar * 0.9 + uWarm * scan * 0.5;
        }
        float flicker = 0.9 + 0.1 * sin(uTime * 41.0) * sin(uTime * 13.0);
        gl_FragColor = vec4(c * uHolo * flicker, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  return share(m) as THREE.ShaderMaterial & { uniforms: { uHolo: { value: number } } };
}

/** Sparks: a burst from one point, falling under gravity, warm to amber to dark in a second. */
export const SPARKS = 48;

export function sparkGeometry(seed = 1): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const dir = new Float32Array(SPARKS * 4);
  for (let i = 0; i < SPARKS; i += 1) {
    const h = (k: number) => {
      const x = Math.sin((i + 1) * 12.9898 * k + seed * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    const a = h(1) * Math.PI * 2;
    const up = 0.15 + 0.85 * h(2);
    const out = Math.sqrt(1 - up * up);
    dir[i * 4] = Math.cos(a) * out;
    dir[i * 4 + 1] = up;
    dir[i * 4 + 2] = Math.sin(a) * out * 0.6 + 0.6;
    dir[i * 4 + 3] = 1.2 + 2.2 * h(3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
  g.setAttribute('aDir', new THREE.BufferAttribute(dir, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 4);
  return g;
}

export function sparkMaterial(): THREE.ShaderMaterial & { uniforms: { uOrigin: { value: THREE.Vector3 }; uStart: { value: number }; uScale: { value: number } } } {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uOrigin: { value: new THREE.Vector3() },
      uStart: { value: -100 },
      uScale: { value: 1 },
      uWarm: { value: new THREE.Color(PALETTE.warmWhite) },
      uAmber: { value: new THREE.Color(PALETTE.amber) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aDir;
      uniform vec3 uOrigin;
      uniform float uStart;
      uniform float uScale;
      ${GLSL_SHARED}
      varying float vAge;
      void main() {
        float age = uTime - uStart;
        vAge = age / (0.6 + aDir.w * 0.25);
        vec3 p = uOrigin + aDir.xyz * aDir.w * age - vec3(0.0, 4.9, 0.0) * age * age;
        p.y = max(p.y, 0.02);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uScale * 90.0 / -mv.z, 1.5, 9.0) * step(0.0, age) * step(vAge, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uWarm;
      uniform vec3 uAmber;
      varying float vAge;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float dot2 = 1.0 - smoothstep(0.15, 0.5, length(q));
        vec3 c = mix(uWarm * 4.0, uAmber * 1.5, smoothstep(0.0, 0.5, vAge)) * (1.0 - smoothstep(0.6, 1.0, vAge));
        gl_FragColor = vec4(c * dot2, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  return share(m) as ReturnType<typeof sparkMaterial>;
}

export type GroundUniforms = {
  uFeet: { value: THREE.Vector4 };
  uLift: { value: THREE.Vector2 };
  uBody: { value: THREE.Vector2 };
  uLight: { value: THREE.Vector4 };
  uLightColor: { value: THREE.Color };
  uStompL: { value: THREE.Vector4 };
  uStompR: { value: THREE.Vector4 };
  uBurst: { value: number };
};

/** The ground under a character, in its own space: a quad `size` wide on y = 0. */
export function groundGeometry(size = 4.4): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size, size);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.004, 0);
  return g;
}

export function groundMaterial(): THREE.ShaderMaterial & { uniforms: GroundUniforms } {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uFeet: { value: new THREE.Vector4(0.25, 0, -0.25, 0) },
      uLift: { value: new THREE.Vector2(0, 0) },
      uBody: { value: new THREE.Vector2(0, 0) },
      uLight: { value: new THREE.Vector4(0, 0.6, 0.8, 0) },
      uLightColor: { value: new THREE.Color(PALETTE.amber) },
      uStompL: { value: new THREE.Vector4(0, 0, -100, 0) },
      uStompR: { value: new THREE.Vector4(0, 0, -100, 0) },
      uBurst: { value: -100 },
      uWarm: { value: new THREE.Color(PALETTE.warmWhite) },
      uAmber: { value: new THREE.Color(PALETTE.amber) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec4 uFeet;
      uniform vec2 uLift;
      uniform vec2 uBody;
      uniform vec4 uLight;
      uniform vec3 uLightColor;
      uniform vec4 uStompL;
      uniform vec4 uStompR;
      uniform float uBurst;
      uniform vec3 uWarm;
      uniform vec3 uAmber;
      ${GLSL_SHARED}
      varying vec2 vP;
      float blob(vec2 p, vec2 c, vec2 r) { vec2 d = (p - c) / r; return exp(-dot(d, d)); }
      vec3 dust(vec2 p, vec4 s) {
        float age = uTime - s.z;
        if (age < 0.0 || age > 0.9) return vec3(0.0);
        float r = 0.14 + age * 0.9;
        float ring = exp(-pow((length(p - s.xy) - r) / (0.05 + age * 0.08), 2.0));
        return uWarm * ring * (1.0 - age / 0.9) * 0.16 * s.w;
      }
      void main() {
        // Contact shadow: a wide soft one under the body, tight ones under each foot that fade as a foot lifts.
        float shade = blob(vP, uBody, vec2(0.85, 0.65)) * 0.5;
        shade += blob(vP, uFeet.xy + vec2(0.0, 0.07), vec2(0.2, 0.3)) * 0.55 * (1.0 - smoothstep(0.0, 0.3, uLift.x));
        shade += blob(vP, uFeet.zw + vec2(0.0, 0.07), vec2(0.2, 0.3)) * 0.55 * (1.0 - smoothstep(0.0, 0.3, uLift.y));
        shade = min(shade, 0.82);
        // Its own light on the ground ahead of it.
        vec3 light = uLightColor * blob(vP, uLight.xy + uLight.zw * 0.55, vec2(0.75, 0.75)) * 0.05 * uLight.w;
        light += dust(vP, uStompL) + dust(vP, uStompR);
        float age = uTime - uBurst;
        if (age > 0.0 && age < 1.2) {
          float r = age * 3.2;
          float ring = exp(-pow((length(vP - uBody) - r) / 0.12, 2.0));
          light += mix(uWarm, uAmber, age) * ring * (1.0 - age / 1.2) * 1.4;
        }
        // Fade at the quad's edges.
        float edge = 1.0 - smoothstep(1.6, 2.2, max(abs(vP.x), abs(vP.y)));
        gl_FragColor = vec4(light * edge, shade * edge);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    toneMapped: false,
  });
  return share(m) as THREE.ShaderMaterial & { uniforms: GroundUniforms };
}
