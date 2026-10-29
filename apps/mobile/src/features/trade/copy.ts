import type { Copy } from '../../lib/i18n.ts'

import type { ReviewWarningKey, TradeFailureKey, TradeMode } from './trade-model.ts'

/**
 * Every word Trade says — the ticket, the asset picker, «Перевірка» and its
 * rows, the wallet's signature, the receipt, the recovery of a signature and
 * every refusal — in both languages (M22). The words are the web's own for the
 * same surface (its Spot order ticket and swap card, `app/solana/workspace`),
 * and the phone's own where the phone already says the same thing on a
 * purchase (`buy-copy.ts`: «Перевірка», «Під’єднати гаманець», «Увійти
 * гаманцем»), so the app says one thing; the Ukrainian speaks «ти» and keeps no
 * English word — the web's «Review» is «Перевірка» here, its «slippage» is
 * «допустимий рух ціни».
 */
export type TradeCopy = Readonly<{
  title: string
  modes: Readonly<Record<TradeMode, string>>
  /** What a signature was for, on the recovery card: «Купівля · 10 USDC → NVDAx». */
  modeNouns: Readonly<Record<TradeMode, string>>
  /* the header's line */
  seconds: (count: number) => string
  expired: string
  pricing: string
  /* the one action */
  connect: string
  signIn: string
  tradeAgain: string
  checkTx: string
  release: string
  review: string
  needSol: string
  assetBlocked: string
  /** A swap leg's mark for a token that takes a stock's ticker or name — the list's own word (ST-5 r7). */
  notTheStock: string
  /* the recovery card */
  signedTx: string
  checking: string
  unresolved: string
  attemptUnknown: string
  earlierUnresolved: string
  /* the ticket */
  youPay: string
  available: (amount: string) => string
  /** The quick shares' group, said to a screen reader. */
  shares: string
  amountIn: (symbol: string) => string
  amount: string
  asset: string
  changeAsset: (symbol: string) => string
  flip: string
  youReceive: string
  tryAgain: string
  /* «Перевірка» as a sheet */
  reviewTitle: string
  waitingWallet: string
  cancel: string
  /* the Review's rows */
  rows: Readonly<{
    receive: string
    receiveEstimate: string
    minimum: string
    price: string
    impact: string
    slippage: string
    networkFee: string
    reserve: string
    serviceFee: string
    jupiterFee: string
  }>
  none: string
  /** A swap's two dollar figures apart by more than 1 %, said quietly under the rate (ST-5 r9): «Втрата на ціні ≈ 6%». */
  priceLoss: (pct: string) => string
  warnings: Readonly<Record<ReviewWarningKey, string>>
  /* the receipt */
  bought: (symbol: string) => string
  sold: (symbol: string) => string
  swapped: (pay: string, receive: string) => string
  earlierTrade: string
  nothingHappened: string
  earlierNothing: string
  notFilled: string
  earlierNotFilled: string
  differs: string
  fromReview: string
  filledWithNote: string
  filledAbove: (difference: string, symbol: string) => string
  filledBelow: (difference: string, symbol: string) => string
  outcomeUnknown: string
  neverSent: (earlier: boolean) => string
  sentNotLanded: (earlier: boolean) => string
  notFilledByNetwork: (earlier: boolean) => string
  seenWithoutReceipt: string
  failures: Readonly<Record<TradeFailureKey, string>>
  /**
   * A price that could not be had (ST-5): nothing was being sent, so the line never says «Nothing was sent» — only
   * that the price is missing and what to do. Keys not named here say their `failures` line.
   */
  quoteFailures: Readonly<Partial<Record<TradeFailureKey, string>>>
}>

export const TRADE_COPY: Copy<TradeCopy> = {
  en: {
    title: 'Trade',
    modes: { buy: 'Buy', sell: 'Sell', swap: 'Swap' },
    modeNouns: { buy: 'Buy', sell: 'Sell', swap: 'Swap' },
    seconds: (count) => `${count} s`,
    expired: 'expired',
    pricing: 'Pricing…',
    connect: 'Connect wallet',
    signIn: 'Sign in with your wallet',
    tradeAgain: 'Trade again',
    checkTx: 'Check transaction',
    release: 'Release the open Review',
    review: 'Review',
    needSol: 'Add a little SOL for the network fee.',
    assetBlocked: 'This asset did not pass Ryntra’s checks, so no order is offered for it.',
    notTheStock: 'Not the stock',
    signedTx: 'Your operation',
    checking: 'Checking',
    unresolved: 'Unresolved',
    attemptUnknown: 'Its outcome is not known yet. Check it first — nothing is sent twice.',
    earlierUnresolved: 'An earlier operation is waiting for its answer. Check it first — nothing is sent twice.',
    youPay: 'You pay',
    available: (amount) => `Available ${amount} · MAX`,
    shares: 'A share of what you can spend',
    amountIn: (symbol) => `Amount in ${symbol}`,
    amount: 'Amount',
    asset: 'Asset',
    changeAsset: (symbol) => `${symbol}, change asset`,
    flip: 'Reverse: pay with what you receive',
    youReceive: 'You receive',
    tryAgain: 'Try again',
    reviewTitle: 'Review',
    waitingWallet: 'Waiting for your wallet…',
    cancel: 'Cancel',
    rows: {
      receive: 'You receive',
      receiveEstimate: 'You receive · estimate',
      minimum: 'Minimum received',
      price: 'Price',
      impact: 'Price impact',
      slippage: 'Max price move',
      networkFee: 'Network fee',
      reserve: 'Account reserve',
      serviceFee: 'Ryntra service fee',
      jupiterFee: 'Jupiter fee',
    },
    none: 'None',
    priceLoss: (pct) => `Price loss ≈ ${pct}`,
    warnings: {
      assetReview: 'This asset needs extra review.',
      slippageDiffers: 'The quote and the minimum received allow different price moves.',
      slippageWide: 'The price may move by more than 3%.',
      reviewCarefully: 'Review this swap carefully.',
      priceImpact: 'This swap may move the market price.',
      usdUnknown: 'USD value is unavailable.',
    },
    bought: (symbol) => `Bought ${symbol}`,
    sold: (symbol) => `Sold ${symbol}`,
    swapped: (pay, receive) => `Swapped ${pay} to ${receive}`,
    earlierTrade: 'Earlier trade',
    nothingHappened: 'Nothing happened',
    earlierNothing: 'Earlier attempt · nothing happened',
    notFilled: 'Not filled',
    earlierNotFilled: 'Earlier attempt · not filled',
    differs: 'The chain’s figures differ from the Review. The receipt keeps both.',
    fromReview: 'Figures from the Review; the receipt holds the chain’s.',
    filledWithNote: 'Filled, with a note: the chain’s figures differ from the quote.',
    filledAbove: (difference, symbol) => `Filled above the quote: +${difference} ${symbol}.`,
    filledBelow: (difference, symbol) => `Filled below the quote, above the minimum: −${difference} ${symbol}.`,
    outcomeUnknown: 'The outcome is not yet known. Keep checking this transaction; do not send another.',
    neverSent: (earlier) =>
      `${earlier ? 'A transaction signed earlier for this wallet' : 'This trade'} was never sent and cannot be. Nothing changed in the wallet.`,
    sentNotLanded: (earlier) =>
      `${earlier ? 'A transaction signed earlier for this wallet' : 'This trade'} was sent but never landed, and the window that could carry it has closed. Nothing changed in the wallet.`,
    notFilledByNetwork: (earlier) =>
      `${earlier ? 'A transaction signed earlier for this wallet' : 'This trade'} was not filled by the network.`,
    seenWithoutReceipt: 'The network has seen this transaction, but its receipt is unavailable. Check the explorer.',
    quoteFailures: {
      offline: 'Couldn’t get a price — check the connection.',
      tooLong: 'The price took too long. Try again.',
      providerDown: 'Couldn’t get a price from the swap provider just now.',
      providerRefused: 'The swap provider did not price this.',
    },
    failures: {
      paused: 'Swapping is turned off right now.',
      notOffered: 'The issuer no longer offers this token for purchase.',
      forbiddenOrigin: 'Signing from the app is not open yet.',
      notSetUp: 'Ryntra is not set up to sign swaps right now.',
      preSignRefused: 'This swap was checked and not offered for signing.',
      finalCheckFailed: 'The signed transaction failed its final check. Nothing was sent. Get a new quote.',
      routeUnconfirmed: 'This route could not be confirmed. Nothing was sent. Get a new quote.',
      previousStillValid:
        'The previous transaction can still reach the network. Wait for it to expire, then get a new quote.',
      simulation: 'This swap did not simulate cleanly, so it was not offered for signing.',
      implausible: 'This price did not check out, so it was not offered. Try again in a moment.',
      sameMint: 'Both sides are the same asset. Change one of them.',
      buildFailed:
        'The provider priced this and would not build it — usually the wallet does not cover the amount plus its fee.',
      providerDown: 'The swap provider could not be reached just now. Nothing was sent.',
      providerRefused: 'The swap provider refused this request. Nothing was sent.',
      unchecked: 'One of these tokens could not be checked, so no swap was offered for it.',
      notPassed: 'This swap did not pass Ryntra’s own checks, so it was not offered.',
      planBlocked: 'The plan refuses this order — the Strategy check names each rule.',
      planNotFound: 'No such plan for this wallet.',
      planChanged: 'The plan changed since you opened it. Open it again and decide anew.',
      planInactive: 'The plan is not active, so nothing trades under it.',
      planUnavailable: 'The plan could not be read just now. Nothing was sent — try again.',
      signIn: 'Sign in with your wallet to trade.',
      otherWallet: 'The signed-in wallet is not the one placing this order.',
      bytesChanged: 'The transaction that came back was not the one that was reviewed, so it was not sent.',
      tooLong: 'That took too long and was stopped. Nothing was sent — try again.',
      offline: 'Ryntra could not be reached. Nothing was sent.',
      noRoute: 'No route for this pair right now.',
      notEnough: 'This wallet does not hold enough for this swap.',
      amount: 'This amount cannot be swapped.',
      quoteExpired: 'The quote expired. Get a new quote.',
      walletCancelled: 'Wallet approval was cancelled. Nothing was sent.',
      rateLimited: 'Too many requests just now. Try again in a moment.',
      checkingPrevious: 'Checking the previous swap. Try again in a moment.',
      notAccepted: 'This request was not accepted.',
      failed: 'The trade could not continue. Try again.',
      walletTimeout: 'Your wallet did not answer within 90 seconds. Nothing was sent — refresh the Review.',
      ledgerBlind:
        'The Ledger did not sign: “Blind signing” is off in its Solana app. Turn it on in the app’s settings and try again.',
      txVersion:
        'This transaction is in a format a Ledger cannot sign yet, so the wallet was not opened. Nothing was sent.',
      signatureUnrecorded: 'The wallet signature could not be recorded. Nothing was submitted.',
      closedUnderWallet:
        'The Review window closed while your wallet was open. That signature was never sent and cannot be — ask for a fresh order and sign that one.',
      walletCannotSign:
        "This wallet does not sign transactions for apps — it only sends them itself. Nothing was sent; use Phantom, Solflare or the Seeker's wallet.",
      priceRenewed: 'The price was refreshed and a figure changed. Nothing was sent — check the numbers and confirm.',
      bytesRebuilt:
        'The Review was built again — a transaction lives only about 30 seconds. Nothing was sent; check it and sign.',
      deviceConfirm:
        'A transaction lives about 30 seconds: confirm in the wallet, or on a Ledger, within 20 seconds. Nothing was sent — refresh the Review.',
      reviewInvalidated: 'This Review was refused by a later check. Ask for a fresh one.',
      proofNotSigned: 'The exact Review has no trusted issuer signature.',
      simulationNotClear: 'The exact provider bytes did not pass simulation.',
      effectsNotVerified: 'The simulation did not prove what these bytes do to your wallet.',
      orderExpired: 'The exact order is no longer fresh.',
      orderTooShort: 'Too little of this order’s window is left to open a wallet and confirm.',
      policyIncomplete: 'The swap policy returned an incomplete verdict; no wallet may receive these bytes.',
    },
  },
  uk: {
    title: 'Торгувати',
    modes: { buy: 'Купити', sell: 'Продати', swap: 'Обмін' },
    modeNouns: { buy: 'Купівля', sell: 'Продаж', swap: 'Обмін' },
    seconds: (count) => `${count} с`,
    expired: 'минуло',
    pricing: 'Рахуємо ціну…',
    connect: 'Під’єднати гаманець',
    signIn: 'Увійти гаманцем',
    tradeAgain: 'Торгувати далі',
    checkTx: 'Перевірити транзакцію',
    release: 'Закрити відкриту Перевірку',
    review: 'Перевірка',
    needSol: 'Додай трохи SOL на комісію мережі.',
    assetBlocked: 'Цей актив не пройшов перевірки Ryntra, тож ордер для нього не пропонується.',
    notTheStock: 'Не акція',
    signedTx: 'Твоя операція',
    checking: 'Перевіряємо',
    unresolved: 'Не з’ясовано',
    attemptUnknown: 'Її результат ще невідомий. Спершу перевір — нічого не надсилається вдруге.',
    earlierUnresolved: 'Попередня операція ще чекає на відповідь. Спершу перевір її — нічого не надсилається вдруге.',
    youPay: 'Ти платиш',
    available: (amount) => `Доступно ${amount} · МАКС`,
    shares: 'Частка того, що можна витратити',
    amountIn: (symbol) => `Сума в ${symbol}`,
    amount: 'Сума',
    asset: 'Актив',
    changeAsset: (symbol) => `${symbol}, змінити актив`,
    flip: 'Поміняти місцями: платити тим, що отримуєш',
    youReceive: 'Ти отримуєш',
    tryAgain: 'Спробувати ще',
    reviewTitle: 'Перевірка',
    waitingWallet: 'Чекаємо на твій гаманець…',
    cancel: 'Скасувати',
    rows: {
      receive: 'Ти отримуєш',
      receiveEstimate: 'Ти отримуєш · оцінка',
      minimum: 'Мінімум отримання',
      price: 'Ціна',
      impact: 'Вплив на ціну',
      slippage: 'Допустимий рух ціни',
      networkFee: 'Комісія мережі',
      reserve: 'Резерв для рахунку',
      serviceFee: 'Комісія Ryntra',
      jupiterFee: 'Комісія Jupiter',
    },
    none: 'Немає',
    priceLoss: (pct) => `Втрата на ціні ≈ ${pct}`,
    warnings: {
      assetReview: 'Цей актив потребує додаткової перевірки.',
      slippageDiffers: 'Котирування й мінімум отримання допускають різний рух ціни.',
      slippageWide: 'Ціна може змінитися більш ніж на 3%.',
      reviewCarefully: 'Уважно перевір цей обмін.',
      priceImpact: 'Цей обмін може вплинути на ринкову ціну.',
      usdUnknown: 'Оцінка в доларах недоступна.',
    },
    bought: (symbol) => `Куплено ${symbol}`,
    sold: (symbol) => `Продано ${symbol}`,
    swapped: (pay, receive) => `Обміняно ${pay} на ${receive}`,
    earlierTrade: 'Попередня операція',
    nothingHappened: 'Нічого не сталося',
    earlierNothing: 'Попередня спроба · нічого не сталося',
    notFilled: 'Не виконано',
    earlierNotFilled: 'Попередня спроба · не виконано',
    differs: 'Цифри мережі відрізняються від Перевірки. Квитанція зберігає обидві.',
    fromReview: 'Цифри з Перевірки — квитанція зберігає цифри мережі.',
    filledWithNote: 'Виконано, з приміткою: цифри мережі відрізняються від котирування.',
    filledAbove: (difference, symbol) => `Виконано вище котирування: +${difference} ${symbol}.`,
    filledBelow: (difference, symbol) => `Виконано нижче котирування, але вище мінімуму: −${difference} ${symbol}.`,
    outcomeUnknown: 'Результат ще невідомий. Перевіряй цю транзакцію далі й не надсилай іншу.',
    neverSent: (earlier) =>
      earlier
        ? 'Транзакцію, підписану раніше для цього гаманця, не надіслано, і надіслати її вже не можна. У гаманці нічого не змінилося.'
        : 'Цю операцію не надіслано, і надіслати її вже не можна. У гаманці нічого не змінилося.',
    sentNotLanded: (earlier) =>
      earlier
        ? 'Транзакцію, підписану раніше для цього гаманця, надіслали, але вона не потрапила в мережу, а вікно, що могло її донести, закрилося. У гаманці нічого не змінилося.'
        : 'Цю операцію надіслали, але вона не потрапила в мережу, а вікно, що могло її донести, закрилося. У гаманці нічого не змінилося.',
    notFilledByNetwork: (earlier) =>
      earlier
        ? 'Мережа не виконала транзакцію, підписану раніше для цього гаманця.'
        : 'Мережа не виконала цю операцію.',
    seenWithoutReceipt: 'Мережа побачила транзакцію, але квитанція недоступна. Перевір її в експлорері.',
    quoteFailures: {
      offline: 'Не вдалося отримати ціну — перевір з’єднання.',
      tooLong: 'Ціну рахували задовго. Спробуй ще раз.',
      providerDown: 'Провайдер обміну зараз не дав ціни.',
      providerRefused: 'Провайдер обміну не порахував ціну для цього запиту.',
    },
    failures: {
      paused: 'Обмін зараз вимкнено.',
      notOffered: 'Емітент більше не пропонує цей токен для купівлі.',
      forbiddenOrigin: 'Підпис із застосунку ще не відкрито.',
      notSetUp: 'Ryntra зараз не налаштована підписувати обміни.',
      preSignRefused: 'Цей обмін перевірено й не запропоновано до підпису.',
      finalCheckFailed: 'Підписана транзакція не пройшла фінальну перевірку. Нічого не надіслано. Онови котирування.',
      routeUnconfirmed: 'Не вдалося підтвердити цей маршрут. Нічого не надіслано. Онови котирування.',
      previousStillValid:
        'Попередня транзакція ще може потрапити в мережу. Дочекайся, доки мине її строк, і онови котирування.',
      simulation: 'Цей обмін не пройшов симуляцію чисто, тож його не запропоновано до підпису.',
      implausible: 'Ця ціна не пройшла перевірку, тож її не запропоновано. Спробуй ще раз за мить.',
      sameMint: 'З обох боків той самий актив. Зміни один із них.',
      buildFailed:
        'Провайдер порахував ціну, але не зібрав транзакцію — зазвичай гаманцю бракує суми разом із комісією.',
      providerDown: 'Зараз не вдалося зв’язатися з провайдером обміну. Нічого не надіслано.',
      providerRefused: 'Провайдер обміну відхилив цей запит. Нічого не надіслано.',
      unchecked: 'Один із цих токенів не вдалося перевірити, тож обміну для нього не запропоновано.',
      notPassed: 'Цей обмін не пройшов власні перевірки Ryntra, тож його не запропоновано.',
      planBlocked: 'План відхиляє цей ордер — перевірка стратегії називає кожне правило.',
      planNotFound: 'Такого плану для цього гаманця немає.',
      planChanged: 'План уже змінився. Відкрий його знову й виріши наново.',
      planInactive: 'План не активний, тож за ним нічого не торгується.',
      planUnavailable: 'План зараз не вдалося прочитати. Нічого не надіслано — спробуй ще раз.',
      signIn: 'Увійди гаманцем, щоб торгувати.',
      otherWallet: 'Увійшов інший гаманець, ніж той, що робить цей ордер.',
      bytesChanged: 'Транзакція, що повернулася, — не та, що в Перевірці, тож її не надіслано.',
      tooLong: 'Це тривало задовго й зупинено. Нічого не надіслано — спробуй ще раз.',
      offline: 'Немає зв’язку з Ryntra. Нічого не надіслано.',
      noRoute: 'Для цієї пари зараз немає маршруту.',
      notEnough: 'У гаманці недостатньо для цього обміну.',
      amount: 'Цю суму обміняти не вийде.',
      quoteExpired: 'Котирування застаріло. Онови його.',
      walletCancelled: 'Підтвердження в гаманці скасовано. Нічого не надіслано.',
      rateLimited: 'Забагато запитів. Спробуй за мить.',
      checkingPrevious: 'Перевіряємо попередній обмін. Спробуй за мить.',
      notAccepted: 'Запит не прийнято.',
      failed: 'Операція не вдалася. Спробуй ще раз.',
      walletTimeout: 'Гаманець не відповів за 90 секунд. Нічого не надіслано — онови «Перевірку».',
      ledgerBlind:
        'Ledger не підписав: у застосунку Solana на Ledger вимкнено «Blind signing». Увімкни його в налаштуваннях застосунку й спробуй знову.',
      txVersion: 'Цю транзакцію Ledger ще не вміє підписати, тож гаманець не відкрито. Нічого не надіслано.',
      signatureUnrecorded: 'Підпис гаманця не вдалося зафіксувати. Нічого не надіслано.',
      closedUnderWallet:
        'Вікно Перевірки закрилося, поки гаманець був відкритий. Той підпис не надіслано, і надіслати його вже не можна — запроси новий ордер і підпиши його.',
      walletCannotSign:
        'Цей гаманець не підписує транзакції для застосунків — лише надсилає їх сам. Нічого не надіслано; скористайся Phantom, Solflare чи гаманцем Seeker.',
      priceRenewed: 'Ціну оновлено, і одна з цифр змінилась. Нічого не надіслано — переглянь і підтверди.',
      bytesRebuilt:
        'Перевірку зібрано наново — транзакція живе лише ~30 секунд. Нічого не надіслано; переглянь і підпиши.',
      deviceConfirm:
        'Транзакція живе ~30 секунд: підтверди в гаманці чи на Ledger за 20 секунд. Нічого не надіслано — онови «Перевірку».',
      reviewInvalidated: 'Ця Перевірка вже не дійсна — її відхилила пізніша звірка. Запроси нову.',
      proofNotSigned: 'У точної Перевірки немає довіреного підпису Ryntra.',
      simulationNotClear: 'Точна транзакція провайдера не пройшла симуляцію.',
      effectsNotVerified: 'Симуляція не довела, що ця транзакція робить із твоїм гаманцем.',
      orderExpired: 'Точний ордер уже застарів.',
      orderTooShort: 'У вікні цього ордера лишилося замало часу, щоб відкрити гаманець і підтвердити.',
      policyIncomplete: 'Політика обміну дала неповний висновок — таку транзакцію не можна віддавати гаманцю.',
    },
  },
}

/** A price's refusal as said on a ticket: its own line where one is written (no «Nothing was sent»), else the failure's. */
export function quoteFailureLine(words: TradeCopy, key: TradeFailureKey): string {
  return words.quoteFailures[key] ?? words.failures[key]
}
