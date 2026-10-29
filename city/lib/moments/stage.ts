import { create } from 'zustand';
import { requestFrame } from '../capture.ts';
import { useCity } from '../city/store.ts';
import type { CitySnapshot } from '../market/types.ts';
import { runLive } from '../run/bus.ts';
import { useRun } from '../run/store.ts';
import { dayKey } from '../run/world.ts';
import { challengeUrl } from './challenge.ts';
import { chipFor, cityFonts, composeMomentCard, drawChrome, drawCover, drawEndCard, drawFooter, drawRunClock, drawShade, drawSlab, footnoteFor, markImage, platePicture, type Fonts } from './draw.ts';
import { dayLabel, momentFromRun, type Moment } from './moment.ts';
import { CLIP, ClipRecorder, clipCodec, type DrawClip } from './recorder.ts';

/**
 * The director. A city moment is filmed by staging it in the live city: the camera flies to its tower, the city
 * plays the moment's own effect (fireworks, a flare, a tower growing from the ground), and the clip carries the
 * moment's real figure, source and time. A run is filmed while it is played — only its last seconds are kept — so
 * a record is ready to share the moment the result shows.
 */

export type Made = {
  moment: Moment;
  /** The 9:16 MP4, or null where this browser cannot encode video. */
  clip: Blob | null;
  /** The 4:5 PNG card for X. */
  card: Blob | null;
  /** The clip's frame at the moment's peak, for the preview. */
  hero: HTMLCanvasElement | null;
};

export type Sheet = { kind: 'list' } | { kind: 'share'; made: Made; link: string | null } | null;

type State = {
  /** Moments of this visit worth a clip, newest first. */
  moments: Moment[];
  /** The last finished run, filmed. */
  run: Made | null;
  /** While a moment is being filmed: how far, out of how long. */
  filming: { moment: Moment; progress: number } | null;
  sheet: Sheet;
};

export const useMoments = create<State>(() => ({ moments: [], run: null, filming: null, sheet: null }));

/** Adds moments to the list (another line's events go through here too); the same happening is listed once. */
export function addMoments(...list: (Moment | null)[]) {
  const fresh = list.filter((m): m is Moment => !!m);
  if (!fresh.length) return;
  useMoments.setState((s) => {
    const seen = new Set(s.moments.map((m) => m.id));
    const added = fresh.filter((m) => !seen.has(m.id));
    return added.length ? { moments: [...added.reverse(), ...s.moments].slice(0, 12) } : s;
  });
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** `promise`, or null once `signal` aborts: a step that never answers (a frame in a hidden tab, an encoder) cannot hold the filming. */
function until<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<T | null>((resolve, reject) => {
    const stop = () => resolve(null);
    signal.addEventListener('abort', stop, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', stop);
        reject(error);
      },
    );
  });
}

function snapshotOf(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext('2d')?.drawImage(canvas, 0, 0);
  return copy;
}

/** The camera's flight to the tower, the moment itself, and the end card. */
const FLY = 1.7;
const HOLD = 4.3;
const END = 1.5;
const SLAB_Y = 0.62;

/** However slow the device, a filming ends this long after it starts: the HUD always comes back. */
const DEADLINE_MS = (FLY + HOLD + END) * 1000 + 12_000;

let busy = false;
/** The filming under way, so any screen (the HUD's logo, the filming bar, the drafts desk) can stop it. */
let current: AbortController | null = null;

export function isFilming() {
  return busy;
}

/** Stops the clip being filmed, if any; the city and its HUD come back at once. */
export function cancelFilming() {
  current?.abort();
}

/**
 * Films a city moment: about seven and a half seconds, 9:16, then the card for X. The camera flies to the tower and
 * the city plays the moment; the visitor's own camera comes back after. Resolves to null if another clip is being
 * made, the moment's tower is not in the city, or the filming was cancelled.
 */
export async function filmMoment(m: Moment, signal?: AbortSignal): Promise<Made | null> {
  if (busy || useRun.getState().phase !== 'off') return null;
  const city = useCity.getState();
  const towers = city.layout.towers;
  const target = (m.towerId && towers.find((t) => t.tower.id === m.towerId)) || (m.kind === 'war' ? [...towers].sort((a, b) => b.height - a.height)[0] : undefined);
  if (!target) return null;
  busy = true;
  const own = new AbortController();
  current = own;
  const outer = () => own.abort();
  signal?.addEventListener('abort', outer, { once: true });
  if (signal?.aborted) own.abort();
  const deadline = setTimeout(() => own.abort(), DEADLINE_MS);
  try {
    const ready = await until(Promise.all([cityFonts(), markImage(), clipCodec()]), own.signal);
    if (!ready) return null;
    const [fonts, logo, codec] = ready;
    let hero: HTMLCanvasElement | null = null;
    const paint = (ctx: CanvasRenderingContext2D, source: CanvasImageSource | null, sw: number, sh: number, t: number) => {
      drawCover(ctx, source, sw, sh);
      drawShade(ctx);
      drawChrome(ctx, fonts, logo, chipFor(m));
      drawSlab(ctx, fonts, m, (t - FLY - 0.1) / 0.45, CLIP.height * SLAB_Y);
      drawFooter(ctx, fonts, footnoteFor(m));
    };
    const draw: DrawClip = (ctx, source, t) => {
      paint(ctx, source, source?.width ?? 0, source?.height ?? 0, t);
      if (!hero && t >= FLY + 1.2) hero = snapshotOf(ctx.canvas);
    };
    const rec = codec ? new ClipRecorder(codec, draw) : null;
    useMoments.setState({ filming: { moment: m, progress: 0 } });
    const started = performance.now();
    const total = FLY + HOLD + END;
    const tick = setInterval(() => useMoments.setState({ filming: { moment: m, progress: Math.min(1, (performance.now() - started) / 1000 / total) } }), 100);
    try {
      const stop = own.signal;
      city.select(target.tower.id);
      rec?.start();
      await wait(FLY * 1000, stop);
      if (stop.aborted) return null;
      useCity.getState().play({ kind: m.fx, towerId: target.tower.id, symbol: m.symbol ? m.symbol.replace(/^\$/, '') : '', value: m.figure, title: m.kicker });
      await wait(1200, stop);
      // The card's frame: the city at the moment's peak, at the screen's own resolution.
      const frame = await until(requestFrame(), stop);
      if (!frame) return null;
      await wait((HOLD - 1.2) * 1000, stop);
      if (stop.aborted) return null;
      rec?.stop();
      const plate = platePicture(frame, frame.width, frame.height, CLIP.width, CLIP.height);
      if (rec) await until(rec.append(END, (ctx, _source, t) => drawEndCard(ctx, fonts, logo, plate, m, t / (END * 0.7))), stop);
      if (stop.aborted) return null;
      const clip = rec ? await until(rec.finish(), stop) : null;
      if (stop.aborted) return null;
      if (rec && !clip && process.env.NODE_ENV !== 'production') console.warn('clip not made:', rec.reason || `${Math.round(rec.seconds * 10) / 10} s filmed`);
      if (!hero) {
        // No encoder here: the preview is drawn once from the card's frame.
        const c = document.createElement('canvas');
        c.width = CLIP.width;
        c.height = CLIP.height;
        const ctx = c.getContext('2d');
        if (ctx) paint(ctx, frame, frame.width, frame.height, FLY + 2);
        hero = c;
      }
      const card = await until(composeMomentCard(frame, frame.width, frame.height, m, fonts), stop);
      if (stop.aborted) return null;
      return { moment: m, clip, card, hero };
    } finally {
      clearInterval(tick);
      rec?.close();
      useMoments.setState({ filming: null });
      if (useCity.getState().selectedId === target.tower.id) useCity.getState().select(null);
    }
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', outer);
    if (current === own) current = null;
    busy = false;
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Runs                                                                                              */
/* ------------------------------------------------------------------------------------------------ */

/** Seconds of a run kept for its clip: the last stretch, the finish line and the glide to the skyline. */
const KEEP = 12;
const RUN_END = 1.6;

type Filming = { rec: ClipRecorder | null; fonts: Fonts; logo: HTMLImageElement | null; finishAt: number | null; frame: HTMLCanvasElement | null; attempt: number };

let filming: Filming | null = null;
/** The last run's clip while it is being finished (its end card and file take a moment). */
let finishing: Promise<void> | null = null;

/** Waits for the last run's clip, at most `ms`. */
export function runClipReady(ms = 4000): Promise<Made | null> {
  const done = finishing ?? Promise.resolve();
  return Promise.race([done, wait(ms)]).then(() => useMoments.getState().run);
}

function drawRun(f: Filming): DrawClip {
  return (ctx, source, t) => {
    const run = useRun.getState();
    drawCover(ctx, source, source?.width ?? 0, source?.height ?? 0);
    drawShade(ctx);
    const day = run.course?.day ?? dayKey();
    drawChrome(ctx, f.fonts, f.logo, `SKYLINE RUN · ${dayLabel(day)}`);
    const result = run.result;
    if (result?.status === 'finish' && f.finishAt === null) f.finishAt = t;
    if (f.finishAt === null || !result) {
      drawRunClock(ctx, f.fonts, runLive.t, runLive.progress);
      return;
    }
    const m = momentFromRun({ time: result.time, newBest: result.newBest, form: run.form, day, course: run.course?.id ?? '' });
    if (m) drawSlab(ctx, f.fonts, m, (t - f.finishAt - 0.2) / 0.45, CLIP.height * SLAB_Y);
    drawFooter(ctx, f.fonts, footnoteFor({ kind: 'record', source: 'Skyline Run' }));
  };
}

/** Development only: the screenshot scripts film runs even on a machine that draws the city in software. */
const filmAnyway = () => process.env.NODE_ENV !== 'production' && !!(window as Window & { __filmEveryRun?: boolean }).__filmEveryRun;

async function beginRun(attempt: number) {
  filming?.rec?.close();
  filming = null;
  // Filming is a luxury: never on a device that is already struggling for frames, nor on a data saver.
  const saver = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (!filmAnyway() && (useCity.getState().quality === 'low' || saver)) return;
  const [codec, fonts, logo] = await Promise.all([clipCodec(), cityFonts(), markImage()]);
  const run = useRun.getState();
  if (!codec || run.attempt !== attempt || (run.phase !== 'countdown' && run.phase !== 'running')) return;
  const f: Filming = { rec: null, fonts, logo, finishAt: null, frame: null, attempt };
  try {
    f.rec = new ClipRecorder(codec, drawRun(f), KEEP);
  } catch {
    return;
  }
  filming = f;
  f.rec.start();
}

async function endRun(f: Filming) {
  const run = useRun.getState();
  const result = run.result;
  const rec = f.rec;
  if (!rec || !result || result.status !== 'finish' || rec.failed) {
    rec?.close();
    return;
  }
  rec.stop();
  const day = run.course?.day ?? dayKey();
  const moment = momentFromRun({ time: result.time, newBest: result.newBest, form: run.form, day, course: run.course?.id ?? '' });
  if (!moment) {
    rec.close();
    return;
  }
  const hero = snapshotOf(rec.canvas);
  const frame = f.frame;
  const plate = frame ? platePicture(frame, frame.width, frame.height, CLIP.width, CLIP.height) : hero;
  await rec.append(RUN_END, (ctx, _source, t) => drawEndCard(ctx, f.fonts, f.logo, plate, moment, t / (RUN_END * 0.7)));
  const clip = await rec.finish();
  const card = await composeMomentCard(frame, frame?.width ?? 0, frame?.height ?? 0, moment, f.fonts);
  // A newer run has started meanwhile: this one is history.
  if (useRun.getState().attempt !== f.attempt) return;
  useMoments.setState({ run: { moment, clip, card, hero } });
}

/** Films every run in the background; returns the function that stops watching. */
export function watchRuns(): () => void {
  return useRun.subscribe((s, prev) => {
    if (s.phase === 'countdown' && (prev.phase !== 'countdown' || s.attempt !== prev.attempt)) {
      useMoments.setState({ run: null });
      void beginRun(s.attempt);
    }
    if (s.phase === 'ending' && prev.phase === 'running' && s.result?.status === 'finish') {
      const f = filming;
      // The card's frame: the finish line, a beat after it is crossed.
      setTimeout(() => {
        void requestFrame().then((frame) => {
          if (f) f.frame = frame;
        });
      }, 500);
    }
    if (s.phase === 'result' && prev.phase === 'ending' && filming) {
      const f = filming;
      filming = null;
      finishing = endRun(f).catch(() => {});
    }
    if (s.phase === 'off' && prev.phase !== 'off' && filming) {
      filming.rec?.close();
      filming = null;
    }
    // A device that drops to the lowest quality stops filming, so the run keeps its frames.
    if (filming && useCity.getState().quality === 'low' && !filmAnyway()) {
      filming.rec?.close();
      filming = null;
    }
  });
}

/** The challenge link for the last finished run: the time, the form, the course's day, its world and the run. */
export async function runChallengeLink(origin = location.origin): Promise<string | null> {
  const run = useRun.getState();
  const last = run.last;
  const course = run.course;
  const world: CitySnapshot | null = run.world;
  if (!last || !course || !world) return null;
  try {
    return await challengeUrl(origin, { beat: last.time, form: course.form, day: course.day, world: { kind: 'embedded', world }, ghost: last.ghost });
  } catch {
    // The time alone still challenges: the friend runs their own city of the day.
    return `${origin}/?form=${course.form}&beat=${last.time.toFixed(1)}`;
  }
}
