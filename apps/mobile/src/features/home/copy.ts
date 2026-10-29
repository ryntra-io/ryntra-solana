import type { HoldingsCoverage } from '../../lib/api.ts'
import type { Copy } from '../../lib/i18n.ts'
import type { TrendingClass } from './home-model.ts'

/**
 * The words of Home, in both languages. Home says little: a block's name,
 * one line per fact, the period every move is measured over, and the door.
 * Figures come formatted; the unit and the time sit beside each.
 */
const EN = {
  // the screen: Home one tap deeper since one version
  title: 'What changed',
  asOf: (time: string) => `as of ${time}`,
  offline: 'No connection · last read shown',
  // what needs attention
  attention: 'Needs attention',
  nothingNeedsYou: 'Nothing needs your attention',
  lastChecked: (moment: string) => `Last checked ${moment}`,
  notChecked: 'Your plans have not been checked yet',
  recoveryTitle: 'An operation is waiting for its answer',
  recoveryDetail: 'Check it first. Nothing is sent again.',
  modes: { buy: 'Buy', sell: 'Sell', swap: 'Swap' },
  whichPlan: (symbol: string, count: number) => `Which ${symbol} plan? · ${count}`,
  paper: 'Paper',
  opensOnWeb: 'Opens on ryntra.io',
  entryExpired: 'Entry expired — write a new version or cancel the plan',
  couldNotRead: 'Could not read right now',
  // the portfolio
  portfolio: 'Portfolio',
  hideAmounts: 'Hide amounts',
  showAmounts: 'Show amounts',
  emptyPortfolio: 'This wallet holds no tokens yet.',
  // the plans
  plans: 'Plans',
  allPlans: (count: number) => `All plans · ${count}`,
  drafts: (count: number) => (count === 1 ? '1 draft' : `${count} drafts`),
  newPlan: 'New plan',
  noPlans: 'No plans yet',
  // the watchlist
  watchlist: 'Favourites',
  since: (time: string) => `since ${time}`,
  over24h: '24h',
  allWatchlist: (count: number) => `All · ${count}`,
  emptyWatchlist: 'Add from Markets',
  notPricedThen: 'not priced at your last look',
  stale: 'Stale · last known figures',
  notListed: (count: number) => `${count} not listed`,
  // the markets
  movers: 'Biggest moves · 24h',
  classes: { stock: 'Stocks', crypto: 'Crypto', meme: 'Memes' } satisfies Record<TrendingClass, string>,
  openMarkets: 'Open Markets',
  noMovers: 'The list has no movers to show right now.',
  // what changed
  changed: 'In brief',
  nothingChanged: (time: string) => `Nothing new since ${time}`,
  notesLine: (count: number, since: string | null) =>
    since
      ? count === 1
        ? `1 new note since ${since}`
        : `${count} new notes since ${since}`
      : count === 1
        ? '1 unread note'
        : `${count} unread notes`,
  planLine: (symbol: string, version: string, moment: string) => `${symbol} ${version} changed ${moment}`,
  portfolioLine: (change: string, pct: string) => `Portfolio ${change} · ${pct} in 24h`,
  watchLine: (symbol: string, pct: string, period: string) => `${symbol} ${pct} ${period}`,
  coverageLine: {
    COMPLETE: '',
    PARTIAL: 'Balances partly read',
    UNAVAILABLE: 'Balances could not be read',
  } satisfies Record<HoldingsCoverage, string>,
  // the account
  connectedDetail: 'Plans and notes open after sign-in',
  trade: 'Trade',
  monitoring: 'Inbox',
} as const

export type HomeCopy = {
  readonly [K in keyof typeof EN]: (typeof EN)[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : (typeof EN)[K] extends Record<string, string>
      ? Readonly<Record<keyof (typeof EN)[K], string>>
      : string
}

const UK: HomeCopy = {
  title: 'Що змінилося',
  asOf: (time) => `станом на ${time}`,
  offline: 'Немає з’єднання · показано останнє прочитане',
  attention: 'Потребує уваги',
  nothingNeedsYou: 'Нічого не потребує твоєї уваги',
  lastChecked: (moment) => `Перевірено ${moment}`,
  notChecked: 'Твої плани ще не перевірялися',
  recoveryTitle: 'Операція чекає відповіді',
  recoveryDetail: 'Спершу перевір її. Нічого не надсилається вдруге.',
  modes: { buy: 'Купівля', sell: 'Продаж', swap: 'Обмін' },
  whichPlan: (symbol, count) => `Який план ${symbol}? · ${count}`,
  paper: 'Паперовий',
  opensOnWeb: 'Відкривається на ryntra.io',
  entryExpired: 'Вхід прострочено — напиши нову версію або скасуй план',
  couldNotRead: 'Зараз не вдалося прочитати',
  portfolio: 'Портфель',
  hideAmounts: 'Сховати суми',
  showAmounts: 'Показати суми',
  emptyPortfolio: 'У цьому гаманці ще немає токенів.',
  plans: 'Плани',
  allPlans: (count) => `Усі плани · ${count}`,
  drafts: (count) =>
    count === 1 ? '1 чернетка' : count >= 2 && count <= 4 ? `${count} чернетки` : `${count} чернеток`,
  newPlan: 'Новий план',
  noPlans: 'Планів ще немає',
  watchlist: 'Обране',
  since: (time) => `з ${time}`,
  over24h: '24 год',
  allWatchlist: (count) => `Усі · ${count}`,
  emptyWatchlist: 'Додати з Ринків',
  notPricedThen: 'не мав ціни під час останнього перегляду',
  stale: 'Застаріло · останні відомі цифри',
  notListed: (count) => `${count} немає в списку`,
  movers: 'Найбільші рухи · 24 год',
  classes: { stock: 'Акції', crypto: 'Крипто', meme: 'Меми' },
  openMarkets: 'Відкрити Ринки',
  noMovers: 'У списку зараз немає рухів, які варто показати.',
  changed: 'Коротко',
  nothingChanged: (time) => `Нічого нового з ${time}`,
  notesLine: (count, since) =>
    since
      ? count === 1
        ? `1 нова нотатка з ${since}`
        : count >= 2 && count <= 4
          ? `${count} нові нотатки з ${since}`
          : `${count} нових нотаток з ${since}`
      : count === 1
        ? '1 непрочитана нотатка'
        : count >= 2 && count <= 4
          ? `${count} непрочитані нотатки`
          : `${count} непрочитаних нотаток`,
  planLine: (symbol, version, moment) => `${symbol} ${version} змінено ${moment}`,
  portfolioLine: (change, pct) => `Портфель ${change} · ${pct} за добу`,
  watchLine: (symbol, pct, period) => `${symbol} ${pct} ${period}`,
  coverageLine: {
    COMPLETE: '',
    PARTIAL: 'Баланси прочитано частково',
    UNAVAILABLE: 'Баланси не вдалося прочитати',
  },
  connectedDetail: 'Плани й нотатки відкриються після входу',
  trade: 'Торгівля',
  monitoring: 'Вхідні',
}

export const HOME_COPY: Copy<HomeCopy> = { en: EN, uk: UK }
