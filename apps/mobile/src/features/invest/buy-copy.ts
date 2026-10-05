import type { Copy } from '../../lib/i18n.ts'

import type { BuyFailureKey } from './buy-model.ts'

/**
 * Every word a company's page and its purchase in dollars say on the
 * beginner's path (canon v5.1 §2, §4, §7, §8; M15), in both languages. The words are the web
 * line's own for the same page and the same sheet, so the phone and ryntra.io
 * say the same thing; the Ukrainian speaks «ти» and has no English word on the
 * way to a purchase (canon §1). The wallet signs with its own biometrics — the
 * app says «Підтверди в гаманці», never the vault's name. Nothing here offers
 * what does not work yet: no «Автоінвест», no «Купувати щотижня» before their
 * row, no loss limit on the phone.
 */
export type BuyCopy = Readonly<{
  /* the company page */
  exchangeOpen: string
  exchangeClosed: string
  notOffered: string
  halted: string
  /** A token of an issuer Ryntra no longer supports (canon v5.2 В26): no purchase, the way out said. */
  retired: string
  chartRange: string
  rangeLabel: Readonly<Record<'1d' | '1w' | '1m' | '1y', string>>
  rangeName: Readonly<Record<'1w' | '1m' | '1y', string>>
  rangeLabelA11y: Readonly<Record<'1d' | '1w' | '1m' | '1y', string>>
  since: (day: string) => string
  companyDown: string
  /* the amount */
  buyTitle: (company: string) => string
  amount: string
  /** The quick choices' group: shares of the paying dollars the wallet holds (canon v5.5 В35). */
  quickShares: (symbol: string) => string
  minimum: string
  /** No route for the sum typed: the company's own minimum is being read from the same quote. */
  findingMinimum: string
  /** «На $1 маршруту зараз немає. IREN — від $5.» — the least sum the company's live quote routes. */
  routeMinimum: (asked: string, company: string, minimum: string) => string
  /** «Поставити $5» — the one action that puts that minimum in. */
  setMinimum: (minimum: string) => string
  allCosts: string
  pricing: string
  quoteDown: string
  payWith: string
  buyFor: (sum: string) => string
  connect: string
  connectFailed: string
  signIn: string
  signInLine: string
  signInFailed: string
  signInOffline: string
  signInOutdated: string
  needSol: string
  notEnough: (symbol: string) => string
  unavailable: string
  refreshPrice: string
  preparing: string
  walletHas: (amount: string) => string
  topUp: string
  /* «Перевірка» */
  review: string
  rowSpend: string
  rowGet: string
  rowCosts: string
  rowWhat: string
  atLeast: string
  /** The token account's one-time reserve, a line of its own under «Усі витрати» — never among the costs (canon v5.5 В35). */
  reserve: (usd: string) => string
  /** Said before the four rows when that reserve is more than the purchase itself. */
  reserveFirst: (reserve: string, spend: string) => string
  /** The issuer's own fee inside «Усі витрати» — «з них комісія емітента 1% ≈ $0,10» (canon §12). */
  issuerFee: (pct: string, usd: string | null) => string
  /** Ryntra's own fee inside «Усі витрати», beside the issuer's — «з них комісія Ryntra 0,50% · ≈ 0,05 USDC», the web's words. */
  ryntraFee: (figures: string) => string
  truthUnknown: string
  priceHolds: (seconds: number) => string
  priceExpired: string
  sign: string
  cancel: string
  inWallet: string
  sending: string
  /* the outcome */
  checkTx: string
  checkingTx: string
  unknownTx: string
  earlierTx: string
  ownPiece: (company: string) => string
  ownToken: (company: string) => string
  fromReview: string
  belowMinimum: string
  nothingHappened: string
  notFilled: string
  earlierDone: string
  earlierNothing: string
  earlierNotFilled: string
  done: string
  tryAgain: string
  continue: string
  history: string
  transaction: string
  failures: Readonly<Record<BuyFailureKey, string>>
}>

export const BUY_COPY: Copy<BuyCopy> = {
  en: {
    exchangeOpen: 'Exchange open',
    exchangeClosed: 'Exchange closed · the price may drift',
    notOffered: 'The issuer is not offering new purchases right now.',
    halted: 'The issuer has paused trading.',
    retired: 'No longer supported in Ryntra — you can sell it in your own wallet.',
    chartRange: 'Chart period',
    rangeLabel: { '1d': '1D', '1w': '1W', '1m': '1M', '1y': '1Y' },
    rangeName: { '1w': 'past week', '1m': 'past month', '1y': 'past year' },
    rangeLabelA11y: { '1d': 'One day', '1w': 'One week', '1m': 'One month', '1y': 'One year' },
    since: (day) => `since ${day}`,
    companyDown: 'This company could not be read right now.',
    buyTitle: (company) => `Buy ${company}`,
    amount: 'Amount in dollars',
    quickShares: (symbol) => `A share of your ${symbol}`,
    minimum: 'The minimum is $1',
    findingMinimum: 'Finding the least this company can be bought for…',
    routeMinimum: (asked, company, minimum) => `No route for ${asked} right now. ${company} from ${minimum}.`,
    setMinimum: (minimum) => `Use ${minimum}`,
    allCosts: 'all costs',
    pricing: 'Pricing…',
    quoteDown: 'The price could not be read right now.',
    payWith: 'Pay with',
    buyFor: (sum) => `Buy for ${sum}`,
    connect: 'Connect wallet',
    connectFailed: 'The wallet was not connected.',
    signIn: 'Sign in with your wallet',
    signInLine: 'Signing in proves the wallet is yours and moves nothing.',
    signInFailed: 'Signing in did not finish. Try again.',
    signInOffline: 'Signing in needs the network. Try again.',
    signInOutdated: 'Update the app to sign in.',
    needSol: 'A little SOL is needed for the network fee',
    notEnough: (symbol) => `Not enough ${symbol}`,
    unavailable: 'Buying is not available right now',
    refreshPrice: 'Refresh the price',
    preparing: 'Preparing the Review…',
    walletHas: (amount) => `In your wallet: ${amount}`,
    topUp: 'Top up',
    review: 'Review',
    rowSpend: 'You pay',
    rowGet: 'You get',
    rowCosts: 'All costs',
    rowWhat: 'What it is',
    atLeast: 'at least',
    reserve: (usd) => `${usd} in SOL, once — it stays in your wallet, on the token’s account`,
    reserveFirst: (reserve, spend) =>
      `The one-time reserve, ${reserve} in SOL, is more than the purchase itself (${spend}). It stays in your wallet, on the token’s account — it is not a cost.`,
    issuerFee: (pct, usd) => (usd ? `including the issuer’s ${pct} fee ${usd}` : `including the issuer’s ${pct} fee`),
    ryntraFee: (figures) => `including the Ryntra fee\u00a0${figures}`,
    truthUnknown: 'Not verified: no issuer document was read',
    priceHolds: (seconds) => `The price holds for ${seconds} s`,
    priceExpired: 'The price has expired',
    sign: 'Sign',
    cancel: 'Cancel',
    inWallet: 'Confirm in your wallet…',
    sending: 'Sending…',
    checkTx: 'Check the transaction',
    checkingTx: 'Checking the transaction…',
    unknownTx: 'The outcome is not known yet. Do not buy again until it is.',
    earlierTx: 'An earlier signature of this wallet is not checked yet. It is checked first — nothing is sent twice.',
    ownPiece: (company) => `You own a piece of ${company}`,
    ownToken: (company) => `${company} token bought`,
    fromReview: 'Figures from the Review — the receipt keeps the network’s.',
    belowMinimum: 'Less arrived than the Review’s minimum — the receipt keeps both figures.',
    nothingHappened: 'Nothing happened — your money did not move. You can buy again.',
    notFilled: 'The network rejected the purchase. Only the network fee was spent.',
    earlierDone: 'The earlier operation went through.',
    earlierNothing: 'The earlier operation did not happen — your money did not move.',
    earlierNotFilled: 'The network rejected the earlier operation. Only the network fee was spent.',
    done: 'Done',
    tryAgain: 'Try again',
    continue: 'Continue',
    history: 'History',
    transaction: 'Transaction',
    failures: {
      walletDeclined: 'The wallet did not sign — nothing was sent.',
      noWallet: 'No Solana wallet is installed on this phone.',
      walletTimeout: 'The wallet did not answer while the price held. Nothing was signed — refresh the price.',
      walletFailed: 'The wallet did not finish the request. Nothing was sent.',
      closedUnderWallet:
        'The price expired while the wallet was open. That signature was not sent — refresh the price.',
      signatureUnreadable: 'The wallet’s signature could not be read. Nothing was sent.',
      paused: 'Buying is switched off right now.',
      notOffered: 'The issuer is not offering new purchases right now.',
      notSetUp: 'Ryntra cannot prepare purchases right now.',
      previousStillValid: 'The previous price still holds. Try again in a minute.',
      reviewOpen: 'An earlier Review is still open. Refresh the price in a minute.',
      checkPrevious: 'The previous purchase is checked first.',
      notPassed: 'This purchase did not pass Ryntra’s checks, so it was not offered.',
      routeFailed: 'This purchase could not be confirmed. Nothing was sent — refresh the price.',
      buildFailed: 'This purchase could not be built — usually the wallet does not cover the sum and the network fee.',
      providerDown: 'The exchange route did not answer. Nothing was sent — try again.',
      signIn: 'Sign in with your wallet to buy.',
      otherWallet: 'The signed-in wallet is not the one buying.',
      bytesChanged: 'The wallet returned a different transaction than the one reviewed, so it was not sent.',
      tooLong: 'That took too long and was stopped. Nothing was sent — try again.',
      offline: 'Ryntra could not be reached. Nothing was sent.',
      noRoute: 'This amount cannot be bought right now.',
      notEnough: 'The wallet does not hold enough for this sum.',
      rateLimited: 'Too many requests just now. Try again in a minute.',
      priceExpired: 'The price has expired. Refresh it.',
      amount: 'This sum cannot be bought.',
      notAccepted: 'This request was not accepted.',
      ruleClosed: 'This reminder has closed. The next one comes on the rule’s day.',
      ruleGone: 'This rule is no longer in your wallet.',
      ruleMismatch: 'Buying is not available right now.',
      ruleBudget: 'This purchase does not fit what is left of the month’s budget. Rules stand until the 1st.',
      ruleCondition: 'The price condition is not met right now — the rule’s purchase waits.',
      failed: 'The purchase could not continue. Try again.',
    },
  },
  uk: {
    exchangeOpen: 'Біржа відкрита',
    exchangeClosed: 'Біржа зачинена · ціна може відхилятися',
    notOffered: 'Емітент зараз не пропонує нових купівель.',
    halted: 'Емітент призупинив торги.',
    retired: 'Більше не підтримується в Ryntra — продати можна у своєму гаманці.',
    chartRange: 'Період графіка',
    rangeLabel: { '1d': '1Д', '1w': '1Т', '1m': '1М', '1y': '1Р' },
    rangeName: { '1w': 'за тиждень', '1m': 'за місяць', '1y': 'за рік' },
    rangeLabelA11y: { '1d': 'Один день', '1w': 'Один тиждень', '1m': 'Один місяць', '1y': 'Один рік' },
    since: (day) => `з ${day}`,
    companyDown: 'Компанію зараз не вдалося прочитати.',
    buyTitle: (company) => `Купити ${company}`,
    amount: 'Сума в доларах',
    quickShares: (symbol) => `Частка твоїх ${symbol}`,
    minimum: 'Мінімум — $1',
    findingMinimum: 'Шукаємо, від якої суми купується ця компанія…',
    routeMinimum: (asked, company, minimum) => `На ${asked} маршруту зараз немає. ${company} — від ${minimum}.`,
    setMinimum: (minimum) => `Поставити ${minimum}`,
    allCosts: 'усі витрати',
    pricing: 'Рахуємо ціну…',
    quoteDown: 'Ціну зараз не вдалося прочитати.',
    payWith: 'Оплата',
    buyFor: (sum) => `Купити за ${sum}`,
    connect: 'Під’єднати гаманець',
    connectFailed: 'Гаманець не під’єднано.',
    signIn: 'Увійти гаманцем',
    signInLine: 'Вхід доводить, що гаманець твій, і нічого не переміщує.',
    signInFailed: 'Вхід не завершився. Спробуй ще.',
    signInOffline: 'Для входу потрібна мережа. Спробуй ще.',
    signInOutdated: 'Онови застосунок, щоб увійти.',
    needSol: 'Потрібно трохи SOL на плату мережі',
    notEnough: (symbol) => `Недостатньо ${symbol}`,
    unavailable: 'Купівля зараз недоступна',
    refreshPrice: 'Оновити ціну',
    preparing: 'Готуємо перевірку…',
    walletHas: (amount) => `У гаманці: ${amount}`,
    topUp: 'Поповнити',
    review: 'Перевірка',
    rowSpend: 'Спишеться',
    rowGet: 'Отримаєш',
    rowCosts: 'Усі витрати',
    rowWhat: 'Що це',
    atLeast: 'щонайменше',
    reserve: (usd) => `${usd} у SOL разово лишаються в гаманці на рахунку токена`,
    reserveFirst: (reserve, spend) =>
      `Разовий резерв ${reserve} у SOL більший за саму покупку (${spend}). Він лишиться в гаманці на рахунку токена — це не витрата.`,
    issuerFee: (pct, usd) => (usd ? `з них комісія емітента ${pct} ${usd}` : `з них комісія емітента ${pct}`),
    ryntraFee: (figures) => `з них комісія Ryntra\u00a0${figures}`,
    truthUnknown: 'Не перевірено: документів емітента не прочитано',
    priceHolds: (seconds) => `Ціна діє ще ${seconds} с`,
    priceExpired: 'Ціна застаріла',
    sign: 'Підписати',
    cancel: 'Скасувати',
    inWallet: 'Підтверди в гаманці…',
    sending: 'Надсилаємо…',
    checkTx: 'Перевірити транзакцію',
    checkingTx: 'Перевіряємо транзакцію…',
    unknownTx: 'Результат ще невідомий. Не купуй ще раз, доки він не з’ясується.',
    earlierTx:
      'Попередній підпис цього гаманця ще не перевірено. Спершу перевіримо його — нічого не надсилається вдруге.',
    ownPiece: (company) => `У тебе є частинка ${company}`,
    ownToken: (company) => `У тебе є токен ${company}`,
    fromReview: 'Цифри з Перевірки — квитанція зберігає цифри мережі.',
    belowMinimum: 'Прийшло менше, ніж мінімум у Перевірці, — квитанція зберігає обидві цифри.',
    nothingHappened: 'Нічого не сталося — гроші не рухались. Можна купити ще раз.',
    notFilled: 'Мережа відхилила купівлю. Списано лише плату мережі.',
    earlierDone: 'Попередня операція пройшла.',
    earlierNothing: 'Попередня операція не відбулася — гроші не рухались.',
    earlierNotFilled: 'Мережа відхилила попередню операцію. Списано лише плату мережі.',
    done: 'Готово',
    tryAgain: 'Спробувати ще',
    continue: 'Продовжити',
    history: 'Історія',
    transaction: 'Транзакція',
    failures: {
      walletDeclined: 'Гаманець не підписав — нічого не надіслано.',
      noWallet: 'На цьому телефоні немає гаманця Solana.',
      walletTimeout: 'Гаманець не відповів, поки діяла ціна. Нічого не підписано — онови ціну.',
      walletFailed: 'Гаманець не завершив запит. Нічого не надіслано.',
      closedUnderWallet: 'Ціна застаріла, поки гаманець був відкритий. Цей підпис не надіслано — онови ціну.',
      signatureUnreadable: 'Підпис гаманця не вдалося прочитати. Нічого не надіслано.',
      paused: 'Купівля зараз вимкнена.',
      notOffered: 'Емітент зараз не пропонує нових купівель.',
      notSetUp: 'Ryntra зараз не може підготувати купівлю.',
      previousStillValid: 'Попередня ціна ще діє. Спробуй за хвилину.',
      reviewOpen: 'Попередня перевірка ще відкрита. Онови ціну за хвилину.',
      checkPrevious: 'Спершу перевіримо попередню купівлю.',
      notPassed: 'Ця купівля не пройшла перевірки Ryntra, тож її не запропоновано.',
      routeFailed: 'Цю купівлю не вдалося підтвердити. Нічого не надіслано — онови ціну.',
      buildFailed: 'Купівлю не вдалося зібрати — зазвичай гаманцю бракує суми разом із платою мережі.',
      providerDown: 'Маршрут обміну не відповів. Нічого не надіслано — спробуй ще.',
      signIn: 'Увійди гаманцем, щоб купити.',
      otherWallet: 'Увійшов інший гаманець, ніж той, що купує.',
      bytesChanged: 'Гаманець повернув не ту транзакцію, що в Перевірці, тож її не надіслано.',
      tooLong: 'Це тривало задовго й зупинено. Нічого не надіслано — спробуй ще.',
      offline: 'Немає зв’язку з Ryntra. Нічого не надіслано.',
      noRoute: 'На цю суму зараз купити не вийде.',
      notEnough: 'У гаманці недостатньо на цю суму.',
      rateLimited: 'Забагато запитів. Спробуй за хвилину.',
      priceExpired: 'Ціна застаріла. Онови її.',
      amount: 'Цю суму купити не вийде.',
      notAccepted: 'Запит не прийнято.',
      ruleClosed: 'Це нагадування вже не діє. Наступне прийде в день правила.',
      ruleGone: 'Цього правила вже немає у твоєму гаманці.',
      ruleMismatch: 'Купівля зараз недоступна.',
      ruleBudget: 'Ця купівля не вміщається в залишок бюджету місяця. Правила стоять до 1-го числа.',
      ruleCondition: 'Умова ціни зараз не виконана — купівля за правилом чекає.',
      failed: 'Купівля не вдалася. Спробуй ще.',
    },
  },
}
