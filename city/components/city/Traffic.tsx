'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { rng, RING_ROADS, SPOKES } from '@/city/lib/city/layout';
import { SHARED } from '@/city/lib/city/shared';
import { PALETTE } from '@/city/lib/palette';
import { useSkyline } from './skyline/store';

/**
 * Life in the city, computed entirely on the GPU: drones circle the skyline on lanes at different heights,
 * and agents walk the streets as small points of light. No per-frame CPU work; one draw call each. Once the
 * skyline kit is on the screen the streets carry cars and people instead (`skyline/Street.tsx`, CITY-56).
 */
export function Traffic({ drones = 360, walkers = 900 }: { drones?: number; walkers?: number }) {
  const droneMesh = useMemo(() => createDrones(drones), [drones]);
  const walkerMesh = useMemo(() => createWalkers(walkers), [walkers]);
  const street = useSkyline((s) => s.ready);
  return (
    <>
      <instancedMesh args={[droneMesh.geometry, droneMesh.material, drones]} frustumCulled={false} />
      <instancedMesh args={[walkerMesh.geometry, walkerMesh.material, walkers]} frustumCulled={false} visible={!street} />
    </>
  );
}

function createDrones(count: number) {
  // A long thin body: from afar the head and tail lights merge into a streak of light.
  const geometry = new THREE.BoxGeometry(0.22, 0.1, 1.8);
  const random = rng(31);
  const lane = new Float32Array(count * 4); // radius, altitude, speed, phase
  for (let i = 0; i < count; i += 1) {
    const radius = 18 + random() * 70;
    lane.set([radius, 10 + random() * 34 + (radius < 40 ? 8 : 0), (6 + random() * 9) * (random() < 0.5 ? -1 : 1), random() * Math.PI * 2], i * 4);
  }
  geometry.setAttribute('aLane', new THREE.InstancedBufferAttribute(lane, 4));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: SHARED.uTime,
      uHead: { value: new THREE.Color(PALETTE.warmWhite).multiplyScalar(2.6) },
      // Tail lights in deep amber: the city's red means danger only (brandbook).
      uTail: { value: new THREE.Color(PALETTE.amber).multiplyScalar(0.9) },
      uBody: { value: new THREE.Color(PALETTE.graphite) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aLane;
      uniform float uTime;
      varying float vZ;
      void main() {
        float theta = aLane.w + uTime * aLane.z / aLane.x;
        vec3 center = vec3(sin(theta) * aLane.x, aLane.y + sin(theta * 3.0 + aLane.w) * 0.8, -cos(theta) * aLane.x);
        // Face along the lane.
        float heading = theta + (aLane.z > 0.0 ? 0.0 : 3.14159265);
        vec3 fwd = vec3(cos(heading), 0.0, sin(heading));
        vec3 right = vec3(-fwd.z, 0.0, fwd.x);
        vec3 p = right * position.x + vec3(0.0, position.y, 0.0) + fwd * position.z;
        vZ = position.z;
        gl_Position = projectionMatrix * viewMatrix * vec4(center + p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uHead;
      uniform vec3 uTail;
      uniform vec3 uBody;
      varying float vZ;
      void main() {
        // Head light fading into a red tail along the body: a light trail, not a box.
        float along = vZ / 0.9;
        vec3 col = mix(uTail * 0.55, uHead * 0.35, smoothstep(-1.0, 1.0, along));
        col = mix(col, uHead, smoothstep(0.7, 0.95, along));
        col = mix(col, uTail, smoothstep(-0.7, -0.95, along));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return { geometry, material };
}

function createWalkers(count: number) {
  const geometry = new THREE.CapsuleGeometry(0.16, 0.42, 2, 6);
  geometry.translate(0, 0.37, 0);
  const random = rng(53);
  const path = new Float32Array(count * 4); // kind (0 spoke / 1 ring), index, side, phase
  const pace = new Float32Array(count);
  const tint = new Float32Array(count * 3);
  const violet = new THREE.Color(PALETTE.violet).multiplyScalar(2.2);
  const warm = new THREE.Color(PALETTE.warmWhite).multiplyScalar(2.6);
  const mint = new THREE.Color(PALETTE.mint).multiplyScalar(3.2);
  for (let i = 0; i < count; i += 1) {
    const onRing = random() < 0.4;
    path.set([onRing ? 1 : 0, onRing ? Math.floor(random() * RING_ROADS.length) : Math.floor(random() * SPOKES), random() < 0.5 ? -1 : 1, random()], i * 4);
    pace[i] = 0.006 + random() * 0.01;
    const pick = random();
    (pick < 0.06 ? mint : pick < 0.55 ? warm : violet).toArray(tint, i * 3);
  }
  geometry.setAttribute('aPath', new THREE.InstancedBufferAttribute(path, 4));
  geometry.setAttribute('aPace', new THREE.InstancedBufferAttribute(pace, 1));
  geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: SHARED.uTime,
      uRings: { value: new THREE.Vector2(RING_ROADS[0], RING_ROADS[1]) },
      uSpokes: { value: SPOKES },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aPath;
      attribute float aPace;
      attribute vec3 aTint;
      uniform float uTime;
      uniform vec2 uRings;
      uniform float uSpokes;
      varying vec3 vTint;
      varying float vHead;
      void main() {
        float t = fract(aPath.w + uTime * aPace);
        vec3 base;
        if (aPath.x < 0.5) {
          float a = aPath.y * 6.2831853 / uSpokes;
          float r = 13.0 + 58.0 * abs(t * 2.0 - 1.0);
          vec2 dir = vec2(sin(a), -cos(a));
          vec2 side = vec2(-dir.y, dir.x) * aPath.z * 1.15;
          base = vec3(dir.x * r + side.x, 0.0, dir.y * r + side.y);
        } else {
          float R = (aPath.y < 0.5 ? uRings.x : uRings.y) + aPath.z * 1.15;
          float theta = t * 6.2831853 * (aPath.z > 0.0 ? 1.0 : -1.0);
          base = vec3(sin(theta) * R, 0.0, -cos(theta) * R);
        }
        float bob = abs(sin(uTime * 7.0 + aPath.w * 40.0)) * 0.06;
        vTint = aTint;
        vHead = smoothstep(0.55, 0.75, position.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(base + position + vec3(0.0, bob, 0.0), 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vTint;
      varying float vHead;
      void main() { gl_FragColor = vec4(mix(vTint * 0.25, vTint, vHead), 1.0); }
    `,
  });
  return { geometry, material };
}
