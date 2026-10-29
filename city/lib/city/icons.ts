import * as THREE from 'three';
import { PALETTE } from '../palette.ts';

/**
 * One texture for every token logo, so all the crown signs are a single draw call. Logos come through our own
 * /api/icon/<mint> route (same origin, so WebGL may read them, SVG included), four at a time so the logo hosts
 * do not rate-limit us. Until a logo arrives — or if it never does — the slot shows a badge with the symbol.
 */
export const ATLAS_SIZE = 1024;
export const SLOT = 64;
export const SLOTS_PER_ROW = ATLAS_SIZE / SLOT;
export const MAX_SLOTS = SLOTS_PER_ROW * SLOTS_PER_ROW;
const PARALLEL = 6;

export function slotUv(slot: number): [number, number] {
  return [(slot % SLOTS_PER_ROW) / SLOTS_PER_ROW, 1 - (Math.floor(slot / SLOTS_PER_ROW) + 1) / SLOTS_PER_ROW];
}

export type IconAtlas = { texture: THREE.CanvasTexture; dispose: () => void };

/** `items` are in slot order; `first` lists the mints whose logos should load before the rest (the visible signs). */
export function createIconAtlas(items: { id: string; symbol: string; icon: string | null }[], first: ReadonlySet<string> = new Set()): IconAtlas {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  let disposed = false;
  if (!ctx) return { texture, dispose: () => texture.dispose() };

  const queue: { slot: number; id: string }[] = [];
  items.slice(0, MAX_SLOTS).forEach((item, slot) => {
    drawBadge(ctx, slot, item.symbol);
    if (item.icon) queue.push({ slot, id: item.id });
  });
  queue.sort((a, b) => Number(first.has(b.id)) - Number(first.has(a.id)));
  texture.needsUpdate = true;

  const next = () => {
    const job = queue.shift();
    if (!job || disposed) return;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (!disposed) {
        drawLogo(ctx, job.slot, img);
        texture.needsUpdate = true;
      }
      next();
    };
    img.onerror = () => next();
    img.src = `/api/icon/${job.id}`;
  };
  for (let i = 0; i < PARALLEL; i += 1) next();

  return {
    texture,
    dispose: () => {
      disposed = true;
      queue.length = 0;
      texture.dispose();
    },
  };
}

const origin = (slot: number) => [(slot % SLOTS_PER_ROW) * SLOT, Math.floor(slot / SLOTS_PER_ROW) * SLOT] as const;

function drawLogo(ctx: CanvasRenderingContext2D, slot: number, img: HTMLImageElement) {
  const [x, y] = origin(slot);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + SLOT / 2, y + SLOT / 2, SLOT / 2 - 1, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = PALETTE.ink;
  ctx.fillRect(x, y, SLOT, SLOT);
  ctx.drawImage(img, x, y, SLOT, SLOT);
  ctx.restore();
}

/** Until the logo arrives: an ink disc with the ticker in amber, quiet enough not to look like a logo. */
function drawBadge(ctx: CanvasRenderingContext2D, slot: number, symbol: string) {
  const [x, y] = origin(slot);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + SLOT / 2, y + SLOT / 2, SLOT / 2 - 1, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.ink;
  ctx.fill();
  ctx.fillStyle = PALETTE.amber;
  ctx.font = `800 ${SLOT * 0.3}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(symbol.replace(/^\$/, '').slice(0, 3).toUpperCase(), x + SLOT / 2, y + SLOT / 2 + 1);
  ctx.restore();
}
