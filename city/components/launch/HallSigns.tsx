'use client';

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { HallBoardId, HallView } from '@/city/lib/launch/hall';
import { hallShown, useHall } from '@/city/lib/launch/hall-store';
import { BOARD_NAMES, BOARD_WORDS, EMPTY_SHORT, figureText, shownBoards } from '@/city/lib/launch/hall-words';
import { cityFonts } from '@/city/lib/moments/draw';
import { PALETTE } from '@/city/lib/palette';

/**
 * The Hall of Fame in the city: two billboard towers on the plaza, one each side of the Sol Spire and clear of it,
 * each carrying two signs that face the establishing shot. Billboards are neutral structures — never hung on a coin's
 * tower, where they would read as a word about that coin. Each sign shows its board's name, the lead number, its coin
 * and one word for what the number is — nothing small; the table and the details are the panel's (`HallLayer`). A
 * board without a public source has no sign.
 */

const SIGN = { w: 12.8, h: 8 } as const;
const MAST = { w: 0.6, top: 70 } as const;
/** The two towers stand at the plaza's front edge, x ±13, so the signs clear the spire and rise over the core. */
const TOWERS = [-13, 13] as const;
const TOWER_Z = 5.5;
const SIGNS: ReadonlyArray<Readonly<{ board: HallBoardId; x: number; y: number }>> = [
  { board: 'catch', x: TOWERS[0], y: 65 },
  { board: 'hunters', x: TOWERS[1], y: 65 },
  { board: 'creators', x: TOWERS[0], y: 56 },
  { board: 'scouts', x: TOWERS[1], y: 56 },
];
/** Drawn below the bloom's threshold, so the words stay sharp; the edge light alone glows. */
const INK_LEVEL = 0.6;
const TEX = { w: 1024, h: 640 } as const;

export function HallSigns() {
  const view = useHall((st) => (hallShown(st) ? st.view : null));
  const stub = useHall((st) => st.stub);
  if (!view) return null;
  return <Signs view={view} stub={stub} />;
}

function Signs({ view, stub }: { view: HallView; stub: boolean }) {
  const parts = useMemo(
    () => ({
      mast: new THREE.BoxGeometry(MAST.w, MAST.top, MAST.w),
      sign: new THREE.PlaneGeometry(SIGN.w, SIGN.h),
      back: new THREE.BoxGeometry(SIGN.w + 0.3, SIGN.h + 0.3, 0.22),
      light: new THREE.BoxGeometry(SIGN.w + 0.3, 0.12, 0.12),
      cap: new THREE.BoxGeometry(1, 0.6, 1),
      dark: new THREE.MeshStandardMaterial({ color: PALETTE.graphite, roughness: 0.6, metalness: 0.3 }),
      edge: new THREE.MeshBasicMaterial({ color: PALETTE.amber, toneMapped: false }),
      tip: new THREE.MeshBasicMaterial({ color: PALETTE.violet, toneMapped: false }),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const part of Object.values(parts)) part.dispose();
    },
    [parts],
  );
  const shown = shownBoards(view);
  return (
    <group>
      {TOWERS.map((x) => (
        <group key={x} position={[x, 0, TOWER_Z]}>
          <mesh geometry={parts.mast} material={parts.dark} position={[0, MAST.top / 2, -0.5]} />
          <mesh geometry={parts.cap} material={parts.tip} position={[0, MAST.top + 0.25, -0.5]} />
        </group>
      ))}
      {SIGNS.filter((sign) => shown.includes(sign.board)).map((sign) => (
        <group key={sign.board} position={[sign.x, sign.y, TOWER_Z]} rotation-y={-Math.sign(sign.x) * 0.08}>
          <mesh geometry={parts.back} material={parts.dark} position={[0, 0, -0.14]} />
          <mesh geometry={parts.light} material={parts.edge} position={[0, -SIGN.h / 2 - 0.12, 0.02]} />
          <Face view={view} board={sign.board} stub={stub} geometry={parts.sign} />
        </group>
      ))}
    </group>
  );
}

function Face({ view, board, stub, geometry }: { view: HallView; board: HallBoardId; stub: boolean; geometry: THREE.PlaneGeometry }) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    let live = true;
    let made: THREE.CanvasTexture | null = null;
    void cityFonts().then((fonts) => {
      if (!live) return;
      const canvas = document.createElement('canvas');
      canvas.width = TEX.w;
      canvas.height = TEX.h;
      drawSign(canvas.getContext('2d')!, fonts, view, board, stub);
      made = new THREE.CanvasTexture(canvas);
      made.colorSpace = THREE.SRGBColorSpace;
      made.anisotropy = 4;
      setTexture(made);
    });
    return () => {
      live = false;
      made?.dispose();
    };
  }, [view, board, stub]);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, color: new THREE.Color(INK_LEVEL, INK_LEVEL, INK_LEVEL) }), []);
  useEffect(() => {
    material.map = texture;
    material.needsUpdate = true;
  }, [material, texture]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} visible={texture !== null} />;
}

type Fonts = Awaited<ReturnType<typeof cityFonts>>;

function font(ctx: CanvasRenderingContext2D, weight: number, size: number, family: string, wide: boolean, spacing = 0) {
  ctx.font = `${weight} ${size}px ${family}`;
  if ('fontStretch' in ctx) ctx.fontStretch = wide ? 'expanded' : 'normal';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
}

/** Text that shrinks until it fits the width. */
function fit(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, weight: number, size: number, family: string, wide: boolean) {
  let s = size;
  font(ctx, weight, s, family, wide);
  while (ctx.measureText(text).width > max && s > 18) font(ctx, weight, (s -= 4), family, wide);
  ctx.fillText(text, x, y);
}

/** One sign: its board's name, the lead number, its coin and one word for what the number is — or «None this week». */
function drawSign(ctx: CanvasRenderingContext2D, fonts: Fonts, view: HallView, board: HallBoardId, stub: boolean) {
  const { w, h } = TEX;
  const cut = 44;
  const pad = 56;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cut, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, h - cut);
  ctx.lineTo(w - cut, h);
  ctx.lineTo(0, h);
  ctx.lineTo(0, cut);
  ctx.closePath();
  const ground = ctx.createLinearGradient(0, 0, w, h);
  ground.addColorStop(0, '#191230');
  ground.addColorStop(1, PALETTE.inkDeep);
  ctx.fillStyle = ground;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(153, 69, 255, 0.75)';
  ctx.stroke();
  ctx.restore();

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PALETTE.warmWhite;
  font(ctx, 800, 40, fonts.ui, false, 6);
  ctx.fillText(BOARD_NAMES[board].toUpperCase(), pad, 96);
  if (stub) {
    font(ctx, 800, 28, fonts.ui, false, 4);
    ctx.fillStyle = PALETTE.amber;
    ctx.textAlign = 'right';
    ctx.fillText('STUB DATA', w - pad, 94);
    ctx.textAlign = 'left';
  }

  const lead = view.boards[board].rows[0];
  if (!lead) {
    /* The honest empty sign: never a figure. */
    ctx.fillStyle = PALETTE.ice;
    fit(ctx, EMPTY_SHORT.toUpperCase(), pad, 360, w - pad * 2, 900, 120, fonts.display, true);
    return;
  }

  ctx.fillStyle = PALETTE.mint;
  fit(ctx, figureText(lead.figure).value, pad, 370, w - pad * 2, 900, 220, fonts.display, true);
  ctx.fillStyle = PALETTE.ice;
  fit(ctx, `$${lead.coin.symbol} · ${BOARD_WORDS[board]}`, pad, h - 92, w - pad * 2, 700, 64, fonts.ui, false);
}
