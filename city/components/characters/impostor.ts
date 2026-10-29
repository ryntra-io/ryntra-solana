import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY, FOG_FALLOFF, GLSL_FOG_PARS } from '@/city/lib/city/glsl';
import type { Animator } from '@/city/lib/characters/animator';
import { CH } from '@/city/lib/characters/expression';
import { createBodyMaterial, writeBody, type BodyOptions } from './bodyMaterial';

/**
 * The far plane: the character as a picture of itself. Once, on first need, the standing body is rendered from 16
 * directions at two heights into one atlas; far away a single quad turns to the camera and shows the two nearest
 * views blended. Its lights (visor, core, seams) are rendered white into the atlas and coloured here with the live
 * expression, so an alarm still shows red from across the island.
 */

export const AZIMUTHS = 16;
export const ELEVATIONS = [10, 38] as const;
const COLS = 8;
const ROWS = (AZIMUTHS * ELEVATIONS.length) / COLS;
const FRAME = [128, 150] as const;

/** The box each view frames, in the character's units: centre height, width and height. */
export type Frame = { center: number; width: number; height: number };

export type Atlas = { texture: THREE.Texture; frame: Frame; dispose: () => void };

/**
 * Renders the atlas: `animator` holds the pose to picture (its expression is overridden with white lights), `geometry`
 * the body at standard detail.
 */
export function renderAtlas(gl: THREE.WebGLRenderer, geometry: THREE.BufferGeometry, animator: Animator, frame: Frame, options: BodyOptions = {}): Atlas {
  const target = new THREE.WebGLRenderTarget(FRAME[0] * COLS, FRAME[1] * ROWS, {
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: true,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const material = createBodyMaterial(animator.mats.length / 12, 'atlas', options);
  const face = animator.face.slice();
  face[CH.r] = 1;
  face[CH.g] = 1;
  face[CH.b] = 1;
  face[CH.glow] = 1.6;
  face[CH.core] = 1;
  face[CH.seams] = 0.8;
  face[CH.holo] = 0;
  face[CH.beacon] = 0;
  writeBody(material.uniforms, animator.mats, face);
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(-frame.width / 2, frame.width / 2, frame.height / 2, -frame.height / 2, 0.1, 20);

  const before = gl.getRenderTarget();
  const clear = gl.getClearColor(new THREE.Color());
  const alpha = gl.getClearAlpha();
  const autoClear = gl.autoClear;
  gl.setRenderTarget(target);
  gl.setClearColor(0x000000, 0);
  gl.clear(true, true, true);
  gl.autoClear = false;
  const center = new THREE.Vector3(0, frame.center, 0);
  for (let row = 0; row < ELEVATIONS.length; row += 1) {
    const e = (ELEVATIONS[row]! * Math.PI) / 180;
    for (let i = 0; i < AZIMUTHS; i += 1) {
      const a = (i / AZIMUTHS) * Math.PI * 2;
      camera.position.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(8).add(center);
      camera.lookAt(center);
      const k = row * AZIMUTHS + i;
      const x = (k % COLS) * FRAME[0];
      const y = Math.floor(k / COLS) * FRAME[1];
      target.viewport.set(x, y, FRAME[0], FRAME[1]);
      target.scissor.set(x, y, FRAME[0], FRAME[1]);
      target.scissorTest = true;
      gl.setRenderTarget(target);
      gl.render(scene, camera);
    }
  }
  target.scissorTest = false;
  gl.autoClear = autoClear;
  gl.setClearColor(clear, alpha);
  gl.setRenderTarget(before);
  material.dispose();
  return { texture: target.texture, frame, dispose: () => target.dispose() };
}

export type ImpostorUniforms = {
  uAtlas: { value: THREE.Texture | null };
  uFaceColor: { value: THREE.Color };
  uGlow: { value: number };
};

/** The quad of the far plane: `frame` as rendered into the atlas, standing on y = 0 of the character's space. */
export function impostorGeometry(frame: Frame): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(frame.width, frame.height);
  g.translate(0, frame.center, 0);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, frame.center, 0), Math.hypot(frame.width, frame.height) / 2);
  return g;
}

export function impostorMaterial(frame: Frame): THREE.ShaderMaterial & { uniforms: ImpostorUniforms } {
  return new THREE.ShaderMaterial({
    defines: { AZIMUTHS, COLS: COLS.toFixed(1), ROWS: ROWS.toFixed(1), ELEV0: ELEVATIONS[0].toFixed(1), ELEV1: ELEVATIONS[1].toFixed(1) },
    uniforms: {
      uAtlas: { value: null },
      uFaceColor: { value: new THREE.Color() },
      uGlow: { value: 1 },
      uCenter: { value: frame.center },
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
      uFogFalloff: { value: FOG_FALLOFF },
    },
    vertexShader: /* glsl */ `
      uniform float uCenter;
      varying vec2 vUv;
      varying vec2 vPick;
      varying vec3 vWorld;
      void main() {
        // Where the camera is, in the character's own space: which way to turn and which views to show.
        vec3 cam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        float az = atan(cam.x, cam.z);
        float el = degrees(atan(cam.y - uCenter, length(cam.xz)));
        vec3 p = position;
        float c = cos(az), s = sin(az);
        p = vec3(c * p.x, p.y, -s * p.x);
        vUv = uv;
        vPick = vec2(fract(az / 6.2831853 + 1.0) * float(AZIMUTHS), clamp((el - ELEV0) / (ELEV1 - ELEV0), 0.0, 1.0));
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform vec3 uFaceColor;
      uniform float uGlow;
      varying vec2 vUv;
      varying vec2 vPick;
      varying vec3 vWorld;
      ${GLSL_FOG_PARS}
      vec4 view(float k, vec2 uv) {
        float col = mod(k, COLS);
        float row = floor(k / COLS);
        return texture2D(uAtlas, (vec2(col, row) + uv) / vec2(COLS, ROWS));
      }
      vec4 at(float i, float row, vec2 uv) {
        return view(mod(i, float(AZIMUTHS)) + row * float(AZIMUTHS), uv);
      }
      void main() {
        float i0 = floor(vPick.x);
        float t = vPick.x - i0;
        vec4 low = mix(at(i0, 0.0, vUv), at(i0 + 1.0, 0.0, vUv), t);
        vec4 high = mix(at(i0, 1.0, vUv), at(i0 + 1.0, 1.0, vUv), t);
        vec4 c = mix(low, high, vPick.y);
        if (c.a < 0.5) discard;
        vec3 rgb = c.rgb / max(c.a, 1e-3);
        rgb *= rgb;
        // White in the picture is light on the body: colour it with the live expression.
        float lit = smoothstep(0.55, 0.95, min(rgb.r, min(rgb.g, rgb.b)));
        rgb = mix(rgb, uFaceColor * uGlow * 2.2, lit);
        gl_FragColor = vec4(applyFog(rgb, vWorld, cameraPosition), 1.0);
      }
    `,
  }) as THREE.ShaderMaterial & { uniforms: ImpostorUniforms };
}

const cache = new WeakMap<THREE.WebGLRenderer, Map<string, Atlas>>();

/** One atlas per kind of character and renderer, made on first need. */
export function atlasFor(gl: THREE.WebGLRenderer, key: string, make: () => Atlas): Atlas {
  let map = cache.get(gl);
  if (!map) {
    map = new Map();
    cache.set(gl, map);
  }
  let atlas = map.get(key);
  if (!atlas) {
    atlas = make();
    map.set(key, atlas);
  }
  return atlas;
}
