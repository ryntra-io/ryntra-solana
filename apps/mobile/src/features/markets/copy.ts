import type { Copy } from '../../lib/i18n.ts'

import type { ScreenerSort, ScreenerTab } from './screener.ts'

/**
 * Every word of «Ринки» — one screener for every asset — and of
 * the search, in both languages. The words are the web's own for the same
 * places (`app/app/markets/markets-words.ts`): Усі · Меми · Крипта · Акції ·
 * Приватні · Обране, «У тренді», «Це не акція». The Ukrainian speaks «ти».
 */
export type MarketsCopy = Readonly<{
  title: string
  tabs: Readonly<Record<ScreenerTab, string>>
  tabsA11y: string
  search: string
  askRyntra: string
  sortBy: string
  sortA11y: (sort: string) => string
  sorts: Readonly<Record<ScreenerSort, Readonly<{ label: string; detail: string }>>>
  /* the rows */
  notAShare: string
  /** A private token against PreStocks’ own valuation — the web’s column «До оцінки»: «+2,2% до оцінки». */
  toValuation: (signed: string) => string
  atValuation: string
  notOffered: string
  privateLine: string
  memesRisk: string
  coinsDown: string
  stocksDown: string
  showMore: string
  /* the clock line */
  onDevice: string
  waitingSync: string
  synced: (time: string) => string
  walletList: string
  keptOnDevice: string
  walletListTitle: string
  notLoaded: string
  loading: string
  loadingA11y: string
  /* the lists' states */
  watchEmpty: string
  watchEmptyLine: string
  searchMarkets: string
  noConnection: string
  listDown: string
  listNeedsNetwork: string
  listDownLine: string
  tryAgain: string
  listEmpty: string
  watchNoneListed: string
  categoryEmpty: string
  refresh: string
  stale: string
  /** «Усі» mixes reads: only the coins are stale. */
  coinsStale: string
  partial: string
  notListed: (count: number) => string
  refreshFailed: string
  /* the search */
  back: string
  searching: string
  searchIdle: string
  searchIdleLine: string
  searchDown: string
  searchNeedsNetwork: string
  searchDownLine: string
  nothingFound: string
  noAnswer: (query: string) => string
  results: (count: number) => string
  catalogueDown: string
  staleMark: string
  /* a contract address */
  openAddress: string
  addressLine: (address: string) => string
  finding: string
  /* the asset picker of Trade */
  noMarkets: string
  catalogueSilent: string
}>

/** The Ukrainian noun after a whole count: 1, 21 — one; 2–4, 22–24 — few; the rest — many. */
function ukCount(count: number, one: string, few: string, many: string): string {
  const ten = count % 10
  const hundred = count % 100
  if (ten === 1 && hundred !== 11) return one
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return few
  return many
}

export const MARKETS_COPY: Copy<MarketsCopy> = {
  en: {
    title: 'Markets',
    tabs: {
      all: 'All',
      memes: 'Memes',
      crypto: 'Crypto',
      stocks: 'Stocks',
      private: 'Private',
      watchlist: 'Watchlist',
    },
    tabsA11y: 'Asset kinds',
    search: 'Name, ticker or contract address',
    askRyntra: 'Ask Ryntra',
    sortBy: 'Sort',
    sortA11y: (sort) => `Sort: ${sort}`,
    sorts: {
      volume: { label: 'Trending', detail: '24h volume, highest first' },
      rise: { label: 'Gainers', detail: '24h change, biggest rise first' },
      fall: { label: 'Losers', detail: '24h change, biggest fall first' },
      liquidity: { label: 'Liquidity', detail: 'The deepest pools first' },
      deviation: { label: 'To exchange', detail: 'Token price against the share’s price on the exchange' },
    },
    notAShare: 'Not a share',
    toValuation: (signed) => `${signed} to valuation`,
    atValuation: 'at valuation',
    notOffered: 'Not offered',
    privateLine: 'PreStocks tokens, not shares. Selling may not be possible.',
    memesRisk: 'The riskiest: a price can fall to zero within hours. Buy only what you are ready to lose.',
    coinsDown: 'Crypto and memes are not answering right now.',
    stocksDown: 'Stocks are not answering right now.',
    showMore: 'Show more',
    onDevice: 'on this device',
    waitingSync: 'waiting to sync',
    synced: (time) => `synced ${time}`,
    walletList: 'your wallet’s list',
    keptOnDevice: 'Kept on this device',
    walletListTitle: 'Your wallet’s list',
    notLoaded: 'Not loaded',
    loading: 'Loading',
    loadingA11y: 'Loading markets',
    watchEmpty: 'Your watchlist is empty',
    watchEmptyLine: 'Tap ☆ on a token’s page to keep it here.',
    searchMarkets: 'Search markets',
    noConnection: 'No connection',
    listDown: 'Markets did not load',
    listNeedsNetwork: 'The list needs the network. Try again when you are back online.',
    listDownLine: 'The list is not answering right now. Try again in a moment.',
    tryAgain: 'Try again',
    listEmpty: 'Nothing in this list yet',
    watchNoneListed: 'The venue lists none of your starred assets right now.',
    categoryEmpty: 'The catalogue has no markets in this category right now.',
    refresh: 'Refresh',
    stale: 'Stale · last known figures',
    coinsStale: 'Coins stale · last known figures',
    partial: 'Partial list',
    notListed: (count) => `${count} not listed by the venue`,
    refreshFailed: 'Refresh failed · last read shown',
    back: 'Back',
    searching: 'Searching',
    searchIdle: 'Search every market',
    searchIdleLine: 'A name, a ticker or a contract address',
    searchDown: 'Search did not answer',
    searchNeedsNetwork: 'Search needs the network.',
    searchDownLine: 'Search is not answering right now. Try again in a moment.',
    nothingFound: 'Nothing matches',
    noAnswer: (query) => `No market answers to “${query}”.`,
    results: (count) => `${count} ${count === 1 ? 'result' : 'results'}`,
    catalogueDown: 'Catalogue search unavailable',
    staleMark: 'Stale',
    openAddress: 'Open the token',
    addressLine: (address) => `By its contract address ${address}`,
    finding: 'Finding the token',
    noMarkets: 'No markets loaded',
    catalogueSilent: 'The catalogue did not answer.',
  },
  uk: {
    title: 'Ринки',
    tabs: { all: 'Усі', memes: 'Меми', crypto: 'Крипта', stocks: 'Акції', private: 'Приватні', watchlist: 'Обране' },
    tabsA11y: 'Види активів',
    search: 'Назва, тікер або адреса контракту',
    askRyntra: 'Спитати Ryntra',
    sortBy: 'Порядок',
    sortA11y: (sort) => `Порядок: ${sort}`,
    sorts: {
      volume: { label: 'У тренді', detail: 'Обсяг за 24 год, спершу найбільший' },
      rise: { label: 'Зростають', detail: 'Зміна за 24 год, спершу найбільше зростання' },
      fall: { label: 'Падають', detail: 'Зміна за 24 год, спершу найбільше падіння' },
      liquidity: { label: 'Ліквідність', detail: 'Спершу найглибші пули' },
      deviation: { label: 'До біржі', detail: 'Ціна токена проти ціни акції на біржі' },
    },
    notAShare: 'Це не акція',
    toValuation: (signed) => `${signed} до оцінки`,
    atValuation: 'за оцінкою',
    notOffered: 'Не пропонується',
    privateLine: 'Токени PreStocks, а не акції. Продати може не вийти.',
    memesRisk: 'Найризикованіше: ціна може впасти до нуля за години. Купуй лише те, що готовий втратити.',
    coinsDown: 'Крипта й меми зараз не відповідають.',
    stocksDown: 'Акції зараз не відповідають.',
    showMore: 'Показати ще',
    onDevice: 'на цьому пристрої',
    waitingSync: 'чекає синхронізації',
    synced: (time) => `синхронізовано о ${time}`,
    walletList: 'список твого гаманця',
    keptOnDevice: 'Зберігається на цьому пристрої',
    walletListTitle: 'Список твого гаманця',
    notLoaded: 'Не завантажено',
    loading: 'Завантаження',
    loadingA11y: 'Завантажуємо ринки',
    watchEmpty: 'Обране порожнє',
    watchEmptyLine: 'Натисни ☆ на сторінці токена — і він буде тут.',
    searchMarkets: 'Пошук на ринках',
    noConnection: 'Немає з’єднання',
    listDown: 'Ринки не завантажилися',
    listNeedsNetwork: 'Списку потрібна мережа. Спробуй ще раз, коли з’явиться зв’язок.',
    listDownLine: 'Список ринків зараз не відповідає. Спробуй ще раз за мить.',
    tryAgain: 'Спробувати ще',
    listEmpty: 'У цьому списку поки нічого',
    watchNoneListed: 'Жоден із позначених тобою активів зараз не торгується на майданчику.',
    categoryEmpty: 'У цій категорії зараз немає ринків.',
    refresh: 'Оновити',
    stale: 'Застаріло · останні відомі цифри',
    coinsStale: 'Монети застаріли · останні відомі цифри',
    partial: 'Неповний список',
    notListed: (count) =>
      `${count} ${ukCount(count, 'актив не торгується', 'активи не торгуються', 'активів не торгуються')} на майданчику`,
    refreshFailed: 'Не оновилося · показано останнє прочитане',
    back: 'Назад',
    searching: 'Шукаємо',
    searchIdle: 'Пошук на всіх ринках',
    searchIdleLine: 'Назва, тікер або адреса контракту',
    searchDown: 'Пошук не відповів',
    searchNeedsNetwork: 'Пошуку потрібна мережа.',
    searchDownLine: 'Пошук зараз не відповідає. Спробуй ще раз за мить.',
    nothingFound: 'Нічого не знайдено',
    noAnswer: (query) => `Жоден ринок не відповідає на «${query}».`,
    results: (count) => `${count} ${ukCount(count, 'результат', 'результати', 'результатів')}`,
    catalogueDown: 'Пошук у каталозі недоступний',
    staleMark: 'Застаріло',
    openAddress: 'Відкрити токен',
    addressLine: (address) => `За адресою контракту ${address}`,
    finding: 'Шукаємо токен',
    noMarkets: 'Ринки не завантажилися',
    catalogueSilent: 'Каталог не відповів.',
  },
}
