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
  coverage: 'Operations made through Ryntra',
  incomplete: 'The list may be incomplete',
  unresolved: 'A signed transaction awaits an answer — open Trade',
  openTrade: 'Open Trade',
  emptyTitle: 'No operations yet',
  emptyDetail: 'Every operation appears here with its receipt.',
  emptyForAsset: (symbol: string) => `No operations with ${symbol} yet`,
  didNotLoad: 'History did not load',
  loading: 'Loading history',
  status: {
    done: 'Settled',
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
    crossSwapped: (from: string, to: string) => `Cross-chain swap ${from} → ${to}`,
    operation: 'Operation',
  } satisfies HistoryWords,
  // the receipt
  receipt: 'Receipt',
  paid: 'Paid',
  received: 'Received',
  fee: 'Fee',
  feeNotCollected: 'not collected',
  value: 'Value',
  valueDetail: "the provider's figure at the fill",
  time: 'Time',
  updated: 'Updated',
  signature: 'Signature',
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
  coverage: 'Операції, зроблені через Ryntra',
  incomplete: 'Список може бути неповним',
  unresolved: 'Підписана транзакція чекає відповіді — відкрий Торгівлю',
  openTrade: 'Відкрити Торгівлю',
  emptyTitle: 'Операцій ще немає',
  emptyDetail: 'Кожна операція з’явиться тут зі своїм чеком.',
  emptyForAsset: (symbol) => `Операцій із ${symbol} ще немає`,
  didNotLoad: 'Історія не завантажилась',
  loading: 'Завантаження історії',
  status: {
    done: 'Виконано',
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
    crossSwapped: (from, to) => `Крос-чейн обмін ${from} → ${to}`,
    operation: 'Операція',
  },
  receipt: 'Чек',
  paid: 'Сплачено',
  received: 'Отримано',
  fee: 'Комісія',
  feeNotCollected: 'не стягнуто',
  value: 'Вартість',
  valueDetail: 'оцінка провайдера при виконанні',
  time: 'Час',
  updated: 'Оновлено',
  signature: 'Підпис',
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
