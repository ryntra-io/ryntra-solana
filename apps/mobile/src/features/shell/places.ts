/**
 * What the places hold a tap deeper, pure — beside Menu 3 (`menu.ts`, decision 55):
 *
 * - **Головна** — its account, «Усього», four actions and the person's
 *   blocks; «Вхідні» there holds «Що змінилося», the command-centre Home of
 *   M10 (what needs a look, the plans, the watchlist's moves, the movers).
 * - **Торгівля** — Ринки, one screener for every asset (`features/markets/screener.ts`), and Обмін.
 * - **Гроші** — Поповнити · Надіслати · Отримати · Між мережами, the core's four large actions (`menu.ts`).
 * - **Портфель** — beside the positions: Ордери, Боти (what runs on the
 *   person's rule), Історія and Квитанції.
 * - **Меню** — Menu 3: the core's groups with the rows that live in the phone, Налаштування and Допомога at its
 *   foot (`menu.ts`).
 *
 * A door opens the phone's own screen where the phone has one. A page only the
 * web has built opens the site and says so — never a dead row: a door to a
 * product whose address does not answer yet is not drawn (`MENU_LIVE`).
 */

import type { Copy } from '../../lib/i18n.ts'
import { PAYMENTS_PATH, TRADE_PATH } from './shell.ts'

/** Where a door leads: a screen of the phone, a sheet over the place, a page of ryntra.io, or another of Ryntra's sites. */
export type PlaceDestination =
  | Readonly<{ kind: 'screen'; path: string }>
  | Readonly<{ kind: 'sheet'; sheet: 'top-up' }>
  | Readonly<{ kind: 'web'; path: string }>
  | Readonly<{ kind: 'site'; url: string }>

/** «Вхідні»'s door a tap deeper: M10's Home — what changed and what needs a look. */
export const CHANGES_PATH = '/changes'

/** «Боти»: everything that runs on the person's rule. */
export const BOTS_PATH = '/bots'
/** «Боти → Каталог». */
export const BOTS_CATALOG_PATH = '/bots?tab=catalog'
/** «Гроші» — the place of the bar; `/money` is its older address. */
export const MONEY_PATH = PAYMENTS_PATH
/** «Налаштування»: the wallet, its monitoring, the look and the language. */
export const SETTINGS_PATH = '/settings'
/**
 * Whether this build shows «Прогнози» (M12). The release 1.17.0 carries the assistant and Phoenix's trades and hides
 * them: no segment, no menu row, no screen — their links
 * open on the web. The code stays whole; the second release turns this on.
 */
export const PREDICTIONS_LIVE: boolean = false
/** «Торгівля → Прогнози» (M12) and its account's money — the live USDC on Solana that AGG holds. */
export const PREDICTIONS_PATH = `${TRADE_PATH}?seg=predictions`
export const PREDICTIONS_MONEY_PATH = '/predictions/money'
/** «Вхідні»: the wallet's notes, what needs attention and what is watched. */
export const INBOX_PATH = '/monitoring'
/** «Допомога»: Ryntra's documentation on the site. */
export const HELP_URL = 'https://ryntra.io/docs'

/** Portfolio's segments (NEW-LOOK §3): Активи · Ордери · Історія. */
export const PORTFOLIO_SEGMENTS = ['assets', 'orders', 'history'] as const
export type PortfolioSegment = (typeof PORTFOLIO_SEGMENTS)[number]

/** Portfolio's doors under the assets: Боти · Квитанції (plans and their results live in «Боти»). */
export const PORTFOLIO_DOORS = ['bots', 'receipts'] as const
export type PortfolioDoor = (typeof PORTFOLIO_DOORS)[number]

/** Where each of Portfolio's doors leads — the phone's own screens. */
export const DOOR_DESTINATIONS: Readonly<Record<PortfolioDoor, PlaceDestination>> = {
  bots: { kind: 'screen', path: BOTS_PATH },
  receipts: { kind: 'screen', path: '/receipts' },
}

export type PlacesCopy = Readonly<{
  whatChanged: string
  doors: Readonly<Record<PortfolioDoor, string>>
  segments: Readonly<Record<PortfolioSegment, string>>
  /** A count beside «Боти»: «2 активні». */
  active: (count: number) => string
  /** What a screen reader hears on a door that leaves the app for ryntra.io. */
  onWeb: string
  /** …and on a door to a site opened in the browser. */
  inBrowser: string
  /** The asset's door to its purchase-and-sale sheet (`/trade`) — named by what it does, not «Spot» (ST-4). */
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
    doors: { bots: 'Bots', receipts: 'Receipts' },
    segments: { assets: 'Assets', orders: 'Orders', history: 'History' },
    active: (count) => `${count} active`,
    onWeb: 'opens ryntra.io',
    inBrowser: 'opens in the browser',
    openInSpot: 'Trade',
    createPlan: 'Create plan',
    watchAdd: 'Add to Favourites',
    watchRemove: 'Remove from Favourites',
    watchFull: (limit) => `Favourites keep up to ${limit} assets.`,
  },
  uk: {
    whatChanged: 'Що змінилося',
    doors: { bots: 'Боти', receipts: 'Квитанції' },
    segments: { assets: 'Активи', orders: 'Ордери', history: 'Історія' },
    active: (count) => `${count} ${activeWord(count)}`,
    onWeb: 'відкриває ryntra.io',
    inBrowser: 'відкривається в браузері',
    openInSpot: 'Торгувати',
    createPlan: 'Створити план',
    watchAdd: 'Додати в Обране',
    watchRemove: 'Прибрати з Обраного',
    watchFull: (limit) => `В Обраному — до ${limit} активів.`,
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
