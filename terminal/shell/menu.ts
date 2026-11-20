import { terminalOpen, TERMINAL_MODE, type TerminalMode } from './flag.ts';
import { PARTNERS_OPEN } from '../rewards/partners.ts';
import { BRIDGE_PATH, COIN_PATH, HOME_PAGE, HOME_PATH, isKitPath, KIT_PATH, POOL_PATH, PRO_PATH, REWARDS_PATH, shelfAt, shelfHref, shelfOn, SHELVES, type ShelfId, type View } from './shelves.ts';

/**
 * The menu: the Market on top, then the groups — Trade · Launch · Bots · Agents · Earn
 * · Portfolio · Money · Rewards — each with its items, in this one list. The rail, its folded icons and the phone's sheet
 * all draw from it.
 *
 * An item stands only once its screen is ready (decision 105, p. 2): `ready` is the one line a new screen turns to
 * `true`, in the change that builds it — with its address, which is that screen's to choose. An item of a shelf also needs its shelf on; a group with no item standing is not
 * drawn at all — no empty group, no «soon».
 *
 * An item inside the terminal is an address of a screen that already is: the screen itself, or one of its tabs
 * (`?tab=`), a panel (`?act=`) or a place on it (`#…`). An item outside (`out`) opens in a new tab with an arrow that
 * says so: Futures and Predictions lead to RXN for now, until shelves
 * of their own take their place.
 *
 * Pure data and pure functions: the tests read it as it is.
 */

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** Futures and Predictions on RXN. RXN reads no mark of ours, so the links carry none. */
export const RXN_FUTURES = 'https://rxn.gg/trade';
export const RXN_PREDICTIONS = 'https://rxn.gg/trade?tab=predictions';

/** The bridge: its own page in «Trade». */
export const BRIDGE_HREF = BRIDGE_PATH;

export type MenuGroupId = 'trade' | 'launch' | 'bots' | 'agents' | 'earn' | 'portfolio' | 'money' | 'rewards';

export type MenuItemId =
  | 'market'
  | 'swap'
  | 'spot'
  | 'futures'
  | 'predict'
  | 'bridge'
  | 'launchNew'
  | 'launchMine'
  | 'launchFresh'
  | 'allBots'
  | 'recurring'
  | 'grid'
  | 'ladder'
  | 'copy'
  | 'signals'
  | 'keeper'
  | 'autopilot'
  | 'aiTrader'
  | 'scout'
  | 'analyst'
  | 'ownAi'
  | 'pools'
  | 'dlmmPro'
  | 'staking'
  | 'lending'
  | 'earnMine'
  | 'overview'
  | 'positions'
  | 'history'
  | 'saved'
  | 'send'
  | 'receive'
  | 'invoices'
  | 'private'
  | 'contacts'
  | 'autopay'
  | 'points'
  | 'invite'
  | 'partners';

/**
 * An engine's own door an item waits for, besides its shelf: the money flows this deployment runs, the engines of the
 * bots — the mandate's (Recurring buys), the ladder's network, the money autopilot's switch.
 */
export type MenuGate = 'send' | 'deposit' | 'bridge' | 'trader' | 'ladder' | 'pilot';

type ItemBase = Readonly<{ id: MenuItemId; ready: boolean }>;
/** An item inside the terminal: a shelf's screen at `href` (a path of the shelf, with its tab, panel or place). */
export type InnerItem = ItemBase & Readonly<{ shelf: ShelfId; href: string; gate?: MenuGate }>;
/** An item outside the terminal: another site, in a new tab. */
export type OuterItem = ItemBase & Readonly<{ out: string }>;
export type MenuItem = InnerItem | OuterItem;
export type MenuGroup = Readonly<{ id: MenuGroupId; items: readonly MenuItem[]; count?: 'bots' }>;

const inner = (id: MenuItemId, shelf: ShelfId, href: string, ready: boolean, extra: Readonly<{ gate?: MenuGate }> = {}): InnerItem => ({ id, shelf, href, ready, ...extra });
const outer = (id: MenuItemId, out: string, ready: boolean): OuterItem => ({ id, out, ready });

/** The Market — the home page, above the groups. */
export const MARKET_ITEM: InnerItem = inner('market', 'market', HOME_PATH, true);

/**
 * The groups and their items, in the rail's order. Turning an item on is its `ready`; an item without a screen yet keeps
 * `false` and its place, so the order of the menu is decided once.
 */
export const MENU: readonly MenuGroup[] = [
  {
    id: 'trade',
    items: [
      inner('swap', 'swap', '/swap', true),
      inner('spot', 'market', `${COIN_PATH}/${SOL_MINT}`, true),
      outer('futures', RXN_FUTURES, true),
      outer('predict', RXN_PREDICTIONS, true),
      inner('bridge', 'swap', BRIDGE_HREF, true, { gate: 'bridge' }),
    ],
  },
  {
    id: 'launch',
    // The menu's items are the screen's tabs, by the same names and in their order: «New» —
    // the market's new coins — too.
    items: [inner('launchNew', 'launch', '/launch', true), inner('launchMine', 'launch', '/launch?tab=mine', true), inner('launchFresh', 'launch', '/launch?tab=fresh', true)],
  },
  {
    id: 'bots',
    count: 'bots',
    // A bot is a rule, not an AI (decision 109, p. 3): each a screen of its own under /bots, on the Agents shelf.
    // «All bots» — the catalogue, the section's first tab — first, as the tabs stand.
    items: [
      inner('allBots', 'agents', '/bots', true),
      inner('recurring', 'agents', '/bots/recurring', true, { gate: 'trader' }),
      inner('grid', 'agents', '/bots/grid', true),
      inner('ladder', 'agents', '/bots/ladder', true, { gate: 'ladder' }),
      inner('copy', 'agents', '/bots/copy', false),
      inner('signals', 'agents', '/bots/signals', true),
      inner('keeper', 'agents', '/bots/keeper', false),
      inner('autopilot', 'agents', '/bots/autopilot', true, { gate: 'pilot' }),
    ],
  },
  {
    id: 'agents',
    items: [
      inner('aiTrader', 'agents', '/agent?ai=trader', false),
      inner('scout', 'agents', '/agent?ai=scout', false),
      // The analyst: a question about any coin or the market, and Ryntra's answer — the Agents screen.
      inner('analyst', 'agents', '/agent', true),
      inner('ownAi', 'agents', '/agent?ai=own', false),
    ],
  },
  {
    id: 'earn',
    // Meteora DLMM Pro: the list of its pools, each opening its own desk at /pool/<address>. Every tab of
    // «Earn» has its item: the menu lights the tab that is open, «My positions» too.
    items: [
      inner('pools', 'earn', '/earn', true),
      inner('dlmmPro', 'earn', PRO_PATH, true),
      inner('staking', 'earn', '/earn?tab=staking', true),
      inner('lending', 'earn', '/earn?tab=lending', true),
      inner('earnMine', 'earn', '/earn?tab=mine', true),
    ],
  },
  {
    id: 'portfolio',
    items: [
      inner('overview', 'portfolio', '/portfolio', true),
      inner('positions', 'portfolio', '/portfolio#positions', true),
      inner('history', 'portfolio', '/portfolio#history', true),
      // The Market's «Saved» tab.
      inner('saved', 'market', '/?tab=saved', true),
    ],
  },
  {
    id: 'money',
    items: [
      // «Money»: one page, its tabs; «Send» stands only where money may move. The rest come with their screens.
      inner('send', 'portfolio', '/money', true, { gate: 'send' }),
      inner('receive', 'portfolio', '/money?tab=receive', true),
      inner('invoices', 'portfolio', '/money?tab=invoices', true),
      inner('private', 'portfolio', '/money?tab=private', false),
      inner('contacts', 'portfolio', '/money?tab=contacts', false),
      inner('autopay', 'portfolio', '/money?tab=autopay', false),
    ],
  },
  {
    id: 'rewards',
    // «Rewards»: one page of the Portfolio shelf with its tabs; «For partners» only while the programme is open.
    items: [
      inner('points', 'portfolio', REWARDS_PATH, true),
      inner('invite', 'portfolio', `${REWARDS_PATH}?tab=invite`, true),
      inner('partners', 'portfolio', `${REWARDS_PATH}?tab=partners`, PARTNERS_OPEN),
    ],
  },
];

export const MENU_GROUP_IDS: readonly MenuGroupId[] = MENU.map((group) => group.id);

export function isOuter(item: MenuItem): item is OuterItem {
  return 'out' in item;
}

/** Every door an item may wait for, open: the kit page and the tests. */
export const EVERY_DOOR = (): boolean => true;

/** Whether an item stands: its screen is ready, its shelf is on (an outside item — the terminal is), its engine door open. */
export function itemShown(item: MenuItem, view: View, door: (gate: MenuGate) => boolean = EVERY_DOOR, mode: TerminalMode = TERMINAL_MODE): boolean {
  if (!item.ready) return false;
  if (isOuter(item)) return view === 'preview' || terminalOpen(mode);
  if (item.gate && !door(item.gate)) return false;
  return view === 'preview' || shelfOn(item.shelf, mode, SHELVES);
}

/** The groups the frame draws, each with only the items that stand; a group with none is left out. */
export function menuShown(view: View, door: (gate: MenuGate) => boolean = EVERY_DOOR, mode: TerminalMode = TERMINAL_MODE, menu: readonly MenuGroup[] = MENU): MenuGroup[] {
  return menu.flatMap((group) => {
    const items = group.items.filter((item) => itemShown(item, view, door, mode));
    return items.length ? [{ ...group, items }] : [];
  });
}

/** An item's address in this view: the kit page has one preview a shelf. */
export function itemHref(item: MenuItem, view: View): string {
  if (isOuter(item)) return item.out;
  if (view === 'preview') return `${KIT_PATH}/${item.shelf}`;
  return item.id === 'market' ? shelfHref('market', 'live') : item.href;
}

type Where = Readonly<{ path: string; query: URLSearchParams; hash: string }>;

function whereOf(href: string): Where {
  const hashAt = href.indexOf('#');
  const hash = hashAt >= 0 ? href.slice(hashAt) : '';
  const rest = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const queryAt = rest.indexOf('?');
  const raw = queryAt >= 0 ? rest.slice(0, queryAt) : rest;
  const path = raw.length > 1 ? raw.replace(/\/+$/, '') : raw || '/';
  return { path: path === HOME_PAGE ? HOME_PATH : path, query: new URLSearchParams(queryAt >= 0 ? rest.slice(queryAt + 1) : ''), hash: hash === '#' ? '' : hash };
}

/** How closely an item's address names the place: -1 — not this place; else how many of its marks the place has. */
function fit(item: InnerItem, here: Where): number {
  const own = whereOf(item.href);
  if (own.path !== here.path) return -1;
  let marks = 0;
  for (const [key, value] of own.query) {
    if (here.query.get(key) !== value) return -1;
    marks += 1;
  }
  if (own.hash) {
    if (own.hash !== here.hash) return -1;
    marks += 1;
  }
  return marks;
}

/**
 * The item the person is at, among the items shown: the one whose address names the place most closely; a coin's own
 * screen is the Spot; a screen's own tab that has no item of its own lights the screen's first item. `tail` is the
 * address's query and fragment (`?tab=mine#x`), as the browser holds them.
 */
export function itemAt(pathname: string, tail: string, shown: readonly MenuGroup[], marketShown = true, poolKind: 'pro' | 'other' | null = null): MenuItemId | null {
  const here = whereOf(`${pathname}${tail}`);
  const items = shown.flatMap((group) => group.items).filter((item): item is InnerItem => !isOuter(item));
  if (isKitPath(here.path)) {
    const shelf = shelfAt(here.path);
    if (shelf === 'market' && marketShown) return 'market';
    return items.find((item) => item.shelf === shelf)?.id ?? null;
  }
  if (here.path === HOME_PATH) {
    const best = closest(items, here);
    return best ?? (marketShown ? 'market' : null);
  }
  if (here.path === COIN_PATH || here.path.startsWith(`${COIN_PATH}/`)) return items.some((item) => item.id === 'spot') ? 'spot' : marketShown ? 'market' : null;
  // A pool's own desk: a DLMM or DAMM v2 pool lights «Pools»; a DLMM Pro pool, and one whose kind is not read yet, DLMM Pro.
  if (here.path.startsWith(`${POOL_PATH}/`)) {
    const own: MenuItemId = poolKind === 'other' ? 'pools' : 'dlmmPro';
    return items.some((item) => item.id === own) ? own : null;
  }
  const exact = closest(items, here);
  if (exact) return exact;
  const shelf = shelfAt(here.path);
  return items.find((item) => item.shelf === shelf && whereOf(item.href).path === here.path)?.id ?? null;
}

function closest(items: readonly InnerItem[], here: Where): MenuItemId | null {
  let found: MenuItemId | null = null;
  let most = -1;
  for (const item of items) {
    const marks = fit(item, here);
    if (marks > most) {
      most = marks;
      found = item.id;
    }
  }
  return found;
}

/** The group an item stands in; null for the Market. */
export function groupOf(id: MenuItemId, menu: readonly MenuGroup[] = MENU): MenuGroupId | null {
  return menu.find((group) => group.items.some((item) => item.id === id))?.id ?? null;
}
