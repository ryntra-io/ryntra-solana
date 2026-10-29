import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY, FOG_FALLOFF, GLSL_COMMON, GLSL_FOG_PARS } from '@/city/lib/city/glsl';
import { GLSL_SHARED, share } from '@/city/lib/city/shared';
import { PALETTE } from '@/city/lib/palette';

/**
 * One material for every solid part of the kit, so a quarter costs one shader program. Each instance says what it is
 * (aLook.x: graphite, glass, ceramic, steel, a shop front, a light, a screen, water, leaves, cloth, stone, roof,
 * metal) and the fragment shader draws it in the city's AFTERGLOW: dark volumes lit by the afterglow in the north and
 * the street's amber from below, windows of stored sun, light seams on cut edges, the Slot Pulse and the city's haze.
 * Window sizes are in world units (taken from the instance scale), so a storey reads as rooms at any size.
 *
 * Per instance:
 *  aTint   surface colour (linear)
 *  aGlow   window light, or the light itself
 *  aAccent seams, kerb lines, stripes
 *  aLook   style, power (lit share or brightness), grain (window size), seed
 *  aMotion motion, speed, phase, flags (1 door, 2 kerb)
 */

const VERTEX = /* glsl */ `
  attribute vec2 aFace;
  attribute vec3 aTint;
  attribute vec3 aGlow;
  attribute vec3 aAccent;
  attribute vec4 aLook;
  attribute vec4 aMotion;
  attribute vec2 aOrigin;
  uniform float uTime;
  // Seen from afar (0 close up, 1 in the city's view): every building grows about its own place (aOrigin, the
  // building's anchor) and stands taller over its ground, so a quarter reads from the skyline. Only the drawn
  // position moves; the shading keeps the true one, so no window jumps while it eases.
  uniform float uAfar;
  uniform float uSpread;
  uniform float uLift;
  uniform float uLiftBase;

  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vNormalL;
  varying vec3 vPos;
  varying vec3 vScale;
  varying vec2 vFace;
  varying vec3 vTint;
  varying vec3 vGlow;
  varying vec3 vAccent;
  varying vec4 vLook;
  varying vec4 vMotion;

  void main() {
    vec3 p = position;
    vec3 n = normal;
    float motion = aMotion.x;
    float t = uTime * aMotion.y + aMotion.z;
    // Spin: rings turn around their own axis.
    if (abs(motion - 6.0) < 0.5) {
      float c = cos(t);
      float s = sin(t);
      p.xz = vec2(c * p.x - s * p.z, s * p.x + c * p.z);
      n.xz = vec2(c * n.x - s * n.z, s * n.x + c * n.z);
    }
    // Cloth: ripples that grow away from the edge it hangs from.
    if (abs(motion - 8.0) < 0.5) {
      float k = clamp(p.x + 0.5, 0.0, 1.0);
      p.z += sin(p.x * 6.0 - t * 2.6 + p.y * 1.5) * 0.09 * k;
    }
    vec3 scale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    mat4 m = modelMatrix * instanceMatrix;
    vec4 world = m * vec4(p, 1.0);
    // Hover: drones and the oracle's orb bob in the air.
    if (abs(motion - 7.0) < 0.5) world.y += sin(t * 1.6) * 0.16;
    vWorld = world.xyz;
    vNormalW = normalize(mat3(m) * (n / (scale * scale)));
    vNormalL = n;
    vPos = p * scale;
    vScale = scale;
    vFace = aFace;
    vTint = aTint;
    vGlow = aGlow;
    vAccent = aAccent;
    vLook = aLook;
    vMotion = aMotion;
    vec4 shown = world;
    vec2 origin = (modelMatrix * vec4(aOrigin.x, 0.0, aOrigin.y, 1.0)).xz;
    float grow = 1.0 + uSpread * uAfar;
    shown.xz = origin + (world.xz - origin) * grow;
    shown.y = uLiftBase + (world.y - uLiftBase) * grow * (1.0 + uLift * uAfar);
    gl_Position = projectionMatrix * viewMatrix * shown;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uAfar;
  uniform vec3 uAmber;
  uniform vec3 uWarm;
  uniform vec3 uViolet;
  uniform vec3 uGraphite;

  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vNormalL;
  varying vec3 vPos;
  varying vec3 vScale;
  varying vec2 vFace;
  varying vec3 vTint;
  varying vec3 vGlow;
  varying vec3 vAccent;
  varying vec4 vLook;
  varying vec4 vMotion;

  ${GLSL_SHARED}
  ${GLSL_COMMON}
  ${GLSL_FOG_PARS}

  const float PI = 3.14159265;

  bool isStyle(float s, float id) { return abs(s - id) < 0.5; }

  // How a light breathes: blink, pulse, neon flicker, light flowing along it, chasing bulbs.
  float lightMotion(float motion, float t) {
    if (isStyle(motion, 1.0)) return fract(t * 0.5) < 0.16 ? 1.0 : 0.1;
    if (isStyle(motion, 2.0)) return 0.72 + 0.28 * sin(t);
    if (isStyle(motion, 3.0)) return 1.0 - 0.55 * step(0.93, hash11(floor(uTime * 11.0 + vMotion.z * 7.0)));
    if (isStyle(motion, 4.0)) return 0.3 + 1.6 * pow(fract(vPos.x * 0.9 - t), 8.0);
    if (isStyle(motion, 5.0)) {
      float bulb = fract(vPos.x / 0.11 + vPos.z / 0.11);
      float on = step(0.5, fract(floor(vPos.x / 0.11 + vPos.z / 0.11) * 0.5 + floor(t * 3.0) * 0.5));
      return (0.35 + 0.95 * on) * (0.55 + 0.45 * smoothstep(0.5, 0.15, abs(bulb - 0.5)));
    }
    return 1.0;
  }

  // Screens: a scoreboard, a ticker, an advert, a neon blade.
  vec3 screen(float motion, float t, vec2 uv, vec2 size) {
    vec3 base = vGlow;
    vec3 col = uGraphite * 0.15;
    vec2 aa = fwidth(uv) * 1.5;
    if (isStyle(motion, 10.0)) {
      // Scoreboard: rows of results, the latest streak lit, a header bar.
      float rows = max(2.0, floor(size.y / 0.17));
      float cols = max(4.0, floor(size.x / 0.13));
      vec2 g = vec2(uv.x * cols, uv.y * rows);
      vec2 c = fract(g);
      float cell = step(0.16, c.x) * step(c.x, 0.84) * step(0.2, c.y) * step(c.y, 0.8);
      float row = floor(g.y);
      float filled = step(floor(g.x), floor(hash11(row + floor(t * 0.5) * 13.0 + vLook.w * 31.0) * cols));
      float head = step(rows - 1.0, row);
      col += cell * mix(base * (0.25 + 1.1 * filled), vAccent * 1.4, head);
      return col;
    }
    if (isStyle(motion, 9.0)) {
      // Ticker: lines of figures scrolling past.
      float rows = max(2.0, floor(size.y / 0.12));
      float row = floor(uv.y * rows);
      float x = uv.x * size.x / 0.07 + t * (2.0 + hash11(row) * 2.0) * (mod(row, 2.0) < 0.5 ? 1.0 : -1.0);
      float glyph = step(0.38, hash12(vec2(floor(x), row))) * step(0.2, fract(x)) * step(fract(uv.y * rows), 0.7) * step(0.2, fract(uv.y * rows));
      col += glyph * mix(base, vAccent, step(0.75, hash11(row + 3.0))) * 1.2;
      return col;
    }
    if (isStyle(motion, 11.0)) {
      // An advert: a slow poster that changes every few seconds, a coin and a sheen running across.
      float scene = floor(t / 6.0);
      vec3 a = mix(uAmber, uViolet, hash11(scene));
      vec3 b = mix(uWarm, uViolet * 0.6, hash11(scene + 1.0));
      float diag = uv.x * 0.7 + uv.y * 0.5;
      col = mix(a * 0.5, b * 0.6, smoothstep(0.2, 0.9, diag)) * (0.7 + 0.3 * step(0.5, fract(diag * 6.0 + hash11(scene) * 3.0)));
      vec2 p = (uv - vec2(0.72, 0.5)) * vec2(size.x / size.y, 1.0);
      float r = length(p);
      float coin = 1.0 - smoothstep(0.3 - aa.y, 0.3 + aa.y, r);
      float rim = 1.0 - smoothstep(0.02, 0.04 + aa.y, abs(r - 0.25));
      col = mix(col, uAmber * 1.1, coin * 0.9);
      col += rim * uWarm * 0.8;
      float line = step(0.18, uv.x) * step(uv.x, 0.5) * (step(abs(uv.y - 0.62), 0.05) + step(abs(uv.y - 0.42), 0.035) * 0.6);
      col = mix(col, vec3(1.2), line);
      float sheen = exp(-pow((fract(t * 0.18) * 2.4 - 0.7 - diag) / 0.06, 2.0));
      return col + sheen * 0.6;
    }
    if (isStyle(motion, 3.0)) {
      // A neon blade: stacked glyphs drawn as tubes.
      float n = max(3.0, floor(size.y / max(size.x, 0.2)));
      vec2 g = vec2(uv.x, uv.y * n);
      vec2 c = fract(g) - 0.5;
      float glyph = hash11(floor(g.y) + vLook.w * 17.0);
      float ring = abs(length(c * vec2(1.0, 1.2)) - 0.28);
      float bar = abs(c.x) * step(abs(c.y), 0.32);
      float shape = glyph > 0.5 ? ring : min(bar, abs(c.y - 0.3 * sign(glyph - 0.25)) + step(0.3, abs(c.x)));
      float tube = 1.0 - smoothstep(0.035, 0.07 + aa.x, shape);
      return col + tube * base * 1.6 + base * 0.08;
    }
    return base;
  }

  void main() {
    float style = vLook.x;
    float power = vLook.y;
    float grain = max(vLook.z, 0.1);
    float seed = vLook.w;
    float motion = vMotion.x;
    float t = uTime * vMotion.y + vMotion.z;
    float flags = vMotion.w;
    bool door = mod(flags, 2.0) > 0.5;
    bool kerb = mod(floor(flags * 0.5), 2.0) > 0.5;

    vec3 n = normalize(vNormalW);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    float pulse = slotPulse(vWorld);
    vec3 flash = flashLight(vWorld, n);

    // Lights are the light: no shading, only how they breathe.
    if (isStyle(style, 6.0)) {
      vec3 c = vGlow * power * lightMotion(motion, t);
      c += pulse * vGlow * 1.2;
      gl_FragColor = vec4(applyFog(c, vWorld, cameraPosition), 1.0);
      return;
    }
    if (isStyle(style, 7.0)) {
      vec2 uv = vec2(vPos.x / vScale.x + 0.5, vPos.y / vScale.y);
      vec3 c = screen(motion, uTime * vMotion.y + vMotion.z, uv, vScale.xy) * power;
      // A thin bezel and scanlines keep it a screen up close.
      vec2 edge = min(uv, 1.0 - uv) * vScale.xy;
      c *= smoothstep(0.0, 0.025, min(edge.x, edge.y));
      c *= 0.88 + 0.12 * step(0.5, fract(vPos.y / 0.035));
      c += pulse * vGlow * 0.6;
      gl_FragColor = vec4(applyFog(c, vWorld, cameraPosition), 1.0);
      return;
    }

    // Light on solid surfaces: the afterglow from the north, the zenith's violet from above, the street's amber
    // from below, a violet rim at grazing angles.
    vec3 keyDir = normalize(vec3(0.15, 0.5, -1.0));
    float key = max(dot(n, keyDir), 0.0);
    float sky = 0.5 + 0.5 * n.y;
    float street = (1.0 - smoothstep(0.0, 3.2, vWorld.y)) * (0.6 - 0.4 * n.y);
    vec3 lit = vec3(0.42) + mix(uViolet, uWarm, 0.35) * key * 1.25 + uViolet * 0.35 * sky + uAmber * 0.9 * street;
    vec3 surface = vTint * lit + uViolet * fres * 0.2 + flash * 0.45;

    bool cap = vFace.y > 1.5 && vFace.y < 2.5;
    bool top = cap || n.y > 0.7;
    bool bottom = n.y < -0.7;
    bool wall = !top && !bottom && vFace.y < 0.5 && vFace.x > 0.0;
    bool seamFace = vFace.y > 0.5 && vFace.y < 1.5;

    // Where on the wall: across the face (world units from its centre line) and up the part.
    vec2 tng = normalize(vec2(-vNormalL.z, vNormalL.x) + 1e-5);
    float along = dot(vPos.xz, tng);
    float halfW = vFace.x * length(tng * vScale.xz);
    float faceId = floor((atan(vNormalL.x, vNormalL.z) + PI) / (PI * 0.25) + 0.5);
    bool front = vNormalL.z > 0.8;

    vec3 color = surface;

    if (isStyle(style, 8.0)) {
      // Water: dark violet, moving glints and the lamps' long reflections.
      if (top) {
        float w = vnoise(vWorld.xz * 1.6 + vec2(uTime * 0.25, -uTime * 0.18));
        float glint = smoothstep(0.8, 0.97, vnoise(vWorld.xz * 9.0 + vec2(-uTime * 0.6, uTime * 0.4)) * (0.55 + 0.6 * w));
        color = vTint * (0.8 + 0.6 * w) + uViolet * 0.05 + glint * (vGlow * 0.35 + uViolet * 0.25) + uViolet * fres * 0.25;
      } else {
        color = vTint * lit * 0.6;
      }
    } else if (isStyle(style, 9.0)) {
      // Leaves: dark clumps, with fairy lights twinkling in them.
      float clump = 0.55 + 0.7 * vnoise(vPos.xz * 5.0 + vPos.y * 4.0 + seed * 9.0);
      color = vTint * lit * clump + uViolet * fres * 0.12;
      vec3 cell = floor(vWorld * 9.0);
      float h = hash13(cell + seed * 13.0);
      float twinkle = 0.5 + 0.5 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
      color += step(0.955, h) * twinkle * vGlow * 3.0;
    } else if (isStyle(style, 10.0)) {
      // Cloth: tinted fabric with the light coming through, stripes in the accent.
      float u = vPos.x / max(vScale.x, 0.001) + 0.5;
      float stripe = step(0.5, fract(u * 3.0)) * step(0.12, u) * step(u, 0.88);
      float band = step(abs(vPos.y / max(vScale.y, 0.001) - 0.85), 0.05);
      color = mix(vTint, vAccent * 0.55, stripe * 0.35 + band * 0.8) * (lit * 0.8 + 0.35);
      color += vTint * 0.4 * (0.5 + 0.5 * sin(vPos.x * 6.0 - uTime * 2.6));
    } else if (top) {
      // Roofs and caps: dark, a faint panel grid; stone shows its tiles.
      float tile = 1.0;
      if (isStyle(style, 11.0) || isStyle(style, 12.0)) {
        vec2 g = abs(fract(vWorld.xz / (isStyle(style, 11.0) ? 0.55 : 0.4)) - 0.5);
        tile = 0.85 + 0.25 * (1.0 - smoothstep(0.44, 0.5, max(g.x, g.y)));
      }
      color = vTint * lit * 0.62 * tile + uViolet * fres * 0.15;
    } else if (bottom) {
      color = vTint * 0.2;
    } else if (isStyle(style, 2.0) && vFace.y > 2.5) {
      // Curved glass (a dome, a control cab): dark glass with ribs of light and a warm glow inside.
      float a = atan(vPos.x, vPos.z);
      float rib = 1.0 - smoothstep(0.015, 0.05, abs(fract(a / (PI / 6.0)) - 0.5) * 0.5);
      vec3 refl = reflect(-viewDir, n);
      vec3 sky = mix(uAmber * 0.45, uViolet * 0.32, smoothstep(-0.1, 0.5, refl.y));
      color = vTint * 0.3 + sky * (0.15 + 0.5 * fres) + vGlow * 0.3 * power + rib * vGlow * 0.8;
    } else if (seamFace) {
      // A cut edge: dark metal with a line of light down its middle, brighter toward the top.
      float line = 1.0 - smoothstep(0.012, 0.03, abs(along));
      color = surface * 0.8 + line * vAccent * (0.7 + 0.9 * smoothstep(0.0, 8.0, vWorld.y));
    } else if (wall && (isStyle(style, 1.0) || isStyle(style, 2.0) || isStyle(style, 3.0) || isStyle(style, 4.0) || isStyle(style, 5.0) || isStyle(style, 11.0))) {
      bool glass = isStyle(style, 2.0);
      bool ceramic = isStyle(style, 3.0);
      bool steel = isStyle(style, 4.0);
      bool stone = isStyle(style, 11.0);
      float rowH = 0.9 * grain;
      float colW = (glass ? 0.5 : 0.74) * grain;
      float cols = max(1.0, floor(2.0 * halfW / colW));
      float span = 2.0 * halfW / cols;
      float cx = (along + halfW) / span;
      float ry = vPos.y / rowH;
      vec2 cell = vec2(fract(cx), fract(ry));
      vec2 aa = fwidth(vec2(cx, ry)) * 1.2;
      // Windows blur to their average when smaller than a pixel, as on the skyline.
      float tiny = smoothstep(0.18, 0.55, max(aa.x, aa.y));
      float ww = glass ? 0.86 : clamp((ceramic ? 0.3 : 0.38) * grain / span, 0.12, 0.7);
      float y0 = glass ? 0.1 : ceramic ? 0.26 : 0.24;
      float y1 = glass ? 0.93 : ceramic ? 0.8 : 0.76;
      if (steel) { ww = 0.82; y0 = 0.56; y1 = 0.78; }
      float wx = smoothstep(0.5 - ww * 0.5 - aa.x, 0.5 - ww * 0.5 + aa.x, cell.x) * (1.0 - smoothstep(0.5 + ww * 0.5 - aa.x, 0.5 + ww * 0.5 + aa.x, cell.x));
      float wy = smoothstep(y0 - aa.y, y0 + aa.y, cell.y) * (1.0 - smoothstep(y1 - aa.y, y1 + aa.y, cell.y));
      float mask = mix(wx * wy, ww * (y1 - y0), tiny);
      if (stone) mask = 0.0;
      // Keep whole windows off the very edge of a wall and off a storey's ledge.
      mask *= step(0.06, halfW - abs(along) + 0.06 * grain);

      float row = floor(vWorld.y / rowH + 0.02);
      float col = floor(cx);
      float id = hash13(vec3(col + faceId * 17.0, row, seed * 311.0));
      float flip = hash13(vec3(col + faceId * 3.0, row, floor(uTime * 0.05 + id * 11.0)));
      // From afar more rooms are lit and they glow warmer, so a quarter reads as lived in from the skyline.
      float share = clamp(power * (glass ? 0.8 : 1.0) * (1.0 + 0.35 * uAfar), 0.0, 1.0);
      float on = mix(step(id, share) * step(0.06, flip), share * 0.6, tiny);
      float tone = hash13(vec3(row, col, faceId + 7.0));
      vec3 light = mix(vGlow, uWarm, tone * tone * 0.45) * mix(0.9 + 1.2 * tone, 1.25, tiny);
      // A room is brighter under its ceiling.
      // Big panes and strip windows glow softer than punched windows, so a facade never turns into a white sheet.
      light *= (0.75 + 0.45 * smoothstep(y0, y1, cell.y)) * (glass ? 0.62 : steel ? 0.5 : 1.0);

      // Dark glass reflects the afterglow: warm low, violet high.
      vec3 refl = reflect(-viewDir, n);
      vec3 sky = mix(uAmber * 0.45, uViolet * 0.32, smoothstep(-0.1, 0.5, refl.y)) * (0.25 + 0.75 * fres);
      vec3 pane = uGraphite * 0.1 + sky * 0.3 + (glass ? vGlow * 0.06 : vec3(0.0));

      vec3 wallColor = surface;
      if (ceramic) {
        // Ceramic: a sill under each window and a soft shadow in its reveal.
        float sill = step(abs(cell.y - (y0 - 0.05)), 0.025) * wx;
        wallColor = surface * (1.0 + 0.25 * sill);
      } else if (steel) {
        float ribs = 0.86 + 0.14 * sin(along * 42.0);
        wallColor = surface * mix(ribs, 0.93, smoothstep(0.02, 0.06, fwidth(along * 42.0) / 6.283));
      } else if (glass) {
        wallColor = mix(surface, uGraphite * 0.15 + sky * 0.25, 0.7);
      }
      color = mix(wallColor, pane, mask);
      color += mask * on * light * (1.0 + 0.8 * uAfar);

      if (isStyle(style, 5.0) && front && vPos.y < rowH) {
        // A shop front: one wide lit display window and the door beside it.
        float lo = -halfW * 0.38;
        float hi = halfW * 0.86;
        float win = step(lo, along) * step(along, hi) * step(0.1 * rowH, vPos.y) * step(vPos.y, 0.86 * rowH);
        // Thin mullions every 0.62 units.
        float mull = 1.0 - step(0.02, abs(fract((along - lo) / 0.62 + 0.5) - 0.5) * 0.62);
        vec3 display = vGlow * (1.1 + 0.5 * smoothstep(0.1, 0.86, vPos.y / rowH));
        // Goods in the window: a few dark shapes against the light.
        float goods = step(0.55, hash11(floor(along / 0.22) + seed * 9.0)) * step(vPos.y, 0.42 * rowH);
        color = mix(color, mix(display, display * 0.25, goods), win * (1.0 - mull * 0.8));
        float doorway = step(-halfW * 0.82, along) * step(along, -halfW * 0.5) * step(vPos.y, 0.68);
        color = mix(color, vGlow * 1.25, doorway);
      }
    }

    // A lit door in the middle of the front.
    if (door && wall && front) {
      float d = step(abs(along), 0.22) * step(vPos.y, 0.64);
      float frame = step(abs(along), 0.26) * step(vPos.y, 0.68) * (1.0 - d);
      color = mix(color, uGraphite * 0.2, frame);
      color = mix(color, vGlow * (1.2 + 0.4 * vPos.y), d);
    }
    // A thin light line along the top edge.
    if (kerb && !top && !bottom) {
      float line = 1.0 - smoothstep(0.012, 0.03, vScale.y - vPos.y);
      color += line * vAccent * power * 2.2;
    }

    color += pulse * (uPulseColor * 0.05 + vGlow * 0.08);
    gl_FragColor = vec4(applyFog(color, vWorld, cameraPosition), 1.0);
  }
`;

/**
 * How the kit is seen from afar: `afar` 0 close up, 1 in the city's view; at 1 a building grows by `spread` about its
 * own place and stands `lift` taller again over the ground at `base`. One object can be shared by every instancer,
 * so a scene eases it once a frame.
 */
export type KitAfar = { afar: { value: number }; spread: { value: number }; lift: { value: number }; base: { value: number } };

export const nearKit = (): KitAfar => ({ afar: { value: 0 }, spread: { value: 0 }, lift: { value: 0 }, base: { value: 0 } });

export function createKitMaterial(afar: KitAfar = nearKit()): THREE.ShaderMaterial {
  return share(
    new THREE.ShaderMaterial({
      uniforms: {
        uAfar: afar.afar,
        uSpread: afar.spread,
        uLift: afar.lift,
        uLiftBase: afar.base,
        uAmber: { value: new THREE.Color(PALETTE.amber) },
        uWarm: { value: new THREE.Color(PALETTE.warmWhite) },
        uViolet: { value: new THREE.Color(PALETTE.violet) },
        uGraphite: { value: new THREE.Color(PALETTE.graphite) },
        uFogColor: { value: new THREE.Color(FOG_COLOR) },
        uFogDensity: { value: FOG_DENSITY },
        uFogFalloff: { value: FOG_FALLOFF },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    }),
  );
}

/** Light pooled on the ground under lamps, doors and water: additive, after everything solid. */
export function createGlowMaterial(): THREE.ShaderMaterial {
  return share(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uFogColor: { value: new THREE.Color(FOG_COLOR) },
        uFogDensity: { value: FOG_DENSITY },
        uFogFalloff: { value: FOG_FALLOFF },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aGlow;
        attribute vec4 aLook;
        attribute vec4 aMotion;
        uniform float uTime;
        varying vec2 vLocal;
        varying vec3 vColor;
        varying vec3 vWorld;
        void main() {
          vLocal = position.xz * 2.0;
          float t = uTime * aMotion.y + aMotion.z;
          float k = 1.0;
          if (abs(aMotion.x - 2.0) < 0.5) k = 0.75 + 0.25 * sin(t);
          if (abs(aMotion.x - 3.0) < 0.5) k = 0.8 + 0.2 * sin(t * 9.0) * sin(t * 4.3);
          vColor = aGlow * aLook.y * k;
          vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vLocal;
        varying vec3 vColor;
        varying vec3 vWorld;
        ${GLSL_SHARED}
        ${GLSL_FOG_PARS}
        void main() {
          float r = length(vLocal);
          float a = pow(max(0.0, 1.0 - r), 2.2);
          vec3 c = vColor * a;
          // Additive light fades into the haze instead of tinting it.
          vec3 fogged = applyFog(c, vWorld, cameraPosition) - applyFog(vec3(0.0), vWorld, cameraPosition);
          gl_FragColor = vec4(max(fogged, 0.0), 1.0);
        }
      `,
    }),
  );
}
