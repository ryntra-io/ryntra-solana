import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY, FOG_FALLOFF, GLSL_COMMON, GLSL_FOG_PARS } from '@/city/lib/city/glsl';
import { GLSL_SHARED } from '@/city/lib/city/shared';
import { PALETTE } from '@/city/lib/palette';

/**
 * The thousand low-rise blocks between the towers: axis-aligned boxes whose windows are laid out in world
 * space, dimmer than the hero towers, with a few rooftop beacons. They carry the Slot Pulse and the flash light
 * too, so the whole city breathes on the beat. aSeed is the only per-instance attribute; size and place live in
 * instanceMatrix. Pass through share().
 */
export function createFillerMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAmber: { value: new THREE.Color(PALETTE.amber) },
      uWarm: { value: new THREE.Color(PALETTE.warmWhite) },
      uViolet: { value: new THREE.Color(PALETTE.violet) },
      uGraphite: { value: new THREE.Color(PALETTE.graphite) },
      uFlare: { value: new THREE.Color(PALETTE.flare) },
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
      uFogFalloff: { value: FOG_FALLOFF },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying float vSeed;
      varying float vTop;
      varying vec3 vCenter;
      void main() {
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vSeed = aSeed;
        vec4 top = modelMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0);
        vTop = top.y;
        vCenter = top.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uAmber;
      uniform vec3 uWarm;
      uniform vec3 uViolet;
      uniform vec3 uGraphite;
      uniform vec3 uFlare;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying float vSeed;
      varying float vTop;
      varying vec3 vCenter;
      ${GLSL_SHARED}
      ${GLSL_COMMON}
      ${GLSL_FOG_PARS}
      void main() {
        vec3 n = normalize(vNormalW);
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
        float y01 = clamp(vWorld.y / max(vTop, 0.001), 0.0, 1.0);
        vec3 flash = flashLight(vWorld, n);

        if (n.y > 0.6) {
          vec3 roof = uGraphite * 0.22 + flash * 0.4;
          // A red aviation beacon on the taller blocks.
          float tall = step(9.0, vTop);
          float d = length(vWorld.xz - vCenter.xz);
          float blink = step(0.55, fract(uTime * 0.5 + vSeed * 0.0007));
          roof += tall * blink * uFlare * 6.0 * (1.0 - smoothstep(0.0, 0.22, d));
          gl_FragColor = vec4(applyFog(roof, vWorld, cameraPosition), 1.0);
          return;
        }

        float along = abs(n.x) > 0.5 ? vWorld.z : vWorld.x;
        float face = abs(n.x) > 0.5 ? sign(n.x) * 2.0 : sign(n.z) * 3.0;
        vec2 grid = vec2(along / 0.36, vWorld.y / 0.46);
        vec2 cell = fract(grid);
        vec2 aa = fwidth(grid) * 1.2;
        float wx = smoothstep(0.18 - aa.x, 0.18 + aa.x, cell.x) * (1.0 - smoothstep(0.82 - aa.x, 0.82 + aa.x, cell.x));
        float wy = smoothstep(0.24 - aa.y, 0.24 + aa.y, cell.y) * (1.0 - smoothstep(0.76 - aa.y, 0.76 + aa.y, cell.y));
        float tiny = smoothstep(0.18, 0.55, max(aa.x, aa.y));
        float windowMask = mix(wx * wy, 0.36, tiny) * step(0.5, vWorld.y);

        float cluster = vnoise(floor(grid) * vec2(0.21, 0.17) + vSeed * 0.017 + face);
        float chance = 0.08 + 0.22 * cluster;
        float id = hash13(vec3(floor(grid), vSeed * 0.0003 + face));
        float lit = mix(step(id, chance), chance, tiny);
        float tone = hash13(vec3(floor(grid).yx, face + 1.0));
        vec3 lightColor = mix(uAmber, uWarm, tone) * mix(0.55 + 1.1 * tone, 1.1, tiny);

        vec3 base = uGraphite * (0.32 + 0.4 * y01) + uViolet * fres * 0.35 + flash * 0.5;
        vec3 color = mix(base, uGraphite * 0.12, windowMask);
        color += windowMask * lit * lightColor;

        float pulse = slotPulse(vWorld);
        color += pulse * (windowMask * lightColor * 1.2 + uPulseColor * 0.05);

        gl_FragColor = vec4(applyFog(color, vWorld, cameraPosition), 1.0);
      }
    `,
  });
}
