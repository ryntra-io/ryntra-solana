import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { Icon } from '@/components/icon'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { useRules } from '@/features/autoinvest/use-rules'
import { ruleWhenLine } from '@/features/autoinvest/words'
import { dollarsText } from '@/features/invest/buy-model'
import { NO_TRADE_LABELS, RESULTS_COPY } from '@/features/results/copy'
import {
  forPlan,
  hasAnything,
  legWord,
  memoryLines,
  noTradeSentence,
  positionSentence,
  ruleTallies,
  symbolOf,
  tallyFigure,
  tallyLine,
  verdictOf,
} from '@/features/results/results-model'
import { usePlanMemory, usePlanResults } from '@/features/results/use-results'
import { useAccount } from '@/features/session/use-account'
import { SessionGate } from '@/features/wallet/wallet-gate'
import { useNow } from '@/hooks/use-now'
import { isNetworkError, type PlanMemoryFact, type PlanPositionRow, type PlanResult } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { formatClock, formatMoment, formatUsd } from '@/utils/format'

import { ResultSheet, type Opened } from './result-sheet'

function LoadingRows({ label }: { label: string }) {
  return (
    <View className="px-4 pt-3" accessibilityRole="progressbar" accessibilityLabel={label}>
      <Skeleton className="mb-2 h-16 w-full" />
      {Array.from({ length: 4 }, (_, index) => (
        <View key={index} className="gap-2 border-b border-line py-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3.5 w-48" />
        </View>
      ))}
    </View>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null
  return (
    <View>
      <Txt variant="labelSm" tone="faint" caps className="px-1 pb-1 pt-5" accessibilityRole="header">
        {title} · {count}
      </Txt>
      {children}
    </View>
  )
}

/** One row of Results: what it is about and its state, one figure on the right, one line under; details one tap deep. */
function Row({
  title,
  chips,
  figure,
  figureTone = 'fg',
  figureWords = false,
  line,
  foot,
  onPress,
  last,
}: {
  title: string
  chips?: readonly Readonly<{ label: string; tone: 'neutral' | 'success' | 'danger' | 'warning' | 'brand' }>[]
  figure?: string | null
  figureTone?: 'fg' | 'success' | 'danger' | 'muted'
  /** A figure said in words («Куплено 2 з 3») is set in the text face, not the figures' mono. */
  figureWords?: boolean
  line?: string | null
  foot?: string | null
  onPress: () => void
  last?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, ...(chips ?? []).map((chip) => chip.label), figure, line, foot].filter(Boolean).join(', ')}
      onPress={onPress}
      className={`flex-row items-center gap-3 py-3 active:bg-hover ${last ? '' : 'border-b border-line'}`}
    >
      <View className="flex-1 gap-1">
        <View className="flex-row items-center gap-2">
          <View className="flex-1 flex-row flex-wrap items-center gap-1.5">
            <Txt variant="ui" numberOfLines={1}>
              {title}
            </Txt>
            {(chips ?? []).map((chip) => (
              <Chip key={chip.label} label={chip.label} tone={chip.tone} caps={false} />
            ))}
          </View>
          {figure !== undefined ? (
            <Txt variant={figureWords ? 'ui' : 'data'} tone={figure === null ? 'faint' : figureTone}>
              {figure ?? '—'}
            </Txt>
          ) : null}
        </View>
        {line ? (
          <Txt variant="ui" tone="muted" numberOfLines={2}>
            {line}
          </Txt>
        ) : null}
        {foot ? (
          <Txt variant="labelSm" tone="faint" numberOfLines={1}>
            {foot}
          </Txt>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={18} color="fgMuted" />
    </Pressable>
  )
}

/** The four figures of the summary in one card, with the time they were read. */
function Summary({ figures, at }: { figures: readonly Readonly<{ label: string; spoken: string; value: number }>[]; at: string }) {
  return (
    <View className="gap-1.5 pt-3">
      <Card padded={false} className="flex-row">
        {figures.map((figure, index) => (
          <View
            key={figure.label}
            className={`flex-1 gap-0.5 px-3 py-3 ${index === 0 ? '' : 'border-l border-line'}`}
            accessible
            accessibilityLabel={`${figure.spoken}: ${figure.value}`}
          >
            <Txt variant="dataLg">{figure.value}</Txt>
            <Txt variant="labelSm" tone="faint" numberOfLines={1}>
              {figure.label}
            </Txt>
          </View>
        ))}
      </Card>
      <Txt variant="labelSm" tone="faint" className="px-1">
        {at}
      </Txt>
    </View>
  )
}

/**
 * Results (M13) — what happened against what was planned, the phone's own
 * screen over the contract where a ↗ to ryntra.io stood: each «Автоінвест»
 * rule's reminders against what was bought; the positions under a plan; the
 * plans that made no trade and why; every operation against the plan it was
 * made under; and what Ryntra remembers, each fact with what it stands on.
 * Nothing is recomputed: the server's figures, said in the reader's language.
 * `?plan=` narrows it to one plan — what a plan's own «Результати» opens.
 */
export function ResultsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { colors } = useTheme()
  const locale = useLocale()
  const copy = useCopy(RESULTS_COPY)
  const noTrade = useCopy(NO_TRADE_LABELS)
  const shared = useSharedCopy()
  const now = useNow(30_000)
  const params = useLocalSearchParams<{ plan?: string; from?: string }>()
  const planId = typeof params.plan === 'string' && params.plan.length > 0 ? params.plan : null
  const account = useAccount()
  const results = usePlanResults(account.session)
  const memory = usePlanMemory(account.session)
  const rules = useRules(account.session)
  const [opened, setOpened] = useState<Opened | null>(null)

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/portfolio'))
  // A door in the sheet closes the sheet first and goes once it is closed: a screen left under an open modal is not left.
  const pending = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (opened !== null || !pending.current) return
    const go = pending.current
    pending.current = null
    go()
  }, [opened])
  const leave = (go: () => void) => {
    if (opened === null) return go()
    pending.current = go
    setOpened(null)
  }
  const openPlan = (id: string) =>
    leave(() => {
      // Opened from that very plan's own door: back to it, never a second copy of it on the stack.
      if (id === planId && params.from === 'plan' && router.canGoBack()) router.back()
      else router.push({ pathname: '/plans/[id]', params: { id } })
    })
  const refresh = () => {
    void results.refetch()
    void memory.refetch()
    if (!planId) void rules.refetch()
  }

  const feed = results.data ? forPlan(results.data, planId) : null
  const tallies = planId ? [] : ruleTallies(rules.data?.rules ?? [], now)
  const lines = planId ? [] : memoryLines(memory.data?.facts ?? [], locale)
  const planSymbol = planId && feed ? (feed.positions[0] ?? feed.outcomes[0] ?? feed.results[0] ?? null) : null

  let body
  if (!account.session) {
    body = null
  } else if (results.isPending || (!planId && rules.isPending)) {
    body = <LoadingRows label={copy.loading} />
  } else if (results.isError && !results.data && tallies.length === 0) {
    body = (
      <StateView
        icon={isNetworkError(results.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={isNetworkError(results.error) ? shared.noConnection : copy.couldNotLoad}
        detail={isNetworkError(results.error) ? shared.needsNetwork : undefined}
        action={{ title: shared.tryAgain, onPress: refresh, loading: results.isFetching }}
      />
    )
  } else if (!hasAnything(feed, tallies, lines.length)) {
    body = (
      <StateView
        icon="analytics-outline"
        title={copy.nothingTitle}
        detail={planId ? copy.nothingForPlan : copy.nothingDetail}
        action={planId ? { title: copy.openPlan, onPress: () => openPlan(planId) } : { title: copy.myStrategies, onPress: () => router.push('/plans') }}
      />
    )
  } else {
    const summary = feed?.summary
    const readAt = results.dataUpdatedAt > 0 ? new Date(results.dataUpdatedAt).toISOString() : null
    const showSummary = !planId && summary && (feed!.results.length > 0 || feed!.outcomes.length > 0 || feed!.positions.length > 0)
    body = (
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-10"
        refreshControl={
          <RefreshControl
            refreshing={(results.isFetching || rules.isFetching || memory.isFetching) && !results.isPending}
            onRefresh={refresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        {results.isError && !results.data ? (
          <View className="pt-3">
            <Chip label={copy.plansUnread} tone="warning" caps={false} />
          </View>
        ) : !planId && rules.isError && !rules.data ? (
          <View className="pt-3">
            <Chip label={copy.rulesUnread} tone="warning" caps={false} />
          </View>
        ) : results.isError || rules.isError ? (
          <View className="pt-3">
            <Chip label={shared.refreshFailed} tone="warning" caps={false} />
          </View>
        ) : null}
        {feed && feed.sync.pending > 0 ? (
          <Txt variant="labelSm" tone="faint" className="px-1 pt-3">
            {copy.syncing}
          </Txt>
        ) : null}
        {showSummary ? (
          <Summary
            at={readAt ? copy.asOf(formatClock(readAt)) : ''}
            figures={[
              { label: copy.openPositions, spoken: copy.spoken.openPositions, value: summary.openPositions },
              { label: copy.closedPositions, spoken: copy.spoken.closedPositions, value: summary.closedPositions },
              { label: copy.noTradePlans, spoken: copy.spoken.noTradePlans, value: summary.noTrade },
              { label: copy.tradesMade, spoken: copy.spoken.tradesMade, value: summary.trades },
            ]}
          />
        ) : null}

        <Section title={copy.rulesTitle} count={tallies.length}>
          {tallies.map((tally, index) => (
            <Row
              key={tally.rule.id}
              title={tally.rule.name}
              figure={tallyFigure(tally, locale) ?? undefined}
              figureTone={tally.bought > 0 ? 'fg' : 'muted'}
              figureWords
              line={tallyLine(tally, locale) || null}
              // A «З оплат» rule's line already names its terms; the others lead with their sum.
              foot={tally.rule.payments ? ruleWhenLine(tally.rule, locale) : `${dollarsText(tally.rule.amountUsd, locale)} · ${ruleWhenLine(tally.rule, locale)}`}
              onPress={() => setOpened({ kind: 'rule', tally })}
              last={index === tallies.length - 1}
            />
          ))}
        </Section>

        <Section title={copy.positionsTitle} count={feed?.positions.length ?? 0}>
          {(feed?.positions ?? []).map((row, index, all) => (
            <PositionItem key={row.planId} row={row} last={index === all.length - 1} onPress={() => setOpened({ kind: 'position', row })} />
          ))}
        </Section>

        <Section title={copy.outcomesTitle} count={feed?.outcomes.length ?? 0}>
          {(feed?.outcomes ?? []).map((outcome, index, all) => (
            <Row
              key={outcome.planId}
              title={symbolOf(outcome)}
              chips={[{ label: noTrade[outcome.reason], tone: 'neutral' }]}
              line={noTradeSentence(outcome, locale)}
              foot={formatMoment(outcome.observedAt, now, locale)}
              onPress={() => setOpened({ kind: 'outcome', outcome })}
              last={index === all.length - 1}
            />
          ))}
        </Section>

        <Section title={copy.resultsTitle} count={feed?.results.length ?? 0}>
          {(feed?.results ?? []).map((result, index, all) => (
            <OperationItem
              key={result.actual.signature}
              result={result}
              now={now}
              last={index === all.length - 1}
              onPress={() => setOpened({ kind: 'operation', result })}
            />
          ))}
        </Section>

        <Section title={copy.memoryTitle} count={lines.length}>
          {lines.map(({ fact, text }, index) => (
            <MemoryItem key={fact.id} fact={fact} text={text} last={index === lines.length - 1} onPress={() => setOpened({ kind: 'memory', fact, text })} />
          ))}
        </Section>
      </ScrollView>
    )
  }

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-1 px-2 pb-1 pt-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shared.back}
          onPress={back}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-btn active:bg-hover"
        >
          <Icon name="arrow-back" size={22} color="fg" />
        </Pressable>
        <View className="flex-1 gap-0.5 py-1">
          <Txt variant="headline" accessibilityRole="header">
            {copy.title}
          </Txt>
          <Txt variant="ui" tone="faint" numberOfLines={1}>
            {planSymbol ? copy.forPlan(symbolOf(planSymbol)) : copy.lead}
          </Txt>
        </View>
      </View>
      <SessionGate what={copy.title}>{body}</SessionGate>
      <ResultSheet
        opened={opened}
        now={now}
        onClose={() => setOpened(null)}
        onOpenPlan={openPlan}
        onOpenAsset={(mint) => leave(() => router.push({ pathname: '/asset/[mint]', params: { mint } }))}
        onOpenTransaction={(url) => void Linking.openURL(url)}
        onOpenPath={(path) => leave(() => router.push(path as never))}
      />
    </View>
  )
}

function PositionItem({ row, last, onPress }: { row: PlanPositionRow; last: boolean; onPress: () => void }) {
  const copy = useCopy(RESULTS_COPY)
  const locale = useLocale()
  const symbol = symbolOf(row)
  const position = row.position
  const closed = position.state === 'closed'
  const realised = position.realisedUsd
  return (
    <Row
      title={symbol}
      chips={[{ label: closed ? copy.positionClosed : copy.positionOpen, tone: closed ? 'neutral' : 'brand' }]}
      figure={closed ? (realised === null ? null : formatUsd(realised, locale)) : formatUsd(position.costBasisUsd, locale)}
      figureTone={closed && realised !== null ? (realised > 0 ? 'success' : realised < 0 ? 'danger' : 'fg') : 'fg'}
      line={positionSentence(position, symbol, locale)}
      foot={closed ? copy.realised : copy.costBasis}
      onPress={onPress}
      last={last}
    />
  )
}

function OperationItem({ result, now, last, onPress }: { result: PlanResult; now: number; last: boolean; onPress: () => void }) {
  const copy = useCopy(RESULTS_COPY)
  const locale = useLocale()
  const verdict = verdictOf(result, locale)
  const exit = result.actual.leg === 'exit'
  const sum = exit ? result.actual.proceedsUsd : result.actual.usd
  const filled = result.costs.filledPerUnitUsd
  return (
    <Row
      title={symbolOf(result)}
      chips={[
        { label: legWord(result, locale), tone: 'neutral' },
        { label: verdict.word, tone: verdict.tone },
      ]}
      figure={sum === null ? null : formatUsd(sum, locale)}
      line={result.actual.matchedBy === 'asset' ? copy.matchedByAsset : null}
      foot={[filled === null ? null : `${copy.filledPrice} ${formatUsd(filled, locale)}`, formatMoment(result.actual.settledAt, now, locale)]
        .filter(Boolean)
        .join(' · ')}
      onPress={onPress}
      last={last}
    />
  )
}

function MemoryItem({ fact, text, last, onPress }: { fact: PlanMemoryFact; text: string; last: boolean; onPress: () => void }) {
  const copy = useCopy(RESULTS_COPY)
  return (
    <Pressable
      accessibilityRole={fact.cites.length > 0 ? 'button' : 'text'}
      accessibilityLabel={fact.cites.length > 0 ? `${text}, ${copy.sources}` : text}
      onPress={onPress}
      disabled={fact.cites.length === 0}
      className={`flex-row items-center gap-3 py-3 active:bg-hover ${last ? '' : 'border-b border-line'}`}
    >
      <Txt variant="ui" className="flex-1">
        {text}
      </Txt>
      {fact.cites.length > 0 ? <Icon name="chevron-forward" size={18} color="fgMuted" /> : null}
    </Pressable>
  )
}
