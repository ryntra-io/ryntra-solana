'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { ISLAND_RADIUS, SPOKES } from '@/city/lib/city/layout';
import { moduleGeometry, releaseModule, restoreModule, type Kit } from './kit';
import { createSkylineMaterial, SURFACE } from './skylineMaterial';

/** The quay's top above the water, its railing's ring, the promenade lights' ring and their spacing. */
const TOP = 0.18;
const RAIL_R = ISLAND_RADIUS - 0.12;
const LAMP_R = ISLAND_RADIUS - 0.6;
const LAMP_STEP = 6;
/** No railing where a spoke road meets the shore. */
const ROAD_GAP = 2.4;

/**
 * The island's embankment (CITY-56): a stone quay wall rising from the water to a coping, a railing along its edge
 * and lights along the promenade — instead of the blocks simply ending above the water. The wall and coping are
 * drawn as one-instance meshes so the skyline's material (instanced) shades them as stone; the railing and the
 * lights are the kit's `quay.rail` and `prop.lamp`.
 */
export function Quay({ kit }: { kit: Kit }) {
  const built = useMemo(() => buildQuay(kit), [kit]);
  useEffect(() => {
    built.restore();
    return () => built.dispose();
  }, [built]);
  return <primitive object={built.group} />;
}

const onRoad = (theta: number, r: number) => {
  const step = (Math.PI * 2) / SPOKES;
  const off = Math.abs(((theta % step) + step) % step);
  return Math.min(off, step - off) * r < ROAD_GAP;
};

/** Per-vertex kit attribute for runtime geometry: no occlusion baked, the given surface, no lamps. */
function kitAttribute(count: number, surface: number) {
  const a = new Uint8Array(count * 4);
  for (let i = 0; i < count; i += 1) a.set([255, Math.round(((surface + 0.5) / 16) * 255), 0, 255], i * 4);
  return new THREE.BufferAttribute(a, 4, true);
}

function one(geometry: THREE.BufferGeometry, material: THREE.Material) {
  geometry.setAttribute('aKit', kitAttribute(geometry.getAttribute('position').count, SURFACE.stone));
  geometry.setAttribute('aTower', new THREE.InstancedBufferAttribute(new Float32Array([0.3]), 1));
  geometry.setAttribute('aFloor', new THREE.InstancedBufferAttribute(new Float32Array([0, 1, 1]), 3));
  const mesh = new THREE.InstancedMesh(geometry, material, 1);
  mesh.setMatrixAt(0, new THREE.Matrix4());
  mesh.frustumCulled = false;
  return mesh;
}

function buildQuay(kit: Kit) {
  const material = createSkylineMaterial({ lowrise: true });
  const group = new THREE.Group();
  group.name = 'quay';
  const wallGeometry = new THREE.CylinderGeometry(ISLAND_RADIUS + 0.06, ISLAND_RADIUS + 0.06, TOP + 1.2, 256, 1, true);
  wallGeometry.translate(0, (TOP - 1.2) / 2, 0);
  const copingGeometry = new THREE.RingGeometry(ISLAND_RADIUS - 0.45, ISLAND_RADIUS + 0.06, 256, 1);
  copingGeometry.rotateX(-Math.PI / 2);
  copingGeometry.translate(0, TOP, 0);
  const wall = one(wallGeometry, material);
  const coping = one(copingGeometry, material);
  group.add(wall, coping);

  const pieces: { mesh: THREE.InstancedMesh; geometry: THREE.BufferGeometry }[] = [];
  const place = (name: string, spots: { x: number; z: number; angle: number; y: number }[]) => {
    const source = kit.geometries.get(name);
    if (!source || !spots.length) return;
    const geometry = moduleGeometry(source);
    geometry.setAttribute('aTower', new THREE.InstancedBufferAttribute(new Float32Array(spots.length).fill(0.7), 1));
    geometry.setAttribute('aFloor', new THREE.InstancedBufferAttribute(new Float32Array(spots.length * 3), 3));
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    spots.forEach((s, i) => {
      q.setFromAxisAngle(up, s.angle);
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    pieces.push({ mesh, geometry });
  };
  // The railing: one metre per piece, its +X along the shore; the lights' arms reach in over the promenade.
  const rails: { x: number; z: number; angle: number; y: number }[] = [];
  const n = Math.round((Math.PI * 2 * RAIL_R) / 1);
  for (let i = 0; i < n; i += 1) {
    const th = ((i + 0.5) / n) * Math.PI * 2;
    if (onRoad(th, RAIL_R)) continue;
    rails.push({ x: Math.sin(th) * RAIL_R, z: -Math.cos(th) * RAIL_R, angle: -th, y: TOP });
  }
  const lamps: { x: number; z: number; angle: number; y: number }[] = [];
  const nl = Math.round((Math.PI * 2 * LAMP_R) / LAMP_STEP);
  for (let i = 0; i < nl; i += 1) {
    const th = ((i + 0.5) / nl) * Math.PI * 2;
    if (onRoad(th, LAMP_R)) continue;
    lamps.push({ x: Math.sin(th) * LAMP_R, z: -Math.cos(th) * LAMP_R, angle: Math.atan2(-Math.cos(th), -Math.sin(th)), y: TOP });
  }
  place('quay.rail', rails);
  place('prop.lamp', lamps);

  return {
    group,
    restore: () => {
      for (const p of pieces) restoreModule(p.geometry);
    },
    dispose: () => {
      for (const mesh of [wall, coping]) {
        mesh.dispose();
        mesh.geometry.dispose();
      }
      for (const p of pieces) {
        p.mesh.dispose();
        releaseModule(p.geometry);
      }
      material.dispose();
    },
  };
}

/** The promenade lights' ring and spacing, for the ground shader's pools of light under them. */
export const QUAY_LAMPS = { radius: LAMP_R, step: LAMP_STEP } as const;
