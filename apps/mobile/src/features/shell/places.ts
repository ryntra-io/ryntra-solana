/**
 * What each place holds a tap deeper, pure — the current menu on a phone,
 * the web's own (`app/shell/domains.ts`).
 *
 * - **Головна** — «Що змінилося»: the command-centre Home (what needs
 *   a look, the plans, the watchlist's moves, the markets' movers, the brief).
 * - **Ринки** — one screener for every asset (`features/markets/screener.ts`).
 * - **Портфель** — beside the positions: Боти (what runs on the person's
 *   rule) and Історія, as the web's Позиції · Історія.
 * - **Ще** — Торгувати · Боти · Гроші · Винагороди · Ryntra · Налаштування,
 *   each with the web's caption; «Гроші» holds Поповнити · Надіслати ·
 *   Отримати · Між мережами, the web's tabs, and the payment link beside
 *   Отримати.
 *
 * A door opens the phone's own screen where the phone has one. A page only the
 * web has built opens ryntra.io and says so — never a dead row. Pools and
 * Perps are not rows until their tasks are on production.
 */

import type { Copy } from '../../lib/i18n.ts'

/** Where a door leads: a screen of the phone, a sheet over the place, or a page only ryntra.io has built. */
export type PlaceDestination =
  | Readonly<{ kind: 'screen'; path: string }>
  | Readonly<{ kind: 'sheet'; sheet: 'top-up' }>
  | Readonly<{ kind: 'web'; path: string }>

/** Home's one door a tap deeper: the command-centre Home — what changed and what needs a look. */
export const CHANGES_PATH = '/changes'

/** «Боти»: everything that runs on the person's rule. */
export const BOTS_PATH = '/bots'
/** «Боти → Каталог». */
export const BOTS_CATALOG_PATH = '/bots?tab=catalog'
/** «Гроші»: one screen of four doors and the payment link. */
export const MONEY_PATH = '/money'
/** «Налаштування»: the wallet, its monitoring, the look and the language. */
export const SETTINGS_PATH = '/settings'

/** «Ще»'s rows, in the web's order: the sections the bar does not hold, then Ryntra and the settings. */
export const MORE_ROWS = ['trade', 'bots', 'money', 'rewards', 'ryntra', 'settings'] as const
export type MoreRow = (typeof MORE_ROWS)[number]

/** «Гроші»: the web's tabs Поповнити · Надіслати · Отримати · Між мережами, the payment link beside Отримати. */
export const MONEY_PAGES = ['topUp', 'send', 'receive', 'link', 'bridge'] as const
export type MoneyPage = (typeof MONEY_PAGES)[number]

/** Portfolio's doors beside the positions: Боти · Історія (plans and their results live in «Боти»). */
export const PORTFOLIO_DOORS = ['bots', 'history', 'receipts'] as const
export type PortfolioDoor = (typeof PORTFOLIO_DOORS)[number]

/** Where each door of «Ще», «Гроші» and Portfolio leads. Between networks is the web's page; the rest are the phone's. */
export const DOOR_DESTINATIONS: Readonly<Record<MoreRow | MoneyPage | PortfolioDoor, PlaceDestination>> = {
  trade: { kind: 'screen', path: '/trade' },
  bots: { kind: 'screen', path: BOTS_PATH },
  money: { kind: 'screen', path: MONEY_PATH },
  rewards: { kind: 'screen', path: '/rewards' },
  ryntra: { kind: 'screen', path: '/ryn' },
  settings: { kind: 'screen', path: SETTINGS_PATH },
  topUp: { kind: 'sheet', sheet: 'top-up' },
  send: { kind: 'screen', path: '/money/send' },
  receive: { kind: 'screen', path: '/money/receive' },
  link: { kind: 'screen', path: '/money/receive?tab=link' },
  bridge: { kind: 'web', path: '/app/bridge' },
  history: { kind: 'screen', path: '/history' },
  receipts: { kind: 'screen', path: '/receipts' },
}

/** Every door the places draw a tap deeper, with where it leads — what a test reads to prove the reach. */
export function placeDoors(): readonly Readonly<{ place: string; door: string; destination: PlaceDestination }>[] {
  return [
    { place: 'home', door: 'changes', destination: { kind: 'screen', path: CHANGES_PATH } },
    ...PORTFOLIO_DOORS.map((door) => ({ place: 'portfolio', door, destination: DOOR_DESTINATIONS[door] })),
    ...MORE_ROWS.map((door) => ({ place: 'more', door, destination: DOOR_DESTINATIONS[door] })),
    ...MONEY_PAGES.map((door) => ({ place: 'money', door, destination: DOOR_DESTINATIONS[door] })),
  ]
}

export type PlacesCopy = Readonly<{
  whatChanged: string
  /** A row of «Ще»: its name and the line under it — the web's caption; the settings carry none. */
  rows: Readonly<Record<MoreRow, Readonly<{ label: string; caption: string | null }>>>
  doors: Readonly<Record<PortfolioDoor, string>>
  /** «Між мережами» — the web's tab; the other money words are `MONEY_COPY`'s. */
  bridge: string
  /** A count beside «Боти»: «2 активні». */
  active: (count: number) => string
  /** What a screen reader hears on a door that leaves the app for ryntra.io. */
  onWeb: string
  openInSpot: string
  createPlan: string
  watchAdd: string
  watchRemove: string
  watchFull: (limit: number) => string
}>

/** The words of the doors, the web's own where the web has a page (`app/shell/domains.ts`). */
export const PLACES_COPY: Copy<PlacesCopy> = {
  en: {
    whatChanged: 'What changed',
    rows: {
      trade: { label: 'Trade', caption: 'Spot and swap' },
      bots: { label: 'Bots', caption: 'Recurring buys, plans' },
      money: { label: 'Money', caption: 'Top up and transfers' },
      rewards: { label: 'Rewards', caption: 'Points, leaderboards, season' },
      ryntra: { label: 'Ryntra', caption: 'AI assistant' },
      settings: { label: 'Settings', caption: null },
    },
    doors: { bots: 'Bots', history: 'History', receipts: 'Receipts' },
    bridge: 'Cross-chain',
    active: (count) => `${count} active`,
    onWeb: 'opens ryntra.io',
    openInSpot: 'Open in Spot',
    createPlan: 'Create plan',
    watchAdd: 'Add to watchlist',
    watchRemove: 'Remove from watchlist',
    watchFull: (limit) => `The watchlist keeps up to ${limit} assets.`,
  },
  uk: {
    whatChanged: 'Що змінилося',
    rows: {
      trade: { label: 'Торгувати', caption: 'Спот і обмін' },
      bots: { label: 'Боти', caption: 'Регулярна купівля, плани' },
      money: { label: 'Гроші', caption: 'Поповнення й перекази' },
      rewards: { label: 'Винагороди', caption: 'Бали, таблиці, сезон' },
      ryntra: { label: 'Ryntra', caption: 'ШІ-помічник' },
      settings: { label: 'Налаштування', caption: null },
    },
    doors: { bots: 'Боти', history: 'Історія', receipts: 'Квитанції' },
    bridge: 'Між мережами',
    active: (count) => `${count} ${activeWord(count)}`,
    onWeb: 'відкриває ryntra.io',
    openInSpot: 'Відкрити в Споті',
    createPlan: 'Створити план',
    watchAdd: 'Додати в обране',
    watchRemove: 'Прибрати з обраного',
    watchFull: (limit) => `В обраному — до ${limit} активів.`,
  },
}

/** «1 активний», «2 активні», «5 активних». */
function activeWord(count: number): string {
  const ten = count % 10
  const hundred = count % 100
  if (ten === 1 && hundred !== 11) return 'активний'
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'активні'
  return 'активних'
}
