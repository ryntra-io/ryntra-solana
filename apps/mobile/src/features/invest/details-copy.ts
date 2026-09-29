import type { Copy } from '../../lib/i18n.ts'

/**
 * Every word under a company's or a coin's «Деталі» (M22): the technical head,
 * the issuer's figures, the venue's figures, the pool's chart, the quote for
 * an amount and «Факти за цифрами» — what «Профі» drew on the page, a tap
 * deeper for everyone since one version (canon v5.3 В28). The words are the
 * web's own for the same figures (its stock surface `stock-model.ts`, its Spot
 * market header and stock context); the Ukrainian speaks «ти» and names a
 * figure in Ukrainian — the venue, the issuer and the chain keep their names.
 */
/** The venue's three categories, the ones with words of their own. */
export type AssetCategory = 'stock' | 'crypto' | 'meme'

export function isAssetCategory(value: string | null | undefined): value is AssetCategory {
  return value === 'stock' || value === 'crypto' || value === 'meme'
}

export type DetailsCopy = Readonly<{
  /* the technical head */
  tokenPrice: (time: string, age: string) => string
  stale: string
  refreshFailed: string
  categories: Readonly<Record<AssetCategory, string>>
  unverified: string
  flaggedByVenue: string
  /* the issuer's figures */
  issuerDown: string
  issuerRetry: string
  tryAgain: string
  loadingIssuer: string
  notConfirmed: string
  notConfirmedLine: string
  referencePerShare: string
  unavailable: string
  deviation: string
  versus: (label: string) => string
  haltedByIssuer: string
  unitsDiffer: string
  unitsChange: (time: string) => string
  perShare: (price: string) => string
  /* the venue's figures */
  volume24h: string
  liquidity: string
  marketCap: string
  holders: string
  /* the pool's chart */
  chart: string
  timeframes: Readonly<Record<'5m' | '1h' | '4h' | '1d', Readonly<{ label: string; a11y: string }>>>
  chartNone: string
  chartNoConnection: string
  chartBusy: string
  chartNeedsNetwork: string
  chartBusyLine: string
  chartRetry: string
  loadingChart: string
  inPool: (usd: string) => string
  chartStale: string
  chartRefreshFailed: string
  /* the quote for an amount */
  quoteTitle: string
  buy: string
  sell: string
  ownAmount: string
  yourAmount: string
  yourAmountA11y: string
  quoteThis: string
  quote: string
  quoteRange: (min: string, max: string) => string
  asking: string
  quoteDown: string
  quoteNeedsNetwork: string
  quoteDownLine: string
  receiveFor: (usd: string) => string
  giveFor: (usd: string) => string
  perShareRow: string
  referenceDetail: (price: string, state: string) => string
  noReference: string
  priceImpact: string
  feeInQuote: string
  units: string
  quotedAt: (time: string, source: string) => string
  quoteRefreshFailed: string
  examples: string
  /* «Факти за цифрами» */
  researchTitle: (symbol: string) => string
  asOf: (time: string) => string
  sectionMarket: string
  sectionIssuer: string
  sectionOnchain: string
  sectionLinks: string
  category: string
  researchCategories: Readonly<Record<AssetCategory, string>>
  verifiedByVenue: string
  yes: string
  no: string
  organicScore: string
  /** The venue's own word for the score, said in the language — an unknown word is shown as the venue wrote it. */
  organicLabel: (label: string) => string
  topHolders: string
  shareOfSupply: string
  mintAuthority: string
  freezeAuthority: string
  authorityOff: string
  authorityOn: string
  firstPool: string
  change1h: string
  trades24h: string
  buysSells: (buys: string, sells: string) => string
  traders: (count: string) => string
  fullyDiluted: (usd: string) => string
  issuer: string
  underlying: string
  exchange: string
  confirmedBy: string
  issuerCatalogue: string
  venueTagOnly: string
  reference: string
  noIssuerReference: string
  session: string
  nextChange: (time: string) => string
  chainIssuerAgree: string
  chainIssuerDiffer: string
  fromChain: string
  reserves: string
  sharesHeld: (count: string) => string
  reservesDetail: (tokens: string, custodians: string, time: string) => string
  notAttested: string
  tokenAddress: string
  program: string
  decimals: string
  supply: string
  slot: (slot: string, time: string) => string
  none: string
  pool: string
  website: string
  opensInBrowser: (label: string) => string
  sources: (issuer: string | null) => string
}>

export const DETAILS_COPY: Copy<DetailsCopy> = {
  en: {
    tokenPrice: (time, age) => `Token price · ${time} · ${age} · 24h`,
    stale: 'Stale',
    refreshFailed: 'Refresh failed',
    categories: { stock: 'Stock', crypto: 'Crypto', meme: 'Meme' },
    unverified: 'Unverified',
    flaggedByVenue: 'Flagged by the venue',
    issuerDown: 'Issuer figures unavailable',
    issuerRetry: 'Try the issuer’s figures again',
    tryAgain: 'Try again',
    loadingIssuer: 'Loading the issuer’s figures',
    notConfirmed: 'Not a confirmed stock',
    notConfirmedLine: 'No issuer names this token. Its figures are the venue’s only.',
    referencePerShare: 'Reference per share',
    unavailable: 'Unavailable',
    deviation: 'Deviation',
    versus: (label) => `vs ${label}`,
    haltedByIssuer: 'Halted by the issuer',
    unitsDiffer: 'Units differ on chain',
    unitsChange: (time) => `Units change at ${time}`,
    perShare: (price) => `${price} per share`,
    volume24h: 'Volume 24h',
    liquidity: 'Liquidity',
    marketCap: 'Market cap',
    holders: 'Holders',
    chart: 'Chart',
    timeframes: {
      '5m': { label: '5m', a11y: 'Five-minute bars' },
      '1h': { label: '1h', a11y: 'Hourly bars' },
      '4h': { label: '4h', a11y: 'Four-hour bars' },
      '1d': { label: '1d', a11y: 'Daily bars' },
    },
    chartNone: 'No chart for this market',
    chartNoConnection: 'No connection',
    chartBusy: 'The chart source is busy',
    chartNeedsNetwork: 'The chart needs the network.',
    chartBusyLine: 'The chart source is not answering right now.',
    chartRetry: 'Try the chart again',
    loadingChart: 'Loading the chart',
    inPool: (usd) => `${usd} in pool`,
    chartStale: 'Stale',
    chartRefreshFailed: 'Refresh failed · last read',
    quoteTitle: 'Quote for an amount',
    buy: 'Buy',
    sell: 'Sell',
    ownAmount: 'Own amount',
    yourAmount: 'Your amount',
    yourAmountA11y: 'Your amount in dollars',
    quoteThis: 'Quote this amount',
    quote: 'Quote',
    quoteRange: (min, max) => `From ${min} to ${max}.`,
    asking: 'Asking for the quote',
    quoteDown: 'The quote is unavailable.',
    quoteNeedsNetwork: 'The quote needs the network.',
    quoteDownLine: 'The quote is not answering right now.',
    receiveFor: (usd) => `you receive for ${usd}`,
    giveFor: (usd) => `you give for ${usd}`,
    perShareRow: 'Per share',
    referenceDetail: (price, state) => `reference ${price} · ${state}`,
    noReference: 'no reference',
    priceImpact: 'Price impact',
    feeInQuote: 'Fee in the quote',
    units: 'Units',
    quotedAt: (time, source) => `Quoted ${time} · ${source}`,
    quoteRefreshFailed: 'Refresh failed · last quote shown',
    examples: 'Example amounts for orientation. Trade quotes your real amount again before you sign.',
    researchTitle: (symbol) => `Research · ${symbol}`,
    asOf: (time) => `As of ${time}`,
    sectionMarket: 'Market',
    sectionIssuer: 'Issuer',
    sectionOnchain: 'Onchain',
    sectionLinks: 'Links',
    category: 'Category',
    researchCategories: { stock: 'Tokenized stock', crypto: 'Crypto', meme: 'Meme' },
    verifiedByVenue: 'Verified by the venue',
    yes: 'Yes',
    no: 'No',
    organicScore: 'Organic score',
    organicLabel: (label) => label,
    topHolders: 'Top holders',
    shareOfSupply: 'share of supply',
    mintAuthority: 'Mint authority',
    freezeAuthority: 'Freeze authority',
    authorityOff: 'Disabled',
    authorityOn: 'Active',
    firstPool: 'First pool',
    change1h: '1h change',
    trades24h: '24h trades',
    buysSells: (buys, sells) => `${buys} buys · ${sells} sells`,
    traders: (count) => `${count} traders`,
    fullyDiluted: (usd) => `FDV ${usd}`,
    issuer: 'Issuer',
    underlying: 'Underlying',
    exchange: 'Exchange',
    confirmedBy: 'Confirmed by',
    issuerCatalogue: 'The issuer’s catalogue',
    venueTagOnly: 'The venue’s tag only',
    reference: 'Reference',
    noIssuerReference: 'no issuer reference',
    session: 'Session',
    nextChange: (time) => `next change ${time}`,
    chainIssuerAgree: 'chain and issuer agree',
    chainIssuerDiffer: 'chain and issuer differ',
    fromChain: 'from the chain',
    reserves: 'Reserves',
    sharesHeld: (count) => `${count} shares held`,
    reservesDetail: (tokens, custodians, time) => `${tokens} tokens · ${custodians} · ${time}`,
    notAttested: 'not attested by the issuer',
    tokenAddress: 'Mint',
    program: 'Program',
    decimals: 'Decimals',
    supply: 'Supply',
    slot: (slot, time) => `slot ${slot} · ${time}`,
    none: 'None',
    pool: 'Pool',
    website: 'Website',
    opensInBrowser: (label) => `${label}, opens in the browser`,
    sources: (issuer) =>
      `Token figures and audit — Jupiter${issuer ? ` · reference, session and reserves — ${issuer}` : ''} · chain — Solana mainnet · chart — GeckoTerminal. Not advice; who may hold a token is the issuer’s rule.`,
  },
  uk: {
    tokenPrice: (time, age) => `Ціна токена · ${time} · ${age} · 24 год`,
    stale: 'Застаріло',
    refreshFailed: 'Не оновилося',
    categories: { stock: 'Акція', crypto: 'Крипта', meme: 'Мем' },
    unverified: 'Не підтверджено',
    flaggedByVenue: 'Позначено майданчиком',
    issuerDown: 'Цифри емітента недоступні',
    issuerRetry: 'Ще раз прочитати цифри емітента',
    tryAgain: 'Спробувати ще',
    loadingIssuer: 'Завантажуємо цифри емітента',
    notConfirmed: 'Не підтверджена акція',
    notConfirmedLine: 'Жоден емітент не називає цей токен. Його цифри — лише майданчика.',
    referencePerShare: 'Референс за акцію',
    unavailable: 'Недоступно',
    deviation: 'Відхилення',
    versus: (label) => `проти ${label}`,
    haltedByIssuer: 'Торги зупинив емітент',
    unitsDiffer: 'Одиниці в мережі розходяться',
    unitsChange: (time) => `Одиниці зміняться о ${time}`,
    perShare: (price) => `${price} за акцію`,
    volume24h: 'Обсяг за 24 год',
    liquidity: 'Ліквідність',
    marketCap: 'Капіталізація',
    holders: 'Власники',
    chart: 'Графік',
    timeframes: {
      '5m': { label: '5 хв', a11y: 'Свічки по п’ять хвилин' },
      '1h': { label: '1 год', a11y: 'Погодинні свічки' },
      '4h': { label: '4 год', a11y: 'Свічки по чотири години' },
      '1d': { label: '1 д', a11y: 'Денні свічки' },
    },
    chartNone: 'Для цього ринку графіка немає',
    chartNoConnection: 'Немає з’єднання',
    chartBusy: 'Джерело графіка зайняте',
    chartNeedsNetwork: 'Графіку потрібна мережа.',
    chartBusyLine: 'Джерело графіка зараз не відповідає.',
    chartRetry: 'Ще раз завантажити графік',
    loadingChart: 'Завантажуємо графік',
    inPool: (usd) => `${usd} у пулі`,
    chartStale: 'Застаріло',
    chartRefreshFailed: 'Не оновилося · останнє прочитане',
    quoteTitle: 'Котирування для суми',
    buy: 'Купити',
    sell: 'Продати',
    ownAmount: 'Своя сума',
    yourAmount: 'Твоя сума',
    yourAmountA11y: 'Твоя сума в доларах',
    quoteThis: 'Котирувати цю суму',
    quote: 'Котирувати',
    quoteRange: (min, max) => `Від ${min} до ${max}.`,
    asking: 'Питаємо котирування',
    quoteDown: 'Котирування недоступне.',
    quoteNeedsNetwork: 'Котируванню потрібна мережа.',
    quoteDownLine: 'Котирування зараз не відповідає.',
    receiveFor: (usd) => `отримаєш за ${usd}`,
    giveFor: (usd) => `віддаси за ${usd}`,
    perShareRow: 'За акцію',
    referenceDetail: (price, state) => `референс ${price} · ${state}`,
    noReference: 'без референсу',
    priceImpact: 'Вплив на ціну',
    feeInQuote: 'Комісія в котируванні',
    units: 'Одиниці',
    quotedAt: (time, source) => `Котирування о ${time} · ${source}`,
    quoteRefreshFailed: 'Не оновилося · показано останнє котирування',
    examples: 'Приклади сум для орієнтації. Торгівля котирує твою реальну суму заново перед підписом.',
    researchTitle: (symbol) => `Факти · ${symbol}`,
    asOf: (time) => `Станом на ${time}`,
    sectionMarket: 'Ринок',
    sectionIssuer: 'Емітент',
    sectionOnchain: 'У мережі',
    sectionLinks: 'Посилання',
    category: 'Категорія',
    researchCategories: { stock: 'Токенізована акція', crypto: 'Крипта', meme: 'Мем' },
    verifiedByVenue: 'Перевірено майданчиком',
    yes: 'Так',
    no: 'Ні',
    organicScore: 'Органічний бал',
    organicLabel: (label) =>
      (({ high: 'високий', medium: 'середній', low: 'низький' }) as Readonly<Record<string, string>>)[
        label.toLowerCase()
      ] ?? label,
    topHolders: 'Топ-власники',
    shareOfSupply: 'частка емісії',
    mintAuthority: 'Право випуску',
    freezeAuthority: 'Право заморозки',
    authorityOff: 'Вимкнено',
    authorityOn: 'Активне',
    firstPool: 'Перший пул',
    change1h: 'Зміна за 1 год',
    trades24h: 'Угоди за 24 год',
    buysSells: (buys, sells) => `купівлі: ${buys} · продажі: ${sells}`,
    traders: (count) => `трейдери: ${count}`,
    fullyDiluted: (usd) => `за повної емісії ${usd}`,
    issuer: 'Емітент',
    underlying: 'Базовий актив',
    exchange: 'Біржа',
    confirmedBy: 'Підтверджено',
    issuerCatalogue: 'Каталогом емітента',
    venueTagOnly: 'Лише тегом майданчика',
    reference: 'Референс',
    noIssuerReference: 'референсу емітента немає',
    session: 'Сесія',
    nextChange: (time) => `наступна зміна о ${time}`,
    chainIssuerAgree: 'мережа й емітент збігаються',
    chainIssuerDiffer: 'мережа й емітент розходяться',
    fromChain: 'з мережі',
    reserves: 'Резерви',
    sharesHeld: (count) => `акцій: ${count}`,
    reservesDetail: (tokens, custodians, time) => `токенів: ${tokens} · ${custodians} · ${time}`,
    notAttested: 'емітент не засвідчив',
    tokenAddress: 'Адреса токена',
    program: 'Програма',
    decimals: 'Десяткові знаки',
    supply: 'Емісія',
    slot: (slot, time) => `слот ${slot} · ${time}`,
    none: 'Немає',
    pool: 'Пул',
    website: 'Сайт',
    opensInBrowser: (label) => `${label}, відкриється в браузері`,
    sources: (issuer) =>
      `Цифри й аудит токена — Jupiter${issuer ? ` · референс, сесія й резерви — ${issuer}` : ''} · ланцюг — основна мережа Solana · графік — GeckoTerminal. Не порада; хто може тримати токен, визначає емітент.`,
  },
}
