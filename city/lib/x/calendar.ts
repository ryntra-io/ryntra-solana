import { X_MAX, xLength } from '../moments/drafts/post.ts';
import { rawMentions, type Involvement } from './handles.ts';

/**
 * The X calendar of Ryntra as data (CITY-41): a week of slots in UTC, each with the format it posts, the template the
 * card factory (CITY-38) renders it with, the rule that picks the event it shows, and the words with room for the real
 * numbers. The playbook that explains it: docs/city/x/PLAYBOOK.md. Nothing here posts; it only plans and checks.
 */

export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const DAYS: readonly Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** The audiences a slot lands in, by local time: the Americas, Europe and Asia. */
export type Audience = 'americas' | 'europe' | 'asia';

export type FormatId =
  | 'tower-hour'
  | 'skyline'
  | 'launch'
  | 'graduate'
  | 'build-log'
  | 'explainer'
  | 'agent-find'
  | 'quarter'
  | 'district-war'
  | 'lineup'
  | 'launch-night'
  | 'week-in-city';

/** What the post carries. The factory decides the pixels; this only says the shape. */
export type Media = 'card-4x5' | 'clip-9x16' | 'image-16x9' | 'live' | 'none';

/** How a slot finds the happening it shows. */
export interface PickRule {
  /** Where candidates come from: market reads, the Launch engine, the world, agents, a release, or a person's pick. */
  from: 'market' | 'launch' | 'world' | 'agent' | 'release' | 'editorial';
  /** Event kinds that qualify (CITY-3/CITY-26 moment kinds for the engine, `tower` for market reads). */
  kinds: readonly string[];
  /** How far back a candidate may be, in minutes. */
  maxAgeMinutes: number;
  /** Only coins the market verifies (Jupiter's verified list); a pool nobody verified is never featured. */
  verifiedOnly: boolean;
  /** Floor under thin coins, so a tiny pool's swing never becomes the post. */
  minLiquidityUsd: number;
  minVolumeUsd: number;
  /** Which candidate wins. */
  rank: 'abs-change' | 'largest-volume' | 'latest' | 'editorial';
  /** The same coin or district is not featured again by this format within this many hours. */
  cooldownHours: number;
  /** With no qualifying event: post this format instead, or skip the slot (null). */
  fallback: FormatId | null;
}

export interface Format {
  id: FormatId;
  /** Template id in the card factory (CITY-38). A string on purpose: the factory owns the template. */
  template: string;
  media: Media;
  /** What the format is for, in one line. */
  purpose: string;
  /** Ritual name, when the format is one. */
  ritual?: string;
  pick: PickRule;
  /** What the post shows; a partner tag must fit one of these (handles.ts). */
  involvement: readonly Involvement[];
  /** Word variants with `{number}` places and `{@partner}` tags; rotated so no two posts read the same. */
  texts: readonly string[];
}

/** The line every post with market numbers ends on, as on the city's share card. */
export const DATA_LINE = 'Market data: Jupiter · not financial advice';

const NO_FLOOR = { verifiedOnly: false, minLiquidityUsd: 0, minVolumeUsd: 0 } as const;

export const FORMATS: Readonly<Record<FormatId, Format>> = {
  'tower-hour': {
    id: 'tower-hour',
    template: 'x.tower-hour.card',
    media: 'card-4x5',
    purpose: 'Tower of the hour: the verified coin that moved most in the last 60 minutes, with its window.',
    ritual: 'Tower of the hour',
    pick: { from: 'market', kinds: ['tower'], maxAgeMinutes: 60, verifiedOnly: true, minLiquidityUsd: 250_000, minVolumeUsd: 50_000, rank: 'abs-change', cooldownHours: 24, fallback: null },
    involvement: ['market-data'],
    texts: [
      `Tower of the hour: {symbol}, {change_1h} in the last 60 minutes. Price {price}, {volume_1h} traded in the same hour.\n\n${DATA_LINE}\n{link}`,
      `The tower that moved most this hour: {symbol}, {change_1h} since {window_start} UTC on {volume_1h} of volume.\n\n${DATA_LINE}\n{link}`,
      `{symbol} is the tower of the hour: {change_1h} between {window_start} and {window_end} UTC. Liquidity {liquidity}.\n\n${DATA_LINE}\n{link}`,
    ],
  },
  skyline: {
    id: 'skyline',
    template: 'x.skyline.clip',
    media: 'clip-9x16',
    purpose: 'The whole skyline right now: how many towers, how many up, the busiest district.',
    pick: { from: 'market', kinds: ['snapshot'], maxAgeMinutes: 15, ...NO_FLOOR, rank: 'latest', cooldownHours: 0, fallback: null },
    involvement: ['market-data'],
    texts: [
      `The Solana skyline at {time} UTC: {towers} towers, {up_share} of them up over 24 hours. Busiest district: {district}, {district_volume_24h} traded.\n\n${DATA_LINE}\n{link}`,
      `{time} UTC in the city: {district} is the brightest district, {district_volume_24h} in 24 hours. {up_share} of {towers} towers are up on the day.\n\n${DATA_LINE}\n{link}`,
    ],
  },
  launch: {
    id: 'launch',
    template: 'x.launch.card',
    media: 'card-4x5',
    purpose: 'A coin launched on Ryntra rises in the Launch Docks.',
    pick: { from: 'launch', kinds: ['launch'], maxAgeMinutes: 180, verifiedOnly: false, minLiquidityUsd: 0, minVolumeUsd: 5_000, rank: 'largest-volume', cooldownHours: 72, fallback: 'skyline' },
    involvement: ['launch'],
    texts: [
      `{symbol} launched on Ryntra {ago} and rose as a new tower in the Launch Docks. It trades on a {@meteora} bonding curve; at $75K it moves into the skyline.\n\n{link}`,
      `New tower in the Launch Docks: {symbol}, launched on Ryntra {ago}. {holders} holders and {volume_since_launch} traded so far, on chain.\n\n{link}`,
    ],
  },
  graduate: {
    id: 'graduate',
    template: 'x.graduate.clip',
    media: 'clip-9x16',
    purpose: 'A Ryntra launch fills its curve and moves into the skyline.',
    pick: { from: 'launch', kinds: ['graduate'], maxAgeMinutes: 720, verifiedOnly: false, minLiquidityUsd: 0, minVolumeUsd: 0, rank: 'latest', cooldownHours: 168, fallback: 'skyline' },
    involvement: ['graduate'],
    texts: [
      `{symbol} filled its curve: past $75K and now a {@meteora} DAMM v2 pool with its liquidity locked. {time_to_graduate} from the Launch Docks to the skyline.\n\n{link}`,
      `Out of the Docks: {symbol} crossed $75K on its curve {ago} and moved into the skyline, {time_to_graduate} after launch.\n\n{link}`,
    ],
  },
  'build-log': {
    id: 'build-log',
    template: 'x.build-log.image',
    media: 'image-16x9',
    purpose: 'Something that went live on ryntra.io, shown, with what it does for a person.',
    pick: { from: 'release', kinds: ['deployed'], maxAgeMinutes: 7 * 24 * 60, ...NO_FLOOR, rank: 'latest', cooldownHours: 0, fallback: 'explainer' },
    involvement: [],
    texts: [`Live on ryntra.io: {shipped}.\n\n{what_it_does}\n\n{link}`],
  },
  explainer: {
    id: 'explainer',
    template: 'x.explainer.card',
    media: 'card-4x5',
    purpose: 'How one thing in the city works: a tower, a buy, a launch, a quarter, what is and is not on chain.',
    pick: { from: 'editorial', kinds: [], maxAgeMinutes: 0, ...NO_FLOOR, rank: 'editorial', cooldownHours: 0, fallback: null },
    involvement: [],
    texts: [`{body}\n\n{link}`],
  },
  'agent-find': {
    id: 'agent-find',
    template: 'x.agent-find.card',
    media: 'card-4x5',
    purpose: 'What a Ryntra agent noticed, as a lead to check, never as advice.',
    pick: { from: 'agent', kinds: ['agent'], maxAgeMinutes: 240, verifiedOnly: true, minLiquidityUsd: 250_000, minVolumeUsd: 50_000, rank: 'latest', cooldownHours: 48, fallback: 'skyline' },
    involvement: ['market-data'],
    texts: [`A Ryntra agent spotted {symbol}: {signal} over {window}. A lead to check, not advice.\n\n${DATA_LINE}\n{link}`],
  },
  quarter: {
    id: 'quarter',
    template: 'x.quarter.clip',
    media: 'clip-9x16',
    purpose: 'One person\'s quarter, shared by its owner: what they built and what it runs on.',
    pick: { from: 'world', kinds: ['quarter-shared'], maxAgeMinutes: 7 * 24 * 60, ...NO_FLOOR, rank: 'editorial', cooldownHours: 30 * 24, fallback: 'explainer' },
    involvement: [],
    texts: [`A quarter in the city, shared by its owner: level {level}, {buildings} buildings. {story}\n\n{link}`],
  },
  'district-war': {
    id: 'district-war',
    template: 'x.district-war.card',
    media: 'card-4x5',
    purpose: 'The week\'s district war: which district won, by what measure.',
    pick: { from: 'world', kinds: ['war'], maxAgeMinutes: 48 * 60, ...NO_FLOOR, rank: 'latest', cooldownHours: 6 * 24, fallback: 'skyline' },
    involvement: [],
    texts: [`{district} won this week's district war in the city: {measure}. Runner-up: {runner_up}.\n\n${DATA_LINE}\n{link}`],
  },
  lineup: {
    id: 'lineup',
    template: 'x.launch-night.lineup',
    media: 'card-4x5',
    purpose: 'The afternoon call for Launch Night: when, how many, where to watch.',
    pick: { from: 'launch', kinds: ['scheduled'], maxAgeMinutes: 24 * 60, ...NO_FLOOR, rank: 'editorial', cooldownHours: 0, fallback: 'tower-hour' },
    involvement: ['launch'],
    texts: [`Launch Night tonight at {start} UTC: {count} coins lift off live in the Launch Docks, each on a {@meteora} curve. Watch the towers rise as it happens.\n\n{link}`],
  },
  'launch-night': {
    id: 'launch-night',
    template: 'x.launch-night.live',
    media: 'live',
    purpose: 'Launch Night itself: the launches streamed live, the thread under it written as they land.',
    ritual: 'Launch Night',
    pick: { from: 'launch', kinds: ['scheduled'], maxAgeMinutes: 60, ...NO_FLOOR, rank: 'editorial', cooldownHours: 0, fallback: null },
    involvement: ['launch'],
    texts: [`Launch Night is live. {count} launches, one skyline, every tower rising on chain as it happens.\n\n{link}`],
  },
  'week-in-city': {
    id: 'week-in-city',
    template: 'x.week.card',
    media: 'card-4x5',
    purpose: 'A week in the city: launches, the tower of the week, the busiest district, what shipped.',
    ritual: 'A week in the city',
    pick: { from: 'market', kinds: ['week'], maxAgeMinutes: 24 * 60, ...NO_FLOOR, rank: 'latest', cooldownHours: 0, fallback: 'explainer' },
    involvement: ['market-data', 'launch'],
    texts: [
      `A week in the city, {week}:\n- {launches} launches in the Docks, {graduates} moved into the skyline\n- Tower of the week: {top_symbol}, {top_change_7d} over 7 days\n- Busiest district: {district}\n- Live on ryntra.io: {shipped}\n\n${DATA_LINE}\n{link}`,
    ],
  },
};

export interface Slot {
  day: Day;
  /** HH:MM in UTC. */
  utc: string;
  format: FormatId;
  audience: readonly Audience[];
}

const S = (day: Day, utc: string, format: FormatId, ...audience: Audience[]): Slot => ({ day, utc, format, audience });

/**
 * The week, Monday first. Times are UTC and do not move with daylight saving; the audience's local time does (see the
 * playbook). 00:30 — Asia's morning and the US evening; 08:00 — Europe's morning, Asia's afternoon; 13:30 — the US East
 * morning, Europe's afternoon; 17:00 — the US midday, Europe's evening; 21:00–22:00 — the US afternoon. Weekends post
 * later and less.
 */
export const WEEK: readonly Slot[] = [
  S('mon', '00:30', 'tower-hour', 'asia', 'americas'),
  S('mon', '08:00', 'build-log', 'europe', 'asia'),
  S('mon', '13:30', 'skyline', 'americas', 'europe'),
  S('mon', '17:00', 'tower-hour', 'americas', 'europe'),

  S('tue', '00:30', 'skyline', 'asia', 'americas'),
  S('tue', '08:00', 'tower-hour', 'europe', 'asia'),
  S('tue', '13:30', 'explainer', 'americas', 'europe'),
  S('tue', '17:00', 'launch', 'americas', 'europe'),

  S('wed', '00:30', 'tower-hour', 'asia', 'americas'),
  S('wed', '08:00', 'agent-find', 'europe', 'asia'),
  S('wed', '13:30', 'tower-hour', 'americas', 'europe'),
  S('wed', '17:00', 'graduate', 'americas', 'europe'),
  S('wed', '21:00', 'explainer', 'americas'),

  S('thu', '00:30', 'tower-hour', 'asia', 'americas'),
  S('thu', '08:00', 'build-log', 'europe', 'asia'),
  S('thu', '13:30', 'lineup', 'americas', 'europe'),
  S('thu', '18:00', 'launch-night', 'americas', 'europe'),
  S('thu', '22:00', 'skyline', 'americas'),

  S('fri', '00:30', 'tower-hour', 'asia', 'americas'),
  S('fri', '08:00', 'quarter', 'europe', 'asia'),
  S('fri', '13:30', 'launch', 'americas', 'europe'),
  S('fri', '17:00', 'tower-hour', 'americas', 'europe'),

  S('sat', '10:00', 'district-war', 'europe', 'asia'),
  S('sat', '15:00', 'tower-hour', 'europe', 'americas'),
  S('sat', '19:00', 'skyline', 'americas', 'europe'),

  S('sun', '10:00', 'tower-hour', 'europe', 'asia'),
  S('sun', '15:00', 'week-in-city', 'europe', 'americas'),
  S('sun', '20:00', 'skyline', 'americas'),
];

export const MIN_PER_DAY = 3;
export const MAX_PER_DAY = 5;

const minutes = (utc: string): number => {
  const [h, m] = utc.split(':').map(Number);
  return h! * 60 + m!;
};

/** A day's slots in time order. */
export function slotsFor(day: Day, week: readonly Slot[] = WEEK): Slot[] {
  return week.filter((s) => s.day === day).sort((a, b) => minutes(a.utc) - minutes(b.utc));
}

/** The whole week in time order, Monday 00:00 UTC first. */
export function weekInOrder(week: readonly Slot[] = WEEK): Slot[] {
  return DAYS.flatMap((d) => slotsFor(d, week));
}

/** The day of a moment in UTC. */
export function dayOf(at: Date): Day {
  return DAYS[(at.getUTCDay() + 6) % 7]!;
}

/** How many slots each format takes in the week, and its share. */
export function formatShares(week: readonly Slot[] = WEEK): { format: FormatId; slots: number; share: number }[] {
  const counts = new Map<FormatId, number>();
  for (const s of week) counts.set(s.format, (counts.get(s.format) ?? 0) + 1);
  return [...counts]
    .map(([format, slots]) => ({ format, slots, share: slots / week.length }))
    .sort((a, b) => b.slots - a.slots || a.format.localeCompare(b.format));
}

/**
 * A day as it will actually post: each slot keeps its format when `available` says the format has something real to
 * show, falls back when it does not, and is skipped when the fallback has nothing either.
 */
export function planDay(day: Day, available: (format: FormatId) => boolean, week: readonly Slot[] = WEEK): Slot[] {
  const out: Slot[] = [];
  for (const slot of slotsFor(day, week)) {
    let format: FormatId | null = slot.format;
    const seen = new Set<FormatId>();
    while (format && !available(format) && !seen.has(format)) {
      seen.add(format);
      format = FORMATS[format].pick.fallback;
    }
    if (format && available(format)) out.push({ ...slot, format });
  }
  return out;
}

// ---------- Picking the event ----------

/** A candidate happening a slot could show: a tower's read, an engine event, an agent's find. */
export interface Candidate {
  id: string;
  kind: string;
  /** The coin's mint or the district: what the cooldown counts. */
  subject: string;
  /** When it happened (ISO). */
  at: string;
  verified: boolean;
  liquidityUsd?: number;
  volumeUsd?: number;
  /** Signed change over the format's window, as a fraction (0.12 = +12%). */
  change?: number;
}

/** What this format featured lately: subject and when (ISO). */
export interface Featured {
  format: FormatId;
  subject: string;
  at: string;
}

/** The candidate a slot shows, or null (then the slot falls back). Editorial formats are a person's pick: null here. */
export function pickEvent(format: FormatId, candidates: readonly Candidate[], now: Date, featured: readonly Featured[] = []): Candidate | null {
  const rule = FORMATS[format].pick;
  if (rule.rank === 'editorial') return null;
  const t = now.getTime();
  const cooled = (c: Candidate) =>
    !featured.some((f) => f.format === format && f.subject === c.subject && t - Date.parse(f.at) < rule.cooldownHours * 3_600_000);
  const fit = candidates.filter((c) => {
    const age = t - Date.parse(c.at);
    return (
      rule.kinds.includes(c.kind) &&
      age >= 0 &&
      age <= rule.maxAgeMinutes * 60_000 &&
      (!rule.verifiedOnly || c.verified) &&
      (c.liquidityUsd ?? 0) >= rule.minLiquidityUsd &&
      (c.volumeUsd ?? 0) >= rule.minVolumeUsd &&
      (rule.rank !== 'abs-change' || Number.isFinite(c.change)) &&
      cooled(c)
    );
  });
  const by: Record<Exclude<PickRule['rank'], 'editorial'>, (a: Candidate, b: Candidate) => number> = {
    'abs-change': (a, b) => Math.abs(b.change!) - Math.abs(a.change!),
    'largest-volume': (a, b) => (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0),
    latest: (a, b) => Date.parse(b.at) - Date.parse(a.at),
  };
  return fit.sort((a, b) => by[rule.rank as keyof typeof by](a, b) || a.id.localeCompare(b.id))[0] ?? null;
}

// ---------- Words ----------

/** `{name}` places for numbers and words (not `{@partner}` tags). */
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map((m) => m[1]!))];
}

/** The numbers a text needs from the engine or a person: every place but the link. */
export function needs(text: string): string[] {
  return placeholders(text).filter((p) => p !== 'link');
}

/** Every `{name}` filled; throws on a missing one, since a post never goes out with a hole or a made-up number. */
export function fillText(text: string, values: Readonly<Record<string, string | number>>): string {
  const missing = placeholders(text).filter((p) => values[p] === undefined || values[p] === '');
  if (missing.length) throw new Error(`missing numbers: ${missing.join(', ')}`);
  return text.replace(/\{([a-z][a-z0-9_]*)\}/g, (_, p: string) => String(values[p]));
}

/**
 * Words a Ryntra post never uses: the brandbook's list (docs/city/brand/BRANDBOOK.md, its voice section; a test keeps
 * every one of them inside this), the product's forbidden words for posts (unruggable, floor price, degen, the old
 * product name) and the X-only ones. A matcher, not words the city says, so it is a pattern.
 */
export const NEVER =
  /(?<![a-z0-9])(to the moon|moon|mooning|100x|1000x|guarantee|guaranteed|risk-free|riskless|get rich|lambo|passive income|can't lose|sure thing|easy money|free money|not a scam|pump it|send it|ape in|financial freedom|wagmi|nfa|gem|presale|giveaway|dm us|follow and retweet|like and retweet|unruggable|floor price|degen|ryntra arc)(?![a-z0-9])/g;

/** What a person may never set the account to do. */
export const FORBIDDEN_ACTIONS: readonly string[] = [
  'auto-like',
  'auto-follow or follow-back',
  'replying to people found by search',
  'posting the same text twice',
  'paid posts or paid engagement',
  'a tag nobody checked or approved',
  'a promise of profit',
];

export function neverIn(text: string): string[] {
  const lower = text.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  return [...new Set([...lower.matchAll(NEVER)].map((m) => m[1]!))];
}

/** The text a duplicate is judged on: no links, no case, single spaces. */
export function sameness(text: string): string {
  return text.replace(/https?:\/\/\S+/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A multiplier is data only with its window: "×3.4 since liftoff", never a bare "3x". */
function bareMultipliers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:×\s?\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?[x×](?![a-z0-9]))/gi)) {
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 24);
    if (!/^\s+(since|in|over|from|between)\b/i.test(after)) out.push(m[0]);
  }
  return out;
}

/** The length X counts: links as 23 (post.ts), and a bare domain like "ryntra.io" too, since X links it as well. */
export function xCount(text: string): number {
  let extra = 0;
  for (const m of text.replace(/https?:\/\/\S+/g, ' ').matchAll(/(?<![@\w.])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:io|com|ag|so|dev|xyz|app|fi|trade)\b/gi)) {
    extra += 23 - m[0].length;
  }
  return xLength(text) + extra;
}

/**
 * Everything wrong with a post's words; empty means it may go to a person for approval. `tagged` are the handles
 * `resolveMentions` put in (without @); any other @name is a tag written by hand and skips every check.
 */
export function textProblems(text: string, recent: readonly string[] = [], tagged: readonly string[] = []): string[] {
  const problems: string[] = [];
  for (const w of neverIn(text)) problems.push(`never says "${w}"`);
  if (text.includes('!')) problems.push('no exclamation marks');
  if (/\p{Extended_Pictographic}/u.test(text)) problems.push('no emoji');
  const holes = placeholders(text);
  if (holes.length) problems.push(`unfilled: ${holes.join(', ')}`);
  if (/\{@[a-z0-9_-]+\}/.test(text)) problems.push('a partner tag is not resolved');
  const raw = rawMentions(text).filter((h) => !tagged.some((t) => t.toLowerCase() === h.toLowerCase()));
  if (raw.length) problems.push(`tags written by hand (use {@key}): ${raw.map((h) => `@${h}`).join(', ')}`);
  // Leaders tag one partner, two at most, and only where the partner takes part (the X research, 1.3).
  if (new Set(tagged.map((t) => t.toLowerCase())).size > 2) problems.push('at most two partner tags');
  for (const m of bareMultipliers(text)) problems.push(`multiplier without its window: "${m}"`);
  if ((text.match(/#\w+/g) ?? []).length > 1) problems.push('at most one hashtag');
  if (xCount(text) > X_MAX) problems.push(`longer than ${X_MAX} as X counts (${xCount(text)})`);
  const key = sameness(text);
  if (recent.some((r) => sameness(r) === key)) problems.push('the same text went out before');
  return problems;
}

// ---------- Replies ----------

/** An incoming post the account might answer. */
export interface Incoming {
  text: string;
  /** It answers one of our posts. */
  repliesToUs?: boolean;
  /** It quotes one of our posts. */
  quotesUs?: boolean;
  /** How we found it. Search is never a reason to reply. */
  foundBy: 'mention' | 'reply' | 'quote' | 'search';
}

/** Ryntra answers only people who addressed it first: a mention, a reply or a quote. Never someone found by search. */
export function mayReply(post: Incoming, own = 'Ryntra_io'): boolean {
  if (post.foundBy === 'search') return false;
  const mentioned = new RegExp(`(^|[^A-Za-z0-9_])@${own}\\b`, 'i').test(post.text);
  return mentioned || post.repliesToUs === true || post.quotesUs === true;
}
