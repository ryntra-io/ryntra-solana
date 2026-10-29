'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { rng } from '@/city/lib/city/layout';
import { SHARED } from '@/city/lib/city/shared';
import { PALETTE } from '@/city/lib/palette';

/** Stored-sun embers drifting up through the haze: the air of the city. GPU-animated, one draw call. */
export function Embers({ count = 1400 }: { count?: number }) {
  const { geometry, material } = useMemo(() => {
    const random = rng(71);
    const geometry = new THREE.BufferGeometry();
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      const r = Math.sqrt(random()) * 95;
      const a = random() * Math.PI * 2;
      seed.set([Math.sin(a) * r, random() * 70, -Math.cos(a) * r, random()], i * 4);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: SHARED.uTime,
        // Faint sparks of stored sun (CITY-56: quieter, so the night reads as a city, not a particle field).
        uAmber: { value: new THREE.Color(PALETTE.amber).multiplyScalar(1.1) },
        uViolet: { value: new THREE.Color(PALETTE.violet).multiplyScalar(1) },
        uPixel: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform float uPixel;
        varying vec3 vColor;
        varying float vAlpha;
        uniform vec3 uAmber;
        uniform vec3 uViolet;
        void main() {
          float rise = mod(aSeed.y + uTime * (0.6 + aSeed.w * 1.4), 70.0);
          vec3 pos = vec3(aSeed.x + sin(uTime * 0.25 + aSeed.w * 30.0) * 2.0, rise, aSeed.z + cos(uTime * 0.21 + aSeed.w * 20.0) * 2.0);
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.5 + aSeed.w) * uPixel * (120.0 / -mv.z);
          vColor = mix(uAmber, uViolet, step(0.7, aSeed.w));
          vAlpha = smoothstep(0.0, 6.0, rise) * (1.0 - smoothstep(50.0, 70.0, rise)) * (0.5 + 0.5 * sin(uTime * 2.0 + aSeed.w * 60.0));
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          gl_FragColor = vec4(vColor * pow(1.0 - d, 2.0) * vAlpha, 1.0);
        }
      `,
    });
    return { geometry, material };
  }, [count]);
  useFrame(({ viewport }) => {
    material.uniforms.uPixel!.value = viewport.dpr;
  });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
