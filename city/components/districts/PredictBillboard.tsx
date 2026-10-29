'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useCity } from '@/city/lib/city/store';
import { PREDICT_OPEN } from '@/city/lib/districts/predict/flag';
import { chance, headSide, type Market } from '@/city/lib/districts/predict/markets';
import { BOARD, BOARD_FACING, BOARD_ISLET, BOARD_SPOT } from '@/city/lib/districts/predict/place';
import { usePredict } from '@/city/lib/districts/predict/store';
import { PALETTE } from '@/city/lib/palette';
import { quarterStore } from '@/city/lib/quarter/store';
import { useRun } from '@/city/lib/run/store';
import { openPredictions } from './PredictDockItem';

const TEX_W = 1024;
const TEX_H = Math.round((TEX_W * BOARD.height) / BOARD.width);

/**
 * The Predictions district in the city, once it is open: a billboard on its own islet over the water, its face to the
 * city. It shows the day's most traded market with its chance once the window has read the markets, and the district's
 * name until then — it reads nothing of its own. A tap on it opens the window.
 */
export function PredictBillboard() {
  if (!PREDICT_OPEN) return null;
  return <Billboard />;
}

function Billboard() {
  const top = usePredict((st) => {
    const list = st.lists.trending;
    return list?.status === 'ready' ? (list.markets[0] ?? null) : null;
  });
  const gl = useThree((s) => s.gl);
  const board = useRef<THREE.Group>(null);
  const parts = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const glow = (hex: string, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false, fog: false });
    return {
      canvas,
      texture,
      face: new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, fog: false }),
      plane: new THREE.PlaneGeometry(BOARD.width, BOARD.height),
      frame: glow(PALETTE.amber, 2.2),
      edge: glow(PALETTE.violet, 1.6),
      dark: new THREE.MeshStandardMaterial({ color: '#15131f', roughness: 0.6, metalness: 0.5 }),
      back: new THREE.BoxGeometry(BOARD.width + 0.5, BOARD.height + 0.5, 0.35),
      barH: new THREE.BoxGeometry(BOARD.width + 0.7, 0.14, 0.14),
      barV: new THREE.BoxGeometry(0.14, BOARD.height + 0.7, 0.14),
      pylon: new THREE.CylinderGeometry(BOARD.pylon, BOARD.pylon * 1.4, BOARD.y - BOARD.height / 2, 10),
      islet: new THREE.CylinderGeometry(BOARD_ISLET, BOARD_ISLET + 0.4, 0.5, 18),
      ring: new THREE.TorusGeometry(BOARD_ISLET - 0.2, 0.06, 4, 48).rotateX(Math.PI / 2),
    };
  }, []);
  useEffect(
    () => () => {
      for (const value of Object.values(parts)) if (value && typeof (value as { dispose?: () => void }).dispose === 'function') (value as { dispose: () => void }).dispose();
    },
    [parts],
  );

  // The face is drawn again when the top market changes, and once the city's faces have loaded.
  useEffect(() => {
    let live = true;
    const draw = () => {
      if (live && paint(parts.canvas, top, faces(gl.domElement))) parts.texture.needsUpdate = true;
    };
    draw();
    void document.fonts?.ready.then(draw);
    return () => {
      live = false;
    };
  }, [parts, top, gl]);

  useFrame(({ clock }) => {
    // A slow breath, like a sign over water.
    const t = clock.elapsedTime;
    if (board.current) board.current.position.y = BOARD.y + Math.sin(t * 0.7) * 0.18;
    parts.frame.color.set(PALETTE.amber).multiplyScalar(2 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.4)));
  });

  const pylonH = BOARD.y - BOARD.height / 2;
  return (
    <group position={[BOARD_SPOT.x, 0, BOARD_SPOT.z]} rotation-y={BOARD_FACING}>
      <mesh geometry={parts.islet} material={parts.dark} position={[0, 0.25, 0]} />
      <mesh geometry={parts.ring} material={parts.edge} position={[0, 0.51, 0]} />
      <mesh geometry={parts.pylon} material={parts.dark} position={[0, pylonH / 2, 0]} />
      <group ref={board} position={[0, BOARD.y, 0]}>
        <mesh geometry={parts.back} material={parts.dark} position={[0, 0, -0.22]} />
        <mesh geometry={parts.plane} material={parts.face} />
        <mesh geometry={parts.barH} material={parts.frame} position={[0, BOARD.height / 2 + 0.3, 0]} />
        <mesh geometry={parts.barH} material={parts.edge} position={[0, -BOARD.height / 2 - 0.3, 0]} />
        <mesh geometry={parts.barV} material={parts.edge} position={[-BOARD.width / 2 - 0.3, 0, 0]} />
        <mesh geometry={parts.barV} material={parts.edge} position={[BOARD.width / 2 + 0.3, 0, 0]} />
      </group>
      <BoardTap />
    </group>
  );
}

/** The city's two faces, as the page loaded them. */
function faces(el: HTMLElement): { display: string; ui: string } {
  const style = getComputedStyle(el);
  return { display: style.getPropertyValue('--font-display').trim() || 'system-ui', ui: style.getPropertyValue('--font-ui').trim() || 'system-ui' };
}

function lines(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width) line = next;
    else {
      if (line) out.push(line);
      line = word;
      if (out.length === max) break;
    }
  }
  if (out.length < max && line) out.push(line);
  if (out.length === max && words.join(' ') !== out.join(' ')) out[max - 1] = `${out[max - 1]!.replace(/\s*\S+$/, '')}…`;
  return out.slice(0, max);
}

/** The billboard's face: the district's name, and the top market with its chance once it is read. */
function paint(canvas: HTMLCanvasElement, top: Market | null, face: { display: string; ui: string }): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const W = canvas.width;
  const H = canvas.height;
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1b1530');
  bg.addColorStop(1, '#0b0a14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const haze = ctx.createRadialGradient(W * 0.1, 0, 0, W * 0.1, 0, W * 0.8);
  haze.addColorStop(0, 'rgba(255,122,31,0.22)');
  haze.addColorStop(1, 'rgba(255,122,31,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, W, H);

  const pad = 64;
  // The kicker: the trend mark and the district's name.
  ctx.strokeStyle = '#FFA34A';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255,122,31,0.8)';
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.moveTo(pad, pad + 64);
  ctx.lineTo(pad + 34, pad + 30);
  ctx.lineTo(pad + 58, pad + 54);
  ctx.lineTo(pad + 100, pad + 10);
  ctx.moveTo(pad + 70, pad + 10);
  ctx.lineTo(pad + 100, pad + 10);
  ctx.lineTo(pad + 100, pad + 40);
  ctx.stroke();
  ctx.fillStyle = '#FFA34A';
  ctx.font = `900 64px ${face.display}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('PREDICT', pad + 132, pad + 38);
  ctx.shadowBlur = 0;

  if (!top) {
    ctx.fillStyle = '#EEF1FF';
    ctx.font = `800 118px ${face.ui}`;
    ctx.fillText('Live markets', pad, H * 0.5);
    // A chance rising, in the market's mint.
    ctx.strokeStyle = '#22D68E';
    ctx.lineWidth = 9;
    ctx.shadowColor = 'rgba(34,214,142,0.9)';
    ctx.shadowBlur = 22;
    ctx.beginPath();
    const base = H - pad - 20;
    const pts = [0, 0.18, 0.1, 0.34, 0.26, 0.5, 0.44, 0.7, 0.62, 0.86];
    pts.forEach((v, i) => {
      const x = pad + ((W - pad * 2) * i) / (pts.length - 1);
      const y = base - v * 120;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
    return true;
  }
  const side = headSide(top);
  ctx.fillStyle = '#EEF1FF';
  ctx.font = `800 64px ${face.ui}`;
  ctx.textBaseline = 'alphabetic';
  lines(ctx, top.title, W - pad * 2, 2).forEach((l, i) => ctx.fillText(l, pad, pad + 170 + i * 74));

  const y = H - pad - 30;
  ctx.fillStyle = '#22D68E';
  ctx.font = `900 120px ${face.display}`;
  const big = chance(side.p);
  ctx.fillText(big, pad, y);
  const wBig = ctx.measureText(big).width;
  ctx.fillStyle = 'rgba(238,241,255,0.7)';
  ctx.font = `700 46px ${face.ui}`;
  ctx.fillText(top.binary ? 'chance' : side.label, pad + wBig + 22, y - 6);

  // The split bar.
  const barY = H - pad + 4;
  const barW = W - pad * 2;
  const k = Math.max(0.03, Math.min(0.97, side.p));
  ctx.fillStyle = '#22D68E';
  ctx.beginPath();
  ctx.roundRect(pad, barY, barW * k - 6, 14, 7);
  ctx.fill();
  ctx.fillStyle = top.binary ? '#FF5F6D' : 'rgba(238,241,255,0.18)';
  ctx.beginPath();
  ctx.roundRect(pad + barW * k + 6, barY, barW * (1 - k) - 6, 14, 7);
  ctx.fill();
  return true;
}

/** A tap on the billboard opens the window; the tap is not passed on, so no tower behind it gets picked. */
function BoardTap() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    const r = BOARD.width / 2 + 0.6;
    box.set(new THREE.Vector3(BOARD_SPOT.x - r, 0, BOARD_SPOT.z - r), new THREE.Vector3(BOARD_SPOT.x + r, BOARD.y + BOARD.height / 2 + 1, BOARD_SPOT.z + r));
    let down: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || useRun.getState().phase !== 'off' || quarterStore.getState().mode !== 'city') return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 350) return;
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectBox(box, hit)) return;
      e.stopImmediatePropagation();
      if (usePredict.getState().open) return;
      useCity.getState().select(null);
      openPredictions();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [gl, camera]);
  return null;
}
