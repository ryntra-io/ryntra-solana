import { BRAND } from '../brand.ts';
import { ACCENT, drawChrome, drawCover, drawEndCard, drawFooter, drawShade, type Fonts } from '../moments/draw.ts';
import { PALETTE } from '../palette.ts';
import { pct, usd, type BillboardFacts } from './facts.ts';
import type { Caption, Hook, Storyboard } from './timeline.ts';

/**
 * What the studio draws over a frame of the city (CITY-38), on the moments' own chrome (`../moments/draw.ts`): the mark
 * and RYNTRA top left, the source chip top right, the hook — one big figure — under them, the captions low in the frame,
 * the footnote and the address at the bottom. Sizes are in units of a 720-wide frame, so 4:5 and 1:1 at 1080 share one
 * layout and only the height differs.
 */

type Ctx = CanvasRenderingContext2D;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;

function setFont(ctx: Ctx, weight: number, size: number, family: string, wide: boolean, spacing = 0) {
  ctx.font = `${weight} ${Math.round(size)}px ${family}`;
  if ('fontStretch' in ctx) ctx.fontStretch = wide ? 'expanded' : 'normal';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
}

/** Big words shrink until they fit. */
function fit(ctx: Ctx, text: string, max: number, weight: number, size: number, family: string, min: number, wide = true): number {
  let s = size;
  setFont(ctx, weight, s, family, wide);
  while (ctx.measureText(text).width > max && s > min) setFont(ctx, weight, (s -= 4), family, wide);
  return s;
}

const accentOf = (h: Pick<Hook, 'accent'>) => ACCENT[h.accent];

/** A heavier shade under the hook at the top: the figure reads on any skyline. */
function drawTopShade(ctx: Ctx, depth: number) {
  const { width: W } = ctx.canvas;
  const g = ctx.createLinearGradient(0, 0, 0, depth);
  g.addColorStop(0, 'rgba(6,5,12,0.82)');
  g.addColorStop(0.7, 'rgba(6,5,12,0.42)');
  g.addColorStop(1, 'rgba(6,5,12,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, depth);
}

/**
 * The hook: the kicker, one big figure, the coin and its window. In from the first frame (a slam that settles in a
 * fifth of a second), a small kick on every beat of the city, out when the end card comes.
 */
/** Where the hook stands, in units: a square frame keeps it tighter, so the tower still has the middle. */
export function hookLayout(width: number, height: number) {
  const square = height / width < 1.1;
  return square
    ? { kicker: 124, figure: 262, size: 140, title: 306, meter: 336 }
    : { kicker: 160, figure: 300, size: 176, title: 356, meter: 396 };
}

export function drawHook(ctx: Ctx, fonts: Fonts, hook: Hook, t: number, beats: readonly number[], out: number) {
  const W = ctx.canvas.width;
  const u = W / 720;
  const L = hookLayout(W, ctx.canvas.height);
  const shown = clamp01(0.45 + t / 0.12) * (1 - clamp01((t - out) / 0.25));
  if (shown <= 0) return;
  const slam = 1 + 0.22 * (1 - easeOut(t / 0.3));
  const kick = beats.reduce((k, b) => (t >= b && t < b + 0.45 ? Math.max(k, 0.07 * (1 - (t - b) / 0.45)) : k), 0);
  const accent = accentOf(hook);
  const x = 40 * u;
  ctx.save();
  ctx.globalAlpha = shown;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  // Kicker: a bar of the accent and the words in tracked capitals.
  ctx.fillStyle = accent;
  ctx.fillRect(x, (L.kicker - 24) * u, 10 * u, 30 * u);
  setFont(ctx, 800, 22 * u, fonts.ui, false, 5 * u);
  ctx.fillText(hook.kicker, x + 22 * u, L.kicker * u);
  // The figure, scaled from its left edge so it never runs off the frame.
  ctx.save();
  const base = L.figure * u;
  ctx.translate(x, base);
  ctx.scale(slam + kick, slam + kick);
  ctx.shadowColor = 'rgba(6,5,12,0.85)';
  ctx.shadowBlur = 30 * u;
  ctx.fillStyle = accent;
  fit(ctx, hook.figure, (W - 2 * x) / (slam + kick), 900, L.size * u, fonts.display, 64 * u);
  ctx.fillText(hook.figure, 0, 0);
  ctx.restore();
  // The coin, and the figure's window.
  ctx.shadowColor = 'rgba(6,5,12,0.9)';
  ctx.shadowBlur = 16 * u;
  ctx.fillStyle = PALETTE.ice;
  const title = fit(ctx, hook.title, W * 0.5, 900, 40 * u, fonts.display, 24 * u);
  ctx.fillText(hook.title, x, L.title * u);
  const titleW = ctx.measureText(hook.title).width;
  setFont(ctx, 800, 20 * u, fonts.ui, false, 2 * u);
  ctx.fillStyle = 'rgba(238,241,255,0.82)';
  const room = W - x * 2 - titleW - 22 * u;
  ctx.fillText(hook.label, x + titleW + 22 * u, L.title * u - (title - 20 * u) * 0.08, Math.max(80 * u, room));
  ctx.restore();
  ctx.letterSpacing = '0px';
}

/** The caption on screen at `t`: what is happening, in words, for a feed that plays without sound. */
export function captionAt(captions: readonly Caption[], t: number): { text: string; k: number } | null {
  const c = captions.find((x) => t >= x.from && t < x.to);
  if (!c) return null;
  const k = Math.min(clamp01((t - c.from) / 0.14), clamp01((c.to - t) / 0.14));
  return { text: c.text, k };
}

/** The caption: dark glass with a cut corner, Mona Sans, centred in the lower third. */
export function drawCaption(ctx: Ctx, fonts: Fonts, text: string, k: number) {
  if (k <= 0) return;
  const { width: W, height: H } = ctx.canvas;
  const u = W / 720;
  const y = H - 214 * u;
  ctx.save();
  ctx.globalAlpha = k;
  setFont(ctx, 700, 27 * u, fonts.ui, false, 0);
  const w = Math.min(ctx.measureText(text).width, W - 120 * u);
  const padX = 22 * u;
  const h = 54 * u;
  const left = (W - w) / 2 - padX;
  const cut = 12 * u;
  ctx.fillStyle = 'rgba(10,9,18,0.8)';
  ctx.beginPath();
  ctx.moveTo(left, y - h / 2);
  ctx.lineTo(left + w + padX * 2 - cut, y - h / 2);
  ctx.lineTo(left + w + padX * 2, y - h / 2 + cut);
  ctx.lineTo(left + w + padX * 2, y + h / 2);
  ctx.lineTo(left, y + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(153,69,255,0.45)';
  ctx.lineWidth = 1.5 * u;
  ctx.stroke();
  ctx.fillStyle = PALETTE.ice;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, y + 1 * u, W - 120 * u);
  ctx.restore();
}

/** Launch Night's curve: the meter fills to 100 %, then reads POOL. */
export function drawMeter(ctx: Ctx, fonts: Fonts, k: number, done: boolean) {
  const W = ctx.canvas.width;
  const u = W / 720;
  const x = 40 * u;
  const y = hookLayout(W, ctx.canvas.height).meter * u;
  const w = 300 * u;
  ctx.save();
  ctx.fillStyle = 'rgba(238,241,255,0.16)';
  ctx.fillRect(x, y, w, 10 * u);
  ctx.fillStyle = PALETTE.mint;
  ctx.shadowColor = PALETTE.mint;
  ctx.shadowBlur = 14 * u;
  ctx.fillRect(x, y, w * clamp01(k), 10 * u);
  ctx.shadowBlur = 0;
  setFont(ctx, 800, 18 * u, fonts.ui, false, 3 * u);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(238,241,255,0.86)';
  ctx.fillText(done ? 'POOL OPEN' : `CURVE ${Math.round(clamp01(k) * 100)}%`, x + w + 18 * u, y + 11 * u, W - x - w - 58 * u);
  ctx.restore();
  ctx.letterSpacing = '0px';
}

/** A white-hot impact: the frame flashes for a beat (a launch's light, a graduation's move into the skyline). */
export function drawFlash(ctx: Ctx, t: number, flashes: readonly number[]) {
  const f = flashes.reduce((m, at) => Math.max(m, 1 - Math.abs(t - at - 0.08) / 0.2), 0);
  if (f <= 0) return;
  const { width: W, height: H } = ctx.canvas;
  ctx.fillStyle = `rgba(255,246,230,${0.55 * f})`;
  ctx.fillRect(0, 0, W, H);
}

export type FrameParts = { fonts: Fonts; logo: HTMLImageElement | null; board: Storyboard; beats: number[]; flashes: number[] };

/**
 * One frame of a clip: the city (`plate`, cropped to this canvas already) and everything over it at time `t`.
 * From `endAt` the end card comes up over the same moving city.
 */
export function drawClipFrame(ctx: Ctx, plate: CanvasImageSource, t: number, p: FrameParts) {
  const { width: W, height: H } = ctx.canvas;
  const b = p.board;
  ctx.drawImage(plate, 0, 0, W, H);
  if (t >= b.endAt) {
    drawEndCard(ctx, p.fonts, p.logo, plate, { kind: 'launch', title: b.hook.figure, accent: b.hook.accent, run: null }, (t - b.endAt) / 0.7);
    return;
  }
  drawShade(ctx);
  drawTopShade(ctx, (hookLayout(W, H).meter + 60) * (W / 720));
  drawFlash(ctx, t, p.flashes);
  drawChrome(ctx, p.fonts, p.logo, b.chip);
  drawHook(ctx, p.fonts, b.hook, t, p.beats, b.endAt);
  if (b.meter && t >= b.meter.from - 0.2) drawMeter(ctx, p.fonts, (t - b.meter.from) / (b.meter.to - b.meter.from), t >= b.meter.to + 0.2);
  const c = captionAt(b.captions, t);
  if (c) drawCaption(ctx, p.fonts, c.text, c.k);
  drawFooter(ctx, p.fonts, b.footnote);
}

/** The city cropped to a canvas of `width` × `height`, centred where the camera keeps the tower. */
export function plateOf(frame: CanvasImageSource, fw: number, fh: number, canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (ctx) drawCover(ctx, frame, fw, fh);
  return canvas;
}

/** JUST IN: one figure over the city — the tag, the figure, what it counts — the chrome and the footnote. */
export function drawJustIn(ctx: Ctx, plate: CanvasImageSource, p: Omit<FrameParts, 'beats' | 'flashes'>) {
  const { width: W, height: H } = ctx.canvas;
  const u = W / 720;
  const h = p.board.hook;
  ctx.drawImage(plate, 0, 0, W, H);
  ctx.fillStyle = 'rgba(6,5,12,0.38)';
  ctx.fillRect(0, 0, W, H);
  drawShade(ctx);
  drawChrome(ctx, p.fonts, p.logo, p.board.chip);
  const mid = H * 0.5;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const x = 40 * u;
  // The tag: amber, the one call of the card.
  setFont(ctx, 900, 30 * u, fonts(p).display, true, 3 * u);
  const tag = h.kicker;
  const tw = ctx.measureText(tag).width;
  ctx.fillStyle = PALETTE.amber;
  ctx.fillRect(x, mid - 214 * u, tw + 36 * u, 52 * u);
  ctx.fillStyle = PALETTE.ink;
  ctx.fillText(tag, x + 18 * u, mid - 176 * u);
  ctx.letterSpacing = '0px';
  ctx.shadowColor = 'rgba(6,5,12,0.9)';
  ctx.shadowBlur = 34 * u;
  ctx.fillStyle = accentOf(h);
  fit(ctx, h.figure, W - 2 * x, 900, 196 * u, fonts(p).display, 72 * u);
  ctx.fillText(h.figure, x - 4 * u, mid + 30 * u);
  ctx.fillStyle = PALETTE.ice;
  fit(ctx, h.title, W - 2 * x, 900, 48 * u, fonts(p).display, 28 * u);
  ctx.fillText(h.title, x, mid + 96 * u);
  setFont(ctx, 800, 22 * u, fonts(p).ui, false, 2.5 * u);
  ctx.fillStyle = 'rgba(238,241,255,0.84)';
  ctx.fillText(h.label, x, mid + 140 * u, W - 2 * x);
  ctx.restore();
  ctx.letterSpacing = '0px';
  drawFooter(ctx, p.fonts, p.board.footnote);
}

const fonts = (p: { fonts: Fonts }) => p.fonts;

/** The week's billboard: the title and five towers, rank, ticker and figure, over the skyline. */
export function drawBillboard(ctx: Ctx, plate: CanvasImageSource, f: BillboardFacts, p: Omit<FrameParts, 'beats' | 'flashes'>) {
  const { width: W, height: H } = ctx.canvas;
  const u = W / 720;
  ctx.drawImage(plate, 0, 0, W, H);
  ctx.fillStyle = 'rgba(6,5,12,0.46)';
  ctx.fillRect(0, 0, W, H);
  drawShade(ctx);
  drawChrome(ctx, p.fonts, p.logo, p.board.chip);
  const x = 40 * u;
  const square = H / W < 1.1;
  const top = square ? 148 * u : 196 * u;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PALETTE.amber;
  ctx.fillRect(x, top - 26 * u, 10 * u, 30 * u);
  setFont(ctx, 800, 22 * u, p.fonts.ui, false, 5 * u);
  ctx.fillText(p.board.hook.kicker, x + 22 * u, top);
  ctx.fillStyle = PALETTE.ice;
  fit(ctx, p.board.hook.title, W - 2 * x, 900, 66 * u, p.fonts.display, 36 * u);
  ctx.fillText(p.board.hook.title, x, top + 74 * u);
  const first = top + (square ? 112 : 140) * u;
  // Five rows fit between the title and the footnote, whatever the height.
  const rowH = Math.min(96 * u, (H - 136 * u - first) / f.rows.length);
  f.rows.forEach((r, i) => {
    const y = first + i * rowH;
    // A row of dark glass with the rank in amber, the ticker, and the figure on the right.
    ctx.fillStyle = i === 0 ? 'rgba(42,22,64,0.86)' : 'rgba(10,9,18,0.72)';
    ctx.fillRect(x, y, W - 2 * x, rowH - 12 * u);
    if (i === 0) {
      ctx.fillStyle = PALETTE.amber;
      ctx.fillRect(x, y, 6 * u, rowH - 12 * u);
    }
    const mid = y + (rowH - 12 * u) / 2;
    ctx.textBaseline = 'middle';
    setFont(ctx, 900, 34 * u, p.fonts.display, true);
    ctx.fillStyle = PALETTE.amber;
    ctx.fillText(String(i + 1), x + 26 * u, mid + 2 * u);
    ctx.fillStyle = PALETTE.ice;
    fit(ctx, r.symbol, W * 0.46, 900, 36 * u, p.fonts.display, 22 * u);
    ctx.fillText(r.symbol, x + 82 * u, mid + 2 * u);
    const value = f.ranking === 'week' ? pct(r.value) : usd(r.value);
    setFont(ctx, 900, 34 * u, p.fonts.display, true);
    ctx.fillStyle = f.ranking === 'week' ? (r.value >= 0 ? PALETTE.mint : PALETTE.flare) : PALETTE.ice;
    ctx.textAlign = 'right';
    ctx.fillText(value, W - x - 24 * u, mid + 2 * u);
    ctx.textAlign = 'left';
  });
  ctx.restore();
  ctx.letterSpacing = '0px';
  drawFooter(ctx, p.fonts, p.board.footnote);
}

/** The X banner, 1500 × 500: the city itself; the word and the line low on the right, since the avatar sits lower left. */
export function drawBanner(ctx: Ctx, plate: CanvasImageSource, fonts: Fonts) {
  const { width: W, height: H } = ctx.canvas;
  ctx.drawImage(plate, 0, 0, W, H);
  const g = ctx.createLinearGradient(W * 0.45, 0, W, 0);
  g.addColorStop(0, 'rgba(6,5,12,0)');
  g.addColorStop(1, 'rgba(6,5,12,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const b = ctx.createLinearGradient(0, H * 0.55, 0, H);
  b.addColorStop(0, 'rgba(6,5,12,0)');
  b.addColorStop(1, 'rgba(6,5,12,0.6)');
  ctx.fillStyle = b;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(6,5,12,0.95)';
  ctx.shadowBlur = 28;
  ctx.fillStyle = PALETTE.ice;
  setFont(ctx, 900, 46, fonts.display, true, 2.8);
  ctx.fillText(BRAND.name.toUpperCase(), W - 56, H - 92);
  ctx.letterSpacing = '0px';
  setFont(ctx, 900, 21, fonts.display, true, 0.4);
  const domain = ` · ${BRAND.domain.toUpperCase()}`;
  const dw = ctx.measureText(domain).width;
  ctx.fillStyle = PALETTE.amber;
  ctx.fillText(domain, W - 56, H - 52);
  ctx.fillStyle = PALETTE.ice;
  ctx.fillText(BRAND.hook.replace(/\.$/, '').toUpperCase(), W - 56 - dw, H - 52);
  ctx.restore();
  ctx.letterSpacing = '0px';
}

/**
 * How the banner sits on a profile, for the person who sets it: X lays the avatar (a circle 134 px wide on a 1500
 * banner on the web, about a fifth of the height over its lower edge) over the lower left.
 */
export function drawBannerPreview(ctx: Ctx, banner: CanvasImageSource, avatar: HTMLImageElement | null) {
  const { width: W } = ctx.canvas;
  ctx.fillStyle = PALETTE.ink;
  ctx.fillRect(0, 0, W, ctx.canvas.height);
  ctx.drawImage(banner, 0, 0, W, W / 3);
  const r = W * 0.0893;
  const cx = 24 + r + W * 0.02;
  const cy = W / 3 + r * 0.05;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.ink;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) ctx.drawImage(avatar, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}
