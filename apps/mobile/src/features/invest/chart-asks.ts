import { ApiError } from '../../lib/api.ts'

/**
 * How the page's chart asks the candles route (ST-5 r10: SGOVx's line said «Графік зараз не відповідає» when the asset
 * simply has no chart — the route answers 404 `CANDLES_THIN` for every timeframe, and four or five asks at once met the
 * server's limiter, whose 429 read as «busy»). Three answers, three meanings: a 404 or `CANDLES_THIN` is no chart for
 * that range — the asset's own answer, never asked again; a 429 is a quiet wait for the window the server names (else
 * five seconds) and then one ask — never «не відповідає»; anything else is the route not answering. The other ranges
 * are asked one at a time, each only once the one before it is known empty — never in a burst.
 */

/** The range has no chart: the route's 404 (`CANDLES_THIN`, a market it does not know). */
export function noChart(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.code === 'CANDLES_THIN')
}

/** The server's limiter refused the ask: a wait, never «the chart is not answering». */
export function chartLimited(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 429 || /RATE_LIMITED/.test(error.code))
}

/** The wait when the refusal names none. */
export const CHART_LIMIT_WAIT_MS = 5_000
/** The longest named wait kept, and the margin past it — the window's own edge is not raced. */
const NAMED_MAX_S = 60
const MARGIN_MS = 250

/** How long to wait before the one ask after a limiter's refusal: the wait it names (≤ 60 s), else five seconds. */
export function chartLimitWaitMs(error: unknown): number {
  const named = error instanceof ApiError ? error.details.retryAfterSeconds : null
  return typeof named === 'number' && Number.isFinite(named) && named > 0
    ? Math.min(named, NAMED_MAX_S) * 1000 + MARGIN_MS
    : CHART_LIMIT_WAIT_MS
}

/** What one range's read says: no line for it, a line, or not known yet (being asked, waiting, or not answering). */
export type RangeRead = 'empty' | 'drawn' | 'unknown'

/** One range's read from its candles query: the bars it holds in the range, or the refusal. */
export function rangeRead(
  input: Readonly<{ hasData: boolean; bars: number; error: unknown }>,
): RangeRead {
  if (input.hasData) return input.bars >= 2 ? 'drawn' : 'empty'
  return noChart(input.error) ? 'empty' : 'unknown'
}

/**
 * How many of the other ranges, in order, are known empty — the next one, at that index, is the only one asked; past
 * the last every range is known empty.
 */
export function rangesKnownEmpty(reads: readonly RangeRead[]): number {
  let known = 0
  while (known < reads.length && reads[known] === 'empty') known += 1
  return known
}
