'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Signal } from '@/city/lib/quarter/kit';
import { linkKey, onEngine } from '@/city/lib/quarter/objects';
import { FIRST_SLOT, PLOT, SLOTS, openPlots, slotCentre, type Lot } from '@/city/lib/quarter/plot';
import { useFree } from '@/city/lib/quarter/kit/free/store';
import { siteStore, useSite } from '@/city/lib/quarter/site';
import { useQuarter, type Landing } from '@/city/lib/quarter/store';
import { PALETTE } from '@/city/lib/palette';
import type { Building } from '@/city/lib/quarter/types';
import { TERRACE_TOP } from './afar';
import { BuildingTag } from './BuildingTag';
import { createHaloMaterial, createPadMaterial } from './materials';
import { QuarterBuilding, heightOf, seedOf } from './QuarterBuilding';

/** The plots' surface, a hair above the terrace. */
export const PAD_Y = TERRACE_TOP + 0.03;

/**
 * The visitor's quarter on its lot: its plots wake up in build mode (the open, empty ones breathe, the first one
 * brighter while the lot is empty, the picked one still and bright, the ones a higher level opens dim), and every
 * building stands on them, the one landing now included, drawn by the quarter's kit under one KitWorld. A building on
 * the engine reads its linked object (`site.ts`) and lights by what it says, with a soft light on the ground under it
 * (brighter in mint when the object's own read says it is doing well, red when it says danger, never guessed); in
 * build mode a tag over it gives the object's first figure and its age, or says plainly that nothing is linked yet.
 * The buildings go to the KitWorld this is drawn in (the terrace's one, `QuarterScene`).
 */
export function MyQuarter({ lot }: { lot: Lot }) {
  const me = useQuarter((s) => s.me);
  const mode = useQuarter((s) => s.mode);
  const picked = useQuarter((s) => s.slot);
  const landing = useQuarter((s) => s.landing);
  const landed = useQuarter((s) => s.landed);
  // While building freely the plots keep still: the free layout draws its own grid.
  const free = useFree((s) => s.on);

  const shown = useMemo(() => standing(me?.buildings ?? [], landing), [me, landing]);
  const open = openPlots(me?.quarter.level ?? 1);
  const reads = useSite((s) => s.reads);
  const connection = useSite((s) => s.connection);

  // Every linked object is read once the quarter is shown, and again after a minute when looked at.
  useEffect(() => {
    for (const b of shown) if (b.link) void siteStore.getState().refresh(b.link);
  }, [shown, connection]);

  const pads = useRef<THREE.InstancedMesh>(null);
  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    geometry.setAttribute('aSlot', new THREE.InstancedBufferAttribute(Float32Array.from({ length: SLOTS }, (_, i) => i), 1));
    return { geometry, material: createPadMaterial() };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useLayoutEffect(() => {
    const mesh = pads.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    for (let slot = 0; slot < SLOTS; slot += 1) {
      const c = slotCentre(lot, slot);
      mesh.setMatrixAt(slot, m.makeScale(PLOT, 1, PLOT).setPosition(c.x, PAD_Y, c.z));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [lot]);

  const build = useRef(0);
  useFrame((_, dt) => {
    const on = mode === 'build' ? 1 : 0;
    build.current += (on - build.current) * Math.min(1, dt * 5);
    // In the city's view the plots are not drawn: nothing to fill.
    if (pads.current) pads.current.visible = build.current > 0.01;
    const u = material.uniforms;
    u.uBuild!.value = build.current;
    u.uOpen!.value = open;
    u.uPicked!.value = mode === 'build' && !free && picked !== null ? picked : -1;
    u.uFirst!.value = mode === 'build' && !free && picked === null && shown.length === 0 ? FIRST_SLOT : -1;
    const taken = u.uTaken!.value as number[];
    for (let i = 0; i < SLOTS; i += 1) taken[i] = shown.some((b) => b.slot === i) ? 1 : 0;
  });

  const glows = useMemo(
    () =>
      shown.flatMap((b) => {
        if (!b.link) return [];
        const read = reads[linkKey(b.link)]?.read;
        const signal = read?.state === 'ok' ? read.view.signal : null;
        // Linked: a little light. Read and doing well: mint and brighter. Read and in danger: red. Nothing invented.
        const [color, power] = signal === 'value' ? [PALETTE.mint, 1.3] : signal === 'danger' ? [PALETTE.flare, 0.9] : [PALETTE.amber, read?.state === 'ok' ? 0.6 : 0.35];
        return [{ slot: b.slot, color, power }];
      }),
    [shown, reads],
  );

  return (
    <>
      <instancedMesh ref={pads} args={[geometry, material, SLOTS]} frustumCulled={false} renderOrder={2} />
      <EngineGlow lot={lot} glows={glows} />
      {shown.map((b) => {
          const c = slotCentre(lot, b.slot);
          const drop = landing?.slot === b.slot ? landing.at : landed?.slot === b.slot ? landed.at : null;
          const read = b.link ? reads[linkKey(b.link)]?.read : null;
          const signal: Signal = read?.state === 'ok' ? read.view.signal : null;
          return (
            <QuarterBuilding key={`${b.slot}:${b.kind}`} kind={b.kind} level={b.level} modules={b.modules} seed={seedOf(`${me?.quarter.id ?? ''}:${b.slot}`)} signal={signal} x={c.x} z={c.z} facing={lot.facing} droppedAt={drop} />
          );
        })}
      {mode === 'build' &&
        !free &&
        shown.map((b) => {
          // With a sheet open, only its building keeps its sign: the sheet says the rest.
          if (!onEngine(b.kind) || landing?.slot === b.slot || (picked !== null && picked !== b.slot)) return null;
          const c = slotCentre(lot, b.slot);
          return <BuildingTag key={`tag:${b.slot}`} x={c.x} y={TERRACE_TOP + heightOf(b.kind, b.level, b.modules) + 0.7} z={c.z} link={b.link} read={b.link ? (reads[linkKey(b.link)] ?? null) : null} />;
        })}
    </>
  );
}

type Standing = Pick<Building, 'slot' | 'kind' | 'level' | 'modules' | 'link'>;

/** What stands on the lot: the kept buildings, and the one on its way down when its plot is still free. */
function standing(buildings: readonly Building[], landing: Landing | null): Standing[] {
  const list: Standing[] = buildings.map(({ slot, kind, level, modules, link }) => ({ slot, kind, level, modules, link }));
  if (landing && !list.some((b) => b.slot === landing.slot)) {
    // A building's level is one plus its floors, as the world counts it.
    const floors = landing.modules.filter((m) => m.startsWith('floor.')).length;
    list.push({ slot: landing.slot, kind: landing.kind, level: 1 + floors, modules: landing.modules, link: null });
  }
  return list;
}

type Glow = { slot: number; color: string; power: number };

/** A soft light on the ground under each building on the engine: one instanced draw for the whole lot. */
function EngineGlow({ lot, glows }: { lot: Lot; glows: readonly Glow[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(SLOTS * 4), 4));
    return { geometry, material: createHaloMaterial() };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const attr = geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    glows.forEach((g, i) => {
      const c = slotCentre(lot, g.slot);
      m.setMatrixAt(i, matrix.makeScale(PLOT * 1.5, 1, PLOT * 1.5).setPosition(c.x, PAD_Y + 0.01, c.z));
      color.set(g.color);
      attr.setXYZW(i, color.r, color.g, color.b, g.power);
    });
    m.count = glows.length;
    m.instanceMatrix.needsUpdate = true;
    attr.needsUpdate = true;
    m.computeBoundingSphere();
  }, [lot, glows, geometry]);
  return <instancedMesh ref={mesh} args={[geometry, material, SLOTS]} frustumCulled={false} renderOrder={2} visible={glows.length > 0} />;
}
