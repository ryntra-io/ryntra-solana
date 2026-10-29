import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY, FOG_FALLOFF, GLSL_COMMON, GLSL_FOG_PARS } from '@/city/lib/city/glsl';
import { GLSL_SHARED, share } from '@/city/lib/city/shared';
import { PALETTE } from '@/city/lib/palette';
import { ARRIVALS, LOT_D, LOT_W, SLOTS, STREET_PITCH, type Bounds, type Lot } from '@/city/lib/quarter/plot';

/**
 * The quarter's ground, lit by nothing but itself like the rest of the city: it reads the shared Slot Pulse and
 * flash light, and sinks into the same violet height fog, so the terrace and its plots belong to the skyline they
 * stand beside. The buildings on it are the kit's (`city/lib/quarter/kit`).
 */

const fog = () => ({
  uFogColor: { value: new THREE.Color(FOG_COLOR) },
  uFogDensity: { value: FOG_DENSITY },
  uFogFalloff: { value: FOG_FALLOFF },
});

const f = (n: number) => n.toFixed(3);

/**
 * Arrivals: obsidian tiles like the island, its streets and the avenue down the middle drawn as rows of amber
 * lamps (the free street's dimmer), a claimed lot as a paved block with a warm kerb, a free lot as a pad barely
 * lighter than the terrace, and this visitor's lot with an amber kerb. No plot lines: the plots are drawn only while
 * a quarter is built (`createPadMaterial`). The plan is the same arithmetic as plot.ts, and which lots are claimed
 * is a texture of 24 lots by the streets shown, so any number of residents costs one material and no list.
 */
export function createTerraceMaterial(bounds: Bounds, streets: number, free: number, mine: Lot | null, claimed: THREE.Texture) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uInk: { value: new THREE.Color(PALETTE.ink) },
      uAmber: { value: new THREE.Color(PALETTE.amber) },
      uViolet: { value: new THREE.Color(PALETTE.violet) },
      uMine: { value: new THREE.Vector3(mine?.x ?? 0, mine?.z ?? 0, mine ? 1 : 0) },
      uClaim: { value: 0 },
      uStreets: { value: streets },
      uFree: { value: free },
      uClaimed: { value: claimed },
      uBounds: { value: new THREE.Vector4(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ) },
      ...fog(),
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
      uniform vec3 uInk;
      uniform vec3 uAmber;
      uniform vec3 uViolet;
      uniform vec3 uMine;
      uniform float uClaim;
      uniform float uStreets;
      uniform float uFree;
      uniform sampler2D uClaimed;
      uniform vec4 uBounds;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      ${GLSL_SHARED}
      ${GLSL_COMMON}
      ${GLSL_FOG_PARS}
      const float STREET_Z = ${f(ARRIVALS.streetZ)};
      const float PITCH = ${f(STREET_PITCH)};
      const float STREET = ${f(ARRIVALS.street)};
      const float WALK = ${f(ARRIVALS.walk)};
      const float LANE = ${f(ARRIVALS.lane)};
      const float GAP = ${f(ARRIVALS.gap)};
      const float PER_SIDE = ${f(ARRIVALS.perSide)};
      const vec2 HALF_LOT = vec2(${f(LOT_W / 2)}, ${f(LOT_D / 2)});
      const float LOTS = ${f(ARRIVALS.perSide * 4)};

      // A row of small amber lamps along a kerb: d is the distance across, along the coordinate along it, and aa
      // their pixel sizes (taken once at the top: derivatives inside branches are not to be trusted). Seen up close
      // they stay points of light; from the skyline they read as a dotted line, like the island's roads.
      vec3 lamps(float d, float along, float kerb, float aaD, float aaA) {
        float k = abs(d - kerb);
        float spacing = abs(fract(along / 2.6) - 0.5) * 2.6;
        float aa = aaD * 1.5;
        float r = length(vec2(k, spacing));
        float lamp = 1.0 - smoothstep(0.07 + max(aa, aaA), 0.15 + max(aa, aaA) * 2.2, r);
        float line = 1.0 - smoothstep(0.02 + aa, 0.07 + aa * 2.0, k);
        return lamp * uAmber * 2.6 + line * uAmber * 0.22;
      }

      // The lot under p, as its centre (xy), whether there is one (z) and its number on the street (w): the same
      // plan as plot.ts (lotOf and lotAt).
      vec4 lotUnder(vec2 p, float zc) {
        float north = step(p.y, zc);
        float lz = zc + (north * 2.0 - 1.0) * -(STREET + WALK + HALF_LOT.y);
        float ax = abs(p.x) - LANE;
        float k = floor(max(ax, 0.0) / (HALF_LOT.x * 2.0 + GAP));
        float lx = sign(p.x) * (LANE + HALF_LOT.x + k * (HALF_LOT.x * 2.0 + GAP));
        float index = 2.0 * (2.0 * k + step(0.0, p.x)) + (1.0 - north);
        return vec4(lx, lz, step(0.0, ax) * step(k, PER_SIDE - 1.0), index);
      }

      void main() {
        vec3 n = normalize(vNormalW);
        vec2 p = vWorld.xz;
        // Pixel sizes, once, before any branch.
        vec2 px = fwidth(p);
        float aaLot = max(px.x, px.y) * 1.2;
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float graze = pow(1.0 - abs(viewDir.y), 2.0);
        vec3 flash = flashLight(vWorld, n);

        if (n.y < 0.5) {
          // The terrace's edge: dark stone, a line of stored light along its lip.
          float lip = smoothstep(-0.25, 0.0, vWorld.y);
          float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
          vec3 side = uInk * 1.1 + uViolet * (0.04 + fres * 0.25) + lip * uAmber * 1.4 + flash * 0.4;
          gl_FragColor = vec4(applyFog(side, vWorld, cameraPosition), 1.0);
          return;
        }

        vec2 tile = abs(fract(p / 3.3) - 0.5);
        float seam = 1.0 - smoothstep(0.47, 0.5, max(tile.x, tile.y));
        // Violet stone a shade above the water, not an ink slab on it (the terrace read as a
        // dark step in front of the island).
        vec3 color = uInk * (1.3 + 0.3 * seam) + uViolet * (0.03 + graze * 0.08);

        if (p.y < uBounds.z + 0.01) {
          // The bridge from the island: a deck with lamps on both rails.
          float d = abs(p.x);
          color = uInk * 1.45 + vec3(0.01, 0.008, 0.016);
          color += lamps(d, p.y, LANE - 1.2, px.x, px.y);
          color += (1.0 - smoothstep(0.02 + px.x, 0.06 + px.x * 2.0, d)) * uViolet * 0.5 * step(0.5, fract(p.y / 1.6));
        } else {
          // The nearest street, and the avenue the bridge becomes, through the middle of every street.
          float s = clamp(floor((p.y - STREET_Z) / PITCH + 0.5), 0.0, uStreets - 1.0);
          float zc = STREET_Z + s * PITCH;
          float sd = abs(p.y - zc);
          float asphalt = 1.0 - smoothstep(STREET - 0.15, STREET + 0.1, sd);
          float lane = 1.0 - smoothstep(LANE - 1.0, LANE - 0.85, abs(p.x));
          color = mix(color, uInk * 1.6 + vec3(0.012, 0.01, 0.02), max(asphalt, lane));
          // The free street's lamps burn low: nobody lives there yet.
          color += lamps(sd, p.x, STREET - 0.12, px.y, px.x) * (1.0 - lane) * (s > uFree - 0.5 ? 0.35 : 1.0);
          color += lamps(abs(p.x), p.y, LANE - 1.0, px.x, px.y) * step(STREET, sd);
          color += asphalt * uAmber * 0.05;
          color += (1.0 - smoothstep(0.02 + px.y, 0.06 + px.y * 2.0, sd)) * uViolet * 0.5 * step(0.5, fract(p.x / 1.6)) * (1.0 - lane);

          vec4 lot = lotUnder(p, zc);
          if (lot.z > 0.5) {
            vec2 e = abs(p - lot.xy) - HALF_LOT;
            float d = max(e.x, e.y);
            float inside = 1.0 - smoothstep(-aaLot, aaLot, d);
            float outline = 1.0 - smoothstep(0.04 + aaLot, 0.12 + aaLot * 2.0, abs(d));
            float taken = texture2D(uClaimed, vec2((lot.w + 0.5) / LOTS, (s + 0.5) / uStreets)).r;
            bool own = uMine.z > 0.5 && distance(lot.xy, uMine.xy) < 0.1;
            if (own || taken > 0.5) {
              // A claimed lot: a paved block a shade lighter than the terrace, a warm kerb, a little light
              // from below the walls toward its middle. This visitor's: the kerb in amber, brightening as it is claimed.
              vec2 pave = abs(fract((p - lot.xy) / 1.2) - 0.5);
              float joint = 1.0 - smoothstep(0.44, 0.5, max(pave.x, pave.y));
              float rim = smoothstep(-2.2, 0.0, d);
              color = mix(color, uInk * (1.5 + 0.18 * joint) + vec3(0.014, 0.010, 0.020) + uAmber * 0.02 * rim, inside);
              color += outline * (own ? uAmber * (1.1 + 0.9 * uClaim) : uAmber * 0.2);
              if (own) color += inside * (uAmber * 0.012 + uViolet * 0.012) * (1.0 + uClaim);
            } else {
              // A free lot: barely there, so the street reads by who lives on it.
              color += outline * uViolet * 0.08;
            }
          }

          // The terrace's lip glows like the island's shore.
          float edge = min(min(p.x - uBounds.x, uBounds.y - p.x), min(p.y - uBounds.z, uBounds.w - p.y));
          color += (1.0 - smoothstep(0.0, 2.2, edge)) * uAmber * 0.14;
        }

        color += slotPulse(vWorld) * uPulseColor * 0.3;
        color += flash * 0.5;
        gl_FragColor = vec4(applyFog(color, vWorld, cameraPosition), 1.0);
      }
    `,
  });
  return share(material);
}

/**
 * My lot's plots. Not drawn in the city's view; in build mode the open, empty ones breathe in amber, the first one brighter,
 * the picked one holds still and bright, and the ones a higher level opens stay dim. `aSlot` is the only
 * per-instance attribute.
 */
export function createPadMaterial() {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uAmber: { value: new THREE.Color(PALETTE.amber) },
      uWarm: { value: new THREE.Color(PALETTE.warmWhite) },
      uViolet: { value: new THREE.Color(PALETTE.violet) },
      uBuild: { value: 0 },
      uPicked: { value: -1 },
      uFirst: { value: -1 },
      uOpen: { value: 3 },
      uTaken: { value: Array.from({ length: SLOTS }, () => 0) },
      ...fog(),
    },
    vertexShader: /* glsl */ `
      attribute float aSlot;
      varying vec3 vWorld;
      varying vec2 vLocal;
      varying float vSlot;
      void main() {
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vLocal = position.xz;
        vSlot = aSlot;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uAmber;
      uniform vec3 uWarm;
      uniform vec3 uViolet;
      uniform float uBuild;
      uniform float uPicked;
      uniform float uFirst;
      uniform float uOpen;
      uniform float uTaken[${SLOTS}];
      varying vec3 vWorld;
      varying vec2 vLocal;
      varying float vSlot;
      ${GLSL_SHARED}
      ${GLSL_FOG_PARS}
      void main() {
        int slot = int(vSlot + 0.5);
        float taken = 0.0;
        for (int i = 0; i < ${SLOTS}; i++) if (i == slot) taken = uTaken[i];
        vec2 q = abs(vLocal);
        float r = max(q.x, q.y);
        float aa = fwidth(r) * 1.5;
        float border = 1.0 - smoothstep(0.012 + aa, 0.04 + aa * 2.0, abs(r - 0.45));
        // Corner brackets carry the light; the sides between them stay faint.
        float corner = step(0.24, min(q.x, q.y));
        float open = step(vSlot + 0.5, uOpen);
        float picked = 1.0 - step(0.5, abs(vSlot - uPicked));
        float first = (1.0 - step(0.5, abs(vSlot - uFirst))) * (1.0 - picked);
        float breathe = 0.65 + 0.35 * sin(uTime * 3.1 + vSlot * 0.7);
        // In the city's view the plots are not drawn at all: a quarter reads as a block with its buildings.
        float glow = mix(0.0, 0.32 * breathe, uBuild) * (1.0 - taken * 0.7) * open;
        glow += first * uBuild * (0.75 + 0.45 * sin(uTime * 4.2));
        glow += picked * 1.5;
        // A plot a higher level opens: a still, dim violet frame.
        float closed = (1.0 - open) * (1.0 - picked) * mix(0.0, 0.22, uBuild);
        vec3 tint = mix(uAmber, uWarm, picked);
        float shape = border * (0.45 + corner * 1.6);
        vec3 color = shape * (tint * glow + uViolet * closed);
        float fill = picked * 0.12 + first * uBuild * 0.035 * breathe;
        color += mix(uAmber, uViolet, 1.0 - open) * fill;
        float alpha = clamp(shape * (glow + closed) + fill, 0.0, 1.0);
        gl_FragColor = vec4(applyFog(color, vWorld, cameraPosition), alpha);
      }
    `,
  });
  return share(material);
}

/**
 * Light pooled on the ground: under a building on the engine, under a street lamp. Additive, after everything
 * solid; `aColor` is the colour (rgb) and its strength (a), one per instance.
 */
export function createHaloMaterial() {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { ...fog() },
    vertexShader: /* glsl */ `
      attribute vec4 aColor;
      varying vec2 vLocal;
      varying vec4 vColor;
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vLocal = position.xz * 2.0;
        vColor = aColor;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vLocal;
      varying vec4 vColor;
      varying vec3 vWorld;
      ${GLSL_SHARED}
      ${GLSL_FOG_PARS}
      void main() {
        float r = length(vLocal);
        float a = pow(max(0.0, 1.0 - r), 2.0) * (0.85 + 0.15 * sin(uTime * 1.3 + vWorld.x * 0.2));
        vec3 c = vColor.rgb * vColor.a * a;
        vec3 fogged = applyFog(c, vWorld, cameraPosition) - applyFog(vec3(0.0), vWorld, cameraPosition);
        gl_FragColor = vec4(max(fogged, 0.0), 1.0);
      }
    `,
  });
  return share(material);
}

/**
 * A street lamp of the terrace: a dark post (`aLit` 0) and its warm head (`aLit` 1), bright enough to bloom, so a
 * lived-in street reads as a line of lights from the skyline.
 */
export function createLampMaterial() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uInk: { value: new THREE.Color(PALETTE.ink) },
      uLamp: { value: new THREE.Color(PALETTE.amber).lerp(new THREE.Color(PALETTE.warmWhite), 0.45) },
      ...fog(),
    },
    vertexShader: /* glsl */ `
      attribute float aLit;
      varying float vLit;
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vLit = aLit;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk;
      uniform vec3 uLamp;
      varying float vLit;
      varying vec3 vWorld;
      ${GLSL_SHARED}
      ${GLSL_FOG_PARS}
      void main() {
        vec3 post = uInk * 2.2 + uLamp * 0.12 * smoothstep(0.0, 2.0, vWorld.y);
        vec3 c = mix(post, uLamp * 2.4, step(0.5, vLit));
        gl_FragColor = vec4(applyFog(c, vWorld, cameraPosition), 1.0);
      }
    `,
  });
  return share(material);
}

/**
 * The beacon over this visitor's quarter, seen from the city's view: a soft column of amber light rising from the
 * lot and fading upward, breathing slowly. `uShow` fades it out while the quarter is built.
 */
export function createBeaconMaterial() {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uAmber: { value: new THREE.Color(PALETTE.amber) },
      uShow: { value: 1 },
      ...fog(),
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uAmber;
      uniform float uShow;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      ${GLSL_SHARED}
      ${GLSL_FOG_PARS}
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorld);
        // Brighter through its middle than at its edges, so it reads as light, not as a tube.
        float core = pow(abs(dot(normalize(vNormalW), viewDir)), 1.6);
        float rise = 0.12 + 0.88 * pow(1.0 - vUv.y, 1.6);
        float breathe = 0.8 + 0.2 * sin(uTime * 1.1);
        vec3 c = uAmber * core * rise * breathe * 0.85 * uShow;
        vec3 fogged = applyFog(c, vWorld, cameraPosition) - applyFog(vec3(0.0), vWorld, cameraPosition);
        gl_FragColor = vec4(max(fogged, 0.0), 1.0);
      }
    `,
  });
  return share(material);
}
