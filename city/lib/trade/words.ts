import { pl, words } from '../i18n/dict.ts';

/**
 * The trade's own words outside the screens (CITY-79): what the formatters, the amount field, the stops, «My orders»,
 * the engine's refusals and the trade's steps say. The screens' words are in `city/components/trade/words.ts`.
 */

/** The formatters' words: the route, a read's age, the «All» tile. */
export const FORMAT = words(
  {
    more: (first: string, n: number) => `${first} + ${n} more`,
    justNow: 'just now',
    secondsAgo: (s: number) => `${s}s ago`,
    minutesAgo: (m: number) => `${m} min ago`,
    atTime: (time: string) => `at ${time}`,
    all: 'All',
  },
  {
    more: (first: string, n: number) => `${first} + ще ${n}`,
    justNow: 'щойно',
    secondsAgo: (s: number) => `${s} с тому`,
    minutesAgo: (m: number) => `${m} хв тому`,
    atTime: (time: string) => `о ${time}`,
    all: 'Усе',
  },
);

/** What is wrong with a typed amount. */
export const AMOUNT = words(
  {
    comma: 'Type the amount with a point and no commas, like 1000 or 2.5.',
    wholeOnly: (symbol: string) => `${symbol} comes in whole numbers only.`,
    maxDigits: (symbol: string, n: number) => `${symbol} has at most ${n} digits after the point.`,
    zero: 'Type an amount above zero.',
    number: 'Type a number, like 2.5.',
    tooMuch: (have: string, symbol: string) => `You have ${have} ${symbol}. Type that or less.`,
    upToRest: (have: string, symbol: string) => `Up to ${have} ${symbol}: the rest pays the network.`,
  },
  {
    comma: 'Незрозуміло, де дробова частина. Введи, як-от 1000 чи 2,5.',
    wholeOnly: (symbol: string) => `${symbol} — лише цілими числами.`,
    maxDigits: (symbol: string, n: number) => `${symbol}: до ${n} ${pl(n, 'знака', 'знаків', 'знаків')} після коми.`,
    zero: 'Введи суму, більшу за нуль.',
    number: 'Введи число, як-от 2,5.',
    tooMuch: (have: string, symbol: string) => `У тебе ${have} ${symbol}. Введи стільки або менше.`,
    upToRest: (have: string, symbol: string) => `До ${have} ${symbol}: решта йде на комісію мережі.`,
  },
);

/** A stop: why it cannot be one, its condition and how long it is watched. */
export const STOPS = words(
  {
    typePrice: 'Type the stop price.',
    pickAmount: 'Pick an amount for the stop.',
    thereLower: 'The price is already there. Use Market or set it lower.',
    thereHigher: 'The price is already there. Use Market or set it higher.',
    sellIfFalls: 'Sell if the price falls to',
    buyIfRises: 'Buy if the price rises to',
    day1: '1 day',
    days7: '7 days',
    days30: '30 days',
    untilCancelled: 'Until cancelled',
  },
  {
    typePrice: 'Введи ціну стопу.',
    pickAmount: 'Обери суму для стопу.',
    thereLower: 'Ціна вже там. Обери «Ринковий» або постав нижче.',
    thereHigher: 'Ціна вже там. Обери «Ринковий» або постав вище.',
    sellIfFalls: 'Продати, якщо ціна впаде до',
    buyIfRises: 'Купити, якщо ціна зросте до',
    day1: '1 день',
    days7: '7 днів',
    days30: '30 днів',
    untilCancelled: 'Доки не скасуєш',
  },
);

/** «My orders»: an order's and a stop's state, and how long a stop lasts. */
export const ORDERS = words(
  {
    PLACING: 'Placing',
    OPEN: 'Open',
    PARTIAL: 'Part filled',
    FILLED: 'Filled',
    CANCELLING: 'Cancelling',
    CANCELLED: 'Cancelled',
    EXPIRED: 'Expired',
    FAILED: 'Failed',
    watching: 'Watching',
    reached: 'Reached',
    done: 'Done',
    cancelled: 'Cancelled',
    expired: 'Expired',
    untilCancelled: 'until cancelled',
    until: (date: string) => `until ${date}`,
  },
  {
    PLACING: 'Розміщуємо',
    OPEN: 'Відкритий',
    PARTIAL: 'Частково',
    FILLED: 'Виконано',
    CANCELLING: 'Скасовуємо',
    CANCELLED: 'Скасовано',
    EXPIRED: 'Минув',
    FAILED: 'Не вдалося',
    watching: 'Стежимо',
    reached: 'Спрацював',
    done: 'Готово',
    cancelled: 'Скасовано',
    expired: 'Минув',
    untilCancelled: 'доки не скасуєш',
    until: (date: string) => `до ${date}`,
  },
);

/** The engine's warnings over an order, in one line each. */
export const WARNINGS = words(
  {
    extraCare: 'This token needs extra care. Check it before you sign.',
    moveMore: 'The price may move more than 3% before it lands.',
    checkLeast: 'Check the least you get.',
    movesPrice: 'This size moves the price.',
    noValue: 'No dollar value for this swap right now.',
    checkSwap: 'Check this swap before you sign.',
  },
  {
    extraCare: 'Цей токен потребує уваги. Перевір його, перш ніж підписати.',
    moveMore: 'Ціна може зрушити більш ніж на 3%, поки угода пройде.',
    checkLeast: 'Перевір мінімум, який отримаєш.',
    movesPrice: 'Така сума зрушує ціну.',
    noValue: 'Зараз немає доларової оцінки цього обміну.',
    checkSwap: 'Перевір обмін, перш ніж підписати.',
  },
);

/** The steps of a market trade: what the card says when something did not go as asked. */
export const FLOW = words(
  {
    late: 'Your wallet answered after the price stopped holding. Nothing was sent. Check the new figures.',
    moved: 'The price moved. Nothing was sent. Check the new figures.',
    noSign: 'The wallet did not sign. Nothing was sent.',
    walletChanged: 'The wallet changed this transaction, so it was not sent.',
    checkFailed: 'The signed transaction did not pass its check, so it was not sent.',
    unreadableSignature: 'The wallet signature could not be read. Nothing was sent.',
    replaced: 'A newer order for this wallet replaced this one. Nothing was sent.',
    cantRead: 'Ryntra could not read the network just now. Do not send another; check again.',
    notKnown: 'The outcome is not known yet. Do not send another; check again.',
    seen: 'The network has seen this transaction, but its receipt is not ready. Check the explorer.',
    nothingSent: 'Nothing was sent under this signature. You can trade again.',
    neverSent: 'The transaction was never sent and its time has passed. Nothing moved.',
    neverReached: 'The transaction never reached the chain and its time has passed. Nothing moved.',
    cancelledInWallet: 'Cancelled in your wallet. Nothing was sent.',
    priceMoved: 'The price moved. Check the new figures.',
    noCardForSale: 'No card for this sale: Ryntra has no record of what these coins cost.',
    stillRecorded: 'Your trade is still being recorded. Try again in a minute.',
    walletNotConfirmed: 'Ryntra could not confirm this wallet. Try again.',
    cardsUnavailable: 'Cards are unavailable right now. Try again in a minute.',
  },
  {
    late: 'Гаманець відповів, коли ціна вже не трималась. Нічого не надіслано. Перевір нові цифри.',
    moved: 'Ціна змінилась. Нічого не надіслано. Перевір нові цифри.',
    noSign: 'Гаманець не підписав. Нічого не надіслано.',
    walletChanged: 'Гаманець змінив цю транзакцію, тож її не надіслано.',
    checkFailed: 'Підписана транзакція не пройшла перевірку, тож її не надіслано.',
    unreadableSignature: 'Не вдалося прочитати підпис гаманця. Нічого не надіслано.',
    replaced: 'Новіший ордер цього гаманця замінив цей. Нічого не надіслано.',
    cantRead: 'Ryntra не змогла прочитати мережу. Не надсилай ще раз — перевір знову.',
    notKnown: 'Результат ще невідомий. Не надсилай ще раз — перевір знову.',
    seen: 'Мережа бачила цю транзакцію, але квитанції ще немає. Перевір в експлорері.',
    nothingSent: 'Під цим підписом нічого не надіслано. Можеш торгувати знову.',
    neverSent: 'Транзакцію так і не надіслано, її час минув. Кошти не рухались.',
    neverReached: 'Транзакція не дійшла до мережі, її час минув. Кошти не рухались.',
    cancelledInWallet: 'Скасовано в гаманці. Нічого не надіслано.',
    priceMoved: 'Ціна змінилась. Перевір нові цифри.',
    noCardForSale: 'Картки для цього продажу немає: Ryntra не знає, скільки коштували ці монети.',
    stillRecorded: 'Угода ще записується. Спробуй за хвилину.',
    walletNotConfirmed: 'Ryntra не змогла підтвердити цей гаманець. Спробуй ще раз.',
    cardsUnavailable: 'Картки зараз недоступні. Спробуй за хвилину.',
  },
);

/**
 * Why the engine's exact order may not go to the wallet, by the check's code. English keeps the check's own sentence
 * (`lib/solana/swap-client-safety.ts`); these are the other languages' words for it.
 */
export const REVIEW_REASONS = words(
  {
    REVIEW_INVALIDATED: 'This Review was refused by a later check. Request fresh bytes.',
    PROOF_NOT_SIGNED: 'The exact review has no trusted issuer signature.',
    SIMULATION_NOT_CLEAR: 'The exact provider bytes did not pass simulation.',
    EFFECTS_NOT_VERIFIED: "The exact simulation did not prove the owner's complete allowed asset deltas.",
    ORDER_EXPIRED: 'The exact executable order is no longer fresh.',
    ORDER_TOO_SHORT: "Too little of this order's window is left to open a wallet and confirm inside it.",
    POLICY_BLOCKED: 'The swap policy blocks these bytes. No wallet may receive them.',
  },
  {
    REVIEW_INVALIDATED: 'Пізніша перевірка відхилила цей ордер. Збери його знову.',
    PROOF_NOT_SIGNED: 'Ордер не має довіреного підпису Ryntra.',
    SIMULATION_NOT_CLEAR: 'Ордер не пройшов симуляцію.',
    EFFECTS_NOT_VERIFIED: 'Симуляція не підтвердила, що саме зміниться в гаманці.',
    ORDER_EXPIRED: 'Ордер уже застарів.',
    ORDER_TOO_SHORT: 'Ордерові лишилось замало часу, щоб підтвердити його в гаманці.',
    POLICY_BLOCKED: 'Перевірка обміну заблокувала цей ордер. До гаманця він не піде.',
  },
);

/**
 * The swap engine's refusals, by the English sentence `lib/solana/swap-failure-copy.ts` writes for each code: the
 * English half is that sentence itself, the other half its words. A sentence not listed here stays as it is written.
 */
export const SWAP_COPY = words(
  {
    'Swapping is turned off right now.': 'Swapping is turned off right now.',
    'The issuer no longer offers this token for purchase.': 'The issuer no longer offers this token for purchase.',
    'This site is not set up to sign swaps right now.': 'This site is not set up to sign swaps right now.',
    'This swap was checked and not offered for signing.': 'This swap was checked and not offered for signing.',
    'The signed transaction failed its final check. Nothing was sent. Get a new quote.': 'The signed transaction failed its final check. Nothing was sent. Get a new quote.',
    'This route could not be confirmed. Nothing was sent. Get a new quote.': 'This route could not be confirmed. Nothing was sent. Get a new quote.',
    'The previous transaction can still reach the network. Wait for it to expire, then get a new quote.': 'The previous transaction can still reach the network. Wait for it to expire, then get a new quote.',
    'This swap did not simulate cleanly, so it was not offered for signing.': 'This swap did not simulate cleanly, so it was not offered for signing.',
    'This price did not check out, so it was not offered. Try again in a moment.': 'This price did not check out, so it was not offered. Try again in a moment.',
    'Both sides are the same asset. Change one of them.': 'Both sides are the same asset. Change one of them.',
    'The provider priced this and would not build it — usually the wallet does not cover the amount plus its fee.': 'The provider priced this and would not build it — usually the wallet does not cover the amount plus its fee.',
    'The swap provider could not be reached just now. Nothing was sent.': 'The swap provider could not be reached just now. Nothing was sent.',
    'The swap provider refused this request. Nothing was sent.': 'The swap provider refused this request. Nothing was sent.',
    'One of these tokens could not be checked, so no swap was offered for it.': 'One of these tokens could not be checked, so no swap was offered for it.',
    "This swap did not pass Ryntra's own checks, so it was not offered.": "This swap did not pass Ryntra's own checks, so it was not offered.",
    'This order is outside the plan, so it was not offered. Change the amount, or the plan.': 'This order is outside the plan, so it was not offered. Change the amount, or the plan.',
    'The plan changed since this Review. Nothing was sent — review again on the current version.': 'The plan changed since this Review. Nothing was sent — review again on the current version.',
    'The plan is no longer active, so nothing was sent under it.': 'The plan is no longer active, so nothing was sent under it.',
    'No such plan for this wallet.': 'No such plan for this wallet.',
    'Confirm your wallet to trade under the plan.': 'Confirm your wallet to trade under the plan.',
    'The confirmed wallet is not the one placing this order.': 'The confirmed wallet is not the one placing this order.',
    'The plan could not record the Review. Nothing was sent — try again.': 'The plan could not record the Review. Nothing was sent — try again.',
    'The transaction that came back was not the one that was reviewed, so it was not sent.': 'The transaction that came back was not the one that was reviewed, so it was not sent.',
    'That took too long and was stopped. Nothing was sent — try again.': 'That took too long and was stopped. Nothing was sent — try again.',
    'Ryntra could not be reached. Nothing was sent.': 'Ryntra could not be reached. Nothing was sent.',
    'No route for this pair right now.': 'No route for this pair right now.',
    'This wallet does not hold enough for this swap.': 'This wallet does not hold enough for this swap.',
    'This amount cannot be swapped.': 'This amount cannot be swapped.',
    'The quote expired. Get a new quote.': 'The quote expired. Get a new quote.',
    'Wallet approval was cancelled.': 'Wallet approval was cancelled.',
    'Too many requests just now. Try again in a moment.': 'Too many requests just now. Try again in a moment.',
    'Checking the previous swap. Try again in a moment.': 'Checking the previous swap. Try again in a moment.',
    'This request was not accepted.': 'This request was not accepted.',
    'Swap could not continue. Try again.': 'Swap could not continue. Try again.',
  },
  {
    'Swapping is turned off right now.': 'Обмін зараз вимкнено.',
    'The issuer no longer offers this token for purchase.': 'Емітент більше не продає цей токен.',
    'This site is not set up to sign swaps right now.': 'Сайт зараз не готовий підписувати обміни.',
    'This swap was checked and not offered for signing.': 'Цей обмін перевірили й не дали на підпис.',
    'The signed transaction failed its final check. Nothing was sent. Get a new quote.': 'Підписана транзакція не пройшла останню перевірку. Нічого не надіслано. Онови ціну.',
    'This route could not be confirmed. Nothing was sent. Get a new quote.': 'Маршрут не вдалося підтвердити. Нічого не надіслано. Онови ціну.',
    'The previous transaction can still reach the network. Wait for it to expire, then get a new quote.': 'Попередня транзакція ще може дійти до мережі. Дочекайся, доки її час мине, і онови ціну.',
    'This swap did not simulate cleanly, so it was not offered for signing.': 'Обмін не пройшов симуляцію, тож його не дали на підпис.',
    'This price did not check out, so it was not offered. Try again in a moment.': 'Ціна не пройшла перевірку, тож її не запропоновано. Спробуй за мить.',
    'Both sides are the same asset. Change one of them.': 'Обидві сторони — та сама монета. Зміни одну з них.',
    'The provider priced this and would not build it — usually the wallet does not cover the amount plus its fee.': 'Провайдер дав ціну, але не зібрав обмін — зазвичай гаманцю бракує на суму з комісією.',
    'The swap provider could not be reached just now. Nothing was sent.': 'Провайдер обміну зараз недоступний. Нічого не надіслано.',
    'The swap provider refused this request. Nothing was sent.': 'Провайдер обміну відхилив запит. Нічого не надіслано.',
    'One of these tokens could not be checked, so no swap was offered for it.': 'Один із токенів не вдалося перевірити, тож обмін не запропоновано.',
    "This swap did not pass Ryntra's own checks, so it was not offered.": 'Обмін не пройшов перевірок Ryntra, тож його не запропоновано.',
    'This order is outside the plan, so it was not offered. Change the amount, or the plan.': 'Ордер виходить за план, тож його не запропоновано. Зміни суму чи план.',
    'The plan changed since this Review. Nothing was sent — review again on the current version.': 'План змінився після перегляду. Нічого не надіслано — переглянь ще раз за чинним планом.',
    'The plan is no longer active, so nothing was sent under it.': 'План більше не діє, тож за ним нічого не надіслано.',
    'No such plan for this wallet.': 'Для цього гаманця такого плану немає.',
    'Confirm your wallet to trade under the plan.': 'Підтверди гаманець, щоб торгувати за планом.',
    'The confirmed wallet is not the one placing this order.': 'Підтверджений гаманець — не той, що розміщує ордер.',
    'The plan could not record the Review. Nothing was sent — try again.': 'План не зміг записати перегляд. Нічого не надіслано — спробуй ще раз.',
    'The transaction that came back was not the one that was reviewed, so it was not sent.': 'Повернулась не та транзакція, яку переглянули, тож її не надіслано.',
    'That took too long and was stopped. Nothing was sent — try again.': 'Це тривало задовго, тож зупинилось. Нічого не надіслано — спробуй ще раз.',
    'Ryntra could not be reached. Nothing was sent.': 'Ryntra недоступна. Нічого не надіслано.',
    'No route for this pair right now.': 'Зараз немає маршруту для цієї пари.',
    'This wallet does not hold enough for this swap.': 'У гаманці не вистачає на цей обмін.',
    'This amount cannot be swapped.': 'Цю суму не можна обміняти.',
    'The quote expired. Get a new quote.': 'Ціна застаріла. Онови її.',
    'Wallet approval was cancelled.': 'Підтвердження в гаманці скасовано.',
    'Too many requests just now. Try again in a moment.': 'Забагато запитів. Спробуй за мить.',
    'Checking the previous swap. Try again in a moment.': 'Перевіряємо попередній обмін. Спробуй за мить.',
    'This request was not accepted.': 'Запит не прийнято.',
    'Swap could not continue. Try again.': 'Обмін не вдався. Спробуй ще раз.',
  },
);

/** The limits engine's refusals, by its code. */
export const LIMIT_CODES = words(
  {
    RATE_LIMITED: 'Too many requests. Try again in a moment.',
    SWAP_PAUSED: 'Trading is turned off right now.',
    BELOW_MINIMUM: (usd: number) => `Limit orders start at ${usd} USD.`,
    INVALID_TERMS: 'The amount or the price is not a positive number.',
    SAME_TOKEN: 'A pair needs two different coins.',
    MINT_UNREADABLE: 'This coin could not be read from the chain. Try again.',
    SIMULATION_FAILED: 'The network would refuse this order. Check your balance and SOL for fees.',
    TRIGGER_BUSY: 'Jupiter is busy right now. Try again in a moment.',
    TRIGGER_REFUSED: 'Jupiter would not take this order.',
    NOT_CANCELLABLE: 'This order is already closed or being closed.',
    ALREADY_SUBMITTED: 'This order was already sent.',
    WALLET_MISMATCH: 'This order belongs to another wallet.',
    TIMEOUT: 'The server did not answer in time. Nothing was sent.',
    NETWORK: 'No answer from Ryntra. Nothing was sent.',
  },
  {
    RATE_LIMITED: 'Забагато запитів. Спробуй за мить.',
    SWAP_PAUSED: 'Торгівлю зараз вимкнено.',
    BELOW_MINIMUM: (usd: number) => `Лімітні ордери — від ${usd} USD.`,
    INVALID_TERMS: 'Сума чи ціна — не додатне число.',
    SAME_TOKEN: 'Для пари потрібні дві різні монети.',
    MINT_UNREADABLE: 'Не вдалося прочитати цю монету з мережі. Спробуй ще раз.',
    SIMULATION_FAILED: 'Мережа відхилила б цей ордер. Перевір баланс і SOL на комісії.',
    TRIGGER_BUSY: 'Jupiter зараз зайнятий. Спробуй за мить.',
    TRIGGER_REFUSED: 'Jupiter не прийняв цей ордер.',
    NOT_CANCELLABLE: 'Цей ордер уже закрито або закривається.',
    ALREADY_SUBMITTED: 'Цей ордер уже надіслано.',
    WALLET_MISMATCH: 'Цей ордер належить іншому гаманцю.',
    TIMEOUT: 'Сервер не відповів вчасно. Нічого не надіслано.',
    NETWORK: 'Ryntra не відповідає. Нічого не надіслано.',
  },
);

/** A limit order's steps: placing and taking it back. */
export const LIMITS = words(
  {
    buildFailed: 'The order could not be built right now. Nothing was sent.',
    unreadable: 'The order came back unreadable. Nothing was sent.',
    late: 'Signed too late. Nothing was sent. Sign again.',
    moved: 'The order changed. Nothing was sent. Check the new figures.',
    unclear: 'Not confirmed yet. Do not place it again.',
    noSign: 'The wallet did not sign. Nothing was sent.',
    keptNotSigned: 'Not signed. The order stays open.',
    keptLate: 'Signed too late. The order stays open.',
    cancelFailed: 'Cancel failed. The order stays open.',
    cancelUnclear: 'Cancellation not confirmed yet.',
    notSigned: 'Not signed. Nothing was sent.',
    orderCancelled: 'Order cancelled',
    cancelSent: 'Cancellation sent',
    stopReached: (price: string, unit: string) => `Stop reached at ${price} ${unit}`,
  },
  {
    buildFailed: 'Ордер зараз не вдалося зібрати. Нічого не надіслано.',
    unreadable: 'Ордер повернувся нечитабельним. Нічого не надіслано.',
    late: 'Підписано запізно. Нічого не надіслано. Підпиши ще раз.',
    moved: 'Ордер змінився. Нічого не надіслано. Перевір нові цифри.',
    unclear: 'Ще не підтверджено. Не розміщуй його вдруге.',
    noSign: 'Гаманець не підписав. Нічого не надіслано.',
    keptNotSigned: 'Не підписано. Ордер лишається відкритим.',
    keptLate: 'Підписано запізно. Ордер лишається відкритим.',
    cancelFailed: 'Скасувати не вдалося. Ордер лишається відкритим.',
    cancelUnclear: 'Скасування ще не підтверджено.',
    notSigned: 'Не підписано. Нічого не надіслано.',
    orderCancelled: 'Ордер скасовано',
    cancelSent: 'Скасування надіслано',
    stopReached: (price: string, unit: string) => `Стоп спрацював на ${price} ${unit}`,
  },
);

/** The engine's line, the wallet, the wallet's proof and the history read. */
export const LINE = words(
  {
    serverLate: 'The server did not answer in time.',
    notComplete: 'The request did not complete.',
    notWhole: 'The answer did not arrive whole.',
    failed: 'The request failed.',
    walletSaidNo: 'The wallet said no. Nothing was shared.',
    tooManyAttempts: 'Too many attempts. Wait a minute.',
    signInUnavailable: 'Sign-in is unavailable right now.',
    nothingSigned: 'Nothing was signed.',
    walletNoSign: 'The wallet did not sign.',
    walletChanged: 'The wallet changed. Try again.',
    otherAccount: 'This wallet belongs to another Ryntra account.',
    notVerified: 'That signature could not be verified.',
    notCompleted: 'The request could not be completed.',
    historyUnavailable: 'Your trade history is unavailable right now.',
  },
  {
    serverLate: 'Сервер не відповів вчасно.',
    notComplete: 'Запит не завершився.',
    notWhole: 'Відповідь прийшла не повністю.',
    failed: 'Запит не вдався.',
    walletSaidNo: 'Гаманець відмовив. Нічого не передано.',
    tooManyAttempts: 'Забагато спроб. Зачекай хвилину.',
    signInUnavailable: 'Вхід зараз недоступний.',
    nothingSigned: 'Нічого не підписано.',
    walletNoSign: 'Гаманець не підписав.',
    walletChanged: 'Гаманець змінився. Спробуй ще раз.',
    otherAccount: 'Цей гаманець належить іншому акаунту Ryntra.',
    notVerified: 'Цей підпис не вдалося перевірити.',
    notCompleted: 'Запит не вдалося завершити.',
    historyUnavailable: 'Історія угод зараз недоступна.',
  },
);

/** The amount's share chips: a quarter, a half, three quarters and all of what can be spent. */
export const SIZE = words(
  {
    share: (percent: number) => `${percent}%`,
    max: 'MAX',
  },
  {
    share: (percent: number) => `${percent}%`,
    max: 'МАКС',
  },
);

/** A price the card could not get, in one calm line chosen by the engine's code. */
export const QUOTE = words(
  {
    unavailable: 'Prices are unavailable right now.',
    notOffered: 'This coin is not offered here.',
    notTradable: 'This coin cannot be traded here.',
    sameCoin: 'Pick two different coins.',
    badAmount: 'This amount cannot be traded.',
    noRoute: 'No price for this pair right now.',
    busy: 'Busy for a moment. Try again.',
    noPrice: 'No price just now. Try again.',
  },
  {
    unavailable: 'Ціни зараз недоступні.',
    notOffered: 'Цієї монети тут немає.',
    notTradable: 'Цією монетою тут торгувати не можна.',
    sameCoin: 'Обери дві різні монети.',
    badAmount: 'Цю суму не можна обміняти.',
    noRoute: 'Для цієї пари зараз немає ціни.',
    busy: 'Трохи зайнято. Спробуй ще раз.',
    noPrice: 'Ціни поки немає. Спробуй ще раз.',
  },
);

/** The issuer's powers on the tower window (CITY-78): the tags, at most two words each, and «Details». */
export const ISSUER = words(
  { fixedSupply: 'Fixed supply', canMint: 'Can mint', noFreeze: 'No freeze', canFreeze: 'Can freeze', nobody: 'Nobody', notRead: 'Not read' },
  { fixedSupply: 'Фіксована емісія', canMint: 'Є емісія', noFreeze: 'Без заморозки', canFreeze: 'Є заморозка', nobody: 'Ніхто', notRead: 'Не прочитано' },
);

/** The Sell tab's one line when there is nothing to sell (CITY-78). */
export const SELL_LINE = words(
  {
    connect: (coin: string) => `Connect a wallet to sell ${coin}.`,
    reading: 'Reading your wallet…',
    none: (coin: string) => `No ${coin} in this wallet.`,
  },
  {
    connect: (coin: string) => `Підключи гаманець, щоб продати ${coin}.`,
    reading: 'Читаю гаманець…',
    none: (coin: string) => `У цьому гаманці немає ${coin}.`,
  },
);
