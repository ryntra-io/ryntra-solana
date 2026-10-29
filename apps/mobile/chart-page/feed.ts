/**
 * The candles the app reads, as the core chart's source (contract `ryntra.chart/2.3`, CH-21) — the same reads and the
 * same rules as the web's Solana chart (`app/solana/workspace/spot/core-chart-source.ts` on `master`, CH-17): the
 * deepest pool's OHLCV from the Ryntra API (`/api/spot/candles`), its last bar closed at the asset page's one live
 * price. The app puts each read in (`put`) and the live price (`live`); the chart asks history and listens through
 * `source`. An interval the app has not read yet is waited for: the chart's interval switch is the app's, so the read
 * follows it. Nothing here is fetched and nothing is sent.
 *
 * Volume: the source states a bar's volume in dollars, so `turnover` carries it exactly and `v` — the base asset, as
 * the contract counts it — is that dollar volume at the bar's typical price, (H + L + C) / 3.
 */
import type {
  Bar,
  BarCorrection,
  ChartSource,
  DataStatus,
  HistoryPage,
  Instrument,
  LiveEvent,
  PriceBasis,
  Resolution,
  TimeResolution,
} from '@ryntra/core/adapters'

import { PRO_TIMEFRAMES, type PageCandle, type ProTimeframe } from '../src/features/pro-chart/bridge.ts'

/** The contract the core of this build speaks (`CHART_CONTRACT` of `@ryntra/core/adapters` 0.9.0). */
export const CHART_CONTRACT_VERSION = 'ryntra.chart/2.3'

export const PRICE_BASIS: PriceBasis = { kind: 'last', measure: 'price', in: 'USD', adjustment: 'raw', outcome: null }

const RESOLUTION: Readonly<Record<ProTimeframe, TimeResolution>> = {
  '1m': { kind: 'time', unit: 'minute', span: 1 },
  '5m': { kind: 'time', unit: 'minute', span: 5 },
  '15m': { kind: 'time', unit: 'minute', span: 15 },
  '1h': { kind: 'time', unit: 'hour', span: 1 },
  '4h': { kind: 'time', unit: 'hour', span: 4 },
  '1d': { kind: 'time', unit: 'day', span: 1 },
}

const SECONDS: Readonly<Record<ProTimeframe, number>> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3_600,
  '4h': 14_400,
  '1d': 86_400,
}

/** How long the server keeps a read of each interval (the app's `TIMEFRAME_TTL_MS`): the data is that much behind. */
export const DELAY_MS: Readonly<Record<ProTimeframe, number>> = {
  '1m': 20_000,
  '5m': 45_000,
  '15m': 60_000,
  '1h': 120_000,
  '4h': 300_000,
  '1d': 600_000,
}

export const resolutionOf = (timeframe: ProTimeframe): TimeResolution => RESOLUTION[timeframe]

/** A resolution as the app's interval; null for one the source does not draw. */
export function timeframeOf(resolution: Resolution): ProTimeframe | null {
  if (resolution.kind !== 'time') return null
  return (
    PRO_TIMEFRAMES.find((tf) => RESOLUTION[tf].unit === resolution.unit && RESOLUTION[tf].span === resolution.span) ??
    null
  )
}

/** The decimals a price prints with (the web's `priceDecimals`, B15): $104 → 2, $0.1408 → 4, $0.000003 → 9. */
export function priceDecimals(reference: number | null): number {
  if (reference === null || !Number.isFinite(reference) || reference === 0) return 2
  const abs = Math.abs(reference)
  if (abs >= 1) return 2
  const zeros = Math.max(0, Math.ceil(-Math.log10(abs) - 1e-12) - 1)
  return Math.min(zeros + 4, 18)
}

/** A price step from the price's own size: $104 → 0.01, $0.000003 → 1e-9. */
export function tickFor(reference: number | null): string {
  const decimals = priceDecimals(reference)
  return decimals === 0 ? '1' : `0.${'0'.repeat(decimals - 1)}1`
}

const decimalsOfStep = (step: string): number => (step.includes('.') ? step.length - step.indexOf('.') - 1 : 0)

/** A number on the step, as the contract's decimal string: never an exponent, never more digits than the step. */
export function onTick(value: number, step: string): string {
  const unit = Number(step)
  return (Math.round(value / unit) * unit).toFixed(decimalsOfStep(step))
}

/**
 * The live price closes the bar of the moment (the web's `withLivePrice`): the last bar when it is the moment's, else
 * a new bar from the last close — never a price more than a quarter away from the last close, which is a broken print.
 */
export function withLivePrice(
  candles: readonly PageCandle[],
  price: number | null,
  nowSeconds: number,
  seconds: number,
): PageCandle[] {
  if (candles.length === 0 || price === null || !Number.isFinite(price) || price <= 0 || !(seconds > 0))
    return [...candles]
  const last = candles[candles.length - 1]
  const bucket = Math.floor(nowSeconds / seconds) * seconds
  if (last.time > bucket) return [...candles]
  const ratio = price / last.close
  if (ratio < 0.8 || ratio > 1.25) return [...candles]
  if (last.time === bucket)
    return [
      ...candles.slice(0, -1),
      { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) },
    ]
  return [
    ...candles,
    {
      time: bucket,
      open: last.close,
      high: Math.max(last.close, price),
      low: Math.min(last.close, price),
      close: price,
    },
  ]
}

/**
 * The state of the numbers: `delayed` by as long as the server keeps an interval's read, `stale` when the source
 * stopped answering and the last good read is shown — aged from that read, never from the phone's guess. The source
 * is named with the pool it read, and Jupiter beside it when the live price closes the last bar.
 */
export function candlesStatus(
  read: Readonly<{
    observedAt: number | null
    stale: boolean
    pool: string | null
    source: string | null
    live?: boolean
  }>,
  timeframe: ProTimeframe,
  now: number,
): DataStatus {
  const at = Math.min(now, read.observedAt ?? now)
  /* The source as the read named it, with its pool — a read that named none (an interval with no candles) is a dash,
     never a guess; Jupiter beside it when its price — the asset page's — closed the last bar. */
  const label = `${read.source ?? '—'}${read.pool ? ` · ${read.pool}` : ''}${read.live ? ' · Jupiter' : ''}`
  return {
    state: read.stale ? 'stale' : 'delayed',
    market: 'open',
    source: { id: 'geckoterminal', label, rights: 'display', attribution: null },
    at,
    gateway_at: now,
    age_ms: Math.max(0, now - at),
    delay_ms: read.stale ? null : DELAY_MS[timeframe],
    derived: false,
  }
}

export type ChartMarket = Readonly<{ mint: string; symbol: string; stock: boolean }>

type Read = Readonly<{
  candles: readonly PageCandle[]
  observedAt: number
  stale: boolean
  pool: string | null
  source: string | null
}>
type Waiter = Readonly<{ resolve: (read: Read) => void; reject: (error: Error) => void }>
type Listener = Readonly<{ timeframe: ProTimeframe; emit: (event: LiveEvent) => void }>

/**
 * How long history waits for the app's read of an interval it has not read yet: past the longest wait the server's
 * limiter may name (60 s, `chart-asks.ts`) and the one ask after it.
 */
const WAIT_MS = 90_000
/** The finest step the chart takes: past it a float prints noise, and a wick that far is a broken print. */
const FINEST_STEP = '0.000000000001'
const finer = (a: string, b: string): string => (Number(b) < Number(a) && Number(b) >= Number(FINEST_STEP) ? b : a)
const ohlc = (bar: Bar): string => `${bar.o}|${bar.h}|${bar.l}|${bar.c}`

/** One market's feed: the app's reads per interval and the live price; `now` is the bars' clock (ms of the epoch). */
export class ProChartFeed {
  #market: ChartMarket
  readonly #now: () => number
  readonly #reads = new Map<ProTimeframe, Read>()
  readonly #waiters = new Map<ProTimeframe, Waiter[]>()
  readonly #listeners = new Set<Listener>()
  /** Per interval: the newest bar the screen holds, and when it last went out. */
  readonly #shown = new Map<ProTimeframe, { t: number; sentAt: number; bar: Bar }>()
  /** Per interval: an update of the newest bar waiting for the rest of its second. */
  readonly #held = new Map<ProTimeframe, { timer: ReturnType<typeof setTimeout>; send: () => void }>()
  /** What the screen holds per interval, by open: to tell a bar that changed under it. */
  readonly #screen = new Map<ProTimeframe, Map<number, string>>()
  /** Per interval: whether the live price closed its last bar in the newest drawing — the source line says so. */
  readonly #liveUsed = new Map<ProTimeframe, boolean>()
  /**
   * Intervals whose history the chart could not draw — its wait ran out, or the read it got was empty: when candles
   * come for one of them, the chart is told to load again (`put` says so), or it would keep «no candles» over them.
   */
  readonly #undrawn = new Set<ProTimeframe>()
  /**
   * Set when the newest bar on screen is no longer in the data — a bar the live price opened, and the price withdrawn
   * (the asset page's read went stale or failed): the chart must load again, or that bar and «· Jupiter» would stay.
   */
  #lostNewest = false
  #live: Readonly<{ price: number; at: number }> | null = null
  /** The price step: from the first price the feed sees, then as fine as the smallest price any read or the live price brought. */
  #tick: string
  #seeded = false
  #disposed = false
  readonly source: ChartSource

  constructor(market: ChartMarket, now: () => number = Date.now) {
    this.#market = market
    this.#now = now
    this.#tick = tickFor(null)
    this.source = this.#makeSource()
  }

  get tick(): string {
    return this.#tick
  }

  describe(update: Readonly<Partial<Pick<ChartMarket, 'symbol' | 'stock'>>>): void {
    this.#market = { ...this.#market, ...update }
  }

  /**
   * The app's read of an interval. A stale read keeps the time of the last good one: the age counts from it. True when
   * the chart must load the interval again: it gave up on it, or drew it empty, and now there are candles.
   */
  put(
    timeframe: ProTimeframe,
    candles: readonly PageCandle[],
    observedAt: number | null,
    stale: boolean,
    pool: string | null = null,
    source: string | null = null,
  ): boolean {
    if (this.#disposed) return false
    const before = this.#reads.get(timeframe)
    const when = stale && before ? before.observedAt : (observedAt ?? before?.observedAt ?? this.#now())
    const read: Read = {
      candles,
      observedAt: when,
      stale,
      pool: pool ?? before?.pool ?? null,
      source: source ?? before?.source ?? null,
    }
    /* From the opens and closes, not the wicks: one broken print of a wick must not make every price print ten zeros. */
    let low = Infinity
    for (const candle of candles)
      for (const price of [candle.open, candle.close]) if (price > 0 && price < low) low = price
    if (Number.isFinite(low)) this.#refine(low)
    this.#reads.set(timeframe, read)
    for (const waiter of this.#waiters.get(timeframe) ?? []) waiter.resolve(read)
    this.#waiters.delete(timeframe)
    this.#push(timeframe)
    const reload = candles.length > 0 && this.#undrawn.has(timeframe)
    if (reload) this.#undrawn.delete(timeframe)
    return this.#takeLost() || reload
  }

  #takeLost(): boolean {
    const lost = this.#lostNewest
    this.#lostNewest = false
    return lost
  }

  /**
   * The asset page's one last price with the server's time it came with, while it is fresh; null when there is none.
   * True when the chart must load again: the bar the withdrawn price had opened is gone from the data.
   */
  live(price: number | null, at: number = this.#now()): boolean {
    if (this.#disposed) return false
    const next = price !== null && Number.isFinite(price) && price > 0 ? { price, at } : null
    // The same price at a later time still moves the moment it closes (a quiet market crosses into a new bar).
    if (next !== null && next.price === this.#live?.price && next.at === this.#live?.at) return false
    // An older answer than the one held (a cache that served it late) changes nothing.
    if (next !== null && this.#live !== null && next.at < this.#live.at) return false
    if (next === null && this.#live === null) return false
    this.#live = next
    if (next) this.#refine(next.price)
    for (const timeframe of new Set([...this.#listeners].map((listener) => listener.timeframe))) this.#push(timeframe)
    return this.#takeLost()
  }

  #refine(price: number): void {
    this.#tick = this.#seeded ? finer(this.#tick, tickFor(price)) : tickFor(price)
    this.#seeded = true
  }

  dispose(): void {
    this.#disposed = true
    for (const list of this.#waiters.values()) for (const waiter of list) waiter.reject(new Error('the market left'))
    this.#waiters.clear()
    for (const pending of this.#held.values()) clearTimeout(pending.timer)
    this.#held.clear()
    this.#listeners.clear()
  }

  #instrument(): Instrument {
    const market = this.#market
    return {
      id: market.mint,
      symbol: market.symbol,
      network: 'solana',
      venue: 'geckoterminal',
      kind: market.stock ? 'stock' : 'spot',
      base: market.mint,
      quote: 'USD',
      tick: this.#tick,
      price_rule: null,
      lot: '0.000000001',
      min_notional: null,
      price_band: null,
      multiplier: '1',
      multiplier_version: null,
      session: { timezone: 'UTC', windows: [], holidays: [] },
      reference_session: null,
      scale: 'price',
      outcomes: [],
      min_resolution: RESOLUTION['1m'],
      resolutions: PRO_TIMEFRAMES.map((tf) => RESOLUTION[tf]),
      bases: [PRICE_BASIS],
      trading_basis: PRICE_BASIS,
    }
  }

  #wait(timeframe: ProTimeframe, signal?: AbortSignal): Promise<Read> {
    const read = this.#reads.get(timeframe)
    if (read) return Promise.resolve(read)
    if (this.#disposed) return Promise.reject(new Error('the market left'))
    return new Promise<Read>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#undrawn.add(timeframe)
        done(() => reject(new Error(`no candles for ${timeframe} yet`)))
      }, WAIT_MS)
      const done = (then: () => void) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        const list = (this.#waiters.get(timeframe) ?? []).filter((entry) => entry !== waiter)
        if (list.length) this.#waiters.set(timeframe, list)
        else this.#waiters.delete(timeframe)
        then()
      }
      const onAbort = () => done(() => reject(new DOMException('aborted', 'AbortError')))
      const waiter: Waiter = {
        resolve: (value) => done(() => resolve(value)),
        reject: (error) => done(() => reject(error)),
      }
      this.#waiters.set(timeframe, [...(this.#waiters.get(timeframe) ?? []), waiter])
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * A read's bars: the live price closes the bar of the moment — the moment of the price, by the server's time it came
   * with, never the phone's clock — then each price goes onto the step.
   */
  #bars(timeframe: ProTimeframe, read: Read): Bar[] {
    const live = read.stale ? null : this.#live
    const candles = withLivePrice(read.candles, live?.price ?? null, (live?.at ?? 0) / 1000, SECONDS[timeframe])
    const last = read.candles.at(-1)
    this.#liveUsed.set(
      timeframe,
      live !== null && (candles.length !== read.candles.length || candles.at(-1)?.close !== last?.close),
    )
    const fromSource = new Map(read.candles.map((candle) => [candle.time, candle]))
    const step = this.#tick
    const out: Bar[] = []
    for (const candle of candles) {
      const o = onTick(candle.open, step)
      const h = onTick(candle.high, step)
      const l = onTick(candle.low, step)
      const c = onTick(candle.close, step)
      if (Number(l) <= 0) continue
      const own = fromSource.get(candle.time)
      /* A bar the live price opened before the source has one carries no volume: it is not known yet, not zero. */
      const usd = own && own.volume !== undefined && Number.isFinite(own.volume) && own.volume >= 0 ? own.volume : null
      const typical = own ? (own.high + own.low + own.close) / 3 : 1
      out.push({
        t: candle.time * 1000,
        o,
        h: [h, o, c].reduce((top, value) => (Number(value) > Number(top) ? value : top)),
        l: [l, o, c].reduce((bottom, value) => (Number(value) < Number(bottom) ? value : bottom)),
        c,
        v: usd === null ? null : (usd / typical).toFixed(9),
        turnover: usd === null ? null : usd.toFixed(2),
        trades: null,
      })
    }
    return out
  }

  #status(read: Read | null, timeframe: ProTimeframe): DataStatus {
    const live = this.#live !== null && !(read?.stale ?? false) && (this.#liveUsed.get(timeframe) ?? false)
    const observed = Math.max(read?.observedAt ?? 0, live ? (this.#live?.at ?? 0) : 0)
    return candlesStatus(
      {
        observedAt: observed || null,
        stale: read?.stale ?? false,
        pool: read?.pool ?? null,
        source: read?.source ?? null,
        live,
      },
      timeframe,
      this.#now(),
    )
  }

  /** The newest state of an interval to everyone who listens: the newest bar replaced, new bars in order, an older change as a correction. */
  #push(timeframe: ProTimeframe): void {
    const read = this.#reads.get(timeframe)
    if (!read) return
    for (const listener of this.#listeners) {
      if (listener.timeframe !== timeframe) continue
      const shown = this.#shown.get(timeframe)
      if (!shown) continue
      const bars = this.#bars(timeframe, read)
      // The newest bar on screen is no longer in the data: nothing can replace it in place — the chart loads again.
      /* The newest bar on screen left the data (a bar a withdrawn live price had opened): it can be neither replaced nor
         corrected in place — the chart loads again, once (what it showed is forgotten). */
      if ((bars.at(-1)?.t ?? -Infinity) < shown.t) {
        this.#lostNewest = true
        this.#shown.delete(timeframe)
        continue
      }
      const changed = bars.find((bar) => bar.t < shown.t && this.#differs(timeframe, bar))
      if (changed) {
        const correction: BarCorrection = {
          instrument: this.#market.mint,
          from: changed.t,
          to: shown.t,
          reason: 'late_trade',
          at: this.#now(),
        }
        listener.emit({ type: 'corrected', correction })
      }
      const opens = bars.some((bar) => bar.t > shown.t)
      for (const bar of bars) {
        if (bar.t < shown.t) continue
        if (bar.t === shown.t && opens) continue
        this.#send(timeframe, listener, bar, () => this.#status(read, timeframe))
      }
      if (read.stale) listener.emit({ type: 'status', status: this.#status(read, timeframe) })
    }
  }

  #differs(timeframe: ProTimeframe, bar: Bar): boolean {
    const held = this.#screen.get(timeframe)?.get(bar.t)
    return held !== undefined && held !== ohlc(bar)
  }

  /** One bar to one listener: the same open at most once a second; a later open at once, after the bar before it. */
  #send(timeframe: ProTimeframe, listener: Listener, bar: Bar, status: () => DataStatus): void {
    const emit = (value: Bar) => {
      this.#shown.set(timeframe, { t: value.t, sentAt: this.#now(), bar: value })
      this.#screen.get(timeframe)?.set(value.t, ohlc(value))
      listener.emit({ type: 'bar', bar: value, status: status() })
    }
    const flush = () => {
      const pending = this.#held.get(timeframe)
      if (!pending) return
      clearTimeout(pending.timer)
      this.#held.delete(timeframe)
      pending.send()
    }
    const shown = this.#shown.get(timeframe)
    if (!shown || bar.t > shown.t) {
      flush()
      emit(bar)
      return
    }
    if (bar.t !== shown.t || `${ohlc(bar)}|${bar.v}` === `${ohlc(shown.bar)}|${shown.bar.v}`) return
    const wait = 1_000 - (this.#now() - shown.sentAt)
    const pending = this.#held.get(timeframe)
    if (pending) clearTimeout(pending.timer)
    this.#held.delete(timeframe)
    if (wait <= 0) {
      emit(bar)
      return
    }
    const send = () => {
      if (this.#listeners.has(listener)) emit(bar)
    }
    this.#held.set(timeframe, {
      send,
      timer: setTimeout(() => {
        this.#held.delete(timeframe)
        send()
      }, wait),
    })
  }

  #makeSource(): ChartSource {
    return {
      contract: CHART_CONTRACT_VERSION,
      instrument: async (id) => {
        if (id !== this.#market.mint) throw new Error(`unknown instrument ${id}`)
        return this.#instrument()
      },
      history: async (request, options): Promise<HistoryPage> => {
        const timeframe = timeframeOf(request.resolution)
        if (!timeframe) throw new Error('this source draws 1 m, 5 m, 15 m, 1 h, 4 h and 1 d')
        if (request.basis.measure !== 'price') throw new Error('this basis is not drawn here')
        const read = await this.#wait(timeframe, options?.signal)
        const all = this.#bars(timeframe, read)
        const status = this.#status(read, timeframe)
        const page = (bars: Bar[], more: { forward: boolean; backward: boolean }): HistoryPage => ({
          bars,
          more,
          gaps: [],
          display_step: this.#tick,
          multiplier_version: null,
          status,
        })
        if (request.load === 'init') {
          const bars = all.slice(-request.limit)
          if (bars.length === 0) {
            // Nothing on screen for this interval now: nothing of an earlier drawing is held against the next read.
            this.#undrawn.add(timeframe)
            this.#shown.delete(timeframe)
          }
          this.#screen.set(timeframe, new Map(all.map((bar) => [bar.t, ohlc(bar)])))
          const newest = bars.at(-1)
          if (newest) this.#shown.set(timeframe, { t: newest.t, sentAt: this.#now(), bar: newest })
          return page(bars, { forward: bars.length > 0 && all.length > bars.length, backward: false })
        }
        const at = request.timestamp ?? 0
        if (request.load === 'forward') {
          const older = all.filter((bar) => bar.t < at)
          const bars = older.slice(-request.limit)
          return page(bars, { forward: bars.length > 0 && older.length > bars.length, backward: false })
        }
        const newer = all.filter((bar) => bar.t > at)
        const bars = newer.slice(0, request.limit)
        return page(bars, { forward: false, backward: bars.length > 0 && newer.length > bars.length })
      },
      subscribe: (request, emit) => {
        const timeframe = timeframeOf(request.resolution)
        if (!timeframe) return () => {}
        const listener: Listener = { timeframe, emit }
        this.#listeners.add(listener)
        return () => {
          this.#listeners.delete(listener)
          const pending = this.#held.get(timeframe)
          if (pending && ![...this.#listeners].some((other) => other.timeframe === timeframe)) {
            clearTimeout(pending.timer)
            this.#held.delete(timeframe)
          }
        }
      },
      series: async () => [],
      seriesHistory: async (request) => {
        throw new Error(`no series here (${request.series})`)
      },
      marks: async () => {
        const [timeframe, read] = this.#reads.entries().next().value ?? ['1h' as ProTimeframe, null]
        return { marks: [], status: this.#status(read, timeframe) }
      },
      book: async () => null,
    }
  }
}
