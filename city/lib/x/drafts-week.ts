import { FORMATS, WEEK, fillText, needs, type Day, type FormatId, type Media } from './calendar.ts';
import { mentionKeys, resolveMentions, type MentionContext } from './handles.ts';

/**
 * The first week of drafts for X (CITY-41): three per day, each tied to a slot of the calendar. Words are final; the
 * `{numbers}` are filled from the engine on the day, and `{@partner}` tags resolve only for a checked handle in a post a
 * person approved. Nothing here is posted: a draft goes to the CITY-3 desk, a person approves it, the owner's sender
 * (none connected today) sends it.
 */

export interface WeekDraft {
  id: string;
  day: Day;
  /** The calendar slot it fills (HH:MM UTC). */
  utc: string;
  format: FormatId;
  /** Template id in the card factory (CITY-38). */
  template: string;
  media: Media;
  /** English, in the brandbook's voice; `{number}` places and `{@partner}` tags. */
  text: string;
  /** Numbers to fill on the day, and where each comes from. */
  numbers: Readonly<Record<string, string>>;
  /** What a person checks before approving, beyond the numbers. */
  checks: readonly string[];
}

const D = (day: Day, utc: string, format: FormatId, text: string, numbers: Record<string, string>, checks: string[] = []): WeekDraft => ({
  id: `w1-${day}-${utc.replace(':', '')}`,
  day,
  utc,
  format,
  template: FORMATS[format].template,
  media: FORMATS[format].media,
  text,
  numbers,
  checks,
});

const DATA = 'Market data: Jupiter · not financial advice';

const TOWER_HOUR = {
  symbol: 'ticker of the verified tower with the largest move in the last 60 minutes (pickEvent "tower-hour")',
  change_1h: 'signed change over those 60 minutes, e.g. "+8.2%"',
  price: 'price at the end of the window, USD',
  volume_1h: 'USD traded in the same 60 minutes',
};

const SKYLINE = {
  time: 'HH:MM UTC of the snapshot',
  towers: 'how many towers stand in the city',
  up_share: 'share of towers up over 24 hours, e.g. "61%"',
  district: 'district with the most volume over 24 hours',
  district_volume_24h: 'that district\'s USD volume over 24 hours',
};

export const DRAFTS_WEEK: readonly WeekDraft[] = [
  // Monday
  D('mon', '00:30', 'tower-hour',
    `Tower of the hour: {symbol}, {change_1h} in the last 60 minutes. Price {price}, {volume_1h} traded in the same hour.\n\n${DATA}\n{link}`,
    TOWER_HOUR),
  D('mon', '08:00', 'build-log',
    'Live on ryntra.io: buy from any tower with SOL or USDC, or type your own amount. On a computer the trade window drags, resizes and stays where you left it.\n\nThe figures still come from the route: what you pay, what you get at least.\n\n{link}',
    {},
    ['CITY-37 is live on ryntra.io, not only merged to master', 'the 16:9 image is the real card from production']),
  D('mon', '13:30', 'skyline',
    `The Solana skyline at {time} UTC: {towers} towers, {up_share} of them up over 24 hours. Busiest district: {district}, {district_volume_24h} traded.\n\n${DATA}\n{link}`,
    SKYLINE),

  // Tuesday
  D('tue', '08:00', 'tower-hour',
    `The tower that moved most this hour: {symbol}, {change_1h} since {window_start} UTC on {volume_1h} of volume.\n\n${DATA}\n{link}`,
    { symbol: TOWER_HOUR.symbol, change_1h: TOWER_HOUR.change_1h, window_start: 'HH:MM UTC the 60-minute window starts', volume_1h: TOWER_HOUR.volume_1h }),
  D('tue', '13:30', 'explainer',
    'How to read the city: every Solana coin is a tower. Bigger coins stand taller and closer to the Sol Spire. Five districts: Sol Core, DeFi Heights, Meme Strip, Stock Avenue and the Launch Docks, where new coins rise.\n\nTap a tower for its price.\n\n{link}',
    {}),
  D('tue', '17:00', 'launch',
    '{symbol} launched on Ryntra {ago} and rose as a new tower in the Launch Docks. It trades on a {@meteora} bonding curve; at $75K it moves into the skyline.\n\n{link}',
    { symbol: 'ticker of the Ryntra launch with the most volume in the last 3 hours (pickEvent "launch")', ago: 'how long ago, e.g. "2 hours ago"' },
    ['the coin launched through Ryntra Launch (source "Ryntra Launch")', '@MeteoraAG is checked and fresh in handles.ts']),

  // Wednesday
  D('wed', '00:30', 'tower-hour',
    `{symbol} is the tower of the hour: {change_1h} between {window_start} and {window_end} UTC. Liquidity {liquidity}.\n\n${DATA}\n{link}`,
    { symbol: TOWER_HOUR.symbol, change_1h: TOWER_HOUR.change_1h, window_start: 'HH:MM UTC', window_end: 'HH:MM UTC', liquidity: 'pool liquidity, USD' }),
  D('wed', '17:00', 'graduate',
    '{symbol} filled its curve: past $75K and now a {@meteora} DAMM v2 pool with its liquidity locked. {time_to_graduate} from the Launch Docks to the skyline.\n\n{link}',
    { symbol: 'ticker of the Ryntra launch that graduated in the last 12 hours', time_to_graduate: 'launch to graduation, e.g. "3 days 4 hours"' },
    ['the graduation is read from the chain, not from a feed', '@MeteoraAG is checked and fresh in handles.ts']),
  D('wed', '21:00', 'explainer',
    'Ryntra never holds your coins. A buy from a tower is one signature in your own wallet, and the receipt lives on Solana.\n\nIf a trade reaches the chain and fails, the city says so, and only the network fee is spent.\n\n{link}',
    {}),

  // Thursday
  D('thu', '08:00', 'build-log',
    'Live on ryntra.io: a launch or a move into the skyline now films itself. A 9:16 clip of the tower rising, ready to attach to a post.\n\nOnly the numbers of the moment, read from the chain.\n\n{link}',
    {},
    ['CITY-26 clips are live on ryntra.io', 'the image is a real frame of a real clip']),
  D('thu', '13:30', 'lineup',
    'Launch Night tonight at {start} UTC: {count} coins lift off live in the Launch Docks, each on a {@meteora} curve. Watch the towers rise as it happens.\n\n{link}',
    { start: 'HH:MM UTC Launch Night starts', count: 'launches confirmed for tonight' },
    ['every launch in the count is confirmed by its creator', 'the stream link works', '@MeteoraAG is checked and fresh in handles.ts']),
  D('thu', '18:00', 'launch-night',
    'Launch Night is live. {count} launches, one skyline, every tower rising on chain as it happens.\n\n{link}',
    { count: 'launches in tonight\'s run of show' },
    ['the stream is live before this goes out', 'a person runs the thread under it (playbook: Launch Night)']),

  // Friday
  D('fri', '00:30', 'tower-hour',
    `Tower of the hour: {symbol}, {change_1h} in the last 60 minutes. Price {price}, {volume_1h} traded in the same hour. The last 24 hours: {change_24h}.\n\n${DATA}\n{link}`,
    { ...TOWER_HOUR, change_24h: 'signed change over 24 hours, the second window' }),
  D('fri', '08:00', 'quarter',
    'A quarter in the city, shared by its owner: level {level}, {buildings} buildings. Each one stands on something real: a coin they launched, a pool they hold, a strategy they run.\n\n{link}',
    { level: 'quarter level from the world server', buildings: 'buildings in the quarter' },
    ['the owner asked for this quarter to be shown (written consent on the desk)', 'no wallet address or balance in the words or the clip']),
  D('fri', '13:30', 'launch',
    'New tower in the Launch Docks: {symbol}, launched on Ryntra {ago}. {holders} holders and {volume_since_launch} traded so far, on chain.\n\n{link}',
    { symbol: 'ticker of the Ryntra launch (pickEvent "launch"), not the one from Tuesday', ago: 'how long ago', holders: 'holders now', volume_since_launch: 'USD traded since launch' },
    ['the coin launched through Ryntra Launch']),

  // Saturday
  D('sat', '10:00', 'district-war',
    `{district} won this week's district war in the city: {measure}. Runner-up: {runner_up}.\n\n${DATA}\n{link}`,
    { district: 'winning district', measure: 'what it won by, e.g. "$41M traded over 7 days"', runner_up: 'second district' }),
  D('sat', '15:00', 'tower-hour',
    `Saturday's tower of the hour: {symbol}, {change_1h} in the last 60 minutes on {volume_1h} of volume.\n\n${DATA}\n{link}`,
    { symbol: TOWER_HOUR.symbol, change_1h: TOWER_HOUR.change_1h, volume_1h: TOWER_HOUR.volume_1h }),
  D('sat', '19:00', 'skyline',
    `{time} UTC in the city: {district} is the brightest district, {district_volume_24h} in 24 hours. {up_share} of {towers} towers are up on the day.\n\n${DATA}\n{link}`,
    SKYLINE),

  // Sunday
  D('sun', '10:00', 'tower-hour',
    `Sunday morning's tower of the hour: {symbol}, {change_1h} since {window_start} UTC. Price {price}.\n\n${DATA}\n{link}`,
    { symbol: TOWER_HOUR.symbol, change_1h: TOWER_HOUR.change_1h, window_start: 'HH:MM UTC the window starts', price: TOWER_HOUR.price }),
  D('sun', '15:00', 'week-in-city',
    `A week in the city, {week}:\n- {launches} launches in the Docks, {graduates} moved into the skyline\n- Tower of the week: {top_symbol}, {top_change_7d} over 7 days\n- Busiest district: {district}\n- Live on ryntra.io: {shipped}\n\n${DATA}\n{link}`,
    {
      week: 'the week, e.g. "Oct 26 – Nov 1"',
      launches: 'Ryntra launches this week',
      graduates: 'of them past $75K',
      top_symbol: 'verified tower with the largest 7-day move',
      top_change_7d: 'its signed 7-day change',
      district: 'district with the most 7-day volume',
      shipped: 'one thing that went live this week, in five words or fewer',
    },
    ['"shipped" is live on ryntra.io']),
  D('sun', '20:00', 'skyline',
    `Sunday night over the Solana skyline: {towers} towers, {up_share} up over 24 hours. {district} traded the most, {district_volume_24h}.\n\n${DATA}\n{link}`,
    { towers: SKYLINE.towers, up_share: SKYLINE.up_share, district: SKYLINE.district, district_volume_24h: SKYLINE.district_volume_24h }),
];

/** Every number a draft needs (its `{places}` but the link). */
export function draftNeeds(d: WeekDraft): string[] {
  return needs(d.text);
}

/** Partners a draft tags. */
export function draftTags(d: WeekDraft): string[] {
  return mentionKeys(d.text);
}

/**
 * The post's words on the day: numbers filled, partner tags resolved. Throws on a missing number or a tag that may not
 * go in (unchecked, stale, not involved, or no person approved the post).
 */
export function renderDraft(
  d: WeekDraft,
  values: Readonly<Record<string, string | number>>,
  ctx: Omit<MentionContext, 'involvement'>,
): string {
  const tagged = resolveMentions(d.text, { ...ctx, involvement: FORMATS[d.format].involvement });
  return fillText(tagged, values);
}

/** The calendar slot each draft fills (a draft never invents a slot). */
export function slotOf(d: WeekDraft) {
  return WEEK.find((s) => s.day === d.day && s.utc === d.utc);
}
