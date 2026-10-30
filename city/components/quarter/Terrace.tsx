'use client';

import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useCity, type Quality } from '@/city/lib/city/store';
import { useWords } from '@/city/lib/i18n/dict';
import { useMoments } from '@/city/lib/moments/stage';
import { PALETTE } from '@/city/lib/palette';
import { defaultModules, isKind, isLevel, renderBuilding } from '@/city/lib/quarter/kit';
import { SLOTS, lotAt, lotNumber, lotOf, slotCentre, streetLamps, streetName, streetOf, type Lot } from '@/city/lib/quarter/plot';
import { useQuarter } from '@/city/lib/quarter/store';
import type { QuarterSketch } from '@/city/lib/quarter/types';
import { useRun } from '@/city/lib/run/store';
import { AFAR, TERRACE_TOP } from './afar';
import { createBeaconMaterial, createHaloMaterial, createLampMaterial } from './materials';
import { BUILDING_SCALE, seedOf } from './QuarterBuilding';
import q from './quarter.module.css';
import { QUARTER } from './words';

/**
 * What lives on the newcomers' terrace besides this visitor's own quarter: the neighbours' buildings, the lamp posts
 * of every lived-in street, the beacon and the name over my quarter that find it from the city's view, and on a desk
 * a small name over a neighbour's quarter under the mouse. Everything many is instanced; nothing allocates a frame.
 */

/** At most this many neighbours' buildings for each quality of the scene: a mid phone keeps its frame. */
const NEIGHBOUR_BUDGET: Record<Quality, number> = { high: 720, mid: 360, low: 140 };

/** Neither a run nor a filming wants the terrace's signs over its own picture. */
function useQuiet(): boolean {
  const running = useRun((s) => s.phase !== 'off');
  const filming = useMoments((s) => s.filming !== null);
  const mode = useQuarter((s) => s.mode);
  return running || filming || mode !== 'city';
}

type Standing = { key: string; kind: Parameters<typeof renderBuilding>[0]; level: 1 | 2 | 3 | 4 | 5; seed: number; x: number; z: number; facing: 1 | -1 };

/** The neighbours' buildings, drawn by the terrace's one kit (the KitWorld this stands in), nearest the island first. */
export function Neighbours({ quarters }: { quarters: readonly QuarterSketch[] }) {
  const quality = useCity((s) => s.quality);
  const budget = NEIGHBOUR_BUDGET[quality];
  const standing = useMemo(() => {
    const list: Standing[] = [];
    const ordered = [...quarters].sort((a, b) => a.cell.z - b.cell.z || a.cell.x - b.cell.x);
    for (const quarter of ordered) {
      const lot = lotOf(quarter.cell);
      for (const b of quarter.buildings) {
        if (list.length >= budget) return list;
        if (!isKind(b.kind) || !Number.isInteger(b.slot) || b.slot < 0 || b.slot >= SLOTS) continue;
        const c = slotCentre(lot, b.slot);
        list.push({ key: `${quarter.id}:${b.slot}`, kind: b.kind, level: isLevel(b.level) ? b.level : 1, seed: seedOf(`${quarter.id}:${b.slot}`), x: c.x, z: c.z, facing: lot.facing });
      }
    }
    return list;
  }, [quarters, budget]);
  return (
    <>
      {standing.map((b) => (
        <group key={b.key} position={[b.x, TERRACE_TOP, b.z]} rotation-y={b.facing === 1 ? 0 : Math.PI} scale={BUILDING_SCALE}>
          {renderBuilding(b.kind, b.level, defaultModules(b.kind, b.level), { seed: b.seed })}
        </group>
      ))}
    </>
  );
}

const POST = { width: 0.13, height: 1.9, head: 0.3, headHeight: 0.12 };

/** Lamp posts along both pavements of every lived-in street, and the light they pool on the ground. Two draw calls. */
export function TerraceLamps({ occupied }: { occupied: readonly number[] }) {
  const quality = useCity((s) => s.quality);
  const spots = useMemo(() => occupied.flatMap((row) => streetLamps(row)), [occupied]);
  const capacity = Math.max(1, spots.length);
  const posts = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);

  const post = useMemo(() => {
    const pole = new THREE.BoxGeometry(POST.width, POST.height, POST.width).translate(0, POST.height / 2, 0);
    const head = new THREE.BoxGeometry(POST.head, POST.headHeight, POST.head).translate(0, POST.height + POST.headHeight / 2, 0);
    pole.setAttribute('aLit', new THREE.Float32BufferAttribute(new Float32Array(pole.getAttribute('position').count), 1));
    head.setAttribute('aLit', new THREE.Float32BufferAttribute(new Float32Array(head.getAttribute('position').count).fill(1), 1));
    const merged = mergeGeometries([pole, head])!;
    pole.dispose();
    head.dispose();
    return merged;
  }, []);
  const pool = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    return g;
  }, [capacity]);
  useEffect(() => () => pool.dispose(), [pool]);
  const materials = useMemo(() => ({ post: createLampMaterial(), pool: createHaloMaterial() }), []);
  useEffect(
    () => () => {
      post.dispose();
      materials.post.dispose();
      materials.pool.dispose();
    },
    [post, materials],
  );

  useLayoutEffect(() => {
    const p = posts.current;
    const l = pools.current;
    if (!p || !l) return;
    const m = new THREE.Matrix4();
    const colors = pool.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    const warm = new THREE.Color(PALETTE.amber).lerp(new THREE.Color(PALETTE.warmWhite), 0.3);
    spots.forEach((s, i) => {
      p.setMatrixAt(i, m.makeTranslation(s.x, TERRACE_TOP, s.z));
      l.setMatrixAt(i, m.makeScale(5.2, 1, 5.2).setPosition(s.x, TERRACE_TOP + 0.02, s.z));
      colors.setXYZW(i, warm.r, warm.g, warm.b, 0.42);
    });
    p.count = spots.length;
    l.count = spots.length;
    p.instanceMatrix.needsUpdate = true;
    l.instanceMatrix.needsUpdate = true;
    colors.needsUpdate = true;
    p.computeBoundingSphere();
    l.computeBoundingSphere();
  }, [spots, pool]);

  return (
    <>
      <instancedMesh key={`p${capacity}`} ref={posts} args={[post, materials.post, capacity]} visible={spots.length > 0} />
      <instancedMesh key={`l${capacity}`} ref={pools} args={[pool, materials.pool, capacity]} renderOrder={2} visible={spots.length > 0 && quality !== 'low'} />
    </>
  );
}

const HIDDEN = { visibility: 'hidden' } as const;

const BEACON = { height: 30, bottom: 1.1, top: 2.6 };

/**
 * My quarter from the city's view: a soft column of amber light over the lot and a sign with its place — the
 * owner's short name when they gave one, else «Your quarter». Both step aside while the quarter is built.
 */
export function MyMark({ lot }: { lot: Lot }) {
  const me = useQuarter((s) => s.me);
  const w = useWords(QUARTER);
  const quiet = useQuiet();
  const geometry = useMemo(() => new THREE.CylinderGeometry(BEACON.top, BEACON.bottom, BEACON.height, 28, 1, true).translate(0, BEACON.height / 2, 0), []);
  const material = useMemo(() => createBeaconMaterial(), []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame(() => {
    material.uniforms.uShow!.value = AFAR.afar.value;
  });
  if (!me) return null;
  const name = me.resident.displayName?.trim();
  const place = w.address(streetName(me.quarter.street || streetOf(me.quarter.cell.z)), lotNumber(me.quarter.cell));
  return (
    <>
      <mesh geometry={geometry} material={material} position={[lot.x, TERRACE_TOP, lot.z]} renderOrder={3} frustumCulled={false} />
      {/* Kept mounted and hidden when quiet: a sign's own root is never torn down in the middle of a render. */}
      <Html position={[lot.x, TERRACE_TOP + 11, lot.z]} center zIndexRange={[3, 0]} pointerEvents="none" className={q.tagWrap} style={quiet ? HIDDEN : undefined}>
        <div className={q.mark}>
          <span className={q.markTitle}>{name || w.yourQuarter}</span>
          <span className={q.markLine}>{place}</span>
        </div>
      </Html>
    </>
  );
}

/** At most this often a moving mouse asks which lot is under it. */
const HOVER_MS = 60;

/**
 * On a desk, a neighbour's quarter under the mouse gets a small sign with its place and level; nothing on a touch
 * screen, nothing over my own quarter (its own sign says it), nothing while a quarter is built.
 */
export function NeighbourHover({ quarters, streets, mine }: { quarters: readonly QuarterSketch[]; streets: number; mine: string | null }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const quiet = useQuiet();
  const w = useWords(QUARTER);
  // The last neighbour found stays in the sign while it is hidden, so the sign is moved, never torn down.
  const [hover, setHover] = useState<{ quarter: QuarterSketch | null; on: boolean }>({ quarter: null, on: false });
  const byCell = useMemo(() => new Map(quarters.filter((x) => x.id !== mine).map((x) => [`${x.cell.x}:${x.cell.z}`, x])), [quarters, mine]);
  const live = useRef({ byCell, streets, quiet });
  live.current = { byCell, streets, quiet };

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
    const el = gl.domElement;
    const setHovered = (found: QuarterSketch | null) =>
      setHover((before) => (found ? (before.on && before.quarter?.id === found.id ? before : { quarter: found, on: true }) : before.on ? { ...before, on: false } : before));
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TERRACE_TOP);
    const hit = new THREE.Vector3();
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let x = 0;
    let y = 0;
    const pick = () => {
      timer = null;
      last = performance.now();
      const now = live.current;
      if (now.quiet || !now.byCell.size) return setHovered(null);
      const rect = el.getBoundingClientRect();
      ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const cell = raycaster.ray.intersectPlane(plane, hit) ? lotAt(hit.x, hit.z, now.streets) : null;
      const found = cell ? (now.byCell.get(`${cell.x}:${cell.z}`) ?? null) : null;
      setHovered(found);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      x = e.clientX;
      y = e.clientY;
      if (e.buttons !== 0) return setHovered(null);
      if (!timer) timer = setTimeout(pick, Math.max(0, HOVER_MS - (performance.now() - last)));
    };
    const onLeave = () => setHovered(null);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      if (timer) clearTimeout(timer);
    };
  }, [gl, camera]);

  const shown = hover.quarter;
  if (!shown) return null;
  const lot = lotOf(shown.cell);
  return (
    <Html position={[lot.x, TERRACE_TOP + 6, lot.z]} center zIndexRange={[2, 0]} pointerEvents="none" className={q.tagWrap} style={!hover.on || quiet ? HIDDEN : undefined}>
      <div className={`${q.tag} ${q.tagNeighbour}`}>
        <span className={q.tagLine}>
          {w.address(streetName(shown.street || streetOf(shown.cell.z)), lotNumber(shown.cell))}
          <i>{w.levelTag(shown.level)}</i>
        </span>
      </div>
    </Html>
  );
}
