'use client';

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { hallShown, useHall } from '@/city/lib/launch/hall-store';
import type { HallBoardId, HallView } from '@/city/lib/launch/hall';
import { hallSignsPlan, MAST_Z, SIGN } from '@/city/lib/launch/hall-signs';
import { placeSign } from '@/city/lib/launch/hall-tap';
import { BOARD_NAMES, BOARD_WORDS, figureText, spanText } from '@/city/lib/launch/hall-words';
import { wordsNow } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { cityFonts } from '@/city/lib/moments/draw';
import { PALETTE } from '@/city/lib/palette';
import { LAUNCH } from './words';

/**
 * The Hall of Fame in the city: two billboard masts on the plaza, one each side of the Sol Spire and clear of it, their
 * signs facing the establishing shot. Billboards are neutral structures — never hung on a coin's tower, where they
 * would read as a word about that coin. A sign stands only on a board with a leader (CITY-241, `hall-signs.ts`): its
 * board's name, the span its rows are of («This week», «This month», «All time» — a quiet week reaches back, CITY-230),
 * the leader's number, its coin and one word for what the number is — nothing small; the table, the details and an
 * empty board's «Launch yours» are the panel's (`HallLayer`). A mast stands only under a sign, as tall as its top
 * sign. A tap on a sign opens the panel on that board (`hall-tap.ts`).
 */

const MAST_W = 0.6;
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
      // One unit tall from the ground: each mast is scaled to its own top sign.
      mast: new THREE.BoxGeometry(MAST_W, 1, MAST_W).translate(0, 0.5, 0),
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
  const plan = hallSignsPlan(view);
  if (!plan.signs.length) return null;
  return (
    <group>
      {plan.masts.map((mast) => (
        <group key={mast.x} position={[mast.x, 0, MAST_Z]}>
          <mesh geometry={parts.mast} material={parts.dark} position={[0, 0, -0.5]} scale={[1, mast.top, 1]} />
          <mesh geometry={parts.cap} material={parts.tip} position={[0, mast.top + 0.25, -0.5]} />
        </group>
      ))}
      {plan.signs.map((sign) => (
        <group key={sign.board} position={[sign.x, sign.y, MAST_Z]} rotation-y={-Math.sign(sign.x) * 0.08}>
          {/* The back plate is where a tap meets the sign. */}
          <mesh geometry={parts.back} material={parts.dark} position={[0, 0, -0.14]} ref={(mesh) => placeSign(sign.board, mesh)} />
          <mesh geometry={parts.light} material={parts.edge} position={[0, -SIGN.h / 2 - 0.12, 0.02]} />
          <Face view={view} board={sign.board} stub={stub} geometry={parts.sign} />
        </group>
      ))}
    </group>
  );
}

function Face({ view, board, stub, geometry }: { view: HallView; board: HallBoardId; stub: boolean; geometry: THREE.PlaneGeometry }) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  // A sign is drawn in the language on screen, and drawn again when it changes.
  const lang = useLang();
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
  }, [view, board, stub, lang]);
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

/** The sign's outline: a plate with two chamfered corners, the HUD's cut. */
function plate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cut: number) {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

/**
 * One sign: its board's name, the span its rows are of, the leader's number, its coin and one word for what the number
 * is. Drawn only for a board with a leader (`hallSignsPlan`): never an empty sign, never a figure that is not the
 * engine's.
 */
function drawSign(ctx: CanvasRenderingContext2D, fonts: Fonts, view: HallView, board: HallBoardId, stub: boolean) {
  const { w, h } = TEX;
  const cut = 44;
  const pad = 56;
  ctx.save();
  plate(ctx, 0, 0, w, h, cut);
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
    ctx.fillText(wordsNow(LAUNCH).signStub, w - pad, 94);
    ctx.textAlign = 'left';
  }

  const shown = view.boards[board];
  const lead = shown.rows[0];
  if (!lead) return;

  /* The span the rows are of: the week, or how far a quiet week reached back. */
  ctx.fillStyle = PALETTE.amber;
  font(ctx, 800, 36, fonts.ui, false, 5);
  ctx.fillText(spanText(shown.span).toUpperCase(), pad, 154);

  ctx.fillStyle = PALETTE.mint;
  fit(ctx, figureText(lead.figure).value, pad, 390, w - pad * 2, 900, 220, fonts.display, true);
  ctx.fillStyle = PALETTE.ice;
  fit(ctx, `$${lead.coin.symbol} · ${BOARD_WORDS[board]}`, pad, h - 92, w - pad * 2, 700, 64, fonts.ui, false);
}
