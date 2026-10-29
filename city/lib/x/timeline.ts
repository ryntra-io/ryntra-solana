import { sourceTime } from '../moments/moment.ts';
import { pct, readTime, usd, type BillboardFacts, type Facts, type HourFacts, type JustInFacts, type LaunchFacts } from './facts.ts';

/**
 * The studio's storyboards (CITY-38): what each post shows, second by second. A clip is directed in the live city —
 * the camera, the city's own effects — and drawn over with the hook, the captions and the end card. The rules X rewards
 * and the brand asks for, held by `checkStoryboard`: the figure is on screen in the first half second, captions carry
 * the story with the sound off, the mark stays top left, the clip ends under 60 s so X loops it.
 */

export type Aspect = '4:5' | '1:1';
export const ASPECTS: Record<Aspect, { width: number; height: number }> = {
  '4:5': { width: 1080, height: 1350 },
  '1:1': { width: 1080, height: 1080 },
};

/** The city is stepped at 60 frames a second; a clip keeps every frame (60) or every other one (30). */
export const STEP_HZ = 60;
export const HOOK_BY = 0.5;
export const MAX_SECONDS = 60;

export type Accent = 'mint' | 'amber' | 'violet';

/** What the director does in the city at a time: fly to a tower, play an effect on it, or move a launch into its pool. */
export type Cue =
  | { at: number; do: 'fly'; mint: string | null }
  | { at: number; do: 'fx'; kind: 'pump' | 'flare' | 'launch'; mint: string }
  | { at: number; do: 'graduate'; mint: string };

export type Caption = { from: number; to: number; text: string };

/** The hook: on screen from the first frames to the end card. */
export type Hook = { kicker: string; title: string; figure: string; label: string; accent: Accent };

export type Storyboard = {
  facts: Facts;
  /** Seconds of the clip; 0 for a card. */
  seconds: number;
  /** Seconds the director runs before the first kept frame, so the camera is already moving at frame one. */
  preroll: number;
  hook: Hook;
  captions: Caption[];
  cues: Cue[];
  /** A curve meter from 0 to 100 %: Launch Night's way up the curve, drawn between these times. */
  meter: { from: number; to: number } | null;
  /** When the end card starts. */
  endAt: number;
  /** The frame kept as the post's still. */
  poster: number;
  /** Top right: the source and when it was read. */
  chip: string;
  /** Bottom: where the numbers come from and the advice line. */
  footnote: string;
};

const MARKET_NOTE = 'Market data: Jupiter · not financial advice';

const chipOf = (source: string, at: string) => `${source} · ${readTime(at)}`.toUpperCase();

function hour(f: HourFacts): Storyboard {
  return {
    facts: f,
    seconds: 9,
    preroll: 0.5,
    hook: { kicker: 'TOWER OF THE HOUR', title: f.symbol, figure: pct(f.change), label: `IN 1 HOUR · ${usd(f.mcap)} CAP`, accent: 'mint' },
    captions: [
      { from: 0.15, to: 3.0, text: `${f.symbol} grew the most in the last hour` },
      { from: 3.0, to: 5.6, text: `${pct(f.change)} in one hour · ${usd(f.mcap)} market cap` },
      { from: 5.6, to: 7.0, text: 'Every coin is a tower' },
    ],
    cues: [
      { at: -0.5, do: 'fly', mint: f.mint },
      { at: 1.2, do: 'fx', kind: 'pump', mint: f.mint },
      { at: 3.2, do: 'fx', kind: 'pump', mint: f.mint },
      { at: 5.2, do: 'fx', kind: 'pump', mint: f.mint },
    ],
    meter: null,
    endAt: 7.0,
    poster: 3.9,
    chip: chipOf('Jupiter', f.readAt),
    footnote: `${MARKET_NOTE} · read ${readTime(f.readAt)}`,
  };
}

function launch(f: LaunchFacts): Storyboard {
  const devnet = f.network === 'solana:devnet';
  return {
    facts: f,
    seconds: 12,
    preroll: 0.5,
    hook: { kicker: devnet ? 'LAUNCH NIGHT · DEVNET' : 'LAUNCH NIGHT', title: 'DOCKS TO POOL', figure: `${f.seconds} S`, label: 'FROM LAUNCH TO POOL · ON CHAIN', accent: 'mint' },
    captions: [
      { from: 0.15, to: 2.2, text: `Launched on Ryntra · ${sourceTime(f.launchedAt)}` },
      { from: 2.2, to: 6.2, text: 'The curve fills in the Launch Docks' },
      { from: 6.2, to: 9.8, text: `Graduated into its pool · ${sourceTime(f.graduatedAt)}` },
    ],
    cues: [
      { at: -0.5, do: 'fly', mint: f.mint },
      { at: 0.9, do: 'fx', kind: 'launch', mint: f.mint },
      { at: 6.2, do: 'graduate', mint: f.mint },
      { at: 6.25, do: 'fly', mint: f.mint },
      { at: 7.6, do: 'fx', kind: 'pump', mint: f.mint },
      { at: 8.8, do: 'fx', kind: 'pump', mint: f.mint },
    ],
    meter: { from: 2.2, to: 6.0 },
    endAt: 10.0,
    poster: 8.3,
    chip: chipOf(devnet ? 'Ryntra Launch · devnet' : 'Ryntra Launch', f.graduatedAt),
    footnote: `Ryntra Launch flight log · both transactions on Solana${devnet ? ' devnet' : ''}`,
  };
}

function justIn(f: JustInFacts): Storyboard {
  const volume = f.metric === 'volume';
  return {
    facts: f,
    seconds: 0,
    preroll: 0,
    hook: volume
      ? { kicker: 'JUST IN', title: 'THE CITY’S DAY', figure: usd(f.value), label: `24H VOLUME · ${f.towers} TOWERS`, accent: 'amber' }
      : { kicker: 'JUST IN', title: f.symbol, figure: 'SOL CORE', label: `NEW TOWER IN THE CENTRE · ${usd(f.mcap)} CAP`, accent: 'mint' },
    captions: [],
    cues: volume ? [{ at: -3.2, do: 'fly', mint: null }] : [{ at: -3.2, do: 'fly', mint: f.mint }, { at: -1.2, do: 'fx', kind: 'pump', mint: f.mint }],
    meter: null,
    endAt: 0,
    poster: 0,
    chip: chipOf('Jupiter', f.readAt),
    footnote: `${MARKET_NOTE} · read ${readTime(f.readAt)}`,
  };
}

function billboard(f: BillboardFacts): Storyboard {
  const week = f.ranking === 'week';
  return {
    facts: f,
    seconds: 0,
    preroll: 0,
    hook: {
      kicker: week ? `WEEK OF ${readTime(f.from!).split(' · ')[0]}` : 'BY 24H VOLUME',
      title: week ? 'TOWERS OF THE WEEK' : 'BUSIEST TOWERS',
      figure: f.rows[0]!.symbol,
      label: week ? `${pct(f.rows[0]!.value)} SINCE ${readTime(f.from!).split(' · ')[0]}` : `${usd(f.rows[0]!.value)} IN 24H`,
      accent: 'amber',
    },
    captions: [],
    cues: [{ at: -3.2, do: 'fly', mint: null }, ...f.rows.slice(0, 3).map((r, i) => ({ at: -1.6 + i * 0.25, do: 'fx' as const, kind: 'pump' as const, mint: r.mint }))],
    meter: null,
    endAt: 0,
    poster: 0,
    chip: chipOf('Jupiter', f.readAt),
    footnote: `${MARKET_NOTE} · read ${readTime(f.readAt)}`,
  };
}

/** The storyboard of a template's facts. The banner has none of its own: it is the city mid-celebration (`studio.ts`). */
export function storyboard(f: Facts): Storyboard | null {
  switch (f.template) {
    case 'hour':
      return hour(f);
    case 'launch':
      return launch(f);
    case 'justin':
      return justIn(f);
    case 'billboard':
      return billboard(f);
    case 'banner':
      return null;
  }
}

/** The frames a clip keeps: their times in seconds, at `fps` (30 or 60), from 0 to the end. */
export function frameTimes(seconds: number, fps: 30 | 60): number[] {
  const n = Math.round(seconds * fps);
  return Array.from({ length: n }, (_, i) => i / fps);
}

/** What breaks the rules of a clip; empty when it holds. */
export function checkStoryboard(s: Storyboard): string[] {
  const out: string[] = [];
  const clip = s.seconds > 0;
  if (clip && (s.seconds < 6 || s.seconds > MAX_SECONDS)) out.push(`length ${s.seconds} s`);
  if (s.facts.template === 'hour' && s.seconds > 12) out.push('the tower of the hour runs 6–12 s');
  if (!s.hook.figure || !s.hook.kicker) out.push('no hook');
  if (clip) {
    const first = s.captions[0];
    if (!first || first.from > HOOK_BY) out.push('the first caption comes after the hook');
    for (const [i, c] of s.captions.entries()) {
      if (!(c.to > c.from) || c.from < 0 || c.to > s.endAt + 0.001) out.push(`caption ${i} outside the clip`);
      if (i && c.from < s.captions[i - 1]!.to - 0.001) out.push(`caption ${i} overlaps`);
      if ([...c.text].length > 52) out.push(`caption ${i} is too long to read`);
    }
    if (!(s.endAt > 0 && s.endAt < s.seconds)) out.push('no end card');
    if (!(s.poster > HOOK_BY && s.poster < s.endAt)) out.push('the still is not in the story');
  }
  const times = s.cues.map((c) => c.at);
  if (times.some((t, i) => i && t < times[i - 1]!)) out.push('cues out of order');
  if (s.cues.some((c) => c.at < -s.preroll - 4 || c.at > Math.max(s.seconds, 0))) out.push('a cue outside the take');
  return out;
}
