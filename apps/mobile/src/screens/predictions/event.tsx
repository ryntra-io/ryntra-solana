import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, RefreshControl, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { DoorRow } from '@/components/door-row'
import { FactRow } from '@/components/fact-row'
import { HelpDot } from '@/components/help-dot'
import { PriceChart } from '@/components/price-chart'
import { Screen } from '@/components/screen'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { PREDICTIONS_COPY } from '@/features/predictions/predictions-copy'
import {
  chanceText,
  leadingOutcome,
  lineStale,
  outcomeWord,
  payoutOf,
  PREDICTION_RANGES,
  tradable,
  type PredictionEvent,
  type PredictionMarket,
  type PredictionOutcome,
  type PredictionRange,
} from '@/features/predictions/predictions-model'
import { usePredictionEvent, usePredictionLine } from '@/features/predictions/use-predictions'
import { PREDICTIONS_PATH } from '@/features/shell/places'
import { useNow } from '@/hooks/use-now'
import { isNetworkError, isNotFound, type Candle } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { cn } from '@/utils/cn'
import { formatClock, formatDay, formatUsd, formatUsdCompact } from '@/utils/format'

import { closesLine, EventImage } from './index'
import { TicketSheet } from './ticket'

const clockOf = (at: number) => formatClock(new Date(at).toISOString())

/** How many of an event's markets show before «Усі ринки»: the picked market's card stays a short scroll away. */
const MARKETS_SHOWN = 5

/** The chance of «Yes» over a week or three months, as the phone's line: a share of one, written in percent. */
function ChanceChart({ outcome }: { outcome: PredictionOutcome }) {
  const words = useCopy(PREDICTIONS_COPY)
  const locale = useLocale()
  const [range, setRange] = useState<PredictionRange>('1w')
  const line = usePredictionLine(outcome.id, range)
  const candles: Candle[] = useMemo(
    () =>
      (line.data?.points ?? []).map((point) => ({
        time: point.time,
        open: point.close,
        high: point.close,
        low: point.close,
        close: point.close,
      })),
    [line.data],
  )
  const choices: readonly Choice<PredictionRange>[] = PREDICTION_RANGES.map((value) => ({
    value,
    label: words.ranges[value],
  }))
  let body
  if (line.data && candles.length >= 2) {
    body = (
      <View className="gap-2">
        <PriceChart
          candles={candles}
          timeframe={range === '1w' ? '1h' : '1d'}
          locale={locale}
          figure={(value) => chanceText(value, locale)}
        />
        <Txt variant="labelSm" tone={lineStale(line.data, range) ? 'warning' : 'faint'}>
          {[words.chance, clockOf(line.data.readAt), lineStale(line.data, range) ? words.stale : null]
            .filter(Boolean)
            .join(' · ')}
        </Txt>
      </View>
    )
  } else if (line.data) {
    body = (
      <View className="h-44 items-center justify-center px-4">
        <Txt variant="ui" tone="muted" className="text-center">
          {words.chartNone}
        </Txt>
      </View>
    )
  } else if (line.isPending) {
    body = (
      <Skeleton className="h-44 w-full rounded-sm" accessibilityRole="progressbar" accessibilityLabel={words.chart} />
    )
  } else {
    body = (
      <View className="h-44 items-center justify-center gap-2 px-4">
        <Txt variant="ui" tone="muted" className="text-center">
          {isNetworkError(line.error) ? words.noConnection : words.chartLine}
        </Txt>
        <Button title={words.tryAgain} variant="ghost" size="sm" onPress={() => void line.refetch()} />
      </View>
    )
  }
  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <Txt variant="label" tone="faint">
          {words.chart}
        </Txt>
        <ChoiceChips choices={choices} value={range} onChange={setRange} size="sm" />
      </View>
      {body}
    </View>
  )
}

/** One market of the event, to pick: its question and the chance of «Yes» beside it. */
function MarketRow({
  market,
  selected,
  onPress,
  last,
}: {
  market: PredictionMarket
  selected: boolean
  onPress: () => void
  last: boolean
}) {
  const words = useCopy(PREDICTIONS_COPY)
  const locale = useLocale()
  const lead = leadingOutcome(market.outcomes)
  const label = lead ? outcomeWord(lead.label, locale) : words.yes
  const chance = chanceText(lead?.probability ?? null, locale)
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${market.question}, ${words.chanceA11y(chance, label)}`}
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-3 rounded-sm px-2 py-2.5 active:bg-hover',
        selected ? 'bg-hover' : '',
        last ? '' : 'border-b border-line',
      )}
    >
      <View className={cn('h-2 w-2 rounded-pill', selected ? 'bg-brand' : 'bg-transparent')} />
      <Txt variant="ui" numberOfLines={2} className="flex-1" tone={market.status === 'open' ? 'fg' : 'muted'}>
        {market.question}
      </Txt>
      <Txt variant="data">{chance}</Txt>
    </Pressable>
  )
}

/** The selected market: the outcomes' chances, the chart of «Yes», what $10 returns, buy and the rules. */
function MarketCard({
  event,
  market,
  now,
  onBuy,
}: {
  event: PredictionEvent
  market: PredictionMarket
  now: number
  onBuy: (outcome: PredictionOutcome) => void
}) {
  const words = useCopy(PREDICTIONS_COPY)
  const locale = useLocale()
  const [rules, setRules] = useState(false)
  const lead = leadingOutcome(market.outcomes)
  const open = tradable(market, now) && event.status === 'open'
  const shown = market.outcomes
  return (
    <Card className="gap-4">
      <Txt variant="title">{market.question}</Txt>
      <View className="flex-row flex-wrap gap-2">
        {shown.map((outcome) => {
          const label = outcomeWord(outcome.label, locale)
          const chance = chanceText(outcome.probability, locale)
          const payout = payoutOf(10, outcome.probability)
          return (
            <Pressable
              key={outcome.id}
              accessibilityRole="button"
              accessibilityLabel={`${words.buy(label)}, ${words.chanceA11y(chance, label)}`}
              accessibilityState={{ disabled: !open }}
              disabled={!open}
              onPress={() => onBuy(outcome)}
              style={{ flexBasis: shown.length > 2 ? '45%' : 0 }}
              className="grow items-center gap-0.5 rounded-md border border-line bg-surface px-2 py-3 active:bg-hover"
            >
              <Txt variant="ui" tone={open ? 'fg' : 'muted'} numberOfLines={1}>
                {label}
              </Txt>
              <Txt variant="dataLg" tone={open ? 'fg' : 'muted'}>
                {chance}
              </Txt>
              <Txt variant="labelSm" tone="faint" numberOfLines={1}>
                {payout !== null ? `$10 → ≈ ${formatUsd(payout, locale)}` : '—'}
              </Txt>
            </Pressable>
          )
        })}
      </View>
      {open ? null : (
        <Txt variant="ui" tone="muted">
          {market.status === 'resolved'
            ? words.status.resolved
            : market.status === 'unknown'
              ? words.status.unknown
              : words.closedLine}
        </Txt>
      )}
      {lead ? <ChanceChart outcome={lead} /> : null}
      <View>
        <FactRow label={words.volume} value={formatUsdCompact(market.volumeUsd, locale)} />
        <FactRow label={words.ends} value={formatDay(market.endsAt ?? event.endsAt, now, locale)} />
        {market.resolvesAt ? (
          <FactRow label={words.resolves} value={formatDay(market.resolvesAt, now, locale)} />
        ) : null}
        <DoorRow icon="document-text-outline" label={words.rules} onPress={() => setRules(true)} last />
      </View>
      <Sheet visible={rules} title={words.rulesTitle} subtitle={market.question} onClose={() => setRules(false)} scroll>
        <View className="gap-3 pb-4">
          {event.settlement ? (
            <Txt variant="body" tone="muted">
              {event.settlement}
            </Txt>
          ) : null}
          <Txt variant="body">{market.rules ?? (event.settlement ? null : words.rulesNone)}</Txt>
        </View>
      </Sheet>
    </Card>
  )
}

/**
 * One event of «Прогнози» (M12): its picture and title, how much has traded and when it ends; its markets to pick
 * from, the busiest first; the picked market's chances, the chart of «Yes», its rules and the simulated ticket. Read
 * again every 20 s while open.
 */
export function PredictionEventScreen({ eventId }: { eventId: string }) {
  const router = useRouter()
  const words = useCopy(PREDICTIONS_COPY)
  const shared = useSharedCopy()
  const locale = useLocale()
  const { colors } = useTheme()
  const now = useNow(30_000)
  const read = usePredictionEvent(eventId)
  const [picked, setPicked] = useState<string | null>(null)
  const [everyMarket, setEveryMarket] = useState(false)
  const [buying, setBuying] = useState<Readonly<{ market: PredictionMarket; outcome: PredictionOutcome }> | null>(null)
  const [pulled, setPulled] = useState(false)
  const back = () => (router.canGoBack() ? router.back() : router.replace(PREDICTIONS_PATH as never))
  const event = read.data ?? null

  if (!event) {
    let body
    if (read.isPending) {
      body = (
        <View className="gap-3 px-4">
          <Skeleton className="h-16 w-full rounded-sm" />
          <Skeleton className="h-64 w-full rounded-sm" />
        </View>
      )
    } else if (read.data === null || isNotFound(read.error)) {
      body = (
        <StateView
          icon="help-circle-outline"
          title={words.notFound}
          action={{ title: words.backToPredictions, onPress: () => router.replace(PREDICTIONS_PATH as never) }}
        />
      )
    } else {
      const offline = isNetworkError(read.error)
      body = (
        <StateView
          icon={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
          tone="danger"
          title={offline ? words.noConnection : words.down}
          detail={offline ? words.needsNetwork : words.downLine}
          action={{ title: words.tryAgain, onPress: () => void read.refetch(), loading: read.isFetching }}
        />
      )
    }
    return (
      <Screen title={words.helpTitle} onBack={back} backLabel={shared.back} scroll={false}>
        {body}
      </Screen>
    )
  }

  const market = event.markets.find((entry) => entry.id === picked) ?? event.markets[0] ?? null
  // A long event shows its busiest markets and the one picked; the rest one tap away, the picked market's card in reach.
  const folded = event.markets.length > MARKETS_SHOWN && !everyMarket
  const listed = folded
    ? event.markets.filter((entry, index) => index < MARKETS_SHOWN || entry.id === market?.id)
    : event.markets
  const closes = closesLine(event.endsAt, now, words, locale)
  const pull = () => {
    setPulled(true)
    void read.refetch().finally(() => setPulled(false))
  }

  return (
    <Screen
      title={words.helpTitle}
      onBack={back}
      backLabel={shared.back}
      right={<HelpDot title={words.helpTitle} body={words.help} />}
      refreshControl={
        <RefreshControl
          refreshing={pulled}
          onRefresh={pull}
          tintColor={colors.brand}
          colors={[colors.brand]}
          progressBackgroundColor={colors.surface}
        />
      }
    >
      <View className="gap-3">
        <View className="flex-row items-start gap-3">
          <EventImage uri={event.image} title={event.title} size={56} />
          <View className="min-w-0 flex-1 gap-1">
            <Txt variant="title" accessibilityRole="header">
              {event.title}
            </Txt>
            <View className="flex-row flex-wrap items-center gap-2">
              <Chip label={words.simulationChip} tone="evidence" caps={false} />
              {event.status !== 'open' ? <Chip label={words.status[event.status]} caps={false} /> : null}
            </View>
          </View>
        </View>
        <Txt variant="labelSm" tone="faint">
          {[
            `${words.volume} ${formatUsdCompact(event.volumeUsd, locale)}`,
            closes,
            event.venueCount > 0 ? words.venues(event.venueCount) : null,
            clockOf(event.readAt),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Txt>
      </View>
      {event.markets.length > 1 ? (
        <Card className="gap-1" accessibilityRole="radiogroup" accessibilityLabel={words.markets}>
          <Txt variant="label" tone="faint" className="pb-1">
            {words.markets}
          </Txt>
          {listed.map((entry, index) => (
            <MarketRow
              key={entry.id}
              market={entry}
              selected={entry.id === market?.id}
              onPress={() => setPicked(entry.id)}
              last={index === listed.length - 1 && event.markets.length <= MARKETS_SHOWN}
            />
          ))}
          {event.markets.length > MARKETS_SHOWN ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setEveryMarket(folded)}
              className="px-2 py-2.5 active:bg-hover"
            >
              <Txt variant="ui" tone="brand">
                {folded ? words.everyMarket(event.markets.length) : words.fewerPositions}
              </Txt>
            </Pressable>
          ) : null}
        </Card>
      ) : null}
      {market ? (
        <MarketCard event={event} market={market} now={now} onBuy={(outcome) => setBuying({ market, outcome })} />
      ) : (
        <StateView icon="list-outline" title={words.noEvents} />
      )}
      {buying ? (
        <TicketSheet event={event} market={buying.market} outcome={buying.outcome} onClose={() => setBuying(null)} />
      ) : null}
    </Screen>
  )
}
