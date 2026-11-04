import { BEACONS } from '../beacon/switch.ts';
import { EARN_LOANS, EARN_OPEN } from '../earn/flag.ts';
import { EXCHANGE_SHOWN } from '../exchange/flag.ts';
import { FEED_KINDS, type FeedKind } from '../feed/settings.ts';
import { SPOT_OPEN, STOPS_ENGINE } from '../trade/gates.ts';

/**
 * The notification centre's kinds (CITY-87, `docs/research/ryntra-city-helm-2026-10-29/SPEC.md` §10): every kind of
 * note the city can tell, where each may go and where it starts. A kind is listed only where something real says it:
 *
 * - the market's five (the live feed, CITY-66) — the city reads them itself;
 * - your trades (the trade window), your stops (CITY-149) and your beacons (CITY-72) — the city sees them;
 * - Earn's four (CITY-100, `../earn/notes.ts`): a pool position out of range, the stock exchange's weekend, a dividend
 *   date — and a loan's health, Guard's like the liquidation risk — listed where Earn is open;
 * - the liquidation risk of a futures position (Phoenix's margin view, the Exchange) — Guard's (decision 88): never off,
 *   listed where the Exchange stands at all.
 *
 * Telegram is not a place the page chooses: Ryntra's server itself tells a connected Telegram about a reached stop it
 * keeps (the account's monitoring, where the engine keeps stops) and a lit beacon whose own Telegram switch is on (where
 * the server keeps beacons). The window marks those kinds and changes nothing there — a per-kind choice is the engine's.
 *
 * Earn's kinds are told by Ryntra's server too — it reads the wallet now and then and tells the phone and a connected
 * Telegram through the engine's own delivery (`../earn/notes-watch.ts`); the window marks them like the others.
 *
 * Another line adds its kinds here, one entry each, and says them with `notify()` (`./store.ts`).
 */

/** Where a note goes: a banner in the city (the live feed for a market kind), the computer's own notification, or nowhere. */
export const PLACES = ['city', 'desk', 'off'] as const;
export type Place = (typeof PLACES)[number];

/** The centre's groups, in the order the window lists them. */
export const GROUPS = ['market', 'yours', 'earn', 'safety'] as const;
export type NoteGroup = (typeof GROUPS)[number];

/** How often one kind may speak: every time, at most once in ten minutes, at most once an hour. */
export const CAPS = ['all', 'few', 'rare'] as const;
export type Cap = (typeof CAPS)[number];
export const CAP_WINDOW_MS: Readonly<Record<Cap, number>> = { all: 0, few: 10 * 60_000, rare: 60 * 60_000 };

export type NoteKind = FeedKind | 'trades' | 'stops' | 'beacons' | 'range' | 'weekend' | 'dividend' | 'liquidation' | 'loan';

export type KindSpec = Readonly<{
  id: NoteKind;
  group: NoteGroup;
  /** The places this kind can go, in the window's column order. */
  places: readonly Place[];
  /** Where it goes until the person chooses. */
  start: Place;
  /** How often it may speak until the person chooses. */
  cap: Cap;
  /** Never off, never muted, never held by quiet hours or a cap: the liquidation risk (decision 88). */
  locked: boolean;
  /** «In the city» for a market kind is the live feed (CITY-66), whose switch keeps whether it shows at all. */
  feed: FeedKind | null;
  /** In this build Ryntra's server can also tell a connected Telegram about it, whatever is chosen here. */
  telegram: boolean;
  /** Something in this deployment can say it: the window lists it only then. */
  door: boolean;
}>;

const MARKET: readonly KindSpec[] = FEED_KINDS.map((kind) => ({ id: kind, group: 'market', places: ['city', 'desk', 'off'], start: 'city', cap: 'few', locked: false, feed: kind, telegram: false, door: true }));

export const KINDS: readonly KindSpec[] = [
  ...MARKET,
  { id: 'trades', group: 'yours', places: ['city', 'desk', 'off'], start: 'city', cap: 'all', locked: false, feed: null, telegram: false, door: true },
  { id: 'stops', group: 'yours', places: ['city', 'desk', 'off'], start: 'city', cap: 'all', locked: false, feed: null, telegram: STOPS_ENGINE, door: SPOT_OPEN },
  // A beacon tells Telegram only when its own switch is on (`BeaconSheet`): the window asks the rules too.
  { id: 'beacons', group: 'yours', places: ['city', 'desk', 'off'], start: 'city', cap: 'all', locked: false, feed: null, telegram: BEACONS === 'open', door: BEACONS !== 'closed' },
  // Earn (CITY-100): the city tells them while Ryntra is open (`../earn/notes-source.ts`); Ryntra's server reads the
  // wallet now and then and tells the phone and Telegram (`../earn/notes-watch.ts`) — late at times, said in the «i».
  { id: 'range', group: 'earn', places: ['city', 'desk', 'off'], start: 'city', cap: 'all', locked: false, feed: null, telegram: EARN_OPEN, door: EARN_OPEN },
  { id: 'weekend', group: 'earn', places: ['city', 'desk', 'off'], start: 'city', cap: 'all', locked: false, feed: null, telegram: EARN_OPEN, door: EARN_OPEN },
  { id: 'dividend', group: 'earn', places: ['city', 'desk', 'off'], start: 'city', cap: 'all', locked: false, feed: null, telegram: EARN_OPEN, door: EARN_OPEN },
  // The city watches the margin while Ryntra is open (`sources.ts`); no server watcher tells Telegram about it yet.
  { id: 'liquidation', group: 'safety', places: ['city', 'desk'], start: 'city', cap: 'all', locked: true, feed: null, telegram: false, door: EXCHANGE_SHOWN },
  // A loan's health is Guard's like the liquidation risk: never off. Listed once Earn reads a loan (`EARN_LOANS`).
  { id: 'loan', group: 'safety', places: ['city', 'desk'], start: 'city', cap: 'all', locked: true, feed: null, telegram: EARN_OPEN && EARN_LOANS, door: EARN_OPEN && EARN_LOANS },
];

export const KIND_IDS: readonly NoteKind[] = KINDS.map((kind) => kind.id);

const BY_ID: ReadonlyMap<NoteKind, KindSpec> = new Map(KINDS.map((kind) => [kind.id, kind]));

export function kindOf(id: NoteKind): KindSpec {
  const spec = BY_ID.get(id);
  if (!spec) throw new Error(`No such kind of note: ${id}`);
  return spec;
}

export function isKind(value: unknown): value is NoteKind {
  return typeof value === 'string' && BY_ID.has(value as NoteKind);
}

/** The kinds of one group, in order. */
export function kindsIn(group: NoteGroup): readonly KindSpec[] {
  return KINDS.filter((kind) => kind.group === group);
}

/** The kinds of one group the window lists here: the ones something in this deployment can say. */
export function kindsShown(group: NoteGroup): readonly KindSpec[] {
  return kindsIn(group).filter((kind) => kind.door);
}
