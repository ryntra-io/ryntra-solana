'use client';

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { playRun } from '@/city/lib/audio/engine';
import { SHARED } from '@/city/lib/city/shared';
import { useCity } from '@/city/lib/city/store';
import { PALETTE } from '@/city/lib/palette';
import { LOT, isLevel, planBuilding, renderBuilding, type Signal } from '@/city/lib/quarter/kit';
import { PLOT } from '@/city/lib/quarter/plot';
import type { BuildingKind } from '@/city/lib/quarter/types';
import { fxBurst } from '../city/Fx';
import { TERRACE_TOP } from './afar';

/** The fall, from the sky to the plot, and the settle after it, in seconds. */
export const DROP = 0.42;
const SETTLE = 0.42;
const FALL = 7;
/** The kit draws a building on a LOT × LOT lot; a plot of the quarter is PLOT wide. */
export const BUILDING_SCALE = PLOT / LOT;
const SCALE = BUILDING_SCALE;

type Props = {
  kind: BuildingKind;
  level: number;
  modules: readonly string[];
  seed: number;
  /** What the engine object behind it says: value lights it mint, danger turns it red. Null for none or unread. */
  signal: Signal;
  x: number;
  z: number;
  facing: 1 | -1;
  droppedAt: number | null;
};

/**
 * A building of the quarter's kit on its plot (`renderBuilding`, drawn through the quarter's one KitWorld). A building
 * that was just placed falls onto the plot, squashes, and on impact throws sparks, sends a pulse of light across the
 * whole city and plays its sound.
 */
export function QuarterBuilding({ kind, level, modules, seed, signal, x, z, facing, droppedAt }: Props) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  // Each landing plays its moment once, even when the building is drawn again after the world keeps it.
  const played = useRef<number | null>(null);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const age = droppedAt === null ? Infinity : (performance.now() - droppedAt) / 1000;
    if (age < DROP) {
      const t = age / DROP;
      g.position.y = TERRACE_TOP + FALL * (1 - t * t);
      g.scale.set(0.92, 1.08, 0.92);
    } else if (age < DROP + SETTLE) {
      const t = (age - DROP) / SETTLE;
      const squash = Math.sin(t * Math.PI * 2) * Math.exp(-t * 4) * 0.2;
      g.position.y = TERRACE_TOP;
      g.scale.set(1 + squash * 0.45, 1 - squash, 1 + squash * 0.45);
    } else if (g.position.y !== TERRACE_TOP || g.scale.x !== 1) {
      // Settled: left alone from here on, so the kit never rewrites a building that does not move.
      g.position.y = TERRACE_TOP;
      g.scale.set(1, 1, 1);
    }

    if (droppedAt !== null && age >= DROP && played.current !== droppedAt) {
      played.current = droppedAt;
      if (age < DROP + 1) land(x, z);
    }
    const r = ring.current;
    if (r) {
      const t = droppedAt === null ? 1 : (age - DROP) / 0.8;
      r.visible = t >= 0 && t < 1;
      if (r.visible) {
        r.scale.setScalar(1 + t * 3.2);
        r.material.opacity = (1 - t) * 0.9;
      }
    }
  });

  return (
    <group position={[x, 0, z]}>
      <group ref={group} rotation-y={facing === 1 ? 0 : Math.PI} position-y={droppedAt === null ? TERRACE_TOP : TERRACE_TOP + FALL}>
        <group scale={SCALE}>{renderBuilding(kind, isLevel(level) ? level : 1, modules, { seed, signal })}</group>
      </group>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={TERRACE_TOP + 0.08} visible={false}>
        <ringGeometry args={[1.25, 1.42, 64]} />
        <meshBasicMaterial color={RING_COLOR} transparent opacity={0} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

const RING_COLOR = new THREE.Color(PALETTE.amber).multiplyScalar(3);

/** The moment a building lands: sparks and a flash on the plot, a pulse of light across the city, a knock, a chime. */
function land(x: number, z: number) {
  fxBurst(new THREE.Vector3(x, 1.6, z), 'launch', new THREE.Color(PALETTE.amber), 3.5);
  // The flash lights the walls around the plot, gently: the camera is close, a tower's flash would blind it.
  SHARED.uFlashColor.value.set(PALETTE.amber).multiplyScalar(0.12);
  SHARED.uPulseOrigin.value.set(x, z);
  SHARED.uPulseTime.value = SHARED.uTime.value;
  SHARED.uPulseStrength.value = 0.75;
  SHARED.uPulseColor.value.set(PALETTE.amber);
  const city = useCity.getState();
  city.shake(0.16);
  if (city.sound) {
    playRun('land');
    playRun('save');
  }
}

/** A building's own number for the kit's small details: the same building looks the same on every device. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

const heights = new Map<string, number>();

/** How tall a building of the kit stands on its plot, in world units: where a sign over it goes. */
export function heightOf(kind: BuildingKind, level: number, modules: readonly string[]): number {
  const key = `${kind}|${level}|${modules.join(',')}`;
  let h = heights.get(key);
  if (h === undefined) {
    const plan = planBuilding(kind, isLevel(level) ? level : 1, [...modules]);
    h = Math.max(0, ...plan.parts.map((p) => p.at[1] + p.size[1])) * SCALE;
    heights.set(key, h);
  }
  return h;
}
