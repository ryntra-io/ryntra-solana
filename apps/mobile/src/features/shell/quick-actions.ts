/**
 * The quick actions a long press on Ryntra's icon opens (M9) — four doors
 * into the places, pure. Search first, then the three places a person opens
 * the app for; «Місто» is where the app opens anyway, «Меню» is a list of doors
 * itself. Each opens its place, never an action: nothing is bought, signed or
 * asked by a press on the launcher. The words follow the app's language; the
 * icons are the tabs' own glyphs (`scripts/render-shortcut-icons.cjs`).
 */

import type { Copy, Locale } from '../../lib/i18n.ts'
import { PORTFOLIO_PATH, TAB_TITLES, TRADE_PATH } from './shell.ts'

export type QuickAction = Readonly<{
  id: 'search' | 'markets' | 'agent' | 'portfolio'
  title: string
  /** The launcher icon's resource, as `app.json` names it for `expo-quick-actions`. */
  icon: string
  params: Readonly<{ href: string }>
}>

const WORDS: Copy<Readonly<{ search: string; markets: string; agent: string }>> = {
  en: { search: 'Search', markets: 'Markets', agent: 'Ask Ryntra' },
  uk: { search: 'Пошук', markets: 'Ринки', agent: 'Спитати Ryntra' },
}

export function quickActions(locale: Locale): readonly QuickAction[] {
  const words = WORDS[locale]
  const tabs = TAB_TITLES[locale]
  return [
    { id: 'search', title: words.search, icon: 'shortcut_search', params: { href: '/search' } },
    { id: 'markets', title: words.markets, icon: 'shortcut_markets', params: { href: TRADE_PATH } },
    { id: 'agent', title: words.agent, icon: 'shortcut_agent', params: { href: '/ryn' } },
    { id: 'portfolio', title: tabs.portfolio, icon: 'shortcut_portfolio', params: { href: PORTFOLIO_PATH } },
  ]
}
