import * as THREE from 'three';
import { GLSL_COMMON } from '@/city/lib/city/glsl';
import { PALETTE } from '@/city/lib/palette';
import { LIGHT } from '../skyline/light';

/**
 * Night sky on a sphere that follows the camera: violet gradient, a thin amber horizon, stars, the moon and a layer
 * of clouds (CITY-56) whose bellies the city lights amber and whose edges the moon silvers. The moon's direction is
 * the skyline's moonlight (`skyline/light.ts`).
 */
export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uZenith: { value: new THREE.Color(PALETTE.zenith) },
      uHorizon: { value: new THREE.Color(PALETTE.violetHaze) },
      uAmber: { value: new THREE.Color(PALETTE.amber) },
      uViolet: { value: new THREE.Color(PALETTE.violet) },
      uMood: { value: 0 }, // -1 bearish (the horizon reddens) … +1 bullish (warmer, mint wisps)
      uMint: { value: new THREE.Color(PALETTE.mint) },
      uFlare: { value: new THREE.Color(PALETTE.flare) },
      uPearl: { value: new THREE.Color(PALETTE.pearl) },
      uIce: { value: new THREE.Color(PALETTE.ice) },
      uMoonDir: LIGHT.uMoonDir,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vDir = normalize(world.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * world;
        gl_Position.z = gl_Position.w; // always at the far plane
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uAmber;
      uniform vec3 uViolet;
      uniform float uMood;
      uniform vec3 uMint;
      uniform vec3 uFlare;
      uniform vec3 uPearl;
      uniform vec3 uIce;
      uniform vec3 uMoonDir;
      varying vec3 vDir;
      ${GLSL_COMMON}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, h));
        col = mix(col, uZenith * 0.5, smoothstep(0.55, 1.0, h));
        // Below the horizon the sky is the water's haze.
        col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.2, h));
        // Afterglow: the sun has just set behind the north horizon. A warm band, brightest under the Eclipse,
        // that turns red when the market bleeds.
        vec3 band = mix(uAmber, uFlare, clamp(-uMood, 0.0, 1.0));
        float north = 0.55 + 0.45 * max(0.0, -d.z);
        col += band * exp(-abs(h) * 20.0) * 0.55 * north;
        col += mix(uViolet, band, 0.35) * exp(-abs(h - 0.05) * 7.0) * 0.16 * north;

        // The moon behind everything but the clouds: a waxing gibbous disc of pearl with faint maria, and its halo.
        float md = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
        const float MOON_R = 0.019;
        vec3 mRight = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
        vec3 mUp = cross(mRight, uMoonDir);
        vec2 mq = vec2(dot(d, mRight), dot(d, mUp)) / MOON_R;
        float mr = length(mq);
        float disc = (1.0 - smoothstep(0.96, 1.0, mr)) * step(0.0, dot(d, uMoonDir));
        vec3 mn = vec3(mq, sqrt(max(0.0, 1.0 - mr * mr)));
        float phase = smoothstep(-0.12, 0.3, dot(mn, normalize(vec3(-0.55, 0.2, 0.8))));
        float maria = fbm(mq * 2.2 + 4.0);
        vec3 moon = uPearl * (0.8 + 0.34 * (maria - 0.5)) * 1.15 * phase + uHorizon * 0.5 * (1.0 - phase);
        col = mix(col, moon, disc);
        col += uIce * (exp(-md * 32.0) * 0.06 + exp(-md * 7.0) * 0.022) * step(0.0, dot(d, uMoonDir));

        // Clouds: a slow layer of stratocumulus over the city. Their bellies glow with the streets' amber near the
        // horizon, their tops take the haze, the edges toward the moon catch its light; they pass in front of it.
        if (h > 0.0) {
          vec2 cp = d.xz / (h + 0.08) * 0.75 + vec2(uTime * 0.007, uTime * 0.0024);
          float c = fbm(cp * 0.5) * 0.62 + fbm(cp * 1.7 + 3.1) * 0.38;
          float cover = smoothstep(0.5, 0.74, c);
          float dens = cover * smoothstep(0.015, 0.09, h) * (1.0 - smoothstep(0.42, 0.85, h));
          float toMoon = max(dot(d, uMoonDir), 0.0);
          vec3 cloud = uHorizon * 0.75 + uAmber * 0.16 * exp(-h * 7.0) * north + uViolet * 0.04;
          float rim = smoothstep(0.5, 0.58, c) * (1.0 - smoothstep(0.58, 0.7, c));
          cloud += uIce * (rim * 0.5 + 0.12) * pow(toMoon, 18.0) + uPearl * 0.03 * pow(toMoon, 4.0);
          cloud = mix(cloud, cloud + uMint * 0.03, clamp(uMood, 0.0, 1.0));
          col = mix(col, cloud, dens * 0.8);
        }

        // Stars on a spherical grid, fading into the horizon haze.
        vec2 grid = vec2(atan(d.x, d.z) * 90.0, asin(clamp(h, -1.0, 1.0)) * 90.0);
        vec2 cell = floor(grid);
        float star = hash12(cell);
        vec2 off = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5;
        float dist = length(fract(grid) - 0.5 - off * 0.6);
        float tw = 0.6 + 0.4 * sin(uTime * (1.0 + star * 3.0) + star * 40.0);
        float s = step(0.986, star) * (1.0 - smoothstep(0.0, 0.08, dist)) * tw * smoothstep(0.04, 0.3, h) * (1.0 - disc);
        col += s * mix(vec3(1.0), uAmber, hash12(cell + 1.3)) * 2.4;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/**
 * The Eclipse: the city's landmark and logo in the sky. A black disc with a violet-white corona and the
 * "diamond ring" — one blazing point on the rim that flares on big moments (uDiamond 0–1).
 */
export function createEclipseMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uViolet: { value: new THREE.Color(PALETTE.violet) },
      uWarm: { value: new THREE.Color(PALETTE.warmWhite) },
      uAmber: { value: new THREE.Color(PALETTE.amber) },
      uBeat: { value: 0 },
      uDiamond: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vDir;
      void main() {
        vUv = uv * 2.0 - 1.0;
        vDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uViolet;
      uniform vec3 uWarm;
      uniform vec3 uAmber;
      uniform float uBeat;
      uniform float uDiamond;
      varying vec2 vUv;
      varying vec3 vDir;
      ${GLSL_COMMON}
      const float DISC = 0.34;
      void main() {
        float r = length(vUv);
        float a = atan(vUv.y, vUv.x);
        // Corona: soft falloff, slow streamers, a bright inner rim.
        float rays = 0.65 + 0.35 * fbm(vec2(a * 3.0 + uTime * 0.03, r * 3.0 - uTime * 0.05));
        float streamers = pow(max(0.0, sin(a * 7.0 + fbm(vec2(a * 2.0, uTime * 0.02)) * 4.0)), 6.0) * 0.6;
        float outside = step(DISC, r);
        float falloff = exp(-(r - DISC) * (7.0 - streamers * 3.0)) * outside;
        float rim = exp(-abs(r - DISC) * 60.0);
        vec3 col = uViolet * falloff * rays * (1.6 + uBeat * 0.6);
        col += mix(uWarm, uViolet, 0.35) * rim * (2.2 + uBeat * 1.2);
        // The diamond ring: a point on the rim at the upper right.
        vec2 dp = vUv - vec2(cos(0.78), sin(0.78)) * DISC;
        float diamond = exp(-length(dp) * 26.0) * (0.5 + 2.5 * uDiamond);
        float spikes = exp(-abs(dp.y) * 220.0) * exp(-abs(dp.x) * 5.0) + exp(-abs(dp.x) * 220.0) * exp(-abs(dp.y) * 5.0);
        col += (uWarm * diamond * 3.0 + uWarm * spikes * uDiamond * 2.0);
        // Inside the disc nothing is added: the black disc mesh behind this one shows through.
        col *= smoothstep(1.0, 0.7, r);
        // The glow is sky: it ends at the horizon, so the water's far edge never cuts it into a step (28.10).
        col *= smoothstep(0.0, 0.06, normalize(vDir).y);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
