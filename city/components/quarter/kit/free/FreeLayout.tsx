'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { PIECES, freePlots, slotOfCell, type Piece } from '@/lib/world/layout';
import { planLayout, signFace } from '@/city/lib/quarter/kit/free/fit';
import { CELL, STOREY_H, cellCentre, pieceCentre, plotOrigin } from '@/city/lib/quarter/kit/free/grid';
import { freeStore, useFree } from '@/city/lib/quarter/kit/free/store';
import { KitPlan } from '@/city/lib/quarter/kit';
import { PALETTE } from '@/city/lib/palette';
import { SLOTS, type Lot } from '@/city/lib/quarter/plot';
import { useQuarter } from '@/city/lib/quarter/store';
import { FREE_BUILD } from '@/city/lib/quarter/kit/free/switch';
import { TERRACE_TOP } from '../../afar';

/** The drop of a piece just put down: a short fall and a squash, as a building's landing but small. */
const POP = 0.32;

/**
 * My quarter's free layout on its lot, drawn through the terrace's one KitWorld: one plan per plot, about the plot's
 * centre, so from afar the kit spreads them with the plot's building. While I build freely: the grid of the free
 * plots, where the piece in hand would go (on a device that hovers), the piece I last touched, and the piece that just
 * landed dropping into place. A sign shows its words to its owner.
 */
export function FreeLayout({ lot }: { lot: Lot }) {
  return FREE_BUILD ? <FreeLayoutOpen lot={lot} /> : null;
}

function FreeLayoutOpen({ lot }: { lot: Lot }) {
  const me = useQuarter((s) => s.me);
  const pieces = useFree((s) => s.pieces);
  const fresh = useFree((s) => s.fresh);
  const on = useFree((s) => s.on);
  const quarterId = me?.quarter.id ?? null;

  // The layout is read once the quarter is on screen, not only while building: the lot shows what was made.
  useEffect(() => {
    if (quarterId) void freeStore.getState().load();
  }, [quarterId]);

  const isFresh = (p: Piece) => !!fresh && fresh.at.gx === p.gx && fresh.at.gz === p.gz && fresh.at.y === p.y;
  const slots = useMemo(() => [...new Set(pieces.map((p) => slotOfCell(p.gx, p.gz)))].sort((a, b) => a - b), [pieces]);
  const freshPiece = fresh ? (pieces.find(isFresh) ?? null) : null;

  return (
    <>
      {slots.map((slot) => (
        <PlotPieces key={slot} lot={lot} slot={slot} pieces={pieces} seed={quarterId ?? ''} skip={freshPiece} />
      ))}
      {freshPiece && fresh && <Landing key={`${fresh.t}`} lot={lot} piece={freshPiece} pieces={pieces} seed={quarterId ?? ''} t0={fresh.t} />}
      {pieces.map((p) => (p.kind === 'sign' && p.text ? <SignWords key={`${p.gx}:${p.gz}:${p.y}`} lot={lot} piece={p} /> : null))}
      {on && me && <Grid lot={lot} level={me.quarter.level} built={me.buildings.map((b) => b.slot)} />}
      {on && <Ghost lot={lot} />}
    </>
  );
}

/** A group in the lot's frame, standing on the terrace, whichever way the lot faces. */
function LotFrame({ lot, x = 0, z = 0, children }: { lot: Lot; x?: number; z?: number; children: ReactNode }) {
  return (
    <group position={[lot.x + x * lot.facing, TERRACE_TOP, lot.z + z * lot.facing]} rotation-y={lot.facing === 1 ? 0 : Math.PI}>
      {children}
    </group>
  );
}

function PlotPieces({ lot, slot, pieces, seed, skip }: { lot: Lot; slot: number; pieces: readonly Piece[]; seed: string; skip: Piece | null }) {
  const origin = plotOrigin(slot);
  const plan = useMemo(
    () => planLayout(pieces, { seed, origin, only: (p) => p !== skip && slotOfCell(p.gx, p.gz) === slot }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- origin follows slot
    [pieces, seed, slot, skip],
  );
  if (!plan.parts.length) return null;
  return (
    <LotFrame lot={lot} x={origin.x} z={origin.z}>
      <KitPlan plan={plan} />
    </LotFrame>
  );
}

/** The piece that just went down: it falls a little, squashes and settles, then joins its plot's plan. */
function Landing({ lot, piece, pieces, seed, t0 }: { lot: Lot; piece: Piece; pieces: readonly Piece[]; seed: string; t0: number }) {
  const group = useRef<THREE.Group>(null);
  const c = pieceCentre(piece);
  const plan = useMemo(() => planLayout(pieces, { seed, origin: c, only: (p) => p === piece }), [pieces, seed, piece, c.x, c.z]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = (performance.now() - t0) / 1000;
    if (t < POP * 0.45) {
      const k = t / (POP * 0.45);
      g.position.y = 0.9 * (1 - k * k);
      g.scale.set(0.9, 1.1, 0.9);
    } else if (t < POP * 1.6) {
      const k = (t - POP * 0.45) / (POP * 1.15);
      const squash = Math.sin(k * Math.PI * 2) * Math.exp(-k * 4) * 0.22;
      g.position.y = 0;
      g.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);
    } else if (g.scale.x !== 1 || g.position.y !== 0) {
      g.position.y = 0;
      g.scale.set(1, 1, 1);
      // Settled: it joins its plot's plan.
      const f = freeStore.getState().fresh;
      if (f && f.t === t0) freeStore.setState({ fresh: null });
    }
  });
  return (
    <LotFrame lot={lot} x={c.x} z={c.z}>
      <group ref={group} position-y={0.9}>
        <KitPlan plan={plan} />
      </group>
    </LotFrame>
  );
}

/** A sign's words, drawn on a small canvas in Geist on the city's ink, in front of its board. */
function SignWords({ lot, piece }: { lot: Lot; piece: Piece }) {
  const text = piece.text ?? '';
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 192;
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.fillStyle = PALETTE.ink;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = PALETTE.warmWhite;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 104;
    const font = (s: number) => `800 ${s}px Geist, "Mona Sans", system-ui, sans-serif`;
    g.font = font(size);
    while (g.measureText(text).width > canvas.width - 48 && size > 40) g.font = font((size -= 6));
    g.shadowColor = PALETTE.amber;
    g.shadowBlur = 18;
    g.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [text]);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  const f = signFace(piece);
  return (
    <LotFrame lot={lot} x={f.x} z={f.z}>
      <mesh position-y={f.y} rotation-y={f.turn} renderOrder={3}>
        <planeGeometry args={[0.7, 0.26]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </LotFrame>
  );
}

const GRID_COLOR = new THREE.Color(PALETTE.amber);

/** The cells of the plots free building may use: thin amber lines on the terrace, one draw for the whole lot. */
function Grid({ lot, level, built }: { lot: Lot; level: number; built: number[] }) {
  const key = built.join(',');
  const geometry = useMemo(() => {
    const free = freePlots(level, built.map((slot) => ({ slot })));
    const points: number[] = [];
    for (let slot = 0; slot < SLOTS; slot += 1) {
      if (!free.has(slot)) continue;
      const o = plotOrigin(slot);
      for (let k = 0; k <= 3; k += 1) {
        const a = -1.5 * CELL + k * CELL;
        points.push(o.x + a, 0, o.z - 1.5 * CELL, o.x + a, 0, o.z + 1.5 * CELL);
        points.push(o.x - 1.5 * CELL, 0, o.z + a, o.x + 1.5 * CELL, 0, o.z + a);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `built`
  }, [level, key]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useRef<THREE.LineBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (material.current) material.current.opacity = 0.2 + Math.sin(clock.elapsedTime * 2.2) * 0.06;
  });
  return (
    <LotFrame lot={lot}>
      <lineSegments geometry={geometry} position-y={0.035} renderOrder={2}>
        <lineBasicMaterial ref={material} color={GRID_COLOR} transparent opacity={0.22} depthWrite={false} toneMapped={false} />
      </lineSegments>
    </LotFrame>
  );
}

const AMBER = new THREE.Color(PALETTE.amber).multiplyScalar(1.6);
const RED = new THREE.Color(PALETTE.flare).multiplyScalar(1.4);

/**
 * Where the piece in hand would go, snapped to its cell: a lit box of its size on a device that hovers; with the
 * eraser, the piece that would go, in red. The piece I last touched gets a thin amber square at its foot.
 */
function Ghost({ lot }: { lot: Lot }) {
  const hover = useFree((s) => s.hover);
  const tool = useFree((s) => s.tool);
  const focus = useFree((s) => s.focus);
  const box = useRef<THREE.Mesh>(null);
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), []);
  const solid = useMemo(() => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), []);
  useEffect(
    () => () => {
      edges.dispose();
      solid.dispose();
    },
    [edges, solid],
  );

  let shape: { x: number; y: number; z: number; w: number; h: number; color: THREE.Color } | null = null;
  if (hover) {
    if (tool === 'erase') {
      const p = hover.hit;
      if (p) {
        const c = pieceCentre(p);
        const n = PIECES[p.kind].size;
        shape = { x: c.x, y: p.y * STOREY_H, z: c.z, w: n * CELL * 0.98, h: PIECES[p.kind].carries ? STOREY_H : STOREY_H * 0.9, color: RED };
      }
    } else if (hover.place) {
      const n = PIECES[tool].size;
      const c = pieceCentre({ gx: hover.place.gx, gz: hover.place.gz, kind: tool });
      shape = { x: c.x, y: hover.place.y * STOREY_H, z: c.z, w: n * CELL * 0.94, h: n === 2 ? STOREY_H * 1.2 : PIECES[tool].carries ? STOREY_H : STOREY_H * 0.7, color: AMBER };
    }
  }

  useFrame(({ clock }) => {
    const m = box.current?.material as THREE.MeshBasicMaterial | undefined;
    if (m) m.opacity = 0.12 + Math.sin(clock.elapsedTime * 5) * 0.04;
  });

  const f = focus ? cellCentre(focus.gx, focus.gz) : null;
  return (
    <LotFrame lot={lot}>
      {shape && (
        <group position={[shape.x, shape.y, shape.z]} scale={[shape.w, shape.h, shape.w]}>
          <mesh ref={box} geometry={solid} renderOrder={4}>
            <meshBasicMaterial color={shape.color} transparent opacity={0.14} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
          </mesh>
          <lineSegments geometry={edges} renderOrder={4}>
            <lineBasicMaterial color={shape.color} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
          </lineSegments>
        </group>
      )}
      {f && focus && (
        <mesh position={[f.x, focus.y * STOREY_H + 0.04, f.z]} rotation-x={-Math.PI / 2} renderOrder={3}>
          <ringGeometry args={[0.5, 0.56, 4, 1, Math.PI / 4]} />
          <meshBasicMaterial color={AMBER} transparent opacity={0.85} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
    </LotFrame>
  );
}

/** The world point of a cell's centre on the terrace, for the screenshot scripts. */
export function cellOnTerrace(lot: Lot, gx: number, gz: number): { x: number; y: number; z: number } {
  const c = cellCentre(gx, gz);
  return { x: lot.x + c.x * lot.facing, y: TERRACE_TOP, z: lot.z + c.z * lot.facing };
}
