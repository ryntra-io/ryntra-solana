import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY, FOG_FALLOFF, GLSL_FOG_PARS } from '@/city/lib/city/glsl';
import { SHARED } from '@/city/lib/city/shared';

/**
 * Materials of the run, all light and no textures, so the course reads as structures of the city's own light:
 * dark glass with burning edges for walls and decks, glowing rings for boosts, gates and the finish,
 * and a bright craft or runner with a ribbon of light behind it.
 */

/** Where the player is along the course; structures light up ahead of it and fold away behind it. */
export const RUN_S = { value: 0 };

/** GLSL: the reveal. Ahead within ~110 m a piece stands at full size; it grows in from light farther out. */
const GLSL_REVEAL = /* glsl */ `
  attribute float aS;
  uniform float uS;
  float reveal() {
    float ahead = aS - uS;
    return (1.0 - smoothstep(105.0, 165.0, ahead)) * smoothstep(-34.0, -8.0, ahead);
  }
`;

/** Dark glass with glowing edges; colour and brightness per instance. */
export function createEdgeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: SHARED.uTime,
      uS: RUN_S,
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
      uFogFalloff: { value: FOG_FALLOFF },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aGlow;
      ${GLSL_REVEAL}
      varying vec3 vColor;
      varying float vGlow;
      varying vec3 vLocal;
      varying vec3 vLocalNormal;
      varying vec3 vScale;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        float vis = reveal();
        vColor = aColor;
        vGlow = aGlow * vis;
        vLocal = position;
        vLocalNormal = normal;
        vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)) * max(vis, 0.001);
        vec4 world = modelMatrix * instanceMatrix * vec4(position * max(vis, 0.001), 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vColor;
      varying float vGlow;
      varying vec3 vLocal;
      varying vec3 vLocalNormal;
      varying vec3 vScale;
      varying vec3 vWorld;
      varying vec3 vNormal;
      ${GLSL_FOG_PARS}
      void main() {
        // Distance to the nearest edge of this face, in metres.
        vec3 p = (vLocal + 0.5) * vScale;
        vec3 q = min(p, vScale - p) + abs(vLocalNormal) * 1e4;
        float d = min(q.x, min(q.y, q.z));
        float edge = 1.0 - smoothstep(0.035, 0.13, d);
        vec3 n = normalize(vNormal);
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - abs(dot(n, v)), 3.0);
        float halo = 1.0 - smoothstep(0.12, 0.6, d);
        float sheen = 0.5 + 0.5 * sin((vLocal.y + vLocal.x) * 3.0 + uTime * 1.6);
        vec3 col = vColor * (0.035 + 0.025 * sheen + edge * 2.9 + halo * 0.1 + fres * 0.32) * vGlow;
        gl_FragColor = vec4(applyFog(col, vWorld, cameraPosition), 1.0);
      }
    `,
  });
}

/** Additive rings and ribbons: colour × glow per instance, a slow breath. */
export function createGlowMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: SHARED.uTime, uS: RUN_S },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aGlow;
      ${GLSL_REVEAL}
      varying vec3 vColor;
      varying float vGlow;
      varying float vPhase;
      void main() {
        float vis = reveal();
        vColor = aColor;
        vGlow = aGlow * vis;
        vec4 world = modelMatrix * instanceMatrix * vec4(position * max(vis, 0.001), 1.0);
        vPhase = world.x * 0.13 + world.z * 0.11;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vColor;
      varying float vGlow;
      varying float vPhase;
      void main() {
        float breath = 0.82 + 0.18 * sin(uTime * 5.0 + vPhase);
        gl_FragColor = vec4(vColor * vGlow * breath, 1.0);
      }
    `,
  });
}

/** The craft and the runner: a hot core with a rim; the ghost uses the same body in violet and half light. */
export function createBodyMaterial(color: THREE.Color, rim: THREE.Color, opacity = 1) {
  return new THREE.ShaderMaterial({
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
    blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uColor: { value: color }, uRim: { value: rim }, uOpacity: { value: opacity }, uTime: SHARED.uTime },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uRim;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - abs(dot(normalize(vNormal), v)), 2.0);
        vec3 col = uColor * (0.55 + 0.45 * abs(normalize(vNormal).y)) + uRim * fres * 2.2;
        gl_FragColor = vec4(col * uOpacity, uOpacity);
      }
    `,
  });
}

/** A camera-facing ribbon that fades along its length. */
export function createRibbonMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color } },
    vertexShader: /* glsl */ `
      attribute float aAlong;
      attribute float aSide;
      varying float vAlong;
      varying float vSide;
      void main() {
        vAlong = aAlong;
        vSide = aSide;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlong;
      varying float vSide;
      void main() {
        float fade = pow(1.0 - vAlong, 1.6);
        float core = 1.0 - abs(vSide);
        gl_FragColor = vec4(uColor * fade * (0.35 + core * core * 1.4), 1.0);
      }
    `,
  });
}
