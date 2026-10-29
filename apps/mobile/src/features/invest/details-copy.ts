import type { Copy } from '../../lib/i18n.ts'

/**
 * Every word under a company's or a coin's «Деталі»: the technical head,
 * the issuer's figures, the venue's figures, the pool's chart, the quote for
 * an amount and «Факти за цифрами» — what «Профі» drew on the page, a tap
 * deeper for everyone since one version. The words are the
 * web's own for the same figures (its stock surface `stock-model.ts`, its Spot
 * market header and stock context); the Ukrainian speaks «ти» and names a
 * figure in Ukrainian — the venue, the issuer and the chain keep their names.
 */
/** «акції» after a fraction, «акція · акції · акцій» after a whole count — the Ukrainian noun after a number. */
function ukShares(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'акції'
  const rounded = Number(value.toFixed(4))
  if (!Number.isInteger(rounded)) return 'акції'
  const ten = rounded % 10
  const hundred = rounded % 100
  if (ten === 1 && hundred !== 11) return 'акція'
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'акції'
  return 'акцій'
}

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
  flaggedByAudit: string
  /* the issuer's figures */
  issuerDown: string
  issuerRetry: string
  tryAgain: string
  loadingIssuer: string
  notConfirmed: string
  notConfirmedLine: string
  referencePerShare: string
  unavailable: string
  /**
   * Two distances on one page, named apart (ST-5 r8): the token's own price against the share — the issuer's list basis
   * — and the price a quote for an amount executes at against it.
   */
  tokenVsShare: string
  executionVsShare: string
  /** «референс xStocks» — whose reference the token's price stands against. */
  referenceBy: (label: string) => string
  haltedByIssuer: string
  unitsDiffer: string
  unitsChange: (time: string) => string
  perShare: (price: string) => string
  /* the venue's figures */
  volume24h: string
  liquidity: string
  marketCap: string
  /** A stock token's own market cap — the token's value on the chain, never the company's (ST-5 r7). */
  tokenMarketCap: string
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
  /**
   * The shares the quoted tokens stand for, beside the tokens a person actually receives (ST-5 r10: «≈ 4,558 NVDAx
   * (4,566 акції)», never the share count under the token's name): the figure as written, its value for the noun.
   */
  sharesBeside: (figure: string, value: number) => string
  perShareRow: string
  referenceDetail: (price: string, state: string) => string
  noReference: string
  priceImpact: string
  /**
   * A quote whose price for the share stands far from the reference (ST-5 r7): the distance is the figure that matters,
   * said over the rows — the price impact is then no cost to read and is not shown.
   */
  quoteFar: (pct: string, above: boolean) => string
  feeInQuote: string
  units: string
  quotedAt: (time: string, source: string) => string
  quoteRefreshFailed: string
  /* «Факти за цифрами» */
  /** The sheet's title, its door's own words. */
  researchTitle: string
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
  /** New tokens can still be minted — «Можливий». */
  mintOn: string
  /** The token can still be frozen in a wallet — «Можлива». */
  freezeOn: string
  /** Behind «?»: the address the chain records as able to mint, in full. */
  mintBy: (address: string) => string
  /** Behind «?»: the address the chain records as able to freeze, in full. */
  freezeBy: (address: string) => string
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
  copyAddress: string
  copied: string
  supply: string
  /** Behind «?» by the supply: what the supply, the reserves and the backing each count. */
  supplyHelpTitle: string
  supplyHelp: string
  /** Said with the supply's «?» where the issuer reports reserves. */
  reservesHelp: string
  none: string
  pool: string
  website: string
  opensInBrowser: (label: string) => string
  sources: (issuer: string | null) => string
}>

export const DETAILS_COPY: Copy<DetailsCopy> = {
  en: {
    tokenPrice: (time, age) => `${time} · ${age} · 24h`,
    stale: 'Stale',
    refreshFailed: 'Refresh failed',
    categories: { stock: 'Stock', crypto: 'Crypto', meme: 'Meme' },
    unverified: 'Unverified',
    flaggedByAudit: 'Flagged by Jupiter',
    issuerDown: 'Issuer figures unavailable',
    issuerRetry: 'Try the issuer’s figures again',
    tryAgain: 'Try again',
    loadingIssuer: 'Loading the issuer’s figures',
    notConfirmed: 'Not a confirmed stock',
    notConfirmedLine: 'No issuer names this token.',
    referencePerShare: 'Reference per share',
    unavailable: 'Unavailable',
    tokenVsShare: 'Token price vs the share',
    executionVsShare: 'Execution price vs the share',
    referenceBy: (label) => `${label} reference`,
    haltedByIssuer: 'Halted by the issuer',
    unitsDiffer: 'Units differ on chain',
    unitsChange: (time) => `Units change at ${time}`,
    perShare: (price) => `${price} per share`,
    volume24h: 'Volume 24h',
    liquidity: 'Liquidity',
    marketCap: 'Market cap',
    tokenMarketCap: 'Token market cap',
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
    sharesBeside: (figure, value) =>
      `(${figure} ${value < 1 ? 'of a share' : Math.abs(value - 1) < 1e-9 ? 'share' : 'shares'})`,
    perShareRow: 'Per share',
    referenceDetail: (price, state) => `reference ${price} · ${state}`,
    noReference: 'no reference',
    priceImpact: 'Price impact',
    quoteFar: (pct, above) => `For this sum the price is ${pct} ${above ? 'above' : 'below'} the share`,
    feeInQuote: 'Fee in the quote',
    units: 'Units',
    quotedAt: (time, source) => `Quoted ${time} · ${source}`,
    quoteRefreshFailed: 'Refresh failed · last quote shown',
    researchTitle: 'The facts behind the figures',
    asOf: (time) => `As of ${time}`,
    sectionMarket: 'Market',
    sectionIssuer: 'Issuer',
    sectionOnchain: 'On Solana',
    sectionLinks: 'Links',
    category: 'Category',
    researchCategories: { stock: 'Tokenized stock', crypto: 'Crypto', meme: 'Meme' },
    verifiedByVenue: 'Verified by Jupiter',
    yes: 'Yes',
    no: 'No',
    organicScore: 'Organic score',
    organicLabel: (label) => label,
    topHolders: 'Top holders',
    shareOfSupply: 'share of supply',
    mintAuthority: 'New tokens',
    freezeAuthority: 'Freezing',
    authorityOff: 'Off',
    mintOn: 'Possible',
    freezeOn: 'Possible',
    mintBy: (address) => `The chain records this address as able to mint new tokens: ${address}`,
    freezeBy: (address) => `The chain records this address as able to freeze the token in any wallet: ${address}`,
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
    venueTagOnly: 'Jupiter’s tag only',
    reference: 'Reference',
    noIssuerReference: 'no issuer reference',
    session: 'Session',
    nextChange: (time) => `next change at ${time}, your time`,
    chainIssuerAgree: 'chain and issuer agree',
    chainIssuerDiffer: 'chain and issuer differ',
    fromChain: 'from the chain',
    reserves: 'Reserves',
    sharesHeld: (count) => `${count} shares held`,
    reservesDetail: (tokens, custodians, time) => `${tokens} tokens · ${custodians} · ${time}`,
    notAttested: 'not attested by the issuer',
    tokenAddress: 'Token address',
    copyAddress: 'Copy the address',
    copied: 'Address copied',
    supply: 'Supply',
    supplyHelpTitle: 'Supply and reserves',
    supplyHelp: 'Supply: every token at this address on Solana, as the chain counts it.',
    reservesHelp:
      'Reserves: the shares the custodian holds, as the issuer reports them, against the tokens in circulation the issuer counts (the line under Reserves); backing is those shares divided by those tokens. The chain’s supply and the issuer’s tokens in circulation come from different sources and moments; the data does not say why they differ.',
    none: 'None',
    pool: 'Pool',
    website: 'Website',
    opensInBrowser: (label) => `${label}, opens in the browser`,
    sources: (issuer) =>
      `Token figures and audit — Jupiter${issuer ? ` · reference, session and reserves — ${issuer}` : ''} · chain — Solana mainnet · chart — GeckoTerminal. Not advice; who may hold a token is the issuer’s rule.`,
  },
  uk: {
    tokenPrice: (time, age) => `${time} · ${age} · 24 год`,
    stale: 'Застаріло',
    refreshFailed: 'Не оновилося',
    categories: { stock: 'Акція', crypto: 'Крипта', meme: 'Мем' },
    unverified: 'Не підтверджено',
    flaggedByAudit: 'Позначено Jupiter',
    issuerDown: 'Цифри емітента недоступні',
    issuerRetry: 'Ще раз прочитати цифри емітента',
    tryAgain: 'Спробувати ще',
    loadingIssuer: 'Завантажуємо цифри емітента',
    notConfirmed: 'Не підтверджена акція',
    notConfirmedLine: 'Жоден емітент не називає цей токен.',
    referencePerShare: 'Референс за акцію',
    unavailable: 'Недоступно',
    tokenVsShare: 'Ціна токена проти акції',
    executionVsShare: 'Ціна виконання проти акції',
    referenceBy: (label) => `референс ${label}`,
    haltedByIssuer: 'Торги зупинив емітент',
    unitsDiffer: 'Одиниці в мережі розходяться',
    unitsChange: (time) => `Одиниці зміняться о ${time}`,
    perShare: (price) => `${price} за акцію`,
    volume24h: 'Обсяг за 24 год',
    liquidity: 'Ліквідність',
    marketCap: 'Капіталізація',
    tokenMarketCap: 'Капіталізація токена',
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
    chartNeedsNetwork: 'Графіку потрібен інтернет.',
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
    quoteNeedsNetwork: 'Котируванню потрібен інтернет.',
    quoteDownLine: 'Котирування зараз не відповідає.',
    receiveFor: (usd) => `отримаєш за ${usd}`,
    giveFor: (usd) => `віддаси за ${usd}`,
    sharesBeside: (figure, value) => `(${figure} ${ukShares(value)})`,
    perShareRow: 'За акцію',
    referenceDetail: (price, state) => `референс ${price} · ${state}`,
    noReference: 'без референсу',
    priceImpact: 'Вплив на ціну',
    quoteFar: (pct, above) => `За цю суму ціна на ${pct} ${above ? 'вища' : 'нижча'} за акцію`,
    feeInQuote: 'Комісія в котируванні',
    units: 'Одиниці',
    quotedAt: (time, source) => `Котирування о ${time} · ${source}`,
    quoteRefreshFailed: 'Не оновилося · показано останнє котирування',
    researchTitle: 'Факти за цифрами',
    asOf: (time) => `Станом на ${time}`,
    sectionMarket: 'Ринок',
    sectionIssuer: 'Емітент',
    sectionOnchain: 'У мережі Solana',
    sectionLinks: 'Посилання',
    category: 'Категорія',
    researchCategories: { stock: 'Токенізована акція', crypto: 'Крипта', meme: 'Мем' },
    verifiedByVenue: 'Перевірено Jupiter',
    yes: 'Так',
    no: 'Ні',
    organicScore: 'Органічний бал',
    organicLabel: (label) =>
      (({ high: 'високий', medium: 'середній', low: 'низький' }) as Readonly<Record<string, string>>)[
        label.toLowerCase()
      ] ?? label,
    topHolders: 'Топ-власники',
    shareOfSupply: 'частка емісії',
    mintAuthority: 'Випуск нових токенів',
    freezeAuthority: 'Заморозка токенів',
    authorityOff: 'Вимкнено',
    mintOn: 'Можливий',
    freezeOn: 'Можлива',
    mintBy: (address) => `Мережа записує цю адресу як ту, що може випускати нові токени: ${address}`,
    freezeBy: (address) => `Мережа записує цю адресу як ту, що може заморозити токен у будь-якому гаманці: ${address}`,
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
    venueTagOnly: 'Лише тегом Jupiter',
    reference: 'Референс',
    noIssuerReference: 'референсу емітента немає',
    session: 'Сесія',
    nextChange: (time) => `наступна зміна о ${time} за твоїм часом`,
    chainIssuerAgree: 'мережа й емітент збігаються',
    chainIssuerDiffer: 'мережа й емітент розходяться',
    fromChain: 'з мережі',
    reserves: 'Резерви',
    sharesHeld: (count) => `акцій: ${count}`,
    reservesDetail: (tokens, custodians, time) => `токенів: ${tokens} · ${custodians} · ${time}`,
    notAttested: 'емітент не засвідчив',
    tokenAddress: 'Адреса токена',
    copyAddress: 'Скопіювати адресу',
    copied: 'Адресу скопійовано',
    supply: 'Емісія',
    supplyHelpTitle: 'Емісія і резерви',
    supplyHelp: 'Емісія — усі токени за цією адресою в мережі Solana, як їх рахує мережа.',
    reservesHelp:
      'Резерви — акції, які, за звітом емітента, тримає зберігач, проти токенів в обігу, які рахує емітент (рядок під «Резерви»); забезпечення — ці акції, поділені на ці токени. Емісія в мережі й токени в обігу за емітентом — з різних джерел і на різний час; чому вони різняться, дані не кажуть.',
    none: 'Немає',
    pool: 'Пул',
    website: 'Сайт',
    opensInBrowser: (label) => `${label}, відкриється в браузері`,
    sources: (issuer) =>
      `Цифри й аудит токена — Jupiter${issuer ? ` · референс, сесія й резерви — ${issuer}` : ''} · ланцюг — основна мережа Solana · графік — GeckoTerminal. Не порада; хто може тримати токен, визначає емітент.`,
  },
}
