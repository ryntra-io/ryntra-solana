/**
 * The shell as a value — pure. The current menu on a phone, the
 * web's own (`app/shell/domains.ts`, `mobileNavigation`): five places —
 * Головна · Ринки · + Лаунч · Портфель · Ще. The middle «+» is an action, not
 * a place: it opens «Запустити токен» over the bar. Ryntra is not a place in
 * the bar — «Спитати Ryntra» is a button on the screens, and a row of «Ще».
 * The tabs the older shells drew (Trade, Strategies, the Agent) keep their
 * routes as redirects, so a saved link lands where it should.
 */

import type { Copy } from '../../lib/i18n.ts'

export type ShellTab = 'home' | 'markets' | 'launch' | 'portfolio' | 'more'

/** What the bar says under each place — the web's words (`MENU_SECTIONS`, `MENU_ACTION.short`). */
export const TAB_TITLES: Copy<Readonly<Record<ShellTab, string>>> = {
  en: { home: 'Home', markets: 'Markets', launch: 'Launch', portfolio: 'Portfolio', more: 'More' },
  uk: { home: 'Головна', markets: 'Ринки', launch: 'Лаунч', portfolio: 'Портфель', more: 'Ще' },
}

/** What a screen reader hears on the «+»: the web's `MENU_ACTION.label`. */
export const LAUNCH_ACTION_LABEL: Copy<string> = { en: 'Launch a token', uk: 'Запустити токен' }

/**
 * The route file under `app/(tabs)` a place is drawn from. The «+» has a file
 * of its own (`create`) that never shows: a press opens {@link LAUNCH_PATH};
 * it cannot be `launch`, which is the form's own address outside the bar.
 */
export type ShellRoute = 'index' | 'markets' | 'create' | 'portfolio' | 'more'

export type ShellEntry = Readonly<{
  tab: ShellTab
  route: ShellRoute
  /** The row that builds the place has landed; an entry that is not ready is reserved, not drawn. */
  ready: boolean
  /** Where a press goes when the place is an action rather than a screen of the bar. */
  action?: string
}>

/** «Запустити токен» — the form the «+» opens. */
export const LAUNCH_PATH = '/launch'

export const SHELL: readonly ShellEntry[] = [
  { tab: 'home', route: 'index', ready: true },
  { tab: 'markets', route: 'markets', ready: true },
  { tab: 'launch', route: 'create', ready: true, action: LAUNCH_PATH },
  { tab: 'portfolio', route: 'portfolio', ready: true },
  { tab: 'more', route: 'more', ready: true },
]

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
} as const

export type LegacyTabRoute = keyof typeof LEGACY_TAB_ROUTES

/** The one place that carries the wallet's unread count: the first, where attention lives. */
export const BADGE_TAB: ShellTab = 'home'

/** A badge as the bar draws it: nothing at zero, the count to nine, `9+` beyond. */
export function badgeOf(unread: number): string | number | undefined {
  if (!Number.isFinite(unread) || unread <= 0) return undefined
  return unread > 9 ? '9+' : Math.floor(unread)
}
