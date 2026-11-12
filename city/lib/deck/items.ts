import type { ExchangeMode } from '../exchange/flag.ts';

/**
 * The city's menu, the Deck: seven places on fixed
 * spots — Launch · Exchange · Earn on the left, Agents the diamond in the middle, Arena · Guard · Money on the right. A
 * place whose switch is closed stays on its spot with «Soon»; nothing moves when it opens. Exchange, Agents and the Arena
 * open a tray of their open doors — a door not open yet is not shown (CITY-188: no row of «Soon»), a tray with one open
 * door opens it straight away, and a tray with none is a shut place. The Exchange's place keeps its id `spot` (addresses,
 * tests, the phone's shots).
 */

export type Place = 'launch' | 'spot' | 'earn' | 'agents' | 'arena' | 'guard' | 'money';

export const LEFT = ['launch', 'spot', 'earn'] as const satisfies readonly Place[];
export const CENTER = 'agents' as const satisfies Place;
export const RIGHT = ['arena', 'guard', 'money'] as const satisfies readonly Place[];
export const PLACES: readonly Place[] = [...LEFT, CENTER, ...RIGHT];

export type Door = 'swap' | 'spot' | 'futures' | 'hangar' | 'bots' | 'garage' | 'ring' | 'hack' | 'vault';

/** The places that open a tray, and their doors in order. */
export const TRAYS = {
  // «Обмін»: Swap · Spot — the bridge is Money's Send to another network now (CITY-155);
  // Futures only as the door out to RXN, once it is live.
  spot: ['swap', 'spot', 'futures'],
  // The agents at work: the Ring's agent in its hangar (CITY-50), the bots (CITY-134), the garage agent (CITY-29).
  agents: ['hangar', 'bots', 'garage'],
  arena: ['ring', 'hack', 'vault'],
} as const satisfies Partial<Record<Place, readonly Door[]>>;

export type Tray = keyof typeof TRAYS;

export function isTray(place: Place): place is Tray {
  return place in TRAYS;
}

/**
 * Where Futures leads, if anywhere. A wallet that still holds something on Phoenix is led there first, to close out and
 * bring its collateral home; then RXN, once it is live; the whole Exchange only while its switch is still `open`. The
 * menu asks it without the holding (futures are off, 30.10): closing out lives in Money (`PhoenixLeft`).
 */
export type FuturesWay = 'exchange' | 'rxn' | null;

export function futuresWay(exchange: ExchangeMode, rxn: boolean, holds: boolean): FuturesWay {
  if (exchange !== 'closed' && holds) return 'exchange';
  if (rxn) return 'rxn';
  return exchange === 'open' ? 'exchange' : null;
}

/** The deployment's switches the places and doors stand on. */
export type Switches = Readonly<{
  launch: boolean;
  earn: boolean;
  guard: boolean;
  money: boolean;
  /** The tower's own trade window: Swap rides on it, Spot (limit and stop) has a switch of its own too. */
  trade: boolean;
  spot: boolean;
  futures: FuturesWay;
  hangar: boolean;
  bots: boolean;
  /** The garage agent's window (CITY-29). */
  garage: boolean;
  ring: boolean;
  hack: boolean;
  vault: boolean;
}>;

export function doorOpen(door: Door, on: Switches): boolean {
  switch (door) {
    case 'swap':
      return on.trade;
    case 'spot':
      return on.trade && on.spot;
    case 'futures':
      return on.futures !== null;
    default:
      return on[door];
  }
}

/** A tray's doors on screen: only the open ones, in order (Futures where it leads somewhere). */
export function doorsOf(tray: Tray, on: Switches): Door[] {
  return TRAYS[tray].filter((door) => doorOpen(door, on));
}

/**
 * The Arena's hint under the cursor: the names of its open doors only — «Ring and Vault», and «Ring, Hack and Vault»
 * once the Hack opens (CITY-236: the hint named the Hack behind a closed door). Null when no door is open.
 */
export function doorsHint(names: readonly string[], and: string): string | null {
  if (!names.length) return null;
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`;
}

/** A place is open when its switch is, or — for a tray — when any of its doors is; a shut tray is a shut place. */
export function placeOpen(place: Place, on: Switches): boolean {
  return isTray(place) ? TRAYS[place].some((door) => doorOpen(door, on)) : on[place];
}

/* ---------------------------------------------------------------- Hiding the top bar and the Deck */

/** What is shown of the frame: the top bar and the Deck, each hidden by its own arrow and kept on this device. */
export type Chrome = Readonly<{ top: boolean; bottom: boolean }>;

export const CHROME_KEY = 'ryntra.city.chrome.v1';
export const SHOWN: Chrome = { top: true, bottom: true };

/** The kept choice read back safely: anything broken shows both. */
export function readChrome(raw: string | null): Chrome {
  try {
    const value = JSON.parse(raw ?? 'null') as unknown;
    if (!value || typeof value !== 'object') return SHOWN;
    const { top, bottom } = value as Record<string, unknown>;
    return { top: top !== false, bottom: bottom !== false };
  } catch {
    return SHOWN;
  }
}

/** Nothing is kept while both are shown. */
export function writeChrome(chrome: Chrome): string | null {
  return chrome.top && chrome.bottom ? null : JSON.stringify(chrome);
}
