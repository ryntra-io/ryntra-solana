import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY, FOG_FALLOFF, GLSL_COMMON, GLSL_FOG_PARS } from '@/city/lib/city/glsl';
import { GLSL_SHARED, share } from '@/city/lib/city/shared';
import { GLSL_LENS, shareLens } from '@/city/lib/lens/uniforms';
import { GLSL_LIGHT, shareLight } from './light';
import { KIT_FLOOR } from './plan';

/** Surface ids, as the Blender kit writes them into COLOR_0.g (blender/city_kit.py, SURF). */
export const SURFACE = { frame: 0, slab: 1, glass: 2, stone: 3, accent: 4, louvre: 5, lobby: 6, lamp: 7, roof: 8, rail: 9, lattice: 10, body: 11 } as const;

/**
 * One material for every module of every tower and low-rise block (CITY-56), so the skyline is a handful of instanced
 * draws of one program. What a face is comes from the kit (aKit.g, the surface id); how it is lit, partly too (aKit.r
 * baked occlusion, aKit.b the module's own lamps, both baked in Blender). The rest is the night:
 *  · glass shows a room behind every window (interior mapping on the atlas rendered in Blender: offices, flats,
 *    kitchens, lobbies), lit or dark by the coin's activity in clusters of floors, with blinds at random heights, and
 *    reflects the city through the captured cube (`light.ts`), weighed by Fresnel;
 *  · metal fins, slabs, stone, louvres and roofs take the moon, the afterglow, the street's amber and their baked AO;
 *  · light lines and LED crowns burn in the tower's district accent; the Slot Pulse, flashes, event glow, a launch
 *    growing and a flare's burning top work as on the procedural towers before.
 * Modules without geometric fins (the far levels) draw slab edges, mullions and piers in the shader instead, on the
 * same (panel, floor) grid as the geometry, so a level change keeps every line where it was.
 *
 * Per instance: instanceMatrix; aTower (index into uTowers); aFloor (first floor, floors per uv unit, 1 when the
 * module has no geometric fins). uTowers rows per tower: 0 accent rgb + activity, 1 event glow rgb + level,
 * 2 build + height + seed + kind, 3 x + z + width + the Lens's level (CITY-86).
 * `lowrise` draws the blocks between the towers: their windows sit on a world grid like the old boxes'.
 */
export function createSkylineMaterial({ lowrise = false } = {}) {
  const material = new THREE.ShaderMaterial({
    defines: { KIT_FLOOR: KIT_FLOOR.toFixed(4), ...(lowrise ? { LOWRISE: 1 } : {}) },
    uniforms: {
      uTowers: { value: null as THREE.Texture | null },
      uRooms: { value: null as THREE.Texture | null },
      uInterior: { value: 1 },
      // Brick for the low-rise walk-ups: the quarter kit's ceramic (brandbook, floor.brick).
      uBrick: { value: new THREE.Color('#3E2420') },
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
      uFogFalloff: { value: FOG_FALLOFF },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aKit;
      attribute float aTower;
      attribute vec3 aFloor;
      uniform sampler2D uTowers;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec2 vUv;
      varying vec4 vKit;
      varying vec4 vAccent;
      varying vec4 vGlow;
      varying vec4 vInfo;
      varying vec3 vCell;
      varying float vLow;
      varying float vLens;
      ${GLSL_LENS}
      void main() {
        vLow = aFloor.x;
        vLens = 0.0;
        #ifdef LOWRISE
          vAccent = vec4(0.0, 0.0, 0.0, 0.35);
          vGlow = vec4(0.0);
          vInfo = vec4(1.0, 0.0, aTower, 4.0);
        #else
          int ti = int(aTower + 0.5);
          vAccent = texelFetch(uTowers, ivec2(ti, 0), 0);
          vGlow = texelFetch(uTowers, ivec2(ti, 1), 0);
          vInfo = texelFetch(uTowers, ivec2(ti, 2), 0);
          vLens = texelFetch(uTowers, ivec2(ti, 3), 0).w;
        #endif
        vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        world.y *= vInfo.x;
        world.y = lensY(world.y, vInfo.y, vLens);
        vWorld = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * (normal / (sc * sc)));
        vUv = vec2(uv.x, aFloor.x + uv.y * aFloor.y);
        vKit = aKit;
        // A panel is about 0.2 of the plan's radius; a floor is KIT_FLOOR of the module's height.
        vCell = vec3(0.2 * sc.x, KIT_FLOOR * sc.y * vInfo.x, aFloor.z);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uRooms;
      uniform float uInterior;
      uniform vec3 uBrick;
      varying float vLow;
      varying float vLens;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec2 vUv;
      varying vec4 vKit;
      varying vec4 vAccent;
      varying vec4 vGlow;
      varying vec4 vInfo;
      varying vec3 vCell;

      ${GLSL_SHARED}
      ${GLSL_COMMON}
      ${GLSL_FOG_PARS}
      ${GLSL_LIGHT}
      ${GLSL_LENS}

      // How much of a pixel w cells wide, centred at x, the band [0, a) of every cell covers: the pattern filtered
      // over the pixel, exact at any size. A line a few pixels apart keeps its edge, one thinner than a pixel turns
      // into its share, and in between it never beats against the pixels as the tower moves across the screen.
      float bandSum(float x, float a) { return floor(x) * a + min(fract(x), a); }
      float band(float x, float a, float w) {
        w = max(w, 1e-4);
        return (bandSum(x + 0.5 * w, a) - bandSum(x - 0.5 * w, a)) / w;
      }

      // The room behind a window: the ray from the eye enters at local (0..1 across the pane), crosses a box room
      // (1 × 1 in panes, depth in panes) and hits a wall; the atlas image was rendered from one depth in front of the
      // window, so the hit point projects into it exactly. room picks the atlas cell (4 × 2), mirror flips it.
      vec3 roomAt(vec2 local, vec3 dirT, vec2 cell, float depth, float room, float mirror, vec2 gx, vec2 gy) {
        if (mirror > 0.5) { local.x = 1.0 - local.x; dirT.x = -dirT.x; }
        vec3 d = vec3(dirT.x / cell.x, dirT.y / cell.y, max(-dirT.z, 1e-3) / depth);
        vec3 o = vec3(local, 0.0);
        float tx = d.x > 0.0 ? (1.0 - o.x) / max(d.x, 1e-4) : o.x / max(-d.x, 1e-4);
        float ty = d.y > 0.0 ? (1.0 - o.y) / max(d.y, 1e-4) : o.y / max(-d.y, 1e-4);
        float t = min(min(tx, ty), 1.0 / d.z);
        vec3 h = clamp(o + d * t, 0.0, 1.0);
        vec2 img = 0.5 + (h.xy - 0.5) / (1.0 + h.z);
        vec2 at = vec2(mod(room, 4.0), floor(room / 4.0));
        vec2 uv = vec2((at.x + clamp(img.x, 0.004, 0.996)) / 4.0, (at.y + 1.0 - clamp(img.y, 0.004, 0.996)) / 2.0);
        return textureGrad(uRooms, uv, gx, gy).rgb;
      }

      // A window at night: a quarter to a third of the panes lit, never confetti. A tenant's stack of a few floors is
      // in use or dark; along each floor of a stack in use, zones of panes are lit or not, and nearly every pane of a
      // lit zone is. Each scale has its expected share (pane, zone, stack, tower), and that share is what a pane blurs
      // into as it shrinks on the screen, so a facade never turns into single-pixel cells and never shimmers.
      // lit: the pane's share of light (0..1); far: how much the pane has blurred into its average.
      // dx, dy: uv's screen derivatives, taken in main before any branch.
      vec3 window(vec3 n, vec3 v, vec2 uv, vec3 cellW, float kind, float activity, float seed, float lobby, vec2 dx, vec2 dy, out float lit, out float far) {
        vec2 cell = floor(uv);
        vec2 local = fract(uv);
        float h1 = hash13(vec3(cell, seed));
        float h2 = hash13(vec3(cell.yx + 7.0, seed * 1.37));
        float flats = kind > 0.5 && kind < 1.5 ? 1.0 : 0.0;
        float stackP = mix(0.44, 0.64, activity);
        #ifdef LOWRISE
          // Low-rise flats are mostly dark at night; the shops on the ground floor mostly lit.
          flats = 1.0;
          stackP = kind > 3.5 ? 0.8 : 0.3;
        #endif
        // The district's accent; the low-rise blocks have none and keep to warm light.
        vec3 tint = vAccent.rgb;
        #ifdef LOWRISE
          tint = uWarm;
        #endif
        float stackH = flats > 0.5 ? 1.0 : 2.0 + floor(hash11(seed * 3.1) * 3.0);
        float stack = floor(cell.y / stackH);
        float stackOn = step(hash13(vec3(stack, seed, 31.0)), stackP);
        float zoneW = flats > 0.5 ? 2.0 : 6.0;
        vec2 zone = vec2(floor((cell.x + floor(seed * 7.0)) / zoneW), cell.y);
        float hz = hash13(vec3(zone, seed + 11.0));
        float zoneP = mix(0.06, 0.75, stackOn);
        float zoneOn = step(hz, zoneP);
        float paneP = mix(0.03, 0.88, zoneOn);
        // Late workers switch a zone off now and then.
        float awake = step(0.04, hash13(vec3(zone, floor(uTime * 0.04 + hz * 23.0))));
        float pane = step(h1, paneP) * awake;
        // The expected share at each scale, and how far this pixel has blurred into it.
        float towerExp = (stackP * 0.7 + (1.0 - stackP) * 0.05) * 0.88 + 0.03;
        float stackExp = zoneP * 0.88 + (1.0 - zoneP) * 0.03;
        vec2 fw = abs(dx) + abs(dy);
        float sPane = smoothstep(0.05, 0.22, max(fw.x, fw.y * 0.75));
        float sZone = smoothstep(0.25, 0.8, fw.x * zoneW);
        float sFloor = smoothstep(0.2, 0.6, fw.y);
        float share = mix(pane, paneP * awake, sPane);
        share = mix(share, stackExp, sZone);
        share = mix(share, towerExp, sFloor);
        lit = max(share, lobby);
        far = lobby > 0.5 ? 0.0 : sPane;
        // Which room: offices on spires and avenues, flats on the strip, building sites in the docks.
        float pick = h2;
        float room;
        if (lobby > 0.5) room = 6.0;
        else if (pane < 0.5) room = 7.0;
        else if (kind < 0.5) room = pick < 0.45 ? 0.0 : pick < 0.75 ? 1.0 : pick < 0.9 ? 5.0 : 2.0;
        else if (kind < 1.5) room = pick < 0.4 ? 2.0 : pick < 0.68 ? 3.0 : pick < 0.88 ? 4.0 : 1.0;
        else if (kind < 2.5) room = pick < 0.35 ? 0.0 : pick < 0.6 ? 5.0 : pick < 0.8 ? 2.0 : 1.0;
        else if (kind < 3.5) room = pick < 0.6 ? 1.0 : 0.0;
        else room = pick < 0.35 ? 2.0 : pick < 0.55 ? 4.0 : pick < 0.75 ? 3.0 : 1.0;
        float on = max(pane, lobby);
        float bright = lobby > 0.5 ? 1.15 : mix(0.95, 1.9, hash13(vec3(zone, seed)));
        #ifdef LOWRISE
          bright *= 0.72;
        #endif
        // The atlas is lit in neutral light; a room's lamps are the city's stored sun, warm to amber by floor.
        // Saturated, so a lit room stays gold under the tone mapping instead of washing out to cream (28.10).
        vec3 warmth = mix(vec3(1.0), mix(uWarm, uAmber, 0.45 + 0.55 * hz) * 1.2, lobby > 0.5 ? 0.6 : 0.9);
        // A few zones in the district's own light (violet on the heights, mint in the docks): the night has accents.
        warmth = mix(warmth, tint * 1.2 + 0.1, step(0.86, hash13(vec3(zone, seed + 5.0))) * (1.0 - lobby) * 0.7);
        vec3 inside = vec3(0.0);
        if (far < 0.999) {
          // The tangent frame of a vertical face: x along the panels, y up, z out of the glass.
          vec3 t = normalize(cross(vec3(0.0, 1.0, 0.0), n) + vec3(1e-4, 0.0, 0.0));
          vec3 dirT = vec3(dot(-v, t), dot(-v, vec3(0.0, 1.0, 0.0)), dot(-v, n));
          vec2 gx = dx * vec2(0.25, 0.5);
          vec2 gy = dy * vec2(0.25, 0.5);
          if (uInterior > 0.5) {
            inside = roomAt(local, dirT, cellW.xy, max(cellW.x, cellW.y) * 1.15, room, step(0.5, hash13(vec3(cell, seed + 9.0))), gx, gy);
            // A room shows its furniture only where the pane is big enough for it; smaller, the pane is its room's
            // average light (the atlas cell's last mip), so a room a few pixels wide never sparkles as its parallax
            // shifts with the camera.
            vec3 average = textureLod(uRooms, vec2((mod(room, 4.0) + 0.5) / 4.0, (floor(room / 4.0) + 0.5) / 2.0), 9.0).rgb;
            inside = mix(inside, average, smoothstep(0.06, 0.14, max(fw.x, fw.y * 0.75)));
          }
          else inside = on > 0.5 ? mix(uAmber, uWarm, h2) * 0.35 : uHaze * 0.05;
          inside *= on > 0.5 ? bright * warmth : vec3(0.5);
          // Blinds: none on most, part-way down on some, closed on a few; slats lit from the room behind.
          float b = h2 < 0.55 ? 0.0 : h2 < 0.85 ? 0.2 + 0.5 * fract(h1 * 7.3) : 1.0;
          if (lobby < 0.5 && b > 0.0 && local.y > 1.0 - b) {
            // Slats a pixel apart and finer fade into their average instead of beating against the pixels.
            float slatHz = fw.y * cellW.y * 300.0 / 6.2832;
            float slat = 0.75 + 0.25 * sin(local.y * cellW.y * 300.0) * (1.0 - smoothstep(0.2, 0.45, slatHz));
            vec3 blind = on > 0.5 ? mix(uWarm, uAmber, 0.5) * 0.42 * bright : uGraphite * 0.22;
            inside = mix(inside, blind * slat, 0.9);
          }
        }
        // Far away a pane is its share of an average lit room and an average dark one.
        // Far off a lit room is a point of light in dark glass: its share tints the facade, it does not paint it.
        // Since 28.10 brighter, and a share of the district's accent: from afar the towers read as lit, gold and violet
        // (the kit's towers were dark beside the procedural ones).
        vec3 litAvg = mix(mix(uAmber, uWarm, 0.3), tint, 0.22) * 0.5;
        #ifdef LOWRISE
          litAvg *= 0.72;
        #endif
        vec3 averaged = litAvg * share + uHaze * 0.035 * (1.0 - share);
        return mix(inside, averaged, far);
      }

      void main() {
        vec3 n = normalize(vNormalW);
        vec3 v = normalize(cameraPosition - vWorld);
        float ao = mix(0.35, 1.0, vKit.r);
        float baked = vKit.b;
        int surf = int(vKit.g * 16.0);
        vec3 accent = vAccent.rgb;
        float activity = vAccent.a;
        float seed = vInfo.z;
        float kind = vInfo.w;
        float y01 = clamp(vWorld.y / max(vInfo.y, 1.0), 0.0, 1.0);
        float pulse = slotPulse(vWorld);
        vec3 flash = flashLight(vWorld, n);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 r = reflect(-v, n);
        gMirrorSpread = max(length(dFdx(r)), length(dFdy(r)));
        gWorldDx = dFdx(vWorld);
        gWorldDy = dFdy(vWorld);
        vec3 color;
        float lit = 0.0;
        float seam = 0.0;

        vec2 uv = vUv;
        #ifdef LOWRISE
          // Low-rise walls: windows on a world grid, a shop front on the ground floor.
          float along = abs(n.x) > 0.5 ? vWorld.z * sign(n.x) : -vWorld.x * sign(n.z);
          uv = vec2(along / 0.36, vWorld.y / 0.46);
          vec3 cellW = vec3(0.36, 0.46, 1.0);
          float kindL = vWorld.y < 0.46 ? 4.0 : kind;
        #else
          vec3 cellW = vCell;
          float kindL = kind;
        #endif
        // Every derivative the surfaces need, taken here in uniform control flow: inside a branch on the surface, a
        // 2 × 2 pixel quad that straddles two surfaces (the tiers of a crown a few pixels tall) has no defined
        // neighbours, the filters below would read garbage and a tier of panes would turn to confetti in motion.
        vec2 uvDx = dFdx(uv);
        vec2 uvDy = dFdy(uv);
        vec2 uvFw = abs(uvDx) + abs(uvDy);
        vec2 vUvFw = fwidth(vUv);

        if (surf == ${SURFACE.glass} || surf == ${SURFACE.lobby} || surf == ${SURFACE.body}) {
          float lobby = surf == ${SURFACE.lobby} ? 1.0 : 0.0;
          vec2 wuv = lobby > 0.5 ? vec2(uv.x, fract(vUv.y)) : uv;
          vec3 wcell = lobby > 0.5 ? vec3(cellW.x, cellW.y * 2.0, cellW.z) : cellW;
          float far;
          vec3 inside = window(n, v, wuv, wcell, kindL, activity, seed, lobby, uvDx, uvDy, lit, far);
          // Dark glass mirrors more than lit glass: a room's light drowns the reflection at the pane. Far away the
          // reflection and the slab lines carry the facade, the rooms only tint it.
          float f = mix(mix(0.14, 0.05, lit), 1.0, fres);
          inside *= mix(1.0, 0.92, far);
          // A touch of blur: the cube is coarse next to a big flat pane, and real glass is never a perfect mirror; the
          // Blender smudge tile (rain streaks, dried spots) blurs and dims it where the glass is dirty.
          float smudge = detailAt(uSmudge, vWorld, n, 0.22).g;
          vec3 refl = cityMirror(vWorld, r, 0.12 + smudge * 0.45);
          // Night glass mirrors a dark sky: the reflection is held down, more so far away, where the rooms' light bands
          // must read against black glass rather than against the blurred mirror of a lit city.
          color = inside * (1.0 - f) + refl * f * mix(0.95, 0.6, far) * (1.0 - smudge * 0.3) + uHaze * smudge * 0.03;
          #ifdef LOWRISE
            // Low-rise walls: a glass office (0), a brick walk-up with punched windows (1), a concrete block with
            // strip windows (2). The wall shows where the window does not.
            if (surf == ${SURFACE.body} && vLow > 0.5) {
              vec2 lc = fract(uv);
              vec2 aa = uvFw * 1.3;
              float shop = step(vWorld.y, 0.46);
              vec2 lo = vLow < 1.5 ? (shop > 0.5 ? vec2(0.06, 0.1) : vec2(0.25, 0.24)) : vec2(0.03, 0.34);
              vec2 hi = vLow < 1.5 ? (shop > 0.5 ? vec2(0.94, 0.9) : vec2(0.75, 0.82)) : vec2(0.97, 0.84);
              // The opening, filtered over the pixel like the towers' lines: its share of the wall far away.
              float win = band(uv.x - lo.x, hi.x - lo.x, aa.x) * band(uv.y - lo.y, hi.y - lo.y, aa.y);
              vec4 dc = detailAt(uConcrete, vWorld, n, 0.9);
              vec3 wn = detailNormal(n, dc, 0.3);
              vec3 wallBase = vLow < 1.5 ? uBrick * (0.75 + 0.7 * (dc.r - 0.5)) : uGraphite * 1.7 * (0.8 + 0.5 * (dc.r - 0.5));
              vec3 wall = wallBase * nightLight(wn, vWorld, ao, baked) * 2.3;
              // The reveal: a dark edge where the wall turns into the opening.
              float reveal = smoothstep(0.0, 0.06, min(min(lc.x - lo.x, hi.x - lc.x), min(lc.y - lo.y, hi.y - lc.y)));
              color = mix(wall, color * mix(0.55, 1.0, reveal), win);
            }
          #endif
          // No fins in this module: slab edges, mullions and (on stone towers) piers on the same grid.
          // (Brick and concrete low-rise walls draw their own openings above.)
          if ((vCell.z > 0.5 || surf == ${SURFACE.body}) && !(surf == ${SURFACE.body} && vLow > 0.5)) {
            vec2 aa = uvFw * 1.2;
            float slabH = kind > 1.5 && kind < 2.5 ? 0.3 : kind > 0.5 && kind < 1.5 ? 0.16 : 0.14;
            float pierW = kind > 1.5 && kind < 2.5 ? 0.11 : 0.025;
            // Slab edges at the foot of each floor, mullions on each panel edge, both filtered over the pixel: lines
            // thinner than a pixel become their share of the facade instead of vanishing or aliasing.
            float slab = band(uv.y, slabH, aa.y * 1.1);
            float mull = band(uv.x + pierW, 2.0 * pierW, aa.x * 1.1);
            float frame = slab + mull - slab * mull;
            // Mullions and slab edges are dark metal against the rooms, pale only on the stone towers.
            vec3 frameCol = (kind > 1.5 && kind < 2.5 ? uPearl * 0.16 : uGraphite * 0.6) * nightLight(n, vWorld, ao, baked) * 1.6;
            frameCol += cityMirror(vWorld, r, 0.5) * fres * 0.14;
            float farLines = smoothstep(0.35, 0.8, max(aa.x, aa.y));
            color = mix(color, frameCol * mix(1.0, 0.6, farLines), frame * 0.92);
          }
        } else if (surf == ${SURFACE.frame} || surf == ${SURFACE.rail}) {
          float rail = surf == ${SURFACE.rail} ? 1.0 : 0.0;
          vec4 dm = detailAt(uMetal, vWorld, n, 1.4);
          vec3 base = uGraphite * (rail > 0.5 ? 0.4 : 0.6) * (0.8 + 0.6 * (dm.r - 0.5));
          color = base * nightLight(n, vWorld, ao, baked) * 2.2;
          color += cityMirror(vWorld, r, rail > 0.5 ? 0.05 : mix(0.25, 0.6, dm.g)) * mix(0.05, 0.55, fres) * (rail > 0.5 ? 0.9 : 0.4);
          if (rail > 0.5) color += uWarm * 0.08 * (1.0 - smoothstep(0.86, 0.9, fract(vUv.y))) * smoothstep(0.84, 0.9, fract(vUv.y));
        } else if (surf == ${SURFACE.slab} || surf == ${SURFACE.roof}) {
          vec4 dc = detailAt(uConcrete, vWorld, n, 0.6);
          vec3 cn = detailNormal(n, dc, 0.35);
          vec3 base = (surf == ${SURFACE.roof} ? uGraphite * 0.55 : uGraphite * 1.1) * (0.75 + 0.7 * (dc.r - 0.5));
          color = base * nightLight(cn, vWorld, ao, baked) * 2.0;
          color += cityMirror(vWorld, reflect(-v, cn), mix(0.6, 0.95, dc.g)) * fres * 0.15;
        } else if (surf == ${SURFACE.stone}) {
          // Pale stone, washed by floodlights from the street and the setbacks.
          float flood = 0.16 * exp(-y01 * 3.0) + 0.05 + 0.07 * smoothstep(0.55, 1.0, y01);
          vec4 dc = detailAt(uConcrete, vWorld, n, 0.8);
          vec3 sn = detailNormal(n, dc, 0.3);
          color = uPearl * 0.34 * (0.8 + 0.5 * (dc.r - 0.5)) * (nightLight(sn, vWorld, ao, baked) * 2.6 + uWarm * flood * ao);
        } else if (surf == ${SURFACE.louvre}) {
          // Nine blades a floor, the lit half of each filtered over the pixel: far off a louvre is its average grey.
          float blades = vUv.y * 9.0;
          float slat = 0.55 + 0.45 * band(blades + 0.25, 0.5, vUvFw.y * 9.0 * 1.2);
          color = uGraphite * 0.8 * slat * nightLight(n, vWorld, ao, baked) * 2.0;
          color += cityMirror(vWorld, r, 0.45) * fres * 0.3 * slat;
          color += accent * 0.05 * (1.0 - slat);
        } else if (surf == ${SURFACE.lattice}) {
          // A screen of light: a grid of accent lines on dark glass, breathing slowly.
          // Lines on the cell edges, filtered over the pixel like the facade's.
          vec2 aa = vUvFw * 1.2;
          float lx = band(vUv.x + 0.055, 0.11, aa.x);
          float ly = band(vUv.y + 0.055, 0.11, aa.y);
          float line = lx + ly - lx * ly;
          float breathe = 0.75 + 0.25 * sin(uTime * 0.6 + vUv.y * 0.8 + seed);
          color = uInk * 0.4 + cityMirror(vWorld, r, 0.1) * mix(0.05, 0.8, fres) + accent * line * 1.3 * breathe;
          seam = line;
        } else if (surf == ${SURFACE.accent}) {
          // Light lines: a thin, quiet edge that brightens toward the crown, not a neon tube.
          color = accent * (0.3 + 1.5 * pow(y01, 2.2)) + uGraphite * nightLight(n, vWorld, ao, 0.0) * 1.5;
          seam = 0.6;
        } else {
          // Lamps: the warm hearts of beacons, bollards and downlights.
          color = uWarm * 3.2;
          lit = 1.0;
        }

        color += flash * (surf == ${SURFACE.glass} ? 0.25 : 0.6);
        // Slot Pulse: the wave of light sweeping out on the beat lights the rooms and the light lines.
        color += pulse * (lit * uAmber * 0.9 + seam * uPulseColor * 2.0 + uPulseColor * 0.06);
        // Event glow: a wave climbing the tower in the event colour.
        float climb = fract(uTime * 0.55 + seed * 0.0001);
        float wave = exp(-pow((y01 - climb) / 0.09, 2.0));
        color += vGlow.rgb * vGlow.a * (0.2 + seam * 2.2 + lit * 1.2 * wave + wave * 0.45);
        // Collapse: the broken top burns.
        if (vInfo.x < 0.999 && kind < 2.5) {
          float burn = smoothstep(0.86, 1.0, y01);
          color += burn * vec3(1.6, 0.55, 0.18) * (0.6 + 0.4 * sin(uTime * 13.0 + vWorld.x));
        }
        // The Lens: violet rim light on a tower looked at, the ink haze on one sunk.
        color = lensColor(color, n, v, y01, vLens);
        gl_FragColor = vec4(applyFog(color, vWorld, cameraPosition), 1.0);
      }
    `,
  });
  return shareLens(shareLight(share(material)));
}
