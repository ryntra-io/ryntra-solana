'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { PlacedTower } from '@/city/lib/city/layout';
import { useCity } from '@/city/lib/city/store';
import { colourOf } from '@/city/lib/trade/colour';
import { glowingMints, useTrade } from '@/city/lib/trade/store';
import { ownedMints, useWallet } from '@/city/lib/trade/wallet';

/** More than this many towers of one wallet light the city, not just the wallet's coins. */
const MAX = 32;
/** How long the city celebrates a tower you just bought. */
const BURST_S = 6;

/**
 * Your towers glow in your colour: every coin your wallet holds that stands in the city gets a crown ring, a thin
 * beam and a ring at its feet. A tower you just bought gets rings climbing it for a few seconds. Nothing here is a
 * figure: the glow only says you hold the coin, read from your wallet through the engine.
 */
export function MyTowers() {
  const layout = useCity((st) => st.layout);
  const address = useWallet((st) => st.connection?.address ?? null);
  const holdings = useWallet((st) => (st.connection && st.holdings?.owner === st.connection.address ? st.holdings : null));
  const optimistic = useTrade((st) => st.optimistic);
  const celebrate = useTrade((st) => st.celebrate);
  const mine = useMemo(() => {
    const mints = glowingMints(ownedMints(holdings), optimistic, Date.now());
    return layout.towers.filter((t) => mints.has(t.tower.id)).slice(0, MAX);
  }, [layout, holdings, optimistic]);
  const burst = useMemo(() => (celebrate ? (layout.towers.find((t) => t.tower.id === celebrate.mint) ?? null) : null), [layout, celebrate]);
  if (!address) return null;
  const colour = colourOf(address);
  return (
    <>
      {mine.length > 0 && <Beacons towers={mine} colour={colour} />}
      {burst && celebrate && <Burst key={celebrate.at} tower={burst} colour={colour} />}
    </>
  );
}

function Beacons({ towers, colour }: { towers: readonly PlacedTower[]; colour: string }) {
  const crowns = useRef<THREE.InstancedMesh>(null);
  const beams = useRef<THREE.InstancedMesh>(null);
  const feet = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(() => {
    const ring = new THREE.TorusGeometry(1, 0.07, 6, 64);
    ring.rotateX(Math.PI / 2);
    const beam = new THREE.CylinderGeometry(0.35, 1, 1, 16, 1, true);
    beam.translate(0, 0.5, 0);
    const glow = (opacity: number, scale: number) =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(colour).multiplyScalar(scale),
        transparent: true,
        opacity,
        toneMapped: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
    return { ring, beam, crown: glow(0.95, 3), shaft: glow(0.28, 2.2), foot: glow(0.7, 2.4) };
  }, [colour]);
  useEffect(
    () => () => {
      for (const part of Object.values(parts)) part.dispose();
    },
    [parts],
  );

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const v = new THREE.Vector3();
    towers.forEach((t, i) => {
      const roof = t.height + t.width * 0.9;
      crowns.current?.setMatrixAt(i, m.compose(p.set(t.x, roof, t.z), q, v.set(t.width * 1.25, t.width * 1.25, t.width * 1.25)));
      beams.current?.setMatrixAt(i, m.compose(p.set(t.x, roof, t.z), q, v.set(t.width * 0.22, 120, t.width * 0.22)));
      feet.current?.setMatrixAt(i, m.compose(p.set(t.x, 0.3, t.z), q, v.set(t.width * 1.7, 1, t.width * 1.7)));
    });
    for (const mesh of [crowns.current, beams.current, feet.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [towers]);

  useFrame(({ clock }) => {
    // A slow breath, the same for every tower you hold.
    const k = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 1.6);
    parts.crown.opacity = 0.7 + 0.3 * k;
    parts.shaft.opacity = 0.18 + 0.14 * k;
  });

  return (
    <group>
      <instancedMesh ref={crowns} args={[parts.ring, parts.crown, towers.length]} frustumCulled={false} />
      <instancedMesh ref={beams} args={[parts.beam, parts.shaft, towers.length]} frustumCulled={false} />
      <instancedMesh ref={feet} args={[parts.ring, parts.foot, towers.length]} frustumCulled={false} />
    </group>
  );
}

/** The tower you just bought: rings of your colour climb it, then the city goes back to its own light. */
function Burst({ tower, colour }: { tower: PlacedTower; colour: string }) {
  const rings = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const [over, setOver] = useState(false);
  const color = useMemo(() => new THREE.Color(colour).multiplyScalar(3.4), [colour]);
  useFrame(({ clock }) => {
    if (start.current === null) start.current = clock.elapsedTime;
    const age = clock.elapsedTime - start.current;
    if (age > BURST_S) {
      if (!over) setOver(true);
      return;
    }
    const fade = Math.min(1, (BURST_S - age) / 1.2);
    rings.current?.children.forEach((child, i) => {
      const ring = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      const k = (age * 0.7 + i / 4) % 1;
      ring.position.y = tower.height * (0.04 + k * 1.05);
      ring.scale.setScalar(1 + 0.25 * Math.sin(k * Math.PI));
      ring.material.opacity = Math.sin(k * Math.PI) * fade;
    });
  });
  if (over) return null;
  return (
    <group position={[tower.x, 0, tower.z]} ref={rings}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} rotation-x={-Math.PI / 2}>
          <torusGeometry args={[tower.width * 1.05, 0.28, 8, 72]} />
          <meshBasicMaterial color={color} transparent opacity={0} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
    </group>
  );
}
