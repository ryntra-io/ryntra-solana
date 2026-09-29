import type { Copy } from '../../lib/i18n.ts'

/** Markets' four lists, the screen «Акції» and «Тренди» open (M2; canon v5.3 В28). */
export type MarketsListKey = 'watchlist' | 'stock' | 'crypto' | 'meme'
export type MarketsSortKey = 'volume' | 'change' | 'name' | 'deviation'

/**
 * Every word of Markets' four lists and of the search, in both languages. The
 * words are the web's own for the same places — its Spot market list, its
 * stock surface and its Markets — and, where the phone already says the same
 * thing, the phone's (the watchlist, «Крипта»), so one app says one thing. The
 * Ukrainian speaks «ти».
 */
export type MarketsCopy = Readonly<{
  title: string
  lists: Readonly<Record<MarketsListKey, string>>
  sortBy: string
  sortA11y: (sort: string) => string
  sorts: Readonly<Record<MarketsSortKey, Readonly<{ label: string; detail: string }>>>
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
    lists: { watchlist: 'Watchlist', stock: 'Stocks', crypto: 'Crypto', meme: 'Memes' },
    sortBy: 'Sort by',
    sortA11y: (sort) => `Sort: ${sort}`,
    sorts: {
      volume: { label: 'Most traded', detail: '24h volume, highest first' },
      change: { label: 'Biggest movers', detail: '24h change, largest first' },
      name: { label: 'Name', detail: 'A to Z' },
      deviation: { label: 'Largest deviation', detail: 'Token price against the issuer reference' },
    },
    onDevice: 'on this device',
    waitingSync: 'waiting to sync',
    synced: (time) => `synced ${time}`,
    walletList: 'your wallet’s list',
    keptOnDevice: 'Kept on this device',
    walletListTitle: 'Your wallet’s list',
    notLoaded: 'Not loaded',
    loading: 'Loading',
    loadingA11y: 'Loading markets',
    watchEmpty: 'Nothing on your watchlist yet',
    watchEmptyLine: 'Star an asset to keep it here.',
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
    partial: 'Partial list',
    notListed: (count) => `${count} not listed by the venue`,
    refreshFailed: 'Refresh failed · last read shown',
    back: 'Back',
    searching: 'Searching',
    searchIdle: 'Search every market',
    searchIdleLine: 'A company, a ticker or a token',
    searchDown: 'Search did not answer',
    searchNeedsNetwork: 'Search needs the network.',
    searchDownLine: 'Search is not answering right now. Try again in a moment.',
    nothingFound: 'Nothing matches',
    noAnswer: (query) => `No market answers to “${query}”.`,
    results: (count) => `${count} ${count === 1 ? 'result' : 'results'}`,
    catalogueDown: 'Catalogue search unavailable',
    staleMark: 'Stale',
    noMarkets: 'No markets loaded',
    catalogueSilent: 'The catalogue did not answer.',
  },
  uk: {
    title: 'Ринки',
    lists: { watchlist: 'Список спостереження', stock: 'Акції', crypto: 'Крипта', meme: 'Меми' },
    sortBy: 'Сортування',
    sortA11y: (sort) => `Сортування: ${sort}`,
    sorts: {
      volume: { label: 'Найбільше торгуються', detail: 'Обсяг за 24 год, спершу найбільший' },
      change: { label: 'Найбільші зміни', detail: 'Зміна за 24 год, спершу найбільша' },
      name: { label: 'Назва', detail: 'Від A до Z' },
      deviation: { label: 'Найбільше відхилення', detail: 'Ціна токена проти референсу емітента' },
    },
    onDevice: 'на цьому пристрої',
    waitingSync: 'чекає синхронізації',
    synced: (time) => `синхронізовано о ${time}`,
    walletList: 'список твого гаманця',
    keptOnDevice: 'Зберігається на цьому пристрої',
    walletListTitle: 'Список твого гаманця',
    notLoaded: 'Не завантажено',
    loading: 'Завантаження',
    loadingA11y: 'Завантажуємо ринки',
    watchEmpty: 'Твій список спостереження порожній',
    watchEmptyLine: 'Познач актив зірочкою — і він залишиться тут.',
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
    partial: 'Неповний список',
    notListed: (count) =>
      `${count} ${ukCount(count, 'актив не торгується', 'активи не торгуються', 'активів не торгуються')} на майданчику`,
    refreshFailed: 'Не оновилося · показано останнє прочитане',
    back: 'Назад',
    searching: 'Шукаємо',
    searchIdle: 'Пошук на всіх ринках',
    searchIdleLine: 'Компанія, тікер або токен',
    searchDown: 'Пошук не відповів',
    searchNeedsNetwork: 'Пошуку потрібна мережа.',
    searchDownLine: 'Пошук зараз не відповідає. Спробуй ще раз за мить.',
    nothingFound: 'Нічого не знайдено',
    noAnswer: (query) => `Жоден ринок не відповідає на «${query}».`,
    results: (count) => `${count} ${ukCount(count, 'результат', 'результати', 'результатів')}`,
    catalogueDown: 'Пошук у каталозі недоступний',
    staleMark: 'Застаріло',
    noMarkets: 'Ринки не завантажилися',
    catalogueSilent: 'Каталог не відповів.',
  },
}
