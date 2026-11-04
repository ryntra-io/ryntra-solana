import { AGENTS_OPEN } from '../agent/flag.ts';
import { BEACONS } from '../beacon/switch.ts';
import { CITY_LAUNCH_MAINNET, CITY_LAUNCH_SWITCH } from '../launch/gate.ts';
import { moneyOpen, MONEY_OPEN } from '../money/flag.ts';
import { spotOpen, SPOT_OPEN, tradeOpen, TRADE_OPEN } from '../trade/gates.ts';
import { beaconsMode } from '../../../lib/world/beacons/switch.ts';
import { FILMS, type Films, type GuideFilm } from './films.ts';

/**
 * «How it works» (CITY-43): one lesson a function, each with its film, one line under it and «Try», which opens that
 * function's own window in the city. A lesson stands only when two things hold: its film is here (`films.ts` — the
 * lessons of CITY-42, from our own domain) and its function is live on this deployment — open to everyone, or behind a
 * switch of the city that is open now, read by the same rules the menu at the bottom, the tower card and the windows
 * read. No lesson, no card: never an empty place, never a «soon». The words wait in `city/components/how/words.ts`.
 * No React and no stores here: the tests run it in Node.
 */

/**
 * The functions a lesson can teach, in the order the page shows them: the agent and the launch first (decision 91),
 * then the city and what everyone can do in it, then what opens with a switch. Prediction markets and futures live on
 * RXN (decision 86): their lessons are not the city's.
 */
export const GUIDE_IDS = ['agents', 'launch', 'trade', 'city', 'search', 'chart', 'assistant', 'quarter', 'spot', 'beacons', 'money'] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

export function isGuideId(value: unknown): value is GuideId {
  return typeof value === 'string' && (GUIDE_IDS as readonly string[]).includes(value);
}

/** The city's switches a function waits on. The city, the search, the chart, Ask Ryntra and the quarter wait on none. */
export type GuideFlags = Readonly<{
  agents: boolean;
  launch: boolean;
  trade: boolean;
  spot: boolean;
  beacons: boolean;
  money: boolean;
}>;

/** Every switch a function needs open; none — it is always there. */
export const GUIDE_NEEDS: Readonly<Record<GuideId, readonly (keyof GuideFlags)[]>> = {
  agents: ['agents'],
  launch: ['launch'],
  trade: ['trade'],
  city: [],
  search: [],
  chart: [],
  assistant: [],
  quarter: [],
  spot: ['trade', 'spot'],
  beacons: ['beacons'],
  money: ['money'],
};

/** The word on a card's one action: most say «Try it»; Ask Ryntra asks, the quarter goes home. */
export type GuideAction = 'try' | 'ask' | 'home';

export const GUIDE_ACTION: Readonly<Record<GuideId, GuideAction>> = {
  agents: 'try',
  launch: 'try',
  trade: 'try',
  city: 'try',
  search: 'try',
  chart: 'try',
  assistant: 'ask',
  quarter: 'home',
  spot: 'try',
  beacons: 'try',
  money: 'try',
};

/** The functions open here, in the page's order: each one whose every switch is open. */
export function liveGuides(flags: GuideFlags): readonly GuideId[] {
  return GUIDE_IDS.filter((id) => GUIDE_NEEDS[id].every((flag) => flags[flag]));
}

export type Lesson = Readonly<{ id: GuideId; film: GuideFilm }>;

/** The lessons to show: a live function with its film. Nothing else — no film, no card. */
export function lessons(flags: GuideFlags, films: Films = FILMS): readonly Lesson[] {
  return liveGuides(flags).flatMap((id) => (films[id] ? [{ id, film: films[id] }] : []));
}

/** The raw values of the city's switches, as a deployment sets them (`NEXT_PUBLIC_RYNTRA_CITY_*`). */
export type CitySwitches = Readonly<{
  agents?: string;
  launch?: string;
  trade?: string;
  spot?: string;
  beacons?: string;
  money?: string;
}>;

/**
 * The switches read by the city's own rules — the same functions the menu at the bottom and the windows use — so a
 * test can set them. Launch counts only where the city may launch on mainnet (`CITY_LAUNCH_MAINNET`); a devnet stand
 * opens it in the city itself, where the engine names the network (`launchOpenHere`).
 */
export function guideFlags(raw: CitySwitches, launchOnMainnet: boolean = CITY_LAUNCH_MAINNET): GuideFlags {
  return {
    agents: raw.agents === 'open',
    launch: raw.launch === 'open' && launchOnMainnet,
    trade: tradeOpen(raw.trade),
    spot: spotOpen(raw.spot),
    beacons: beaconsMode(raw.beacons) !== 'closed',
    money: moneyOpen(raw.money),
  };
}

/** This build's switches, from the very constants the city reads. */
export const CITY_GUIDE_FLAGS: GuideFlags = {
  agents: AGENTS_OPEN,
  launch: CITY_LAUNCH_SWITCH && CITY_LAUNCH_MAINNET,
  trade: TRADE_OPEN,
  spot: SPOT_OPEN,
  beacons: BEACONS !== 'closed',
  money: MONEY_OPEN,
};

/** `?try=<id>` on the city's address: the function whose window opens once the city stands. */
export const TRY_PARAM = 'try';

/** The function a `?try=` asks for, when it is live here; anything else is ignored. */
export function tryParam(search: string, flags: GuideFlags = CITY_GUIDE_FLAGS): GuideId | null {
  const asked = new URLSearchParams(search).get(TRY_PARAM);
  return isGuideId(asked) && liveGuides(flags).includes(asked) ? asked : null;
}

/** The address «Try» leads to from the page: the city, opened on that function's window. */
export function tryHref(id: GuideId): string {
  return `/?${TRY_PARAM}=${id}`;
}

/** The address without `?try=`: the same page, its other query keys and its fragment kept. */
export function withoutTry(pathname: string, search: string, hash: string): string {
  const query = new URLSearchParams(search);
  query.delete(TRY_PARAM);
  const rest = query.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`;
}

/** The page of its own (CITY-43): the same lessons outside the city, for a link. */
export const HOW_PATH = '/how-it-works';
