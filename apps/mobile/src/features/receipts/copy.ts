import type { Copy } from '../../lib/i18n.ts'
import type { DocFeeKind, DocInitiator, DocKind, DocPartKind, DocStatus } from './receipt-doc.ts'

const EN = {
  // the door and the share
  share: 'Share as a picture',
  shareTitle: 'Share the receipt',
  shareEntry: 'Share the entry',
  showAmounts: 'Show the amounts',
  showAmountsHint: 'Never the wallet’s address.',
  shareAction: 'Share',
  shareFailed: 'The picture was not made. Try again.',
  shareUnavailable: 'This phone has nowhere to share a picture.',
  preparing: 'Making the picture',
  // the document
  receipt: 'Receipt',
  gave: 'Paid',
  sent: 'Sent',
  sold: 'Sold',
  got: 'Received',
  fees: 'Fees',
  bySource: 'By source',
  time: 'Time',
  status: 'Status',
  initiatorLabel: 'Started by',
  feeNotCollected: 'not collected',
  signature: 'Transaction',
  explorer: 'View on Solscan',
  footer: 'ryntra.io',
  kinds: {
    buy: 'Purchase',
    sell: 'Sale',
    swap: 'Swap',
    launch: 'Launch',
    claim: 'Fee claim',
    launchBuy: 'Launch token buy',
    launchSell: 'Launch token sale',
    send: 'Transfer',
    receive: 'Incoming',
    bridge: 'Between networks',
    crossSwap: 'Cross-chain swap',
    journal: 'Flight log',
    other: 'Operation',
  } satisfies Record<DocKind, string>,
  statuses: {
    done: 'Settled',
    pending: 'Pending',
    failed: 'Did not happen',
    partial: 'Partly',
    needsYou: 'Needs you',
  } satisfies Record<DocStatus, string>,
  feeKinds: {
    network: 'Network',
    venue: 'Meteora',
    ryntra: 'Ryntra',
    creator: 'Token’s creator',
    liquidity: 'Pool liquidity',
    rent: 'New account’s rent',
    tokenFee: 'Token’s transfer fee',
  } satisfies Record<DocFeeKind, string>,
  parts: {
    curve: 'Trading on the curve',
    graduation: 'DEX launch fee',
    lp: 'Locked liquidity',
    vault: 'Share from the vault',
  } satisfies Record<DocPartKind, string>,
  initiators: {
    you: 'You',
    rule: 'Your recurring-buy rule',
    plan: 'Your plan',
  } satisfies Record<DocInitiator, string>,
  // «Квитанції» in Portfolio
  title: 'Receipts',
  subtitle: (count: number) => `${count} ${count === 1 ? 'receipt' : 'receipts'}`,
  coverage: 'Every operation through Ryntra',
  search: 'Search by asset',
  searchA11y: 'Search receipts by asset',
  noMatch: (query: string) => `No receipts with “${query}”`,
  emptyTitle: 'No receipts yet',
  emptyDetail: 'Every purchase, sale, launch and transfer leaves its receipt here.',
  loading: 'Loading receipts',
  didNotLoad: 'Receipts did not load',
  partial: 'Some receipts were not read',
  launchesNotRead: 'Launches and claims were not read',
  ledgerNotRead: 'Purchases, sales and transfers were not read',
  launched: (symbol: string) => `Launched $${symbol}`,
  launchBought: (symbol: string) => `Bought $${symbol}`,
  launchSold: (symbol: string) => `Sold $${symbol}`,
  claimed: (symbol: string) => `Claimed · $${symbol}`,
} as const

export type ReceiptsCopy = {
  readonly [K in keyof typeof EN]: (typeof EN)[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : (typeof EN)[K] extends Record<string, string>
      ? Readonly<Record<keyof (typeof EN)[K], string>>
      : string
}

/** «1 квитанція», «2 квитанції», «5 квитанцій». */
function ukReceipts(count: number): string {
  const ten = count % 10
  const hundred = count % 100
  if (ten === 1 && hundred !== 11) return 'квитанція'
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'квитанції'
  return 'квитанцій'
}

const UK: ReceiptsCopy = {
  share: 'Поділитися картинкою',
  shareTitle: 'Поділитися квитанцією',
  shareEntry: 'Поділитися записом',
  showAmounts: 'Показати суми',
  showAmountsHint: 'Адреси гаманця — ніколи.',
  shareAction: 'Поділитися',
  shareFailed: 'Картинка не вийшла. Спробуй ще раз.',
  shareUnavailable: 'На цьому телефоні нема куди поділитися картинкою.',
  preparing: 'Готуємо картинку',
  receipt: 'Квитанція',
  gave: 'Сплачено',
  sent: 'Надіслано',
  sold: 'Продано',
  got: 'Отримано',
  fees: 'Комісії',
  bySource: 'За джерелами',
  time: 'Час',
  status: 'Стан',
  initiatorLabel: 'Ініціатор',
  feeNotCollected: 'не стягнуто',
  signature: 'Транзакція',
  explorer: 'Переглянути на Solscan',
  footer: 'ryntra.io',
  kinds: {
    buy: 'Купівля',
    sell: 'Продаж',
    swap: 'Обмін',
    launch: 'Лаунч',
    claim: 'Забрано',
    launchBuy: 'Купівля токена лаунчу',
    launchSell: 'Продаж токена лаунчу',
    send: 'Переказ',
    receive: 'Надходження',
    bridge: 'Між мережами',
    crossSwap: 'Крос-чейн обмін',
    journal: 'Бортовий журнал',
    other: 'Операція',
  },
  statuses: {
    done: 'Виконано',
    pending: 'В обробці',
    failed: 'Не відбулося',
    partial: 'Частково',
    needsYou: 'Потребує тебе',
  },
  feeKinds: {
    network: 'Мережа',
    venue: 'Meteora',
    ryntra: 'Ryntra',
    creator: 'Творець токена',
    liquidity: 'Ліквідність пулу',
    rent: 'Рента нового рахунку',
    tokenFee: 'Комісія токена за переказ',
  },
  parts: {
    curve: 'Торгівля на кривій',
    graduation: 'Комісія виходу на DEX',
    lp: 'Замкнена ліквідність',
    vault: 'Частка зі сховища',
  },
  initiators: {
    you: 'Ти',
    rule: 'Твоє правило регулярної купівлі',
    plan: 'Твій план',
  },
  title: 'Квитанції',
  subtitle: (count) => `${count} ${ukReceipts(count)}`,
  coverage: 'Кожна операція через Ryntra',
  search: 'Пошук за активом',
  searchA11y: 'Пошук квитанцій за активом',
  noMatch: (query) => `Квитанцій із «${query}» немає`,
  emptyTitle: 'Квитанцій ще немає',
  emptyDetail: 'Кожна купівля, продаж, лаунч і переказ лишає тут свою квитанцію.',
  loading: 'Завантаження квитанцій',
  didNotLoad: 'Квитанції не завантажились',
  partial: 'Частину квитанцій не прочитано',
  launchesNotRead: 'Лаунчі й «Забрати» не прочитано',
  ledgerNotRead: 'Купівлі, продажі й перекази не прочитано',
  launched: (symbol) => `Запущено $${symbol}`,
  launchBought: (symbol) => `Куплено $${symbol}`,
  launchSold: (symbol) => `Продано $${symbol}`,
  claimed: (symbol) => `Забрано · $${symbol}`,
}

export const RECEIPTS_COPY: Copy<ReceiptsCopy> = { en: EN, uk: UK }
