import type { Copy } from '../../lib/i18n.ts'

/**
 * The words of a company's facts at rest — the head's line under the
 * name, «Ключові показники», «Про компанію», «Що ти купуєш» and «Торги на
 * Solana» — the web's own for the same page, its
 * `invest-words.ts`), in the phone's «ти». A time the phone adds beside a
 * figure (every figure carries its time) is said the way the web says
 * a mark's time («на 16:07»).
 */

/** The four issuers with a document Ryntra read — what each says of the company's dividends. */
export type DividendIssuer = 'xstocks' | 'ondo' | 'backpack' | 'prestocks'

export type CompanyCopy = Readonly<{
  keyStats: string
  aboutCompany: string
  whatYouBuy: string
  tradingOnSolana: string
  /* «Ключові показники» */
  companyValuation: string
  byTokenPrice: string
  atTime: (time: string) => string
  notUpdated: string
  yearRange: string
  yearLow: string
  yearHigh: string
  since: (day: string) => string
  yearRangeA11y: (low: string, high: string) => string
  /* the head and «Про компанію» */
  statusWord: string
  privateCompany: string
  publicSince: (day: string) => string
  preStocksToken: string
  exchangeWord: string
  /* «Що ти купуєш» */
  issuerWord: string
  backing: string
  sharesHeld: (count: string, custodian: string) => string
  reservesAt: (day: string) => string
  dividendsWord: string
  dividends: Readonly<Record<DividendIssuer, string>>
  issuerFee: string
  noFee: string
  whatIsThis: string
  example: string
  important: string
  /* «Торги на Solana» */
  volume24h: string
  liquidity: string
  holders: string
  traders24h: string
  trades24h: string
  buys: (pct: string) => string
  sells: (pct: string) => string
  byTrades: string
  pressureA11y: (buys: string, sells: string) => string
  onSolanaSince: (day: string) => string
  tradingUnread: string
  marketSource: (time: string) => string
}>

const EN: CompanyCopy = {
  keyStats: 'Key statistics',
  aboutCompany: 'About the company',
  whatYouBuy: 'What you buy',
  tradingOnSolana: 'Trading on Solana · 24 h',
  companyValuation: 'Company valuation',
  byTokenPrice: 'By the token’s price',
  atTime: (time) => `at ${time}`,
  notUpdated: 'not updated',
  yearRange: 'Price over the year',
  yearLow: 'Low',
  yearHigh: 'High',
  since: (day) => `since ${day}`,
  yearRangeA11y: (low, high) => `Low ${low}, high ${high}`,
  statusWord: 'Status',
  privateCompany: 'Private company',
  publicSince: (day) => `Public since ${day}`,
  preStocksToken: 'PreStocks token',
  exchangeWord: 'Exchange',
  issuerWord: 'Issuer',
  backing: 'Backing',
  sharesHeld: (count, custodian) => `${count} shares held by ${custodian}`,
  reservesAt: (day) => `reserves at ${day}`,
  dividendsWord: 'Dividends',
  dividends: {
    xstocks: 'Already in the token amount',
    ondo: 'Already in the token’s price',
    backpack: 'Not paid out yet',
    prestocks: 'None',
  },
  issuerFee: 'Issuer fee on a transfer',
  noFee: 'None',
  whatIsThis: 'What is this?',
  example: 'Example',
  important: 'Important',
  volume24h: 'Volume',
  liquidity: 'Liquidity',
  holders: 'Holders',
  traders24h: 'Traders',
  trades24h: 'Trades',
  buys: (pct) => `Buys ${pct}`,
  sells: (pct) => `Sells ${pct}`,
  byTrades: 'by number of trades',
  pressureA11y: (buys, sells) => `Buys ${buys}, sells ${sells}`,
  onSolanaSince: (day) => `On Solana since ${day}`,
  tradingUnread: 'The day’s trading could not be read right now.',
  marketSource: (time) => `Market data: Jupiter · ${time}`,
}

const UK: CompanyCopy = {
  keyStats: 'Ключові показники',
  aboutCompany: 'Про компанію',
  whatYouBuy: 'Що ти купуєш',
  tradingOnSolana: 'Торги на Solana · 24 год',
  companyValuation: 'Оцінка компанії',
  byTokenPrice: 'За ціною токена',
  atTime: (time) => `на ${time}`,
  notUpdated: 'не оновилися',
  yearRange: 'Ціна за рік',
  yearLow: 'Мінімум',
  yearHigh: 'Максимум',
  since: (day) => `з ${day}`,
  yearRangeA11y: (low, high) => `Мінімум ${low}, максимум ${high}`,
  statusWord: 'Статус',
  privateCompany: 'Приватна компанія',
  publicSince: (day) => `Публічна з ${day}`,
  preStocksToken: 'токен PreStocks',
  exchangeWord: 'Біржа',
  issuerWord: 'Емітент',
  backing: 'Забезпечення',
  sharesHeld: (count, custodian) => `${count} акцій у ${custodian}`,
  reservesAt: (day) => `резерви на ${day}`,
  dividendsWord: 'Дивіденди',
  dividends: {
    xstocks: 'Уже в кількості токена',
    ondo: 'Уже в ціні токена',
    backpack: 'Поки не виплачуються',
    prestocks: 'Немає',
  },
  issuerFee: 'Комісія емітента за переказ',
  noFee: 'Немає',
  whatIsThis: 'Що це?',
  example: 'Приклад',
  important: 'Важливо',
  volume24h: 'Обсяг',
  liquidity: 'Ліквідність',
  holders: 'Власників',
  traders24h: 'Трейдерів',
  trades24h: 'Угод',
  buys: (pct) => `Купівлі ${pct}`,
  sells: (pct) => `Продажі ${pct}`,
  byTrades: 'за кількістю угод',
  pressureA11y: (buys, sells) => `Купівлі ${buys}, продажі ${sells}`,
  onSolanaSince: (day) => `На Solana з ${day}`,
  tradingUnread: 'Торги за добу зараз не вдалося прочитати.',
  marketSource: (time) => `Дані ринку: Jupiter · ${time}`,
}

export const COMPANY_COPY: Copy<CompanyCopy> = { en: EN, uk: UK }
