/**
 * The words of the new look's Trade (NEW-LOOK §3 «Торгівля», §4, §5, §8): the
 * segments, the one sheet of a purchase and a sale, «Перевірка», the wait for
 * the wallet and «Готово». «ти», neutral to gender; one name for one thing.
 */

import type { Copy } from '../../lib/i18n.ts'
import type { OrderType } from './rule-ticket.ts'

export type TradeSegment = 'markets' | 'swap' | 'futures' | 'predictions'

export type SheetCopy = Readonly<{
  segments: Readonly<Record<TradeSegment, string>>
  segmentsA11y: string
  chips: Readonly<Record<'all' | 'stocks' | 'crypto' | 'memes' | 'launches' | 'watchlist', string>>
  search: string
  buyTitle: (symbol: string) => string
  sellTitle: (symbol: string) => string
  pickTitle: string
  type: string
  howTitle: Readonly<{ buy: string; sell: string }>
  types: Readonly<Record<OrderType, string>>
  /** What each order type does — one tap deep, behind «?» beside «Тип» (ST-4), never a line under an option. */
  typeLines: Readonly<{ buy: Readonly<Record<OrderType, string>>; sell: Readonly<Record<'market' | 'limit', string>> }>
  payFrom: string
  receiveIn: string
  /** A purchase is from $1 — said under the sum and on the held action. */
  fromOneDollar: string
  notEnough: (symbol: string) => string
  lessInPosition: string
  view: string
  keypadDelete: string
  check: string
  checkSwap: string
  spend: string
  receive: string
  minimum: (amount: string) => string
  allCosts: string
  whatIs: string
  details: string
  hideDetails: string
  validFor: (left: string) => string
  /** An estimate's time beside its figure (ST-5 r10): «о 12:04». */
  quotedAt: (time: string) => string
  stale: string
  refreshCheck: string
  /** AG-2b: the Review renews its bytes by itself while it is read; at a press the wallet opens once they are fresh. */
  renewing: string
  renewingThenWallet: string
  confirmInWallet: string
  confirmInYourWallet: string
  /** Behind «?» beside «Підтверди в гаманці»: the Ledger's 20 seconds (ST-4). */
  ledgerWait: string
  /** «Скасувати» under the wallet's wait (M45). */
  cancelWait: string
  /** After Ledger's 6808, in place of «Підтвердити в гаманці». */
  tryAgain: string
  sending: string
  done: Readonly<{ buy: string; sell: string; swap: string }>
  receiptSaved: string
  share: string
  finish: string
  give: string
  get: string
  /**
   * What a ticket can use of what it pays with (ST-5): for SOL less what the trade keeps back for its token accounts
   * (`SOL_SWAP_RESERVE_LAMPORTS`), so never «Available» — Portfolio's «Available to spend» is the wallet's whole figure.
   */
  canUse: (amount: string) => string
  canUseTitle: string
  /** Behind «?» beside «Can use» when it is SOL: why it is less than Portfolio's «Available to spend». */
  solKept: (amount: string) => string
  viewSwap: string
  inBrowser: string
  launchOwn: string
  stocksTitle: string
  stocksNote: string
}>

export const SHEET_COPY: Copy<SheetCopy> = {
  en: {
    segments: { markets: 'Markets', swap: 'Swap', futures: 'Perps', predictions: 'Predictions' },
    segmentsA11y: 'Trade',
    chips: {
      all: 'All',
      stocks: 'Stocks',
      crypto: 'Crypto',
      memes: 'Memes',
      launches: 'Launches',
      watchlist: 'Favourites',
    },
    search: 'Search',
    buyTitle: (symbol) => `Buy ${symbol}`,
    sellTitle: (symbol) => `Sell ${symbol}`,
    pickTitle: 'What to buy',
    type: 'Type',
    howTitle: { buy: 'How to buy', sell: 'How to sell' },
    types: { market: 'Market', limit: 'Limit', recurring: 'Recurring' },
    typeLines: {
      buy: {
        market: 'Buy now at the best price',
        limit: 'Buy when the price falls to yours',
        recurring: 'Buy a sum every week or month',
      },
      sell: { market: 'Sell now at the best price', limit: 'Sell when the price rises to yours' },
    },
    payFrom: 'Pay with',
    receiveIn: 'Receive in',
    fromOneDollar: 'A purchase is from $1',
    notEnough: (symbol) => `Not enough ${symbol}`,
    lessInPosition: 'Your position holds less',
    view: 'Review',
    keypadDelete: 'Delete',
    check: 'Review',
    checkSwap: 'Swap review',
    spend: 'You spend',
    receive: 'You receive',
    minimum: (amount) => `at least ${amount}`,
    allCosts: 'All costs',
    whatIs: 'What it is',
    details: 'Details',
    hideDetails: 'Hide details',
    validFor: (left) => `Price valid for ${left}`,
    quotedAt: (time) => `at ${time}`,
    stale: 'The price is out of date',
    refreshCheck: 'Refresh the Review',
    renewing: 'Updating the price…',
    renewingThenWallet: 'Updating the price — the wallet opens by itself',
    confirmInWallet: 'Confirm in wallet',
    confirmInYourWallet: 'Confirm in your wallet',
    ledgerWait: 'On a Ledger, confirm on the device within 20 seconds: a transaction lives about 30.',
    cancelWait: 'Cancel',
    tryAgain: 'Try again',
    sending: 'Sending…',
    done: { buy: 'Bought', sell: 'Sold', swap: 'Swapped' },
    receiptSaved: 'Receipt saved',
    share: 'Share',
    finish: 'Done',
    give: 'You give',
    get: 'You get',
    canUse: (amount) => `Can use ${amount}`,
    canUseTitle: 'Can use',
    solKept: (amount) =>
      `A trade that spends SOL leaves ${amount} in the wallet: the deposits of the token accounts it may open — wrapped SOL and the token bought. The network fee is already set aside. So «Can use» is a little less than «Available to spend» in Portfolio.`,
    viewSwap: 'Review swap',
    inBrowser: 'opens in the browser',
    launchOwn: 'Launch your own token',
    stocksTitle: 'Tokenized stocks',
    stocksNote: 'Tokenized stocks trade around the clock. They are not shares but tokens that track them.',
  },
  uk: {
    segments: { markets: 'Ринки', swap: 'Обмін', futures: 'Perps', predictions: 'Прогнози' },
    segmentsA11y: 'Торгівля',
    chips: { all: 'Усі', stocks: 'Акції', crypto: 'Крипто', memes: 'Меми', launches: 'Лаунчі', watchlist: 'Обране' },
    search: 'Пошук',
    buyTitle: (symbol) => `Купити ${symbol}`,
    sellTitle: (symbol) => `Продати ${symbol}`,
    pickTitle: 'Що купити',
    type: 'Тип',
    howTitle: { buy: 'Як купити', sell: 'Як продати' },
    types: { market: 'Ринок', limit: 'Ліміт', recurring: 'Регулярно' },
    typeLines: {
      buy: {
        market: 'Купити зараз за найкращою ціною',
        limit: 'Купити, коли ціна опуститься до твоєї',
        recurring: 'Купувати на суму щотижня чи щомісяця',
      },
      sell: { market: 'Продати зараз за найкращою ціною', limit: 'Продати, коли ціна підніметься до твоєї' },
    },
    payFrom: 'Платиш з',
    receiveIn: 'Отримаєш у',
    fromOneDollar: 'Купівля — від $1',
    notEnough: (symbol) => `Недостатньо ${symbol}`,
    lessInPosition: 'У позиції менше',
    view: 'Перевірка',
    keypadDelete: 'Стерти',
    check: 'Перевірка',
    checkSwap: 'Перевірка обміну',
    spend: 'Спишеться',
    receive: 'Отримаєш',
    minimum: (amount) => `мінімум ${amount}`,
    allCosts: 'Усі витрати',
    whatIs: 'Що це',
    details: 'Деталі',
    hideDetails: 'Сховати деталі',
    validFor: (left) => `Ціна дійсна ще ${left}`,
    quotedAt: (time) => `о ${time}`,
    stale: 'Ціна застаріла',
    refreshCheck: 'Оновити «Перевірку»',
    renewing: 'Оновлюємо ціну…',
    renewingThenWallet: 'Оновлюємо ціну — гаманець відкриється сам',
    confirmInWallet: 'Підтвердити в гаманці',
    confirmInYourWallet: 'Підтверди в гаманці',
    ledgerWait: 'На Ledger підтверди на пристрої за 20 секунд: транзакція живе близько 30.',
    cancelWait: 'Скасувати',
    tryAgain: 'Спробувати знову',
    sending: 'Надсилаємо…',
    done: { buy: 'Куплено', sell: 'Продано', swap: 'Обміняно' },
    receiptSaved: 'Квитанцію збережено',
    share: 'Поділитися',
    finish: 'Готово',
    give: 'Віддаєш',
    get: 'Отримуєш',
    canUse: (amount) => `Можна використати ${amount}`,
    canUseTitle: 'Можна використати',
    solKept: (amount) =>
      `Угода, що витрачає SOL, лишає в гаманці ${amount}: депозити рахунків токенів, які вона може відкрити, — для обгорнутого SOL і для купленого токена. Комісію мережі вже відкладено. Тому «Можна використати» трохи менше, ніж «Доступно до витрати» в Портфелі.`,
    viewSwap: 'Перевірка обміну',
    inBrowser: 'відкривається в браузері',
    launchOwn: 'Запустити свій токен',
    stocksTitle: 'Токенізовані акції',
    stocksNote: 'Токенізовані акції торгуються цілодобово. Це не акції, а токени, що їх відстежують.',
  },
}

/** «0:30» — a window's seconds as a clock, the way «Ціна дійсна ще …» reads it. */
export function clockOf(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
