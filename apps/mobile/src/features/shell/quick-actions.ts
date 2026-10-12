/**
 * The quick actions a long press on Ryntra's icon opens — four doors
 * into the places, pure. Search first, then the three places a person opens
 * the app for; Home is where the app opens anyway, More is a list of doors
 * itself. Each opens its place, never an action: nothing is bought, signed or
 * asked by a press on the launcher. The words follow the app's language; the
 * icons are the tabs' own glyphs (`scripts/render-shortcut-icons.cjs`).
 */

import type { Copy, Locale } from '../../lib/i18n.ts'
import { TAB_TITLES } from './shell.ts'

export type QuickAction = Readonly<{
  id: 'search' | 'markets' | 'agent' | 'portfolio'
  title: string
  /** The launcher icon's resource, as `app.json` names it for `expo-quick-actions`. */
  icon: string
  params: Readonly<{ href: string }>
}>

const WORDS: Copy<Readonly<{ search: string; agent: string }>> = {
  en: { search: 'Search', agent: 'Ask Ryntra' },
  uk: { search: 'Пошук', agent: 'Спитати Ryntra' },
}

export function quickActions(locale: Locale): readonly QuickAction[] {
  const words = WORDS[locale]
  const tabs = TAB_TITLES[locale]
  return [
    { id: 'search', title: words.search, icon: 'shortcut_search', params: { href: '/search' } },
    { id: 'markets', title: tabs.markets, icon: 'shortcut_markets', params: { href: '/(tabs)/markets' } },
    { id: 'agent', title: words.agent, icon: 'shortcut_agent', params: { href: '/ryn' } },
    { id: 'portfolio', title: tabs.portfolio, icon: 'shortcut_portfolio', params: { href: '/(tabs)/portfolio' } },
  ]
}
