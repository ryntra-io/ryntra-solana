/**
 * The words of Phoenix orders on the phone (C4b) in both languages — the web's B6b words (`order-words.ts` on line A)
 * said the phone's way: «ти», neutral to gender, «Перевірка» for the Review as every other operation of the app says
 * it. Phoenix, USDC, SOL, TP/SL and PERP are names, never translated. The wallet's own failures are the limits' words.
 */

import type { Copy } from '../../lib/i18n.ts'

import type { OrderFailure, PerpSide } from './orders-model.ts'
import type { PerpBlock } from './perp-order-model.ts'

export type OrderCopy = Readonly<{
  long: string
  short: string
  /** A side inside a phrase: «лонг», «шорт». */
  sideWord: (side: PerpSide) => string
  openTitle: (side: PerpSide, symbol: string) => string
  market: string
  limit: string
  amount: string
  limitPrice: string
  markAt: (price: string, time: string) => string
  sizeLine: (size: string, symbol: string) => string
  available: (amount: string) => string
  availableTitle: string
  availableHelp: string
  canary: (amount: string) => string
  tpsl: string
  tpField: string
  slField: string
  legsLine: string
  limitLegs: string
  stopSlip: (share: string) => string
  review: (side: PerpSide) => string
  preparing: string
  /* the ticket's own (C4c, the web's PERP-2 words) */
  cross: string
  crossHelp: string
  leverage: string
  leverageTitle: (symbol: string) => string
  leverageHelp: (max: string) => string
  leverageDone: string
  size: string
  sizeUnder: (size: string, symbol: string, usd: string) => string
  max: string
  reduceOnly: string
  legResult: (usd: string, percent: string) => string
  liquidation: string
  liquidationNever: string
  inReview: string
  liquidationHelp: string
  orderValue: string
  bookFill: string
  margin: string
  marginHelp: string
  accountLeverage: string
  feesLabel: string
  feesAmount: (amount: string) => string
  feesRates: (phoenix: string, ryntra: string) => string
  feesMarketHelp: (phoenix: string, ryntra: string) => string
  feesLimitHelp: (maker: string, taker: string, ryntra: string) => string
  deposit: string
  reviewReduce: string
  perpBlocks: Readonly<Record<PerpBlock | 'thin', string>>
  /** Under the size while the ticket has no size, or a limit no price: what «Перевірка» waits for (C4e). */
  sizeHint: string
  /** Where the shares cannot be offered (reduce-only, the free collateral unknown): the size alone. */
  sizeOnlyHint: string
  priceHint: string
  viewOnly: string
  viewOnlyLine: string
  noAccount: string
  gated: string
  isolated: string
  /* the position */
  manage: string
  positionTitle: (side: PerpSide, size: string, symbol: string) => string
  cut: string
  close: string
  cancelOrder: string
  isolatedHere: string
  cutTitle: (side: PerpSide, symbol: string) => string
  cutShare: (size: string, symbol: string) => string
  protectTitle: (side: PerpSide, symbol: string) => string
  protectLine: string
  nowLegs: (tp: string, sl: string) => string
  /* the Review */
  check: string
  titles: Readonly<{
    open: (side: PerpSide, size: string, symbol: string, type: string) => string
    reduce: (side: PerpSide, size: string, symbol: string) => string
    close: (side: PerpSide, size: string, symbol: string) => string
    protect: (side: PerpSide, symbol: string) => string
    cancel: (symbol: string) => string
  }>
  pay: string
  get: string
  payMargin: (amount: string) => string
  payPosition: (side: PerpSide, size: string, symbol: string) => string
  payNone: string
  getPosition: (side: PerpSide, size: string, symbol: string, usd: string) => string
  getCollateral: (amount: string) => string
  /** A cut's or a close's result below zero: what leaves the collateral, said without a minus. */
  getCollateralOut: (amount: string) => string
  getLegs: string
  getLift: string
  getCancel: string
  rows: Readonly<{
    type: string
    worst: string
    limit: string
    slippage: string
    order: string
    mark: string
    positionAfter: string
    leverageAfter: string
    liquidation: string
    collateralAfter: string
    freeAfter: string
    funding: string
    tp: string
    sl: string
    legsLifted: string
  }>
  liquidationAway: (share: string) => string
  noLiquidation: string
  liquidationNone: string
  fundingLongs: (rate: string) => string
  fundingShorts: (rate: string) => string
  legsLiftedValue: string
  costs: string
  costPhoenix: string
  costRyntra: string
  costNetwork: string
  costRent: string
  rentNote: string
  costTaker: (amount: string, rate: string) => string
  costLimit: (maker: string, taker: string) => string
  costBuilderLimit: (rate: string) => string
  costNone: string
  costsTotal: (usdc: string, sol: string) => string
  whatIs: string
  what: Readonly<{
    openMarket: (price: string) => string
    openLimit: (price: string) => string
    reduce: (price: string) => string
    close: (price: string) => string
    protect: string
    cancel: string
  }>
  risk: string
  valid: string
  details: string
  traderAccount: string
  program: string
  wallet: string
  confirm: string
  rebuilt: string
  /* the receipt */
  receipt: Readonly<{
    filled: string
    resting: string
    reduced: string
    closed: string
    protect: string
    lift: string
    cancel: string
    pending: string
    failed: string
  }>
  states: Readonly<{ done: string; pending: string; failed: string }>
  fill: (side: PerpSide, size: string, symbol: string, price: string) => string
  fillPending: string
  noFill: string
  fees: (amount: string) => string
  pnl: (amount: string) => string
  held: (size: string, symbol: string) => string
  nothingMoved: string
  notSent: string
  pendingLine: string
  pendingStopped: string
  network: string
  explorer: string
  again: string
  againWait: string
  failures: Readonly<Record<OrderFailure, string>>
}>

const UK_SIDE: Readonly<Record<PerpSide, string>> = { long: 'лонг', short: 'шорт' }

export const ORDER_COPY: Copy<OrderCopy> = {
  en: {
    long: 'Long',
    short: 'Short',
    sideWord: (side) => side,
    openTitle: (side, symbol) => `${side === 'long' ? 'Long' : 'Short'} ${symbol}-PERP`,
    market: 'Market',
    limit: 'Limit',
    amount: 'Position size, USD',
    limitPrice: 'Limit price, USD',
    markAt: (price, time) => `Mark ${price} · ${time}`,
    sizeLine: (size, symbol) => `≈ ${size} ${symbol}`,
    available: (amount) => `Available ${amount}`,
    availableTitle: 'Available',
    availableHelp:
      'The collateral free for new positions on your Phoenix account. The leverage you pick sets how much of it an order puts to work; the Review shows Phoenix’s own figures before you sign.',
    canary: (amount) => `The first check takes an order of up to ${amount}.`,
    tpsl: 'TP/SL',
    tpField: 'Take profit, USD',
    slField: 'Stop loss, USD',
    legsLine: 'On the whole position, by the mark price. Empty — none.',
    limitLegs: 'A limit order rests: set TP/SL on the position once it fills.',
    stopSlip: (share) => `A stop fills as a market order up to ${share} from its trigger.`,
    review: (side) => (side === 'long' ? 'Review long' : 'Review short'),
    preparing: 'Preparing…',
    cross: 'Cross',
    crossHelp: 'Cross margin: every position stands on your whole Phoenix account.',
    leverage: 'Leverage',
    leverageTitle: (symbol) => `Leverage · ${symbol}-PERP`,
    leverageHelp: (max) =>
      `How much of the free collateral the order puts to work. Up to ${max}× on this market; a larger position gets the next tier’s leverage.`,
    leverageDone: 'Done',
    size: 'Size',
    sizeUnder: (size, symbol, usd) => `≈ ${size} ${symbol} · ${usd}`,
    max: 'Max',
    reduceOnly: 'Reduce only',
    legResult: (usd, percent) => `${usd} · ${percent}`,
    liquidation: 'Liquidation',
    liquidationNever: 'none',
    inReview: 'in Review',
    liquidationHelp: '≈ by Phoenix’s risk figures. The Review shows Phoenix’s own before you sign.',
    orderValue: 'Order value',
    bookFill: 'Fill from the book',
    margin: 'Margin',
    marginHelp:
      '≈ what Phoenix holds from your collateral for this order, at its tier’s leverage. The leverage you pick sizes the order.',
    accountLeverage: 'Account leverage',
    feesLabel: 'Fees',
    feesAmount: (amount) => `≈ ${amount} USDC`,
    feesRates: (phoenix, ryntra) => `${phoenix} + ${ryntra}`,
    feesMarketHelp: (phoenix, ryntra) =>
      `Phoenix ${phoenix} and Ryntra ${ryntra} of the order’s value, out of the same collateral.`,
    feesLimitHelp: (maker, taker, ryntra) =>
      `Phoenix ${maker} while the order rests, ${taker} of a part that fills at once; Ryntra ${ryntra} of that part only.`,
    deposit: 'Add collateral',
    reviewReduce: 'Review reduce',
    sizeHint: 'Enter a size or pick a share.',
    sizeOnlyHint: 'Enter a size.',
    priceHint: 'Enter the limit price.',
    perpBlocks: {
      SIZE: 'Enter a size as a number.',
      PRICE: 'Enter a price as a number.',
      MINIMUM: 'An order opens at least one dollar and one lot.',
      LOT: 'Less than one lot of this market.',
      CEILING: 'Above the first check’s ceiling for a new position.',
      MARGIN: 'Not enough collateral for this size with its fees. Make it smaller or add collateral.',
      OVER_MAX: 'More than the collateral allows at this leverage.',
      TP: 'Enter the take profit as a number.',
      SL: 'Enter the stop loss as a number.',
      TP_SIDE: 'The take profit is on the wrong side of the price.',
      SL_SIDE: 'The stop loss is on the wrong side of the price.',
      REDUCE_LIMIT: 'Reduce only works with a market order here.',
      REDUCE_SIDE: 'Reduce only goes against the position: switch the side.',
      REDUCE_NONE: 'No position on this market to reduce.',
      REDUCE_OVER: 'More than the position holds.',
      thin: 'The book cannot fill this size now.',
    },
    viewOnly: 'View only',
    viewOnlyLine: 'Orders from Ryntra are not open for this wallet yet — view only.',
    noAccount: 'This wallet has no Phoenix account. Phoenix accounts are by invite.',
    gated: 'Phoenix does not take orders on this market now.',
    isolated: 'This market trades on isolated margin only; Ryntra opens cross-margin positions.',
    manage: 'Manage',
    positionTitle: (side, size, symbol) => `${side === 'long' ? 'Long' : 'Short'} ${size} ${symbol}-PERP`,
    cut: 'Cut',
    close: 'Close',
    cancelOrder: 'Cancel order',
    isolatedHere: 'Isolated margin — managed on phoenix.trade',
    cutTitle: (side, symbol) => `Cut the ${side} ${symbol}-PERP`,
    cutShare: (size, symbol) => `How much of ${size} ${symbol}`,
    protectTitle: (side, symbol) => `TP/SL · ${side} ${symbol}-PERP`,
    protectLine: 'On the whole position, by the mark price. Empty — none; the current ones are lifted.',
    nowLegs: (tp, sl) => `Now: TP ${tp} · SL ${sl}`,
    check: 'Review',
    titles: {
      open: (side, size, symbol, type) => `${side === 'long' ? 'Long' : 'Short'} ${size} ${symbol}-PERP · ${type}`,
      reduce: (side, size, symbol) => `Cut the ${side} ${symbol}-PERP by ${size}`,
      close: (side, size, symbol) => `Close the ${side} ${size} ${symbol}-PERP`,
      protect: (side, symbol) => `TP/SL · ${side} ${symbol}-PERP`,
      cancel: (symbol) => `Cancel the order on ${symbol}-PERP`,
    },
    pay: 'You put in',
    get: 'You get',
    payMargin: (amount) => `${amount} USDC of collateral as margin`,
    payPosition: (side, size, symbol) => `${side === 'long' ? 'Long' : 'Short'} ${size} ${symbol}`,
    payNone: 'Nothing moves from the wallet',
    getPosition: (side, size, symbol, usd) => `${side === 'long' ? 'Long' : 'Short'} ${size} ${symbol} ≈ ${usd} USD`,
    getCollateral: (amount) => `${amount} USDC to your collateral`,
    getCollateralOut: (amount) => `${amount} USDC out of your collateral`,
    getLegs: 'TP/SL on the whole position',
    getLift: 'The position without TP/SL',
    getCancel: 'The order leaves the book; its margin is freed',
    rows: {
      type: 'Type',
      worst: 'Worst price',
      limit: 'Limit price',
      slippage: 'Tolerance',
      order: 'Order',
      mark: 'Mark price',
      positionAfter: 'Position after',
      leverageAfter: 'Leverage after',
      liquidation: 'Liquidation (mark)',
      collateralAfter: 'Collateral after',
      freeAfter: 'Free collateral after',
      funding: 'Funding, an hour',
      tp: 'Take profit',
      sl: 'Stop loss',
      legsLifted: 'Current TP/SL',
    },
    liquidationAway: (share) => `${share} from the mark`,
    noLiquidation: 'none — no position after',
    liquidationNone: 'Phoenix found none in bounds',
    fundingLongs: (rate) => `${rate} · longs pay shorts`,
    fundingShorts: (rate) => `${rate} · shorts pay longs`,
    legsLiftedValue: 'lifted by this transaction',
    costs: 'Costs',
    costPhoenix: 'Phoenix',
    costRyntra: 'Ryntra',
    costNetwork: 'Network',
    costRent: 'TP/SL deposit',
    rentNote:
      'The TP/SL deposit opens the Phoenix account that holds your TP/SL. It is rent on Solana and stays yours.',
    costTaker: (amount, rate) => `${amount} USDC · ${rate}`,
    costLimit: (maker, taker) => `${maker} resting, ${taker} if it fills at once`,
    costBuilderLimit: (rate) => `${rate} only of the part that fills at once`,
    costNone: 'none',
    costsTotal: (usdc, sol) => (usdc ? `≈ ${usdc} USDC + ${sol}` : sol),
    whatIs: 'What it is',
    what: {
      openMarket: (price) =>
        `A market order on Phoenix: it fills all of it at once at no worse than ${price}, or nothing. Your collateral backs the position; Phoenix’s program holds it, never Ryntra.`,
      openLimit: (price) =>
        `A limit order rests in Phoenix’s book at ${price} until it fills or you cancel it; its margin is held meanwhile.`,
      reduce: (price) =>
        `A reduce-only market order: it can only make the position smaller, at no worse than ${price}.`,
      close: (price) => `Closes the whole position with a reduce-only market order at no worse than ${price}.`,
      protect: 'Phoenix holds the take profit and the stop loss and fires them on the mark price.',
      cancel: 'Takes your resting order out of Phoenix’s book.',
    },
    risk: 'Valid for about 30 seconds. Leverage magnifies losses: a liquidation can take the position’s collateral.',
    valid: 'Valid for about 30 seconds.',
    details: 'Details',
    traderAccount: 'Phoenix account',
    program: 'Program',
    wallet: 'Wallet',
    confirm: 'Confirm in wallet',
    rebuilt:
      'The Review was built again — a transaction lives only about 30 seconds. Nothing was sent; check it and confirm.',
    receipt: {
      filled: 'Filled on Phoenix',
      resting: 'Order in Phoenix’s book',
      reduced: 'Position cut',
      closed: 'Position closed',
      protect: 'TP/SL set',
      lift: 'TP/SL lifted',
      cancel: 'Order cancelled',
      pending: 'Waiting for the network',
      failed: 'Did not go through',
    },
    states: { done: 'Done', pending: 'Waiting', failed: 'Failed' },
    fill: (side, size, symbol, price) => `${side === 'long' ? 'Long' : 'Short'} ${size} ${symbol} · ${price}`,
    fillPending: 'Phoenix has not shown the fill yet',
    noFill: 'Nothing filled — the order rests',
    fees: (amount) => `Phoenix fee ${amount} USDC`,
    pnl: (amount) => `Result ${amount} USDC`,
    held: (size, symbol) => `+${size} ${symbol} in the position`,
    nothingMoved: 'The order did not go through; the network fee was charged.',
    notSent: 'The order was not sent. Nothing moved.',
    pendingLine: 'The network has not answered yet. The order is not sent again — this screen follows it.',
    pendingStopped: 'The network did not answer in two minutes. The order is not sent again — see it in the explorer.',
    network: 'Solana · Phoenix',
    explorer: 'View in explorer',
    again: 'New order',
    againWait: 'A new order opens once the network has answered.',
    failures: {
      ORDERS_CLOSED: 'Orders from Ryntra are not open for this wallet yet — view only.',
      CANARY_LIMIT: 'The first check takes a smaller order.',
      BELOW_MINIMUM: 'An order is at least $1 of notional.',
      LIMIT_FAR: 'The limit crosses the price by more than 5 %. Use a market order or a closer price.',
      MARKET_GATED: 'Phoenix does not take orders on this market now.',
      ISOLATED_ONLY: 'This market trades on isolated margin only.',
      ACCOUNT_NEEDED: 'This wallet has no Phoenix account yet.',
      TRADING_CLOSED: 'Phoenix does not take this order on this account now.',
      TP_SIDE: 'The take profit is on the wrong side of the price.',
      SL_SIDE: 'The stop loss is on the wrong side of the price.',
      LEGS_SIDE: 'This order cuts the position: set TP/SL on the position itself.',
      PRICE_UNKNOWN: 'Phoenix’s mark price did not arrive. Nothing was built.',
      NOT_FILLABLE: 'The book cannot fill this size within the tolerance now. Nothing was signed.',
      NO_POSITION: 'There is no position on this market now.',
      OVER_POSITION: 'More than the position holds.',
      NO_ORDER: 'Phoenix no longer holds this order.',
      NOTHING_TO_CHANGE: 'There is no TP/SL to lift and none was set.',
      NEEDS_SOL: 'The wallet needs a little SOL for the network fee.',
      MARGIN_SHORT:
        'The collateral cannot carry this order with its fees. Make it smaller or add collateral. Nothing was signed.',
      SIMULATION_FAILED:
        'Phoenix would refuse this order now: margin, the market’s state or the account’s. Nothing was signed.',
      BUILDER_UNAVAILABLE: 'Orders cannot be built now. Nothing was signed.',
      PHOENIX_UNAVAILABLE: 'Phoenix did not answer. Nothing was built.',
      RELAY_REFUSED: 'The network refused it before sending. Nothing moved.',
      TICKET_EXPIRED: 'The Review timed out. Nothing was sent — refresh the Review.',
      WALLET_MISMATCH: 'The connected wallet changed. Review again.',
      RATE_LIMITED: 'Too many requests. Try again in a minute.',
      signIn: 'Sign in your wallet again to place orders.',
      network: 'No connection. Nothing was sent.',
      walletRefused: 'The wallet did not sign. Nothing was sent.',
      walletCancelled: 'Wallet approval was cancelled. Nothing was sent.',
      walletTimeout: 'Your wallet did not answer within 90 seconds. Nothing was sent — refresh the Review.',
      walletCannotSign:
        "This wallet does not sign transactions for apps — it only sends them itself. Nothing was sent; use Phantom, Solflare or the Seeker's wallet.",
      ledgerBlind:
        'The Ledger did not sign: “Blind signing” is off in its Solana app. Turn it on in the app’s settings and try again.',
      txVersion:
        'This transaction is in a format a Ledger cannot sign yet, so the wallet was not opened. Nothing was sent.',
      reviewAged:
        'The Review was built again — a transaction lives only about 30 seconds. Nothing was sent; check it and confirm.',
      deviceConfirm:
        'A transaction lives about 30 seconds: confirm in the wallet, or on a Ledger, within 20 seconds. Nothing was sent — refresh the Review.',
      general: 'Something went wrong. Nothing moved.',
      outcomeUnknown:
        'The answer did not come back, and the order may have been sent. Check your position before placing it again.',
    },
  },
  uk: {
    long: 'Лонг',
    short: 'Шорт',
    sideWord: (side) => UK_SIDE[side],
    openTitle: (side, symbol) => `${side === 'long' ? 'Лонг' : 'Шорт'} ${symbol}-PERP`,
    market: 'Ринок',
    limit: 'Ліміт',
    amount: 'Розмір позиції, USD',
    limitPrice: 'Лімітна ціна, USD',
    markAt: (price, time) => `Mark ${price} · ${time}`,
    sizeLine: (size, symbol) => `≈ ${size} ${symbol}`,
    available: (amount) => `Доступно ${amount}`,
    availableTitle: 'Доступно',
    availableHelp:
      'Застава, вільна для нових позицій на твоєму рахунку Phoenix. Вибране плече задає, скільки її працює в ордері; «Перевірка» покаже цифри самого Phoenix до підпису.',
    canary: (amount) => `Перша перевірка — ордер до ${amount}.`,
    tpsl: 'TP/SL',
    tpField: 'Тейк-профіт, USD',
    slField: 'Стоп-лос, USD',
    legsLine: 'На всю позицію, за mark-ціною. Порожньо — без нього.',
    limitLegs: 'Лімітний ордер чекає в стакані: TP/SL став на позицію, щойно він виконається.',
    stopSlip: (share) => `Стоп виконується ринковим ордером — до ${share} від ціни спрацювання.`,
    review: (side) => (side === 'long' ? 'Перевірити лонг' : 'Перевірити шорт'),
    preparing: 'Готую…',
    cross: 'Крос',
    crossHelp: 'Крос-маржа: кожна позиція стоїть на всьому твоєму рахунку Phoenix.',
    leverage: 'Плече',
    leverageTitle: (symbol) => `Плече · ${symbol}-PERP`,
    leverageHelp: (max) =>
      `Скільки вільної застави працює в ордері. До ${max}× на цьому ринку; більша позиція отримує плече наступного рівня.`,
    leverageDone: 'Готово',
    size: 'Розмір',
    sizeUnder: (size, symbol, usd) => `≈ ${size} ${symbol} · ${usd}`,
    max: 'Макс',
    reduceOnly: 'Лише зменшення',
    legResult: (usd, percent) => `${usd} · ${percent}`,
    liquidation: 'Ліквідація',
    liquidationNever: 'немає',
    inReview: 'у «Перевірці»',
    liquidationHelp: '≈ за ризик-параметрами Phoenix. Точну покаже «Перевірка» до підпису.',
    orderValue: 'Вартість ордера',
    bookFill: 'Виконання за стаканом',
    margin: 'Маржа',
    marginHelp:
      '≈ скільки застави Phoenix тримає під цей ордер — за плечем його рівня. Вибране плече задає розмір ордера.',
    accountLeverage: 'Плече рахунку',
    feesLabel: 'Комісії',
    feesAmount: (amount) => `≈ ${amount} USDC`,
    feesRates: (phoenix, ryntra) => `${phoenix} + ${ryntra}`,
    feesMarketHelp: (phoenix, ryntra) =>
      `Phoenix ${phoenix} і Ryntra ${ryntra} від вартості ордера — з тієї самої застави.`,
    feesLimitHelp: (maker, taker, ryntra) =>
      `Phoenix ${maker}, поки ордер у стакані, ${taker} з частини, що виконається одразу; Ryntra ${ryntra} лише з цієї частини.`,
    deposit: 'Поповнити',
    reviewReduce: 'Перевірити зменшення',
    sizeHint: 'Введи розмір або обери частку.',
    sizeOnlyHint: 'Введи розмір.',
    priceHint: 'Введи лімітну ціну.',
    perpBlocks: {
      SIZE: 'Введи розмір числом.',
      PRICE: 'Введи ціну числом.',
      MINIMUM: 'Ордер — щонайменше на долар і один лот.',
      LOT: 'Менше за один лот цього ринку.',
      CEILING: 'Більше за межу першої перевірки для нової позиції.',
      MARGIN: 'Застави не вистачає на такий розмір разом із комісіями. Зменш розмір або поповни заставу.',
      OVER_MAX: 'Більше, ніж дозволяє застава з цим плечем.',
      TP: 'Введи тейк-профіт числом.',
      SL: 'Введи стоп-лос числом.',
      TP_SIDE: 'Тейк-профіт не з того боку ціни.',
      SL_SIDE: 'Стоп-лос не з того боку ціни.',
      REDUCE_LIMIT: 'Лише зменшення тут — ринковим ордером.',
      REDUCE_SIDE: 'Зменшення — проти позиції: зміни сторону.',
      REDUCE_NONE: 'Позиції на цьому ринку немає.',
      REDUCE_OVER: 'Більше, ніж є в позиції.',
      thin: 'Стакан зараз не заповнить такий розмір.',
    },
    viewOnly: 'Лише перегляд',
    viewOnlyLine: 'Ордери з Ryntra для цього гаманця ще не відкриті — лише перегляд.',
    noAccount: 'У цього гаманця немає рахунку Phoenix. Рахунки Phoenix — за запрошенням.',
    gated: 'Phoenix зараз не приймає ордерів на цьому ринку.',
    isolated: 'Цей ринок — лише з ізольованою маржею; Ryntra відкриває позиції з крос-маржею.',
    manage: 'Керувати',
    positionTitle: (side, size, symbol) => `${side === 'long' ? 'Лонг' : 'Шорт'} ${size} ${symbol}-PERP`,
    cut: 'Зменшити',
    close: 'Закрити',
    cancelOrder: 'Скасувати ордер',
    isolatedHere: 'Ізольована маржа — керується на phoenix.trade',
    cutTitle: (side, symbol) => `Зменшити ${UK_SIDE[side]} ${symbol}-PERP`,
    cutShare: (size, symbol) => `Скільки з ${size} ${symbol}`,
    protectTitle: (side, symbol) => `TP/SL · ${UK_SIDE[side]} ${symbol}-PERP`,
    protectLine: 'На всю позицію, за mark-ціною. Порожньо — без нього; поточні буде знято.',
    nowLegs: (tp, sl) => `Зараз: TP ${tp} · SL ${sl}`,
    check: 'Перевірка',
    titles: {
      open: (side, size, symbol, type) => `${side === 'long' ? 'Лонг' : 'Шорт'} ${size} ${symbol}-PERP · ${type}`,
      reduce: (side, size, symbol) => `Зменшити ${UK_SIDE[side]} ${symbol}-PERP на ${size}`,
      close: (side, size, symbol) => `Закрити ${UK_SIDE[side]} ${size} ${symbol}-PERP`,
      protect: (side, symbol) => `TP/SL · ${UK_SIDE[side]} ${symbol}-PERP`,
      cancel: (symbol) => `Скасувати ордер на ${symbol}-PERP`,
    },
    pay: 'Вкладаєш',
    get: 'Отримаєш',
    payMargin: (amount) => `${amount} USDC застави як маржа`,
    payPosition: (side, size, symbol) => `${side === 'long' ? 'Лонг' : 'Шорт'} ${size} ${symbol}`,
    payNone: 'З гаманця нічого не рухається',
    getPosition: (side, size, symbol, usd) => `${side === 'long' ? 'Лонг' : 'Шорт'} ${size} ${symbol} ≈ ${usd} USD`,
    getCollateral: (amount) => `${amount} USDC у заставу`,
    getCollateralOut: (amount) => `${amount} USDC із застави`,
    getLegs: 'TP/SL на всю позицію',
    getLift: 'Позиція без TP/SL',
    getCancel: 'Ордер зникає зі стакана, його маржа звільняється',
    rows: {
      type: 'Тип',
      worst: 'Найгірша ціна',
      limit: 'Лімітна ціна',
      slippage: 'Допуск',
      order: 'Ордер',
      mark: 'Mark-ціна',
      positionAfter: 'Позиція після',
      leverageAfter: 'Плече після',
      liquidation: 'Ліквідація (mark)',
      collateralAfter: 'Застава після',
      freeAfter: 'Вільна застава після',
      funding: 'Фандинг, година',
      tp: 'Тейк-профіт',
      sl: 'Стоп-лос',
      legsLifted: 'Поточні TP/SL',
    },
    liquidationAway: (share) => `${share} від mark-ціни`,
    noLiquidation: 'немає — позиції після немає',
    liquidationNone: 'Phoenix не знайшов у межах',
    fundingLongs: (rate) => `${rate} · лонги платять шортам`,
    fundingShorts: (rate) => `${rate} · шорти платять лонгам`,
    legsLiftedValue: 'знімаються цією транзакцією',
    costs: 'Витрати',
    costPhoenix: 'Phoenix',
    costRyntra: 'Ryntra',
    costNetwork: 'Мережа',
    costRent: 'Депозит TP/SL',
    rentNote:
      'Депозит TP/SL відкриває рахунок Phoenix, що тримає твої TP/SL. Це оренда в Solana, і вона лишається твоєю.',
    costTaker: (amount, rate) => `${amount} USDC · ${rate}`,
    costLimit: (maker, taker) => `${maker} у стакані, ${taker}, якщо виконається одразу`,
    costBuilderLimit: (rate) => `${rate} лише з частини, що виконається одразу`,
    costNone: 'немає',
    costsTotal: (usdc, sol) => (usdc ? `≈ ${usdc} USDC + ${sol}` : sol),
    whatIs: 'Що це',
    what: {
      openMarket: (price) =>
        `Ринковий ордер на Phoenix: виконується одразу весь — не гірше за ${price} — або ніяк. Позицію забезпечує твоя застава; тримає її програма Phoenix, не Ryntra.`,
      openLimit: (price) =>
        `Лімітний ордер стоїть у стакані Phoenix за ${price}, доки не виконається чи ти його не скасуєш; його маржа тим часом зайнята.`,
      reduce: (price) => `Ринковий ордер лише на зменшення: він може тільки зменшити позицію — не гірше за ${price}.`,
      close: (price) => `Закриває всю позицію ринковим ордером лише на зменшення — не гірше за ${price}.`,
      protect: 'Тейк-профіт і стоп-лос тримає Phoenix і спрацьовує за mark-ціною.',
      cancel: 'Прибирає твій ордер зі стакана Phoenix.',
    },
    risk: 'Дійсно близько 30 секунд. Плече збільшує збитки: ліквідація може забрати заставу позиції.',
    valid: 'Дійсно близько 30 секунд.',
    details: 'Деталі',
    traderAccount: 'Рахунок Phoenix',
    program: 'Програма',
    wallet: 'Гаманець',
    confirm: 'Підтвердити в гаманці',
    rebuilt:
      '«Перевірку» зібрано наново — транзакція живе лише ~30 секунд. Нічого не надіслано; переглянь і підтверди.',
    receipt: {
      filled: 'Виконано на Phoenix',
      resting: 'Ордер у стакані Phoenix',
      reduced: 'Позицію зменшено',
      closed: 'Позицію закрито',
      protect: 'TP/SL встановлено',
      lift: 'TP/SL знято',
      cancel: 'Ордер скасовано',
      pending: 'Чекаю на мережу',
      failed: 'Не пройшло',
    },
    states: { done: 'Готово', pending: 'Чекаю', failed: 'Не пройшло' },
    fill: (side, size, symbol, price) => `${side === 'long' ? 'Лонг' : 'Шорт'} ${size} ${symbol} · ${price}`,
    fillPending: 'Phoenix ще не показав виконання',
    noFill: 'Нічого не виконано — ордер чекає',
    fees: (amount) => `Комісія Phoenix ${amount} USDC`,
    pnl: (amount) => `Результат ${amount} USDC`,
    held: (size, symbol) => `+${size} ${symbol} у позиції`,
    nothingMoved: 'Ордер не пройшов; комісію мережі списано.',
    notSent: 'Ордер не надіслано. Нічого не змінилося.',
    pendingLine: 'Мережа ще не відповіла. Ордер не надсилається вдруге — цей екран стежить за ним.',
    pendingStopped: 'Мережа не відповіла за дві хвилини. Ордер не надсилається вдруге — переглянь його в оглядачі.',
    network: 'Solana · Phoenix',
    explorer: 'Переглянути в оглядачі',
    again: 'Новий ордер',
    againWait: 'Новий ордер відкриється, щойно мережа відповість.',
    failures: {
      ORDERS_CLOSED: 'Ордери з Ryntra для цього гаманця ще не відкриті — лише перегляд.',
      CANARY_LIMIT: 'Перша перевірка — менший ордер.',
      BELOW_MINIMUM: 'Ордер — щонайменше на $1 номіналу.',
      LIMIT_FAR: 'Ліміт перетинає ціну більш ніж на 5 %. Обери ринковий ордер або ближчу ціну.',
      MARKET_GATED: 'Phoenix зараз не приймає ордерів на цьому ринку.',
      ISOLATED_ONLY: 'Цей ринок — лише з ізольованою маржею.',
      ACCOUNT_NEEDED: 'У цього гаманця ще немає рахунку Phoenix.',
      TRADING_CLOSED: 'Phoenix зараз не приймає такий ордер з цього рахунку.',
      TP_SIDE: 'Тейк-профіт не з того боку ціни.',
      SL_SIDE: 'Стоп-лос не з того боку ціни.',
      LEGS_SIDE: 'Цей ордер зменшує позицію: TP/SL став на саму позицію.',
      PRICE_UNKNOWN: 'Mark-ціна Phoenix не надійшла. Нічого не зібрано.',
      NOT_FILLABLE: 'Стакан зараз не виконає такий розмір у межах допуску. Нічого не підписано.',
      NO_POSITION: 'Позиції на цьому ринку зараз немає.',
      OVER_POSITION: 'Більше, ніж є в позиції.',
      NO_ORDER: 'Phoenix уже не тримає цей ордер.',
      NOTHING_TO_CHANGE: 'Немає TP/SL, які можна зняти, і нових не задано.',
      NEEDS_SOL: 'Гаманцю потрібно трохи SOL на комісію мережі.',
      MARGIN_SHORT:
        'Застави не вистачає на цей ордер разом із комісіями. Зменш розмір або поповни заставу. Нічого не підписано.',
      SIMULATION_FAILED: 'Phoenix зараз відмовить: маржа, стан ринку чи рахунку. Нічого не підписано.',
      BUILDER_UNAVAILABLE: 'Ордери зараз не збираються. Нічого не підписано.',
      PHOENIX_UNAVAILABLE: 'Phoenix не відповів. Нічого не зібрано.',
      RELAY_REFUSED: 'Мережа відмовила ще до надсилання. Нічого не змінилося.',
      TICKET_EXPIRED: 'Час «Перевірки» минув. Нічого не надіслано — онови «Перевірку».',
      WALLET_MISMATCH: 'Підключений гаманець змінився. Перевір ще раз.',
      RATE_LIMITED: 'Забагато запитів. Спробуй за хвилину.',
      signIn: 'Увійди гаманцем ще раз, щоб ставити ордери.',
      network: "Немає зв'язку. Нічого не надіслано.",
      walletRefused: 'Гаманець не підписав. Нічого не надіслано.',
      walletCancelled: 'Підтвердження в гаманці скасовано. Нічого не надіслано.',
      walletTimeout: 'Гаманець не відповів за 90 секунд. Нічого не надіслано — онови «Перевірку».',
      walletCannotSign:
        'Цей гаманець не підписує транзакції для застосунків — лише надсилає їх сам. Нічого не надіслано; скористайся Phantom, Solflare чи гаманцем Seeker.',
      ledgerBlind:
        'Ledger не підписав: у застосунку Solana на Ledger вимкнено «Blind signing». Увімкни його в налаштуваннях застосунку й спробуй знову.',
      txVersion: 'Цю транзакцію Ledger ще не вміє підписати, тож гаманець не відкрито. Нічого не надіслано.',
      reviewAged:
        '«Перевірку» зібрано наново — транзакція живе лише ~30 секунд. Нічого не надіслано; переглянь і підтверди.',
      deviceConfirm:
        'Транзакція живе ~30 секунд: підтверди в гаманці чи на Ledger за 20 секунд. Нічого не надіслано — онови «Перевірку».',
      general: 'Щось пішло не так. Нічого не змінилося.',
      outcomeUnknown:
        'Відповідь не повернулася, і ордер міг піти в мережу. Перевір позицію, перш ніж ставити його знову.',
    },
  },
}
