'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useCity } from '@/city/lib/city/store';
import { useNight } from '@/city/lib/launch/night-store';
import { PALETTE } from '@/city/lib/palette';

/**
 * Launch Night's stage light (CITY-146): while the show plays, a searchlight falls from the sky onto the launch on the
 * stage, a ring of light runs round its foot and the beam sways a little, as a stage light does. It is light only —
 * nothing is said on the tower, and nothing stands on any other tower.
 */
export function NightSpot() {
  const token = useNight((st) => (st.playing ? (st.show?.entries[st.index]?.token ?? null) : null));
  const layout = useCity((st) => st.layout);
  const t = useMemo(() => (token ? (layout.towers.find((p) => p.tower.id === token) ?? null) : null), [layout, token]);
  if (!t) return null;
  return <Spot key={t.tower.id} x={t.x} z={t.z} top={t.height} width={t.width} />;
}

const BEAM = 120;

function Spot({ x, z, top, width }: { x: number; z: number; top: number; width: number }) {
  const beam = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  const ring = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  const warm = useMemo(() => new THREE.Color(PALETTE.amber).multiplyScalar(1.8), []);
  const violet = useMemo(() => new THREE.Color(PALETTE.violet).multiplyScalar(2.2), []);
  const born = useRef<number | null>(null);
  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    born.current ??= time;
    /* The light opens over half a second, then breathes. */
    const open = Math.min(1, (time - born.current) / 0.5);
    if (beam.current) {
      beam.current.material.opacity = open * (0.11 + 0.03 * Math.sin(time * 2.1));
      beam.current.rotation.z = Math.sin(time * 0.7) * 0.05;
      beam.current.rotation.x = Math.cos(time * 0.55) * 0.04;
    }
    if (ring.current) {
      const k = (time * 0.6) % 1;
      ring.current.scale.setScalar(1 + k * 1.4);
      ring.current.material.opacity = open * (1 - k) * 0.85;
    }
  });
  return (
    <group position={[x, 0, z]}>
      {/* The beam: wide at the tower, narrow in the sky, its foot just over the roof's corners. */}
      <group position-y={top}>
        <mesh ref={beam} position-y={BEAM / 2}>
          <cylinderGeometry args={[0.8, width * 0.8, BEAM, 28, 1, true]} />
          <meshBasicMaterial color={warm} transparent opacity={0} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.3}>
        <torusGeometry args={[width * 0.9, 0.24, 8, 72]} />
        <meshBasicMaterial color={violet} transparent opacity={0} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}
