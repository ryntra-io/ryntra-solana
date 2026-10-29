import type { Copy } from '../../lib/i18n.ts'
import type { HistoryStatus, HistoryWords } from './history-model.ts'

const DESTINATIONS_EN: Readonly<Record<string, string>> = {
  SOLANA: 'Solana',
  BASE: 'Base',
  ETHEREUM: 'Ethereum',
  ROBINHOOD: 'Robinhood Chain',
}

const EN = {
  title: 'History',
  all: 'All',
  incomplete: 'The list may be incomplete',
  unresolved: 'An operation is waiting for its answer — open Trade',
  openTrade: 'Open Trade',
  emptyTitle: 'No operations yet',
  emptyForAsset: (symbol: string) => `No operations with ${symbol} yet`,
  didNotLoad: 'History did not load',
  loading: 'Loading history',
  status: {
    done: 'Confirmed',
    pending: 'Pending',
    failed: 'Did not happen',
    needsYou: 'Needs you',
  } satisfies Record<HistoryStatus, string>,
  words: {
    bought: (symbol: string) => `Bought ${symbol}`,
    sold: (symbol: string) => `Sold ${symbol}`,
    swapped: (from: string, to: string) => `Swapped ${from} → ${to}`,
    sent: (symbol: string) => `Sent ${symbol}`,
    received: (symbol: string) => `Received ${symbol}`,
    bridged: (to: string | null) => `Bridged${to ? ` to ${DESTINATIONS_EN[to] ?? to}` : ''}`,
    crossSwapped: (from: string, to: string) => `Swap between networks ${from} → ${to}`,
    purchase: (symbol: string | null) => (symbol ? `Purchase of ${symbol}` : 'Purchase'),
    sale: (symbol: string | null) => (symbol ? `Sale of ${symbol}` : 'Sale'),
    swap: (from: string, to: string) => `Swap ${from} → ${to}`,
    transfer: (symbol: string) => `Transfer of ${symbol}`,
    incoming: (symbol: string) => `Incoming ${symbol}`,
    bridge: (to: string | null) => `Bridge${to ? ` to ${DESTINATIONS_EN[to] ?? to}` : ''}`,
    operation: 'Operation',
  } satisfies HistoryWords,
  // the receipt
  receipt: 'Receipt',
  paid: 'Paid',
  sent: 'Sent',
  sold: 'Sold',
  received: 'Received',
  fee: 'Fee',
  feeNotCollected: 'not collected',
  value: 'Value',
  valueDetail: 'value when filled',
  time: 'Time',
  updated: 'Updated',
  signature: 'Transaction',
  sourceTx: 'Source transaction',
  destinationTx: 'Destination transaction',
  destination: 'Destination',
  plan: 'Under a plan',
  planVersion: (version: number) => `version ${version}`,
  autoinvest: 'Recurring buy',
  byRule: 'By your rule',
  explorer: 'View on Solscan',
  destinations: DESTINATIONS_EN,
} as const

export type HistoryCopy = {
  readonly [K in keyof typeof EN]: (typeof EN)[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : (typeof EN)[K] extends HistoryWords
      ? HistoryWords
      : (typeof EN)[K] extends Record<string, string>
        ? Readonly<Record<keyof (typeof EN)[K], string>>
        : string
}

const DESTINATIONS_UK: Readonly<Record<string, string>> = {
  SOLANA: 'Solana',
  BASE: 'Base',
  ETHEREUM: 'Ethereum',
  ROBINHOOD: 'Robinhood Chain',
}

const UK: HistoryCopy = {
  title: 'Історія',
  all: 'Усі',
  incomplete: 'Список може бути неповним',
  unresolved: 'Операція чекає відповіді — відкрий Торгівлю',
  openTrade: 'Відкрити Торгівлю',
  emptyTitle: 'Операцій ще немає',
  emptyForAsset: (symbol) => `Операцій із ${symbol} ще немає`,
  didNotLoad: 'Історія не завантажилась',
  loading: 'Завантаження історії',
  status: {
    done: 'Підтверджено',
    pending: 'В обробці',
    failed: 'Не відбулося',
    needsYou: 'Потребує тебе',
  },
  words: {
    bought: (symbol) => `Куплено ${symbol}`,
    sold: (symbol) => `Продано ${symbol}`,
    swapped: (from, to) => `Обмін ${from} → ${to}`,
    sent: (symbol) => `Надіслано ${symbol}`,
    received: (symbol) => `Отримано ${symbol}`,
    bridged: (to) => `Міст${to ? ` → ${DESTINATIONS_UK[to] ?? to}` : ''}`,
    crossSwapped: (from, to) => `Обмін між мережами ${from} → ${to}`,
    purchase: (symbol) => (symbol ? `Купівля ${symbol}` : 'Купівля'),
    sale: (symbol) => (symbol ? `Продаж ${symbol}` : 'Продаж'),
    swap: (from, to) => `Обмін ${from} → ${to}`,
    transfer: (symbol) => `Переказ ${symbol}`,
    incoming: (symbol) => `Надходження ${symbol}`,
    bridge: (to) => `Міст${to ? ` → ${DESTINATIONS_UK[to] ?? to}` : ''}`,
    operation: 'Операція',
  },
  receipt: 'Квитанція',
  paid: 'Сплачено',
  sent: 'Надіслано',
  sold: 'Продано',
  received: 'Отримано',
  fee: 'Комісія',
  feeNotCollected: 'не стягнуто',
  value: 'Вартість',
  valueDetail: 'вартість на момент виконання',
  time: 'Час',
  updated: 'Оновлено',
  signature: 'Транзакція',
  sourceTx: 'Вихідна транзакція',
  destinationTx: 'Транзакція призначення',
  destination: 'Призначення',
  plan: 'За планом',
  planVersion: (version) => `версія ${version}`,
  autoinvest: 'Регулярна купівля',
  byRule: 'За правилом',
  explorer: 'Переглянути на Solscan',
  destinations: DESTINATIONS_UK,
}

export const HISTORY_COPY: Copy<HistoryCopy> = { en: EN, uk: UK }
