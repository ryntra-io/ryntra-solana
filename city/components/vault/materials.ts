import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY, FOG_FALLOFF, GLSL_FOG_PARS } from '@/city/lib/city/glsl';
import { GLSL_SHARED, share } from '@/city/lib/city/shared';
import { PALETTE } from '@/city/lib/palette';

/**
 * The Vault's two materials, in the city's AFTERGLOW like the quarter's kit (`kitMaterial.ts`), without its per-instance
 * attributes: armour — dark plates lit by the afterglow in the north and the street's amber from below, with seams
 * between the plates, a violet rim and the city's pulse and haze — and the core — stored sun rising inside the glass,
 * brighter for a moment when someone tries the door.
 */

const lin = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);

export function createArmourMaterial(tint: string, seams = 1): THREE.ShaderMaterial {
  return share(
    new THREE.ShaderMaterial({
      uniforms: {
        uTint: { value: lin(tint) },
        uSeams: { value: seams },
        uAmber: { value: lin(PALETTE.amber) },
        uWarm: { value: lin(PALETTE.warmWhite) },
        uViolet: { value: lin(PALETTE.violet) },
        uFogColor: { value: new THREE.Color(FOG_COLOR) },
        uFogDensity: { value: FOG_DENSITY },
        uFogFalloff: { value: FOG_FALLOFF },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vNormalW;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTint;
        uniform float uSeams;
        uniform vec3 uAmber;
        uniform vec3 uWarm;
        uniform vec3 uViolet;
        varying vec3 vWorld;
        varying vec3 vNormalW;
        ${GLSL_SHARED}
        ${GLSL_FOG_PARS}
        void main() {
          vec3 n = normalize(vNormalW);
          vec3 view = normalize(cameraPosition - vWorld);
          vec3 sky = normalize(vec3(0.15, 0.5, -1.0));
          float key = max(dot(n, sky), 0.0);
          vec3 afterglow = mix(uViolet, uWarm, 0.35);
          vec3 color = uTint * (0.42 + 0.8 * key) + afterglow * key * 0.06;
          // The street's amber from below, fading by the third storey.
          color += uAmber * 0.16 * exp(-max(vWorld.y, 0.0) / 3.2) * (0.6 + 0.4 * max(-n.y, 0.0) + 0.4 * (1.0 - abs(n.y)));
          // Seams between the plates: thin violet lines every storey and a little light in them.
          float band = abs(fract(vWorld.y / 1.6) - 0.5);
          float seam = smoothstep(0.47, 0.5, band) * (1.0 - abs(n.y));
          color += uViolet * seam * 0.35 * uSeams;
          // The rim: the afterglow catching the plates' edges.
          float rim = pow(1.0 - max(dot(n, view), 0.0), 3.0);
          color += uViolet * rim * 0.22;
          color += uPulseColor * slotPulse(vWorld) * 0.5 + flashLight(vWorld, n) * 0.4;
          gl_FragColor = vec4(applyFog(color, vWorld, cameraPosition), 1.0);
        }
      `,
    }),
  );
}

/** The core: light rising in bands inside the glass; `uHeat` brightens it for a moment after an attempt. */
export function createCoreMaterial(): THREE.ShaderMaterial {
  return share(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uHeat: { value: 0 },
        uFill: { value: 0.62 },
        uAmber: { value: lin(PALETTE.amber, 2.2) },
        uWarm: { value: lin(PALETTE.warmWhite, 2.6) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying float vY;
        void main() {
          vY = uv.y;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uHeat;
        uniform float uFill;
        uniform vec3 uAmber;
        uniform vec3 uWarm;
        varying vec3 vWorld;
        varying float vY;
        ${GLSL_SHARED}
        void main() {
          float below = smoothstep(uFill + 0.02, uFill - 0.04, vY);
          float bands = 0.65 + 0.35 * sin((vY * 26.0 - uTime * 1.6) * 3.14159);
          float top = smoothstep(uFill - 0.12, uFill, vY) * below;
          vec3 color = mix(uAmber, uWarm, top + uHeat * 0.5) * (below * bands * (0.55 + uHeat) + top * 0.8);
          float alpha = clamp(below * (0.5 + 0.5 * uHeat), 0.0, 1.0);
          // Additive light gathers no haze: it fades with distance instead, as the city's other lights do.
          float fade = exp(-length(vWorld - cameraPosition) * 0.004);
          gl_FragColor = vec4(color * alpha * fade, alpha);
        }
      `,
    }),
  );
}

/** A light: plain colour above 1, so it blooms. */
export const glow = (hex: string, k: number, extra: THREE.MeshBasicMaterialParameters = {}) =>
  new THREE.MeshBasicMaterial({ color: lin(hex, k), toneMapped: false, fog: false, ...extra });
