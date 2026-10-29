'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useCity } from '@/city/lib/city/store';
import { PALETTE } from '@/city/lib/palette';
import { Beacons } from '../assistant/Beacons';

/**
 * The tower you picked: warm rings climb it and a light stands on its roof, so a flight always ends on it. Beside it,
 * the towers Ryntra's answer is about (CITY-10).
 */
export function Selected() {
  const selectedId = useCity((st) => st.selectedId);
  const layout = useCity((st) => st.layout);
  const t = useMemo(() => layout.towers.find((p) => p.tower.id === selectedId) ?? null, [layout, selectedId]);
  return (
    <>
      {t && <Rings key={t.tower.id} x={t.x} z={t.z} top={t.height} width={t.width} />}
      <Beacons />
    </>
  );
}

function Rings({ x, z, top, width }: { x: number; z: number; top: number; width: number }) {
  const rings = useRef<THREE.Group>(null);
  const color = useMemo(() => new THREE.Color(PALETTE.amber).multiplyScalar(3.2), []);
  useFrame(({ clock }) => {
    rings.current?.children.forEach((child, i) => {
      const ring = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      const k = (clock.elapsedTime * 0.45 + i / 3) % 1;
      ring.position.y = top * (0.06 + k * 0.96);
      ring.scale.setScalar(1 + 0.12 * Math.sin(k * Math.PI));
      ring.material.opacity = Math.sin(k * Math.PI) * 0.9;
    });
  });
  return (
    <group position={[x, 0, z]}>
      <group ref={rings}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} rotation-x={-Math.PI / 2}>
            <torusGeometry args={[width * 0.8, 0.2, 8, 72]} />
            <meshBasicMaterial color={color} transparent toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
        ))}
      </group>
      <mesh position-y={top + 40}>
        <cylinderGeometry args={[0.6, width * 0.45, 80, 20, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
