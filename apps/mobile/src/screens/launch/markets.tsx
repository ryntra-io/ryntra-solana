import { useRouter } from 'expo-router'
import { useState } from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'

import { Card } from '@/components/card'
import { HelpDot } from '@/components/help-dot'
import { Screen } from '@/components/screen'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { launchWords, type LaunchWord } from '@/features/launch/copy'
import { useHiddenLaunch } from '@/features/launch/hidden'
import { shownPicture } from '@/features/launch/hidden-model'
import { formatBps, shortKey } from '@/features/launch/launch-format'
import { durationText } from '@/features/launch/launch-model'
import {
  daysText,
  namesShared,
  oldestRead,
  pairMoney,
  rowDepth,
  rowHoldersView,
  rowReading,
  rowTradeStatus,
  sinceText,
} from '@/features/launch/market-view'
import { useLaunchMarkets, useLaunchOpen, usePageLive, useReadWhenSeen } from '@/features/launch/use-launch'
import { useNow } from '@/hooks/use-now'
import type { LaunchMarketRow } from '@/lib/api/v1/types'
import { useLocale, useSharedCopy, type Locale } from '@/lib/i18n'

import { holdersCell, TechChip, TradeStatusChip, WayBar } from './market-parts'
import { LaunchTabs, TokenPicture } from './parts'

/**
 * «Лаунчі на Ryntra» — every market launched through Ryntra, read from the
 * chain, no wallet needed: a card per market in the data's own order (the
 * markets traded in the last day first, then by stage and the newest — no
 * ranking by hand), each with one status — whether it trades now — its way
 * to the DEX, what can be sold before a 5 % drop and its holders, the read's
 * time once above them; Ryntra's own launches marked «Технічна валідація».
 * A figure the chain did not give is «Не прочитано», never zero. A press
 * opens the market's page.
 */
export function LaunchMarketsScreen() {
  const router = useRouter()
  const shared = useSharedCopy()
  const locale = useLocale()
  const word = launchWords(locale)
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))
  const head = (
    <View className="pb-3">
      <LaunchTabs word={word} current="markets" />
    </View>
  )
  return (
    <Screen title={word('marketsTitle')} onBack={back} backLabel={shared.back} scroll={false}>
      <LaunchMarketsList head={head} />
    </Screen>
  )
}

/**
 * «Лаунчі на Ryntra» as a list — its own screen's and the chip «Лаунчі Ryntra» of «Торгівля · Ринки» (NEW-LOOK §3).
 * `head` stands above the cards and above any state the list is in.
 */
export function LaunchMarketsList({ head }: { head: React.ReactNode }) {
  const router = useRouter()
  const locale = useLocale()
  const word = launchWords(locale)
  const launchOpen = useLaunchOpen()
  const open = launchOpen.open
  const live = usePageLive()
  const list = useLaunchMarkets(open === true && launchOpen.markets, live)
  useReadWhenSeen(live && open === true && launchOpen.markets, list.refetch)
  const [openedAt] = useState(() => Date.now())
  const now = useNow(15_000)
  const data = list.data ?? null
  // The spinner answers the person's own pull, never the list's quiet reads behind it.
  const [pulling, setPulling] = useState(false)
  const pull = () => {
    setPulling(true)
    void list.refetch().finally(() => setPulling(false))
  }

  let state: React.ReactNode = null
  if (launchOpen.failed)
    state = (
      <StateView
        icon="cloud-offline-outline"
        title={word('launchUnread')}
        action={{ title: word('readAgain'), onPress: launchOpen.retry, loading: launchOpen.reading }}
      />
    )
  else if (open === false) state = <StateView icon="rocket-outline" title={word('unavailable')} />
  // A server before 1.36.0 names no markets' reads: said as not read, never as an empty list.
  else if (open === true && !launchOpen.markets)
    state = <StateView icon="cloud-offline-outline" title={word('marketsUnread')} />
  else if (!data && list.isError)
    state = (
      <StateView
        icon="cloud-offline-outline"
        title={word('marketsUnread')}
        action={{ title: word('readAgain'), onPress: () => void list.refetch(), loading: list.isFetching }}
      />
    )
  else if (!data) state = <StateView icon="hourglass-outline" title={word('marketsReading')} />
  else if (data.markets.length === 0)
    state = (
      <StateView
        icon="rocket-outline"
        title={word('marketsEmpty')}
        action={{ title: word('title'), onPress: () => router.replace('/launch' as never) }}
      />
    )

  const markets = data?.markets ?? []
  const read = oldestRead(markets)
  const twins = namesShared(markets)
  return state ? (
    <View className="flex-1 px-4">
      {head}
      {state}
    </View>
  ) : (
    // Up to 500 markets: drawn as they come into view, never all at once.
    <FlatList
      data={markets}
      keyExtractor={(row) => row.token}
      renderItem={({ item: row }) => (
        <MarketCard
          row={row}
          word={word}
          locale={locale}
          now={now}
          sameName={twins.has(row.token)}
          reading={rowReading(row, openedAt, now)}
          onOpen={() => router.push(`/launch/${row.token}` as never)}
        />
      )}
      ItemSeparatorComponent={Gap}
      initialNumToRender={6}
      maxToRenderPerBatch={8}
      windowSize={7}
      contentContainerClassName="px-4"
      contentContainerStyle={{ paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} />}
      ListHeaderComponent={
        <>
          {head}
          {/* The cards' figures carry their time once, above them; what the figures count is one tap deep behind «?». */}
          <View className="flex-row items-center gap-1 pb-3">
            <Txt variant="labelSm" tone="muted" className="shrink">
              {read ? word('marketRead', { ago: sinceText(read, word, locale, now) }) : word('cardsHelpTitle')}
            </Txt>
            <HelpDot title={word('cardsHelpTitle')} body={word('cardsHelp')} />
          </View>
          {data && !data.complete ? (
            <Txt variant="labelSm" tone="muted" className="pb-3" style={{ lineHeight: 16 }}>
              {word('marketsPartial')}
            </Txt>
          ) : null}
        </>
      }
      ListFooterComponent={
        <View className="gap-1.5 pt-4">
          <Txt variant="labelSm" tone="muted" style={{ lineHeight: 16 }}>
            {word('noGuarantee')}
          </Txt>
        </View>
      }
    />
  )
}

function Gap() {
  return <View className="h-3" />
}

/** A figure under its label, in a half of the card's last row. */
function Fact({ label, value, quiet }: { label: string; value: string; quiet: boolean }) {
  return (
    // Not a focus of its own: the card is one link, and its label and value are read in it, in order.
    <View className="flex-1 gap-0.5">
      <Txt variant="labelSm" tone="muted" numberOfLines={1}>
        {label}
      </Txt>
      <Txt variant={quiet ? 'ui' : 'data'} tone={quiet ? 'muted' : 'fg'} numberOfLines={1}>
        {value}
      </Txt>
    </View>
  )
}

export function MarketCard({
  row,
  word,
  locale,
  reading,
  onOpen,
  now,
  sameName = false,
}: {
  row: LaunchMarketRow
  word: LaunchWord
  locale: Locale
  now: number
  /** Another market on the list wears the same name and ticker: this one says its address. */
  sameName?: boolean
  /** The list opened a moment ago and this market is not read yet: said once, across its card. */
  reading: boolean
  onOpen: () => void
}) {
  const depth = rowDepth(row)
  // Hidden on this phone by the person («Сховати на цьому телефоні»): its picture is not drawn here either.
  const { hidden } = useHiddenLaunch(row.token)
  const holders = rowHoldersView(row)
  const notRead = word('notRead')
  return (
    <Pressable accessibilityRole="link" onPress={onOpen} className="active:opacity-80">
      <Card className="gap-3">
        <View className="flex-row items-center gap-3">
          <TokenPicture uri={shownPicture(row.image, hidden)} size={44} />
          <View className="flex-1 gap-0.5">
            <Txt variant="title" numberOfLines={1}>
              {row.name}
            </Txt>
            <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
              <Txt variant="data" tone="muted">
                {`$${row.symbol}${sameName ? ` · ${shortKey(row.token)}` : ''}`}
              </Txt>
              <Txt variant="labelSm" tone="muted">
                {word('launchedAgo', {
                  time: durationText(word, Math.max(0, Math.floor((now - Date.parse(row.launchedAt)) / 1000))),
                })}
              </Txt>
            </View>
          </View>
          {/* One status per card: whether it trades now — the cycle's stage is the market's page's. */}
          {reading ? null : <TradeStatusChip status={rowTradeStatus(row)} word={word} />}
        </View>
        {row.technicalValidation ? <TechChip word={word} /> : null}
        {reading ? (
          <Txt variant="ui" tone="muted">
            {word('rowReading')}
          </Txt>
        ) : (
          <>
            {row.progress ? (
              row.progress.migrated ? (
                // Where it trades and for how long — a place and a figure, as the curve's row; the status is the chip's alone.
                <View className="flex-row items-center justify-between">
                  <Txt variant="labelSm" tone="muted">
                    {word('onDex')}
                  </Txt>
                  <Txt variant="data" tone={row.daysSinceDex === null ? 'muted' : 'fg'}>
                    {row.daysSinceDex === null ? '—' : daysText(row.daysSinceDex, word)}
                  </Txt>
                </View>
              ) : (
                <View className="gap-1.5">
                  <View className="flex-row items-center justify-between">
                    <Txt variant="labelSm" tone="muted">
                      {word('colWay')}
                    </Txt>
                    <Txt variant="data">{formatBps(row.progress.bps, locale)}</Txt>
                  </View>
                  <WayBar bps={row.progress.bps} label={word('colWay')} />
                </View>
              )
            ) : (
              <Fact label={word('colWay')} value={notRead} quiet />
            )}
            <View className="flex-row gap-3">
              <Fact
                label={word('colDepth')}
                value={
                  depth.kind === 'raw'
                    ? pairMoney(depth.raw, row.pair, locale)
                    : depth.kind === 'curveFull'
                      ? word('curveFull')
                      : notRead
                }
                quiet={depth.kind !== 'raw'}
              />
              <Fact
                label={word('colHolders')}
                value={holdersCell(holders, word, locale)}
                quiet={holders.kind !== 'count'}
              />
            </View>
          </>
        )}
      </Card>
    </Pressable>
  )
}
