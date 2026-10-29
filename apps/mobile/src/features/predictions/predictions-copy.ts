/**
 * The words of «Торгівля → Прогнози» (M12) in both languages — the web's Predictions words (`app/app/predictions/
 * words.ts` on the Predictions line) said the phone's way: «ти», neutral to gender, one name for one thing. AGG,
 * Portal, USDC and Solana are names, never translated. No venue is named on a screen: the venues are counted.
 */

import type { Copy } from '../../lib/i18n.ts'
import type { OrderState, WithdrawalPhase, WithdrawReason } from './account-model.ts'
import type { PredictionRange, PredictionSort, PredictionStatus } from './predictions-model.ts'

export type PredictionsCopy = Readonly<{
  /** The head's line: the simulation, then when the list was read. */
  simulation: string
  /** The chip on an event's page. */
  simulationChip: string
  readAt: (time: string) => string
  helpTitle: string
  help: readonly string[]
  sorts: Readonly<Record<PredictionSort, string>>
  sortsA11y: string
  all: string
  categoriesA11y: string
  yes: string
  /** The market's chance, as a screen reader says it beside the figure. */
  chanceA11y: (chance: string, label: string) => string
  closes: (day: string) => string
  closesIn: (left: string) => string
  venues: (count: number) => string
  volume: string
  status: Readonly<Record<PredictionStatus, string>>
  loading: string
  noConnection: string
  needsNetwork: string
  down: string
  downLine: string
  tryAgain: string
  noEvents: string
  loadingMore: string
  /* the event */
  notFound: string
  backToPredictions: string
  markets: string
  everyMarket: (count: number) => string
  ends: string
  resolves: string
  venuesLabel: string
  chance: string
  /** The Review's chance of the outcome bought, whichever it is. */
  chanceOf: (label: string) => string
  chart: string
  chartLine: string
  chartNone: string
  /** Under the chart: marked when the venue has not priced it for a while. */
  stale: string
  ranges: Readonly<Record<PredictionRange, string>>
  rules: string
  rulesTitle: string
  rulesNone: string
  buy: (label: string) => string
  closedLine: string
  /* the ticket */
  ticketTitle: string
  amount: string
  amountHint: (min: string, max: string) => string
  ifWins: (label: string, payout: string) => string
  ifLoses: (stake: string) => string
  review: string
  reviewing: string
  reviewTitle: string
  shares: string
  total: string
  fees: string
  payout: string
  profit: string
  maxLoss: string
  holder: string
  holderPaper: string
  place: string
  placing: string
  placedTitle: Readonly<Record<OrderState, string>>
  placedLine: Readonly<Record<OrderState, string>>
  done: string
  quoteExpired: string
  cannotPlace: string
  /** A venue on the route warns: thin liquidity, or anything else — never the venue's name or its code. */
  routeThin: string
  routeRegion: string
  routeAccount: string
  routeOther: string
  /* the account */
  account: string
  connectLine: string
  signInLine: string
  linkLine: string
  link: string
  linking: string
  linkHelp: readonly string[]
  linkUnavailable: string
  linkBusy: string
  linkDeclined: string
  linkFailed: string
  linkExpired: string
  balance: string
  inPositions: string
  result: string
  positions: string
  noPositions: string
  everyPosition: (count: number) => string
  fewerPositions: string
  orders: string
  orderStates: Readonly<Record<OrderState, string>>
  won: string
  lost: string
  locationBlocked: string
  providerDown: string
  /* the money */
  money: string
  moneyOff: string
  moneyLine: string
  custodyTitle: string
  custody: readonly string[]
  available: string
  depositAddress: string
  depositOnly: string
  depositPreparing: string
  depositUnsupported: string
  depositFailed: string
  copy: string
  copied: string
  sendFromWallet: string
  deposits: string
  depositStates: Readonly<Record<'pending' | 'credited' | 'unknown', string>>
  withdraw: string
  withdrawTo: string
  withdrawAmount: string
  withdrawAll: string
  withdrawLimits: (min: string, crossMin: string, fee: string) => string
  withdrawPreview: string
  withdrawPricing: string
  withdrawTitle: string
  withdrawSum: string
  withdrawFee: string
  withdrawReceive: string
  withdrawFloor: (floor: string) => string
  withdrawReprice: string
  withdrawRepriced: string
  withdrawConfirm: string
  withdrawSending: string
  withdrawOpen: string
  withdrawCheckBelow: string
  withdrawClosed: string
  withdrawBadAmount: string
  validUntil: (time: string) => string
  reasons: Readonly<Record<Exclude<WithdrawReason, 'below_minimum'>, string>>
  belowMinimum: (min: string, crossMin: string) => string
  atMost: (amount: string) => string
  withdrawals: string
  phases: Readonly<Record<WithdrawalPhase, string>>
  unknownText: string
  /** Unknown while live money is off: the server does not ask again until it is on. */
  unknownOffText: string
  mismatchText: string
  agedText: string
  failedText: string
  refusedText: string
  check: string
  failed: string
}>

export const PREDICTIONS_COPY: Copy<PredictionsCopy> = {
  en: {
    simulation: 'Simulation — no real funds',
    simulationChip: 'Simulation',
    readAt: (time) => `Read ${time}`,
    helpTitle: 'Predictions',
    help: [
      'Markets on outcomes: the price of «Yes» is the market’s chance that it happens.',
      'Orders here are a simulation for now: no real money moves.',
      'AGG prices each order across the venues that list the market and holds the account’s balance.',
    ],
    sorts: { volume24h: 'Trending', ending: 'Ending soon', newest: 'New' },
    sortsA11y: 'Order of events',
    all: 'All',
    categoriesA11y: 'Categories',
    yes: 'Yes',
    chanceA11y: (chance, label) => `${label} ${chance}, the market’s chance`,
    closes: (day) => `Closes ${day}`,
    closesIn: (left) => `Closes in ${left}`,
    venues: (count) => (count === 1 ? 'on 1 venue' : `on ${count} venues`),
    volume: 'Volume',
    status: { open: 'Open', closed: 'Trading closed', resolved: 'Resolved', unknown: 'State unknown' },
    loading: 'Loading predictions',
    noConnection: 'No connection',
    needsNetwork: 'Predictions need the network.',
    down: 'Predictions did not load',
    downLine: 'The provider did not answer.',
    tryAgain: 'Try again',
    noEvents: 'No open events here now.',
    loadingMore: 'Loading more',
    notFound: 'No such event',
    backToPredictions: 'Back to Predictions',
    markets: 'Markets',
    everyMarket: (count) => `All markets · ${count}`,
    ends: 'Ends',
    resolves: 'Result by',
    venuesLabel: 'Venues',
    chance: 'Chance of «Yes»',
    chanceOf: (label) => `Chance of «${label}»`,
    chart: 'Chance over time',
    chartLine: 'The chart did not load.',
    chartNone: 'No price history yet.',
    stale: 'not updated for a while',
    ranges: { '1w': '1W', '3m': '3M' },
    rules: 'How it resolves',
    rulesTitle: 'How it resolves',
    rulesNone: 'The venue states no rules for this market.',
    buy: (label) => `Buy ${label}`,
    closedLine: 'Trading is closed on this market.',
    ticketTitle: 'Simulated order',
    amount: 'Amount, $',
    amountHint: (min, max) => `From ${min} to ${max}`,
    ifWins: (label, payout) => `If «${label}»: you get ≈ ${payout}`,
    ifLoses: (stake) => `Otherwise you lose ${stake} — the whole amount`,
    review: 'Review',
    reviewing: 'Pricing…',
    reviewTitle: 'Review',
    shares: 'Shares',
    total: 'Total with fees',
    fees: 'Fees',
    payout: 'If right',
    profit: 'Profit if right',
    maxLoss: 'Most you can lose',
    holder: 'Who holds the money',
    holderPaper: 'AGG · managed wallet (Portal); simulated now',
    place: 'Place simulated order',
    placing: 'Placing…',
    placedTitle: {
      reviewed: 'Not placed',
      submitted: 'On its way',
      filled: 'Filled',
      partially_filled: 'Partly filled',
      failed: 'Not filled',
      expired: 'Expired',
      cancelled: 'Cancelled',
    },
    placedLine: {
      reviewed: 'The order was not placed.',
      submitted: 'AGG is still filling it; the account shows where it stands.',
      filled: 'The simulated position is in your account.',
      partially_filled: 'Part of it was filled; the account shows what.',
      failed: 'Nothing was filled.',
      expired: 'The price expired before it was filled.',
      cancelled: 'The order was cancelled.',
    },
    done: 'Done',
    quoteExpired: 'The price expired. Review again.',
    cannotPlace: 'This order cannot be placed as reviewed.',
    routeThin: 'Little liquidity on one of the venues: the price may move as it fills.',
    routeRegion: 'One of the venues is not open where you are.',
    routeAccount: 'One of the venues needs an account of its own.',
    routeOther: 'One of the venues warns about this order.',
    account: 'Simulated account',
    connectLine: 'Connect a wallet to place simulated orders.',
    signInLine: 'Sign in with your wallet to see your simulated account.',
    linkLine: 'Open the simulated account: your wallet signs one message, no transaction.',
    link: 'Open simulated account',
    linking: 'Opening…',
    linkHelp: [
      'Your wallet signs a sign-in message — never a transaction.',
      'AGG keeps the simulated account; Ryntra keeps its session on the server.',
    ],
    linkUnavailable: 'Simulated accounts cannot be opened right now.',
    linkBusy: 'AGG is busy right now. Try again in a minute.',
    linkDeclined: 'The wallet did not sign.',
    linkFailed: 'The account did not open. Try again.',
    linkExpired: 'The account’s session ended — open it again.',
    balance: 'Balance',
    inPositions: 'In positions',
    result: 'Result so far',
    positions: 'Positions',
    noPositions: 'No positions yet.',
    everyPosition: (count) => `All positions · ${count}`,
    fewerPositions: 'Fewer',
    orders: 'Orders',
    orderStates: {
      reviewed: 'Reviewed',
      submitted: 'On its way',
      filled: 'Filled',
      partially_filled: 'Partly filled',
      failed: 'Not filled',
      expired: 'Expired',
      cancelled: 'Cancelled',
    },
    won: 'Won',
    lost: 'Lost',
    locationBlocked: 'AGG says trading is not available where you are.',
    providerDown: 'AGG did not answer: balance and positions are not known now.',
    money: 'Money',
    moneyOff: 'Simulation only for now: deposits and withdrawals open once real funds are switched on.',
    moneyLine: 'USDC on Solana',
    custodyTitle: 'Who holds the money',
    custody: [
      'AGG holds the balance in a managed wallet (Portal), not in your wallet.',
      'AGG signs every trade and withdrawal. A withdrawal goes only to your Solana wallet.',
    ],
    available: 'available',
    depositAddress: 'Deposit address on Solana',
    depositOnly: 'Send only USDC on Solana here. Other tokens and networks are not credited.',
    depositPreparing: 'Preparing your address…',
    depositUnsupported: 'Deposits on Solana are not available for this account now.',
    depositFailed: 'The address did not load.',
    copy: 'Copy',
    copied: 'Copied',
    sendFromWallet: 'Send from wallet',
    deposits: 'Deposits',
    depositStates: { pending: 'Confirming', credited: 'Credited', unknown: 'State unknown' },
    withdraw: 'Withdraw',
    withdrawTo: 'To your Solana wallet',
    withdrawAmount: 'Amount, USDC',
    withdrawAll: 'All',
    withdrawLimits: (min, crossMin, fee) =>
      `From ${min}. A balance AGG holds outside Solana: from ${crossMin}, ≈ ${fee} to bring it`,
    withdrawPreview: 'Review withdrawal',
    withdrawPricing: 'Pricing…',
    withdrawTitle: 'Withdrawal',
    withdrawSum: 'Amount',
    withdrawFee: 'Fee',
    withdrawReceive: 'Arrives, about',
    withdrawFloor: (floor) => `Sent only if at least ${floor} arrives; otherwise a new review.`,
    withdrawReprice: 'AGG prices it again as it sends; the amount that arrives may differ a little.',
    withdrawRepriced: 'The price changed since the review. Check the new figures.',
    withdrawConfirm: 'Confirm withdrawal',
    withdrawSending: 'Sending…',
    withdrawOpen: 'An earlier withdrawal is still being checked. Wait for it first.',
    withdrawCheckBelow: 'Look at “Withdrawals” below first, then try again.',
    withdrawClosed: 'New withdrawals are closed for now — see “Withdrawals” below.',
    withdrawBadAmount: 'Type an amount in dollars, up to six decimals.',
    validUntil: (time) => `Valid until ${time}`,
    reasons: {
      insufficient: 'Not enough on the balance.',
      above_max: 'More than can be delivered now.',
      fee_exceeds: 'The fee is larger than the amount.',
      route_unavailable: 'No route right now; try again shortly.',
      other: 'AGG cannot send this withdrawal right now.',
    },
    belowMinimum: (min, crossMin) =>
      `Below the minimum: from ${min}, or from ${crossMin} for a balance outside Solana.`,
    atMost: (amount) => `At most ${amount}.`,
    withdrawals: 'Withdrawals',
    phases: {
      sending: 'Sending…',
      in_flight: 'On its way',
      completed: 'Delivered',
      partial: 'Partly delivered',
      failed: 'Not delivered',
      unknown: 'State unknown',
      refused: 'Not sent',
    },
    unknownText: 'AGG has not confirmed this withdrawal yet. Do not send again — the same request is being checked.',
    unknownOffText:
      'AGG has not confirmed this withdrawal yet. Real funds are switched off now: it is checked once they are on. Do not send again.',
    mismatchText:
      'AGG names another address for this withdrawal than your Solana wallet. Write to support before withdrawing again.',
    agedText:
      'Unknown for over 6 hours: it is no longer checked on its own. Look at your AGG account or write to support. New withdrawals are open.',
    failedText: 'AGG says nothing was delivered.',
    refusedText: 'Not sent: nothing left the balance.',
    check: 'Check again',
    failed: 'Did not go through. Try again.',
  },
  uk: {
    simulation: 'Симуляція — без справжніх коштів',
    simulationChip: 'Симуляція',
    readAt: (time) => `Прочитано о ${time}`,
    helpTitle: 'Прогнози',
    help: [
      'Ринки на події: ціна «Так» — це імовірність, яку дає ринок.',
      'Ордери тут поки в симуляції: справжні гроші не рухаються.',
      'AGG рахує кожен ордер на всіх майданчиках, де є ринок, і тримає баланс рахунку.',
    ],
    sorts: { volume24h: 'У тренді', ending: 'Скоро завершуються', newest: 'Нові' },
    sortsA11y: 'Порядок подій',
    all: 'Усі',
    categoriesA11y: 'Категорії',
    yes: 'Так',
    chanceA11y: (chance, label) => `${label} ${chance}, імовірність за ціною ринку`,
    closes: (day) => `Закриття ${day}`,
    closesIn: (left) => `Закриття через ${left}`,
    venues: (count) => `майданчиків: ${count}`,
    volume: 'Обсяг',
    status: { open: 'Відкрито', closed: 'Торги закрито', resolved: 'Вирішено', unknown: 'Стан невідомий' },
    loading: 'Завантажуємо прогнози',
    noConnection: 'Немає зв’язку',
    needsNetwork: 'Прогнозам потрібен інтернет.',
    down: 'Прогнози не завантажилися',
    downLine: 'Провайдер не відповів.',
    tryAgain: 'Спробувати ще',
    noEvents: 'Тут зараз немає відкритих подій.',
    loadingMore: 'Завантажуємо ще',
    notFound: 'Такої події немає',
    backToPredictions: 'До Прогнозів',
    markets: 'Ринки',
    everyMarket: (count) => `Усі ринки · ${count}`,
    ends: 'Завершується',
    resolves: 'Результат до',
    venuesLabel: 'Майданчики',
    chance: 'Імовірність «Так»',
    chanceOf: (label) => `Імовірність «${label}»`,
    chart: 'Імовірність у часі',
    chartLine: 'Графік не завантажився.',
    chartNone: 'Історії цін ще немає.',
    stale: 'давно не оновлювалась',
    ranges: { '1w': '1Т', '3m': '3М' },
    rules: 'Як вирішується',
    rulesTitle: 'Як вирішується',
    rulesNone: 'Майданчик не вказує правил для цього ринку.',
    buy: (label) => `Купити «${label}»`,
    closedLine: 'Торги на цьому ринку закрито.',
    ticketTitle: 'Ордер у симуляції',
    amount: 'Сума, $',
    amountHint: (min, max) => `Від ${min} до ${max}`,
    ifWins: (label, payout) => `Якщо «${label}»: отримаєш ≈ ${payout}`,
    ifLoses: (stake) => `Інакше втратиш ${stake} — усю суму`,
    review: 'Переглянути',
    reviewing: 'Рахуємо…',
    reviewTitle: 'Перевірка',
    shares: 'Частки',
    total: 'Разом зі зборами',
    fees: 'Збори',
    payout: 'Якщо вгадаєш',
    profit: 'Прибуток, якщо вгадаєш',
    maxLoss: 'Найбільша можлива втрата',
    holder: 'Хто тримає гроші',
    holderPaper: 'AGG · керований гаманець (Portal); зараз симуляція',
    place: 'Розмістити ордер у симуляції',
    placing: 'Розміщуємо…',
    placedTitle: {
      reviewed: 'Не розміщено',
      submitted: 'У дорозі',
      filled: 'Виконано',
      partially_filled: 'Виконано частково',
      failed: 'Не виконано',
      expired: 'Ціна минула',
      cancelled: 'Скасовано',
    },
    placedLine: {
      reviewed: 'Ордер не розміщено.',
      submitted: 'AGG ще виконує його; рахунок покаже, де він.',
      filled: 'Позиція симуляції — на твоєму рахунку.',
      partially_filled: 'Виконано частину; рахунок покаже яку.',
      failed: 'Нічого не виконано.',
      expired: 'Ціна минула раніше, ніж ордер виконали.',
      cancelled: 'Ордер скасовано.',
    },
    done: 'Готово',
    quoteExpired: 'Ціна минула. Переглянь ще раз.',
    cannotPlace: 'Цей ордер не можна розмістити так, як переглянуто.',
    routeThin: 'На одному з майданчиків мало ліквідності: ціна може зрушити, поки ордер виконується.',
    routeRegion: 'Один із майданчиків недоступний там, де ти.',
    routeAccount: 'Один із майданчиків потребує власного рахунку.',
    routeOther: 'Один із майданчиків попереджає про цей ордер.',
    account: 'Рахунок симуляції',
    connectLine: 'Під’єднай гаманець, щоб розміщувати ордери в симуляції.',
    signInLine: 'Увійди гаманцем, щоб побачити рахунок симуляції.',
    linkLine: 'Відкрий рахунок симуляції: гаманець підпише одне повідомлення, не транзакцію.',
    link: 'Відкрити рахунок симуляції',
    linking: 'Відкриваємо…',
    linkHelp: [
      'Гаманець підписує повідомлення для входу — ніколи не транзакцію.',
      'Рахунок симуляції тримає AGG; його сесію Ryntra зберігає на сервері.',
    ],
    linkUnavailable: 'Рахунки симуляції зараз не відкриваються.',
    linkBusy: 'AGG зараз перевантажений. Спробуй за хвилину.',
    linkDeclined: 'Гаманець не підписав.',
    linkFailed: 'Рахунок не відкрився. Спробуй ще раз.',
    linkExpired: 'Сесія рахунку завершилась — відкрий його знову.',
    balance: 'Баланс',
    inPositions: 'У позиціях',
    result: 'Результат поки',
    positions: 'Позиції',
    noPositions: 'Позицій ще немає.',
    everyPosition: (count) => `Усі позиції · ${count}`,
    fewerPositions: 'Менше',
    orders: 'Ордери',
    orderStates: {
      reviewed: 'Переглянуто',
      submitted: 'У дорозі',
      filled: 'Виконано',
      partially_filled: 'Частково',
      failed: 'Не виконано',
      expired: 'Ціна минула',
      cancelled: 'Скасовано',
    },
    won: 'Виграш',
    lost: 'Програш',
    locationBlocked: 'AGG повідомляє, що там, де ти, торгівля недоступна.',
    providerDown: 'AGG не відповів: баланс і позиції зараз невідомі.',
    money: 'Гроші',
    moneyOff: 'Поки лише симуляція: поповнення й виведення відкриються, коли ввімкнемо справжні кошти.',
    moneyLine: 'USDC у Solana',
    custodyTitle: 'Хто тримає гроші',
    custody: [
      'Баланс тримає AGG у керованому гаманці (Portal), а не твій гаманець.',
      'Кожну угоду й виведення підписує AGG. Виведення йде лише у твій гаманець Solana.',
    ],
    available: 'доступно',
    depositAddress: 'Адреса поповнення в Solana',
    depositOnly: 'Надсилай сюди лише USDC у мережі Solana. Інші токени й мережі не зараховуються.',
    depositPreparing: 'Готуємо твою адресу…',
    depositUnsupported: 'Поповнення в Solana зараз недоступне для цього рахунку.',
    depositFailed: 'Адреса не завантажилася.',
    copy: 'Копіювати',
    copied: 'Скопійовано',
    sendFromWallet: 'Надіслати з гаманця',
    deposits: 'Поповнення',
    depositStates: { pending: 'Підтверджується', credited: 'Зараховано', unknown: 'Стан невідомий' },
    withdraw: 'Вивести',
    withdrawTo: 'У твій гаманець Solana',
    withdrawAmount: 'Сума, USDC',
    withdrawAll: 'Усе',
    withdrawLimits: (min, crossMin, fee) =>
      `Від ${min}. Баланс, який AGG тримає поза Solana: від ${crossMin}, ≈ ${fee} за переказ`,
    withdrawPreview: 'Переглянути виведення',
    withdrawPricing: 'Рахуємо…',
    withdrawTitle: 'Виведення',
    withdrawSum: 'Сума',
    withdrawFee: 'Збір',
    withdrawReceive: 'Надійде, приблизно',
    withdrawFloor: (floor) => `Надсилаємо, лише якщо надійде щонайменше ${floor}; інакше — новий перегляд.`,
    withdrawReprice: 'AGG рахує ще раз під час відправлення; сума, що надійде, може трохи відрізнятися.',
    withdrawRepriced: 'Ціна змінилася після перегляду. Перевір нові цифри.',
    withdrawConfirm: 'Підтвердити виведення',
    withdrawSending: 'Надсилаємо…',
    withdrawOpen: 'Попереднє виведення ще перевіряється. Спершу дочекайся його.',
    withdrawCheckBelow: 'Спершу глянь «Виведення» нижче, тоді пробуй ще.',
    withdrawClosed: 'Нові виведення поки закрито — дивись «Виведення» нижче.',
    withdrawBadAmount: 'Введи суму в доларах, до шести знаків після коми.',
    validUntil: (time) => `Дійсне до ${time}`,
    reasons: {
      insufficient: 'Недостатньо на балансі.',
      above_max: 'Більше, ніж можна доставити зараз.',
      fee_exceeds: 'Збір більший за суму.',
      route_unavailable: 'Зараз немає маршруту; спробуй трохи згодом.',
      other: 'AGG зараз не може надіслати це виведення.',
    },
    belowMinimum: (min, crossMin) => `Менше за мінімум: від ${min}, або від ${crossMin} для балансу поза Solana.`,
    atMost: (amount) => `Найбільше ${amount}.`,
    withdrawals: 'Виведення',
    phases: {
      sending: 'Надсилаємо…',
      in_flight: 'У дорозі',
      completed: 'Доставлено',
      partial: 'Доставлено частково',
      failed: 'Не доставлено',
      unknown: 'Стан невідомий',
      refused: 'Не надіслано',
    },
    unknownText: 'AGG ще не підтвердив це виведення. Не надсилай ще раз — ми перевіряємо цей самий запит.',
    unknownOffText:
      'AGG ще не підтвердив це виведення. Справжні кошти зараз вимкнено: перевіримо, щойно ввімкнемо. Не надсилай ще раз.',
    mismatchText:
      'AGG називає для цього виведення іншу адресу, ніж твій гаманець Solana. Напиши в підтримку, перш ніж виводити знову.',
    agedText:
      'Стан невідомий понад 6 годин: самі ми його більше не перевіряємо. Переглянь свій рахунок в AGG або напиши в підтримку. Нові виведення відкриті.',
    failedText: 'AGG повідомляє: нічого не доставлено.',
    refusedText: 'Не надіслано: з балансу нічого не пішло.',
    check: 'Перевірити ще раз',
    failed: 'Не вийшло. Спробуй ще раз.',
  },
}
