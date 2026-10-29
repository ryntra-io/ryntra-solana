'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY, FOG_FALLOFF, GLSL_COMMON, GLSL_FOG_PARS } from '@/city/lib/city/glsl';
import { ISLAND_RADIUS } from '@/city/lib/city/layout';
import { GLSL_SHARED, share } from '@/city/lib/city/shared';
import { GLSL_LIGHT, shareLight } from './light';

/**
 * The water round the island (CITY-56): a ring from the shore to the haze. Ripples in three wave trains and a fine
 * chop bend the normal; the surface mirrors the city through the captured cube (the skyline's lit windows, the moon,
 * the clouds), Fresnel decides how much, the moon lays a path of glints, and the shore glows with the city's light.
 * Ripples fade with distance so far water never shimmers. The island's own ground stops at the shore.
 */
export function Water() {
  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.RingGeometry(ISLAND_RADIUS, 1500, 192, 12);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      uniforms: {
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
        varying vec3 vWorld;
        ${GLSL_SHARED}
        ${GLSL_COMMON}
        ${GLSL_FOG_PARS}
        ${GLSL_LIGHT}
        const float ISLAND = ${ISLAND_RADIUS.toFixed(1)};

        // How much of a wave of k radians a unit survives on a pixel fp units across: a ripple shorter than a few
        // pixels fades into the water's roughness (the blur of its mirror) instead of sparkling as the camera moves.
        float keep(float k, float fp) { return 1.0 - smoothstep(0.12, 0.35, k * fp / 6.2832); }

        // The slope of the water at p: three wave trains and a fine chop, damped by distance and by the pixel.
        vec2 slope(vec2 p, float damp, float fp) {
          vec2 g = vec2(0.0);
          vec2 d1 = normalize(vec2(0.8, 0.6)); vec2 d2 = normalize(vec2(-0.5, 0.86)); vec2 d3 = normalize(vec2(0.2, -1.0));
          g += d1 * 0.9 * 0.05 * cos(dot(d1, p) * 0.9 + uTime * 0.9) * keep(0.9, fp);
          g += d2 * 1.7 * 0.03 * cos(dot(d2, p) * 1.7 + uTime * 1.3) * keep(1.7, fp);
          g += d3 * 3.1 * 0.016 * cos(dot(d3, p) * 3.1 + uTime * 1.9) * keep(3.1, fp);
          float e = 0.35;
          vec2 q = p * 1.3 + vec2(uTime * 0.25, -uTime * 0.18);
          float h0 = vnoise(q), hx = vnoise(q + vec2(e, 0.0)), hz = vnoise(q + vec2(0.0, e));
          g += vec2(hx - h0, hz - h0) / e * 0.06 * keep(8.2, fp);
          return g * damp;
        }

        void main() {
          vec2 p = vWorld.xz;
          float r = length(p);
          vec3 v = normalize(cameraPosition - vWorld);
          float dist = length(cameraPosition - vWorld);
          float damp = 1.0 / (1.0 + dist * 0.012);
          // World units across a pixel, the long way (the water is seen at a grazing angle).
          float fp = max(length(dFdx(p)), length(dFdy(p)));
          vec2 g = slope(p, damp, fp);
          // Ripples finer than the pixel are roughness: they blur the mirror and dim the moon's glints.
          float rough = 1.0 - keep(3.1, fp);
          vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 rr = reflect(-v, n);
          rr.y = abs(rr.y) + 0.002;
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
          vec3 mirror = cityMirror(vec3(vWorld.x, 0.5, vWorld.z), rr, 0.03 + (1.0 - damp) * 0.2 + rough * 0.25);
          // Deep water is violet ink lit by the city's haze, never a dead black.
          vec3 deep = uInk * 0.45 + uHaze * 0.3;
          vec3 color = mix(deep, mirror, clamp(fres * 1.15 + 0.08, 0.0, 1.0));
          // The moon's path: glints where the ripples tilt toward it.
          float glint = pow(max(dot(rr, uMoonDir), 0.0), 420.0);
          color += uIce * glint * 3.0 * damp * keep(8.2, fp);
          // The skyline's light on the water near the shore: long warm streaks toward the eye, and the shore's glow.
          float near = exp(-(r - ISLAND) * 0.05);
          float streak = smoothstep(0.62, 1.0, vnoise(vec2(atan(p.x, -p.y) * 46.0, r * 0.05 - uTime * 0.04)));
          color += streak * uAmber * near * 0.22 * pow(1.0 - abs(v.y), 2.0);
          color += uAmber * near * near * 0.07 + uViolet * near * 0.025;
          // The city's glow on the water, wide and soft: the island sits in a pool of its own light.
          float glow = exp(-(r - ISLAND) * 0.009);
          color += (uAmber * 0.065 + uViolet * 0.045) * glow;
          color += slotPulse(vWorld) * uPulseColor * 0.2;
          color += flashLight(vWorld, vec3(0.0, 1.0, 0.0)) * 0.4;
          color = applyFog(color, vWorld, cameraPosition);
          // Far off the water turns into the sky just above it, so its edge melts into the horizon instead of a
          // dark band under a bright one.
          color = mix(color, skyDome(-v), smoothstep(380.0, 1450.0, r));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    return { geometry, material: shareLight(share(material)) };
  }, []);
  return <mesh geometry={geometry} material={material} />;
}
