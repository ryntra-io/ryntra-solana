import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY, FOG_FALLOFF, GLSL_COMMON, GLSL_FOG_PARS } from '@/city/lib/city/glsl';
import { GLSL_SHARED } from '@/city/lib/city/shared';
import { PALETTE } from '@/city/lib/palette';

/**
 * The hero towers, one draw call for the whole skyline. The geometry is a unit octagonal prism (base at y=0);
 * the vertex shader shapes it per instance (spire taper, stock setbacks) and the fragment shader draws the
 * facade: amber "stored sun" windows, light seams on the edges, the Slot Pulse wave, explosion light and event glow.
 * Pass the material through share() so the shared time, pulse and flash uniforms are attached.
 *
 * Per-instance attributes:
 *  aSize     (width, height)
 *  aSeed     random per tower
 *  aKind     0 prism spire · 1 meme tower · 2 stepped stock tower · 3 launch scaffold
 *  aAccent   district accent colour (linear rgb)
 *  aGlow     event glow (linear rgb, intensity in w)
 *  aActivity 0–1, how many windows are lit
 *  aBuild    0–1, how much of the tower stands (launches grow, flares knock the top off)
 */
export function createTowerMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAmber: { value: new THREE.Color(PALETTE.amber) },
      uWarm: { value: new THREE.Color(PALETTE.warmWhite) },
      uViolet: { value: new THREE.Color(PALETTE.violet) },
      uGraphite: { value: new THREE.Color(PALETTE.graphite) },
      uPearl: { value: new THREE.Color(PALETTE.pearl) },
      uMint: { value: new THREE.Color(PALETTE.mint) },
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
      uFogFalloff: { value: FOG_FALLOFF },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aSize;
      attribute float aSeed;
      attribute float aKind;
      attribute vec3 aAccent;
      attribute vec4 aGlow;
      attribute float aActivity;
      attribute float aBuild;

      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec3 vLocal;
      varying float vHeightU;
      varying float vSeed;
      varying float vKind;
      varying vec3 vAccent;
      varying vec4 vGlow;
      varying float vActivity;
      varying float vWidth;
      varying float vTotalH;
      varying float vBuild;

      float shapeScale(float kind, float y) {
        if (kind < 0.5) return 1.0 - 0.34 * smoothstep(0.72, 1.0, y);                    // spire: tapers into the crown
        if (kind < 1.5) return 1.0 + 0.07 * sin(y * 9.0 + aSeed * 6.0) * step(0.12, y);  // meme: playful bulges
        if (kind < 2.5) return 1.0 - 0.16 * step(0.58, y) - 0.14 * step(0.8, y) - 0.12 * step(0.93, y); // stock: setbacks
        return 1.0;                                                                         // scaffold
      }

      void main() {
        vec3 p = position;
        float s = shapeScale(aKind, p.y);
        p.xz *= s;
        vLocal = p;
        float h = aSize.y * aBuild;
        vec3 scaled = vec3(p.x * aSize.x, p.y * h, p.z * aSize.x);
        vec4 world = modelMatrix * instanceMatrix * vec4(scaled, 1.0);
        vWorld = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vHeightU = scaled.y;
        vSeed = aSeed;
        vKind = aKind;
        vAccent = aAccent;
        vGlow = aGlow;
        vActivity = aActivity;
        vWidth = aSize.x * s;
        vTotalH = h;
        vBuild = aBuild;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uAmber;
      uniform vec3 uWarm;
      uniform vec3 uViolet;
      uniform vec3 uGraphite;
      uniform vec3 uPearl;
      uniform vec3 uMint;

      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec3 vLocal;
      varying float vHeightU;
      varying float vSeed;
      varying float vKind;
      varying vec3 vAccent;
      varying vec4 vGlow;
      varying float vActivity;
      varying float vWidth;
      varying float vTotalH;
      varying float vBuild;

      ${GLSL_SHARED}
      ${GLSL_COMMON}
      ${GLSL_FOG_PARS}

      const float PI = 3.14159265;
      const float FACES = 8.0;

      void main() {
        vec3 n = normalize(vNormalW);
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
        float y01 = vTotalH > 0.0 ? vHeightU / vTotalH : 0.0;
        float pulse = slotPulse(vWorld);
        vec3 flash = flashLight(vWorld, n);

        // Roof: dark with a thin accent ring at the edge.
        if (n.y > 0.6) {
          float edge = smoothstep(0.78, 0.98, length(vLocal.xz));
          vec3 roof = uGraphite * 0.35 + vAccent * edge * 2.2 + flash * 0.5;
          gl_FragColor = vec4(applyFog(roof, vWorld, cameraPosition), 1.0);
          return;
        }

        // Which face of the octagon, and where across it (0..1).
        float ang = atan(vLocal.x, vLocal.z) + PI;
        float faceF = ang / (2.0 * PI) * FACES;
        float face = floor(faceF);
        float u = fract(faceF);
        float faceWidth = 2.0 * vWidth * sin(PI / FACES);

        // Facade base: graphite for spires and memes, warm pearl ceramic for stock towers.
        float stock = step(1.5, vKind) * step(vKind, 2.5);
        vec3 base = mix(uGraphite, uPearl * 0.3, stock);
        base *= 0.45 + 0.55 * y01;
        base += uViolet * fres * 0.16;
        base += flash * (0.45 + 0.4 * stock);

        // Window grid: small windows, so from afar a facade reads as a glowing texture, up close as rooms.
        float floorH = 0.44;
        float cols = max(2.0, floor(faceWidth / 0.34));
        float col = floor(u * cols);
        float row = floor(vHeightU / floorH);
        vec2 cell = vec2(fract(u * cols), fract(vHeightU / floorH));
        vec2 aa = fwidth(vec2(u * cols, vHeightU / floorH)) * 1.2;
        float wx = smoothstep(0.16 - aa.x, 0.16 + aa.x, cell.x) * (1.0 - smoothstep(0.84 - aa.x, 0.84 + aa.x, cell.x));
        float wy = smoothstep(0.22 - aa.y, 0.22 + aa.y, cell.y) * (1.0 - smoothstep(0.78 - aa.y, 0.78 + aa.y, cell.y));
        // Windows blur into their average when they are smaller than a pixel, instead of shimmering.
        float tiny = smoothstep(0.18, 0.55, max(aa.x, aa.y));
        float windowMask = mix(wx * wy, 0.38, tiny);

        // Offices light up in clusters of floors, not as random confetti.
        float cluster = vnoise(vec2(face * 3.1 + col * 0.31, row * 0.13) + vSeed * 0.013);
        float litChance = (0.06 + 0.3 * vActivity) * (0.3 + 1.25 * cluster);
        float id = hash13(vec3(face * 17.0 + col, row, vSeed * 0.001));
        float slowFlip = hash13(vec3(face + col * 3.0, row, floor(uTime * 0.07 + id * 13.0)));
        float lit = mix(step(id, litChance) * step(0.05, slowFlip), litChance * 0.5, tiny);
        float tone = hash13(vec3(row, col, face + 7.0));
        vec3 lightColor = mix(uAmber, uWarm, tone * tone * 0.6);
        lightColor = mix(lightColor, uViolet * 1.4 + 0.12, step(0.97, tone) * (1.0 - tiny));
        float intensity = mix(0.8 + 1.5 * hash13(vec3(col, face, row + 3.0)), 1.3, tiny);

        // Launch scaffold: the top 40% is open steel.
        if (vKind > 2.5) {
          float open = step(0.6, y01);
          float beams = max(1.0 - smoothstep(0.04, 0.09, min(u, 1.0 - u)), 1.0 - smoothstep(0.05, 0.11, fract(vHeightU / 1.15)));
          if (open > 0.5 && beams < 0.5) discard;
          lightColor = mix(lightColor, uMint, 0.35);
        }

        // Dark glass that reflects the afterglow: warm low on the facade, violet toward the zenith.
        vec3 refl = reflect(-viewDir, n);
        vec3 skyRefl = mix(uAmber * 0.5, uViolet * 0.3, smoothstep(-0.05, 0.45, refl.y)) * (0.2 + 0.8 * fres);
        vec3 glass = uGraphite * 0.08 + skyRefl * 0.16;
        vec3 color = mix(base * 0.62, glass, mix(0.55, 1.0, windowMask));
        // A few windows blaze, most glow softly: the brightness spread is what makes a facade read as rooms.
        float blaze = pow(hash13(vec3(col, face, row + 3.0)), 3.0);
        color += windowMask * lit * lightColor * mix(intensity, 0.35 + 2.4 * blaze, 1.0 - tiny) * (0.5 + 0.5 * smoothstep(0.0, 0.25, y01));

        // Light seams on the octagon's vertical edges, brighter toward the crown.
        // Every other edge carries a full seam; the rest a faint one, so towers read as faceted, not striped.
        float edgeDist = min(u, 1.0 - u) * faceWidth;
        float edgeId = u < 0.5 ? face : mod(face + 1.0, FACES);
        float strong = step(0.5, mod(edgeId + floor(vSeed * 0.01), 2.0));
        float seam = (1.0 - smoothstep(0.015, 0.065, edgeDist)) * mix(0.22, 1.0, strong);
        float seamGlow = 0.25 + 1.6 * pow(y01, 2.2);
        color += seam * vAccent * seamGlow;

        // Light veins: thin bands every few floors on spires.
        if (vKind < 0.5) {
          float vein = 1.0 - smoothstep(0.0, 0.06, abs(fract(vHeightU / 7.8) - 0.5) - 0.44);
          color += vein * vAccent * 0.28;
        }

        // Slot Pulse: the wave of light sweeping out on the beat.
        color += pulse * (windowMask * lightColor * 1.4 + seam * uPulseColor * 2.0 + uPulseColor * 0.08);

        // Event glow: a wave climbing the tower in the event colour.
        float climb = fract(uTime * 0.55 + vSeed * 0.0001);
        float wave = exp(-pow((y01 - climb) / 0.09, 2.0));
        color += vGlow.rgb * vGlow.a * (0.25 + seam * 2.2 + windowMask * 1.4 * wave + wave * 0.5);

        // Collapse: the broken top burns.
        if (vBuild < 0.999 && vKind < 2.5) {
          float burn = smoothstep(0.86, 1.0, y01);
          color += burn * vec3(1.6, 0.55, 0.18) * (0.6 + 0.4 * sin(uTime * 13.0 + vWorld.x));
        }

        color = applyFog(color, vWorld, cameraPosition);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}
