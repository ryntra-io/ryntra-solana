import { MONEY_OPEN } from '../../city/lib/money/flag.ts';
import { TERMINAL_MODE, terminalOpen, type TerminalMode } from './flag.ts';

/**
 * The terminal's shelves — its sections — with their addresses, in the rail's order.
 *
 * A shelf stands in the rail, in the phone's tab bar and in the agent's line only once its screen is ready: `ready` is
 * the one line a screen's change turns to `true`, in the same change that adds the screen. Until then nothing of the
 * shelf is drawn — no empty shelf, no «soon». Each shelf keeps its lines apart from its neighbours', so screens built at
 * the same time never edit the same line.
 *
 * `path` is the screen's own address: its page is `app/(terminal)<path>/page.tsx`. Every screen stands in one frame
 * (`app/(terminal)/layout.tsx`), so moving between shelves is a navigation inside the page, and the browser's Back walks
 * the same history.
 *
 * Pure data and pure functions, no imports but the switches (the terminal's, and money's for the bridge): the build's config reads this file before anything is
 * compiled (`next.config.ts`: a shelf that is on takes its own short address back from the city).
 */

export const SHELF_IDS = ['market', 'swap', 'futures', 'predict', 'earn', 'agents', 'launch', 'portfolio'] as const;
export type ShelfId = (typeof SHELF_IDS)[number];

/**
 * `also`: more addresses that are the shelf's own — a screen of the shelf at an address of its own (the Swap shelf's bridge,
 * once it has its page; the Agents shelf's bots): the city's old redirect from it gives way, as from the shelf's own address.
 */
export type ShelfEntry = Readonly<{ path: `/${string}`; ready: boolean; also?: readonly `/${string}`[] }>;
export type Shelves = Readonly<Record<ShelfId, ShelfEntry>>;

/**
 * The bridge's own page in «Trade»: the Swap shelf's, while the engine lets money move between networks (the
 * page answers 404 otherwise, and the old `/bridge` keeps leading where it did).
 */
export const BRIDGE_PATH = '/bridge';
export const BRIDGE_ON: boolean = MONEY_OPEN;
const BRIDGE_ALSO: readonly `/${string}`[] = BRIDGE_ON ? [BRIDGE_PATH] : [];

/**
 * The bots' pages: each bot a screen of its own at `/bots/<bot>`, on the Agents shelf as the menu places them
 * (decision 109) — so the city's old redirect from `/bots` gives way while the shelf is on.
 */
export const BOTS_ALSO: readonly `/${string}`[] = ['/bots'];

/**
 * Meteora DLMM Pro: the list of its pools at `/pro` and a pool's own desk at `/pool/<address>` — pages of the
 * Earn shelf at addresses of their own.
 */
export const PRO_PATH = '/pro';
export const POOL_PATH = '/pool';
const EARN_ALSO: readonly `/${string}`[] = [PRO_PATH, POOL_PATH];

/** «Money» — send, receive, invoices — is the Portfolio shelf's own page: the city's old `/money` gives way to it. */
export const MONEY_PATH = '/money';
const MONEY_ALSO: readonly `/${string}`[] = [MONEY_PATH];

/**
 * «Rewards» — points, rank, cashback and the link to invite a friend — is a page of the Portfolio shelf, at its own
 * address: a wallet's own figures. With the shelf on it takes `/rewards` back from the city's «Hall».
 */
export const REWARDS_PATH = '/rewards';
const PORTFOLIO_ALSO: readonly `/${string}`[] = [...MONEY_ALSO, REWARDS_PATH];

export const SHELVES: Shelves = {
  market: {
    path: '/market',
    ready: true,
  },
  swap: {
    path: '/swap',
    ready: true,
    also: BRIDGE_ALSO,
  },
  futures: {
    path: '/futures',
    ready: false,
  },
  predict: {
    path: '/predictions',
    ready: false,
  },
  earn: {
    path: '/earn',
    ready: true,
    also: EARN_ALSO,
  },
  agents: {
    path: '/agent',
    ready: true,
    also: BOTS_ALSO,
  },
  launch: {
    path: '/launch',
    ready: true,
  },
  portfolio: {
    path: '/portfolio',
    ready: true,
    also: PORTFOLIO_ALSO,
  },
};

/** A coin's own screen belongs to the Market: `/coin/<mint>`. */
export const COIN_PATH = '/coin';

/**
 * The home page. Once the terminal is open it is the Market: `/` answers with the Market's page, whose own folder stays
 * `app/(terminal)/market` (`next.config.ts` rewrites `/` to it, and `/market` leads back to `/`). With the switch
 * closed `/` is the city, as it always was.
 */
export const HOME_PATH = '/';

/** The page the home address is served from, while the terminal is open. */
export const HOME_PAGE = '/market';

/** Where the city lives once the terminal is the home page; the rail's «City» leads there. */
export const CITY_PATH = '/city';

/** The kit page: the rail with every shelf in its preview state and every part of the kit (a stand only). */
export const KIT_PATH = '/terminal/kit';

/** The phone's five tabs, the agent in the middle; the rest of the menu stands in the sheet the mark in its header opens. */
export const PHONE_TABS = ['market', 'swap', 'agents', 'earn', 'portfolio'] as const satisfies readonly ShelfId[];
export const PHONE_CENTER: ShelfId = 'agents';

/**
 * What the frame shows: `live` — the shelves that are on, at their own addresses; `preview` — on the kit page, every
 * shelf, each at its preview address inside the kit.
 */
export type View = 'live' | 'preview';

export function isShelfId(value: unknown): value is ShelfId {
  return typeof value === 'string' && (SHELF_IDS as readonly string[]).includes(value);
}

/** Whether a shelf is on: the switch is open and its screen is ready. */
export function shelfOn(id: ShelfId, mode: TerminalMode = TERMINAL_MODE, shelves: Shelves = SHELVES): boolean {
  return terminalOpen(mode) && shelves[id].ready;
}

/** The shelves the frame draws, in the rail's order. */
export function shelvesShown(view: View, mode: TerminalMode = TERMINAL_MODE, shelves: Shelves = SHELVES): ShelfId[] {
  return SHELF_IDS.filter((id) => view === 'preview' || shelfOn(id, mode, shelves));
}

/** A shelf's address in this view: the Market is the home page. */
export function shelfHref(id: ShelfId, view: View, shelves: Shelves = SHELVES): string {
  if (view === 'preview') return `${KIT_PATH}/${id}`;
  return id === 'market' && shelves.market.path === HOME_PAGE ? HOME_PATH : shelves[id].path;
}

/** A coin's own screen, in this view (the kit has one preview of the Market for every coin). */
export function coinHref(mint: string, view: View): string {
  return view === 'preview' ? `${KIT_PATH}/market` : `${COIN_PATH}/${encodeURIComponent(mint)}`;
}

function trimmed(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? '';
  return path.length > 1 ? path.replace(/\/+$/, '') : path || '/';
}

export function isKitPath(pathname: string): boolean {
  const path = trimmed(pathname);
  return path === KIT_PATH || path.startsWith(`${KIT_PATH}/`);
}

export function viewOf(pathname: string): View {
  return isKitPath(pathname) ? 'preview' : 'live';
}

/** The shelf an address belongs to, or null: its own address and the addresses under it; a coin's screen is the Market's. */
export function shelfAt(pathname: string, shelves: Shelves = SHELVES): ShelfId | null {
  const path = trimmed(pathname);
  if (isKitPath(path)) {
    const id = path.slice(KIT_PATH.length + 1).split('/')[0];
    return isShelfId(id) ? id : null;
  }
  if (path === HOME_PATH || path === COIN_PATH || path.startsWith(`${COIN_PATH}/`)) return 'market';
  for (const id of SHELF_IDS) {
    for (const own of [shelves[id].path, ...(shelves[id].also ?? [])]) if (path === own || path.startsWith(`${own}/`)) return id;
  }
  return null;
}

/** The addresses a shelf answers at: its own and its `also`, and for the Market every coin's (the home page `/` is the Market's too). */
export function ownAddresses(id: ShelfId, shelves: Shelves = SHELVES): string[] {
  return id === 'market' ? [shelves.market.path, COIN_PATH, ...(shelves.market.also ?? [])] : [shelves[id].path, ...(shelves[id].also ?? [])];
}

type RedirectRow = Readonly<{ source: string; has?: readonly Readonly<{ type: string }>[] }>;

/**
 * Whether a row of the city's redirects (`city/lib/open/old-addresses.ts`) stands on the address of a shelf that is on:
 * the row gives way, and the address opens the shelf. Only on ryntra.io — a row bound to another host is that host's own.
 * With the switch closed, or no shelf ready, no row gives way.
 */
export function takenByTerminal(row: RedirectRow, mode: TerminalMode = TERMINAL_MODE, shelves: Shelves = SHELVES): boolean {
  if (!terminalOpen(mode) || row.has?.some((condition) => condition.type === 'host')) return false;
  return SHELF_IDS.some(
    (id) => shelfOn(id, mode, shelves) && ownAddresses(id, shelves).some((own) => row.source === own || row.source.startsWith(`${own}/`)),
  );
}
