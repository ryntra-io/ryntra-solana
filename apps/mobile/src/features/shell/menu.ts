/**
 * Menu 3 in the phone, pure: the core's composition (`core-nav.ts`, synced from `@ryntra/core/nav`) with the phone's
 * own doors. Home, then the groups — Торгівля · Автоматика · Заробіток · Гроші · Казна — each opened and shut by its
 * arrow and remembered as the person leaves it; at the foot, apart from the groups, the settings and the help. Only
 * what lives in the phone is drawn: a row without a door here is simply not there, and a group with no rows is not
 * drawn either — never a grey row with a caption.
 *
 * The phone is Ryntra on Solana and nothing else: no network row, no «Інші продукти» and no row that opens another
 * product — the web's menu draws those; the phone draws none of them. Ф'ючерси and Прогнози come to the phone itself
 * («тут ф'ючерси будуть, і ринок предсказаний буде, але пізніше»), as rows of «Торгівля» with the phone's own screens:
 * Ф'ючерси are Phoenix's perpetuals inside Ryntra on Solana (decision 56, C4), «Торгівля»'s third segment; Прогнози
 * its fourth — AGG's markets on outcomes entered with the Solana wallet (decisions 57 and 58, M12), drawn once the build
 * shows them (`PREDICTIONS_LIVE`, the second release).
 */

import type { Copy } from '../../lib/i18n.ts'
import { coreNav } from './core-nav.ts'
import {
  BOTS_PATH,
  CHANGES_PATH,
  DOOR_DESTINATIONS,
  HELP_URL,
  PORTFOLIO_DOORS,
  PREDICTIONS_LIVE,
  PREDICTIONS_PATH,
  SETTINGS_PATH,
  type PlaceDestination,
} from './places.ts'
import { HISTORY_PATH, HOME_PATH, LAUNCH_PATH, PORTFOLIO_PATH, SWAP_PATH, TRADE_PATH } from './shell.ts'

/** «Ринки» and «Портфель» name their first segment: a place left on «Обмін» or «Історія» opens where the row says. */
const MARKETS_SEGMENT_PATH = `${TRADE_PATH}?seg=markets`
const FUTURES_SEGMENT_PATH = `${TRADE_PATH}?seg=futures`
const PORTFOLIO_ASSETS_PATH = `${PORTFOLIO_PATH}?open=assets`

export type NavGroupId = (typeof coreNav.groups)[number]['id']
export type NavItemId = (typeof coreNav.home)['id'] | (typeof coreNav.groups)[number]['items'][number]['id']

/** «Між мережами»: money between Solana and another network — a page the web has built, opened on ryntra.io. */
export const BRIDGE_WEB_PATH = '/app/bridge'

/**
 * Where each row of the menu leads in the phone. A row the phone has no door for (Спот — the phone buys from an
 * asset's page; Агенти, Пули, Earn і позики, the treasury) does not
 * live here and is not drawn.
 */
export const MENU_DESTINATIONS: Readonly<Partial<Record<NavItemId, PlaceDestination>>> = {
  home: { kind: 'screen', path: HOME_PATH },
  swap: { kind: 'screen', path: SWAP_PATH },
  markets: { kind: 'screen', path: MARKETS_SEGMENT_PATH },
  futures: { kind: 'screen', path: FUTURES_SEGMENT_PATH },
  predictions: { kind: 'screen', path: PREDICTIONS_PATH },
  launch: { kind: 'screen', path: LAUNCH_PATH },
  bots: { kind: 'screen', path: BOTS_PATH },
  assistant: { kind: 'screen', path: '/ryn' },
  rewards: { kind: 'screen', path: '/rewards' },
  portfolio: { kind: 'screen', path: PORTFOLIO_ASSETS_PATH },
  deposit: { kind: 'sheet', sheet: 'top-up' },
  send: { kind: 'screen', path: '/money/send' },
  receive: { kind: 'screen', path: '/money/receive' },
  bridge: { kind: 'web', path: BRIDGE_WEB_PATH },
  history: { kind: 'screen', path: HISTORY_PATH },
}

/** A door that does not answer today is held here as `false` and drawn the day it opens: Прогнози, until the build shows them. */
export const MENU_LIVE: Readonly<Partial<Record<NavItemId, boolean>>> = PREDICTIONS_LIVE ? {} : { predictions: false }

/** A row lives in the phone when it has a door and the door answers. */
export function rowLives(id: NavItemId, live: Readonly<Partial<Record<NavItemId, boolean>>> = MENU_LIVE): boolean {
  return MENU_DESTINATIONS[id] !== undefined && live[id] !== false
}

export type MenuGroup = Readonly<{
  id: NavGroupId
  icon: (typeof coreNav.groups)[number]['icon']
  rows: readonly NavItemId[]
}>

/** The groups the menu draws, in the core's order, each with its living rows in theirs; an empty group is dropped. */
export function menuGroups(live: Readonly<Partial<Record<NavItemId, boolean>>> = MENU_LIVE): readonly MenuGroup[] {
  return coreNav.groups
    .map((group) => ({
      id: group.id,
      icon: group.icon,
      rows: group.items.map((entry) => entry.id as NavItemId).filter((id) => rowLives(id, live)),
    }))
    .filter((group) => group.rows.length > 0)
}

/** Which groups are open, as the person left them; a group absent here keeps its default. */
export type OpenGroups = Readonly<Partial<Record<NavGroupId, boolean>>>

const GROUP_IDS: readonly string[] = coreNav.groups.map((group) => group.id)

/** Whether a group is drawn open: the person's own choice first; untouched, the core's default — Гроші, in sight. */
export function groupOpen(group: NavGroupId, open: OpenGroups): boolean {
  const chosen = open[group]
  if (chosen !== undefined) return chosen
  return (coreNav.defaultOpen as readonly string[]).includes(group)
}

/** The stored choice read back; anything that is not a group's boolean is dropped, so a bad value opens the defaults. */
export function parseOpenGroups(value: string | null | undefined): OpenGroups {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Partial<Record<NavGroupId, boolean>> = {}
    for (const [key, open] of Object.entries(parsed)) {
      if (GROUP_IDS.includes(key) && typeof open === 'boolean') result[key as NavGroupId] = open
    }
    return result
  } catch {
    return {}
  }
}

/** «Гроші»'s four large actions, the core's: Поповнити · Надіслати · Отримати · Між мережами. */
export const MONEY_ACTIONS: readonly NavItemId[] = coreNav.moneyActions

export type MenuCopy = Readonly<{
  items: Readonly<Record<NavItemId, string>>
  groups: Readonly<Record<NavGroupId, string>>
  menu: string
  settings: string
  help: string
  /** What a screen reader hears on a door that opens the browser. */
  inBrowser: string
  /** The foot: the version. */
  version: (version: string) => string
}>

/** The menu's words — the core's own for every row and group, so the phone and the web say the same. */
export const MENU_COPY: Copy<MenuCopy> = {
  en: {
    // «Perps», as the web names Phoenix's perpetual futures since PERP-1.
    items: { ...coreNav.words.en.items, futures: 'Perps' },
    groups: coreNav.words.en.groups,
    menu: coreNav.words.en.menu,
    settings: 'Settings',
    help: 'Help',
    inBrowser: 'opens in the browser',
    version: (version) => `Ryntra ${version}`,
  },
  uk: {
    items: { ...coreNav.words.uk.items, futures: 'Perps' },
    groups: coreNav.words.uk.groups,
    menu: coreNav.words.uk.menu,
    settings: 'Налаштування',
    help: 'Допомога',
    inBrowser: 'відкривається в браузері',
    version: (version) => `Ryntra ${version}`,
  },
}

/** Settings and help, the menu's last rows. */
export const MENU_AUX: Readonly<Record<'settings' | 'help', PlaceDestination>> = {
  settings: { kind: 'screen', path: SETTINGS_PATH },
  help: { kind: 'site', url: HELP_URL },
}

/** Every door the places draw a tap deeper, with where it leads — what a test reads to prove the reach. */
export function placeDoors(): readonly Readonly<{ place: string; door: string; destination: PlaceDestination }>[] {
  const of = (id: NavItemId) => MENU_DESTINATIONS[id] as PlaceDestination
  return [
    { place: 'inbox', door: 'changes', destination: { kind: 'screen', path: CHANGES_PATH } },
    ...PORTFOLIO_DOORS.map((door) => ({ place: 'portfolio', door, destination: DOOR_DESTINATIONS[door] })),
    ...menuGroups()
      .flatMap((group) => group.rows)
      .map((door) => ({ place: 'menu', door, destination: of(door) })),
    ...(Object.keys(MENU_AUX) as (keyof typeof MENU_AUX)[]).map((door) => ({
      place: 'menu',
      door,
      destination: MENU_AUX[door],
    })),
    ...MONEY_ACTIONS.filter((id) => rowLives(id)).map((door) => ({ place: 'money', door, destination: of(door) })),
  ]
}
