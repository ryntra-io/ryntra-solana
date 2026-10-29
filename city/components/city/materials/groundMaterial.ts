import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY, FOG_FALLOFF, GLSL_COMMON, GLSL_FOG_PARS } from '@/city/lib/city/glsl';
import { GLSL_SHARED } from '@/city/lib/city/shared';
import { PALETTE } from '@/city/lib/palette';
import { ISLAND_RADIUS, PLAZA_RADIUS, RING_ROADS, SPOKES } from '@/city/lib/city/layout';
import { GLSL_LIGHT, shareLight } from '../skyline/light';
import { QUAY_LAMPS } from '../skyline/Quay';

/**
 * The obsidian island (the water round it is `skyline/Water.tsx`). Since CITY-56 the streets are asphalt from the
 * Blender tile, with wet patches that mirror the city, pale pavements and kerbs, soft capped pools under the street
 * lights and a paved promenade along the quay. Roads follow the same plan as the layout (ring roads and
 * spokes from the plaza) and are drawn as rows of amber street lights, so from above the city reads as a
 * circuit of warm light. The plaza carries the Eclipse inlay; the shoreline glows with the city's stored light.
 */
export function createGroundMaterial() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uInk: { value: new THREE.Color(PALETTE.ink) },
      uAmber: { value: new THREE.Color(PALETTE.amber) },
      uViolet: { value: new THREE.Color(PALETTE.violet) },
      uMint: { value: new THREE.Color(PALETTE.mint) },
      uWater: { value: new THREE.Color('#0d0820') },
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
      uFogFalloff: { value: FOG_FALLOFF },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uMint;
      uniform vec3 uWater;
      varying vec3 vWorld;
      ${GLSL_SHARED}
      ${GLSL_COMMON}
      ${GLSL_FOG_PARS}
      ${GLSL_LIGHT}
      const float QUAY_R = ${QUAY_LAMPS.radius.toFixed(2)};
      const float QUAY_STEP = ${((Math.PI * 2 * QUAY_LAMPS.radius) / Math.round((Math.PI * 2 * QUAY_LAMPS.radius) / QUAY_LAMPS.step)).toFixed(4)};
      const float PI = 3.14159265;
      const float ISLAND = ${ISLAND_RADIUS.toFixed(1)};
      const float PLAZA = ${PLAZA_RADIUS.toFixed(1)};
      const float RING_A = ${RING_ROADS[0].toFixed(1)};
      const float RING_B = ${RING_ROADS[1].toFixed(1)};
      const float SPOKE_COUNT = ${SPOKES.toFixed(1)};

      // Distance to the nearest road centre line and the coordinate along it (for light spacing).
      vec2 road(vec2 p) {
        float r = length(p);
        float a = atan(p.x, -p.y);
        float step_ = 2.0 * PI / SPOKE_COUNT;
        float nearest = floor(a / step_ + 0.5) * step_;
        float spokeD = abs(sin(a - nearest) * r);
        float spokeAlong = cos(a - nearest) * r;
        if (cos(a - nearest) < 0.0) spokeD = 1e3;
        float ringA = abs(r - RING_A);
        float ringB = abs(r - RING_B);
        float d = spokeD; float along = spokeAlong;
        if (ringA < d) { d = ringA; along = a * RING_A; }
        if (ringB < d) { d = ringB; along = a * RING_B; }
        if (r < PLAZA) { d = 1e3; }
        return vec2(d, along);
      }

      void main() {
        vec2 p = vWorld.xz;
        float r = length(p);
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float graze = pow(1.0 - abs(viewDir.y), 2.0);
        vec3 color;

        if (r < ISLAND) {
          vec3 up = vec3(0.0, 1.0, 0.0);
          // Paving between the streets: obsidian slabs with seams and a little of the concrete tile.
          vec4 dc = detailAt(uConcrete, vWorld, up, 0.35);
          vec2 tile = abs(fract(p / 3.3) - 0.5);
          float seam = 1.0 - smoothstep(0.47, 0.5, max(tile.x, tile.y));
          color = uInk * (0.85 + 0.25 * seam) * (0.8 + 0.5 * (dc.r - 0.5)) + uViolet * graze * 0.05;

          vec2 rd = road(p);
          vec2 kaa = vec2(fwidth(rd.x), fwidth(rd.y / 2.6));
          float far = smoothstep(0.02, 0.09, kaa.x);
          float asphalt = 1.0 - smoothstep(1.4, 1.8, rd.x);
          // Pavements of pale slabs from the kerb out, and the kerb itself a lighter stone edge.
          float pave = smoothstep(1.62, 1.72, rd.x) * (1.0 - smoothstep(2.6, 2.75, rd.x));
          float kerbStone = smoothstep(1.55, 1.6, rd.x) * (1.0 - smoothstep(1.68, 1.73, rd.x)) * (1.0 - far);
          // Asphalt: the Blender tile's aggregate and its wet patches; the puddles mirror the lit city.
          vec4 da = detailAt(uAsphalt, vWorld, up, 0.55);
          vec3 an = detailNormal(up, da, 0.25);
          float wet = 1.0 - da.g;
          vec3 tarmac = uInk * 1.5 * (0.7 + 0.6 * (da.r - 0.5)) + vec3(0.008, 0.007, 0.012);
          vec3 wn = normalize(mix(an, up, wet * 0.8));
          float fres = 0.04 + 0.96 * pow(1.0 - max(dot(wn, viewDir), 0.0), 5.0);
          vec3 mirror = cityMirror(vWorld + vec3(0.0, 0.3, 0.0), reflect(-viewDir, wn), mix(0.5, 0.04, wet));
          tarmac += mirror * fres * mix(0.04, 0.55, wet * wet) * (1.0 - far * 0.6);
          vec3 paving = uGraphite * 1.3 * (0.8 + 0.5 * (dc.r - 0.5)) * (0.9 + 0.1 * step(0.5, fract(rd.y / 0.6)));
          color = mix(color, paving, pave);
          color = mix(color, uPearl * 0.08, kerbStone);
          color = mix(color, tarmac, asphalt);
          // Street lights along both kerbs every 2.6 units: from above a circuit of warm points; up close a soft round
          // pool with a capped brightness, so no patch of pavement is blown out.
          float kerb = abs(rd.x - 1.55);
          float spacing = fract(rd.y / 2.6);
          float lampW = 0.09 + kaa.x * 1.5;
          float lamp = (1.0 - smoothstep(lampW, lampW * 2.2, kerb)) * (1.0 - smoothstep(0.08 + kaa.y, 0.22 + kaa.y, abs(spacing - 0.5)));
          float line = 1.0 - smoothstep(0.03 + kaa.x, 0.12 + kaa.x * 2.0, kerb);
          float along = (spacing - 0.5) * 2.6;
          float pool = exp(-(kerb * kerb * 1.6 + along * along * 0.9));
          color += mix(pool * 0.14, lamp * 3.6, far) * uAmber + line * uAmber * mix(0.03, 0.55, far);
          color += asphalt * uAmber * 0.012;
          color += (1.0 - smoothstep(0.02 + kaa.x, 0.06 + kaa.x * 2.0, rd.x)) * uViolet * mix(0.3, 0.5, far) * step(0.5, fract(rd.y / 1.6));

          // Eclipse Plaza: concentric inlay rings and a violet halo around the Sol Spire.
          if (r < PLAZA + 1.5) {
            float ring1 = 1.0 - smoothstep(0.04, 0.12, abs(r - PLAZA + 0.6));
            float ring2 = 1.0 - smoothstep(0.03, 0.09, abs(r - PLAZA * 0.72));
            float rays = smoothstep(0.92, 1.0, cos(atan(p.x, p.y) * 24.0)) * smoothstep(PLAZA * 0.75, PLAZA * 0.95, r) * (1.0 - smoothstep(PLAZA - 0.5, PLAZA, r));
            color += (ring1 * 2.6 + ring2 * 1.4) * uViolet + rays * uAmber * 0.8;
          }

          // The promenade along the quay: paving, and a pool under each of its lights.
          float prom = smoothstep(ISLAND - 2.4, ISLAND - 2.1, r);
          color = mix(color, uGraphite * 1.1 * (0.8 + 0.5 * (dc.r - 0.5)), prom);
          float qa = atan(p.x, -p.y) * QUAY_R;
          float qs = (fract(qa / QUAY_STEP) - 0.5) * QUAY_STEP;
          float qd = r - QUAY_R;
          color += uAmber * 0.16 * exp(-(qs * qs * 0.45 + qd * qd * 1.4)) * prom;
        } else {
          // The water is its own surface now (skyline/Water.tsx): the island ends at the shore.
          discard;
        }

        color += slotPulse(vWorld) * uPulseColor * 0.3;
        color += flashLight(vWorld, vec3(0.0, 1.0, 0.0)) * 0.5;

        gl_FragColor = vec4(applyFog(color, vWorld, cameraPosition), 1.0);
      }
    `,
  });
  return shareLight(material);
}
