'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useBeacons } from '@/city/lib/beacon/store';
import { BEACONS } from '@/city/lib/beacon/switch';
import type { PlacedTower } from '@/city/lib/city/layout';
import { useCity } from '@/city/lib/city/store';
import { PALETTE } from '@/city/lib/palette';

/** Beacons drawn at most: the rest still light their button on the tower card. */
const MAX = 48;

/**
 * Beacons on towers (CITY-72). A tower with a beacon carries a small amber lamp on its roof; when the beacon fires,
 * the lamp becomes a lighthouse — two beams sweep the skyline and a column of light stands over it — for half an
 * hour. Nothing here is a figure: the light only says a person's own rule held.
 */
/** The towers' beacons in the scene: nothing where the build keeps beacons closed. */
export function BeaconTowers() {
  return BEACONS === 'closed' ? null : <BeaconMarks />;
}

function BeaconMarks() {
  const layout = useCity((st) => st.layout);
  const glow = useBeacons((st) => st.glow);
  const { set, lit } = useMemo(() => {
    const set: PlacedTower[] = [];
    const lit: PlacedTower[] = [];
    for (const t of layout.towers) {
      const g = glow.get(t.tower.id);
      if (g === 'lit') lit.push(t);
      else if (g === 'set') set.push(t);
    }
    return { set: set.slice(0, MAX), lit: lit.slice(0, MAX) };
  }, [layout, glow]);
  if (!set.length && !lit.length) return null;
  return (
    <>
      {set.length > 0 && <Lamps towers={set} />}
      {lit.map((t) => (
        <Lighthouse key={t.tower.id} tower={t} />
      ))}
    </>
  );
}

const roofOf = (t: PlacedTower) => t.height + t.width * 1.6;

function glowMaterial(opacity: number, scale: number) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.amber).multiplyScalar(scale),
    transparent: true,
    opacity,
    toneMapped: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
}

/** Set and waiting: a small lamp breathing on each roof. */
function Lamps({ towers }: { towers: readonly PlacedTower[] }) {
  const lamps = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(() => ({ lamp: new THREE.OctahedronGeometry(1, 0), glow: glowMaterial(0.8, 2.4) }), []);
  useEffect(
    () => () => {
      parts.lamp.dispose();
      parts.glow.dispose();
    },
    [parts],
  );
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const v = new THREE.Vector3();
    towers.forEach((t, i) => {
      const size = Math.max(0.9, t.width * 0.32);
      lamps.current?.setMatrixAt(i, m.compose(p.set(t.x, roofOf(t), t.z), q, v.set(size, size * 1.6, size)));
    });
    if (lamps.current) {
      lamps.current.instanceMatrix.needsUpdate = true;
      lamps.current.computeBoundingSphere();
    }
  }, [towers]);
  useFrame(({ clock }) => {
    parts.glow.opacity = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.2));
  });
  return <instancedMesh ref={lamps} args={[parts.lamp, parts.glow, towers.length]} frustumCulled={false} />;
}

/** Lit: a lighthouse on the roof — two sweeping beams, a bright lamp and a column of light. */
function Lighthouse({ tower }: { tower: PlacedTower }) {
  const sweep = useRef<THREE.Group>(null);
  const lamp = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  const parts = useMemo(() => {
    const reach = 12 + tower.width * 2.2;
    // A beam: an open cone lying on its side, its tip at the lamp.
    const beam = new THREE.ConeGeometry(reach * 0.16, reach, 24, 1, true);
    beam.translate(0, -reach / 2, 0);
    beam.rotateZ(Math.PI / 2 - 0.08);
    const column = new THREE.CylinderGeometry(0.4, tower.width * 0.5, 160, 16, 1, true);
    column.translate(0, 80, 0);
    return { beam, column, lamp: new THREE.SphereGeometry(Math.max(1.1, tower.width * 0.38), 16, 12), ray: glowMaterial(0.16, 2), shaft: glowMaterial(0.3, 2.4), core: glowMaterial(1, 4) };
  }, [tower.width]);
  useEffect(
    () => () => {
      for (const part of Object.values(parts)) part.dispose();
    },
    [parts],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (sweep.current) sweep.current.rotation.y = t * 1.1;
    const k = 0.5 + 0.5 * Math.sin(t * 3.2);
    parts.core.opacity = 0.75 + 0.25 * k;
    parts.shaft.opacity = 0.2 + 0.18 * k;
    lamp.current?.scale.setScalar(1 + 0.18 * k);
  });
  const roof = roofOf(tower);
  return (
    <group position={[tower.x, roof, tower.z]}>
      <mesh ref={lamp} geometry={parts.lamp} material={parts.core} />
      <group ref={sweep}>
        <mesh geometry={parts.beam} material={parts.ray} />
        <mesh geometry={parts.beam} material={parts.ray} rotation-y={Math.PI} />
      </group>
      <mesh geometry={parts.column} material={parts.shaft} />
    </group>
  );
}
