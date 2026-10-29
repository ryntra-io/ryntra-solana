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
  sorts: Readonly<Record<ScreenerSort, Readonly<{ label: string }>>>
  /* the rows */
  notAShare: string
  /** A private token against PreStocks’ own valuation — the web’s column «До оцінки»: «+2,2% до оцінки». */
  toValuation: (signed: string) => string
  atValuation: string
  notOffered: string
  privateLine: string
  memesRisk: string
  /** A meme's mark on its row where kinds are mixed («Усі», «Обране»). */
  memeMark: string
  coinsDown: string
  cryptoDown: string
  memesDown: string
  stocksDown: string
  showMore: string
  /* the clock line */
  notLoaded: string
  loading: string
  loadingA11y: string
  /* the lists' states */
  watchEmpty: string
  searchMarkets: string
  noConnection: string
  listDown: string
  listNeedsNetwork: string
  listDownLine: string
  tryAgain: string
  listEmpty: string
  watchNoneListed: string
  refresh: string
  /** A list's prices at their read's time: «Ціни о 11:49», «Ціни вчора о 23:10». */
  pricesAt: (at: string) => string
  notListed: (count: number) => string
  /* the search */
  back: string
  searching: string
  searchIdle: string
  searchDown: string
  searchNeedsNetwork: string
  searchDownLine: string
  nothingFound: string
  noAnswer: (query: string) => string
  results: (count: number) => string
  catalogueDown: string
  /* a contract address */
  openAddress: string
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
    search: 'Name, ticker or address',
    askRyntra: 'Ask Ryntra',
    sortBy: 'Sort',
    sortA11y: (sort) => `Sort: ${sort}`,
    sorts: {
      volume: { label: 'Trending' },
      rise: { label: 'Gainers' },
      fall: { label: 'Losers' },
      liquidity: { label: 'Liquidity' },
      deviation: { label: 'To exchange' },
    },
    notAShare: 'Not a share',
    toValuation: (signed) => `${signed} to valuation`,
    atValuation: 'at valuation',
    notOffered: 'Not offered',
    privateLine: 'PreStocks tokens, not shares. Selling may not be possible.',
    memesRisk: 'Memes can fall to zero within hours. Buy only what you can afford to lose.',
    memeMark: 'Meme',
    coinsDown: 'Crypto and memes are not answering right now.',
    cryptoDown: 'Crypto is not answering right now.',
    memesDown: 'Memes are not answering right now.',
    stocksDown: 'Stocks are not answering right now.',
    showMore: 'Show more',
    notLoaded: 'Not loaded',
    loading: 'Loading',
    loadingA11y: 'Loading markets',
    watchEmpty: 'Nothing in Favourites yet',
    searchMarkets: 'Search markets',
    noConnection: 'No connection',
    listDown: 'Markets did not load',
    listNeedsNetwork: 'The list needs the network. Try again when you are back online.',
    listDownLine: 'The list is not answering right now. Try again in a moment.',
    tryAgain: 'Try again',
    listEmpty: 'Nothing in this list yet',
    watchNoneListed: 'None of your favourites is trading right now.',
    refresh: 'Refresh',
    pricesAt: (at) => `Prices ${at}`,
    notListed: (count) => `${count} not trading right now`,
    back: 'Back',
    searching: 'Searching',
    searchIdle: 'Search every market',
    searchDown: 'Search did not answer',
    searchNeedsNetwork: 'Search needs the network.',
    searchDownLine: 'Search is not answering right now. Try again in a moment.',
    nothingFound: 'Nothing matches',
    noAnswer: (query) => `No market answers to “${query}”.`,
    results: (count) => `${count} ${count === 1 ? 'result' : 'results'}`,
    catalogueDown: 'Catalogue search unavailable',
    openAddress: 'Open the token',
    finding: 'Finding the token',
    noMarkets: 'No markets loaded',
    catalogueSilent: 'The catalogue did not answer.',
  },
  uk: {
    title: 'Ринки',
    tabs: { all: 'Усі', memes: 'Меми', crypto: 'Крипта', stocks: 'Акції', private: 'Приватні', watchlist: 'Обране' },
    tabsA11y: 'Види активів',
    search: 'Назва, тікер або адреса',
    askRyntra: 'Спитати Ryntra',
    sortBy: 'Порядок',
    sortA11y: (sort) => `Порядок: ${sort}`,
    sorts: {
      volume: { label: 'У тренді' },
      rise: { label: 'Зростають' },
      fall: { label: 'Падають' },
      liquidity: { label: 'Ліквідність' },
      deviation: { label: 'До біржі' },
    },
    notAShare: 'Це не акція',
    toValuation: (signed) => `${signed} до оцінки`,
    atValuation: 'за оцінкою',
    notOffered: 'Не пропонується',
    privateLine: 'Токени PreStocks, а не акції. Продати може не вийти.',
    memesRisk: 'Меми можуть упасти до нуля за години. Купуй лише на суму, яку не шкода втратити.',
    memeMark: 'Мем',
    coinsDown: 'Крипто й меми зараз не відповідають.',
    cryptoDown: 'Крипто зараз не відповідає.',
    memesDown: 'Меми зараз не відповідають.',
    stocksDown: 'Акції зараз не відповідають.',
    showMore: 'Показати ще',
    notLoaded: 'Не завантажено',
    loading: 'Завантаження',
    loadingA11y: 'Завантажуємо ринки',
    watchEmpty: 'Обране порожнє',
    searchMarkets: 'Пошук на ринках',
    noConnection: 'Немає з’єднання',
    listDown: 'Ринки не завантажилися',
    listNeedsNetwork: 'Списку потрібен інтернет. Спробуй ще раз, коли з’явиться зв’язок.',
    listDownLine: 'Список ринків зараз не відповідає. Спробуй ще раз за мить.',
    tryAgain: 'Спробувати ще',
    listEmpty: 'У цьому списку поки нічого',
    watchNoneListed: 'Жоден з обраних активів зараз не торгується.',
    refresh: 'Оновити',
    pricesAt: (at) => `Ціни ${at}`,
    notListed: (count) =>
      `${count} ${ukCount(count, 'актив зараз не торгується', 'активи зараз не торгуються', 'активів зараз не торгуються')}`,
    back: 'Назад',
    searching: 'Шукаємо',
    searchIdle: 'Пошук на всіх ринках',
    searchDown: 'Пошук не відповів',
    searchNeedsNetwork: 'Пошуку потрібен інтернет.',
    searchDownLine: 'Пошук зараз не відповідає. Спробуй ще раз за мить.',
    nothingFound: 'Нічого не знайдено',
    noAnswer: (query) => `Жоден ринок не відповідає на «${query}».`,
    results: (count) => `${count} ${ukCount(count, 'результат', 'результати', 'результатів')}`,
    catalogueDown: 'Пошук у каталозі недоступний',
    openAddress: 'Відкрити токен',
    finding: 'Шукаємо токен',
    noMarkets: 'Ринки не завантажилися',
    catalogueSilent: 'Каталог не відповів.',
  },
}

/**
 * The one quiet line over a list of prices, as Markets says it: their time, «Ціни о 11:49» (`at` writes the time). Null
 * when nothing was read. A list's prices stand and are read again quietly (every 60 s and when the screen opens); the
 * server's `stale` flag draws no «Ціни не оновлюються» bar over them.
 */
export function pricesLine(words: MarketsCopy, observedAt: string | null, at: (iso: string) => string): string | null {
  return observedAt ? words.pricesAt(at(observedAt)) : null
}
