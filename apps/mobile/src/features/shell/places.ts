/**
 * One version — what each of the five places holds a tap deeper, pure (canon
 * v5.3 В28, §0.0 rule 9, §3, §10; M20).
 *
 * There is no «Простий»/«Профі» switch on the phone: one app for every person
 * and every guest, five places — Головна · Ринки · Ryntra · Портфель · Ще
 * (`shell.ts`). What «Профі» held is not deleted; it lives a tap deeper in the
 * same places, named here once and read by the screens that draw them:
 *
 * - **Головна** — «Що змінилося»: the command-centre Home of M10 (what needs
 *   a look, the plans, the watchlist's moves, the markets' movers, the brief).
 * - **Ринки** — «Для досвідчених», after the companies: Спот (Trade — buy,
 *   sell and swap on any market), Акції and Тренди (M2's lists: the stocks
 *   with their sorts; crypto and memes, the watchlist beside them).
 * - **Портфель** — beside the positions: Стратегії (the plans), Результати,
 *   Історія.
 * - **Ще** — Обмін, Міст, Надіслати, Отримати, Винагороди, Демо-прогнози, in
 *   the web's order.
 *
 * A door opens the phone's own screen where the phone has one. A page only the
 * web has built opens ryntra.io and says so — never a dead row. The Academy
 * has no page a customer can open, on the web or the phone, so it is not a row
 * (canon §0.0 rule 10).
 */

import type { Copy } from '../../lib/i18n.ts'

/** Where a door leads: a screen of the phone, a sheet over the place, or a page only ryntra.io has built. */
export type PlaceDestination =
  | Readonly<{ kind: 'screen'; path: string }>
  | Readonly<{ kind: 'sheet'; sheet: 'receive' }>
  | Readonly<{ kind: 'web'; path: string }>

/** Home's one door a tap deeper: M10's Home — what changed and what needs a look. */
export const CHANGES_PATH = '/changes'

/** Markets' «Для досвідчених», in the web's order: Спот · Акції · Тренди. */
export const MARKETS_TOOLS = ['spot', 'stocks', 'trends'] as const
export type MarketsTool = (typeof MARKETS_TOOLS)[number]

/** M2's four lists, the screen «Акції» and «Тренди» open — each by the list it lands on. */
export const LISTS = ['watchlist', 'stock', 'crypto', 'meme'] as const
export type MarketsList = (typeof LISTS)[number]

export function isMarketsList(value: unknown): value is MarketsList {
  return typeof value === 'string' && (LISTS as readonly string[]).includes(value)
}

/** The lists screen on the list asked for. */
export function listsPath(list: MarketsList): string {
  return `/lists?tab=${list}`
}

/** Spot is the phone's Trade — its one execution surface (M3); Stocks and Trends are M2's lists. */
export const MARKETS_TOOL_PATHS: Readonly<Record<MarketsTool, string>> = {
  spot: '/trade',
  stocks: listsPath('stock'),
  trends: listsPath('crypto'),
}

/** Portfolio's doors beside the positions, as on the web: Стратегії · Результати · Історія. */
export const PORTFOLIO_DOORS = ['strategies', 'results', 'history'] as const
export type PortfolioDoor = (typeof PORTFOLIO_DOORS)[number]

/**
 * «Ще»'s pages in the order the Owner named them (2026-09-24), the web's own:
 * Обмін · Міст · Надіслати · Отримати · Винагороди · Демо-прогнози.
 */
export const MORE_PAGES = ['swap', 'bridge', 'send', 'receive', 'rewards', 'predictions'] as const
export type MorePage = (typeof MORE_PAGES)[number]

/**
 * Where each door of Portfolio and «Ще» leads. Results live on ryntra.io until
 * the phone has its own screen (M13); Bridge, Send and the prediction demo are
 * the web's pages; Receive is the wallet's own address in a sheet.
 */
export const DOOR_DESTINATIONS: Readonly<Record<PortfolioDoor | MorePage, PlaceDestination>> = {
  strategies: { kind: 'screen', path: '/plans' },
  results: { kind: 'web', path: '/app/results' },
  history: { kind: 'screen', path: '/history' },
  swap: { kind: 'screen', path: '/trade?mode=swap' },
  bridge: { kind: 'web', path: '/app/bridge' },
  send: { kind: 'web', path: '/app/send' },
  receive: { kind: 'sheet', sheet: 'receive' },
  rewards: { kind: 'screen', path: '/rewards' },
  predictions: { kind: 'web', path: '/app/predictions' },
}

/**
 * The screens «Профі» drew as places of their own, and the door one tap into a
 * place that opens each — with the tab's own tap, at most two from anywhere.
 */
export const FORMER_PRO_SCREENS = ['/changes', '/lists', '/trade', '/plans', '/history', '/rewards'] as const

/** Every door the five places draw, with where it leads — what a test reads to prove the reach. */
export function placeDoors(): readonly Readonly<{ place: string; door: string; destination: PlaceDestination }>[] {
  return [
    { place: 'home', door: 'changes', destination: { kind: 'screen', path: CHANGES_PATH } },
    ...MARKETS_TOOLS.map((tool) => ({
      place: 'markets',
      door: tool,
      destination: { kind: 'screen', path: MARKETS_TOOL_PATHS[tool] } as const,
    })),
    ...PORTFOLIO_DOORS.map((door) => ({ place: 'portfolio', door, destination: DOOR_DESTINATIONS[door] })),
    ...MORE_PAGES.map((door) => ({ place: 'more', door, destination: DOOR_DESTINATIONS[door] })),
  ]
}

export type PlacesCopy = Readonly<{
  whatChanged: string
  experienced: string
  tools: Readonly<Record<MarketsTool, string>>
  toolLines: Readonly<Record<MarketsTool, string>>
  doors: Readonly<Record<PortfolioDoor, string>>
  pages: Readonly<Record<MorePage, string>>
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
    experienced: 'For experienced investors',
    tools: { spot: 'Spot', stocks: 'Stocks', trends: 'Trends' },
    toolLines: {
      spot: 'Every market: buy, sell and swap',
      stocks: 'Every tokenized stock, with sorting',
      trends: 'Crypto and memes moving today',
    },
    doors: { strategies: 'Strategies', results: 'Results', history: 'History' },
    pages: {
      swap: 'Swap',
      bridge: 'Bridge',
      send: 'Send',
      receive: 'Receive',
      rewards: 'Rewards',
      predictions: 'Demo predictions',
    },
    onWeb: 'opens ryntra.io',
    openInSpot: 'Open in Spot',
    createPlan: 'Create plan',
    watchAdd: 'Add to watchlist',
    watchRemove: 'Remove from watchlist',
    watchFull: (limit) => `The watchlist keeps up to ${limit} assets.`,
  },
  uk: {
    whatChanged: 'Що змінилося',
    experienced: 'Для досвідчених',
    tools: { spot: 'Спот', stocks: 'Акції', trends: 'Тренди' },
    toolLines: {
      spot: 'Усі ринки: купівля, продаж і обмін',
      stocks: 'Усі токенізовані акції з сортуванням',
      trends: 'Крипта й меми, що рухаються сьогодні',
    },
    doors: { strategies: 'Стратегії', results: 'Результати', history: 'Історія' },
    pages: {
      swap: 'Обмін',
      bridge: 'Міст',
      send: 'Надіслати',
      receive: 'Отримати',
      rewards: 'Винагороди',
      predictions: 'Демо-прогнози',
    },
    onWeb: 'відкриває ryntra.io',
    openInSpot: 'Відкрити в Споті',
    createPlan: 'Створити план',
    watchAdd: 'Додати до списку спостереження',
    watchRemove: 'Прибрати зі списку спостереження',
    watchFull: (limit) => `У списку спостереження — до ${limit} активів.`,
  },
}
