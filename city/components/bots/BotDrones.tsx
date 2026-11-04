'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useBotsWindow } from '@/city/lib/bots/open';
import { PALETTE } from '@/city/lib/palette';
import { lotOf } from '@/city/lib/quarter/plot';
import { useQuarter } from '@/city/lib/quarter/store';
import { useRun } from '@/city/lib/run/store';

/** At most this many drones over a quarter, however many bots run. */
export const MAX_DRONES = 4;
/** How high over the lot they hang, and how wide they circle, city units. */
const HOVER = 9;
const ORBIT = 3.4;

/**
 * The person's running bots in the city (B4): small garage drones hanging over their own quarter, one for each running
 * paper bot, up to four. Light — a few meshes each, no shadows, no new textures but one shared glow. With «reduce
 * motion» they hang still. Nothing shows without a quarter of the person's own.
 */
export function BotDrones() {
  const me = useQuarter((s) => s.me);
  const running = useRun((s) => s.phase !== 'off');
  const count = useBotsWindow((s) => s.running);
  // The kept hangar is counted once, so the drones fly before the window is ever opened (its code stays unloaded).
  useEffect(() => useBotsWindow.getState().count(), []);
  const x = me?.quarter.cell.x;
  const z = me?.quarter.cell.z;
  const lot = useMemo(() => (x === undefined || z === undefined ? null : lotOf({ x, z })), [x, z]);
  if (!lot || running || count === 0) return null;
  return <Drones x={lot.x} z={lot.z} count={Math.min(MAX_DRONES, count)} />;
}

function Drones({ x, z, count }: Readonly<{ x: number; z: number; count: number }>) {
  const group = useRef<THREE.Group>(null);
  const still = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  const glow = useMemo(haloTexture, []);
  useEffect(() => () => glow.dispose(), [glow]);
  const colors = useMemo(
    () => ({
      body: new THREE.Color(PALETTE.violet).multiplyScalar(1.6),
      eye: new THREE.Color(PALETTE.amber).multiplyScalar(3),
      rotor: new THREE.Color(PALETTE.warmWhite).multiplyScalar(1.8),
      halo: new THREE.Color(PALETTE.amber).multiplyScalar(0.5),
    }),
    [],
  );

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = still ? 0 : clock.elapsedTime;
    g.children.forEach((drone, i) => {
      const phase = (i / count) * Math.PI * 2;
      const a = phase + t * 0.35;
      drone.position.set(Math.cos(a) * ORBIT, HOVER + i * 0.6 + Math.sin(t * 1.3 + phase) * 0.35, Math.sin(a) * ORBIT);
      drone.rotation.y = -a;
      const rotors = drone.children[1];
      if (rotors) rotors.rotation.y = t * 9;
    });
  });

  return (
    <group ref={group} position={[x, 0, z]}>
      {Array.from({ length: count }, (_, i) => (
        <group key={i} scale={0.55}>
          <group>
            <mesh>
              <boxGeometry args={[1.4, 0.42, 1]} />
              <meshBasicMaterial color={colors.body} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0, 0.52]}>
              <boxGeometry args={[0.5, 0.16, 0.06]} />
              <meshBasicMaterial color={colors.eye} toneMapped={false} />
            </mesh>
          </group>
          <group position-y={0.3}>
            {[
              [0.9, 0.7],
              [-0.9, 0.7],
              [0.9, -0.7],
              [-0.9, -0.7],
            ].map(([rx, rz]) => (
              <mesh key={`${rx}:${rz}`} position={[rx, 0, rz]} rotation-x={-Math.PI / 2}>
                <torusGeometry args={[0.42, 0.05, 4, 20]} />
                <meshBasicMaterial color={colors.rotor} transparent opacity={0.7} toneMapped={false} depthWrite={false} />
              </mesh>
            ))}
          </group>
          <sprite scale={4.2}>
            <spriteMaterial map={glow} color={colors.halo} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </sprite>
        </group>
      ))}
    </group>
  );
}

function haloTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.3)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
