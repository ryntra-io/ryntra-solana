import { streamFrames } from '../capture.ts';
import { PALETTE } from '../palette.ts';

/**
 * The moment of a trade, as a clip made from the city itself: the camera arrives at your tower, the tower takes your
 * colour and throws fireworks, the amount counts up, and the clip ends on the mark and the address. 4:5 at 1080×1350
 * fills a phone and an X feed. The words on it are the trade's own figures read back from the chain; nothing else.
 */
export type MomentWords = Readonly<{
  kicker: string;
  amount: number;
  decimals: number;
  unit: string;
  line: string;
  colour: string;
  /** The figure's shortening as the card wrote it (K, M, B): the clip counts up to 266 and writes 266K. */
  suffix?: string;
}>;

export type Moment = Readonly<{ video: Blob | null; still: Blob | null; type: string | null }>;

const W = 1080;
const H = 1350;
const SECONDS = 6;
/** When the city plays its fireworks, in seconds from the start. */
export const MOMENT_BEATS = [0.9, 2.5] as const;
/** Where the camera puts a city tower it flies to, across the frame: a little left of centre. */
export const TOWER_FOCUS = 0.47;

const TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

function recorderType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const fade = (t: number, from: number, length = 0.35) => ease((t - from) / length);

/** The mark (the Sol Spire through the Eclipse) drawn at `size` with its top-left at x, y. */
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const k = size / 64;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  const ring = ctx.createLinearGradient(13, 53, 51, 15);
  ring.addColorStop(0, '#9945FF');
  ring.addColorStop(0.65, '#C9A2FF');
  ring.addColorStop(1, '#FFE7C2');
  ctx.lineWidth = 4.2;
  ctx.strokeStyle = ring;
  ctx.beginPath();
  ctx.arc(32, 34, 19, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#0B0A14';
  ctx.beginPath();
  ctx.arc(32, 34, 16.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFF6E6';
  ctx.beginPath();
  ctx.arc(45.6, 20.4, 2.6, 0, Math.PI * 2);
  ctx.fill();
  const spire = ctx.createLinearGradient(0, 60, 0, 2);
  spire.addColorStop(0, '#FFB23F');
  spire.addColorStop(1, '#FFF6E6');
  ctx.fillStyle = spire;
  ctx.beginPath();
  ctx.moveTo(32, 2);
  ctx.lineTo(37.2, 30);
  ctx.lineTo(36.2, 60);
  ctx.lineTo(27.8, 60);
  ctx.lineTo(26.8, 30);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function amountText(value: number, decimals: number, suffix = ''): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
}

/**
 * The figure the trade card wrote ("1,234", "12.4K", "0.000041") as a number the clip can count up to, its places
 * and its shortening. A figure that does not read as a number counts nothing (0) rather than writing NaN on the clip.
 */
export function momentFigure(got: string | null): { amount: number; decimals: number; suffix: string } {
  const m = got?.trim().match(/^(\d[\d,]*)(?:\.(\d+))?([KMB]?)$/);
  if (!m) return { amount: 0, decimals: 0, suffix: '' };
  const amount = Number(`${m[1]!.replace(/,/g, '')}${m[2] ? `.${m[2]}` : ''}`);
  return Number.isFinite(amount) ? { amount, decimals: Math.min(m[2]?.length ?? 0, 20), suffix: m[3] ?? '' } : { amount: 0, decimals: 0, suffix: '' };
}

/**
 * The part of the scene's frame a clip frame shows at `t` seconds: 4:5, a slow push-in over the clip, centred
 * across on `focus` (0 the left edge, 1 the right) as far as the frame allows. Null for a frame with no area.
 */
export function cropOf(width: number, height: number, t: number, focus: number = TOWER_FOCUS): { sx: number; sy: number; sw: number; sh: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  // A slow push-in over the whole clip, so the still city still moves.
  const zoom = 1 + 0.06 * ease(t / SECONDS);
  const scale = Math.max(W / width, H / height) * zoom;
  const sw = W / scale;
  const sh = H / scale;
  const across = Number.isFinite(focus) ? Math.min(1, Math.max(0, focus)) : TOWER_FOCUS;
  const sx = Math.min(Math.max(width * across - sw / 2, 0), width - sw);
  const sy = Math.min(Math.max(height * 0.5 - sh / 2, 0), height - sh);
  return { sx, sy, sw, sh };
}

/** One frame of the clip: the scene, cropped to 4:5 around its subject (`focus`), and the words. */
function paint(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement | null, t: number, words: MomentWords, display: string, ui: string, focus: number = TOWER_FOCUS) {
  ctx.fillStyle = PALETTE.inkDeep;
  ctx.fillRect(0, 0, W, H);
  const crop = source ? cropOf(source.width, source.height, t, focus) : null;
  if (source && crop) ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H);
  const top = ctx.createLinearGradient(0, 0, 0, 260);
  top.addColorStop(0, 'rgba(6,5,12,0.78)');
  top.addColorStop(1, 'rgba(6,5,12,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 260);
  const bottom = ctx.createLinearGradient(0, H * 0.5, 0, H);
  bottom.addColorStop(0, 'rgba(6,5,12,0)');
  bottom.addColorStop(0.6, 'rgba(6,5,12,0.78)');
  bottom.addColorStop(1, 'rgba(6,5,12,0.96)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, H * 0.5, W, H * 0.5);

  // The impact: a brief white flash on the second volley.
  const flash = Math.max(0, 1 - Math.abs(t - MOMENT_BEATS[1] - 0.15) / 0.22);
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,246,230,${0.32 * flash})`;
    ctx.fillRect(0, 0, W, H);
  }

  // The mark and the name, always.
  drawMark(ctx, 64, 52, 64);
  ctx.fillStyle = PALETTE.ice;
  ctx.font = `900 46px ${display}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('RYNTRA', 146, 90);

  ctx.textBaseline = 'alphabetic';
  const k = fade(t, 1.3);
  if (k > 0) {
    ctx.globalAlpha = k;
    ctx.fillStyle = words.colour;
    ctx.font = `900 44px ${display}`;
    ctx.fillText(words.kicker.toUpperCase(), 72, H - 420 + (1 - k) * 24);
    ctx.globalAlpha = 1;
  }
  const n = fade(t, 1.5, 1.4);
  if (n > 0) {
    const shown = amountText(words.amount * n, words.decimals, words.suffix);
    ctx.font = `900 150px ${display}`;
    ctx.fillStyle = PALETTE.ice;
    let size = 150;
    while (ctx.measureText(shown).width > W - 144 && size > 60) {
      size -= 8;
      ctx.font = `900 ${size}px ${display}`;
    }
    ctx.fillText(shown, 72, H - 270);
    ctx.font = `900 64px ${display}`;
    ctx.fillStyle = PALETTE.amber;
    ctx.globalAlpha = n;
    ctx.fillText(words.unit, 72, H - 196);
    ctx.globalAlpha = 1;
  }
  const l = fade(t, 3.1);
  if (l > 0) {
    ctx.globalAlpha = l;
    ctx.font = `700 36px ${ui}`;
    ctx.fillStyle = 'rgba(238,241,255,0.82)';
    ctx.fillText(words.line, 72, H - 134);
    ctx.globalAlpha = 1;
  }
  const r = fade(t, 4.2);
  if (r > 0) {
    ctx.globalAlpha = r;
    ctx.fillStyle = PALETTE.amber;
    ctx.fillRect(72, H - 86, 54, 6);
    ctx.font = `800 30px ${display}`;
    ctx.fillStyle = PALETTE.ice;
    ctx.fillText('EVERY COIN IS A TOWER · RYNTRA.IO', 146, H - 74);
    ctx.globalAlpha = 1;
  }
}

/**
 * Records the moment while the city plays it. `onBeat(i)` is called at each beat so the caller can fire the city's
 * effects; the clip keeps going if no frame arrives (a hidden tab) and returns only the still then. `focus`, read on
 * every frame, says where across the frame the subject stands (a building in my quarter); without it the crop sits
 * where the camera puts a city tower.
 */
export async function recordMoment(words: MomentWords, onBeat: (beat: number) => void, options: { focus?: () => number | null } = {}): Promise<Moment> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { video: null, still: null, type: null };
  const css = getComputedStyle(document.documentElement);
  const display = css.getPropertyValue('--font-display').trim() || 'system-ui';
  const ui = css.getPropertyValue('--font-ui').trim() || 'system-ui';

  const type = recorderType();
  const chunks: Blob[] = [];
  let recorder: MediaRecorder | null = null;
  if (type && typeof canvas.captureStream === 'function') {
    recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 8_000_000 });
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
  }

  const started = performance.now();
  let last: HTMLCanvasElement | null = null;
  let still: Blob | null = null;
  let beat = 0;
  const elapsed = () => (performance.now() - started) / 1000;
  const stop = streamFrames((frame) => {
    last = frame;
    paint(ctx, frame, elapsed(), words, display, ui, options.focus?.() ?? TOWER_FOCUS);
  });
  // A clock of its own, so the words and beats run even when the scene draws slowly.
  const clock = window.setInterval(() => {
    const t = elapsed();
    while (beat < MOMENT_BEATS.length && t >= MOMENT_BEATS[beat]!) onBeat(beat++);
    if (!last) paint(ctx, null, t, words, display, ui);
  }, 33);
  recorder?.start(250);

  await new Promise((resolve) => setTimeout(resolve, 4800));
  still = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  await new Promise((resolve) => setTimeout(resolve, (SECONDS - 4.8) * 1000));

  window.clearInterval(clock);
  stop();
  if (!recorder) return { video: null, still, type: null };
  const done = new Promise<void>((resolve) => (recorder!.onstop = () => resolve()));
  recorder.stop();
  await done;
  const video = chunks.length ? new Blob(chunks, { type: type! }) : null;
  return { video, still, type };
}

/**
 * A moment's subject the city's camera does not fly to: a building in my quarter that carries the coin. The scene
 * that draws it says where it stands across the frame (`focus`, 0 the left edge, 1 the right, null off screen) and
 * throws its fireworks (`burst`). Registered by that scene while it is on screen; the trade card asks by mint.
 */
export type MomentSubject = Readonly<{ focus: () => number | null; burst: (colour: string) => void }>;
let subjects: ((mint: string) => MomentSubject | null) | null = null;

export function setMomentSubjects(find: ((mint: string) => MomentSubject | null) | null) {
  subjects = find;
}

export function momentSubject(mint: string): MomentSubject | null {
  return subjects ? subjects(mint) : null;
}

/** The file name and extension for a clip of this type. */
export function clipName(symbol: string, type: string | null): string {
  const ext = type?.startsWith('video/mp4') ? 'mp4' : 'webm';
  return `ryntra-${symbol.replace(/^\$/, '').toLowerCase()}.${ext}`;
}

// Development hook: lets the screenshot scripts film a moment without a trade.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __recordMoment: recordMoment });
