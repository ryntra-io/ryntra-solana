import { streamFrames } from '../capture.ts';
import { useCity } from '../city/store.ts';
import type { CitySnapshot, Tower } from '../market/types.ts';
import { cityFonts, markImage, type Fonts } from '../moments/draw.ts';
import { bannerFacts, cityVolume, launchNight, newInCore, sourcesOf, towerOfHour, weekBillboard, type Facts, type JournalLike, type LaunchFacts, type Source, type Template } from './facts.ts';
import { drawBanner, drawBannerPreview, drawBillboard, drawClipFrame, drawJustIn, plateOf, type FrameParts } from './overlay.ts';
import { studioLink, studioText } from './post.ts';
import { ASPECTS, STEP_HZ, checkStoryboard, frameTimes, storyboard, type Aspect, type Cue, type Storyboard } from './timeline.ts';

/**
 * The studio (CITY-38), inside the page: picks a template's facts from the city the page shows, directs the take in the
 * live city on the studio's clock (`city/lib/x/clock.mjs`), and draws each kept frame for 4:5 and 1:1 from the
 * frame the scene renders (`streamFrames`). The batch script (`city/lib/x/film.mjs`) asks for one frame at a time
 * and makes the files. Development builds only: it hangs on `window.__xstudio` like the city's other screenshot hooks
 * and never reaches a production bundle. It reads what the city already holds; it never trades, signs or posts.
 */

type Clock = { readonly now: number; readonly manual: boolean; hold(on: boolean): void; step(ms?: number): number };
const clockOf = (): Clock => {
  const c = (window as Window & { __xclock?: Clock }).__xclock;
  if (!c) throw new Error('the studio clock is not installed (city/lib/x/clock.mjs)');
  return c;
};
const STEP_MS = 1000 / STEP_HZ;

export type PlanInput = { template: Template; journal?: JournalLike | null; earlier?: CitySnapshot[]; before?: CitySnapshot | null };
export type Plan =
  | { ok: true; template: Template; facts: Facts; text: string; link: string; sources: Source[]; board: Storyboard | null; problems: string[]; read: { fetchedAt: string; source: string } }
  | { ok: false; template: Template; error: string };

/** The facts of a template from the city on screen: the same read the frames show. */
export function plan(input: PlanInput): Plan {
  const s = useCity.getState();
  const inCity = (id: string) => s.layout.towers.some((t) => t.tower.id === id);
  let facts: Facts | null = null;
  switch (input.template) {
    case 'hour':
      facts = towerOfHour(s.snapshot, inCity);
      break;
    case 'justin':
      facts = (input.before ? newInCore(input.before, s.snapshot) : null) ?? cityVolume(s.snapshot);
      break;
    case 'launch':
      facts = input.journal ? launchNight(input.journal) : null;
      break;
    case 'billboard':
      facts = weekBillboard(s.snapshot, input.earlier ?? []);
      break;
    case 'banner':
      facts = bannerFacts(s.snapshot);
      break;
  }
  if (!facts) return { ok: false, template: input.template, error: input.template === 'launch' && !input.journal ? 'no_flight_log' : 'no_fact' };
  const board = storyboard(facts);
  return {
    ok: true, template: input.template, facts, text: studioText(facts), link: studioLink(facts), sources: sourcesOf(facts), board,
    problems: board ? checkStoryboard(board) : [], read: { fetchedAt: s.snapshot.fetchedAt, source: s.snapshot.source },
  };
}

/* ------------------------------------------------------------------------------------------------ */

type Surface = { plate: HTMLCanvasElement; out: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

type Take = {
  board: Storyboard;
  aspects: Aspect[];
  times: number[];
  next: number;
  /** The kept frame that is also the post's still. */
  poster: number;
  /** The clip's time at step 0, in seconds (the preroll is negative), and the steps run since. */
  start: number;
  step: number;
  cues: Cue[];
  surfaces: Record<Aspect, Surface>;
  parts: FrameParts;
  /** Set for the step whose frame is kept: the clip's time of that frame. */
  want: number | null;
  drawn: boolean;
  set: (s: CitySnapshot) => void;
  stop: () => void;
};

let take: Take | null = null;
/** While a take runs, the city's own reads wait here, so the skyline does not change under the camera. */
let held: CitySnapshot | null = null;
let restore: (() => void) | null = null;

const surface = (a: Aspect): Surface => {
  const { width, height } = ASPECTS[a];
  const plate = document.createElement('canvas');
  plate.width = width;
  plate.height = height;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  return { plate, out, ctx: out.getContext('2d', { alpha: false })! };
};

/** A Ryntra launch as a tower of the city, figures the flight log does not give left at zero, as `../launch/towers.ts` does. */
function launchTower(f: LaunchFacts, district: Tower['district']): Tower {
  return {
    id: f.mint, symbol: '', name: '', icon: null, district, price: 0, mcap: 0, liquidity: 0, holders: 0,
    change5m: 0, change1h: 0, change24h: 0, volume24h: 0, traders1h: 0, organic: 0, verified: false, launchedAt: f.launchedAt,
  };
}

/** Takes the city's snapshot setter for the take: the page's reads are held, the studio's own changes go through. */
function holdCity(): (s: CitySnapshot) => void {
  const original = useCity.getState().setSnapshot;
  const base = useCity.getState().snapshot;
  held = null;
  useCity.setState({ setSnapshot: (s: CitySnapshot) => void (held = s) });
  restore = () => {
    useCity.setState({ setSnapshot: original });
    original(held ?? base);
    held = null;
    restore = null;
  };
  return original;
}

/** One task's pause, so React applies what a cue changed (the camera's flight is an effect) before the next frame. */
const yieldTask = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });

function runCue(c: Cue, set: (s: CitySnapshot) => void, facts: Facts) {
  const city = useCity.getState();
  if (c.do === 'fly') return city.select(c.mint);
  if (c.do === 'fx') {
    const t = city.layout.towers.find((p) => p.tower.id === c.mint)?.tower;
    return city.play({ kind: c.kind, towerId: c.mint, symbol: t?.verified ? t.symbol : '', value: '', title: '' });
  }
  if (c.do === 'graduate' && facts.template === 'launch') {
    const snap = city.snapshot;
    set({ ...snap, towers: snap.towers.map((t) => (t.id === c.mint ? launchTower(facts, 'strip') : t)) });
    city.shake(0.5);
  }
}

/** The step at which the clip's time is `t`. */
const stepAt = (tk: Take, t: number) => Math.round((t - tk.start) * STEP_HZ);

/** Steps the clock to the clip's time `t`, running the cues on the way; the last step's frame is kept if asked. */
async function advance(tk: Take, t: number, keep: boolean) {
  const clock = clockOf();
  const target = stepAt(tk, t);
  while (tk.step < target) {
    const after = tk.start + (tk.step + 1) / STEP_HZ;
    let cued = false;
    while (tk.cues.length && tk.cues[0]!.at <= after + 1e-6) {
      runCue(tk.cues.shift()!, tk.set, tk.board.facts);
      cued = true;
    }
    if (cued) {
      await yieldTask();
      await yieldTask();
    }
    const last = tk.step + 1 === target;
    tk.want = keep && last ? t : null;
    tk.drawn = false;
    clock.step(STEP_MS);
    tk.step += 1;
  }
}

/**
 * Begins a take: the clock in the studio's hands, the city's reads held, a launch's tower put in the docks, and the
 * director run through its preroll so the camera is moving at the first kept frame.
 */
export async function begin(input: { board: Storyboard; fps: 30 | 60; aspects?: Aspect[] }): Promise<{ frames: number; seconds: number }> {
  if (take) throw new Error('a take is running');
  const board = input.board;
  const aspects = input.aspects ?? (['4:5', '1:1'] as Aspect[]);
  const [fonts, logo] = await Promise.all([cityFonts(), markImage()]);
  clockOf().hold(true);
  const set = holdCity();
  if (board.facts.template === 'launch') {
    const snap = useCity.getState().snapshot;
    const f = board.facts;
    set({ ...snap, towers: [...snap.towers.filter((t) => t.id !== f.mint), launchTower(f, 'docks')] });
  }
  const surfaces = Object.fromEntries(aspects.map((a) => [a, surface(a)])) as Record<Aspect, Surface>;
  // A pump's fireworks go up a quarter second after the cue: the hook kicks with them.
  const beats = board.cues.flatMap((c) => (c.do === 'fx' ? [c.at + (c.kind === 'pump' ? 0.25 : 0)] : []));
  const flashes = board.cues.flatMap((c) => (c.do === 'graduate' || (c.do === 'fx' && c.kind === 'launch') ? [c.at] : []));
  const parts: FrameParts = { fonts, logo, board, beats, flashes };
  const times = board.seconds > 0 ? frameTimes(board.seconds, input.fps) : [0];
  const tk: Take = {
    board, aspects, times, next: 0,
    poster: board.seconds > 0 ? Math.min(times.length - 1, Math.round(board.poster * input.fps)) : 0,
    start: Math.min(-board.preroll, ...board.cues.map((c) => c.at)) - 1 / STEP_HZ,
    step: 0, cues: [...board.cues], surfaces, parts, want: null, drawn: false, set, stop: () => {},
  };
  tk.stop = streamFrames((frame) => {
    if (tk.want === null) return;
    for (const a of tk.aspects) {
      const s = tk.surfaces[a];
      plateOf(frame, frame.width, frame.height, s.plate);
      if (board.seconds > 0) drawClipFrame(s.ctx, s.plate, tk.want, parts);
      else if (board.facts.template === 'billboard') drawBillboard(s.ctx, s.plate, board.facts, parts);
      else drawJustIn(s.ctx, s.plate, parts);
    }
    tk.drawn = true;
  });
  take = tk;
  // The preroll: the director runs, nothing is kept.
  await advance(tk, -1 / STEP_HZ, false);
  return { frames: times.length, seconds: board.seconds };
}

/** The next kept frame of the take, as JPEG for each aspect; the poster frame (and a card) also as PNG. Null when done. */
export async function frame(quality = 0.95): Promise<{ index: number; t: number; jpeg: Partial<Record<Aspect, string>>; png: Partial<Record<Aspect, string>> } | null> {
  const tk = take;
  if (!tk) throw new Error('no take');
  if (tk.next >= tk.times.length) return null;
  const index = tk.next++;
  const t = tk.times[index]!;
  await advance(tk, t, true);
  // A frame the scene did not hand over (it skipped a render): draw it again at the same time.
  for (let i = 0; i < 3 && !tk.drawn; i += 1) {
    tk.want = t;
    clockOf().step(0);
  }
  if (!tk.drawn) throw new Error(`no city frame at ${t.toFixed(3)} s`);
  tk.want = null;
  const jpeg: Partial<Record<Aspect, string>> = {};
  const png: Partial<Record<Aspect, string>> = {};
  for (const a of tk.aspects) {
    const out = tk.surfaces[a].out;
    if (tk.board.seconds > 0) jpeg[a] = out.toDataURL('image/jpeg', quality);
    if (index === tk.poster) png[a] = out.toDataURL('image/png');
  }
  return { index, t, jpeg, png };
}

/** Ends the take: the city's own reads and camera back, the clock back to the page. */
export function end() {
  take?.stop();
  take = null;
  restore?.();
  useCity.getState().select(null);
  clockOf().hold(false);
}

/* ------------------------------------------------------------------------------------------------ */

/**
 * The banner in action: the city mid-celebration on a 1500 × 500 page — the camera down to the skyline, fireworks on
 * the tallest named towers — and how it sits on a profile under the avatar.
 */
export async function banner(): Promise<{ banner: string; preview: string } | null> {
  const fonts: Fonts = await cityFonts();
  const clock = clockOf();
  const named = useCity.getState().layout.towers
    .filter((t) => t.tower.verified && t.tower.district !== 'docks')
    .sort((a, b) => b.height - a.height)
    .slice(0, 14);
  if (named.length < 8) return null;
  const W = 1500;
  const H = 500;
  const plate = document.createElement('canvas');
  plate.width = W;
  plate.height = H;
  let want = false;
  let kept = false;
  const steps = async (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * STEP_HZ); i += 1) clock.step(STEP_MS);
    await yieldTask();
  };
  clock.hold(true);
  holdCity();
  const stop = streamFrames((f) => {
    if (!want || kept) return;
    plateOf(f, f.width, f.height, plate);
    kept = true;
  });
  try {
    // The camera comes down to the skyline, as for a trade; then six towers celebrate in turn.
    useCity.getState().select(named[1]!.tower.id);
    await yieldTask();
    await steps(3.2);
    const picks = [named[1]!, named[0]!, named[3]!, named[5]!, named[2]!, named[7]!];
    for (const [i, t] of picks.entries()) {
      useCity.getState().play({ kind: i === 0 ? 'launch' : 'pump', towerId: t.tower.id, symbol: t.tower.symbol, value: '', title: '' });
      await steps(0.26);
    }
    await steps(1.1);
    want = true;
    for (let i = 0; i < 3 && !kept; i += 1) clock.step(STEP_MS);
  } finally {
    stop();
    restore?.();
    useCity.getState().select(null);
    clock.hold(false);
  }
  if (!kept) return null;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  drawBanner(out.getContext('2d', { alpha: false })!, plate, fonts);
  const preview = document.createElement('canvas');
  preview.width = W;
  preview.height = 640;
  const avatar = await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = '/brand/city/x-avatar.png';
  });
  drawBannerPreview(preview.getContext('2d', { alpha: false })!, out, avatar);
  return { banner: out.toDataURL('image/png'), preview: preview.toDataURL('image/png') };
}

/** Whether the city is drawn and its type is loaded: the studio waits for this before the first take. */
export function ready(): boolean {
  const s = useCity.getState();
  return s.layout.towers.length > 0 && !!document.querySelector('canvas') && document.fonts.status === 'loaded';
}

export const STUDIO = { plan, begin, frame, end, banner, ready };

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __xstudio: STUDIO });
