import { TERMINAL_MODE, terminalOpen, type TerminalMode } from './flag.ts';
import { BRIDGE_ON, BRIDGE_PATH, CITY_PATH, COIN_PATH, HOME_PAGE, HOME_PATH, REWARDS_PATH, SHELVES, shelfOn, type ShelfId, type Shelves } from './shelves.ts';

/**
 * The terminal as the home page (decision 105): with the switch open, `/` is the Market and the city moves to `/city`.
 * Every address that led into the city — the old interface's, the short ones a person types, a coin's `/c/<mint>`, the
 * links in posts, notes and reports (`/?open=<window>`) — leads to the terminal's section that does the same work, in
 * one hop. What the terminal has no shelf for yet (Futures, Predictions, Settings) keeps opening its window in the city,
 * which still works at its own address. With the switch closed none of this applies: `/` is the city.
 *
 * Pure data and pure functions, no imports but the switch and the shelves: the build's config and the address layer
 * (`middleware.ts`) read this file before anything is compiled.
 */

/** The city's windows an address may name (`/?open=<window>`), each with the shelf that does the same work. */
const WINDOW_SHELF: Readonly<Record<string, ShelfId | null>> = {
  trade: 'swap',
  exchange: 'futures',
  oracle: 'predict',
  mine: 'portfolio',
  launch: 'launch',
  launches: 'launch',
  harbor: 'earn',
  earn: 'earn',
  agents: 'agents',
  agent: 'agents',
  assistant: 'agents',
  /* The Hall is «Rewards», a page of the Portfolio shelf at its own address (`WINDOW_PAGE`). */
  hall: 'portfolio',
  /* The terminal has no Settings: it stays the city's window. */
  settings: null,
};

/** A window whose work is a page of a shelf at an address of its own, not the shelf's: the city's «Hall» is «Rewards». */
const WINDOW_PAGE: Readonly<Record<string, Readonly<{ shelf: ShelfId; path: string }>>> = { hall: { shelf: 'portfolio', path: REWARDS_PATH } };

/** Money's tabs: the bridge is the Swap shelf's (its own page, where it is open); sending, topping up and the history are the Portfolio's. */
const MONEY_SHELF: Readonly<Record<string, ShelfId>> = { bridge: 'swap', send: 'portfolio', topup: 'portfolio', activity: 'portfolio' };

/** The shelf a city window opens in the terminal, or null when the city keeps it. */
export function shelfOfWindow(window: string, tab: string | null = null): ShelfId | null {
  if (window === 'money') return (tab && MONEY_SHELF[tab]) || 'portfolio';
  return WINDOW_SHELF[window] ?? null;
}

/** The address of a shelf that is on, or null: a shelf that is not on leaves its work to the city. */
function shelfPath(id: ShelfId | null, mode: TerminalMode, shelves: Shelves): string | null {
  if (!id || !shelfOn(id, mode, shelves)) return null;
  return id === 'market' ? HOME_PATH : shelves[id].path;
}

/** Where a city window opens in the terminal, or null when the city keeps it: its page, else its shelf, while that shelf is on. */
function windowPath(window: string, tab: string | null, mode: TerminalMode, shelves: Shelves): string | null {
  const page = WINDOW_PAGE[window];
  if (page) return shelfOn(page.shelf, mode, shelves) ? page.path : null;
  return shelfPath(shelfOfWindow(window, tab), mode, shelves);
}

/** A city address that names a window (`/?open=…&…`), led into the city at its own address with the same ask. */
function inCity(query: string): string {
  return `${CITY_PATH}${query ? `?${query}` : ''}`;
}

/**
 * Where a destination of the city's redirect table leads once the terminal is the home page. A coin's tower is the
 * coin's screen; the city's home is the Market; a window is its shelf, or the city's window where no shelf does its work;
 * a document of the site stays where it is. An origin in front (the application host's rows) is kept.
 */
export function terminalDestination(destination: string, mode: TerminalMode = TERMINAL_MODE, shelves: Shelves = SHELVES, bridgeOn: boolean = BRIDGE_ON): string {
  const origin = destination.match(/^https?:\/\/[^/]+/)?.[0] ?? '';
  const local = destination.slice(origin.length) || '/';
  if (local === '/c/:mint') return shelfOn('market', mode, shelves) ? `${origin}${COIN_PATH}/:mint` : destination;
  if (local === '/') return destination;
  if (!local.startsWith('/?')) return destination;
  const query = new URLSearchParams(local.slice(2));
  const window = query.get('open');
  if (!window) return destination;
  // The bridge has its own page in «Trade» where money moves between networks.
  if (window === 'money' && query.get('tab') === 'bridge' && bridgeOn && shelfOn('swap', mode, shelves)) return `${origin}${BRIDGE_PATH}`;
  const own = windowPath(window, query.get('tab'), mode, shelves);
  // The query keeps its `:eventId` and the like as Next writes them: rebuilt by hand, never re-encoded.
  return `${origin}${own ?? inCity(local.slice(2))}`;
}

/** The short addresses that name the city itself. */
const CITY_SOURCES: ReadonlySet<string> = new Set([CITY_PATH, '/map']);

/** SOL's mint: the coin the menu's «Spot» opens. */
export const SPOT_MINT = 'So11111111111111111111111111111111111111112';

/**
 * The menu's «Spot» (decision 109): the trading desk of SOL, the Market's coin screen. The addresses that name the spot —
 * the short `/spot` a person types, and the old interface's spot page with no coin in its address — open the same desk
 * the menu does, not Swap: the city led them to its one trade window, which in the terminal is two screens.
 */
export const SPOT_HREF = `${COIN_PATH}/${SPOT_MINT}`;
const SPOT_SOURCE = /^(?:\/spot|(?:\/uk)?\/app\/spot(?:\/:path\*)?|\/solana\/workspace\/spot(?:\/:path\*)?)$/;

/** Whether a row of the city's table names the spot itself — not a coin read from its query, which opens that coin. */
function namesSpot(row: Row): boolean {
  return SPOT_SOURCE.test(row.source) && !row.has?.some((c) => c.type === 'query');
}

type Condition = Readonly<{ type: string; key?: string; value?: string }>;
type Row = Readonly<{ source: string; destination: string; permanent: boolean; has?: readonly Condition[]; missing?: readonly Condition[] }>;

/**
 * The city's redirect table as the terminal's home page needs it: each row's destination led to its section; the short
 * `/city` — which led to the city's home at `/` — gone, since the city stands at `/city` now, and `/map` leading there. With the switch
 * closed the table is returned as it is.
 */
export function asTerminalHome<T extends Row>(rows: readonly T[], mode: TerminalMode = TERMINAL_MODE, shelves: Shelves = SHELVES): T[] {
  if (!terminalOpen(mode)) return [...rows];
  const hosted = (row: Row) => Boolean(row.has?.some((c) => c.type === 'host'));
  return rows
    .filter((row) => !(row.source === CITY_PATH && !hosted(row)))
    .map((row) => {
      // The city's own short addresses (`/city` on the application's host, `/map`) lead to the city where it stands now.
      const origin = row.destination.match(/^https?:\/\/[^/]+/)?.[0] ?? '';
      if (CITY_SOURCES.has(row.source)) return { ...row, destination: `${origin}${CITY_PATH}`, permanent: false };
      if (namesSpot(row) && shelfOn('market', mode, shelves)) return { ...row, destination: `${origin}${SPOT_HREF}`, permanent: false };
      const destination = terminalDestination(row.destination, mode, shelves);
      // A row that led into the city for good now leads to a section that may still move: never a 308 it cannot take back.
      return destination === row.destination ? row : { ...row, destination, permanent: false };
    });
}

export type HomeRedirect = { source: string; destination: string; permanent: false };

/** A Solana mint, as a path segment captures it (the same pattern as the city's table). */
const MINT = '[1-9A-HJ-NP-Za-km-z]{32,44}';

/**
 * The terminal's own rows while it is the home page, ahead of the city's table: the Market's page folder leads to `/`;
 * a coin's shared link `/c/<mint>` opens the coin's screen (its card stays at `/c/<mint>/opengraph-image`); «Launched on
 * Ryntra» opens Launch. Each for now (307): a browser keeps a 308 forever, and the switch may yet be turned back.
 */
export function terminalHomeRedirects(mode: TerminalMode = TERMINAL_MODE, shelves: Shelves = SHELVES): HomeRedirect[] {
  if (!terminalOpen(mode) || !shelfOn('market', mode, shelves)) return [];
  const rows: HomeRedirect[] = [
    { source: HOME_PAGE, destination: HOME_PATH, permanent: false },
    { source: `/c/:mint(${MINT})`, destination: `${COIN_PATH}/:mint`, permanent: false },
  ];
  const launch = shelfPath('launch', mode, shelves);
  if (launch) rows.push({ source: '/launches', destination: launch, permanent: false }, { source: '/uk/launches', destination: launch, permanent: false });
  return rows;
}

/** `/` answers with the Market's page while the terminal is open; with the switch closed, the city's home stands. */
export function terminalHomeRewrites(mode: TerminalMode = TERMINAL_MODE, shelves: Shelves = SHELVES): { source: string; destination: string }[] {
  if (!terminalOpen(mode) || !shelfOn('market', mode, shelves)) return [];
  return [{ source: HOME_PATH, destination: HOME_PAGE }];
}

/**
 * A link to the home page that asks the city for something (`/?open=<window>`, `/?coin=<mint>`): the section that does
 * it, or the city at its own address with the same ask. Null when the home page is just the Market. Read by the address
 * layer (`middleware.ts`), which keeps the rest of the query.
 */
export function homeAsk(search: string, mode: TerminalMode = TERMINAL_MODE, shelves: Shelves = SHELVES): Readonly<{ path: string; drop: readonly string[] }> | null {
  if (!terminalOpen(mode) || !shelfOn('market', mode, shelves)) return null;
  const query = new URLSearchParams(search);
  const coin = query.get('coin');
  if (coin && new RegExp(`^${MINT}$`).test(coin)) return { path: `${COIN_PATH}/${coin}`, drop: ['coin'] };
  const window = query.get('open');
  if (!window) return null;
  const own = windowPath(window, query.get('tab'), mode, shelves);
  // The city keeps the ask whole: its window reads `open`, `tab`, `market` and `page` from its own address.
  return own ? { path: own, drop: ['open', 'tab', 'market', 'page'] } : { path: CITY_PATH, drop: [] };
}

/** The city's own home address: `/city` once the terminal is the home page, `/` until then. */
export function cityHome(mode: TerminalMode = TERMINAL_MODE, shelves: Shelves = SHELVES): string {
  return terminalOpen(mode) && shelfOn('market', mode, shelves) ? CITY_PATH : HOME_PATH;
}
