'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { PlacedTower } from '@/city/lib/city/layout';
import { useCity } from '@/city/lib/city/store';
import { allLaunches, useLaunch } from '@/city/lib/launch/district';
import { towerHalo } from '@/city/lib/launch/shield';
import { shownLaunches } from '@/city/lib/launch/towers';
import { PALETTE } from '@/city/lib/palette';

/** Halos drawn at most: every launch tower the city shows can wear one. */
const MAX = 16;
/** The halo's light: the city's stored-sun amber, a little hotter than the survival rings so the two read apart. */
const LIGHT = new THREE.Color(PALETTE.amber).multiplyScalar(1.1);

type Halo = Readonly<{ x: number; z: number; r: number; h: number; seed: number }>;

/**
 * The halo of the shielded launch (CITY-169): a soft veil of light around a launch tower born on the shield — bots paid
 * the shield's fee at its start, the creator held nothing to dump — and a ring of light on the ground at its foot. It
 * fades upward, so the crown and its survival rings stay clear. A sale by the creator puts it out (`towerHalo`). No
 * figure and no word: the tower's window says what the halo is.
 */
export function LaunchHalos() {
  const layout = useCity((st) => st.layout);
  const feed = useLaunch((st) => st.feed);
  const mine = useLaunch((st) => st.mine);
  const halos = useMemo(() => {
    const lit = new Set<string>();
    /* Only the launches the city stands as towers: never a halo on another tower of the same mint. */
    for (const launch of shownLaunches(allLaunches({ feed, mine }))) if (towerHalo(launch)) lit.add(launch.token);
    if (!lit.size) return [];
    return layout.towers.filter((t) => lit.has(t.tower.id)).map(haloOf).slice(0, MAX);
  }, [layout, feed, mine]);
  if (!halos.length) return null;
  return <Veils halos={halos} />;
}

/** Where a halo stands: around the tower, clear of its corners, up to just under the crown's rings. */
function haloOf(t: PlacedTower): Halo {
  return { x: t.x, z: t.z, r: t.width * 1.08, h: Math.max(1, t.height * 0.85), seed: t.seed % 997 };
}

function Veils({ halos }: { halos: readonly Halo[] }) {
  const veil = useRef<THREE.InstancedMesh>(null);
  const foot = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(() => {
    // An open cylinder of radius 1 and height 1 standing on the ground, its light fading to nothing at the top: with
    // additive light, a black vertex is no light at all.
    const shell = new THREE.CylinderGeometry(1, 1, 1, 64, 8, true);
    shell.translate(0, 0.5, 0);
    const position = shell.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i += 1) {
      const fade = (1 - position.getY(i)) ** 1.8 * 0.62;
      colors.set([fade, fade, fade], i * 3);
    }
    shell.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const veilGlow = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    // The ring at its foot: a thin band of light lying on the ground.
    const ring = new THREE.TorusGeometry(1, 0.05, 6, 128);
    ring.rotateX(Math.PI / 2);
    const ringGlow = new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    return { shell, veilGlow, ring, ringGlow };
  }, []);
  useEffect(
    () => () => {
      parts.shell.dispose();
      parts.veilGlow.dispose();
      parts.ring.dispose();
      parts.ringGlow.dispose();
    },
    [parts],
  );
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const v = new THREE.Vector3();
    halos.forEach((halo, i) => {
      veil.current?.setMatrixAt(i, m.compose(p.set(halo.x, 0, halo.z), q, v.set(halo.r, halo.h, halo.r)));
      veil.current?.setColorAt(i, LIGHT);
      foot.current?.setMatrixAt(i, m.compose(p.set(halo.x, 0.06, halo.z), q, v.set(halo.r * 1.08, halo.r * 1.08, halo.r * 1.08)));
      foot.current?.setColorAt(i, LIGHT);
    });
    for (const mesh of [veil.current, foot.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [halos]);
  // A slow breath, each halo on its own beat, slower than the rings' so the tower reads calm.
  const tint = useMemo(() => new THREE.Color(), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    halos.forEach((halo, i) => {
      const breath = 0.78 + 0.22 * Math.sin(t * 0.6 + halo.seed);
      veil.current?.setColorAt(i, tint.copy(LIGHT).multiplyScalar(breath));
      foot.current?.setColorAt(i, tint.copy(LIGHT).multiplyScalar(0.9 + 0.5 * breath));
    });
    for (const mesh of [veil.current, foot.current]) if (mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh key={`veil-${halos.length}`} ref={veil} args={[parts.shell, parts.veilGlow, halos.length]} frustumCulled={false} renderOrder={2} />
      <instancedMesh key={`foot-${halos.length}`} ref={foot} args={[parts.ring, parts.ringGlow, halos.length]} frustumCulled={false} />
    </>
  );
}
