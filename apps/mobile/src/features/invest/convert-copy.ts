import type { Copy } from '../../lib/i18n.ts'

import type { BuyFailureKey } from './buy-model.ts'
import type { ConvertMode, ConvertShare } from './conversion-watch.ts'

/**
 * The words of the swap before the issuer's deadline and of the quiet sale
 * (canon v5.2 В27, §7; M19), in both languages — the web's own for the same
 * sheet (`invest-words.ts`), so the phone and ryntra.io say the same thing.
 * What the swap shares with a purchase — the wallet, the session, «Перевірка»'s
 * clock and signature, the receipt's links — is said in the purchase's words
 * (`buy-copy.ts`); what is the swap's own is here. A refusal speaks of the
 * operation, never of a purchase.
 */
export type ConvertCopy = Readonly<{
  /** «Обміняти SPACEX» · «Продати SPACEX». */
  title: (mode: ConvertMode, symbol: string) => string
  howMuch: string
  shares: Readonly<Record<ConvertShare, string>>
  /** The wallet holds none of the token. */
  noneHeld: (mode: ConvertMode, symbol: string) => string
  review: (mode: ConvertMode) => string
  unavailable: (mode: ConvertMode) => string
  reading: string
  rowGive: string
  rowGet: string
  rowCosts: string
  rowRate: string
  details: string
  hideDetails: string
  route: string
  issuerDeadline: string
  whatYouGet: string
  issuerNotice: string
  swapIsTrade: string
  /** «Обміняно · 0,0664 SpaceX (SPCXx)» — the receipt's first word. */
  done: (mode: ConvertMode) => string
  /** «за 0,0845 SPACEX». */
  receiptFor: (units: string) => string
  nothingMoved: string
  rejected: (mode: ConvertMode) => string
  unknownTx: string
  failures: Readonly<Record<BuyFailureKey, string>>
}>

export const CONVERT_COPY: Copy<ConvertCopy> = {
  en: {
    title: (mode, symbol) => (mode === 'swap' ? `Swap ${symbol}` : `Sell ${symbol}`),
    howMuch: 'How much',
    shares: { 100: 'All', 50: 'Half', 25: 'A quarter' },
    noneHeld: (mode, symbol) =>
      mode === 'swap'
        ? `There is no ${symbol} in this wallet — nothing to swap.`
        : `There is no ${symbol} in this wallet — nothing to sell.`,
    review: (mode) => (mode === 'swap' ? 'Review the swap' : 'Review the sale'),
    unavailable: (mode) =>
      mode === 'swap' ? 'The swap is not available right now.' : 'The sale is not available right now.',
    reading: 'Reading…',
    rowGive: 'You give',
    rowGet: 'You get',
    rowCosts: 'All costs',
    rowRate: 'Rate',
    details: 'Details',
    hideDetails: 'Hide details',
    route: 'Route',
    issuerDeadline: 'The issuer’s deadline',
    whatYouGet: 'What you get',
    issuerNotice: 'The issuer’s notice',
    swapIsTrade: 'The swap is an ordinary trade at the live price — no fixed ratio is promised.',
    done: (mode) => (mode === 'swap' ? 'Swapped' : 'Sold'),
    receiptFor: (units) => `for ${units}`,
    nothingMoved: 'Nothing happened — your tokens did not move. You can try again.',
    rejected: (mode) =>
      mode === 'swap'
        ? 'The network rejected the swap. Only the network fee was spent.'
        : 'The network rejected the sale. Only the network fee was spent.',
    unknownTx: 'The outcome is not known yet. Do not repeat it until it is.',
    failures: {
      walletDeclined: 'The wallet did not sign — nothing was sent.',
      noWallet: 'No Solana wallet is installed on this phone.',
      walletTimeout: 'The wallet did not answer while the price held. Nothing was signed — refresh the price.',
      walletFailed: 'The wallet did not finish the request. Nothing was sent.',
      closedUnderWallet:
        'The price expired while the wallet was open. That signature was not sent — refresh the price.',
      signatureUnreadable: 'The wallet’s signature could not be read. Nothing was sent.',
      paused: 'Trading is switched off right now.',
      notOffered: 'This is not offered right now.',
      notSetUp: 'Ryntra cannot prepare this right now.',
      previousStillValid: 'The previous price still holds. Try again in a minute.',
      reviewOpen: 'An earlier Review is still open. Refresh the price in a minute.',
      checkPrevious: 'The previous operation is checked first.',
      notPassed: 'This did not pass Ryntra’s checks, so it was not offered.',
      routeFailed: 'This could not be confirmed. Nothing was sent — refresh the price.',
      buildFailed: 'This could not be built — usually the wallet lacks SOL for the network fee.',
      providerDown: 'The exchange route did not answer. Nothing was sent — try again.',
      signIn: 'Sign in with your wallet to continue.',
      otherWallet: 'The signed-in wallet is not the one holding the token.',
      bytesChanged: 'The wallet returned a different transaction than the one reviewed, so it was not sent.',
      tooLong: 'That took too long and was stopped. Nothing was sent — try again.',
      offline: 'Ryntra could not be reached. Nothing was sent.',
      noRoute: 'There is no route for this amount right now.',
      notEnough: 'The wallet does not hold this much.',
      rateLimited: 'Too many requests just now. Try again in a minute.',
      priceExpired: 'The price has expired. Refresh it.',
      amount: 'This amount cannot go through.',
      notAccepted: 'This request was not accepted.',
      ruleClosed: 'This is not available right now.',
      ruleGone: 'This is not available right now.',
      ruleMismatch: 'This is not available right now.',
      ruleBudget: 'This is not available right now.',
      ruleCondition: 'This is not available right now.',
      failed: 'This could not continue. Try again.',
    },
  },
  uk: {
    title: (mode, symbol) => (mode === 'swap' ? `Обміняти ${symbol}` : `Продати ${symbol}`),
    howMuch: 'Скільки',
    shares: { 100: 'Усе', 50: 'Половина', 25: 'Чверть' },
    noneHeld: (mode, symbol) =>
      mode === 'swap'
        ? `У гаманці немає ${symbol} — обмінювати нічого.`
        : `У гаманці немає ${symbol} — продавати нічого.`,
    review: (mode) => (mode === 'swap' ? 'Перевірити обмін' : 'Перевірити продаж'),
    unavailable: (mode) => (mode === 'swap' ? 'Обмін зараз недоступний.' : 'Продаж зараз недоступний.'),
    reading: 'Читаємо…',
    rowGive: 'Віддаєш',
    rowGet: 'Отримаєш',
    rowCosts: 'Усі витрати',
    rowRate: 'Курс',
    details: 'Деталі',
    hideDetails: 'Сховати деталі',
    route: 'Маршрут',
    issuerDeadline: 'Строк емітента',
    whatYouGet: 'Що отримаєш',
    issuerNotice: 'Оголошення емітента',
    swapIsTrade: 'Обмін — звичайна угода за живою ціною; фіксованого курсу ніхто не обіцяє.',
    done: (mode) => (mode === 'swap' ? 'Обміняно' : 'Продано'),
    receiptFor: (units) => `за ${units}`,
    nothingMoved: 'Нічого не сталося — токени не рухались. Можна спробувати ще раз.',
    rejected: (mode) =>
      mode === 'swap'
        ? 'Мережа відхилила обмін. Списано лише плату мережі.'
        : 'Мережа відхилила продаж. Списано лише плату мережі.',
    unknownTx: 'Результат ще невідомий. Не повторюй, доки він не з’ясується.',
    failures: {
      walletDeclined: 'Гаманець не підписав — нічого не надіслано.',
      noWallet: 'На цьому телефоні немає гаманця Solana.',
      walletTimeout: 'Гаманець не відповів, поки діяла ціна. Нічого не підписано — онови ціну.',
      walletFailed: 'Гаманець не завершив запит. Нічого не надіслано.',
      closedUnderWallet: 'Ціна застаріла, поки гаманець був відкритий. Цей підпис не надіслано — онови ціну.',
      signatureUnreadable: 'Підпис гаманця не вдалося прочитати. Нічого не надіслано.',
      paused: 'Операції зараз вимкнені.',
      notOffered: 'Це зараз не пропонується.',
      notSetUp: 'Ryntra зараз не може це підготувати.',
      previousStillValid: 'Попередня ціна ще діє. Спробуй за хвилину.',
      reviewOpen: 'Попередня перевірка ще відкрита. Онови ціну за хвилину.',
      checkPrevious: 'Спершу перевіримо попередню операцію.',
      notPassed: 'Це не пройшло перевірки Ryntra, тож не запропоновано.',
      routeFailed: 'Це не вдалося підтвердити. Нічого не надіслано — онови ціну.',
      buildFailed: 'Це не вдалося зібрати — зазвичай гаманцю бракує SOL на плату мережі.',
      providerDown: 'Маршрут обміну не відповів. Нічого не надіслано — спробуй ще.',
      signIn: 'Увійди гаманцем, щоб продовжити.',
      otherWallet: 'Увійшов інший гаманець, ніж той, що тримає токен.',
      bytesChanged: 'Гаманець повернув не ту транзакцію, що в Перевірці, тож її не надіслано.',
      tooLong: 'Це тривало задовго й зупинено. Нічого не надіслано — спробуй ще.',
      offline: 'Немає зв’язку з Ryntra. Нічого не надіслано.',
      noRoute: 'Для цієї кількості зараз немає маршруту.',
      notEnough: 'У гаманці стільки немає.',
      rateLimited: 'Забагато запитів. Спробуй за хвилину.',
      priceExpired: 'Ціна застаріла. Онови її.',
      amount: 'Цю кількість провести не вийде.',
      notAccepted: 'Запит не прийнято.',
      ruleClosed: 'Це зараз недоступно.',
      ruleGone: 'Це зараз недоступно.',
      ruleMismatch: 'Це зараз недоступно.',
      ruleBudget: 'Це зараз недоступно.',
      ruleCondition: 'Це зараз недоступно.',
      failed: 'Не вдалося продовжити. Спробуй ще.',
    },
  },
}
