'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useCity } from '@/city/lib/city/store';
import { usePartners } from '@/city/lib/partners/store';
import { streetsTo } from '@/city/lib/partners/streets';
import { useScouts } from '@/city/lib/scouts/store';
import { flaggedMints } from '@/city/lib/scouts/view';
import { useWallet } from '@/city/lib/trade/wallet';

/** Ryntra's orange, as the scouts' flags fly it. */
const ORANGE = '#ff681c';
const WIDTH = 3;
const LIFT = 1.1;

/**
 * The partner's network as lit streets (CITY-127): orange runs along the city's own roads from the plaza to every
 * tower the people they brought trade, breathing slowly. Drawn only for the partner, only when they switched it on in
 * «Мій район» — never a figure, never a name, and nobody else's screen ever shows it.
 */
export function NetworkStreets() {
  const on = usePartners((st) => st.choices.streets);
  const layout = useCity((st) => st.layout);
  const address = useWallet((st) => st.connection?.address ?? null);
  const demo = usePartners((st) => st.demo);
  const receipts = usePartners((st) => (st.demo || st.owner === address ? (st.view?.receipts ?? null) : null));
  const scoutRows = useScouts((st) => (st.owner === address && st.view ? st.view.rows : null));
  const rows = receipts?.length ? receipts : scoutRows;
  const segments = useMemo(() => {
    if (!rows?.length) return [];
    const mints = new Set(flaggedMints(rows, layout.towers.map((t) => t.tower)));
    return streetsTo(layout.towers.filter((t) => mints.has(t.tower.id)).map((t) => ({ x: t.x, z: t.z })));
  }, [layout, rows]);
  if (!on || (!address && !demo) || !segments.length) return null;
  return <Runs segments={segments} />;
}

function Runs({ segments }: { segments: ReturnType<typeof streetsTo> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(() => {
    const strip = new THREE.BoxGeometry(1, 0.3, 1);
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(ORANGE).multiplyScalar(4), toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    return { strip, glow };
  }, []);
  useEffect(
    () => () => {
      parts.strip.dispose();
      parts.glow.dispose();
    },
    [parts],
  );
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const v = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    segments.forEach((seg, i) => {
      // A strip along the segment: its length on z, turned about the up axis to the segment's heading.
      q.setFromAxisAngle(up, Math.atan2(seg.to.x - seg.from.x, seg.to.z - seg.from.z));
      p.set((seg.from.x + seg.to.x) / 2, LIFT, (seg.from.z + seg.to.z) / 2);
      v.set(WIDTH, 1, seg.length + WIDTH * 0.5);
      mesh.current?.setMatrixAt(i, m.compose(p, q, v));
    });
    if (mesh.current) {
      mesh.current.instanceMatrix.needsUpdate = true;
      mesh.current.computeBoundingSphere();
    }
  }, [segments]);
  useFrame(({ clock }) => {
    // A slow breath, never a flash: reduced motion or not, it stays within a soft range.
    parts.glow.opacity = 0.7 + 0.25 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 0.9));
  });
  return <instancedMesh ref={mesh} args={[parts.strip, parts.glow, segments.length]} frustumCulled={false} renderOrder={2} />;
}
