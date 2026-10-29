/**
 * The professional chart's bridge (CH-21): the app and the page in its WebView speak only these messages, JSON on
 * both sides. The page is the core's chart (`@ryntra/core/chart`, built into `chart-page/page.generated.ts`); it fetches
 * nothing and sends nothing — the app reads the candles from the Ryntra API and puts them in, and the page says only
 * that it is ready, which interval the person chose, or that its engine failed.
 *
 * There is no message that trades: the chart draws no order lines and drafts no order. Buying and selling stay the
 * app's own buttons under the chart, which open the app's ticket and its Review; the wallet signs there.
 *
 * Both sides read with the parsers below and drop anything else, so a page that misbehaves can say nothing the app
 * does not expect, and the page never acts on a message it does not know.
 */

export const BRIDGE_VERSION = 1

/** The intervals the candles route serves (`/api/spot/candles?tf=`), the web's Solana chart's set. */
export const PRO_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const
export type ProTimeframe = (typeof PRO_TIMEFRAMES)[number]

/** The core's two themes by their own names: the app's dark is Graphite, its light Porcelain. */
export type PageTheme = 'graphite' | 'porcelain'
export type PageLang = 'uk' | 'en'

export type PageCandle = Readonly<{
  /** Unix seconds, the bar's open. */
  time: number
  open: number
  high: number
  low: number
  close: number
  /** In dollars, as the source counts it; absent when the source says nothing. */
  volume?: number
}>

/** The market on the chart and the look it is drawn in; the first message, and again whenever any of it changes. */
export type MarketMessage = Readonly<{
  v: typeof BRIDGE_VERSION
  type: 'market'
  mint: string
  symbol: string
  stock: boolean
  theme: PageTheme
  lang: PageLang
  timeframe: ProTimeframe
}>

/** One read of one interval: the candles oldest first, when the server read them, and whether its source is behind. */
export type CandlesMessage = Readonly<{
  v: typeof BRIDGE_VERSION
  type: 'candles'
  timeframe: ProTimeframe
  candles: readonly PageCandle[]
  /** Ms of the epoch, the server's own `observedAt`; null when it gave none. */
  observedAt: number | null
  stale: boolean
  /** The pool the candles are of, by its name («SOL / USDC»), and the source's label («GeckoTerminal»). */
  pool: string | null
  source: string | null
}>

/** The page's one last price — the asset page's — while it is fresh; null once there is none. */
export type LiveMessage = Readonly<{ v: typeof BRIDGE_VERSION; type: 'live'; price: number | null; at: number }>

export type AppMessage = MarketMessage | CandlesMessage | LiveMessage

export type PageMessage =
  | Readonly<{ v: typeof BRIDGE_VERSION; type: 'ready' }>
  /** The person chose another interval in the chart: the app reads it and puts it in. */
  | Readonly<{ v: typeof BRIDGE_VERSION; type: 'timeframe'; timeframe: ProTimeframe }>
  /** The engine could not start or broke: the app says so in its own words and opens the page again on request. */
  | Readonly<{ v: typeof BRIDGE_VERSION; type: 'failed' }>

/** The most candles one read carries: the route's own page is far smaller; anything bigger is not ours. */
export const MAX_CANDLES = 5_000
const MAX_TEXT = 120
/** A base58 address of 32 bytes: 32–44 characters. */
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export const isProTimeframe = (value: unknown): value is ProTimeframe =>
  typeof value === 'string' && (PRO_TIMEFRAMES as readonly string[]).includes(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT ? value : null

/** JSON text as a record of this bridge's version, else null — never a throw. */
function envelope(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  return isRecord(value) && value.v === BRIDGE_VERSION && typeof value.type === 'string' ? value : null
}

/** What the page said, read by the app: one of the three messages, or null for anything else. */
export function parsePageMessage(raw: unknown): PageMessage | null {
  const message = envelope(raw)
  if (!message) return null
  if (message.type === 'ready' || message.type === 'failed') return { v: BRIDGE_VERSION, type: message.type }
  if (message.type === 'timeframe' && isProTimeframe(message.timeframe))
    return { v: BRIDGE_VERSION, type: 'timeframe', timeframe: message.timeframe }
  return null
}

/** One candle as the chart may draw it: four positive prices with the high and the low around the open and close. */
function candleOf(value: unknown): PageCandle | null {
  if (!isRecord(value)) return null
  const { time, open, high, low, close, volume } = value
  if (![time, open, high, low, close].every(finite)) return null
  const [t, o, h, l, c] = [time, open, high, low, close] as number[]
  if (t <= 0 || o <= 0 || h <= 0 || l <= 0 || c <= 0) return null
  if (h < Math.max(o, c, l) || l > Math.min(o, c, h)) return null
  const candle = { time: t, open: o, high: h, low: l, close: c }
  return finite(volume) && volume >= 0 ? { ...candle, volume } : candle
}

/** What the app said, read by the page: one of the three messages, or null for anything else. */
export function parseAppMessage(raw: unknown): AppMessage | null {
  const message = envelope(raw)
  if (!message) return null
  if (message.type === 'market') {
    const { mint, symbol, stock, theme, lang, timeframe } = message
    if (typeof mint !== 'string' || !MINT.test(mint)) return null
    if (theme !== 'graphite' && theme !== 'porcelain') return null
    if (lang !== 'uk' && lang !== 'en') return null
    if (!isProTimeframe(timeframe)) return null
    return {
      v: BRIDGE_VERSION,
      type: 'market',
      mint,
      symbol: text(symbol) ?? '—',
      stock: stock === true,
      theme,
      lang,
      timeframe,
    }
  }
  if (message.type === 'candles') {
    const { timeframe, candles, observedAt, stale, pool, source } = message
    if (!isProTimeframe(timeframe) || !Array.isArray(candles) || candles.length > MAX_CANDLES) return null
    const read: PageCandle[] = []
    for (const entry of candles) {
      const candle = candleOf(entry)
      // Oldest first and one bar a time: a bar out of order or broken is left out, never drawn.
      if (candle && (read.length === 0 || candle.time > read[read.length - 1].time)) read.push(candle)
    }
    return {
      v: BRIDGE_VERSION,
      type: 'candles',
      timeframe,
      candles: read,
      observedAt: finite(observedAt) && observedAt > 0 ? observedAt : null,
      stale: stale === true,
      pool: text(pool),
      source: text(source),
    }
  }
  if (message.type === 'live') {
    const { price, at } = message
    if (!finite(at) || at <= 0) return null
    return { v: BRIDGE_VERSION, type: 'live', price: finite(price) && price > 0 ? price : null, at }
  }
  return null
}

/**
 * A message as the script the app injects into the page: a call of the page's one receiver with the JSON as a string
 * literal, so nothing in the message is ever read as code. `true;` keeps Android's evaluator quiet.
 */
export function injectionOf(message: AppMessage): string {
  const json = JSON.stringify(JSON.stringify(message))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return `window.__ryntraChart&&window.__ryntraChart(${json});true;`
}

/** The page's receiver name, which `injectionOf` calls. */
export const PAGE_RECEIVER = '__ryntraChart'
