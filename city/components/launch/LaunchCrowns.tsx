'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { PlacedTower } from '@/city/lib/city/layout';
import { useCity } from '@/city/lib/city/store';
import { allLaunches, useLaunch } from '@/city/lib/launch/district';
import { crownRings, litRings } from '@/city/lib/launch/silhouette';
import { shownLaunches } from '@/city/lib/launch/towers';
import { PALETTE } from '@/city/lib/palette';

/** Rings drawn at most: every launch tower the city shows can carry all three. */
const MAX = 48;
const DAYS = [7, 30, 90] as const;
/** Each ring's light: day 90 burns brightest, a warmer white. */
const LIGHT: Record<(typeof DAYS)[number], THREE.Color> = {
  7: new THREE.Color(PALETTE.amber).multiplyScalar(1.25),
  30: new THREE.Color(PALETTE.amber).multiplyScalar(1.6),
  90: new THREE.Color(PALETTE.warmWhite).multiplyScalar(1.9),
};

type Ring = Readonly<{ x: number; y: number; z: number; r: number; day: (typeof DAYS)[number]; seed: number }>;

/**
 * The survival rings on the crowns of Ryntra's launches (L7, CITY-144): a ring for each of days 7, 30 and 90 the coin
 * lived through, lit only when the trade that proves it was not one of the creator's own party (`crownRings`). Day 7 is
 * the lowest, day 90 the highest and brightest, so a ninety-day tower reads from across the city. No figure and no
 * word: the window says what each ring is.
 */
export function LaunchCrowns() {
  const layout = useCity((st) => st.layout);
  const feed = useLaunch((st) => st.feed);
  const mine = useLaunch((st) => st.mine);
  const rings = useMemo(() => {
    const lit = new Map<string, readonly (typeof DAYS)[number][]>();
    /* Only the launches the city stands as towers: never a ring on another tower of the same mint. */
    for (const launch of shownLaunches(allLaunches({ feed, mine }))) {
      const days = litRings(crownRings(launch.checks, launch.flow?.survival ?? null));
      if (days.length) lit.set(launch.token, days);
    }
    if (!lit.size) return [];
    return layout.towers.flatMap((t) => (lit.get(t.tower.id) ?? []).map((day) => ringOf(t, day))).slice(0, MAX);
  }, [layout, feed, mine]);
  if (!rings.length) return null;
  return <Halos rings={rings} />;
}

/** Where a ring sits: around the crown's top, clear of the tower's corners, the three a step apart. */
function ringOf(t: PlacedTower, day: (typeof DAYS)[number]): Ring {
  const step = Math.min(1.6, Math.max(0.42, t.height * 0.055));
  const level = DAYS.indexOf(day);
  return { x: t.x, z: t.z, y: t.height - step * (2.5 - level), r: t.width * (1.12 + level * 0.06), day, seed: t.seed % 997 };
}

function Halos({ rings }: { rings: readonly Ring[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(() => {
    // A thin ring lying flat: a torus of radius 1, turned from the XY plane into the ground's.
    const ring = new THREE.TorusGeometry(1, 0.02, 6, 128);
    ring.rotateX(Math.PI / 2);
    const glow = new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    return { ring, glow };
  }, []);
  useEffect(
    () => () => {
      parts.ring.dispose();
      parts.glow.dispose();
    },
    [parts],
  );
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const v = new THREE.Vector3();
    rings.forEach((ring, i) => {
      mesh.current?.setMatrixAt(i, m.compose(p.set(ring.x, ring.y, ring.z), q, v.set(ring.r, ring.r, ring.r)));
      mesh.current?.setColorAt(i, LIGHT[ring.day]);
    });
    if (mesh.current) {
      mesh.current.instanceMatrix.needsUpdate = true;
      if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
      mesh.current.computeBoundingSphere();
    }
  }, [rings]);
  // A slow breath, each ring on its own beat, so the crowns live without blinking.
  const tint = useMemo(() => new THREE.Color(), []);
  useFrame(({ clock }) => {
    const current = mesh.current;
    if (!current) return;
    const t = clock.elapsedTime;
    rings.forEach((ring, i) => current.setColorAt(i, tint.copy(LIGHT[ring.day]).multiplyScalar(0.82 + 0.18 * Math.sin(t * 0.9 + ring.seed + DAYS.indexOf(ring.day) * 1.9))));
    if (current.instanceColor) current.instanceColor.needsUpdate = true;
  });
  return <instancedMesh key={rings.length} ref={mesh} args={[parts.ring, parts.glow, rings.length]} frustumCulled={false} />;
}
