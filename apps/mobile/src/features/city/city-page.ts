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

/** The search parameter that carries the site's path a link named (`/c/<mint>`) into the City tab. */
export const CITY_AT_PARAM = 'at'

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
/** The site itself, and any of its pages — never another host that only starts like it (`ryntra.io.example`). */
const ON_SITE = /^https:\/\/ryntra\.io(?:[/?#]|$)/i

/**
 * The site's path the city opens on, from a link's path: `/` is the city itself, `/c/<mint>` a coin's tower; null for
 * any other path, which the city does not own.
 */
export function cityPathOf(path: string): string | null {
  const cut = path.search(/[?#]/)
  const page = (cut < 0 ? path : path.slice(0, cut)).replace(/\/+$/, '') || '/'
  if (page === '/') return '/'
  const coin = /^\/c\/([^/]+)$/.exec(page)
  return coin && MINT.test(coin[1] ?? '') ? `/c/${coin[1]}` : null
}

/** The app's route for a city path: the city, on the coin when one is named. */
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
 * `/c/<mint>` — over https, `ryntra://` or as a bare path — is the city on that coin's tower; anything else, an old
 * page's address or a push's link included, is the city itself. There is no other place to go.
 */
export function cityRouteOfLink(link: string): string {
  const text = link.trim()
  const site = /^https?:\/\/(?:www\.)?ryntra\.io(\/[^#]*)?(?:#.*)?$/i.exec(text)
  const scheme = /^ryntra(?:-dev)?:\/\/([^#]*)(?:#.*)?$/i.exec(text)
  let path: string | null = null
  if (site) path = site[1] || '/'
  else if (scheme) path = `/${(scheme[1] ?? '').replace(/^\/+/, '')}`
  else if (text.startsWith('/') && !text.startsWith('//')) path = text.split('#')[0] ?? '/'
  const city = path === null ? null : cityPathOf(path)
  return cityRouteOf(city ?? '/')
}

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
