/**
 * How the City tab holds `https://ryntra.io` in its WebView (CITY-6c): which address it opens, what may load in it, who
 * may speak over the bridge, and what a link from outside opens. Pure — no React Native here, so the rules are tested as
 * they are.
 */

import { isHttpsUrl } from './bridge.ts'

/** The app's one route: the city (decision 75 — the app is the city and nothing else). */
export const CITY_PATH = '/'

/** The city's own site. */
export const CITY_ORIGIN = 'https://ryntra.io'

/** The search parameter that carries the site's path a link named (`/c/<mint>`, `/?open=agent`) into the City tab. */
export const CITY_AT_PARAM = 'at'

/**
 * What a link to the city may ask of it on arrival, kept when the link opens the app (CITY-235) — the same words the
 * site reads in a browser: the window to open (`open`, with its `tab`, `market` or `page` — the agent's card
 * `/?open=agent`, Money, Earn, the Hall), a creator's early-access link (`early=<mint>`), a crew's invite (`crew`), a
 * friend's code (`ref`, its sub-ID `s`) and a campaign's tags (`utm_*`), the home's tower (`coin`) and the language
 * (`lang`), the stop a reached stop's note names (`/c/<mint>?stop=<id>` — the city opens that very stop's sale, not
 * the newest one) and the function a lesson's «Try» opens (`/?try=<function>`, from «How it works»). Nothing else
 * reaches the page from outside: a stand's or a developer's switch stays the site's own.
 */
export const CITY_LINK_KEYS: readonly string[] = [
  'open',
  'tab',
  'market',
  'page',
  'early',
  'crew',
  'ref',
  's',
  'coin',
  'lang',
  'stop',
  'try',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
]

/** One value a link carries, at most: a code, a coin's mint, a market's id or a campaign's tag. */
const MAX_LINK_VALUE = 128
/** No control characters in a value the page will read. */
const CONTROL = /[\u0000-\u001f\u007f]/

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
/** The site itself, and any of its pages — never another host that only starts like it (`ryntra.io.example`). */
const ON_SITE = /^https:\/\/ryntra\.io(?:[/?#]|$)/i

const decodePart = (part: string): string | null => {
  try {
    return decodeURIComponent(part.replace(/\+/g, ' '))
  } catch {
    return null
  }
}

/** A value as the address carries it; null for one that cannot be written there (half of a surrogate pair). */
const encodePart = (part: string): string | null => {
  try {
    return encodeURIComponent(part)
  } catch {
    return null
  }
}

/**
 * The part of a link's query the city may read (`CITY_LINK_KEYS`), as the WebView's address asks for it: each key once
 * (the first wins), each value short and printable, in the link's order; '' when nothing is left. Read by hand — the
 * app's runtime has no full `URLSearchParams`.
 */
export function cityQueryOf(query: string): string {
  const kept: string[] = []
  const seen = new Set<string>()
  for (const pair of query.replace(/^\?/, '').split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = decodePart(eq < 0 ? pair : pair.slice(0, eq))
    const value = decodePart(eq < 0 ? '' : pair.slice(eq + 1))
    if (key === null || value === null || !CITY_LINK_KEYS.includes(key) || seen.has(key)) continue
    if (!value || value.length > MAX_LINK_VALUE || CONTROL.test(value)) continue
    const word = encodePart(value)
    if (word === null) continue
    seen.add(key)
    kept.push(`${encodeURIComponent(key)}=${word}`)
  }
  return kept.join('&')
}

/**
 * The site's address the city opens on, from a link's path: `/` is the city itself, `/c/<mint>` a coin's tower — each
 * with what the link asks of the city (`cityQueryOf`); null for any other path, which the city does not own.
 */
export function cityPathOf(path: string): string | null {
  const hash = path.indexOf('#')
  const bare = hash < 0 ? path : path.slice(0, hash)
  const mark = bare.indexOf('?')
  const page = (mark < 0 ? bare : bare.slice(0, mark)).replace(/\/+$/, '') || '/'
  const query = mark < 0 ? '' : cityQueryOf(bare.slice(mark + 1))
  const tail = query ? `?${query}` : ''
  if (page === '/') return `/${tail}`
  const coin = /^\/c\/([^/]+)$/.exec(page)
  return coin && MINT.test(coin[1] ?? '') ? `/c/${coin[1]}${tail}` : null
}

/** The app's route for a city path: the city — on the coin, or with what the link asks of it, when there is any. */
export function cityRouteOf(cityPath: string): string {
  return cityPath === '/' ? CITY_PATH : `${CITY_PATH}?${CITY_AT_PARAM}=${encodeURIComponent(cityPath)}`
}

/** The page the WebView opens for what the route carried: the city path it names, or the city itself. */
export function cityUrlOf(at: string | null | undefined): string {
  const path = typeof at === 'string' ? cityPathOf(at) : null
  return path === null || path === '/' ? `${CITY_ORIGIN}/` : `${CITY_ORIGIN}${path}`
}

/**
 * Every address the system opens the app with, as the app's route (Expo Router's `redirectSystemPath`): the site's
 * `/` and `/c/<mint>` — over https, `ryntra://` or as a bare path — are the city and that coin's tower, with what the
 * link asks of the city (`/?open=agent`, `/?early=<mint>`); anything else, an old page's address or a push's link
 * included, is the city itself. There is no other place to go.
 */
export function cityRouteOfLink(link: string): string {
  const text = link.trim()
  const site = /^https?:\/\/(?:www\.)?ryntra\.io([/?][^#]*)?(?:#.*)?$/i.exec(text)
  const scheme = /^ryntra(?:-dev)?:\/\/([^#]*)(?:#.*)?$/i.exec(text)
  let path: string | null = null
  if (site) path = (site[1] ?? '').startsWith('?') ? `/${site[1]}` : site[1] || '/'
  else if (scheme) path = `/${(scheme[1] ?? '').replace(/^\/+/, '')}`
  else if (text.startsWith('/') && !text.startsWith('//')) path = text.split('#')[0] ?? '/'
  const city = path === null ? null : cityPathOf(path)
  return cityRouteOf(city ?? '/')
}

/**
 * The app's own few lines in the city's page (`injectedJavaScript`, the top frame only): they tell the app whether the
 * page has a step to go back to — the standard Navigation API's `canGoBack`, at load and at every move of its history.
 * Android's `WebView.canGoBack()` skips an entry the page added before the person touched it (Chromium's history
 * intervention): a window a link opened (`/?open=money`, a coin's tower) stood on such an entry, and Back left the app
 * instead of closing it (CITY-235). The page's own `history.back()` walks every entry. Silent where the API is missing:
 * the app then goes by the WebView alone, as before.
 */
export const PAGE_BACK_SCRIPT = `(function () {
  try {
    if (window.__ryntraAppBack) return;
    window.__ryntraAppBack = 1;
    var nav = window.navigation;
    var app = window.ReactNativeWebView;
    if (!nav || typeof nav.addEventListener !== 'function' || !app) return;
    var said = null;
    var say = function () {
      var back = nav.canGoBack === true;
      if (back === said) return;
      said = back;
      app.postMessage(JSON.stringify({ ryntraAppBack: back }));
    };
    nav.addEventListener('currententrychange', say);
    window.addEventListener('pageshow', function () {
      said = null;
      say();
    });
    say();
  } catch (e) {}
})();
true;`

/** What the page's Back lines said (`PAGE_BACK_SCRIPT`): whether it has a step back; null for any other message. */
export function pageBackOf(data: unknown): boolean | null {
  if (typeof data !== 'string' || data.length > 64 || !data.startsWith('{"ryntraAppBack":')) return null
  try {
    const value: unknown = JSON.parse(data)
    if (typeof value !== 'object' || value === null || Object.keys(value).length !== 1) return null
    const back = (value as { ryntraAppBack?: unknown }).ryntraAppBack
    return typeof back === 'boolean' ? back : null
  } catch {
    return null
  }
}

/** The page's own step back, as the WebView runs it. */
export const PAGE_GO_BACK = 'history.back(); true;'

/** Whether an address is a page of the city's site. */
export const onCitySite = (url: string | undefined): boolean => typeof url === 'string' && ON_SITE.test(url)

/** Whether a message comes from the city's site: Android names the sender by its page's address or its origin. */
export const pageSpeaks = (url: string | undefined): boolean => onCitySite(url)

/** What the WebView does with an address the page goes to. */
export type LoadDecision = 'load' | 'external' | 'block'

/**
 * The site's own pages load in the WebView. Another `https://` address the page goes to as a whole opens in the
 * system's browser, never in the city's frame. A frame inside the page loads only from the site itself: Android hands
 * the bridge to every frame and names a message by the top page's address, so another site's frame could ask the
 * wallet as if it were the city. Every other scheme (`intent:`, `http:`, a wallet's own link, `javascript:`) is
 * refused — the wallet is reached only through the bridge.
 */
export function loadDecisionOf(request: Readonly<{ url: string; isTopFrame?: boolean }>): LoadDecision {
  const { url } = request
  if (url === 'about:blank') return 'load'
  if (onCitySite(url)) return 'load'
  if (request.isTopFrame === false) return 'block'
  return isHttpsUrl(url) ? 'external' : 'block'
}

/** What covers the WebView: nothing, the loading shape, «no network», or «the city did not open». */
export type CityCover = 'none' | 'loading' | 'offline' | 'failed'

/**
 * The cover over the city. No network said first while the page has not shown — a page that already shows stays in
 * reach, and its own calls say what failed; a page that failed to load is said in the app's words with «Спробувати
 * ще»; until the first load ends, the loading shape.
 */
export function cityCoverOf(state: Readonly<{ offline: boolean; failed: boolean; loaded: boolean }>): CityCover {
  if (state.loaded && !state.failed) return 'none'
  if (state.offline) return 'offline'
  if (state.failed) return 'failed'
  return 'loading'
}
