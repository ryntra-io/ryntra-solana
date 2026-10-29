'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useAssistant } from '@/city/lib/assistant/store';
import { toneOf, type Tone } from '@/city/lib/assistant/answer';
import { useCity } from '@/city/lib/city/store';
import { PALETTE } from '@/city/lib/palette';

/** A tower's light follows its own move: mint for a rise, red for a fall, the city's amber when flat (brandbook §2). */
const TONE: Record<Tone, string> = { up: PALETTE.mint, down: PALETTE.flare, flat: PALETTE.amber };

/**
 * The towers Ryntra's answer is about (CITY-10): a light column rises from each roof and a halo breathes around it,
 * the first one brightest, so the answer reads on the skyline before a word of it.
 */
export function Beacons() {
  const shown = useAssistant((st) => st.shown);
  const focusAt = useAssistant((st) => st.focusAt);
  const layout = useCity((st) => st.layout);
  const placed = useMemo(() => shown.map((s) => layout.towers.find((p) => p.tower.id === s.id)).filter((p) => !!p), [shown, layout]);
  if (!placed.length) return null;
  return (
    <>
      {placed.map((t, i) => (
        <Beacon key={`${focusAt}:${t.tower.id}`} x={t.x} z={t.z} top={t.height} width={t.width} tone={TONE[toneOf(t.tower)]} lead={i === 0} delay={i * 0.18} />
      ))}
    </>
  );
}

function Beacon({ x, z, top, width, tone, lead, delay }: { x: number; z: number; top: number; width: number; tone: string; lead: boolean; delay: number }) {
  const halo = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  const column = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  const born = useRef<number | null>(null);
  const color = useMemo(() => new THREE.Color(tone).multiplyScalar(lead ? 3.4 : 2.4), [tone, lead]);
  const height = lead ? 90 : 60;
  useFrame(({ clock }) => {
    born.current ??= clock.elapsedTime;
    // The light rises out of the roof once, then breathes; each beacon a beat after the one before it.
    const age = Math.max(0, clock.elapsedTime - born.current - delay);
    const rise = 1 - Math.pow(1 - Math.min(1, age / 0.9), 3);
    const breath = 0.75 + 0.25 * Math.sin(clock.elapsedTime * 2.1 + delay * 6);
    if (column.current) {
      column.current.scale.set(1, Math.max(0.001, rise), 1);
      column.current.position.y = top + (height * rise) / 2;
      column.current.material.opacity = (lead ? 0.42 : 0.3) * rise;
    }
    if (halo.current) {
      halo.current.scale.setScalar(1 + 0.18 * Math.sin(clock.elapsedTime * 2.1 + delay * 6));
      halo.current.material.opacity = 0.85 * breath * rise;
    }
  });
  return (
    <group position={[x, 0, z]}>
      <mesh ref={column} position-y={top}>
        <cylinderGeometry args={[0.35, width * 0.32, height, 16, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={halo} position-y={top + 0.6} rotation-x={-Math.PI / 2}>
        <torusGeometry args={[width * 0.95, 0.28, 8, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}
