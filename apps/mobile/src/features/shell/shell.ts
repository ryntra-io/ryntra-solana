/**
 * The shell as a value — pure. «Місто» first (CITY-6c, decision 70: Ryntra City is Ryntra's face — the page
 * `https://ryntra.io` in a WebView, the app's own wallet behind it), then the phone's bar of Menu 3, the core's own `PHONE_BAR` with C1's glyphs and brand bar: Головна · Торгівля · Гроші ·
 * Портфель · Меню. The app opens on «Місто»; the older places stay until CITY-13 clears them.
 * «Торгівля» opens on Ринки, the screener; Buy, Sell and Swap open over the bar as `/trade` from an asset, Home's
 * «Обмін» or a link. «Гроші» holds the four large actions Поповнити · Надіслати · Отримати · Між мережами. «Меню»
 * opens Menu 3 — the same groups as the web, with the rows that live in the phone. The places older shells
 * drew (Термінал, Trade, Strategies, the Agent, the «+», «Платежі», «Ще») keep their addresses, so a saved link, a
 * receipt and a push land where they belong.
 */

import type { Copy } from '../../lib/i18n.ts'
import { coreNav } from './core-nav.ts'

/** The places of the bar: «Місто», then the core's own ids. */
export type ShellTab = 'city' | (typeof coreNav.phoneBar)[number]

/** What the bar says under each place — the core's words, so the phone's bar and the web's menu name them alike. */
export const TAB_TITLES: Copy<Readonly<Record<ShellTab, string>>> = {
  en: {
    city: 'City',
    home: coreNav.words.en.items.home,
    trading: coreNav.words.en.groups.trading,
    money: coreNav.words.en.groups.money,
    portfolio: coreNav.words.en.items.portfolio,
    menu: coreNav.words.en.menu,
  },
  uk: {
    city: 'Місто',
    home: coreNav.words.uk.items.home,
    trading: coreNav.words.uk.groups.trading,
    money: coreNav.words.uk.groups.money,
    portfolio: coreNav.words.uk.items.portfolio,
    menu: coreNav.words.uk.menu,
  },
}

/**
 * The route file under `app/(tabs)` a place is drawn from. «Місто» is `index`, the address the app opens on and the
 * site's own `/` leads to; «Головна» is `home`. «Торгівля» is drawn from `markets` — its first segment,
 * and the address every screener link already names; a file named `trade` would collide with `/trade`, the ticket.
 * «Гроші» keeps `payments` and «Меню» keeps `more`: the addresses links, pushes and the launcher's actions name.
 */
export type ShellRoute = 'index' | 'home' | 'markets' | 'payments' | 'portfolio' | 'more'

export type ShellEntry = Readonly<{
  tab: ShellTab
  route: ShellRoute
  /** The row that builds the place has landed; an entry that is not ready is reserved, not drawn. */
  ready: boolean
}>

/** «Лаунч» — a row of the menu's «Торгівля». */
export const LAUNCH_PATH = '/launch'

export const SHELL: readonly ShellEntry[] = [
  { tab: 'city', route: 'index', ready: true },
  { tab: 'home', route: 'home', ready: true },
  { tab: 'trading', route: 'markets', ready: true },
  { tab: 'money', route: 'payments', ready: true },
  { tab: 'portfolio', route: 'portfolio', ready: true },
  { tab: 'menu', route: 'more', ready: true },
]

/** «Місто» — the first place, the app's own `/`. */
export const CITY_PATH = '/(tabs)'

/** «Головна». */
export const HOME_PATH = '/(tabs)/home'

/** «Торгівля» on its first segment, Ринки. */
export const TRADE_PATH = '/(tabs)/markets'
/** «Торгівля · Обмін»: the market swap of one token for another, a segment of the place. */
export const SWAP_PATH = '/(tabs)/markets?seg=swap'
/** «Гроші»: the place's file is still `payments`, the address every older link names. */
export const PAYMENTS_PATH = '/(tabs)/payments'
/** «Портфель». */
export const PORTFOLIO_PATH = '/(tabs)/portfolio'
/** «Портфель · Ордери»: the wallet's limit orders — where «Ордери», a note and a push lead. */
export const PORTFOLIO_ORDERS_PATH = '/(tabs)/portfolio?open=orders'
/** «Портфель · Історія»: the wallet's operations with their receipts — where «Квитанцію збережено» and «Уся історія» lead. */
export const PORTFOLIO_HISTORY_PATH = '/(tabs)/portfolio?open=history'
/**
 * The statement as a screen over the bar — what a row of «Меню» or «Гроші» opens, so Back returns to the row it was
 * opened from, never to Home as a switch of the bar's place would (ST-5). The same statement as «Портфель · Історія».
 */
export const HISTORY_PATH = '/history'
/** The older address of the wallet's limit orders; a link to it opens «Портфель · Ордери». */
export const ORDERS_PATH = '/orders'

/** A navigation state as the router keeps it — only what `barBeneathOf` reads. */
export type NavigationShape = Readonly<{
  routes?: readonly Readonly<{ name: string; state?: NavigationShape }>[]
}>

/**
 * Whether the bar stands in the app's own stack, beneath the screen in front. The container holds one route, the
 * router's `__root`, whose state is that stack; a state without it is the stack itself.
 */
export function barBeneathOf(root: NavigationShape | null | undefined): boolean {
  const only = root?.routes?.length === 1 ? root.routes[0] : undefined
  const stack = only && only.name === '__root' && only.state ? only.state : root
  return (stack?.routes ?? []).some((route) => route.name === '(tabs)')
}

/**
 * How a place of the bar is opened from where the person stands — `useOpenPlace` acts on it: inside the bar, the bar's
 * own switch; on a screen over the bar, the screens above it close; with no bar beneath (a link opened the app on a
 * screen), the screens close and the bar takes their place. Never a second bar over the first.
 */
export function placeMove(
  where: Readonly<{ inBar: boolean; barBeneath: boolean }>,
): 'navigate' | 'dismissTo' | 'replace' {
  if (where.inBar) return 'navigate'
  return where.barBeneath ? 'dismissTo' : 'replace'
}

/** «Портфель · Ордери» on the order a note named — the address a note's tap and an older `/orders?order=` lead to. */
export function portfolioOrdersPath(order: string | null): string {
  return order ? `${PORTFOLIO_ORDERS_PATH}&order=${encodeURIComponent(order)}` : PORTFOLIO_ORDERS_PATH
}

/** The places the bar draws, in order — never a reserved one. */
export function drawnTabs(shell: readonly ShellEntry[] = SHELL): readonly ShellEntry[] {
  return shell.filter((entry) => entry.ready)
}

/**
 * The bar's paths of the older shells that no longer exist, and where they
 * lead now. The deep-link mapper rewrites them, so a saved link keeps working;
 * no hidden screen is drawn for them.
 */
export const LEGACY_TAB_ROUTES = {
  '/(tabs)/trade': '/trade',
  '/(tabs)/strategies': '/bots',
  '/(tabs)/agent': '/ryn',
  '/(tabs)/create': LAUNCH_PATH,
  '/create': LAUNCH_PATH,
} as const

export type LegacyTabRoute = keyof typeof LEGACY_TAB_ROUTES

/** The one place that carries the wallet's unread count: the first, where attention lives. */
export const BADGE_TAB: ShellTab = 'home'

/** A badge as the bar draws it: nothing at zero, the count to nine, `9+` beyond. */
export function badgeOf(unread: number): string | number | undefined {
  if (!Number.isFinite(unread) || unread <= 0) return undefined
  return unread > 9 ? '9+' : Math.floor(unread)
}
