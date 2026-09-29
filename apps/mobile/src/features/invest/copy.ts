import type { Copy } from '../../lib/i18n.ts'

/**
 * Every word the beginner's path says on Home, Markets, a company's page,
 * «Поповнити» and «Отримати», in both languages (canon v5.1 §2–§4; one version
 * since v5.3 В28). The words a beginner reads — a company
 * by its name, a price in dollars, one action — are the web line's own, so the
 * phone and ryntra.io say the same thing; the Ukrainian speaks «ти».
 */
export type InvestCopy = Readonly<{
  homeTitle: string
  guestHeadline: string
  guestLine: string
  connectWallet: string
  yourInvestments: string
  buy: string
  topUp: string
  today: string
  at: (time: string) => string
  emptyWallet: string
  walletUnread: string
  tryAgain: string
  partlyRead: string
  heldBack: (time: string) => string
  unpriced: (count: number) => string
  unfinished: string
  showAmounts: string
  hideAmounts: string
  inbox: string
  popularCompanies: string
  byVolume: string
  allCompanies: string
  marketsTitle: string
  search: string
  clearSearch: string
  companies: string
  privateCompanies: string
  forExperienced: string
  privateLine: string
  notAShare: string
  /** A private company's price against PreStocks' own valuation of it (canon v5.2 В27). */
  markAbove: (pct: string) => string
  markBelow: (pct: string) => string
  markAt: string
  dollars: string
  crypto: string
  showMore: string
  nothingFound: string
  updating: string
  pricesAt: (time: string) => string
  notUpdated: string
  shelfDown: string
  reload: string
  coinsDown: string
  details: string
  hideDetails: string
  priceAt: (time: string) => string
  halted: string
  unverified: string
  flagged: string
  notConfirmed: string
  priceDown: string
  noConnection: string
  notListed: string
  back: string
  chartNone: string
  chartBusy: string
  research: string
  topUpTitle: string
  topUpNetwork: string
  topUpLine: string
  yourAddress: string
  copyAddress: string
  copied: string
  share: string
  topUpWarning: string
  gasLine: string
  /** «Ще» · «Отримати»: the same address, for anything sent on Solana. */
  receiveTitle: string
  receiveLine: string
  receiveGuest: string
}>

export const INVEST_COPY: Copy<InvestCopy> = {
  en: {
    homeTitle: 'Home',
    // A no-break space keeps the sum with its word: the line never ends on «from» / «від».
    guestHeadline: 'Buy a piece of a company from\u00a0$1',
    guestLine: 'No broker — it stays in your own wallet.',
    connectWallet: 'Connect wallet',
    yourInvestments: 'Your investments',
    buy: 'Buy',
    topUp: 'Top up',
    today: 'today',
    at: (time) => `at ${time}`,
    emptyWallet: 'Nothing here yet — top up and buy your first piece.',
    walletUnread: 'Your wallet could not be read right now.',
    tryAgain: 'Try again',
    partlyRead: 'Part of the wallet was not read',
    heldBack: (time) => `Balances as read at ${time}`,
    unpriced: (count) => `${count} without a price`,
    unfinished: 'A signature is waiting to be checked',
    showAmounts: 'Show amounts',
    hideAmounts: 'Hide amounts',
    inbox: 'Notes',
    popularCompanies: 'Popular companies',
    byVolume: 'By trading volume over 24 hours',
    allCompanies: 'All companies',
    marketsTitle: 'Markets',
    search: 'Search a company or a coin',
    clearSearch: 'Clear the search',
    companies: 'Companies',
    privateCompanies: 'Private companies',
    forExperienced: 'for experienced investors',
    privateLine: 'Tokens on the issuer’s terms, not shares. Selling may not be possible.',
    notAShare: 'Not a share',
    markAbove: (pct) => `${pct} above PreStocks’ valuation`,
    markBelow: (pct) => `${pct} below PreStocks’ valuation`,
    markAt: 'Priced at PreStocks’ valuation',
    dollars: 'Dollars',
    crypto: 'Crypto',
    showMore: 'Show more',
    nothingFound: 'Nothing found.',
    updating: 'Updating prices…',
    pricesAt: (time) => `Prices at ${time}`,
    notUpdated: 'not updated',
    shelfDown: 'The list of companies is not answering right now.',
    reload: 'Reload',
    coinsDown: 'Dollars and crypto are not answering right now.',
    details: 'Details',
    hideDetails: 'Hide details',
    priceAt: (time) => `Price at ${time}`,
    halted: 'Trading is halted by the issuer',
    unverified: 'Not verified by the venue',
    flagged: 'Flagged by the venue',
    notConfirmed: 'No issuer confirms this token as a stock',
    priceDown: 'The price did not load',
    noConnection: 'No connection',
    notListed: 'Not listed right now',
    back: 'Back',
    chartNone: 'No chart for this asset',
    chartBusy: 'The chart is not answering right now',
    research: 'The facts behind the figures',
    topUpTitle: 'Top up',
    topUpNetwork: 'Solana network',
    topUpLine: 'Send USDC to your address on the Solana network — from an exchange or another wallet.',
    yourAddress: 'Your address',
    copyAddress: 'Copy address',
    copied: 'Copied',
    share: 'Share',
    topUpWarning: 'Solana network only: funds sent from another network are lost.',
    gasLine: 'A purchase also needs a little SOL for the network fee.',
    receiveTitle: 'Receive',
    receiveLine: 'Your address on the Solana network — for USDC, SOL and any Solana token.',
    receiveGuest: 'Connect a wallet and its address appears here.',
  },
  uk: {
    homeTitle: 'Головна',
    guestHeadline: 'Купи частинку компанії від\u00a0$1',
    guestLine: 'Без брокера — усе лишається у твоєму гаманці.',
    connectWallet: 'Під’єднати гаманець',
    yourInvestments: 'Твої інвестиції',
    buy: 'Купити',
    topUp: 'Поповнити',
    today: 'за день',
    at: (time) => `о ${time}`,
    emptyWallet: 'Поки порожньо — поповни й купи першу частинку.',
    walletUnread: 'Гаманець зараз не вдалося прочитати.',
    tryAgain: 'Спробувати ще',
    partlyRead: 'Частину гаманця не прочитано',
    heldBack: (time) => `Баланс як прочитано о ${time}`,
    unpriced: (count) => `${count} без ціни`,
    unfinished: 'Підпис чекає перевірки',
    showAmounts: 'Показати суми',
    hideAmounts: 'Сховати суми',
    inbox: 'Сповіщення',
    popularCompanies: 'Популярні компанії',
    byVolume: 'За обсягом торгів за 24 год',
    allCompanies: 'Усі компанії',
    marketsTitle: 'Ринки',
    search: 'Пошук: компанія або монета',
    clearSearch: 'Очистити пошук',
    companies: 'Компанії',
    privateCompanies: 'Приватні компанії',
    forExperienced: 'для досвідчених',
    privateLine: 'Токени на умовах емітента, а не акції. Продати може не вийти.',
    notAShare: 'Це не акція',
    markAbove: (pct) => `На ${pct} дорожче за оцінку PreStocks`,
    markBelow: (pct) => `На ${pct} дешевше за оцінку PreStocks`,
    markAt: 'Ціна дорівнює оцінці PreStocks',
    dollars: 'Долари',
    crypto: 'Крипта',
    showMore: 'Показати ще',
    nothingFound: 'Нічого не знайдено.',
    updating: 'Оновлюємо ціни…',
    pricesAt: (time) => `Ціни о ${time}`,
    notUpdated: 'не оновилися',
    shelfDown: 'Список компаній зараз не відповідає.',
    reload: 'Оновити',
    coinsDown: 'Долари й крипта зараз не відповідають.',
    details: 'Деталі',
    hideDetails: 'Сховати деталі',
    priceAt: (time) => `Ціна о ${time}`,
    halted: 'Торги зупинив емітент',
    unverified: 'Майданчик не перевірив цей токен',
    flagged: 'Майданчик позначив цей токен',
    notConfirmed: 'Жоден емітент не підтверджує цей токен як акцію',
    priceDown: 'Ціна не завантажилась',
    noConnection: 'Немає з’єднання',
    notListed: 'Зараз не торгується',
    back: 'Назад',
    chartNone: 'Для цього активу графіка немає',
    chartBusy: 'Графік зараз не відповідає',
    research: 'Факти за цифрами',
    topUpTitle: 'Поповнити',
    topUpNetwork: 'Мережа Solana',
    topUpLine: 'Надішли USDC на свою адресу в мережі Solana — з біржі чи іншого гаманця.',
    yourAddress: 'Твоя адреса',
    copyAddress: 'Копіювати адресу',
    copied: 'Скопійовано',
    share: 'Поділитися',
    topUpWarning: 'Лише мережа Solana: кошти з іншої мережі загубляться.',
    gasLine: 'Для купівлі потрібно ще трохи SOL на комісію мережі.',
    receiveTitle: 'Отримати',
    receiveLine: 'Твоя адреса в мережі Solana — для USDC, SOL і будь-якого токена Solana.',
    receiveGuest: 'Під’єднай гаманець — і тут з’явиться його адреса.',
  },
}
