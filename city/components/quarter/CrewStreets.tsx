'use client';

import { Html } from '@react-three/drei';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CREW_LIGHT, HQ_LOT } from '@/lib/world/crew';
import { useMoments } from '@/city/lib/moments/stage';
import { defaultModules, isLevel, renderBuilding } from '@/city/lib/quarter/kit';
import { MODULES } from '@/lib/world/catalog';
import { useCrew } from '@/city/lib/quarter/crew-store';
import { useWords } from '@/city/lib/i18n/dict';
import { ARRIVALS, LOT_W, STREET_PITCH, lotOf } from '@/city/lib/quarter/plot';
import type { CrewStreet } from '@/city/lib/quarter/types';
import { useRun } from '@/city/lib/run/store';
import { TERRACE_TOP } from './afar';
import { createHaloMaterial } from './materials';
import { BUILDING_SCALE, heightOf, seedOf } from './QuarterBuilding';
import c from './crew.module.css';
import q from './quarter.module.css';
import { CREW } from './words';

/** The headquarters stands on a whole lot: this many times a plot's building. */
export const HQ_SCALE = 2.3;
/** Two kerb lines a side of the avenue, for every crew street. */
const STRIPS_PER_STREET = 4;
const MAX_STREETS = 64;

/** What the headquarters wears: the modules its members gave, the kit's own for every part nobody gave yet. */
export function hqLook(level: number, given: readonly string[]): { level: 1 | 2 | 3 | 4 | 5; modules: string[] } {
  const l = isLevel(level) ? level : 1;
  const parts = new Set(given.map((m) => MODULES[m]?.part).filter(Boolean));
  const fill = defaultModules('crew_hq', l).filter((m) => {
    const part = MODULES[m]?.part;
    return part && !parts.has(part);
  });
  return { level: l, modules: [...given, ...fill] };
}

/**
 * Every crew's street on the newcomers' terrace (CITY-20): both kerbs of the street lit in the crew's colour, its
 * headquarters standing across from the first member on a lot of its own, with a soft pool of the same light under
 * it, and the street's name over it. `CrewBuildings` goes into the terrace's KitWorld; `CrewStreets` — the lines, the
 * pools (two instanced draws for every street at once) and the signs — stands beside it, as the quarter's own mark does,
 * so a sign's root is never torn down by the kit.
 */
export function CrewStreets() {
  const streets = useShown();
  return (
    <>
      <Kerbs streets={streets} />
      {streets.map((street) => (
        <Sign key={street.id} street={street} />
      ))}
    </>
  );
}

/** The headquarters of every crew street, drawn by the quarter's kit. */
export function CrewBuildings() {
  const streets = useShown();
  return (
    <>
      {streets.map((street) => (
        <Hq key={street.id} street={street} />
      ))}
    </>
  );
}

function useShown(): CrewStreet[] {
  const streets = useCrew((st) => st.streets);
  return useMemo(() => streets.slice(0, MAX_STREETS), [streets]);
}

/** The kerb lines and the pools under each headquarters, in each crew's light. */
function Kerbs({ streets }: { streets: readonly CrewStreet[] }) {
  const lines = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);
  const { line, lineMaterial, pool, poolMaterial } = useMemo(() => {
    const line = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const lineMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    const pool = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    pool.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(MAX_STREETS * 4), 4));
    return { line, lineMaterial, pool, poolMaterial: createHaloMaterial() };
  }, []);
  useEffect(
    () => () => {
      line.dispose();
      lineMaterial.dispose();
      pool.dispose();
      poolMaterial.dispose();
    },
    [line, lineMaterial, pool, poolMaterial],
  );

  useLayoutEffect(() => {
    const l = lines.current;
    const p = pools.current;
    if (!l || !p) return;
    const m = new THREE.Matrix4();
    const colour = new THREE.Color();
    const tint = pool.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    const { lane, gap, street, streetZ, perSide } = ARRIVALS;
    const reach = perSide * (LOT_W + gap);
    let n = 0;
    streets.forEach((s, i) => {
      colour.set(CREW_LIGHT[s.colour]);
      const zc = streetZ + s.row * STREET_PITCH;
      for (const side of [-1, 1]) {
        for (const kerb of [-1, 1]) {
          l.setMatrixAt(n, m.makeScale(reach, 1, 0.32).setPosition(side * (lane + reach / 2), TERRACE_TOP + 0.04, zc + kerb * street));
          l.setColorAt(n, colour.clone().multiplyScalar(2.2));
          n += 1;
        }
      }
      const hq = lotOf({ x: HQ_LOT, z: s.row });
      p.setMatrixAt(i, m.makeScale(LOT_W * 1.1, 1, LOT_W * 1.1).setPosition(hq.x, TERRACE_TOP + 0.03, hq.z));
      tint.setXYZW(i, colour.r, colour.g, colour.b, 0.55 + 0.1 * Math.min(4, s.hq.level - 1));
    });
    l.count = n;
    p.count = streets.length;
    l.instanceMatrix.needsUpdate = true;
    if (l.instanceColor) l.instanceColor.needsUpdate = true;
    p.instanceMatrix.needsUpdate = true;
    tint.needsUpdate = true;
    l.computeBoundingSphere();
    p.computeBoundingSphere();
  }, [streets, pool]);

  return (
    <>
      <instancedMesh ref={lines} args={[line, lineMaterial, MAX_STREETS * STRIPS_PER_STREET]} frustumCulled={false} renderOrder={2} visible={streets.length > 0} />
      <instancedMesh ref={pools} args={[pool, poolMaterial, MAX_STREETS]} frustumCulled={false} renderOrder={2} visible={streets.length > 0} />
    </>
  );
}

const HIDDEN = { visibility: 'hidden' } as const;

/** One street's headquarters, drawn by the quarter's kit. */
function Hq({ street }: { street: CrewStreet }) {
  const lot = useMemo(() => lotOf({ x: HQ_LOT, z: street.row }), [street.row]);
  const look = useMemo(() => hqLook(street.hq.level, street.hq.modules), [street.hq.level, street.hq.modules]);
  return (
    <group position={[lot.x, TERRACE_TOP, lot.z]} rotation-y={lot.facing === 1 ? 0 : Math.PI} scale={BUILDING_SCALE * HQ_SCALE}>
      {renderBuilding('crew_hq', look.level, look.modules, { seed: seedOf(street.id) })}
    </group>
  );
}

/** The street's name over its headquarters; kept mounted and hidden during a run or a filming. */
function Sign({ street }: { street: CrewStreet }) {
  const lot = useMemo(() => lotOf({ x: HQ_LOT, z: street.row }), [street.row]);
  const look = useMemo(() => hqLook(street.hq.level, street.hq.modules), [street.hq.level, street.hq.modules]);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useMoments((st) => st.filming !== null);
  const w = useWords(CREW);
  const top = TERRACE_TOP + heightOf('crew_hq', look.level, look.modules) * HQ_SCALE + 1.6;
  return (
    <Html position={[lot.x, top, lot.z]} center zIndexRange={[3, 0]} pointerEvents="none" className={q.tagWrap} style={running || filming ? HIDDEN : undefined}>
      <div className={c.sign} style={{ ['--crew' as string]: CREW_LIGHT[street.colour] }}>
        <span className={c.signName}>{street.name}</span>
        <span className={c.signLine}>
          {street.members}/{street.limit} · {w.hqLevel(street.hq.level)}
        </span>
      </div>
    </Html>
  );
}
