'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useCity } from '@/city/lib/city/store';
import { hotTower } from '@/city/lib/city/hot';
import { lookMode } from '@/city/lib/look';
import { PALETTE } from '@/city/lib/palette';

/** Concept-only 3D for Ryntra City: your tower's glow, and an agent drone circling what it found. */
export function LookScene() {
  const mode = useMemo(lookMode, []);
  const layout = useCity((st) => st.layout);
  const target = useMemo(() => hotTower(layout), [layout]);
  if (!mode || !target) return null;
  if (mode === 'bought' || mode === 'win') return <YourTower x={target.x} z={target.z} top={target.height} width={target.width} />;
  if (mode === 'agent') return <Drone x={target.x} z={target.z} top={target.height} />;
  return null;
}

const glow = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

/** Rings of your colour climb the tower, and a light column stands on its top. */
function YourTower({ x, z, top, width }: { x: number; z: number; top: number; width: number }) {
  const rings = useRef<THREE.Group>(null);
  const color = useMemo(() => glow(PALETTE.mint, 4), []);
  useFrame(({ clock }) => {
    rings.current?.children.forEach((child, i) => {
      const ring = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      const t = (clock.elapsedTime * 0.45 + i / 3) % 1;
      ring.position.y = top * (0.08 + t * 0.95);
      ring.scale.setScalar(1 + 0.12 * Math.sin(t * Math.PI));
      ring.material.opacity = Math.sin(t * Math.PI) * 0.95;
    });
  });
  return (
    <group position={[x, 0, z]}>
      <group ref={rings}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} rotation-x={-Math.PI / 2}>
            <torusGeometry args={[width * 0.8, 0.22, 8, 72]} />
            <meshBasicMaterial color={color} transparent toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
        ))}
      </group>
      <mesh position-y={top + 150}>
        <cylinderGeometry args={[1.2, width * 0.6, 300, 24, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

const tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), d: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };

/** The agent: a diamond drone with a spinning ring that circles its find, a thin amber line pointing at it. */
function Drone({ x, z, top }: { x: number; z: number; top: number }) {
  const drone = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const body = useMemo(() => glow(PALETTE.ice, 2.4), []);
  const halo = useMemo(() => glow(PALETTE.violet, 3.2), []);
  const line = useMemo(() => glow(PALETTE.amber, 3), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const g = drone.current;
    if (!g) return;
    const a = t * 0.7;
    g.position.set(x + Math.cos(a) * 10, top + 7 + Math.sin(t * 2.1) * 0.7, z + Math.sin(a) * 10);
    g.rotation.y = -a;
    if (ring.current) ring.current.rotation.z = t * 3;
    const b = beam.current;
    if (!b) return;
    tmp.a.copy(g.position);
    tmp.b.set(x, top + 1.5, z);
    tmp.d.subVectors(tmp.b, tmp.a);
    const length = tmp.d.length();
    b.position.copy(tmp.a).addScaledVector(tmp.d, 0.5);
    b.scale.set(1, length, 1);
    b.quaternion.setFromUnitVectors(tmp.up, tmp.d.normalize());
  });
  return (
    <>
      <group ref={drone}>
        <mesh scale={[1.2, 0.7, 1.8]}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={body} toneMapped={false} />
        </mesh>
        <mesh ref={ring} rotation-x={Math.PI / 2}>
          <torusGeometry args={[2, 0.1, 6, 48]} />
          <meshBasicMaterial color={halo} toneMapped={false} />
        </mesh>
      </group>
      <mesh ref={beam}>
        <cylinderGeometry args={[0.07, 0.07, 1, 6, 1, true]} />
        <meshBasicMaterial color={line} transparent opacity={0.85} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </>
  );
}
