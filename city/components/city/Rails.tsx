'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rail } from '@/city/lib/city/layout';
import { SHARED } from '@/city/lib/city/shared';
import { PALETTE } from '@/city/lib/palette';

/**
 * Light rails between towers: thin arched tubes merged into one mesh. Pulses of light run along them —
 * the money and data moving through the city. Additive, so they glow without hiding what is behind.
 */
/** Rails that step aside (a run's corridor crosses them): hidden in the shader, so the mesh is never rebuilt. */
const MAX_RAILS = 256;

export function Rails({ rails, hidden }: { rails: Rail[]; hidden?: readonly number[] }) {
  const mesh = useMemo(() => {
    if (!rails.length) return null;
    const parts: THREE.BufferGeometry[] = [];
    rails.forEach((rail, index) => {
      const a = new THREE.Vector3(...rail.a);
      const b = new THREE.Vector3(...rail.b);
      const mid = a.clone().lerp(b, 0.5);
      mid.y += rail.arch + a.distanceTo(b) * 0.06;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const tube = new THREE.TubeGeometry(curve, 28, 0.13, 4, false);
      const count = tube.getAttribute('position').count;
      const along = new Float32Array(count);
      const id = new Float32Array(count).fill(index);
      const uv = tube.getAttribute('uv');
      for (let i = 0; i < count; i += 1) along[i] = uv.getX(i);
      tube.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
      tube.setAttribute('aRail', new THREE.BufferAttribute(id, 1));
      tube.deleteAttribute('normal');
      parts.push(tube);
    });
    const geometry = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: SHARED.uTime,
        uViolet: { value: new THREE.Color(PALETTE.violet) },
        uAmber: { value: new THREE.Color(PALETTE.amber) },
        uMint: { value: new THREE.Color(PALETTE.mint) },
        uHidden: { value: new Float32Array(MAX_RAILS) },
      },
      vertexShader: /* glsl */ `
        attribute float aAlong;
        attribute float aRail;
        uniform float uHidden[${MAX_RAILS}];
        varying float vAlong;
        varying float vRail;
        varying float vDepth;
        void main() {
          vAlong = aAlong;
          vRail = aRail;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
          if (uHidden[int(aRail)] > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uViolet;
        uniform vec3 uAmber;
        uniform vec3 uMint;
        varying float vAlong;
        varying float vRail;
        varying float vDepth;
        float h(float n) { return fract(sin(n * 91.345) * 43758.5453); }
        void main() {
          float speed = 0.18 + 0.25 * h(vRail);
          float dir = h(vRail + 4.0) > 0.5 ? 1.0 : -1.0;
          float t = fract(vAlong * 1.5 - uTime * speed * dir + h(vRail + 9.0));
          float pulse = smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.04, 0.16, t));
          vec3 pulseColor = h(vRail + 2.0) > 0.82 ? uMint : uAmber;
          vec3 col = uViolet * 0.32 + pulseColor * pulse * 4.0;
          float fade = smoothstep(420.0, 120.0, vDepth);
          gl_FragColor = vec4(col * fade, 1.0);
        }
      `,
    });
    return { geometry, material };
  }, [rails]);

  useEffect(() => {
    if (!mesh) return;
    const flags = mesh.material.uniforms.uHidden!.value as Float32Array;
    flags.fill(0);
    for (const i of hidden ?? []) if (i < MAX_RAILS) flags[i] = 1;
  }, [mesh, hidden]);

  if (!mesh) return null;
  return <mesh geometry={mesh.geometry} material={mesh.material} frustumCulled={false} renderOrder={2} />;
}
