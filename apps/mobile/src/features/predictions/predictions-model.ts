/**
 * «Торгівля → Прогнози» as values — pure (M12; decisions 56, 57 and 58: on the phone Predictions are a section of Ryntra
 * on Solana, never a door to another product). The web's routes under `/api/predictions/*` (the Predictions line, AGG)
 * answer the events, one event with its markets, and an outcome's price over time; the phone reads the same answers the
 * web's hub reads.
 *
 * Every answer is read again here rather than trusted: a field that is missing or not a number is no number on the
 * screen — a dash, never a zero. A probability is a share of one (0 … 1) as the routes send it; the phone writes it as a
 * percentage and never invents one for an outcome the venue did not price.
 */

export const PREDICTION_SORTS = ['volume24h', 'ending', 'newest'] as const
export type PredictionSort = (typeof PREDICTION_SORTS)[number]

/** The chart's ranges: a week of hours and three months of days — the two the routes serve without gaps. */
export const PREDICTION_RANGES = ['1w', '3m'] as const
export type PredictionRange = (typeof PREDICTION_RANGES)[number]

export const RANGE_READ: Readonly<Record<PredictionRange, Readonly<{ resolution: '1h' | '1d'; countBack: number }>>> = {
  '1w': { resolution: '1h', countBack: 168 },
  '3m': { resolution: '1d', countBack: 90 },
}

/** An event's or a market's id as the routes write it: letters and digits, never a path. */
export const PREDICTION_ID = /^[A-Za-z0-9_-]{1,64}$/

export const isPredictionId = (value: unknown): value is string =>
  typeof value === 'string' && PREDICTION_ID.test(value)

export type PredictionStatus = 'open' | 'closed' | 'resolved' | 'unknown'

export type PredictionCategory = Readonly<{ slug: string; name: string; count: number | null }>

export type PredictionOutcome = Readonly<{
  id: string
  label: string
  /** 0 … 1; null when the venue gave no price. */
  probability: number | null
  /** true once the market is resolved and this outcome won; null while it is not known. */
  winner: boolean | null
}>

/** An event as the hub's list draws it: its lead market's first outcome stands for it, as on the web. */
export type PredictionEventRow = Readonly<{
  id: string
  title: string
  /** The lead market's question when the event holds more than one market («October 31», «No change»). */
  lead: string | null
  image: string | null
  status: PredictionStatus
  volumeUsd: number | null
  endsAt: string | null
  marketCount: number
  venueCount: number
  /** The lead outcome — «Yes» of the lead market, or the first one priced. */
  leading: PredictionOutcome | null
}>

export type PredictionHub = Readonly<{
  categories: readonly PredictionCategory[]
  events: readonly PredictionEventRow[]
  nextCursor: string | null
  readAt: number
}>

export type PredictionMarket = Readonly<{
  id: string
  question: string
  status: PredictionStatus
  outcomes: readonly PredictionOutcome[]
  volumeUsd: number | null
  endsAt: string | null
  resolvesAt: string | null
  rules: string | null
}>

export type PredictionEvent = Readonly<{
  id: string
  title: string
  image: string | null
  status: PredictionStatus
  volumeUsd: number | null
  endsAt: string | null
  venueCount: number
  category: string | null
  description: string | null
  /** What every venue resolves this event by, in one paragraph; null when the venues were not compared. */
  settlement: string | null
  /** The busiest first, as the route sorts them; a market without an outcome is dropped. */
  markets: readonly PredictionMarket[]
  readAt: number
}>

/** An outcome's price over time as the phone's line draws it: seconds, oldest first, one point per bar. */
export type PredictionLine = Readonly<{
  outcomeId: string
  points: readonly Readonly<{ time: number; close: number }>[]
  /** The newest bar's time in seconds; null when the route sent none. */
  lastAt: number | null
  /** How long ago the venue last priced it, as the route counts; null when not said. */
  staleSeconds: number | null
  readAt: number
}>

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

const nonNegative = (value: unknown): number | null => {
  const parsed = finite(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

const positive = (value: unknown): number | null => {
  const parsed = finite(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

/** A probability as the routes send it, 0 … 1; anything outside is no price. */
const probability = (value: unknown): number | null => {
  const parsed = finite(value)
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed : null
}

const isoOrNull = (value: unknown): string | null => {
  const raw = text(value)
  return raw !== null && !Number.isNaN(Date.parse(raw)) ? raw : null
}

/** Only an https image is drawn; anything else is no image. */
const imageOf = (value: unknown): string | null => {
  const raw = text(value)
  return raw !== null && raw.startsWith('https://') ? raw : null
}

const statusOf = (value: unknown): PredictionStatus =>
  value === 'open' || value === 'closed' || value === 'resolved' ? value : 'unknown'

/** The read's own time; an answer without one is read as of `fallback` (the moment it arrived). */
const readAtOf = (body: Json, fallback: number): number => {
  const raw = text(body.readAt)
  const time = raw === null ? Number.NaN : Date.parse(raw)
  return Number.isFinite(time) && time > 0 ? time : fallback
}

function outcomesOf(raw: unknown): PredictionOutcome[] {
  if (!Array.isArray(raw)) return []
  const out: PredictionOutcome[] = []
  for (const entry of raw) {
    if (!isObject(entry) || !isPredictionId(entry.id)) continue
    const label = text(entry.label)
    if (label === null) continue
    out.push({
      id: entry.id,
      label,
      probability: probability(entry.probability),
      winner: typeof entry.winner === 'boolean' ? entry.winner : null,
    })
  }
  return out
}

/** «Yes» when the market has it, else the first outcome the venue priced, else the first one. */
export function leadingOutcome(outcomes: readonly PredictionOutcome[]): PredictionOutcome | null {
  return (
    outcomes.find((outcome) => outcome.label.toLowerCase() === 'yes') ??
    outcomes.find((outcome) => outcome.probability !== null) ??
    outcomes[0] ??
    null
  )
}

function venueCountOf(value: unknown): number {
  if (!Array.isArray(value)) return 0
  return new Set(value.filter((venue): venue is string => typeof venue === 'string' && venue.length > 0)).size
}

function eventRowOf(entry: unknown): PredictionEventRow | null {
  if (!isObject(entry) || !isPredictionId(entry.id)) return null
  const title = text(entry.title)
  if (title === null) return null
  return {
    id: entry.id,
    title,
    lead: text(entry.leadingQuestion),
    image: imageOf(entry.image),
    status: statusOf(entry.status),
    volumeUsd: nonNegative(entry.volume),
    endsAt: isoOrNull(entry.endDate),
    marketCount: Math.max(0, Math.floor(nonNegative(entry.marketCount) ?? 0)),
    venueCount: venueCountOf(entry.venues),
    leading: leadingOutcome(outcomesOf(entry.leading)),
  }
}

/** The hub's answer (`GET /api/predictions/discover`): the categories and one page of events, each once. */
export function parseHub(raw: unknown, now: number = Date.now()): PredictionHub {
  const body = isObject(raw) ? raw : {}
  const categories: PredictionCategory[] = []
  if (body.categoriesUnavailable !== true && Array.isArray(body.categories)) {
    const seen = new Set<string>()
    for (const entry of body.categories) {
      if (!isObject(entry)) continue
      const slug = text(entry.slug)
      const name = text(entry.name)
      if (slug === null || name === null || seen.has(slug)) continue
      seen.add(slug)
      categories.push({ slug, name, count: nonNegative(entry.eventCount) })
    }
  }
  const events: PredictionEventRow[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(body.events) ? body.events : []) {
    const row = eventRowOf(entry)
    if (row === null || seen.has(row.id)) continue
    seen.add(row.id)
    events.push(row)
  }
  return { categories, events, nextCursor: text(body.nextCursor), readAt: readAtOf(body, now) }
}

/** Pages of the hub joined in order, an event the next page repeats kept once — where it first stood. */
export function joinPages(pages: readonly PredictionHub[]): readonly PredictionEventRow[] {
  const seen = new Set<string>()
  const out: PredictionEventRow[] = []
  for (const page of pages) {
    for (const row of page.events) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      out.push(row)
    }
  }
  return out
}

function marketOf(entry: unknown): PredictionMarket | null {
  if (!isObject(entry) || !isPredictionId(entry.id)) return null
  const question = text(entry.question)
  const outcomes = outcomesOf(entry.outcomes)
  if (question === null || outcomes.length === 0) return null
  const rules = isObject(entry.rules) ? [text(entry.rules.primary), text(entry.rules.secondary)] : []
  const joined = rules.filter((part): part is string => part !== null).join('\n\n')
  return {
    id: entry.id,
    question,
    status: statusOf(entry.status),
    outcomes,
    volumeUsd: nonNegative(entry.volume),
    endsAt: isoOrNull(entry.endDate),
    resolvesAt: isoOrNull(entry.resolutionDate),
    rules: joined.length > 0 ? joined : null,
  }
}

/** One event (`GET /api/predictions/events/<id>`); null when the answer holds no event. */
export function parseEvent(raw: unknown, now: number = Date.now()): PredictionEvent | null {
  const body = isObject(raw) ? raw : {}
  const event = isObject(body.event) ? body.event : null
  if (event === null || !isPredictionId(event.id)) return null
  const title = text(event.title)
  if (title === null) return null
  const markets: PredictionMarket[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(event.markets) ? event.markets : []) {
    const market = marketOf(entry)
    if (market === null || seen.has(market.id)) continue
    seen.add(market.id)
    markets.push(market)
  }
  const categories = Array.isArray(event.categories) ? event.categories : []
  const first = categories.find(isObject)
  return {
    id: event.id,
    title,
    image: imageOf(event.image),
    status: statusOf(event.status),
    volumeUsd: nonNegative(event.volume),
    endsAt: isoOrNull(event.endDate),
    venueCount: venueCountOf(event.venues),
    category: first ? text(first.name) : null,
    description: text(event.description),
    settlement: isObject(event.settlement) ? text(event.settlement.sharedSummary) : null,
    markets,
    readAt: readAtOf(body, now),
  }
}

/** An outcome's bars (`GET /api/predictions/outcomes/<id>/chart`): closes in 0 … 1, one per bar, oldest first. */
export function parseLine(raw: unknown, outcomeId: string, now: number = Date.now()): PredictionLine {
  const body = isObject(raw) ? raw : {}
  const chart = isObject(body.chart) ? body.chart : {}
  const byTime = new Map<number, number>()
  for (const bar of Array.isArray(chart.bars) ? chart.bars : []) {
    if (!isObject(bar)) continue
    const t = positive(bar.t)
    const close = probability(bar.c)
    if (t === null || close === null) continue
    byTime.set(Math.floor(t / 1000), close)
  }
  const points = [...byTime.entries()].sort(([a], [b]) => a - b).map(([time, close]) => ({ time, close }))
  const last = positive(chart.lastBarAt)
  return {
    outcomeId,
    points,
    lastAt: last !== null ? Math.floor(last / 1000) : (points.at(-1)?.time ?? null),
    staleSeconds: nonNegative(chart.staleSeconds),
    readAt: readAtOf(body, now),
  }
}

/**
 * A probability as a person reads it: whole percents from 10 % up («74%»), one decimal below («4.2%», «0.1%»), «<0.1%»
 * and «>99.9%» at the edges so a live chance is never written as 0 or 100; a dash when there is no price.
 */
export function chanceText(value: number | null, locale: 'en' | 'uk'): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const pct = value * 100
  const tag = locale === 'uk' ? 'uk-UA' : 'en-US'
  const one = (n: number) => new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(n)
  if (pct > 0 && pct < 0.1) return `<${one(0.1)}%`
  if (pct < 100 && pct > 99.9) return `>${one(99.9)}%`
  if (pct >= 9.95 && pct < 99.5) return `${Math.round(pct)}%`
  return `${one(Math.round(pct * 10) / 10)}%`
}

/** What $10 on an outcome would return if it wins, at its price — the web's «$10 → ≈$13.61 if Yes»; null unpriced. */
export function payoutOf(stakeUsd: number, price: number | null): number | null {
  if (price === null || !(price > 0) || price >= 1 || !(stakeUsd > 0)) return null
  return stakeUsd / price
}

/** Under this, a closing time is said as what is left («1d 7h»); further away, as its day. */
export const CLOSE_SOON_MS = 48 * 3_600_000

/** What is left until a moment, in days and hours or hours and minutes («1d 7h», «5h 20m» · «1 д 7 год»); null if past. */
export function leftText(untilMs: number, nowMs: number, locale: 'en' | 'uk'): string | null {
  const left = untilMs - nowMs
  if (!Number.isFinite(left) || left <= 0) return null
  const minutes = Math.max(1, Math.floor(left / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  const unit = locale === 'uk' ? { d: ' д', h: ' год', m: ' хв' } : { d: 'd', h: 'h', m: 'm' }
  if (days > 0) return hours > 0 ? `${days}${unit.d} ${hours}${unit.h}` : `${days}${unit.d}`
  if (hours > 0) return mins > 0 ? `${hours}${unit.h} ${mins}${unit.m}` : `${hours}${unit.h}`
  return `${mins}${unit.m}`
}

/** An event still to trade: open, and not past its closing time when it names one. */
export const tradable = (row: Readonly<{ status: PredictionStatus; endsAt: string | null }>, nowMs: number): boolean =>
  row.status === 'open' && (row.endsAt === null || Date.parse(row.endsAt) > nowMs)

/** An outcome's own word: «Так» and «Ні» for the venues' Yes and No, any other label as the venue writes it. */
export function outcomeWord(label: string, locale: 'en' | 'uk'): string {
  const lower = label.toLowerCase()
  if (lower === 'yes') return locale === 'uk' ? 'Так' : 'Yes'
  if (lower === 'no') return locale === 'uk' ? 'Ні' : 'No'
  return label
}

/** Past this beyond its bar's own length, a chance line is marked as not updated for a while. */
export const LINE_STALE_SECONDS = 15 * 60

/** A bar's length in seconds for each range's resolution. */
export const BAR_SECONDS: Readonly<Record<PredictionRange, number>> = { '1w': 3_600, '3m': 86_400 }

/**
 * Whether a chance line is stale. The route counts `staleSeconds` from the newest bar's opening, so a live hourly
 * market reads up to an hour «old» at the end of every hour: only what lies past the bar's own length counts.
 */
export const lineStale = (line: Readonly<{ staleSeconds: number | null }>, range: PredictionRange): boolean =>
  line.staleSeconds !== null && line.staleSeconds - BAR_SECONDS[range] > LINE_STALE_SECONDS
