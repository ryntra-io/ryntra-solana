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
 * Ryntra's handoffs (M11) are the same web paths — the builder, the Spot
 * ticket, an asset, Portfolio, History, Results — and pass through here
 * too, so a handoff and a shared link land on the same screen. A handoff
 * opens a place, never an action: Trade takes its own fresh quote and
 * Review, the builder saves nothing until the person saves. A sum a link
 * names (a ticket's amount, a builder's budget) is carried only for a
 * handoff the app itself received from Ryntra, where the person wrote it; a
 * link from outside opens the same place without a figure nobody typed.
 */

import { contextParam, parseContextParam } from '../agent/context.ts'
import { isInstant, isRuleId } from '../autoinvest/rule-model.ts'
import { isMarketsList, listsPath } from '../shell/places.ts'
import { LEGACY_TAB_ROUTES } from '../shell/shell.ts'
import { BUDGET_EDIT_PATH } from './monitoring-model.ts'

const NOTE = /^(inb_|mon_)[0-9a-f]{24}$/
/** A company's symbol as a reminder's link names it. */
const SYMBOL = /^[A-Za-z0-9._-]{1,32}$/
const DEV_CLIENT = /^[a-z][a-z0-9+.-]*:\/\/expo-development-client(?:[/?#]|$)/i
const PLAN = /^plan_[0-9a-f]{32}$/
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const DRAFT = /^agd_[0-9a-f]{24}$/
const VERSION = /^[1-9][0-9]{0,3}$/
/** A plain positive decimal, up to nine whole digits and six places — the web ticket's own shape for a sum. */
const SUM = /^\d{1,9}(\.\d{1,6})?$/
/** `metric:window:operator:threshold` — the market rule a Ryntra draft or an analysis card carries into the builder. */
const EVIDENCE = /^[a-z0-9_]{1,64}:(24h|7d|now):(gt|gte|lt|lte):-?\d{1,15}(\.\d{1,6})?$/
const QUESTION_MAX = 2000

/** The app's own routes a link may name directly — left as they are. */
const NATIVE_PATHS =
  /^\/(?:\(tabs\)(?:\/|$)|trade(?:\?|$)|plans(?:\/|$)|monitoring(?:\/|$)|asset\/|history(?:\?|$)|results(?:\?|$)|rewards(?:\?|$)|search(?:\?|$)|ryn(?:\?|$)|changes(?:\?|$)|lists(?:\?|$)|money\/(?:send|receive)(?:\?|$)|launch(?:\/|\?|$)|gallery(?:\?|$)|_sitemap(?:\?|$)|$)/

export type MapOptions = Readonly<{
  /** Carry the sum a link names — only for Ryntra's own handoffs, where the person wrote it (see above). */
  carrySums?: boolean
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

  // The built shell's Trade and Strategies tabs: the same surfaces, with the link's own query kept.
  const legacy = (LEGACY_TAB_ROUTES as Readonly<Record<string, string>>)[name]
  if (legacy) {
    const search = params.toString()
    return { path: search ? `${legacy}?${search}` : legacy, kind: 'native' }
  }
  // Markets on one of M2's lists — «Профі»'s Markets until one version (canon v5.3 В28): the lists screen on that list.
  const list = params.get('tab')
  if (name === '/(tabs)/markets' && isMarketsList(list)) return { path: listsPath(list), kind: 'native' }
  if (NATIVE_PATHS.test(path)) return { path, kind: 'native' }

  if (name === '/app/alerts/open') {
    const n = params.get('n') ?? ''
    return NOTE.test(n) ? { path: `/monitoring/open?n=${n}`, kind: 'native' } : { path: '/monitoring', kind: 'native' }
  }
  if (name === '/app/alerts') return { path: '/monitoring', kind: 'native' }

  const plan = /^\/app\/strategies\/plans\/([^/]+)$/.exec(name)
  if (plan) {
    const id = plan[1] ?? ''
    if (!PLAN.test(id)) return { path: '/plans', kind: 'native' }
    return {
      path: params.get('from') === 'monitoring' ? `/plans/${id}?from=monitoring` : `/plans/${id}`,
      kind: 'native',
    }
  }
  if (name === '/app/strategies' || name === '/app/strategies/plans') return { path: '/plans', kind: 'native' }

  const ryn = agentPathOf(name, params, options)
  if (ryn !== null) return { path: ryn, kind: 'native' }

  if (name.startsWith('/app/')) {
    // Owned on the web only (a paper prediction plan, settings): the resolver opens ryntra.io and says so.
    return { path: `/monitoring/open?href=${encodeURIComponent(path)}`, kind: 'web' }
  }
  return { path: '/', kind: 'unknown' }
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
 * Markets, the Stocks and Trends lists, Swap, Portfolio, History, Rewards and
 * Receive — the same places on both since one version (canon v5.3 В28, §3).
 * Null when the path is none of them.
 */
function agentPathOf(name: string, params: URLSearchParams, options: MapOptions): string | null {
  const rawMint = params.get('mint')
  const mint = rawMint && MINT.test(rawMint) ? rawMint : null
  switch (name) {
    case '/app/ryn': {
      const context = parseContextParam(params.get('context'))
      // A question a link carries only fills the composer; the person sends it.
      const question = (params.get('q') ?? '').trim().slice(0, QUESTION_MAX)
      return context
        ? withQuery('/ryn', [
            ['context', contextParam(context)],
            ['q', question || null],
          ])
        : withQuery('/(tabs)/agent', [['q', question || null]])
    }
    case '/app/spot': {
      // Spot without a market is the phone's Trade, where a market is picked (Markets · «Для досвідчених» · Спот).
      if (!mint) return '/trade'
      const rawSide = params.get('side')
      const side = rawSide === 'sell' ? 'sell' : rawSide === 'buy' ? 'buy' : null
      const plan = params.get('plan')
      const version = params.get('v')
      const binding = plan && PLAN.test(plan) && version && VERSION.test(version) ? { plan, version } : null
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
      return params.get('budget') === 'edit' ? BUDGET_EDIT_PATH : '/(tabs)'
    case '/app/portfolio':
      return '/(tabs)/portfolio'
    case '/app/activity':
      return '/history'
    case '/app/results':
      // The phone's own Results screen (M13): the plans' and the rules' outcomes.
      return '/results'
    case '/app/markets':
    case '/app/stocks':
      // Both are Markets on the web since one version: the companies first.
      return '/(tabs)/markets'
    case '/app/trends':
      return listsPath('crypto')
    case '/app/swap':
      return '/trade?mode=swap'
    case '/app/rewards':
      return '/rewards'
    case '/app/receive':
      // «Отримати»: the address, and a payment link a tap away (M31).
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
  // Ryntra Launch (M33): the form, «Мої лаунчі» and a token's page — the share link a creator posts opens here.
  if (name === '/app/launch' || name === '/app/launch/new') return '/launch'
  if (name === '/app/launch/mine') return '/launch/mine'
  const launched = /^\/app\/launch\/([^/]+)$/.exec(name)
  if (launched) return MINT.test(launched[1] ?? '') ? `/launch/${launched[1]}` : '/launch'
  const asset = /^\/app\/assets\/([^/]+)$/.exec(name)
  if (asset) return MINT.test(asset[1] ?? '') ? `/asset/${asset[1]}` : '/(tabs)/markets'
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
    // A stock named by its symbol: the phone opens an asset by its address, so the Stocks list is where it is found.
    return listsPath('stock')
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

/** A web path the resolver may open: only the site's own `/app/…` pages, never an arbitrary address. */
export function webHrefOf(href: string | null | undefined): string | null {
  if (typeof href !== 'string') return null
  const path = pathOfLink(href)
  if (path === null || !path.startsWith('/app/')) return null
  return `https://ryntra.io${path}`
}
