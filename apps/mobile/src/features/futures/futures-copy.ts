/**
 * The words of «Торгівля → Ф'ючерси» (C4) in both languages — the web's B7 words (`futures-words.ts` on line A) said
 * the phone's way: «ти», neutral to gender, one name for one thing. Phoenix, USDC and SOL are names, never translated.
 */

import type { Copy } from '../../lib/i18n.ts'
import type { ViewOnlyReason } from './futures-chart.ts'

export type FuturesCopy = Readonly<{
  /** The head's line: whose figures and when they were read. */
  readAt: (time: string) => string
  helpTitle: string
  help: readonly string[]
  /** The same help once orders are open for this wallet. */
  helpOrders: readonly string[]
  viewOnly: string
  upTo: (leverage: string) => string
  gated: string
  isolated: string
  /** Phoenix's session word for a market that trades by a calendar; a word not known here is not drawn. */
  sessions: Readonly<Record<'open' | 'closed' | 'afterhours', string>>
  /** The same state beside the label «Сесія» on a market's page, where «Сесія відкрита» would say it twice. */
  sessionStates: Readonly<Record<'open' | 'closed' | 'afterhours', string>>
  account: string
  connectLine: string
  noAccount: string
  shared: string
  collateral: string
  collateralSol: string
  /** What the account may still put into a new trade: its value over the margin its positions hold (C4e). */
  free: string
  /** A position's unrealised result, as a screen reader says it (C4f). */
  result: string
  state: string
  states: Readonly<Record<'uninitialized' | 'cold' | 'active' | 'reduceOnly' | 'frozen' | 'unknown', string>>
  positions: string
  noPositions: string
  everyPosition: (count: number) => string
  fewerPositions: string
  orders: string
  ordersCount: (count: number) => string
  long: string
  short: string
  buy: string
  sell: string
  size: string
  entry: string
  at: (price: string) => string
  reduceOnly: string
  stop: string
  /** Phoenix's order types; a type not known here is said as «Ордер». */
  types: Readonly<Record<'limit' | 'market' | 'postonly' | 'stoploss' | 'takeprofit' | 'immediateorcancel', string>>
  order: string
  loading: string
  noConnection: string
  needsNetwork: string
  down: string
  downLine: string
  tryAgain: string
  noMarkets: string
  notFound: string
  backToFutures: string
  mark: string
  index: string
  volume: string
  leverage: string
  margin: string
  isolatedOnly: string
  session: string
  chart: string
  chartLine: string
  chartNone: string
  loadingChart: string
  book: string
  price: string
  sizeIn: (symbol: string) => string
  spread: string
  bookEmpty: string
  loadingBook: string
  yours: string
  noneHere: (symbol: string) => string
  /** A screen reader's line for one level of the book. */
  levelA11y: (side: 'bid' | 'ask', price: string, size: string) => string
  /** The market as Phoenix names its perpetual: «SOL-PERP». */
  perp: (symbol: string) => string
  change: string
  openInterest: string
  /** The line under the book while a level can be pressed into the ticket. */
  pickHint: string
  /** A screen reader's line for a level that opens the ticket on Limit at its price. */
  pickA11y: (side: 'bid' | 'ask', price: string) => string
  /** Why the page is view only — the first line of its «?». */
  whyViewOnly: Readonly<Record<ViewOnlyReason, string>>
}>

export const FUTURES_COPY: Copy<FuturesCopy> = {
  en: {
    readAt: (time) => `Phoenix · ${time}`,
    helpTitle: 'Perps on Phoenix',
    help: [
      'Perps are perpetual futures: a position on a price, long or short, with leverage and no expiry date. Here — Phoenix’s perps on Solana: the markets, the order book and the chart come from Phoenix’s public data.',
      'Your positions and orders on Phoenix are read by your wallet’s address. Phoenix holds the collateral, never Ryntra.',
      'Orders — market and limit, TP/SL, cut and close — each go through a Review and your wallet’s signature once Ryntra opens them for your wallet; until then the page is view only.',
    ],
    helpOrders: [
      'Perps are perpetual futures: a position on a price, long or short, with leverage and no expiry date. Here — Phoenix’s perps on Solana: the markets, the order book and the chart come from Phoenix’s public data.',
      'Your positions and orders on Phoenix are read by your wallet’s address. Phoenix holds the collateral, never Ryntra.',
      'Orders — market and limit, TP/SL, cut and close — each through a Review with the leverage, the liquidation price, the collateral, the fees and the funding, and your wallet’s signature.',
    ],
    viewOnly: 'View only',
    upTo: (leverage) => `up to ${leverage}×`,
    gated: 'Not open to orders',
    isolated: 'Isolated margin',
    sessions: { open: 'Session open', closed: 'Session closed', afterhours: 'After hours' },
    sessionStates: { open: 'Open', closed: 'Closed', afterhours: 'After hours' },
    account: 'Your Phoenix account',
    connectLine: 'Connect a wallet to see your positions on Phoenix.',
    noAccount: 'This wallet has no Phoenix account. Phoenix accounts are by invite.',
    shared: 'The Phoenix account is shared with every app this wallet trades in.',
    collateral: 'USDC collateral',
    collateralSol: 'SOL collateral',
    free: 'Available to trade',
    result: 'result',
    state: 'Account',
    states: {
      uninitialized: 'Not opened',
      cold: 'Inactive',
      active: 'Active',
      reduceOnly: 'Reduce only',
      frozen: 'Waiting for access',
      unknown: '—',
    },
    positions: 'Positions',
    noPositions: 'No open positions.',
    everyPosition: (count) => `All positions · ${count}`,
    fewerPositions: 'Fewer positions',
    orders: 'Orders',
    ordersCount: (count) => `Orders: ${count}`,
    long: 'Long',
    short: 'Short',
    buy: 'Buy',
    sell: 'Sell',
    size: 'Size',
    entry: 'Entry',
    at: (price) => `at ${price}`,
    reduceOnly: 'Reduce only',
    stop: 'Stop',
    types: {
      limit: 'Limit',
      market: 'Market',
      postonly: 'Post-only',
      stoploss: 'Stop-loss',
      takeprofit: 'Take-profit',
      immediateorcancel: 'IOC',
    },
    order: 'Order',
    loading: 'Loading Phoenix markets',
    noConnection: 'No connection',
    needsNetwork: 'Phoenix’s markets need the internet.',
    down: 'Phoenix is not answering',
    downLine: 'The markets come back by themselves; you can also ask again.',
    tryAgain: 'Try again',
    noMarkets: 'Phoenix lists no markets right now.',
    notFound: 'Phoenix has no such market',
    backToFutures: 'Back to Perps',
    mark: 'Mark price',
    index: 'Index price',
    volume: '24h volume',
    leverage: 'Max leverage',
    margin: 'Margin',
    isolatedOnly: 'Isolated only',
    session: 'Session',
    chart: 'Chart',
    chartLine: 'Traded price on Phoenix',
    chartNone: 'No bars for this timeframe yet.',
    loadingChart: 'Loading the chart',
    book: 'Order book',
    price: 'Price',
    sizeIn: (symbol) => `Size, ${symbol}`,
    spread: 'Spread',
    bookEmpty: 'The book is empty right now.',
    loadingBook: 'Loading the order book',
    yours: 'Yours on Phoenix',
    noneHere: (symbol) => `No position or order on ${symbol}.`,
    levelA11y: (side, price, size) => `${side === 'bid' ? 'Bid' : 'Ask'} ${price}, ${size}`,
    perp: (symbol) => `${symbol}-PERP`,
    change: '24h change',
    openInterest: 'Open interest',
    pickHint: 'Tap a price to trade it with a limit order.',
    pickA11y: (side, price) => `${side === 'ask' ? 'Long' : 'Short'} with a limit at ${price}`,
    whyViewOnly: {
      gated: 'View only: Phoenix takes no orders on this market right now.',
      isolated:
        'View only: this market trades on isolated margin only, and Ryntra’s orders use your cross-margin account. Trade it on phoenix.trade.',
      units: 'View only: Phoenix has not sent this market’s price step, so no order can be built here yet.',
      wallet: 'View only: connect a wallet to trade this market.',
      account: 'View only: this wallet has no Phoenix account. Phoenix accounts are by invite.',
      gate: 'View only: Ryntra has not opened Phoenix orders for this wallet yet.',
    },
  },
  uk: {
    readAt: (time) => `Phoenix · ${time}`,
    helpTitle: 'Perps на Phoenix',
    help: [
      "Perps — безстрокові ф'ючерси: позиція на ціну, лонг чи шорт, із плечем і без дати закінчення. Тут — Perps Phoenix у мережі Solana: ринки, стакан і графік — з публічних даних Phoenix.",
      'Твої позиції й ордери на Phoenix читаються за адресою гаманця. Заставу тримає Phoenix, не Ryntra.',
      'Ордери — ринкові й лімітні, TP/SL, зменшення й закриття — проходять «Перевірку» й підпис твого гаманця, щойно Ryntra відкриє їх для твого гаманця; доти сторінка — лише перегляд.',
    ],
    helpOrders: [
      "Perps — безстрокові ф'ючерси: позиція на ціну, лонг чи шорт, із плечем і без дати закінчення. Тут — Perps Phoenix у мережі Solana: ринки, стакан і графік — з публічних даних Phoenix.",
      'Твої позиції й ордери на Phoenix читаються за адресою гаманця. Заставу тримає Phoenix, не Ryntra.',
      'Ордери — ринкові й лімітні, TP/SL, зменшення й закриття — кожен через «Перевірку» з плечем, ціною ліквідації, заставою, комісіями й фандингом і підпис твого гаманця.',
    ],
    viewOnly: 'Лише перегляд',
    upTo: (leverage) => `до ${leverage}×`,
    gated: 'Ордери не приймає',
    isolated: 'Ізольована маржа',
    sessions: { open: 'Сесія відкрита', closed: 'Сесія закрита', afterhours: 'Поза сесією' },
    sessionStates: { open: 'Відкрита', closed: 'Закрита', afterhours: 'Поза сесією' },
    account: 'Твій рахунок Phoenix',
    connectLine: 'Під’єднай гаманець, щоб бачити свої позиції на Phoenix.',
    noAccount: 'У цього гаманця немає рахунку Phoenix. Рахунки Phoenix — за запрошенням.',
    shared: 'Рахунок Phoenix спільний для всіх застосунків, де торгує цей гаманець.',
    collateral: 'Застава USDC',
    collateralSol: 'Застава SOL',
    free: 'Доступно для угод',
    result: 'результат',
    state: 'Рахунок',
    states: {
      uninitialized: 'Не відкрито',
      cold: 'Неактивний',
      active: 'Активний',
      reduceOnly: 'Лише зменшення',
      frozen: 'Чекає доступу',
      unknown: '—',
    },
    positions: 'Позиції',
    noPositions: 'Відкритих позицій немає.',
    everyPosition: (count) => `Усі позиції · ${count}`,
    fewerPositions: 'Згорнути позиції',
    orders: 'Ордери',
    ordersCount: (count) => `Ордерів: ${count}`,
    long: 'Лонг',
    short: 'Шорт',
    buy: 'Купівля',
    sell: 'Продаж',
    size: 'Розмір',
    entry: 'Вхід',
    at: (price) => `за ${price}`,
    reduceOnly: 'Лише зменшення',
    stop: 'Стоп',
    types: {
      limit: 'Ліміт',
      market: 'Ринковий',
      postonly: 'Лише мейкер',
      stoploss: 'Стоп-лос',
      takeprofit: 'Тейк-профіт',
      immediateorcancel: 'IOC',
    },
    order: 'Ордер',
    loading: 'Завантажуємо ринки Phoenix',
    noConnection: 'Немає з’єднання',
    needsNetwork: 'Для ринків Phoenix потрібен інтернет.',
    down: 'Phoenix не відповідає',
    downLine: 'Ринки повернуться самі; можна й спитати ще раз.',
    tryAgain: 'Спробувати ще раз',
    noMarkets: 'Зараз Phoenix не показує жодного ринку.',
    notFound: 'На Phoenix немає такого ринку',
    backToFutures: 'Назад до Perps',
    mark: 'Марк-ціна',
    index: 'Індексна ціна',
    volume: 'Обсяг за 24 год',
    leverage: 'Макс. плече',
    margin: 'Маржа',
    isolatedOnly: 'Лише ізольована',
    session: 'Сесія',
    chart: 'Графік',
    chartLine: 'Ціна угод на Phoenix',
    chartNone: 'Для цього інтервалу свічок ще немає.',
    loadingChart: 'Завантажуємо графік',
    book: 'Стакан',
    price: 'Ціна',
    sizeIn: (symbol) => `Розмір, ${symbol}`,
    spread: 'Спред',
    bookEmpty: 'Зараз стакан порожній.',
    loadingBook: 'Завантажуємо стакан',
    yours: 'Твоє на Phoenix',
    noneHere: (symbol) => `На ${symbol} немає ні позиції, ні ордера.`,
    levelA11y: (side, price, size) => `${side === 'bid' ? 'Купівля' : 'Продаж'} ${price}, ${size}`,
    perp: (symbol) => `${symbol}-PERP`,
    change: 'Зміна за 24 год',
    openInterest: 'Відкритий інтерес',
    pickHint: 'Торкнись ціни — відкриється лімітний ордер за нею.',
    pickA11y: (side, price) => `${side === 'ask' ? 'Лонг' : 'Шорт'} лімітом за ${price}`,
    whyViewOnly: {
      gated: 'Лише перегляд: зараз Phoenix не приймає ордери на цьому ринку.',
      isolated:
        'Лише перегляд: цей ринок торгується лише з ізольованою маржею, а ордери Ryntra — на твоєму крос-маржинальному рахунку. Торгувати ним можна на phoenix.trade.',
      units: 'Лише перегляд: Phoenix не надіслав крок ціни цього ринку, тож ордер тут поки не скласти.',
      wallet: 'Лише перегляд: під’єднай гаманець, щоб торгувати на цьому ринку.',
      account: 'Лише перегляд: у цього гаманця немає рахунку Phoenix. Рахунки Phoenix — за запрошенням.',
      gate: 'Лише перегляд: Ryntra ще не відкрила ордери Phoenix для цього гаманця.',
    },
  },
}

/** Phoenix's word, its spaces, dashes and case dropped, as the keys above are written. */
const keyOf = (word: string | null): string => (word ?? '').replace(/[\s_-]/g, '').toLowerCase()

/**
 * A calendar market's session in the person's language — a phrase in a list, the state alone beside «Сесія» (`short`);
 * null for a word the phone does not know (never English).
 */
export function sessionWord(session: string | null, words: FuturesCopy, short = false): string | null {
  const said = short ? words.sessionStates : words.sessions
  const key = keyOf(session)
  if (key === 'open' || key === 'active') return said.open
  if (key === 'closed') return said.closed
  if (key === 'afterhours') return said.afterhours
  return null
}

/** An order's type in the person's language; «Ордер» for a type the phone does not know. */
export function orderTypeWord(type: string, words: FuturesCopy): string {
  const key = keyOf(type) as keyof FuturesCopy['types']
  return words.types[key] ?? words.order
}
