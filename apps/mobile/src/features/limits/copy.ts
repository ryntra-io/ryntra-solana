import type { Copy } from '../../lib/i18n.ts'

import type { LimitFailureKey, LimitState, TicketBlock } from './limit-model.ts'

/**
 * Every word «Ліміт» and «Мої ордери» say on the phone — the web's own for the
 * same surfaces (`app/solana/workspace/i18n/catalog.ts`, the B3 block), so the
 * app says one thing; the phone's «Перевірка» stands where the web says
 * «Review», as everywhere on the phone (`trade/copy.ts`).
 */
export type LimitCopy = Readonly<{
  limit: string
  limitPrice: string
  market: string
  pricedIn: string
  fromMarket: (distance: string) => string
  /** The presets stand on the share's reference, not on a pool far from it (ST-5 r9): «−1 % від акції». */
  fromShare: (distance: string) => string
  /** A typed price far from the share's reference (ST-5 r9): «≈ 1 978 % вище за акцію». */
  shareFar: (pct: string, above: boolean) => string
  distanceLabel: string
  spend: string
  amount: string
  /** What the order can use of what it pays with — for SOL less the trade's reserve, never «Available» (ST-5). */
  canUse: (amount: string) => string
  youGet: string
  youReceive: string
  whereItWaits: string
  /** «Перевірка»'s row (NEW-LOOK §3, dictionary §8) and its touch to the other venue. */
  whereWaits: string
  changeVenue: (venue: string) => string
  /** Behind «?» beside «Де чекає ордер» (ST-4): what each place takes — never a line under an option. */
  venueTrigger: string
  venueDlmm: string
  checkingPools: string
  noPool: string
  review: string
  preparing: string
  block: Readonly<Record<Exclude<TicketBlock, null>, string>>
  /* «Перевірка» */
  reviewTitle: (side: 'buy' | 'sell', symbol: string, venue: string) => string
  youPay: string
  yourPrice: string
  fillsAt: string
  marketNow: string
  ryntraFee: string
  none: string
  makerShare: string
  network: string
  /** What opening a DLMM order costs — not promised back (its account and bins); its figure is the server's own. */
  rentDlmm: string
  rentTrigger: string
  ofWhatYouGet: string
  /** Behind «?» beside «Де чекає» (ST-4): where the amount waits, in plain words. */
  whatTrigger: string
  whatDlmm: string
  risk: string
  feeNotCharged: string
  sign: string
  signing: string
  back: string
  /* after the signature */
  placed: string
  sentWaiting: string
  waitsFor: (price: string) => string
  unknownTitle: string
  unknownLine: string
  newLimit: string
  /* «Мої ордери» */
  myOrders: string
  /** How many wait — drawn only when one does. */
  myOrdersLine: (open: number) => string
  noOrdersTitle: string
  /** Portfolio · Orders with none: one quiet line, as Assets and Payments (M44.6). */
  noOrdersLine: string
  /** Under Phoenix's orders in «Портфель · Ордери»: the limits' own empty line (C4f). */
  noLimitsLine: string
  readFailed: string
  incomplete: string
  signInForOrders: string
  cancel: string
  takeBack: string
  receipt: string
  explorer: string
  cancelled: string
  takenBack: string
  notCancelled: string
  cancelSent: string
  placeFailed: string
  cancelFailed: string
  total: string
  buy: string
  sell: string
  states: Readonly<Record<LimitState, string>>
  failures: Readonly<Record<LimitFailureKey, string>>
}>

export const LIMIT_COPY: Copy<LimitCopy> = {
  en: {
    limit: 'Limit',
    limitPrice: 'Limit price',
    market: 'Market',
    pricedIn: 'Priced in',
    fromMarket: (distance) => `${distance} from the market`,
    fromShare: (distance) => `${distance} from the share`,
    shareFar: (pct, above) => `≈ ${pct} ${above ? 'above' : 'below'} the share`,
    distanceLabel: 'Distance from the market',
    spend: 'Spend',
    amount: 'Amount',
    canUse: (amount) => `Can use ${amount}`,
    youGet: 'You get',
    youReceive: 'You receive',
    whereItWaits: 'Where the order waits',
    whereWaits: 'Where it waits',
    changeVenue: (venue) => `Wait on ${venue} instead`,
    venueTrigger: 'Jupiter takes any pair; the Ryntra fee depends on the pair.',
    venueDlmm: 'Meteora takes no fee, and the order earns pool fees while it waits.',
    checkingPools: 'Checking pools…',
    noPool: 'No pool of this pair takes limits',
    review: 'Review',
    preparing: 'Preparing…',
    block: {
      price: 'Set the price.',
      amount: 'Enter an amount.',
      crosses: 'This price is already the market: use a market order.',
      balance: 'More than the wallet holds.',
    },
    reviewTitle: (side, symbol, venue) => `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol} at a limit on ${venue}`,
    youPay: 'You pay',
    yourPrice: 'Your price',
    fillsAt: 'Fills at',
    marketNow: 'Market now',
    ryntraFee: 'Ryntra',
    none: 'none',
    makerShare: 'While it waits, the order earns half of the pool’s fees at its price.',
    network: 'Network',
    rentDlmm: 'Order setup',
    rentTrigger: 'Deposit, returned on close',
    ofWhatYouGet: 'of what you get',
    whatTrigger:
      'Your amount waits on Jupiter until the market reaches your price; then it is swapped into your wallet. Cancel any time.',
    whatDlmm:
      'Your amount waits in a Meteora pool at your price; when the market crosses it, the pool converts it. Take it back any time.',
    risk: 'A limit fills only if the market reaches its price.',
    feeNotCharged: 'not charged on this order',
    sign: 'Sign in your wallet',
    signing: 'Waiting for your wallet…',
    back: 'Back',
    placed: 'Limit order placed',
    sentWaiting: 'Sent — waiting for the network',
    waitsFor: (price) => `Waits for ${price}`,
    unknownTitle: 'Signed — the answer did not come back',
    unknownLine: 'Nothing is sent again.',
    newLimit: 'New limit order',
    myOrders: 'Orders',
    myOrdersLine: (open) => `${open} waiting`,
    noOrdersTitle: 'No limit orders yet',
    noOrdersLine: 'No orders',
    noLimitsLine: 'No limit orders',
    readFailed: 'Your orders could not be read right now.',
    incomplete: 'The list may be incomplete.',
    signInForOrders: 'Sign in your wallet to see your orders.',
    cancel: 'Cancel',
    takeBack: 'Take back',
    receipt: 'Receipt',
    explorer: 'Transaction',
    cancelled: 'Cancelled. The amount is back in your wallet.',
    takenBack: 'Taken back into your wallet.',
    notCancelled: 'The order was not cancelled.',
    cancelSent: 'Cancellation sent — waiting for the network.',
    placeFailed: 'The network refused the order — it does not stand.',
    cancelFailed: 'The cancellation did not go through — the order still waits.',
    total: 'Fees in all',
    buy: 'Buy',
    sell: 'Sell',
    states: {
      PLACING: 'Placing',
      OPEN: 'Waiting',
      PARTIAL: 'Part filled',
      FILLED: 'Filled',
      CANCELLING: 'Cancelling',
      CANCELLED: 'Cancelled',
      EXPIRED: 'Expired',
      FAILED: 'Did not happen',
    },
    failures: {
      walletRefused: 'The wallet did not sign. Nothing was sent.',
      walletTimeout: 'Your wallet did not answer within 90 seconds. Nothing was sent — refresh the Review.',
      walletCancelled: 'Wallet approval was cancelled. Nothing was sent.',
      walletSilent: 'Your wallet did not answer within 90 seconds. Nothing was sent.',
      reviewClosed: 'The Review closed while your wallet was open. That signature was not sent — refresh the Review.',
      walletCannotSign:
        "This wallet does not sign transactions for apps — it only sends them itself. Nothing was sent; use Phantom, Solflare or the Seeker's wallet.",
      bytesRebuilt:
        'The Review was built again — a transaction lives only about 30 seconds. Nothing was sent; check it and sign.',
      deviceConfirm:
        'A transaction lives about 30 seconds: confirm in the wallet, or on a Ledger, within 20 seconds. Nothing was sent — refresh the Review.',
      ledgerBlind:
        'The Ledger did not sign: “Blind signing” is off in its Solana app. Turn it on in the app’s settings and try again.',
      txVersion:
        'This transaction is in a format a Ledger cannot sign yet, so the wallet was not opened. Nothing was sent.',
      rateLimited: 'Too many requests. Try again in a moment.',
      paused: 'Trading is turned off right now.',
      belowMinimum: 'Jupiter takes limit orders from 5 USD.',
      crosses: 'This price is already the market: use a market order.',
      noPool: 'No pool of this pair takes limits',
      simulation: 'The network would refuse this order: check the balance and the SOL for fees.',
      notCancellable: 'This order is already closed or being closed.',
      network: 'No answer from Ryntra. Nothing was sent.',
      signIn: 'Your session ended. Sign in your wallet again.',
      notPlaced: 'The order was not placed. Nothing was sent.',
      notCancelled: 'The order was not cancelled. Nothing was sent.',
      general: 'The order could not be prepared. Nothing was sent.',
    },
  },
  uk: {
    limit: 'Ліміт',
    limitPrice: 'Ціна ліміту',
    market: 'Ринок',
    pricedIn: 'Ціна в',
    fromMarket: (distance) => `${distance} від ринку`,
    fromShare: (distance) => `${distance} від акції`,
    shareFar: (pct, above) => `≈ ${pct} ${above ? 'вище' : 'нижче'} за акцію`,
    distanceLabel: 'Відступ від ринку',
    spend: 'Витратити',
    amount: 'Сума',
    canUse: (amount) => `Можна використати ${amount}`,
    youGet: 'Отримаєш',
    youReceive: 'Отримаєш',
    whereItWaits: 'Де чекає ордер',
    whereWaits: 'Де чекає',
    changeVenue: (venue) => `Натомість чекати на ${venue}`,
    venueTrigger: 'Jupiter приймає будь-яку пару; комісія Ryntra залежить від пари.',
    venueDlmm: 'Meteora не бере комісії, а ордер, поки чекає, заробляє комісії пулу.',
    checkingPools: 'Перевіряємо пули…',
    noPool: 'Немає пулу цієї пари з лімітами',
    review: 'Перевірка',
    preparing: 'Готуємо…',
    block: {
      price: 'Вкажи ціну.',
      amount: 'Введи суму.',
      crosses: 'Ця ціна вже є ринковою: став ринковий ордер.',
      balance: 'Більше, ніж є в гаманці.',
    },
    reviewTitle: (side, symbol, venue) => `${side === 'buy' ? 'Купити' : 'Продати'} ${symbol} за лімітом на ${venue}`,
    youPay: 'Платиш',
    yourPrice: 'Твоя ціна',
    fillsAt: 'Спрацює за',
    marketNow: 'Ринок зараз',
    ryntraFee: 'Ryntra',
    none: 'немає',
    makerShare: 'Поки чекає, ордер отримує половину комісій пулу за своєю ціною.',
    network: 'Мережа',
    rentDlmm: 'Відкриття ордера',
    rentTrigger: 'Застава, повернеться після закриття',
    ofWhatYouGet: 'від отриманого',
    whatTrigger:
      'Сума чекає на Jupiter, доки ринок не дійде до твоєї ціни; тоді її обміняють у твій гаманець. Скасувати можна будь-коли.',
    whatDlmm:
      'Сума чекає в пулі Meteora за твоєю ціною; коли ринок її перетне, пул обміняє суму. Забрати можна будь-коли.',
    risk: 'Ліміт спрацює, лише якщо ринок дійде до його ціни.',
    feeNotCharged: 'на цьому ордері не береться',
    sign: 'Підписати в гаманці',
    signing: 'Чекаємо на твій гаманець…',
    back: 'Назад',
    placed: 'Ліміт виставлено',
    sentWaiting: 'Надіслано — чекаємо мережу',
    waitsFor: (price) => `Чекає ціну ${price}`,
    unknownTitle: 'Підписано — відповідь не прийшла',
    unknownLine: 'Повторно нічого не надсилається.',
    newLimit: 'Новий ліміт',
    myOrders: 'Ордери',
    myOrdersLine: (open) => `Чекає: ${open}`,
    noOrdersTitle: 'Лімітних ордерів ще немає',
    noOrdersLine: 'Ордерів немає',
    noLimitsLine: 'Лімітних ордерів немає',
    readFailed: 'Зараз не вдалося прочитати твої ордери.',
    incomplete: 'Список може бути неповним.',
    signInForOrders: 'Увійди гаманцем, щоб бачити свої ордери.',
    cancel: 'Скасувати',
    takeBack: 'Забрати',
    receipt: 'Квитанція',
    explorer: 'Транзакція',
    cancelled: 'Скасовано. Сума повернулась у гаманець.',
    takenBack: 'Повернуто у твій гаманець.',
    notCancelled: 'Ордер не скасовано.',
    cancelSent: 'Скасування надіслано — чекаємо мережу.',
    placeFailed: 'Мережа відхилила ордер — він не стоїть.',
    cancelFailed: 'Скасування не пройшло — ордер чекає далі.',
    total: 'Разом комісій',
    buy: 'Купити',
    sell: 'Продати',
    states: {
      PLACING: 'Виставляється',
      OPEN: 'Чекає',
      PARTIAL: 'Частково виконано',
      FILLED: 'Виконано',
      CANCELLING: 'Скасовується',
      CANCELLED: 'Скасовано',
      EXPIRED: 'Прострочено',
      FAILED: 'Не відбулося',
    },
    failures: {
      walletRefused: 'Гаманець не підписав. Нічого не надіслано.',
      walletTimeout: 'Гаманець не відповів за 90 секунд. Нічого не надіслано — онови «Перевірку».',
      walletCancelled: 'Підтвердження в гаманці скасовано. Нічого не надіслано.',
      walletSilent: 'Гаманець не відповів за 90 секунд. Нічого не надіслано.',
      reviewClosed: '«Перевірка» закрилася, поки гаманець був відкритий. Той підпис не надіслано — онови «Перевірку».',
      walletCannotSign:
        'Цей гаманець не підписує транзакції для застосунків — лише надсилає їх сам. Нічого не надіслано; скористайся Phantom, Solflare чи гаманцем Seeker.',
      bytesRebuilt:
        '«Перевірку» зібрано наново — транзакція живе лише ~30 секунд. Нічого не надіслано; переглянь і підпиши.',
      deviceConfirm:
        'Транзакція живе ~30 секунд: підтверди в гаманці чи на Ledger за 20 секунд. Нічого не надіслано — онови «Перевірку».',
      ledgerBlind:
        'Ledger не підписав: у застосунку Solana на Ledger вимкнено «Blind signing». Увімкни його в налаштуваннях застосунку й спробуй знову.',
      txVersion: 'Цю транзакцію Ledger ще не вміє підписати, тож гаманець не відкрито. Нічого не надіслано.',
      rateLimited: 'Забагато запитів. Спробуй за мить.',
      paused: 'Торгівлю зараз вимкнено.',
      belowMinimum: 'Jupiter приймає ліміти від 5 USD.',
      crosses: 'Ця ціна вже є ринковою: став ринковий ордер.',
      noPool: 'Немає пулу цієї пари з лімітами',
      simulation: 'Мережа відхилила б цей ордер: перевір баланс і SOL на комісії.',
      notCancellable: 'Цей ордер уже закрито або закривається.',
      network: 'Ryntra не відповіла. Нічого не надіслано.',
      signIn: 'Сесія закінчилась. Увійди гаманцем ще раз.',
      notPlaced: 'Ордер не виставлено. Нічого не надіслано.',
      notCancelled: 'Ордер не скасовано. Нічого не надіслано.',
      general: 'Ордер не вдалося підготувати. Нічого не надіслано.',
    },
  },
}
