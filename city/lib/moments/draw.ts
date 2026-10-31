import { BRAND } from '../brand.ts';
import { PALETTE } from '../palette.ts';
import { sourceTime, type Accent, type Moment } from './moment.ts';

/**
 * Everything a clip or a card draws over the city, in the city's own type (Hubot Sans wide for the big words, Mona
 * Sans for the rest) and its four lights on ink. One drawing for both: the clip at 720 × 1280 and the card for X at
 * 1080 × 1350 scale the same layout by the canvas width.
 */

export type Fonts = { display: string; ui: string };

export const ACCENT: Record<Accent, string> = { mint: PALETTE.mint, amber: PALETTE.amber, flare: PALETTE.flare, violet: '#C9A2FF' };

const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 64 64"><defs><linearGradient id="r" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9945FF"/><stop offset="0.65" stop-color="#C9A2FF"/><stop offset="1" stop-color="#FFE7C2"/></linearGradient><linearGradient id="s" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FFB23F"/><stop offset="1" stop-color="#FFF6E6"/></linearGradient></defs><circle cx="32" cy="34" r="19" fill="none" stroke="url(#r)" stroke-width="4.2"/><circle cx="32" cy="34" r="16.6" fill="#0B0A14"/><path d="M32 2 L37.2 30 L36.2 60 L27.8 60 L26.8 30 Z" fill="url(#s)"/><path d="M32 2 L34.2 30 L33.4 60 L30.6 60 L29.8 30 Z" fill="#FFFFFF" opacity="0.35"/></svg>`;

let mark: Promise<HTMLImageElement | null> | null = null;

/** The mark as an image a canvas can draw (a data address: the page's policy allows it, and it never taints). */
export function markImage(): Promise<HTMLImageElement | null> {
  mark ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(MARK_SVG)}`;
  });
  return mark;
}

/** The page's own faces (next/font puts their family names in CSS variables on the city's root), loaded before drawing. */
export async function cityFonts(): Promise<Fonts> {
  const root = document.querySelector('main') ?? document.documentElement;
  const style = getComputedStyle(root);
  const display = style.getPropertyValue('--font-display').trim() || 'system-ui, sans-serif';
  const ui = style.getPropertyValue('--font-ui').trim() || 'system-ui, sans-serif';
  try {
    await Promise.race([
      Promise.all([document.fonts.load(`900 40px ${display}`), document.fonts.load(`800 20px ${ui}`), document.fonts.load(`600 20px ${ui}`)]),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch {
    // The fallback faces still draw.
  }
  return { display, ui };
}

type Ctx = CanvasRenderingContext2D;

function setFont(ctx: Ctx, weight: number, size: number, family: string, wide: boolean, spacing = 0) {
  ctx.font = `${weight} ${Math.round(size)}px ${family}`;
  if ('fontStretch' in ctx) ctx.fontStretch = wide ? 'expanded' : 'normal';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
}

/** Big words shrink until they fit the width. */
function fitFont(ctx: Ctx, text: string, max: number, weight: number, size: number, family: string, min: number): number {
  let s = size;
  setFont(ctx, weight, s, family, true);
  while (ctx.measureText(text).width > max && s > min) {
    s -= 4;
    setFont(ctx, weight, s, family, true);
  }
  return s;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Ease out with a small overshoot, like the HUD's cut-in. */
const backOut = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

/** The frame, cropped to cover the canvas, centred: the camera keeps the moment's tower in the middle. */
export function drawCover(ctx: Ctx, source: CanvasImageSource | null, sw: number, sh: number) {
  const { width: W, height: H } = ctx.canvas;
  ctx.fillStyle = PALETTE.inkDeep;
  ctx.fillRect(0, 0, W, H);
  if (!source || !sw || !sh) return;
  const scale = Math.max(W / sw, H / sh);
  const cw = W / scale;
  const ch = H / scale;
  ctx.drawImage(source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, W, H);
}

/** Dark at the top and the bottom, so the words read over a bright skyline. */
export function drawShade(ctx: Ctx) {
  const { width: W, height: H } = ctx.canvas;
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.2);
  top.addColorStop(0, 'rgba(6,5,12,0.78)');
  top.addColorStop(1, 'rgba(6,5,12,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.2);
  const bottom = ctx.createLinearGradient(0, H * 0.52, 0, H);
  bottom.addColorStop(0, 'rgba(6,5,12,0)');
  bottom.addColorStop(0.6, 'rgba(6,5,12,0.72)');
  bottom.addColorStop(1, 'rgba(6,5,12,0.94)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, H * 0.52, W, H * 0.48);
}

/** The mark and the name, top left; the source and its time, top right. */
export function drawChrome(ctx: Ctx, fonts: Fonts, logo: HTMLImageElement | null, chip: string) {
  const W = ctx.canvas.width;
  const u = W / 720;
  const y = 64 * u;
  if (logo) ctx.drawImage(logo, 36 * u, y - 30 * u, 56 * u, 56 * u);
  ctx.fillStyle = PALETTE.ice;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  setFont(ctx, 900, 28 * u, fonts.display, true, 1.8 * u);
  const name = BRAND.name.toUpperCase();
  ctx.fillText(name, (logo ? 102 : 40) * u, y);
  const room = W - 36 * u - ((logo ? 102 : 40) * u + ctx.measureText(name).width + 74 * u);
  if (chip) {
    // The chip never reaches the name: smaller type first, then without the day.
    let size = 17;
    let text = chip;
    setFont(ctx, 800, size * u, fonts.ui, false, 2 * u);
    while (ctx.measureText(text).width > room && size > 13) setFont(ctx, 800, --size * u, fonts.ui, false, 1.5 * u);
    if (ctx.measureText(text).width > room) text = chip.replace(/ · [A-Z]{3} \d{1,2}(?= · )/, '');
    const w = Math.min(ctx.measureText(text).width, room);
    const x = W - 36 * u - w;
    ctx.fillStyle = 'rgba(11,10,20,0.72)';
    ctx.fillRect(x - 34 * u, y - 20 * u, w + 52 * u, 40 * u);
    ctx.fillStyle = PALETTE.amber;
    ctx.beginPath();
    ctx.arc(x - 17 * u, y, 5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(238,241,255,0.86)';
    ctx.fillText(text, x, y + 1 * u, w);
  }
  ctx.letterSpacing = '0px';
}

/** The moment's slab, in like the HUD's cut-in: the accent bar, the kicker, the big title, the figure. */
export function drawSlab(ctx: Ctx, fonts: Fonts, m: Pick<Moment, 'kicker' | 'title' | 'figure' | 'accent'>, k: number, y: number) {
  if (k <= 0) return;
  const W = ctx.canvas.width;
  const u = W / 720;
  const e = backOut(clamp01(k));
  const accent = ACCENT[m.accent];
  const h = 236 * u;
  ctx.save();
  ctx.globalAlpha = clamp01(k * 3);
  ctx.translate((1 - e) * -W * 0.45, 0);
  // The slab: dark glass with a slanted right edge.
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(8,7,15,0.94)');
  grad.addColorStop(0.75, 'rgba(20,14,38,0.9)');
  grad.addColorStop(1, 'rgba(20,14,38,0.55)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(W * 0.96, y);
  ctx.lineTo(W * 0.96 - 34 * u, y + h);
  ctx.lineTo(0, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 26 * u;
  ctx.fillStyle = accent;
  ctx.fillRect(0, y, 12 * u, h);
  ctx.shadowBlur = 0;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const x = 44 * u;
  setFont(ctx, 800, 22 * u, fonts.ui, false, 6 * u);
  ctx.fillStyle = accent;
  ctx.fillText(m.kicker, x, y + 50 * u);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = PALETTE.ice;
  fitFont(ctx, m.title, W * 0.86 - x, 900, 104 * u, fonts.display, 44 * u);
  ctx.fillText(m.title, x, y + 156 * u);
  setFont(ctx, 800, 25 * u, fonts.ui, false, 1.2 * u);
  ctx.fillStyle = accent;
  fitText(ctx, m.figure, x, y + 204 * u, W * 0.86 - x);
  ctx.restore();
  ctx.letterSpacing = '0px';
}

/** Text squeezed horizontally if it would run past the width, never cut. */
function fitText(ctx: Ctx, text: string, x: number, y: number, max: number) {
  const w = ctx.measureText(text).width;
  if (w <= max) ctx.fillText(text, x, y);
  else ctx.fillText(text, x, y, max);
}

/** The bottom line: where the city lives and the hook; a market moment also says where the data comes from. */
export function drawFooter(ctx: Ctx, fonts: Fonts, line: string) {
  const { width: W, height: H } = ctx.canvas;
  const u = W / 720;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.amber;
  ctx.fillRect(40 * u, H - 92 * u, 44 * u, 5 * u);
  setFont(ctx, 900, 30 * u, fonts.display, true, 1.2 * u);
  ctx.fillStyle = PALETTE.ice;
  ctx.fillText(BRAND.domain.toUpperCase(), 40 * u, H - 46 * u);
  const domain = ctx.measureText(BRAND.domain.toUpperCase()).width;
  setFont(ctx, 700, 18 * u, fonts.ui, false, 1.5 * u);
  ctx.fillStyle = 'rgba(238,241,255,0.62)';
  fitText(ctx, BRAND.hook.toUpperCase(), 40 * u + domain + 22 * u, H - 48 * u, W - domain - 100 * u);
  if (line) {
    setFont(ctx, 600, 15 * u, fonts.ui, false, 0.5 * u);
    ctx.fillStyle = 'rgba(238,241,255,0.45)';
    ctx.fillText(line, 40 * u, H - 112 * u);
  }
  ctx.letterSpacing = '0px';
}

/** The run's clock while a record is filmed: the time and the line of progress, top centre. */
export function drawRunClock(ctx: Ctx, fonts: Fonts, time: number, progress: number) {
  const W = ctx.canvas.width;
  const u = W / 720;
  const m = Math.floor(time / 60);
  const s = time - m * 60;
  const text = `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  setFont(ctx, 900, 58 * u, fonts.display, true);
  ctx.fillStyle = PALETTE.ice;
  ctx.shadowColor = 'rgba(6,5,12,0.9)';
  ctx.shadowBlur = 18 * u;
  ctx.fillText(text, W / 2, 170 * u);
  ctx.shadowBlur = 0;
  const bw = 300 * u;
  ctx.fillStyle = 'rgba(238,241,255,0.18)';
  ctx.fillRect(W / 2 - bw / 2, 190 * u, bw, 5 * u);
  ctx.fillStyle = PALETTE.amber;
  ctx.fillRect(W / 2 - bw / 2, 190 * u, bw * clamp01(progress), 5 * u);
  ctx.textAlign = 'left';
}

/** The city alone, cropped to the canvas: the plate the end card darkens, so no words show through it twice. */
export function platePicture(source: CanvasImageSource | null, sw: number, sh: number, width: number, height: number): HTMLCanvasElement {
  const plate = document.createElement('canvas');
  plate.width = width;
  plate.height = height;
  const ctx = plate.getContext('2d');
  if (ctx) drawCover(ctx, source, sw, sh);
  return plate;
}

/**
 * The last beat: the city darkens and the call comes up — the time to beat for a run, the moment's title
 * otherwise — with the address.
 */
export function drawEndCard(ctx: Ctx, fonts: Fonts, logo: HTMLImageElement | null, last: CanvasImageSource | null, m: Pick<Moment, 'kind' | 'title' | 'accent' | 'run'>, k: number) {
  const { width: W, height: H } = ctx.canvas;
  const u = W / 720;
  const e = clamp01(k);
  if (last) ctx.drawImage(last, 0, 0, W, H);
  ctx.fillStyle = `rgba(6,5,12,${0.2 + 0.62 * e})`;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 0.44, 0, W / 2, H * 0.44, W * 0.75);
  glow.addColorStop(0, `rgba(153,69,255,${0.28 * e})`);
  glow.addColorStop(1, 'rgba(153,69,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = clamp01((k - 0.15) * 2.2);
  const lift = (1 - clamp01((k - 0.15) * 2.2)) * 30 * u;
  if (logo) ctx.drawImage(logo, W / 2 - 64 * u, H * 0.3 - 64 * u + lift, 128 * u, 128 * u);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const call = m.kind === 'record' && m.run ? `BEAT ${m.run.time.toFixed(1)} S` : m.title;
  ctx.fillStyle = ACCENT[m.accent];
  fitFont(ctx, call, W * 0.86, 900, 96 * u, fonts.display, 40 * u);
  ctx.fillText(call, W / 2, H * 0.47 + lift);
  setFont(ctx, 900, 46 * u, fonts.display, true, 2 * u);
  ctx.fillStyle = PALETTE.ice;
  ctx.fillText(BRAND.domain.toUpperCase(), W / 2, H * 0.55 + lift);
  setFont(ctx, 700, 22 * u, fonts.ui, false, 2 * u);
  ctx.fillStyle = 'rgba(238,241,255,0.7)';
  ctx.fillText((m.kind === 'record' ? 'Skyline Run · free, no wallet' : BRAND.hook).toUpperCase(), W / 2, H * 0.6 + lift);
  ctx.restore();
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
}

/** What a moment's chip says: its source and when it happened there. */
export function chipFor(m: Pick<Moment, 'source' | 'sourceAt'>): string {
  const at = sourceTime(m.sourceAt);
  return `${m.source.toUpperCase()}${at ? ` · ${at}` : ''}`;
}

/** The small print a moment carries: coins get the data's source and the advice line. */
export function footnoteFor(m: Pick<Moment, 'kind' | 'source'>): string {
  if (m.kind === 'record') return 'Skyline Run through the frozen city of the day';
  if (m.kind === 'war') return 'Counted by actions and verified people, never by buys';
  return `${m.source === 'Jupiter' ? 'Market data: Jupiter' : `${m.source} · on Solana`} · not financial advice`;
}

/**
 * The card for X: the moment's frame with its slab, 1080 × 1350 (4:5, a phone's feed on X), as PNG.
 */
export async function composeMomentCard(frame: CanvasImageSource | null, fw: number, fh: number, m: Moment, fonts: Fonts): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const logo = await markImage();
  drawCover(ctx, frame, fw, fh);
  drawShade(ctx);
  drawChrome(ctx, fonts, logo, chipFor(m));
  drawSlab(ctx, fonts, m, 1, 1350 * 0.555);
  drawFooter(ctx, fonts, footnoteFor(m));
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}
