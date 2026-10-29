import type { Copy } from '../../lib/i18n.ts'

/**
 * Every word the beginner's path says on Home, Markets, a company's page,
 * «Поповнити» and «Отримати», in both languages.
 * The words a beginner reads — a company
 * by its name, a price in dollars, one action — are the web line's own, so the
 * phone and ryntra.io say the same thing; the Ukrainian speaks «ти».
 */
export type InvestCopy = Readonly<{
  homeTitle: string
  guestHeadline: string
  connectWallet: string
  yourInvestments: string
  buy: string
  topUp: string
  /** Beside a 24 h change (the venue's «change24h»): «in 24h» · «за добу», as Home and Portfolio say it — never «today». */
  today: string
  emptyWallet: string
  walletUnread: string
  tryAgain: string
  partlyRead: string
  readingPrices: string
  heldBack: (time: string) => string
  unpriced: (count: number) => string
  unpricedTitle: string
  unpricedHelp: (count: number, of: number) => string
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
  /** A private company's price against PreStocks' own valuation of it. */
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
  halted: string
  unverified: string
  flagged: string
  notConfirmed: string
  /** A token that takes a stock's ticker or its company's name while it is not that stock (ST-5 r4). */
  notTheStock: (company: string) => string
  /**
   * A stock token whose pool price stands far from the issuer's reference for the share (ST-5 r7): by how much, which
   * way, and — where the pool holds almost nothing — that it is nearly empty.
   */
  poolFar: (pct: string, above: boolean, empty: boolean) => string
  /** The same distance as a live quote for a sum said it (ST-5 r8) — the freshest figure, with the sum it was asked for. */
  sumFar: (sum: string, pct: string, above: boolean, empty: boolean) => string
  /** The pool holds almost nothing and no reference says how far its price stands from the share. */
  poolEmpty: string
  /**
   * Beside a far price: a larger sum a live quote actually priced near the share, with that quote's time (ST-5 r9) —
   * said only where such a quote was seen.
   */
  fairFrom: (sum: string, time: string) => string
  priceDown: string
  noConnection: string
  notListed: string
  back: string
  chartNone: string
  /** The chosen range holds no prices while another range has some (ST-5 r9). */
  chartRangeNone: string
  chartBusy: string
  /** The chart's longest range — half a year, all the daily bars the candles route serves (`lib/chart.ts`). */
  halfYearChip: string
  halfYearChipA11y: string
  halfYearName: string
  /** «Ключові показники»: the price over that half year, its low and high read from daily closes. */
  halfYearRange: string
  lowestClose: string
  highestClose: string
  closeRangeA11y: (low: string, high: string) => string
  research: string
  topUpTitle: string
  topUpNetwork: string
  /** «?» beside «Твоя адреса» in «Поповнити»: where to send from and the SOL a purchase needs. */
  topUpHelpTitle: string
  topUpHelp: readonly string[]
  yourAddress: string
  copyAddress: string
  copied: string
  share: string
  topUpWarning: string
  /** «Гроші» · «Отримати»: the same address, for anything sent on Solana. */
  receiveTitle: string
}>

export const INVEST_COPY: Copy<InvestCopy> = {
  en: {
    homeTitle: 'Home',
    // The release's own line; the one action under it says the rest.
    guestHeadline: 'Launch. Trade. Automate.',
    connectWallet: 'Connect wallet',
    yourInvestments: 'Your investments',
    buy: 'Buy',
    topUp: 'Add funds',
    today: 'in 24h',
    emptyWallet: 'Nothing here yet',
    walletUnread: 'Your wallet could not be read right now.',
    tryAgain: 'Try again',
    partlyRead: 'Part of the wallet was not read',
    readingPrices: 'Reading prices…',
    heldBack: (at) => `Balances as read ${at}`,
    unpriced: (count) => `${count} without a price`,
    unpricedTitle: 'Assets without a price',
    unpricedHelp: (count, of) =>
      `${count} of your ${of} assets have no price yet — most often small balances and airdrops. They stay in your wallet; the total counts only what has a price.`,
    unfinished: 'An operation is waiting to be checked',
    showAmounts: 'Show amounts',
    hideAmounts: 'Hide amounts',
    inbox: 'Notes',
    popularCompanies: 'Popular companies',
    byVolume: '24 h volume',
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
    pricesAt: (at) => `Prices ${at}`,
    notUpdated: 'not updated',
    shelfDown: 'The list of companies is not answering right now.',
    reload: 'Reload',
    coinsDown: 'Dollars and crypto are not answering right now.',
    details: 'Details',
    hideDetails: 'Hide details',
    halted: 'Trading is halted by the issuer',
    unverified: 'Not verified by Jupiter',
    flagged: 'Flagged by Jupiter',
    notConfirmed: 'No issuer confirms this token as a stock',
    notTheStock: (company) => `This is not the ${company} stock — another token with that name`,
    poolFar: (pct, above, empty) =>
      `The pool price is ${pct} ${above ? 'above' : 'below'} the share${empty ? ' — the pool is nearly empty' : ''}`,
    sumFar: (sum, pct, above, empty) =>
      `For ${sum} the price is ${pct} ${above ? 'above' : 'below'} the share${empty ? ' — the pool is nearly empty' : ''}`,
    poolEmpty: 'The pool is nearly empty — its price can stand far from the share',
    fairFrom: (sum, time) => `From ${sum} the price is close to the share — quote at ${time}`,
    priceDown: 'The price did not load',
    noConnection: 'No connection',
    notListed: 'Not listed right now',
    back: 'Back',
    chartNone: 'No chart for this asset',
    chartRangeNone: 'No chart for this period',
    chartBusy: 'The chart is not answering right now',
    halfYearChip: '6M',
    halfYearChipA11y: 'Six months',
    halfYearName: 'past 6 months',
    halfYearRange: 'Price over 6 months',
    lowestClose: 'Lowest daily close',
    highestClose: 'Highest daily close',
    closeRangeA11y: (low, high) => `Lowest daily close ${low}, highest ${high}`,
    research: 'The facts behind the figures',
    topUpTitle: 'Add funds',
    topUpNetwork: 'Solana network',
    topUpHelpTitle: 'How to add funds',
    topUpHelp: [
      'Send USDC or SOL to this address on the Solana network — from an exchange or another wallet.',
      'A purchase also needs a little SOL for the network fee.',
    ],
    yourAddress: 'Your address',
    copyAddress: 'Copy address',
    copied: 'Copied',
    share: 'Share',
    topUpWarning: 'Solana network only: funds sent from another network are lost.',
    receiveTitle: 'Receive',
  },
  uk: {
    homeTitle: 'Головна',
    guestHeadline: 'Запускай. Торгуй. Автоматизуй.',
    connectWallet: 'Під’єднати гаманець',
    yourInvestments: 'Твої інвестиції',
    buy: 'Купити',
    topUp: 'Поповнити',
    today: 'за добу',
    emptyWallet: 'Поки порожньо',
    walletUnread: 'Гаманець зараз не вдалося прочитати.',
    tryAgain: 'Спробувати ще',
    partlyRead: 'Частину гаманця не прочитано',
    readingPrices: 'Завантаження цін…',
    heldBack: (at) => `Баланс як прочитано ${at}`,
    unpriced: (count) => `${count} без ціни`,
    unpricedTitle: 'Активи без ціни',
    unpricedHelp: (count, of) =>
      `${count} з ${of} твоїх активів поки не мають ціни — найчастіше це дрібні залишки й аірдропи. Вони лишаються в гаманці; сума рахує лише те, що має ціну.`,
    unfinished: 'Операція чекає перевірки',
    showAmounts: 'Показати суми',
    hideAmounts: 'Сховати суми',
    inbox: 'Сповіщення',
    popularCompanies: 'Популярні компанії',
    byVolume: 'Обсяг за 24 год',
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
    pricesAt: (at) => `Ціни ${at}`,
    notUpdated: 'не оновилися',
    shelfDown: 'Список компаній зараз не відповідає.',
    reload: 'Оновити',
    coinsDown: 'Долари й крипта зараз не відповідають.',
    details: 'Деталі',
    hideDetails: 'Сховати деталі',
    halted: 'Торги зупинив емітент',
    unverified: 'Jupiter не перевірив цей токен',
    flagged: 'Jupiter позначив цей токен',
    notConfirmed: 'Жоден емітент не підтверджує цей токен як акцію',
    notTheStock: (company) => `Це не акція ${company} — інший токен з такою назвою`,
    poolFar: (pct, above, empty) =>
      `Ціна в пулі на ${pct} ${above ? 'вища' : 'нижча'} за акцію${empty ? ' — пул майже порожній' : ''}`,
    sumFar: (sum, pct, above, empty) =>
      `За ${sum} ціна на ${pct} ${above ? 'вища' : 'нижча'} за акцію${empty ? ' — пул майже порожній' : ''}`,
    poolEmpty: 'Пул майже порожній — його ціна може бути далекою від акції',
    fairFrom: (sum, time) => `Від ${sum} ціна близька до акції — котирування о ${time}`,
    priceDown: 'Ціна не завантажилась',
    noConnection: 'Немає з’єднання',
    notListed: 'Зараз не торгується',
    back: 'Назад',
    chartNone: 'Для цього активу графіка немає',
    chartRangeNone: 'За цей період графіка немає',
    chartBusy: 'Графік зараз не відповідає',
    halfYearChip: '6М',
    halfYearChipA11y: 'Шість місяців',
    halfYearName: 'за пів року',
    halfYearRange: 'Ціна за пів року',
    lowestClose: 'Найнижче закриття дня',
    highestClose: 'Найвище закриття дня',
    closeRangeA11y: (low, high) => `Найнижче закриття дня ${low}, найвище ${high}`,
    research: 'Факти за цифрами',
    topUpTitle: 'Поповнити',
    topUpNetwork: 'Мережа Solana',
    topUpHelpTitle: 'Як поповнити',
    topUpHelp: [
      'Надішли USDC чи SOL на цю адресу в мережі Solana — з біржі чи іншого гаманця.',
      'Для купівлі потрібно ще трохи SOL на комісію мережі.',
    ],
    yourAddress: 'Твоя адреса',
    copyAddress: 'Копіювати адресу',
    copied: 'Скопійовано',
    share: 'Поділитися',
    topUpWarning: 'Лише мережа Solana: кошти з іншої мережі загубляться.',
    receiveTitle: 'Отримати',
  },
}
