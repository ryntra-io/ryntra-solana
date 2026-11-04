import { districtFrame } from '../art/frames.ts';
import { BRAND } from '../brand.ts';
import { requestFrame } from '../capture.ts';
import { iconSource, monogram } from '../chart/icon.ts';
import type { Lang } from '../i18n/langs.ts';
import { PALETTE } from '../palette.ts';
import { cropOf, drawMark, TOWER_FOCUS } from '../trade/moment.ts';
import { cardFace, type CardFace, type CardFrame } from './card-words.ts';
import type { ShareCard } from './cards.ts';

/**
 * A launch's share card, drawn (L8 · CITY-145): 4:5 at 1080×1350, the moment card's grid (`city/lib/trade/moment.ts`,
 * the brandbook's «Картка моменту») — the mark and RYNTRA on top, the coin's own logo from the engine, the kicker, the
 * one big figure, the amber line, the quiet line and the city's line at the foot — over a frame of our own city: the
 * docks a coin is born in, the skyline it joins, or the live scene at the tap with the trader's tower in it. Nothing
 * on it is generated; the words are `card-words.ts`, the figures `cards.ts`.
 */

const W = 1080;
const H = 1350;
const X = 72;
/** How long the card waits for the city to draw a frame (a hidden tab draws none) before it takes the skyline's still. */
const FRAME_WAIT_MS = 600;
/** How long a still or a logo may take to arrive before the card goes without it. */
const IMAGE_WAIT_MS = 2_500;

/** The frames of our own city a card stands on (CITY-64): the docks where a tower is born, the skyline it joins. */
const STILLS: Readonly<Record<Exclude<CardFrame, 'live'>, string>> = {
  docks: districtFrame('launch').files.at(-1)!.src,
  skyline: districtFrame('market').files.at(-1)!.src,
};

const TONES: Readonly<Record<CardFace['tone'], string>> = { mint: PALETTE.mint, amber: PALETTE.amber, flare: PALETTE.flare };

/** The city's line at the foot, the same in every language as on the moment card: EVERY COIN IS A TOWER · RYNTRA.IO. */
export const CARD_FOOTER = `${BRAND.hook.replace(/\.$/, '')} · ${BRAND.domain}`.toUpperCase();

export type DrawOptions = Readonly<{
  /** Where the trader's tower stands across the live frame (0 the left edge, 1 the right); the camera's spot otherwise. */
  focus?: () => number | null;
}>;

/** The card as a PNG, or null when the browser cannot draw one. */
export async function drawShareCard(card: ShareCard, lang: Lang, options: DrawOptions = {}): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const face = cardFace(card, lang);
  const [frame, logo] = await Promise.all([frameOf(face.frame), card.coin.logo ? loadImage(iconSource({ id: card.coin.token, icon: 'engine' }, 0)) : Promise.resolve(null)]);
  await document.fonts?.ready;
  const css = getComputedStyle(document.documentElement);
  const fonts = { display: css.getPropertyValue('--font-display').trim() || 'system-ui', ui: css.getPropertyValue('--font-ui').trim() || 'system-ui' };
  const focus = face.frame === 'live' ? (options.focus?.() ?? TOWER_FOCUS) : 0.5;
  paint(ctx, frame, face, card.coin.symbol, logo, fonts, focus);
  return new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

/** The live frame at the tap, or our own still; the skyline's still when the live city drew nothing in time. */
async function frameOf(kind: CardFrame): Promise<CanvasImageSource & { width: number; height: number } | null> {
  if (kind !== 'live') return loadImage(STILLS[kind]);
  const live = await Promise.race([requestFrame(), wait<null>(FRAME_WAIT_MS, null)]);
  return live && live.width > 0 && live.height > 0 ? live : loadImage(STILLS.skyline);
}

/** Pictures already here, kept for the visit: a second card, or one warmed before the tap, draws at once. */
const loaded = new Map<string, Promise<HTMLImageElement | null>>();

/**
 * The two stills, fetched before the tap where a card can be shared: on a phone the share sheet must open while the tap
 * still counts, so the card should not wait on the network.
 */
export function warmCardFrames(): void {
  if (typeof Image === 'undefined') return;
  for (const src of Object.values(STILLS)) void loadImage(src);
}

function loadImage(src: string | null): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  const known = loaded.get(src);
  if (known) return known;
  const next = fetchImage(src).then((img) => {
    /* A picture that did not come is asked again next time. */
    if (!img) loaded.delete(src);
    return img;
  });
  loaded.set(src, next);
  return next;
}

function fetchImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), IMAGE_WAIT_MS);
    img.decoding = 'async';
    img.onload = () => {
      clearTimeout(timer);
      resolve(img.naturalWidth > 0 ? img : null);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

function wait<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

type Fonts = Readonly<{ display: string; ui: string }>;

function paint(ctx: CanvasRenderingContext2D, frame: (CanvasImageSource & { width: number; height: number }) | null, face: CardFace, symbol: string, logo: HTMLImageElement | null, fonts: Fonts, focus: number) {
  ctx.fillStyle = PALETTE.inkDeep;
  ctx.fillRect(0, 0, W, H);
  const crop = frame ? cropOf(frame.width, frame.height, 0, focus) : null;
  if (frame && crop) ctx.drawImage(frame, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H);

  const top = ctx.createLinearGradient(0, 0, 0, 260);
  top.addColorStop(0, 'rgba(6,5,12,0.78)');
  top.addColorStop(1, 'rgba(6,5,12,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 260);
  const bottom = ctx.createLinearGradient(0, H * 0.4, 0, H);
  bottom.addColorStop(0, 'rgba(6,5,12,0)');
  bottom.addColorStop(0.5, 'rgba(6,5,12,0.8)');
  bottom.addColorStop(1, 'rgba(6,5,12,0.97)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, H * 0.4, W, H * 0.6);

  // The mark and the name, always — where the moment card has them.
  drawMark(ctx, 64, 52, 64);
  ctx.fillStyle = PALETTE.ice;
  ctx.font = `900 46px ${fonts.display}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('RYNTRA', 146, 90);
  if (face.tag) drawTag(ctx, face.tag, fonts.display);

  ctx.textBaseline = 'alphabetic';
  const kickerTop = H - 420 - (face.kicker.length - 1) * 54;
  drawCoin(ctx, logo, symbol, kickerTop - 44 - 24 - 96, fonts.display);

  ctx.fillStyle = TONES[face.tone];
  face.kicker.forEach((line, index) => fit(ctx, line.toUpperCase(), X, kickerTop + index * 54, W - 2 * X, 44, 28, `900 {}px ${fonts.display}`));

  /* A little above the moment card's line for its figure: a multiple's decimal comma must clear the amber line under it. */
  ctx.fillStyle = PALETTE.ice;
  fit(ctx, face.hero, X, H - 286, W - 2 * X, 150, 60, `900 {}px ${fonts.display}`);

  if (face.unit) {
    ctx.fillStyle = PALETTE.amber;
    fit(ctx, face.unit, X, H - 196, W - 2 * X, 64, 36, `900 {}px ${fonts.display}`);
  }
  if (face.line) {
    ctx.fillStyle = 'rgba(238,241,255,0.82)';
    fit(ctx, face.line, X, H - 134, W - 2 * X, 36, 24, `700 {}px ${fonts.ui}`);
  }

  ctx.fillStyle = PALETTE.amber;
  ctx.fillRect(X, H - 86, 54, 6);
  ctx.fillStyle = PALETTE.ice;
  fit(ctx, CARD_FOOTER, 146, H - 74, W - 146 - X, 30, 22, `800 {}px ${fonts.display}`);
}

/** Text at its size, stepped down until it fits the width (never below `min`). `font` holds `{}` for the size. */
function fit(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, size: number, min: number, font: string) {
  let s = size;
  ctx.font = font.replace('{}', String(s));
  while (ctx.measureText(text).width > width && s > min) {
    s -= 2;
    ctx.font = font.replace('{}', String(s));
  }
  ctx.fillText(text, x, y, width);
}

/** The coin's own logo as the engine serves it, in a ring; its first letter when it has none. */
function drawCoin(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null, symbol: string, top: number, display: string) {
  const r = 48;
  const cx = X + r;
  const cy = top + r;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.ink;
  ctx.fill();
  if (logo) {
    ctx.clip();
    const scale = Math.max((2 * r) / logo.naturalWidth, (2 * r) / logo.naturalHeight);
    const w = logo.naturalWidth * scale;
    const h = logo.naturalHeight * scale;
    ctx.drawImage(logo, cx - w / 2, cy - h / 2, w, h);
  } else {
    ctx.fillStyle = PALETTE.warmWhite;
    ctx.font = `900 46px ${display}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(monogram(symbol), cx, cy + 2);
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,178,63,0.85)';
  ctx.stroke();
  ctx.restore();
}

/** DEVNET or TEST, top right, level with the name: a test card never passes for a real one. */
function drawTag(ctx: CanvasRenderingContext2D, tag: string, display: string) {
  ctx.save();
  ctx.font = `800 26px ${display}`;
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(tag).width + 36;
  const x = W - 64 - w;
  ctx.fillStyle = 'rgba(255,178,63,0.16)';
  ctx.fillRect(x, 68, w, 44);
  ctx.strokeStyle = 'rgba(255,178,63,0.7)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, 69, w - 2, 42);
  ctx.fillStyle = PALETTE.amber;
  ctx.fillText(tag, x + 18, 91);
  ctx.restore();
}

