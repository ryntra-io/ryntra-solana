import { useQueries } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'

import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { Icon } from '@/components/icon'
import { PriceChart } from '@/components/price-chart'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { BUY_COPY } from '@/features/invest/buy-copy'
import { chartLimited, chartLimitWaitMs, noChart, rangeRead, rangesKnownEmpty } from '@/features/invest/chart-asks'
import { moneyShort, venueName } from '@/features/invest/company-facts'
import { INVEST_COPY } from '@/features/invest/copy'
import { DETAILS_COPY, type DetailsCopy } from '@/features/invest/details-copy'
import { PRO_CHART_COPY } from '@/features/pro-chart/copy'
import { candlesRetry, useCandles } from '@/hooks/use-market'
import { useNow } from '@/hooks/use-now'
import { fetchCandles, isNetworkError, TIMEFRAME_TTL_MS, type Timeframe } from '@/lib/api'
import {
  barMiddles,
  CHART_RANGES,
  coarserBars,
  historyStartsLate,
  RANGE_DRAWS_MIDDLES,
  RANGE_SOURCE,
  RANGE_STEP_SECONDS,
  rangeCandles,
  rangeChangePct,
  type ChartRange,
} from '@/lib/chart'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'
import { readPreference, writePreference } from '@/lib/preferences'
import { formatClock, formatDay, formatPercent, percentSignOf } from '@/utils/format'

const TIMEFRAMES = ['5m', '1h', '4h', '1d'] as const satisfies readonly Timeframe[]
const TIMEFRAME_KEY = 'chart.timeframe'

/** Whose price this is: the pool, its venue and the chart source, in one line, in the person's language. */
function poolLine(
  pool: { name: string; dex: string | null; reserveUsd: number | null },
  source: string,
  words: DetailsCopy,
  locale: Locale,
): string {
  // The venue by its name («Raydium»), never its slug («raydium-clmm») — as «Факти за цифрами» says it.
  const dex = venueName(pool.dex)
  return [
    pool.name,
    dex,
    pool.reserveUsd !== null ? words.inPool(moneyShort(pool.reserveUsd, locale) ?? '—') : null,
    source,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The chart from the deepest pool the source knows for the mint, at the
 * timeframe chosen. A refresh that fails keeps the last read and says so;
 * a market with no chart says why, in the source's words.
 *
 * `glance` is the page's own line at rest: the price alone, in the
 * person's language, over a day, a week, a month or half a year (the web's
 * ranges, its year half a year until the candles route serves one; M15), a day
 * drawn through the middle of each quarter hour folded from its five-minute
 * bars, its figures said as «≈», so a pool trading on both sides of a wide
 * spread does not zigzag the line — the change over the range said over the
 * line, a longer range's from closes and the day's the venue's 24 hours
 * (`dayChangePct`, the head's own figure), so the line is there for every
 * range and the chips never jump under a finger; a history younger than the
 * range said as «з …» rather than called half a year; whose pool and which
 * source drew it is said only when `source` is on — under the page's «Деталі».
 */
export function ChartCard({
  mint,
  glance = false,
  source = true,
  dayChangePct = null,
  pro = null,
}: {
  mint: string
  glance?: boolean
  source?: boolean
  /** The venue's 24 h change the page's head shows — the day range's own line, never a second figure for it. */
  dayChangePct?: number | null
  /** The door to the professional chart (CH-21) beside the range's line, with the symbol it names; none without it. */
  pro?: Readonly<{ symbol: string; open: () => void }> | null
}) {
  const words = useCopy(INVEST_COPY)
  const proWords = useCopy(PRO_CHART_COPY)
  const buyWords = useCopy(BUY_COPY)
  const detailWords = useCopy(DETAILS_COPY)
  const locale = useLocale()
  const now = useNow(60_000)
  const [timeframe, setTimeframeState] = useState<Timeframe>(() => readPreference(TIMEFRAME_KEY, TIMEFRAMES, '1h'))
  const timeframes: readonly Choice<Timeframe>[] = TIMEFRAMES.map((value) => ({
    value,
    label: detailWords.timeframes[value].label,
    accessibilityLabel: detailWords.timeframes[value].a11y,
  }))
  const [range, setRange] = useState<ChartRange>('1d')
  const candles = useCandles(mint, glance ? RANGE_SOURCE[range].timeframe : timeframe)
  const setTimeframe = (next: Timeframe) => {
    setTimeframeState(next)
    writePreference(TIMEFRAME_KEY, next)
  }
  const data = candles.data
  // The range's own bars, closes as traded: what its change is said from.
  const bars = data
    ? glance
      ? coarserBars(rangeCandles(data.candles, range, now), RANGE_STEP_SECONDS[range])
      : data.candles
    : []
  // A day's line through each quarter hour's middle, so a pool trading both sides of its spread does not zigzag it.
  const middles = glance && RANGE_DRAWS_MIDDLES[range]
  const drawn = middles ? barMiddles(bars) : bars
  /* A range with no prices is that range's, never the asset's (ST-5 r9: SGOVx's day not found, its months drawn): each
     range tries on its own, and only when every range is read empty does the line say the asset has no chart. The
     other ranges are read, as their chips would read them, only once the chosen one is empty — one at a time, each
     only after the one before it is known empty (ST-5 r10: four asks at once met the server's limiter). */
  const limited = chartLimited(candles.error)
  const currentEmpty = glance && (data ? bars.length < 2 : noChart(candles.error))
  const others = CHART_RANGES.filter((value) => value !== range)
  const [asked, setAsked] = useState(0)
  const probes = useQueries({
    queries: others.map((value, index) => {
      const timeframe = RANGE_SOURCE[value].timeframe
      const ttl = Math.max(TIMEFRAME_TTL_MS[timeframe], 60_000)
      return {
        queryKey: ['candles', mint, timeframe],
        queryFn: ({ signal }: { signal: AbortSignal }) => fetchCandles(mint, timeframe, signal),
        staleTime: ttl,
        retry: candlesRetry,
        enabled: currentEmpty && index <= asked,
      }
    }),
  })
  const reads = probes.map((probe, index) => {
    const value = others[index]
    return rangeRead({
      hasData: probe.data !== undefined,
      bars: probe.data
        ? coarserBars(rangeCandles(probe.data.candles, value, now), RANGE_STEP_SECONDS[value]).length
        : 0,
      error: probe.error,
    })
  })
  const known = rangesKnownEmpty(reads)
  // The next range is asked once the one before it is known empty (state adjusted during render, as React prescribes).
  if (currentEmpty && known !== asked) setAsked(known)
  const everyRangeEmpty = currentEmpty && known === others.length

  /* A limiter's refusal is a quiet wait — the window it names, else five seconds — and then one ask (ST-5 r10): of the
     chosen range, else of the range being read in turn. Never «не відповідає». */
  const inHand = currentEmpty && known < probes.length ? probes[known] : null
  const inHandLimited = inHand !== null && chartLimited(inHand.error)
  const limitError = limited ? candles.error : inHandLimited ? inHand.error : null
  const limitKey = limited
    ? `range:${candles.errorUpdatedAt}`
    : inHandLimited
      ? `probe:${others[known]}:${inHand.errorUpdatedAt}`
      : null
  const limitWait = limitError ? chartLimitWaitMs(limitError) : 0
  const askAfterWait = useRef<(() => unknown) | null>(null)
  const refetchRange = candles.refetch
  const refetchInHand = inHand?.refetch ?? null
  useEffect(() => {
    askAfterWait.current = limited ? refetchRange : inHandLimited ? refetchInHand : null
  })
  useEffect(() => {
    if (limitKey === null) return
    const timer = setTimeout(() => void askAfterWait.current?.(), limitWait)
    return () => clearTimeout(timer)
  }, [limitKey, limitWait])
  const ranges: readonly Choice<ChartRange>[] = CHART_RANGES.map((value) =>
    value === '6m'
      ? { value, label: words.halfYearChip, accessibilityLabel: words.halfYearChipA11y }
      : { value, label: buyWords.rangeLabel[value], accessibilityLabel: buyWords.rangeLabelA11y[value] },
  )

  const empty = (notFound: boolean, error: unknown) => (
    <View className="h-44 items-center justify-center gap-2 px-4">
      <Icon
        name={notFound ? 'analytics-outline' : isNetworkError(error) ? 'cloud-offline-outline' : 'time-outline'}
        size={24}
        color="fgMuted"
      />
      <Txt variant="ui" className="text-center">
        {glance
          ? notFound
            ? everyRangeEmpty
              ? words.chartNone
              : words.chartRangeNone
            : isNetworkError(error)
              ? words.noConnection
              : words.chartBusy
          : notFound
            ? detailWords.chartNone
            : isNetworkError(error)
              ? detailWords.chartNoConnection
              : detailWords.chartBusy}
      </Txt>
      {glance || !error ? null : (
        <Txt variant="ui" tone="faint" className="text-center">
          {/* The app's own words, never the server's raw message (ST-5 r9). */}
          {isNetworkError(error) ? detailWords.chartNeedsNetwork : detailWords.chartBusyLine}
        </Txt>
      )}
      {notFound ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={glance ? words.tryAgain : detailWords.chartRetry}
          onPress={() => void candles.refetch()}
          className="mt-1 h-9 items-center justify-center rounded-btn border border-line bg-surface px-4 active:bg-hover"
        >
          <Txt variant="ui">{glance ? words.tryAgain : detailWords.tryAgain}</Txt>
        </Pressable>
      )}
    </View>
  )

  // A refresh the limiter held back is being asked again after its window: not a failure to say (ST-5 r10).
  const refreshFailed = candles.isError && !limited
  let body
  if (data && (!glance || bars.length >= 2)) {
    // Every range says its change in the same line, so the chips under the chart stay put: a longer range from its
    // closes, the day as the head's own 24 h figure — one figure for the day, never a second one from the bars.
    const change = range === '1d' ? dayChangePct : rangeChangePct(bars)
    const late = glance && range !== '1d' && historyStartsLate(bars, range, now)
    const move = percentSignOf(change)
    const rangeWord = range === '1d' ? words.today : range === '6m' ? words.halfYearName : buyWords.rangeName[range]
    body = (
      <View className="gap-2">
        {glance ? (
          <View className="flex-row items-center justify-between gap-3">
            {/* The day's change is the head's own line right above (ST-5 r7: «+1,52% за добу» said twice): on the day's
                range the line keeps its place, unseen and unread, so the chips under the chart never move. */}
            <Txt
              variant="ui"
              tabular
              numberOfLines={1}
              className="shrink"
              tone={move === 'up' ? 'success' : move === 'down' ? 'danger' : 'faint'}
              style={range === '1d' ? { opacity: 0 } : undefined}
              accessibilityElementsHidden={range === '1d'}
              importantForAccessibility={range === '1d' ? 'no-hide-descendants' : 'auto'}
            >
              {`${formatPercent(change, locale)} ${
                late && bars[0]
                  ? buyWords.since(formatDay(new Date(bars[0].time * 1000).toISOString(), now, locale))
                  : rangeWord
              }`}
            </Txt>
            {pro ? (
              // The core's chart, the web's own, one press deep (CH-21); this line stays the page's simple chart.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={proWords.doorA11y(pro.symbol)}
                onPress={pro.open}
                hitSlop={8}
                className="-my-1.5 min-h-9 flex-row items-center gap-1.5 rounded-pill px-2 active:bg-hover"
              >
                <Icon name="expand-outline" size={16} color="muted" />
                <Txt variant="ui" tone="muted" numberOfLines={1}>
                  {proWords.door}
                </Txt>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <PriceChart
          candles={drawn}
          timeframe={glance ? RANGE_SOURCE[range].timeframe : data.timeframe}
          locale={locale}
          approx={middles}
        />
        {source || data.stale || refreshFailed ? (
          <View className="flex-row flex-wrap items-center gap-2">
            {source ? (
              <Txt variant="labelSm" tone="faint" className="flex-1" numberOfLines={2}>
                {`${poolLine(data.pool, data.source.label, detailWords, locale)} · ${formatClock(data.observedAt)}`}
              </Txt>
            ) : null}
            {glance ? (
              data.stale || refreshFailed ? (
                <Txt variant="labelSm" tone="warning">
                  {`${formatClock(data.observedAt)} · ${words.notUpdated}`}
                </Txt>
              ) : null
            ) : (
              <>
                {data.stale ? <Chip label={detailWords.chartStale} tone="warning" /> : null}
                {refreshFailed ? <Chip label={detailWords.chartRefreshFailed} tone="warning" caps={false} /> : null}
              </>
            )}
          </View>
        ) : null}
      </View>
    )
  } else if (data) {
    // The range holds fewer than two prices: no line to draw for it.
    body = empty(true, null)
  } else if (candles.isPending || limited) {
    body = (
      <Skeleton
        className="h-44 w-full rounded-sm"
        accessibilityRole="progressbar"
        accessibilityLabel={detailWords.loadingChart}
      />
    )
  } else {
    body = empty(noChart(candles.error), candles.error)
  }

  return (
    <Card className="gap-3">
      {glance ? null : (
        <View className="flex-row items-center justify-between gap-3">
          <Txt variant="title">{detailWords.chart}</Txt>
          <ChoiceChips choices={timeframes} value={timeframe} onChange={setTimeframe} size="sm" />
        </View>
      )}
      {body}
      {glance && !everyRangeEmpty ? (
        <View accessibilityLabel={buyWords.chartRange}>
          <ChoiceChips choices={ranges} value={range} onChange={setRange} quiet fill size="sm" />
        </View>
      ) : null}
    </Card>
  )
}
