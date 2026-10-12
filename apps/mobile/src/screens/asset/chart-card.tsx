import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { Icon } from '@/components/icon'
import { PriceChart } from '@/components/price-chart'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { BUY_COPY } from '@/features/invest/buy-copy'
import { INVEST_COPY } from '@/features/invest/copy'
import { DETAILS_COPY, type DetailsCopy } from '@/features/invest/details-copy'
import { useCandles } from '@/hooks/use-market'
import { useNow } from '@/hooks/use-now'
import { isNetworkError, isNotFound, type Timeframe } from '@/lib/api'
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
import { formatClock, formatDay, formatPercent, formatUsdCompact, signOf } from '@/utils/format'

const TIMEFRAMES = ['5m', '1h', '4h', '1d'] as const satisfies readonly Timeframe[]
const TIMEFRAME_KEY = 'chart.timeframe'

/** Whose price this is: the pool, its venue and the chart source, in one line, in the person's language. */
function poolLine(
  pool: { name: string; dex: string | null; reserveUsd: number | null },
  source: string,
  words: DetailsCopy,
  locale: Locale,
): string {
  const dex = pool.dex ? pool.dex.replace(/-/g, ' ') : null
  return [
    pool.name,
    dex,
    pool.reserveUsd !== null ? words.inPool(formatUsdCompact(pool.reserveUsd, locale)) : null,
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
 * `simple` is «Простий»'s line: the price alone, in the
 * person's language, over a day, a week, a month or a year (the web's own four
 * ranges), a day drawn through the middle of each quarter hour folded
 * from its five-minute bars, its figures said as «≈», so a pool trading on
 * both sides of a wide spread does not zigzag the line — the change over
 * a longer range said under the line from closes, a history
 * younger than the range said as «з …» rather than called a year; whose pool
 * and which source drew it is said only when `source` is on — under the page's
 * «Деталі».
 */
export function ChartCard({
  mint,
  simple = false,
  source = true,
}: {
  mint: string
  simple?: boolean
  source?: boolean
}) {
  const words = useCopy(INVEST_COPY)
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
  const candles = useCandles(mint, simple ? RANGE_SOURCE[range].timeframe : timeframe)
  const setTimeframe = (next: Timeframe) => {
    setTimeframeState(next)
    writePreference(TIMEFRAME_KEY, next)
  }
  const data = candles.data
  // The range's own bars, closes as traded: what its change is said from.
  const bars = data
    ? simple
      ? coarserBars(rangeCandles(data.candles, range, now), RANGE_STEP_SECONDS[range])
      : data.candles
    : []
  // A day's line through each quarter hour's middle, so a pool trading both sides of its spread does not zigzag it.
  const middles = simple && RANGE_DRAWS_MIDDLES[range]
  const drawn = middles ? barMiddles(bars) : bars
  const ranges: readonly Choice<ChartRange>[] = CHART_RANGES.map((value) => ({
    value,
    label: buyWords.rangeLabel[value],
    accessibilityLabel: buyWords.rangeLabelA11y[value],
  }))

  const empty = (notFound: boolean, error: unknown) => (
    <View className="h-44 items-center justify-center gap-2 px-4">
      <Icon
        name={notFound ? 'analytics-outline' : isNetworkError(error) ? 'cloud-offline-outline' : 'time-outline'}
        size={24}
        color="fgMuted"
      />
      <Txt variant="ui" className="text-center">
        {simple
          ? notFound
            ? words.chartNone
            : isNetworkError(error)
              ? words.noConnection
              : words.chartBusy
          : notFound
            ? detailWords.chartNone
            : isNetworkError(error)
              ? detailWords.chartNoConnection
              : detailWords.chartBusy}
      </Txt>
      {simple || !error ? null : (
        <Txt variant="ui" tone="faint" className="text-center">
          {isNetworkError(error)
            ? detailWords.chartNeedsNetwork
            : locale === 'en'
              ? (error as Error).message
              : detailWords.chartBusyLine}
        </Txt>
      )}
      {notFound ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={simple ? words.tryAgain : detailWords.chartRetry}
          onPress={() => void candles.refetch()}
          className="mt-1 h-9 items-center justify-center rounded-btn border border-line bg-surface px-4 active:bg-hover"
        >
          <Txt variant="ui">{simple ? words.tryAgain : detailWords.tryAgain}</Txt>
        </Pressable>
      )}
    </View>
  )

  let body
  if (data && (!simple || bars.length >= 2)) {
    // A longer range says its own change; the day's is the head's, never said twice.
    const change = simple && range !== '1d' ? rangeChangePct(bars) : null
    const late = simple && historyStartsLate(bars, range, now)
    const move = signOf(change)
    body = (
      <View className="gap-2">
        {simple && range !== '1d' ? (
          <Txt variant="ui" tabular tone={move === 'up' ? 'success' : move === 'down' ? 'danger' : 'faint'}>
            {`${formatPercent(change, locale)} ${
              late && bars[0]
                ? buyWords.since(formatDay(new Date(bars[0].time * 1000).toISOString(), now, locale))
                : buyWords.rangeName[range]
            }`}
          </Txt>
        ) : null}
        <PriceChart
          candles={drawn}
          timeframe={simple ? RANGE_SOURCE[range].timeframe : data.timeframe}
          locale={locale}
          approx={middles}
        />
        {source || data.stale || candles.isError ? (
          <View className="flex-row flex-wrap items-center gap-2">
            {source ? (
              <Txt variant="labelSm" tone="faint" className="flex-1" numberOfLines={2}>
                {`${poolLine(data.pool, data.source.label, detailWords, locale)} · ${formatClock(data.observedAt)}`}
              </Txt>
            ) : null}
            {simple ? (
              data.stale || candles.isError ? (
                <Txt variant="labelSm" tone="warning">
                  {`${formatClock(data.observedAt)} · ${words.notUpdated}`}
                </Txt>
              ) : null
            ) : (
              <>
                {data.stale ? <Chip label={detailWords.chartStale} tone="warning" /> : null}
                {candles.isError ? <Chip label={detailWords.chartRefreshFailed} tone="warning" caps={false} /> : null}
              </>
            )}
          </View>
        ) : null}
      </View>
    )
  } else if (data) {
    // The range holds fewer than two prices: no line to draw for it.
    body = empty(true, null)
  } else if (candles.isPending) {
    body = (
      <Skeleton
        className="h-44 w-full rounded-sm"
        accessibilityRole="progressbar"
        accessibilityLabel={detailWords.loadingChart}
      />
    )
  } else {
    body = empty(isNotFound(candles.error), candles.error)
  }

  return (
    <Card className="gap-3">
      {simple ? null : (
        <View className="flex-row items-center justify-between gap-3">
          <Txt variant="title">{detailWords.chart}</Txt>
          <ChoiceChips choices={timeframes} value={timeframe} onChange={setTimeframe} size="sm" />
        </View>
      )}
      {body}
      {simple && !(candles.isError && isNotFound(candles.error)) ? (
        <View accessibilityLabel={buyWords.chartRange}>
          <ChoiceChips choices={ranges} value={range} onChange={setRange} quiet fill size="sm" />
        </View>
      ) : null}
    </Card>
  )
}
