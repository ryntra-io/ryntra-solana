'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { PlacedTower } from '@/city/lib/city/layout';
import { useCity } from '@/city/lib/city/store';
import { useScouts } from '@/city/lib/scouts/store';
import { flaggedMints } from '@/city/lib/scouts/view';
import { useWallet } from '@/city/lib/trade/wallet';

/** Ryntra's orange, as the window frame draws it. */
const ORANGE = '#ff681c';

/**
 * A scout's flag (CITY-8): a thin pole and an orange pennant on the roof of every tower the people you brought trade,
 * as the Growth engine names them on your history (`flaggedMints`). Quiet on purpose — no figure, no label, a slow
 * flutter — it only says «your friends are here». Read from the engine for the connected wallet; a wallet that has not
 * signed in to Ryntra has no flags.
 */
export function ScoutFlags() {
  const layout = useCity((st) => st.layout);
  const address = useWallet((st) => st.connection?.address ?? null);
  const rows = useScouts((st) => (st.owner === address && st.view ? st.view.rows : null));
  const towers = useMemo(() => {
    if (!rows?.length) return [];
    const mints = new Set(flaggedMints(rows, layout.towers.map((t) => t.tower)));
    return layout.towers.filter((t) => mints.has(t.tower.id));
  }, [layout, rows]);
  if (!address || !towers.length) return null;
  return <Pennants towers={towers} />;
}

function Pennants({ towers }: { towers: readonly PlacedTower[] }) {
  const poles = useRef<THREE.InstancedMesh>(null);
  const flags = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(() => {
    const pole = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1);
    pole.translate(0, 0.5, 0);
    // A swallow-tailed pennant, hoisted on its left edge, one unit long.
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(1, 0);
    shape.lineTo(0.72, -0.3);
    shape.lineTo(1, -0.6);
    shape.lineTo(0, -0.6);
    shape.closePath();
    const pennant = new THREE.ShapeGeometry(shape);
    const pale = new THREE.MeshBasicMaterial({ color: new THREE.Color('#eef1ff').multiplyScalar(0.55), fog: false });
    const cloth = new THREE.MeshBasicMaterial({ color: new THREE.Color(ORANGE).multiplyScalar(1.7), toneMapped: false, side: THREE.DoubleSide, fog: false });
    return { pole, pennant, pale, cloth };
  }, []);
  useEffect(
    () => () => {
      for (const part of Object.values(parts)) part.dispose();
    },
    [parts],
  );

  // Where each flag stands: on the roof's centre, a pole a little taller than the tower is wide.
  const spots = useMemo(
    () =>
      towers.map((t) => {
        const tall = Math.max(4, t.width * 1.6);
        return { x: t.x, z: t.z, base: t.height, tall, size: Math.max(2.4, t.width * 0.9), phase: (t.x * 0.37 + t.z * 0.61) % (Math.PI * 2) };
      }),
    [towers],
  );

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const v = new THREE.Vector3();
    spots.forEach((spot, i) => {
      poles.current?.setMatrixAt(i, m.compose(p.set(spot.x, spot.base, spot.z), q, v.set(0.16 + spot.size * 0.02, spot.tall, 0.16 + spot.size * 0.02)));
    });
    if (poles.current) {
      poles.current.instanceMatrix.needsUpdate = true;
      poles.current.computeBoundingSphere();
    }
  }, [spots]);

  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const turn = useMemo(() => new THREE.Quaternion(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const at = useMemo(() => new THREE.Vector3(), []);
  const scale = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    const mesh = flags.current;
    if (!mesh) return;
    const time = clock.elapsedTime;
    spots.forEach((spot, i) => {
      // A slow flutter around the pole, each flag in its own wind.
      turn.setFromAxisAngle(up, 0.5 + 0.22 * Math.sin(time * 1.3 + spot.phase));
      const ripple = 1 - 0.06 * (0.5 + 0.5 * Math.sin(time * 2.6 + spot.phase * 1.7));
      mesh.setMatrixAt(i, matrix.compose(at.set(spot.x, spot.base + spot.tall, spot.z), turn, scale.set(spot.size * ripple, spot.size, 1)));
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={poles} args={[parts.pole, parts.pale, spots.length]} frustumCulled={false} />
      <instancedMesh ref={flags} args={[parts.pennant, parts.cloth, spots.length]} frustumCulled={false} />
    </group>
  );
}
