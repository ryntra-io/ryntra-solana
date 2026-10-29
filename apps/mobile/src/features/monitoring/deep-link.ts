/**
 * The one place a link from outside becomes a place inside the app.
 *
 * Notes arrive with the web's own hrefs — a push carries
 * `https://ryntra.io/app/alerts/open?n=<id>`, the surface's cards and notes
 * carry `/app/alerts/open?n=<id>`, the web resolves those to
 * `/app/strategies/plans/<id>?from=monitoring`. Every one of them is parsed
 * here and nowhere else. What the app owns opens natively; what it does not
 * own (a paper prediction plan until its row lands) goes to the web through
 * the resolver screen, which says so; anything unknown fails safe at the
 * root. No link carries authorization: the exact plan opens and its own
 * Review reads today's figures.
 *
 * Ryntra's handoffs are the same web paths — the builder, the Spot
 * ticket, an asset, Portfolio, History, Results — and pass through here
 * too, so a handoff and a shared link land on the same screen. A handoff
 * opens a place, never an action: Trade takes its own fresh quote and
 * Review, the builder saves nothing until the person saves. A sum a link
 * names (a ticket's amount, a builder's budget) is carried only for a
 * handoff the app itself received from Ryntra, where the person wrote it; a
 * link from outside opens the same place without a figure nobody typed.
 */

import { contextParam, parseContextParam } from '../agent/context.ts'
import { cityPathOf, cityRouteOf } from '../city/city-page.ts'
import { isInstant, isRuleId } from '../autoinvest/rule-model.ts'
import { askedScreenerTab, marketsPath, type ScreenerTab } from '../markets/screener.ts'
import {
  BOTS_CATALOG_PATH,
  BOTS_PATH,
  MONEY_PATH,
  PREDICTIONS_LIVE,
  PREDICTIONS_MONEY_PATH,
  PREDICTIONS_PATH,
} from '../shell/places.ts'
import {
  HOME_PATH,
  LEGACY_TAB_ROUTES,
  ORDERS_PATH,
  PORTFOLIO_HISTORY_PATH,
  PORTFOLIO_PATH,
  SWAP_PATH,
  TRADE_PATH,
} from '../shell/shell.ts'
import { BUDGET_EDIT_PATH } from './monitoring-model.ts'

const NOTE = /^(inb_|mon_)[0-9a-f]{24}$/
/** A company's symbol as a reminder's link names it. */
const SYMBOL = /^[A-Za-z0-9._-]{1,32}$/
const DEV_CLIENT = /^[a-z][a-z0-9+.-]*:\/\/expo-development-client(?:[/?#]|$)/i
const PLAN = /^plan_[0-9a-f]{32}$/
/** A limit order's id as the server names it. */
const ORDER = /^[A-Za-z0-9_-]{1,64}$/
const RULE = /^rule_[0-9a-f]{32}$/
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
/** A Phoenix market's symbol, as the futures route reads it (`features/futures/futures-model.ts`). */
const FUTURES_MARKET = /^[A-Za-z0-9]{1,20}$/
/** An event of «Прогнози», as the Predictions routes name one (`features/predictions/predictions-model.ts`). */
const PREDICTION_EVENT = /^[A-Za-z0-9_-]{1,64}$/
const DRAFT = /^agd_[0-9a-f]{24}$/
/** A token watch of the assistant (1.57.0), or `all` — «Стежу» alone. */
const WATCH = /^(wch_[0-9a-f]{24}|all)$/
/** A «Доручення» of the assistant (1.59.0). */
const TASK = /^t_[0-9a-f]{12}$/
/** A trade plan Ryntra composed with the person (1.61.0). */
const ASSISTANT_PLAN = /^[A-Za-z0-9_-]{3,80}$/
/** A credits order of the assistant (1.54.0): «Кредити» with its state. */
const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/
/** A morning brief's day, or `latest` — the newest. */
const BRIEF_DAY = /^(\d{4}-\d{2}-\d{2}|latest)$/
/** The assistant's tabs (AI-06): Розмова · Стежу · Плани · Огляди · Кредити. */
const ASSISTANT_TABS: ReadonlySet<string> = new Set(['chat', 'watch', 'plans', 'brief', 'credits'])
const VERSION = /^[1-9][0-9]{0,3}$/
/** A plain positive decimal, up to nine whole digits and six places — the web ticket's own shape for a sum. */
const SUM = /^\d{1,9}(\.\d{1,6})?$/
/** `metric:window:operator:threshold` — the market rule a Ryntra draft or an analysis card carries into the builder. */
const EVIDENCE = /^[a-z0-9_]{1,64}:(24h|7d|now):(gt|gte|lt|lte):-?\d{1,15}(\.\d{1,6})?$/
const QUESTION_MAX = 2000

/** The app's own routes a link may name directly — left as they are. */
const NATIVE_PATHS =
  /^\/(?:\(tabs\)(?:\/|$)|trade(?:\?|$)|plans\/|bots(?:\?|$)|monitoring(?:\/|$)|asset\/|token\/|futures\/[A-Za-z0-9]{1,20}(?:\?|$)|predictions\/[A-Za-z0-9_-]{1,64}(?:\?|$)|history(?:\?|$)|results(?:\?|$)|rewards(?:\?|$)|search(?:\?|$)|ryn(?:\?|$)|lens(?:\?|$)|ryn-plan\/[A-Za-z0-9_-]{3,80}(?:\?|$)|changes(?:\?|$)|settings(?:\?|$)|money\/(?:send|receive)(?:\?|$)|launch(?:\/|\?|$)|gallery(?:\?|$)|_sitemap(?:\?|$)|$)/

export type MapOptions = Readonly<{
  /** Carry the sum a link names — only for Ryntra's own handoffs, where the person wrote it (see above). */
  carrySums?: boolean
  /** Whether this build shows «Прогнози» (`PREDICTIONS_LIVE` unless a test names it). */
  predictions?: boolean
}>

export type MappedLink = Readonly<{
  /** The in-app path to open. */
  path: string
  /** Why: the phone owns it, the web must show it, or nothing matched. */
  kind: 'native' | 'web' | 'unknown'
}>

/**
 * The path and query of a link the app may receive: the site's, the app's scheme (`ryntra://`, or the development
 * build's own `ryntra-dev://`, M27), or a bare path. Null when it is none of these.
 */
export function pathOfLink(url: string): string | null {
  const trimmed = url.trim()
  const site = /^https?:\/\/(?:www\.)?ryntra\.io(\/[^#]*)?(?:#.*)?$/i.exec(trimmed)
  if (site) return site[1] && site[1].length > 0 ? site[1] : '/'
  const scheme = /^ryntra(?:-dev)?:\/\/([^#]*)(?:#.*)?$/i.exec(trimmed)
  if (scheme) {
    const rest = scheme[1] ?? ''
    return rest.startsWith('/') ? rest : `/${rest}`
  }
  if (trimmed.startsWith('/')) return trimmed.split('#')[0] ?? '/'
  return null
}

function query(path: string): URLSearchParams {
  const index = path.indexOf('?')
  return new URLSearchParams(index === -1 ? '' : path.slice(index + 1))
}

function pathname(path: string): string {
  const index = path.indexOf('?')
  return (index === -1 ? path : path.slice(0, index)).replace(/\/+$/, '') || '/'
}

/**
 * The web's monitoring paths onto the app's own. The result is a path the
 * router knows; a web path the phone has no surface for goes to the
 * resolver with the path it should open on ryntra.io.
 */
export function mapDeepLink(url: string, options: MapOptions = {}): MappedLink {
  // The development client's own launch link is handed back whole: Expo Router reads the bundle address out of it.
  if (DEV_CLIENT.test(url.trim())) return { path: url.trim(), kind: 'native' }
  const path = pathOfLink(url)
  if (path === null) return { path: '/', kind: 'unknown' }
  const name = pathname(path)
  const params = query(path)

  // The city's own links (CITY-6c): a coin's tower, `/c/<mint>`, opens «Місто» on it. The site's `/` is the app's
  // own `/`, «Місто», already.
  const city = name.startsWith('/c/') ? cityPathOf(name) : null
  if (city !== null) return { path: cityRouteOf(city), kind: 'native' }

  // A build without «Прогнози» (the second release brings them) sends every link to them to the web, never to a
  // screen it does not draw: the phone's own addresses as the web names the same place.
  const hiddenPrediction = (options.predictions ?? PREDICTIONS_LIVE) ? null : predictionOnWeb(name, params)
  if (hiddenPrediction !== null)
    return { path: `/monitoring/open?href=${encodeURIComponent(hiddenPrediction)}`, kind: 'web' }
  // The older shells' tabs — Trade, Strategies, the Agent, the bar's «+»: where they lead now, the link's own query kept.
  const legacy = (LEGACY_TAB_ROUTES as Readonly<Record<string, string>>)[name]
  if (legacy) {
    const search = params.toString()
    return { path: search ? `${legacy}?${search}` : legacy, kind: 'native' }
  }
  // A swap with no asset is «Торгівля · Обмін», its own place since M44.3; a ticket with an asset stays the sheet.
  if (name === '/trade' && params.get('mode') === 'swap' && !params.get('mint'))
    return { path: SWAP_PATH, kind: 'native' }
  // The places the new look moved (NEW-LOOK §2): Термінал, Ринки, Гроші and Мої ордери, from links, receipts and push.
  const moved = movedPlace(name, params)
  if (moved !== null) return { path: moved, kind: 'native' }
  // Markets on a list of an older shell (M2's `/lists`, the tab's `stock`, `meme`): the screener on the same assets.
  if (name === '/lists') return { path: screenerPath(params), kind: 'native' }
  // «Торгівля» on a segment (`seg`, M44.3) passes as it is; a list an older Markets named, onto the screener's chip.
  if (name === '/(tabs)/markets' && params.toString() && !params.get('seg'))
    return { path: screenerPath(params), kind: 'native' }
  // The plans live in «Боти → Мої боти» since the menu v6.2; a plan's own page stays where it was.
  if (name === '/plans') return { path: BOTS_PATH, kind: 'native' }
  if (NATIVE_PATHS.test(path)) return { path, kind: 'native' }
  // «Торгівля → Прогнози» (M12), in a build that shows them: the web's event page opens the phone's; the portfolio's
  // money, the phone's «Гроші».
  const prediction = /^\/app\/predictions\/([^/]+)$/.exec(name)
  if (prediction) {
    const id = prediction[1] ?? ''
    if (id === 'portfolio') return { path: PREDICTIONS_MONEY_PATH, kind: 'native' }
    return { path: PREDICTION_EVENT.test(id) ? `/predictions/${id}` : PREDICTIONS_PATH, kind: 'native' }
  }

  if (name === '/app/alerts/open') {
    const n = params.get('n') ?? ''
    return NOTE.test(n) ? { path: `/monitoring/open?n=${n}`, kind: 'native' } : { path: '/monitoring', kind: 'native' }
  }
  if (name === '/app/alerts') return { path: '/monitoring', kind: 'native' }

  const plan = /^\/app\/strategies\/plans\/([^/]+)$/.exec(name)
  if (plan) {
    const id = plan[1] ?? ''
    if (!PLAN.test(id)) return { path: BOTS_PATH, kind: 'native' }
    return {
      path: params.get('from') === 'monitoring' ? `/plans/${id}?from=monitoring` : `/plans/${id}`,
      kind: 'native',
    }
  }
  if (name === '/app/strategies' || name === '/app/strategies/plans') return { path: BOTS_PATH, kind: 'native' }

  // A trade plan Ryntra composed with the person: its own page on the phone (1.61.0).
  const assistantPlan = /^\/app\/ryn\/plans\/([^/]+)$/.exec(name)
  if (assistantPlan) {
    const id = assistantPlan[1] ?? ''
    return { path: ASSISTANT_PLAN.test(id) ? `/ryn-plan/${id}` : '/ryn?tab=plans', kind: 'native' }
  }
  // A followed wallet's trade (1.63.0, SOL-R4): the phone has no «Гаманці», so the note itself opens, with its words.
  if (name === '/app/markets' && params.get('tab') === 'wallets') {
    const wallet = params.get('wallet')
    return { path: wallet && MINT.test(wallet) ? `/monitoring/open?wallet=${wallet}` : '/monitoring', kind: 'native' }
  }

  const ryn = agentPathOf(name, params, options)
  if (ryn !== null) return { path: ryn, kind: 'native' }

  if (name.startsWith('/app/')) {
    // Owned on the web only (a paper prediction plan, settings): the resolver opens ryntra.io and says so.
    return { path: `/monitoring/open?href=${encodeURIComponent(path)}`, kind: 'web' }
  }
  return { path: '/', kind: 'unknown' }
}

/** The addresses of «Торгівля» a link may carry `?seg=` on: the place's own, its older tab and the moved Markets. */
const TRADE_PLACE_NAMES: ReadonlySet<string> = new Set([TRADE_PATH, '/(tabs)/trade', '/trade', '/markets'])

/**
 * The web's address of a link to «Прогнози» — the web's own `/app/predictions…`, the phone's `/predictions/<event>`
 * and `/predictions/money`, and «Торгівля» on `?seg=predictions`, named as the web names them with the link's query
 * kept; null for a link to anything else.
 */
function predictionOnWeb(name: string, params: URLSearchParams): string | null {
  const search = params.toString()
  const kept = (web: string) => (search ? `${web}?${search}` : web)
  if (name === '/app/predictions' || name.startsWith('/app/predictions/')) return kept(name)
  const own = /^\/predictions\/([^/]+)$/.exec(name)
  if (own) {
    const id = own[1] ?? ''
    if (id === 'money') return kept('/app/predictions/portfolio')
    return kept(PREDICTION_EVENT.test(id) ? `/app/predictions/${id}` : '/app/predictions')
  }
  if (TRADE_PLACE_NAMES.has(name) && params.get('seg') === 'predictions') return '/app/predictions'
  return null
}

/**
 * Where an address of a place the new look moved now leads (NEW-LOOK §2): «Термінал» is «Торгівля» on Ринки — with
 * `side=sell` the ticket's sale, the link's own query kept; `/markets` is «Торгівля · Ринки» on the tab it names;
 * «Гроші» is the bar's «Гроші» (`open=top-up` kept); «Мої ордери» open over «Портфель», the order a note named kept. Null
 * for any other path.
 */
export function movedPlace(name: string, params: URLSearchParams): string | null {
  switch (name) {
    case '/terminal':
    case '/(tabs)/terminal': {
      if (params.get('side') !== 'sell') return TRADE_PATH
      const search = params.toString()
      return `/trade?${search}`
    }
    case '/markets':
      return screenerPath(params)
    case '/money':
    case '/(tabs)/money':
      return params.get('open') === 'top-up' ? `${MONEY_PATH}?open=top-up` : MONEY_PATH
    case ORDERS_PATH: {
      const order = params.get('order')
      return withQuery(PORTFOLIO_PATH, [
        ['open', 'orders'],
        ['order', order && ORDER.test(order) ? order : null],
      ])
    }
    default:
      return null
  }
}

/** A link's query as the screener reads it. */
function paramsOf(params: URLSearchParams): Record<string, string> {
  return Object.fromEntries(params.entries())
}

/** The screener on the tab a link asks for, or on `fallback` when it asks for none — with none, as the person left it. */
function screenerPath(params: URLSearchParams, fallback?: ScreenerTab): string {
  return marketsPath(askedScreenerTab(paramsOf(params)) ?? fallback)
}

function withQuery(path: string, entries: readonly (readonly [string, string | null])[]): string {
  const query = new URLSearchParams()
  for (const [key, value] of entries) if (value !== null && value !== '') query.set(key, value)
  const search = query.toString()
  return search ? `${path}?${search}` : path
}

/**
 * The web pages Ryntra hands off to — and a shared link may name — on the
 * phone's own screens: Ryntra itself, the Spot ticket (Trade) or the asset,
 * the builder with a draft or a carried rule, Home (with the month's budget),
 * Markets on a tab (the stock screener and Trends lead there), «Боти» (the
 * plans, the results, the recurring buy), a token by its address, Swap,
 * Portfolio, History, Rewards, Top up and Receive — the same places on both,
 * the menu v6.2. Null when the path is none of them.
 */
function agentPathOf(name: string, params: URLSearchParams, options: MapOptions): string | null {
  const rawMint = params.get('mint')
  const mint = rawMint && MINT.test(rawMint) ? rawMint : null
  switch (name) {
    case '/app/ryn': {
      const context = parseContextParam(params.get('context'))
      // A question a link carries only fills the composer; the person sends it.
      const question = (params.get('q') ?? '').trim().slice(0, QUESTION_MAX)
      // A morning brief's day (1.46.0, `?brief=2026-10-18`, or `latest`): the brief opens first.
      const rawBrief = params.get('brief')
      const brief = rawBrief && BRIEF_DAY.test(rawBrief) ? rawBrief : null
      // A watch's note (1.57.0) opens «Стежу» on it; a task's (1.59.0) its conversation; a door its tab.
      const watch = params.get('watch')
      const task = params.get('task')
      const tab = params.get('tab')
      const order = params.get('order')
      return withQuery('/ryn', [
        ['context', context ? contextParam(context) : null],
        ['q', question || null],
        ['brief', brief],
        ['watch', watch && WATCH.test(watch) ? watch : null],
        ['task', task && TASK.test(task) ? task : null],
        ['tab', tab && ASSISTANT_TABS.has(tab) ? tab : null],
        ['order', order && ORDER_ID.test(order) ? order : null],
      ])
    }
    case '/app/spot': {
      // Spot without a market is the phone's Trade, where a market is picked (Markets · «Для досвідчених» · Спот).
      if (!mint) return '/trade'
      const rawSide = params.get('side')
      const side = rawSide === 'sell' ? 'sell' : rawSide === 'buy' ? 'buy' : null
      const plan = params.get('plan')
      const version = params.get('v')
      const binding = plan && PLAN.test(plan) && version && VERSION.test(version) ? { plan, version } : null
      // A token's rule reminder (1.31.0): the ticket as the rule's purchase — read afresh in Trade, never a permission.
      const rule = params.get('rule')
      const due = params.get('due')
      if (rule && RULE.test(rule))
        return withQuery('/trade', [
          ['mint', mint],
          ['side', 'buy'],
          ['rule', rule],
          ['due', due && Number.isFinite(Date.parse(due)) && due.length <= 40 ? due : null],
        ])
      // A market with no side and no plan is the asset itself; a side or a plan is a ticket.
      if (!side && !binding) return `/asset/${mint}`
      const ticketSide = binding ? 'buy' : (side ?? 'buy')
      const amount = params.get('amount')
      // A sum is carried into a Buy only: it is paid in USDC there; a Sell's amount is the asset's own units.
      const carried =
        options.carrySums && ticketSide === 'buy' && amount && SUM.test(amount) && Number(amount) > 0 ? amount : null
      return withQuery('/trade', [
        ['mint', mint],
        ['side', ticketSide],
        ['amount', carried],
        ['plan', binding?.plan ?? null],
        ['v', binding?.version ?? null],
      ])
    }
    case '/app/home':
      // The month's autoinvest budget, spent: its note's Telegram button opens Home with the budget's sheet (1.13.0).
      return params.get('budget') === 'edit' ? BUDGET_EDIT_PATH : HOME_PATH
    case '/app/portfolio':
      return '/(tabs)/portfolio'
    case '/app/activity':
      // The web's activity is the phone's «Портфель · Історія» (NEW-LOOK §5).
      return PORTFOLIO_HISTORY_PATH
    case '/app/results':
      // The phone's own Results screen, a tap inside «Боти»: the plans' and the rules' outcomes.
      return '/results'
    case '/app/bots':
    case '/app/autoinvest':
    case '/app/plans':
    case '/app/journal':
      // Everything that runs on the person's rule — «Боти → Мої боти».
      return BOTS_PATH
    case '/app/bots/catalog':
      return BOTS_CATALOG_PATH
    case '/app/markets':
      return screenerPath(params)
    case '/app/stocks':
    case '/app/stocks/screener':
      // The stock screener is the screener's «Акції» (`?kind=preipo` — «Приватні»).
      return screenerPath(params, 'stocks')
    case '/app/trends':
      // «Тренди» is the screener's own order now (`?mode=meme` — «Меми»).
      return screenerPath(params)
    case '/app/top-up':
      return `${MONEY_PATH}?open=top-up`
    case '/app/swap':
      return SWAP_PATH
    case '/app/futures':
    case '/app/perps': {
      // «Торгівля → Ф'ючерси» (C4): the web's `?market=SOL` opens that Phoenix market's own page.
      const market = params.get('market')
      return market && FUTURES_MARKET.test(market) ? `/futures/${market}` : `${TRADE_PATH}?seg=futures`
    }
    case '/app/predictions':
      return PREDICTIONS_PATH
    case '/app/rewards':
      return '/rewards'
    case '/app/receive':
      // «Отримати»: the address, and a payment link a tap away.
      return '/money/receive'
    case '/app/send':
      return '/money/send'
    case '/app/strategies/new': {
      const plan = params.get('plan')
      const draft = params.get('draft')
      const evidence = params.get('evidence')
      const budget = params.get('budget')
      const carried: readonly (readonly [string, string | null])[] = [
        ['draft', draft && DRAFT.test(draft) ? draft : null],
        ['evidence', evidence && EVIDENCE.test(evidence) ? evidence : null],
        ['budget', options.carrySums && budget && SUM.test(budget) && Number(budget) > 0 ? budget : null],
      ]
      if (plan && PLAN.test(plan)) return withQuery('/plans/new', [['plan', plan], ...carried])
      if (mint) return withQuery('/plans/new', [['mint', mint], ...carried])
      return '/plans/pick'
    }
    default:
      break
  }
  // Ryntra Launch: the form, «Лаунчі на Ryntra», «Мої лаунчі» and a token's page — the share link a creator posts opens here.
  if (name === '/app/launch' || name === '/app/launch/new') return '/launch'
  if (name === '/app/launch/mine') return '/launch/mine'
  if (name === '/app/launch/markets') return '/launch/markets'
  const launched = /^\/app\/launch\/([^/]+)$/.exec(name)
  if (launched) return MINT.test(launched[1] ?? '') ? `/launch/${launched[1]}` : '/launch'
  const asset = /^\/app\/assets\/([^/]+)$/.exec(name)
  if (asset) return MINT.test(asset[1] ?? '') ? `/asset/${asset[1]}` : '/(tabs)/markets'
  // A token by its contract address — what the web's search opens: the phone finds the token's own page.
  const token = /^\/app\/token\/([^/]+)$/.exec(name)
  if (token) return MINT.test(token[1] ?? '') ? `/token/${token[1]}` : '/(tabs)/markets'
  const stock = /^\/app\/stocks\/([^/]+)$/.exec(name)
  if (stock) {
    // An autoinvest reminder's own link (its Telegram button): the resolver reads the rule and opens the company's
    // purchase under it — the link itself buys nothing.
    const rule = params.get('rule')
    if (isRuleId(rule)) {
      const due = params.get('due')
      let symbol: string | null = null
      try {
        symbol = decodeURIComponent(stock[1] ?? '')
      } catch {
        symbol = null
      }
      return withQuery('/monitoring/open', [
        ['rule', rule],
        ['due', isInstant(due) ? due : null],
        ['symbol', symbol && SYMBOL.test(symbol) ? symbol : null],
      ])
    }
    // An issuer's event note's own link and its Telegram button (1.15.0): the token's swap, or its sale — the resolver
    // finds the token's address and opens its page with the sheet; the link itself swaps nothing.
    const convert = params.get('convert') === '1' ? 'convert' : params.get('sell') === '1' ? 'sell' : null
    if (convert) {
      let symbol: string | null = null
      try {
        symbol = decodeURIComponent(stock[1] ?? '')
      } catch {
        symbol = null
      }
      if (symbol && SYMBOL.test(symbol))
        return withQuery('/monitoring/open', [
          ['stock', symbol],
          ['open', convert],
        ])
    }
    // A stock named by its symbol: the phone opens an asset by its address, so the screener's «Акції» is where it is found.
    return marketsPath('stocks')
  }
  return null
}

/** Expo Router's native-intent hook: every URL the OS hands the app passes through the mapper. */
export function redirectSystemPath(input: Readonly<{ path: string; initial: boolean }>): string {
  return mapDeepLink(input.path).path
}

/** The `data.link` of a push, as the server sends it (`{ link: "https://ryntra.io/app/alerts/open?n=…" }`); null otherwise. */
export function linkOfNotificationData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const link = (data as { link?: unknown }).link
  if (typeof link !== 'string' || link.length === 0 || link.length > 2048) return null
  return pathOfLink(link) === null ? null : link
}

/*
 * The site's addresses in Ukrainian — the web's own rule (`lib/site/localized.ts`, `hasUkAddress` and
 * `localizedPath`): a page offered in both languages answers at `/uk` and the same path, and a visit there sets the
 * language for what follows; every other page has one address, and its language is the browser's cookie, which the
 * phone cannot set. So a door the phone opens in Ukrainian takes the `/uk` address where the page has one, and the
 * plain address otherwise. The documentation's pages by slug, word for word with the web's `DOC_SLUGS`.
 */
const SITE_ORIGIN = 'https://ryntra.io'
const UK_PREFIX = '/uk'
const UK_DOC_SLUGS: ReadonlySet<string> = new Set([
  'start/getting-started',
  'start/wallet',
  'start/cabinet',
  'manage/settings',
  'invest/buy',
  'invest/autoinvest',
  'invest/company-page',
  'invest/private-companies',
  'invest/what-you-buy',
  'trade/swap',
  'trade/spot',
  'trade/screener',
  'trade/trends',
  'launch/launch-a-token',
  'money/top-up',
  'money/send',
  'money/receive',
  'money/bridge',
  'manage/portfolio',
  'strategies/my-strategies',
  'strategies/results',
  'strategies/overview',
  'manage/activity',
  'ryntra',
  'money/rewards',
  'money/referrals',
  'money/points',
  'reference/review',
  'reference/fees',
  'reference/statuses',
  'reference/troubleshooting',
  'reference/faq',
  'reference/glossary',
])
const UK_PAGES: ReadonlySet<string> = new Set([
  '/',
  '/app/home',
  '/app/markets',
  '/company',
  '/security',
  '/methodology',
  '/contact',
  '/support',
  '/stats',
  '/docs',
])
/** A company's page: one token, never the screener that shares the folder. */
const UK_COMPANY_PAGE = /^\/app\/stocks\/(?!screener$)[A-Za-z0-9._-]{1,44}$/

/** Whether the site's page at this path (no query, no fragment) has a Ukrainian address too. */
export function hasUkAddress(path: string): boolean {
  if (UK_PAGES.has(path)) return true
  if (UK_COMPANY_PAGE.test(path)) return true
  return path.startsWith('/docs/') && UK_DOC_SLUGS.has(path.slice('/docs/'.length))
}

/** A site path in the phone's language: its `/uk` address where the page has one, the path as it is otherwise. */
export function localizedSitePath(path: string, locale: 'en' | 'uk'): string {
  if (locale !== 'uk' || !path.startsWith('/')) return path
  const cut = path.search(/[?#]/)
  const [page, suffix] = cut < 0 ? [path, ''] : [path.slice(0, cut), path.slice(cut)]
  if (page === UK_PREFIX || page.startsWith(`${UK_PREFIX}/`) || !hasUkAddress(page)) return path
  return (page === '/' ? UK_PREFIX : `${UK_PREFIX}${page}`) + suffix
}

/**
 * A web path the resolver may open: only the site's own `/app/…` pages, never an arbitrary address — in the phone's
 * language where the page has a Ukrainian address (`/uk/app/home`), as it is otherwise (`/app/bridge`).
 */
export function webHrefOf(href: string | null | undefined, locale: 'en' | 'uk' = 'en'): string | null {
  if (typeof href !== 'string') return null
  const path = pathOfLink(href)
  if (path === null || !path.startsWith('/app/')) return null
  return `${SITE_ORIGIN}${localizedSitePath(path, locale)}`
}

/** One of ryntra.io's own pages (Help's `https://ryntra.io/docs`) in the phone's language; any other address as it is. */
export function siteHrefOf(url: string, locale: 'en' | 'uk'): string {
  const site = /^https:\/\/ryntra\.io(\/[^#]*)?(#.*)?$/i.exec(url.trim())
  if (!site) return url
  const path = site[1] && site[1].length > 0 ? site[1] : '/'
  const localized = localizedSitePath(path, locale)
  if (localized === path) return url
  return `${SITE_ORIGIN}${localized}${site[2] ?? ''}`
}
