/**
 * How the app holds the chart's page in its WebView (CH-21): the origin the page runs under, what it may load, who may
 * speak, the look it opens in, and what covers it while it cannot show a chart. Pure — no React Native here, so the
 * rules are tested as they are.
 */

import type { PageLang, PageTheme } from './bridge.ts'

/**
 * The page's own origin: an address that never resolves (`.invalid` is reserved for that), so the page has an origin
 * of its own — its drawings and indicators keep in its storage — and is never mistaken for, or sent to, a real site.
 */
export const PAGE_ORIGIN = 'https://chart.ryntra.invalid/'

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** The WebView loads the page the app gave it and nothing else: no link, no redirect, no other site. */
export function pageMayLoad(url: string): boolean {
  return url === PAGE_ORIGIN || url === 'about:blank'
}

/**
 * Whether a message comes from the page the app opened. Android's WebView names the sender by its origin
 * (`https://chart.ryntra.invalid`, no path), an older one by the page's address — both are the page; nothing else is.
 */
export function pageSpeaks(url: string | undefined): boolean {
  return typeof url === 'string' && originOf(url) === originOf(PAGE_ORIGIN)
}

/** The app's dark theme is the core's Graphite, its light one Porcelain. */
export const pageThemeOf = (theme: 'dark' | 'light'): PageTheme => (theme === 'light' ? 'porcelain' : 'graphite')

/**
 * The page as it opens, in the app's look: the theme and the language written into its `<html>`, so the first frame is
 * already right. A later change comes through the bridge, without reloading the page.
 */
export function pageHtmlFor(html: string, theme: PageTheme, lang: PageLang): string {
  const head = '<html lang="uk" data-theme="graphite">'
  if (!html.includes(head)) throw new Error('the chart page has no <html> head to set the look on')
  return html.replace(head, `<html lang="${lang}" data-theme="${theme}">`)
}

/** Why the first read of the chosen interval did not come; null while it is coming or came. */
export type FirstTrouble = 'offline' | 'down' | null

/** What covers the chart's place: nothing, the loading shape, or a state in the app's words. */
export type Cover = 'none' | 'loading' | 'offline' | 'down' | 'failed'

/**
 * The cover over the WebView. The page that broke or never said «ready» is said first; until the chart has drawn once,
 * the loading shape holds the place — or, when the first read failed, the reason with «Спробувати ще». Once the chart
 * has drawn, nothing covers it: an interval being read, empty or failed is the chart's own state (and a failed read's
 * strip), and its interval switch stays in reach.
 */
export function coverOf(
  state: Readonly<{ pageFailed: boolean; ready: boolean; drawn: boolean; firstTrouble: FirstTrouble }>,
): Cover {
  if (state.pageFailed) return 'failed'
  if (state.ready && state.drawn) return 'none'
  if (state.firstTrouble) return state.firstTrouble
  return 'loading'
}
