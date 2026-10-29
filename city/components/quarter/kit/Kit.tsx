'use client';

import { useFrame } from '@react-three/fiber';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type * as THREE from 'three';
import { planBuilding, type BuildOptions } from '@/city/lib/quarter/kit/blueprint';
import type { BuildingKind, Level } from '@/city/lib/quarter/kit/catalog';
import type { Lod } from '@/city/lib/quarter/kit/lod';
import type { BuildingPlan } from '@/city/lib/quarter/kit/parts';
import { KitInstancer, type KitStats } from './instancer';
import type { KitAfar } from './kitMaterial';

const KitContext = createContext<KitInstancer | null>(null);

type KitWorldProps = {
  children?: ReactNode;
  /** Draw everything at one level of detail instead of choosing by size on screen (development). */
  lod?: Lod;
  /** Tint buildings by their level of detail (development). */
  debug?: boolean;
  /** Receives the instancer, e.g. to read its stats. */
  onReady?: (kit: { stats: () => KitStats }) => void;
  /** How the buildings are seen from afar (`kitMaterial.ts`): the scene eases it, the kit only reads it. */
  afar?: KitAfar;
};

/**
 * Put every building of a quarter, a street or a district under one KitWorld: their parts share one instanced draw
 * call per shape, and each building picks its detail by its size on screen. Buildings can sit at any depth inside it.
 */
export function KitWorld({ children, lod, debug = false, onReady, afar }: KitWorldProps) {
  const kit = useMemo(() => new KitInstancer(afar), [afar]);
  useEffect(() => () => kit.dispose(), [kit]);
  useEffect(() => {
    kit.configure(lod ?? null, debug);
  }, [kit, lod, debug]);
  useEffect(() => {
    onReady?.({ stats: () => kit.stats() });
  }, [kit, onReady]);
  useFrame(({ camera, size }) => kit.update(camera, size.height));
  return (
    <>
      <primitive object={kit.root} />
      <KitContext.Provider value={kit}>{children}</KitContext.Provider>
    </>
  );
}

type KitBuildingProps = BuildOptions & { kind: BuildingKind; level: Level; modules?: readonly string[] };

/** One building of the kit at this place in the scene. Outside a KitWorld it brings its own. */
export function KitBuilding({ kind, level, modules = [], seed, signal }: KitBuildingProps) {
  const kit = useContext(KitContext);
  const key = modules.join(',');
  const plan = useMemo(() => planBuilding(kind, level, key ? key.split(',') : [], { seed, signal }), [kind, level, key, seed, signal]);
  if (!kit) {
    return (
      <KitWorld>
        <KitPlan plan={plan} />
      </KitWorld>
    );
  }
  return <KitPlan plan={plan} />;
}

/** Any list of parts drawn through the kit — a building, or a stage for one. */
export function KitPlan({ plan }: { plan: BuildingPlan }) {
  const kit = useContext(KitContext);
  const anchor = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    if (!kit || !anchor.current) return;
    const entry = kit.add(anchor.current, plan);
    return () => kit.remove(entry);
  }, [kit, plan]);
  return <group ref={anchor} />;
}
