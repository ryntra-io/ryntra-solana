/**
 * The shell as a value — pure. The target order of the tabs is the canon's
 * (Part A §5.3, §20.11): Home · Markets · Agent · Portfolio · More. A tab is
 * drawn only when the row that builds it has landed — a dead tab is never
 * shown; since M11 all five are. The Agent tab is Ryntra. The two doors of the
 * built shell that lost their tab (Trade, Strategies) keep their routes as
 * redirects, so a saved link, a return from the wallet or an open plan lands
 * where it always did.
 */

import type { Copy } from '../../lib/i18n.ts'

export type ShellTab = 'home' | 'markets' | 'agent' | 'portfolio' | 'more'

/**
 * What the bar says under each tab — the canon's five places, the same on the
 * web and the phone: Головна · Ринки · Ryntra · Портфель · Ще (§3). The Agent
 * tab is labelled Ryntra, the assistant's one name; `agent` stays the
 * internal name (canon §3, §20.11).
 */
export const TAB_TITLES: Copy<Readonly<Record<ShellTab, string>>> = {
  en: { home: 'Home', markets: 'Markets', agent: 'Ryntra', portfolio: 'Portfolio', more: 'More' },
  uk: { home: 'Головна', markets: 'Ринки', agent: 'Ryntra', portfolio: 'Портфель', more: 'Ще' },
}

/** The route file under `app/(tabs)` a tab is drawn from. */
export type ShellRoute = 'index' | 'markets' | 'agent' | 'portfolio' | 'more'

export type ShellEntry = Readonly<{
  tab: ShellTab
  route: ShellRoute
  /** The row that builds the tab has landed; an entry that is not ready is reserved, not drawn. */
  ready: boolean
}>

export const SHELL: readonly ShellEntry[] = [
  { tab: 'home', route: 'index', ready: true },
  { tab: 'markets', route: 'markets', ready: true },
  // Ryntra, text-first (M11).
  { tab: 'agent', route: 'agent', ready: true },
  { tab: 'portfolio', route: 'portfolio', ready: true },
  { tab: 'more', route: 'more', ready: true },
]

/** The tabs the bar draws, in the target order — never a reserved one. */
export function drawnTabs(shell: readonly ShellEntry[] = SHELL): readonly ShellEntry[] {
  return shell.filter((entry) => entry.ready)
}

/**
 * The tab paths of the built shell (M0–M3) that no longer exist, and the
 * surfaces they always opened. The deep-link mapper rewrites them, so a
 * saved link keeps working; no hidden screen is drawn for them.
 */
export const LEGACY_TAB_ROUTES = {
  '/(tabs)/trade': '/trade',
  '/(tabs)/strategies': '/plans',
} as const

export type LegacyTabRoute = keyof typeof LEGACY_TAB_ROUTES

/** The one tab that carries the wallet's unread count: the first, where attention lives. */
export const BADGE_TAB: ShellTab = 'home'

/** A badge as the bar draws it: nothing at zero, the count to nine, `9+` beyond. */
export function badgeOf(unread: number): string | number | undefined {
  if (!Number.isFinite(unread) || unread <= 0) return undefined
  return unread > 9 ? '9+' : Math.floor(unread)
}
