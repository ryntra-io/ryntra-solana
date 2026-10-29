'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { PlacedTower } from '@/city/lib/city/layout';
import { useCity } from '@/city/lib/city/store';
import { HARBOR_OPEN } from '@/city/lib/districts/harbor/flag';
import { harborMints } from '@/city/lib/districts/harbor/positions';
import { useHarbor } from '@/city/lib/districts/harbor/store';
import { colourOf } from '@/city/lib/trade/colour';
import { useWallet } from '@/city/lib/trade/wallet';

/** More than this many positions light the city, not just the wallet's pools. */
const MAX = 24;

// Scratch objects for placing the rings every frame, so the swell allocates nothing.
const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const V = new THREE.Vector3();

/**
 * Your pool positions in the city: the tower of each pool's coin wears two rings of your colour around its body, like
 * a ship moored in the Harbor. Nothing here is a figure: the rings only say you have a position, read from the chain
 * through the engine.
 */
export function HarborTowers() {
  if (!HARBOR_OPEN) return null;
  return <Moored />;
}

function Moored() {
  const layout = useCity((st) => st.layout);
  const address = useWallet((st) => st.connection?.address ?? null);
  const positions = useHarbor((st) => (st.positions.status === 'ready' && st.positions.owner === address ? st.positions.positions : null));
  const towers = useMemo(() => {
    const mints = harborMints(positions);
    return layout.towers.filter((t) => mints.has(t.tower.id)).slice(0, MAX);
  }, [layout, positions]);
  if (!address || !towers.length) return null;
  return <Rings towers={towers} colour={colourOf(address)} />;
}

function Rings({ towers, colour }: { towers: readonly PlacedTower[]; colour: string }) {
  const low = useRef<THREE.InstancedMesh>(null);
  const high = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(() => {
    const ring = new THREE.TorusGeometry(1, 0.09, 6, 64);
    ring.rotateX(Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colour).multiplyScalar(3.2),
      transparent: true,
      opacity: 0.85,
      toneMapped: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    return { ring, material };
  }, [colour]);
  useEffect(
    () => () => {
      parts.ring.dispose();
      parts.material.dispose();
    },
    [parts],
  );

  const place = (mesh: THREE.InstancedMesh | null, at: number, lift: number) => {
    if (!mesh) return;
    towers.forEach((t, i) => {
      const r = t.width * 1.15;
      mesh.setMatrixAt(i, M.compose(P.set(t.x, t.height * at + lift * t.width, t.z), Q, V.set(r, r, r)));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  useLayoutEffect(() => {
    place(low.current, 0.33, 0);
    place(high.current, 0.66, 0);
    for (const mesh of [low.current, high.current]) mesh?.computeBoundingSphere();
    // The rings follow the towers; `place` reads them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [towers]);

  useFrame(({ clock }) => {
    // A slow swell, like water under a moored ship.
    const t = clock.elapsedTime;
    const k = Math.sin(t * 1.1);
    place(low.current, 0.33, 0.12 * k);
    place(high.current, 0.66, -0.12 * k);
    parts.material.opacity = 0.65 + 0.25 * (0.5 + 0.5 * Math.sin(t * 1.6));
  });

  return (
    <group>
      <instancedMesh ref={low} args={[parts.ring, parts.material, towers.length]} frustumCulled={false} />
      <instancedMesh ref={high} args={[parts.ring, parts.material, towers.length]} frustumCulled={false} />
    </group>
  );
}
