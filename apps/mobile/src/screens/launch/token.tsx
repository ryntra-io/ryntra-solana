import { useRouter } from 'expo-router'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Linking, Pressable, RefreshControl, View, type LayoutChangeEvent } from 'react-native'
import Svg, { Circle, Path, Polygon } from 'react-native-svg'

import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { DoorRow } from '@/components/door-row'
import { Icon } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Sheet } from '@/components/sheet'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { AskRyn } from '@/features/agent/ask-ryn'
import { capGeometry } from '@/features/launch/chart-geometry'
import { launchWords, type LaunchWord } from '@/features/launch/copy'
import { useHiddenLaunch } from '@/features/launch/hidden'
import { shownPicture } from '@/features/launch/hidden-model'
import { reportTokenMailto, SUPPORT_PAGE_URL } from '@/features/launch/report'
import {
  explorerUrl,
  formatBps,
  formatDate,
  formatMoneyShort,
  formatMove,
  formatRaw,
  formatTinyPrice,
  shortKey,
} from '@/features/launch/launch-format'
import { ageOf, agoText, durationText, inAttention, markKey, presetName, riskKey } from '@/features/launch/launch-model'
import { healthDoorLine, holdersFloor, marketKey, readsOnChange } from '@/features/launch/market-view'
import {
  useLaunchCreator,
  useLaunchHealth,
  useLaunchJournal,
  useLaunchMarket,
  useLaunchMarketCard,
  useLaunchOpen,
  useLaunchPresets,
  useLaunchToken,
  usePageLive,
} from '@/features/launch/use-launch'
import { RECEIPTS_COPY } from '@/features/receipts/copy'
import { docFromLaunch } from '@/features/receipts/receipt-doc'
import { useAccount } from '@/features/session/use-account'
import { useNow } from '@/hooks/use-now'
import { isNotFound } from '@/lib/api'
import type { LaunchHolderRow, LaunchMarketResponse, LaunchRiskFact, LaunchTokenResponse } from '@/lib/api/v1/types'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { ShareReceiptButton } from '@/screens/receipts/share-receipt'
import { useTheme } from '@/theme'
import { openLink } from '@/lib/open-link'

import { JournalCard } from './journal-parts'
import { EnforceChip, HealthSheet, MarketStateCard, RulesCard, TechChip } from './market-parts'
import { ExplorerLink, Row, ShareLink, TokenPicture } from './parts'
import { TradePanel } from './trade-panel'

/**
 * A launched token's page — its market's page, as on the web, in the order a
 * person reads on a phone: the token and its market cap, the chart, the
 * trade, what is worth a look, «Ринок» — the state in words and what comes
 * next, the way to the threshold or the pool locked for ever, Ryntra's
 * ladder — then «Що тримає цей ринок» with its rules and policies and the
 * «Чесний лаунч» marks; the market's health, the trades, the holders, every
 * fact of risk, the creator and the receipt a tap deeper. The market is the
 * chain's, read again every twenty seconds; its health every minute.
 */
export function LaunchTokenScreen({ mint }: { mint: string }) {
  const router = useRouter()
  const shared = useSharedCopy()
  const locale = useLocale()
  const word = launchWords(locale)
  const launchOpen = useLaunchOpen()
  const open = launchOpen.open
  const token = useLaunchToken(open === false ? null : mint || null)
  const market = useLaunchMarket(token.data ? mint : null)
  // The market's health and card where the server names their reads (1.36.0); read again only while the page is seen.
  const markets = launchOpen.markets
  const live = usePageLive()
  const health = useLaunchHealth(token.data && markets ? mint : null, live)
  const card = useLaunchMarketCard(token.data && markets ? mint : null)
  // «Бортовий журнал» where the server names its read: after the token, read again only while the page is seen.
  const journal = useLaunchJournal(token.data && launchOpen.journal ? mint : null, live)
  const [healthOpen, setHealthOpen] = useState(false)
  // The spinner answers the person's pull only — never the market's own refresh every 20 seconds.
  const [pulling, setPulling] = useState(false)
  // The health read again when the trades or the way to the DEX change — the web's own key — never only on its clock.
  const healthKey = markets && market.data ? marketKey(market.data) : null
  const seenKey = useRef<string | null>(null)
  const healthRefetch = health.refetch
  const cardRefetch = card.refetch
  const journalRefetch = journal.refetch
  const journalOn = launchOpen.journal
  useEffect(() => {
    // Only while the page is seen: a change met under another screen, or in the background, is kept for then.
    if (healthKey === null || !live) return
    const reads = readsOnChange(seenKey.current, healthKey)
    seenKey.current = healthKey
    if (reads.health) void healthRefetch()
    // A trade or a step on the way to the DEX may be an entry of the log: it is read with the health.
    if (reads.health && journalOn) void journalRefetch()
    // The way to the DEX ended: the card gains the pool and its locked positions.
    if (reads.card) void cardRefetch()
  }, [healthKey, live, healthRefetch, cardRefetch, journalRefetch, journalOn])
  const account = useAccount()
  const hiding = useHiddenLaunch(mint)
  // Every market launched on Ryntra, one press back — the list a person most often came from.
  const back = () => (router.canGoBack() ? router.back() : router.replace('/launch/markets' as never))

  const title = token.data ? `$${token.data.symbol}` : word('place')
  if (!token.data) {
    return (
      <Screen title={title} onBack={back} backLabel={shared.back}>
        {open === false ? (
          <StateView icon="rocket-outline" title={word('unavailable')} />
        ) : launchOpen.failed && token.isError ? (
          <StateView
            icon="cloud-offline-outline"
            title={word('launchUnread')}
            action={{
              title: word('readAgain'),
              onPress: () => {
                launchOpen.retry()
                void token.refetch()
              },
              loading: launchOpen.reading || token.isFetching,
            }}
          />
        ) : token.isError ? (
          isNotFound(token.error) ? (
            <StateView icon="search-outline" title={word('tokenNotFound')} />
          ) : (
            <StateView
              icon="cloud-offline-outline"
              title={word('tokenUnread')}
              action={{ title: word('readAgain'), onPress: () => void token.refetch(), loading: token.isFetching }}
            />
          )
        ) : (
          <StateView icon="hourglass-outline" title={shared.loading} />
        )}
      </Screen>
    )
  }

  const data = token.data
  return (
    <Screen
      title={title}
      onBack={back}
      backLabel={shared.back}
      right={
        <AskRyn
          context={{ kind: 'asset', mint: data.token, symbol: data.symbol }}
          className="h-9 w-9 border border-line bg-surface"
        />
      }
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={() => {
            setPulling(true)
            // The spinner waits for the token and its market; the slower reads arrive under it quietly.
            void Promise.allSettled([token.refetch(), market.refetch()]).finally(() => setPulling(false))
            // A query not enabled is never asked: its refetch would ignore `enabled` and send a token of «null».
            if (markets && token.data) {
              void health.refetch()
              void card.refetch()
            }
            if (launchOpen.journal && token.data) void journal.refetch()
          }}
        />
      }
    >
      <TokenHead
        token={data}
        word={word}
        locale={locale}
        hidePicture={hiding.hidden}
        tech={health.data?.technicalValidation ?? card.data?.market.technicalValidation ?? false}
      />
      {market.data ? (
        <MarketBody
          token={data}
          market={market.data}
          word={word}
          locale={locale}
          stale={market.isError}
          stateCard={
            markets ? (
              <MarketStateCard
                market={market.data}
                health={health.data ?? null}
                card={card.data ?? null}
                healthFailed={health.isError && !health.data}
                healthStale={health.isError && Boolean(health.data)}
                onRetry={() => void health.refetch()}
                word={word}
                locale={locale}
              />
            ) : undefined
          }
          healthDoor={
            markets
              ? {
                  line: healthDoorLine(health.data ?? null, health.isError, word, locale, market.data.progress),
                  onPress: () => (health.data ? setHealthOpen(true) : void health.refetch()),
                }
              : undefined
          }
        />
      ) : (
        <Card className="items-center gap-3 py-6">
          {market.isError ? (
            <>
              <Txt variant="ui" tone="muted">
                {word('marketUnread')}
              </Txt>
              <Pressable
                accessibilityRole="button"
                onPress={() => void market.refetch()}
                hitSlop={8}
                className="min-h-11 justify-center"
              >
                <Txt variant="ui" tone="brand">
                  {word('readAgain')}
                </Txt>
              </Pressable>
            </>
          ) : (
            <Txt variant="ui" tone="muted">
              {word('marketReading')}
            </Txt>
          )}
        </Card>
      )}
      {health.data ? (
        <RulesCard
          health={health.data}
          marks={(data.receipt?.marks ?? []).map((mark) => mark.code)}
          word={word}
          locale={locale}
        />
      ) : null}
      <Marks token={data} word={word} />
      {launchOpen.journal ? (
        <JournalCard
          log={journal.data ?? null}
          failed={journal.isError && !journal.data}
          stale={journal.isError && Boolean(journal.data)}
          onRetry={() => void journal.refetch()}
          health={health.data ?? null}
          symbol={data.symbol}
          word={word}
          locale={locale}
        />
      ) : null}
      {hiding.hidden ? (
        <Card className="gap-1 pb-2">
          <Txt variant="ui" tone="muted">
            {word('hiddenNote')}
          </Txt>
          <Pressable
            accessibilityRole="button"
            onPress={hiding.toggle}
            hitSlop={8}
            className="min-h-11 justify-center self-start"
          >
            <Txt variant="ui" tone="brand">
              {word('showAgain')}
            </Txt>
          </Pressable>
        </Card>
      ) : (
        <About token={data} word={word} />
      )}
      <Card>
        <ShareLink word={word} link={data.shareLink} symbol={data.symbol} />
      </Card>
      <ReceiptDoor token={data} word={word} locale={locale} />
      <Card padded={false}>
        <DoorRow
          icon="flag-outline"
          label={word('report')}
          line={word('reportLine')}
          external={word('reportBy')}
          onPress={() =>
            void Linking.openURL(
              reportTokenMailto(
                {
                  mint: data.token,
                  symbol: data.symbol,
                  name: data.name,
                  page: `https://ryntra.io/app/launch/${data.token}`,
                  reporter: account.address,
                },
                locale,
              ),
            ).catch(() => void Linking.openURL(SUPPORT_PAGE_URL).catch(() => undefined))
          }
          last={hiding.hidden}
        />
        {hiding.hidden ? null : (
          <DoorRow icon="eye-off-outline" label={word('hide')} line={word('hideLine')} onPress={hiding.toggle} last />
        )}
      </Card>
      {health.data ? (
        <HealthSheet
          visible={healthOpen}
          onClose={() => setHealthOpen(false)}
          health={health.data}
          card={card.data ?? null}
          progress={market.data?.progress ?? null}
          stale={health.isError}
          word={word}
          locale={locale}
        />
      ) : null}
    </Screen>
  )
}

export function TokenHead({
  token,
  word,
  locale,
  hidePicture = false,
  tech = false,
}: {
  token: LaunchTokenResponse
  word: LaunchWord
  locale: Locale
  /** Hidden on this phone by the person: the creator's picture is not drawn. */
  hidePicture?: boolean
  /** Ryntra's own launch, checking the full cycle — marked so, never presented as demand. */
  tech?: boolean
}) {
  const presets = useLaunchPresets()
  const presetLabel = presetName(token.preset, presets.data?.presets, locale, word)
  return (
    <View className="flex-row items-center gap-3">
      <TokenPicture uri={shownPicture(token.image, hidePicture)} size={56} />
      <View className="flex-1 gap-1">
        <Txt variant="headline" numberOfLines={2}>
          {token.name}
        </Txt>
        <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
          <Txt variant="data" tone="muted">
            ${token.symbol}
          </Txt>
          {presetLabel ? <Chip label={word('presetChip', { name: presetLabel })} caps={false} /> : null}
          {tech ? <TechChip word={word} standalone /> : null}
        </View>
        <ExplorerLink
          label={word('tokenBy', { creator: shortKey(token.creator) })}
          url={explorerUrl(token.network, 'account', token.creator)}
        />
      </View>
    </View>
  )
}

export function MarketBody({
  token,
  market,
  word,
  locale,
  stale = false,
  stateCard,
  healthDoor,
}: {
  token: LaunchTokenResponse
  market: LaunchMarketResponse
  word: LaunchWord
  locale: Locale
  /** The last read again failed: the figures shown are the earlier ones, and say so. */
  stale?: boolean
  /** «Ринок» from the market's health, in place of the way to the DEX read from the market alone. */
  stateCard?: ReactNode
  /** «Здоров'я ринку», one tap deep: its one line, and the press that opens it (or reads it again). */
  healthDoor?: Readonly<{ line: string; onPress: () => void }>
}) {
  const now = useNow(15_000)
  const nowSeconds = Math.floor(now / 1000)
  const [sheet, setSheet] = useState<'trades' | 'holders' | 'risk' | 'creator' | null>(null)
  const moneyOf = (value: { pair: number; usd: number | null }) =>
    formatMoneyShort(value.usd ?? value.pair, locale, value.usd !== null, market.pair.symbol)
  const price = formatTinyPrice(market.price.usd ?? market.price.pair, locale)
  const sold = market.risk.find((fact) => fact.code === 'CREATOR_SOLD') ?? null
  const attention = market.risk.filter(inAttention)
  const attentionCount = market.risk.filter((fact) => fact.level === 'attention').length
  const left = BigInt(market.progress.thresholdRaw) - BigInt(market.progress.reserveRaw)
  return (
    <>
      <Card className="gap-3">
        <View className="gap-0.5">
          <Txt variant="labelSm" tone="faint" caps>
            {word('marketCap')}
          </Txt>
          <View className="flex-row items-baseline gap-2">
            <Txt variant="dataLg">{moneyOf(market.marketCap)}</Txt>
            <Txt
              variant="data"
              tone={market.sinceLaunchBps > 0 ? 'success' : market.sinceLaunchBps < 0 ? 'danger' : 'muted'}
            >
              {formatMove(market.sinceLaunchBps, locale)}
            </Txt>
            <Txt variant="labelSm" tone="faint">
              {word('sinceLaunch')}
            </Txt>
          </View>
        </View>
        <View className="flex-row flex-wrap">
          <Stat
            label={word('price')}
            value={market.price.usd !== null ? `$${price.text}` : `${price.text} ${market.pair.symbol}`}
            spoken={market.price.usd !== null ? `$${price.plain}` : `${price.plain} ${market.pair.symbol}`}
          />
          <Stat
            label={market.venue === 'curve' ? word('liquidityCurve') : word('liquidity')}
            value={moneyOf(market.liquidity)}
          />
          <Stat
            label={word('volume24h')}
            value={
              market.volume24h.complete
                ? moneyOf(market.volume24h)
                : market.trades.read === 0
                  ? word('groupUnread')
                  : `≥ ${moneyOf(market.volume24h)}`
            }
          />
          <Stat label={word('holders')} value={holdersFloor(market.holders.count, market.holders.atLeast, locale)} />
          <Stat label={word('top10')} value={formatBps(market.holders.groups.top10Bps, locale)} />
          <Stat label={word('age')} value={ageOf(market, nowSeconds, word)} />
        </View>
        {/* Every figure carries its time; a refresh that failed says the figures are the earlier read. */}
        <Txt variant="labelSm" tone={stale ? 'warning' : 'faint'}>
          {word(stale ? 'marketStale' : 'marketRead', {
            ago: agoText(word, Math.max(0, nowSeconds - Math.floor(Date.parse(market.observedAt) / 1000))),
          })}
        </Txt>
        {sold ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              if (sold.source) openLink(explorerUrl(market.network, sold.source.kind, sold.source.id))
            }}
            className="flex-row items-start gap-2 rounded-sm bg-danger-soft px-3 py-2.5"
          >
            <Icon name="warning" size={16} color="dangerInk" style={{ marginTop: 1 }} />
            <Txt variant="ui" tone="danger" className="flex-1">
              {sold.values.soldBps !== undefined
                ? word('creatorSold', { pct: formatBps(sold.values.soldBps, locale) })
                : word('creatorSoldSupply', { pct: formatBps(sold.values.supplyBps ?? 0, locale) })}
              {sold.values.at
                ? ` · ${word('creatorSoldWhen', { ago: agoText(word, Math.max(0, nowSeconds - (sold.values.at ?? 0))) })}`
                : ''}
            </Txt>
          </Pressable>
        ) : !market.creator.tradesComplete ? (
          <View className="flex-row items-start gap-2">
            <Icon name="information-circle-outline" size={16} color="muted" style={{ marginTop: 1 }} />
            <Txt variant="ui" tone="muted" className="flex-1">
              {word('creatorSalesUnread')}
            </Txt>
          </View>
        ) : null}
      </Card>

      <Card className="gap-2">
        <Txt variant="labelSm" tone="faint" caps>
          {word('chartTitle')}
        </Txt>
        <CapChart market={market} word={word} locale={locale} />
        {market.trades.rows.length === 0 && market.trades.complete ? (
          <Txt variant="labelSm" tone="faint">
            {word('chartNoTrades')}
          </Txt>
        ) : null}
      </Card>

      <TradePanel market={market} symbol={token.symbol} word={word} locale={locale} />

      {attention.length ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Txt variant="labelSm" tone="faint" caps>
              {word('attentionTitle')}
            </Txt>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSheet('risk')}
              hitSlop={8}
              className="min-h-11 justify-center"
            >
              <Txt variant="ui" tone="brand">
                {word('attentionAll')}
              </Txt>
            </Pressable>
          </View>
          <RiskList market={market} facts={attention} word={word} locale={locale} nowSeconds={nowSeconds} />
        </Card>
      ) : null}

      {stateCard ?? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Txt variant="labelSm" tone="faint" caps>
              {market.progress.migrated ? word('graduated') : word('progress')}
            </Txt>
            <Txt variant="data">{formatBps(market.progress.bps, locale)}</Txt>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(market.progress.bps / 100) }}
            className="h-1.5 overflow-hidden rounded-pill bg-track"
          >
            <View
              className="h-full rounded-pill bg-brand"
              style={{ width: `${Math.max(market.progress.bps / 100, 1)}%` }}
            />
          </View>
          {market.progress.migrated ? (
            <View className="flex-row flex-wrap items-center gap-2">
              <Txt variant="ui" tone="muted">
                {word('graduatedPool')}
              </Txt>
              <ExplorerLink label={word('pool')} url={explorerUrl(market.network, 'account', market.trading.pool)} />
            </View>
          ) : (
            <Txt variant="ui" tone="muted">
              {`${word('progressOf', {
                amount: formatRaw(market.progress.reserveRaw, market.pair.decimals, locale, 0),
                threshold: formatRaw(market.progress.thresholdRaw, market.pair.decimals, locale, 0),
                symbol: market.pair.symbol,
              })} · ${word('progressLeft', {
                amount: formatRaw((left > 0n ? left : 0n).toString(), market.pair.decimals, locale, 0),
                symbol: market.pair.symbol,
              })}`}
            </Txt>
          )}
        </Card>
      )}

      <Card padded={false}>
        {healthDoor ? (
          <DoorRow
            icon="pulse-outline"
            label={word('healthTitle')}
            line={healthDoor.line}
            onPress={healthDoor.onPress}
          />
        ) : null}
        <DoorRow
          icon="swap-vertical-outline"
          label={word('tabTrades')}
          value={market.trades.complete ? String(market.trades.rows.length) : `${market.trades.read}+`}
          onPress={() => setSheet('trades')}
        />
        <DoorRow
          icon="people-outline"
          label={word('tabHolders')}
          value={holdersFloor(market.holders.count, market.holders.atLeast, locale)}
          onPress={() => setSheet('holders')}
        />
        <DoorRow
          icon="shield-outline"
          label={word('tabRisk')}
          value={attentionCount > 0 ? String(attentionCount) : undefined}
          onPress={() => setSheet('risk')}
        />
        <DoorRow
          icon="person-outline"
          label={word('creatorTitle')}
          value={shortKey(market.creator.address)}
          onPress={() => setSheet('creator')}
          last
        />
      </Card>

      <Sheet visible={sheet === 'trades'} title={word('tabTrades')} onClose={() => setSheet(null)} scroll>
        <Trades market={market} symbol={token.symbol} word={word} locale={locale} nowSeconds={nowSeconds} />
      </Sheet>
      <Sheet visible={sheet === 'holders'} title={word('tabHolders')} onClose={() => setSheet(null)} scroll>
        <Holders market={market} word={word} locale={locale} />
      </Sheet>
      <Sheet
        visible={sheet === 'risk'}
        title={word('tabRisk')}
        subtitle={word('riskLede')}
        onClose={() => setSheet(null)}
        scroll
      >
        <View className="px-4 pb-2">
          <RiskList market={market} facts={market.risk} word={word} locale={locale} nowSeconds={nowSeconds} />
        </View>
      </Sheet>
      <Sheet
        visible={sheet === 'creator'}
        title={word('creatorTitle')}
        subtitle={shortKey(market.creator.address)}
        onClose={() => setSheet(null)}
        scroll
      >
        <CreatorLaunches market={market} word={word} locale={locale} onOpen={() => setSheet(null)} />
      </Sheet>
    </>
  )
}

function Stat({ label, value, spoken }: { label: string; value: string; spoken?: string }) {
  return (
    // A label may take two lines («Топ-10 від пропозиції»); the figures of a row stay on one line at its foot.
    <View
      className="w-1/3 justify-between gap-0.5 py-1.5 pr-2"
      accessible
      accessibilityLabel={`${label}: ${spoken ?? value}`}
    >
      <Txt variant="labelSm" tone="faint" caps numberOfLines={2}>
        {label}
      </Txt>
      <Txt variant="data" numberOfLines={1}>
        {value}
      </Txt>
    </View>
  )
}

const CHART_HEIGHT = 140

function CapChart({ market, word, locale }: { market: LaunchMarketResponse; word: LaunchWord; locale: Locale }) {
  const { colors } = useTheme()
  const [width, setWidth] = useState(0)
  const geometry = capGeometry(market.chart.points, market.chart.markers, width, CHART_HEIGHT)
  const money = (value: number) => formatMoneyShort(value, locale, market.pair.dollar, market.pair.symbol)
  const summary = geometry
    ? word('chartSummary', {
        from: money(geometry.first),
        to: money(geometry.last),
        high: money(geometry.high),
        low: money(geometry.low),
        n: market.trades.read,
      })
    : word('chartNoTrades')
  const legend = [
    market.chart.markers.some((marker) => marker.kind === 'creator-buy') ? `▲ ${word('chartLegendBuy')}` : null,
    market.chart.markers.some((marker) => marker.kind === 'creator-sell') ? `▼ ${word('chartLegendSell')}` : null,
    market.progress.migrated ? `● ${word('chartLegendDex')}` : null,
  ].filter(Boolean)
  return (
    <View className="gap-1.5">
      <View
        onLayout={(event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width))}
        accessible
        accessibilityLabel={summary}
        style={{ height: CHART_HEIGHT }}
      >
        {geometry && width > 0 ? (
          <Svg width={width} height={CHART_HEIGHT}>
            <Path d={geometry.path} stroke={colors.brand} strokeWidth={1.75} fill="none" strokeLinejoin="round" />
            {geometry.markers.map((marker, index) =>
              marker.kind === 'graduated' ? (
                <Circle key={index} cx={marker.x} cy={marker.y} r={4} fill={colors.info} />
              ) : (
                <Polygon
                  key={index}
                  points={
                    marker.kind === 'creator-buy'
                      ? `${marker.x},${marker.y - 9} ${marker.x - 5},${marker.y - 2} ${marker.x + 5},${marker.y - 2}`
                      : `${marker.x},${marker.y + 9} ${marker.x - 5},${marker.y + 2} ${marker.x + 5},${marker.y + 2}`
                  }
                  fill={marker.kind === 'creator-buy' ? colors.success : colors.danger}
                />
              ),
            )}
          </Svg>
        ) : null}
      </View>
      {geometry && legend.length ? (
        <Txt variant="labelSm" tone="faint">
          {legend.join(' · ')}
        </Txt>
      ) : null}
    </View>
  )
}

function RiskList({
  market,
  facts,
  word,
  locale,
  nowSeconds,
}: {
  market: LaunchMarketResponse
  facts: readonly LaunchRiskFact[]
  word: LaunchWord
  locale: Locale
  nowSeconds: number
}) {
  return (
    <View className="gap-3">
      {facts.map((fact) => {
        const values = fact.values
        const text = word(riskKey(fact), {
          pct: formatBps(values.soldBps ?? values.supplyBps ?? values.shareBps ?? 0, locale),
          wallets: values.wallets ?? 0,
          n: fact.code === 'HISTORY_PARTIAL' ? (values.trades ?? 0) : (values.count ?? 0),
          age: durationText(word, Math.max(0, values.seconds ?? nowSeconds)),
        })
        const why = `${word(`riskWhy_${fact.code}` as Parameters<LaunchWord>[0])}${fact.code === 'HISTORY_PARTIAL' && market.creator.tradesComplete ? ` ${word('creatorReadWhole')}` : ''}`
        return (
          <View key={fact.code} className="flex-row items-start gap-2.5">
            <Icon
              name={fact.level === 'attention' ? 'warning' : 'information-circle-outline'}
              size={17}
              color={fact.level === 'attention' ? 'warningInk' : 'muted'}
              style={{ marginTop: 1 }}
            />
            <View className="flex-1 gap-0.5">
              <Txt variant="ui">{text}</Txt>
              <Txt variant="labelSm" tone="faint" style={{ lineHeight: 16 }}>
                {why}
              </Txt>
              {fact.source ? (
                <ExplorerLink
                  label={fact.source.kind === 'tx' ? word('sourceTx') : word('sourceAccount')}
                  url={explorerUrl(market.network, fact.source.kind, fact.source.id)}
                />
              ) : null}
            </View>
          </View>
        )
      })}
    </View>
  )
}

/** How many trades the list shows at first, and adds on each «more». */
const TRADES_PAGE = 20

function Trades({
  market,
  symbol,
  word,
  locale,
  nowSeconds,
}: {
  market: LaunchMarketResponse
  symbol: string
  word: LaunchWord
  locale: Locale
  nowSeconds: number
}) {
  const account = useAccount()
  const [shown, setShown] = useState(TRADES_PAGE)
  const all = market.trades.rows
  const pair = market.pair
  if (!all.length)
    return (
      <Txt variant="ui" tone="muted" className="px-4 pb-2">
        {market.trades.complete ? word('tradesEmpty') : word('tradesUnread')}
      </Txt>
    )
  return (
    <View className="gap-1 px-4 pb-2">
      {!market.trades.complete ? (
        <Txt variant="labelSm" tone="faint">
          {word('tradesLatest', { n: market.trades.read })}
        </Txt>
      ) : null}
      {all.slice(0, shown).map((row) => (
        <Pressable
          key={`${row.signature}:${row.side}:${row.tokensRaw}`}
          accessibilityRole="link"
          onPress={() => openLink(explorerUrl(market.network, 'tx', row.signature))}
          className="flex-row items-center gap-3 border-b border-line py-2.5"
        >
          <View className="w-16">
            <Txt variant="ui" tone={row.side === 'buy' ? 'success' : 'danger'}>
              {row.side === 'buy' ? word('sideBuy') : word('sideSell')}
            </Txt>
            <Txt variant="labelSm" tone="faint">
              {agoText(word, Math.max(0, nowSeconds - Math.floor(Date.parse(row.at) / 1000)))}
            </Txt>
          </View>
          <View className="flex-1 gap-0.5">
            <Txt variant="data" numberOfLines={1}>
              {formatMoneyShort(Number(row.pairRaw) / 10 ** pair.decimals, locale, pair.dollar, pair.symbol)}
            </Txt>
            <Txt variant="labelSm" tone="faint" numberOfLines={1}>
              {`${formatRaw(row.tokensRaw, market.tokenDecimals, locale, 0)} $${symbol}`}
            </Txt>
          </View>
          <View className="items-end gap-0.5">
            <Txt variant="data" tone="muted">
              {row.trader === account.address ? word('you') : shortKey(row.trader)}
            </Txt>
            <Labels labels={row.traderLabels} word={word} />
          </View>
        </Pressable>
      ))}
      {all.length > shown ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setShown((count) => count + TRADES_PAGE)}
          hitSlop={8}
          className="min-h-11 justify-center self-start"
        >
          <Txt variant="ui" tone="brand">
            {word('tradesMore', { n: Math.min(TRADES_PAGE, all.length - shown) })}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  )
}

function Labels({ labels, word }: { labels: readonly string[]; word: LaunchWord }) {
  if (!labels.length) return null
  return (
    <View className="flex-row gap-1">
      {labels.map((label) => (
        <Chip
          key={label}
          label={word(`label_${label}` as Parameters<LaunchWord>[0])}
          caps={false}
          tone={label === 'sniper' || label === 'bundle' ? 'warning' : 'neutral'}
        />
      ))}
    </View>
  )
}

const NOT_PEOPLE = new Set(['curve', 'pool', 'lock'])

function Holders({ market, word, locale }: { market: LaunchMarketResponse; word: LaunchWord; locale: Locale }) {
  const account = useAccount()
  const groups = market.holders.groups
  const people = market.holders.rows.filter((row) => !row.labels.some((label) => NOT_PEOPLE.has(label)))
  const vaults = market.holders.rows.filter((row) => row.labels.some((label) => NOT_PEOPLE.has(label)))
  const bundleUnread = !groups.bundle
  const bundleFloorOnly = groups.bundle !== null && groups.bundle.atLeast && groups.bundle.wallets === 0
  return (
    <View className="gap-2 px-4 pb-2">
      <View className="flex-row flex-wrap">
        <Stat label={word('label_creator')} value={formatBps(groups.creatorBps, locale)} />
        <Stat
          label={groups.snipers ? word('groupSnipers', { n: groups.snipers.wallets }) : word('groupSnipersName')}
          value={groups.snipers ? formatBps(groups.snipers.shareBps, locale) : word('groupUnread')}
        />
        <Stat
          label={
            bundleUnread || bundleFloorOnly
              ? word('label_bundle')
              : word(groups.bundle!.atLeast ? 'groupBundleAtLeast' : 'groupBundle', { n: groups.bundle!.wallets })
          }
          value={
            bundleUnread
              ? word('groupUnread')
              : bundleFloorOnly
                ? word('groupPartial')
                : `${groups.bundle!.atLeast ? '≥ ' : ''}${formatBps(groups.bundle!.shareBps, locale)}`
          }
        />
      </View>
      <Txt variant="labelSm" tone="faint" style={{ lineHeight: 16 }}>
        {`${word('labelLegend')} ${word('holdersPeople')}`}
      </Txt>
      {people.map((row, index) => (
        <HolderRow
          key={row.owner}
          row={row}
          rank={index + 1}
          scale={people[0]?.shareBps ?? 0}
          mine={row.owner === account.address}
          word={word}
          locale={locale}
        />
      ))}
      {vaults.length ? (
        <>
          <Txt variant="labelSm" tone="faint" caps className="pt-2">
            {word('notPeople')}
          </Txt>
          {vaults.map((row) => (
            <HolderRow key={row.owner} row={row} rank={null} scale={0} mine={false} word={word} locale={locale} />
          ))}
        </>
      ) : null}
    </View>
  )
}

function HolderRow({
  row,
  rank,
  scale,
  mine,
  word,
  locale,
}: {
  row: LaunchHolderRow
  rank: number | null
  scale: number
  mine: boolean
  word: LaunchWord
  locale: Locale
}) {
  return (
    <View className="gap-1 border-b border-line py-2">
      <View className="flex-row items-center gap-2">
        <Txt variant="data" tone="faint" className="w-6">
          {rank ?? ''}
        </Txt>
        <Txt variant="data" className="flex-1">
          {mine ? word('you') : shortKey(row.owner)}
        </Txt>
        <Labels labels={row.labels} word={word} />
        <Txt variant="data">{formatBps(row.shareBps, locale)}</Txt>
      </View>
      {rank !== null && scale > 0 ? (
        <View className="ml-8 h-1 overflow-hidden rounded-pill bg-track">
          <View
            className="h-full rounded-pill bg-chart-2"
            style={{ width: `${Math.max((row.shareBps / scale) * 100, 2)}%` }}
          />
        </View>
      ) : null}
    </View>
  )
}

function CreatorLaunches({
  market,
  word,
  locale,
  onOpen,
}: {
  market: LaunchMarketResponse
  word: LaunchWord
  locale: Locale
  onOpen: () => void
}) {
  const router = useRouter()
  const launches = useLaunchCreator(market.token, true)
  return (
    <View className="gap-2 px-4 pb-2">
      <ExplorerLink
        label={shortKey(market.creator.address)}
        url={explorerUrl(market.network, 'account', market.creator.address)}
      />
      {market.creator.curves !== null ? (
        <Txt variant="ui" tone="muted">
          {word('creatorCurves', { n: Math.max(0, market.creator.curves - 1) })}
        </Txt>
      ) : null}
      {launches.isPending ? (
        <Txt variant="ui" tone="muted">
          {word('creatorReading')}
        </Txt>
      ) : launches.isError || !launches.data ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void launches.refetch()}
          hitSlop={8}
          className="min-h-11 justify-center"
        >
          <Txt variant="ui" tone="muted">
            {word('creatorUnread')}{' '}
            <Txt variant="ui" tone="brand">
              {word('readAgain')}
            </Txt>
          </Txt>
        </Pressable>
      ) : launches.data.launches.length ? (
        <>
          <Txt variant="labelSm" tone="faint" caps className="pt-1">
            {word('creatorOther')}
          </Txt>
          {launches.data.launches.map((entry) => (
            <Pressable
              key={entry.token}
              accessibilityRole="link"
              onPress={() => {
                onOpen()
                router.push(`/launch/${entry.token}` as never)
              }}
              className="gap-0.5 border-b border-line py-2"
            >
              <Txt variant="ui">{`${entry.name} · $${entry.symbol} · ${shortKey(entry.token)}`}</Txt>
              <Txt variant="labelSm" tone="faint">
                {`${formatDate(entry.launchedAt, locale)} · ${
                  entry.migrated
                    ? word('outcomeDex')
                    : entry.progressBps !== null
                      ? word('outcomeCurve', { pct: formatBps(entry.progressBps, locale) })
                      : '—'
                }${
                  entry.creatorSoldBps !== null
                    ? ` · ${
                        entry.creatorSoldBps > 0
                          ? word(entry.creatorSoldOf === 'supply' ? 'outcomeSoldSupply' : 'outcomeSold', {
                              pct: formatBps(entry.creatorSoldBps, locale),
                            })
                          : word('outcomeKept')
                      }`
                    : ''
                }`}
              </Txt>
            </Pressable>
          ))}
        </>
      ) : (
        <Txt variant="ui" tone="muted">
          {word('creatorNone')}
        </Txt>
      )}
    </View>
  )
}

/** «Чесний лаунч»: each mark with the account where anyone can see it; the creator's lock first. */
export function Marks({ token, word }: { token: LaunchTokenResponse; word: LaunchWord }) {
  const now = useNow(60_000)
  const locale = useLocale()
  const receipt = token.receipt
  const marks = receipt?.marks ?? []
  const lockMark = marks.find((mark) => mark.code === 'CREATOR_BUY_LOCKED') ?? null
  const minutes = receipt ? Math.floor((now - Date.parse(receipt.observedAt)) / 60_000) : 0
  return (
    <Card className="gap-2.5">
      <View className="flex-row items-center justify-between gap-3">
        <Txt variant="labelSm" tone="faint" caps>
          {word('marks')}
        </Txt>
        {/* Every mark here is a program's rule — said once, in words, as «Що тримає цей ринок» marks its rules and policies. */}
        {receipt ? (
          <EnforceChip
            enforcement="rule"
            word={word}
            label={word('marksRules')}
            hint={word('marksRulesHint')}
            standalone
          />
        ) : null}
      </View>
      {receipt ? (
        <>
          {lockMark ? (
            <MarkRow
              icon="lock-closed"
              text={word('mark_CREATOR_BUY_LOCKED')}
              sub={
                receipt.creatorLock
                  ? Date.parse(receipt.creatorLock.cliffAt) > Date.parse(receipt.observedAt)
                    ? word('lockedUntil', { date: formatDate(receipt.creatorLock.cliffAt, locale) })
                    : word('lockedVesting', { date: formatDate(receipt.creatorLock.endsAt, locale) })
                  : null
              }
              url={explorerUrl(token.network, 'account', lockMark.account)}
              word={word}
            />
          ) : null}
          {marks
            .filter((mark) => mark.code !== 'CREATOR_BUY_LOCKED')
            .map((mark) => (
              <MarkRow
                key={`${mark.code}:${mark.account}`}
                icon="checkmark-circle"
                text={word(markKey(mark, receipt))}
                sub={null}
                url={explorerUrl(token.network, 'account', mark.account)}
                word={word}
              />
            ))}
          <Txt variant="labelSm" tone="faint">
            {word('marksChecked', { ago: minutes < 1 ? word('justNow') : agoText(word, minutes * 60) })}
          </Txt>
        </>
      ) : (
        <Txt variant="ui" tone="muted">
          {word('marksUnread')}
        </Txt>
      )}
    </Card>
  )
}

function MarkRow({
  icon,
  text,
  sub,
  url,
  word,
}: {
  icon: 'lock-closed' | 'checkmark-circle'
  text: string
  sub: string | null
  url: string
  word: LaunchWord
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityHint={word('view')}
      onPress={() => openLink(url)}
      className="flex-row items-center gap-2.5"
    >
      <Icon name={icon} size={18} color={icon === 'lock-closed' ? 'brand' : 'successInk'} />
      <View className="flex-1">
        <Txt variant="ui">{text}</Txt>
        {sub ? (
          <Txt variant="labelSm" tone="faint">
            {sub}
          </Txt>
        ) : null}
      </View>
      <Icon name="open-outline" size={14} color="fgMuted" />
    </Pressable>
  )
}

export function About({ token, word }: { token: LaunchTokenResponse; word: LaunchWord }) {
  const links = [
    { href: token.links.website, label: word('website'), icon: 'globe-outline' as const },
    { href: token.links.x, label: word('x'), icon: 'logo-x' as const },
    { href: token.links.telegram, label: word('telegram'), icon: 'paper-plane-outline' as const },
  ].filter((link): link is { href: string; label: string; icon: 'globe-outline' | 'logo-x' | 'paper-plane-outline' } =>
    Boolean(link.href),
  )
  if (!token.description && !links.length) return null
  return (
    <Card className="gap-2">
      <Txt variant="labelSm" tone="faint" caps>
        {word('about')}
      </Txt>
      {token.description ? <Txt variant="body">{token.description}</Txt> : null}
      {links.length ? (
        <>
          <View className="flex-row flex-wrap gap-2">
            {links.map((link) => (
              <Pressable
                key={link.label}
                accessibilityRole="link"
                onPress={() => openLink(link.href)}
                className="h-11 flex-row items-center gap-1.5 rounded-pill border border-line px-4 active:bg-hover"
              >
                <Icon name={link.icon} size={15} color="fg" />
                <Txt variant="ui">{link.label}</Txt>
              </Pressable>
            ))}
          </View>
          <Txt variant="labelSm" tone="faint">
            {word('linksByCreator')}
          </Txt>
        </>
      ) : null}
    </Card>
  )
}

export function ReceiptDoor({ token, word, locale }: { token: LaunchTokenResponse; word: LaunchWord; locale: Locale }) {
  const [open, setOpen] = useState(false)
  const receipt = token.receipt
  const presets = useLaunchPresets()
  const preset = presets.data?.presets.find((entry) => entry.id === token.preset) ?? null
  const pair = preset?.pair ?? null
  const tokenDecimals = receipt?.token2022.decimals ?? 6
  const account = useAccount()
  const receiptWords = useCopy(RECEIPTS_COPY)
  // The launch receipt is the creator's to share: their first buy is not anyone else's «Сплачено».
  const mine = account.address !== null && account.address === token.creator
  const doc = docFromLaunch(token, pair, receiptWords.launched(token.symbol), locale)
  return (
    <Card padded={false}>
      <DoorRow icon="receipt-outline" label={word('receipt')} onPress={() => setOpen(true)} last />
      <Sheet visible={open} title={word('receipt')} subtitle={`$${token.symbol}`} onClose={() => setOpen(false)} scroll>
        <View className="px-4 pb-2">
          <Row label={word('receiptCreated')} value={shortKey(token.signature)} />
          <ExplorerLink label={word('viewTx')} url={explorerUrl(token.network, 'tx', token.signature)} />
          {receipt ? (
            <>
              <Row label={word('receiptConfig')} value={shortKey(receipt.config)} />
              <ExplorerLink label={word('view')} url={explorerUrl(token.network, 'account', receipt.config)} />
              <Row label={word('receiptCurve')} value={shortKey(receipt.pool)} />
              <ExplorerLink label={word('view')} url={explorerUrl(token.network, 'account', receipt.pool)} />
            </>
          ) : null}
          <Row
            label={word('receiptFirstBuy')}
            value={
              receipt?.creatorFirstBuy
                ? word('receiptFirstBuyValue', {
                    tokens: formatRaw(receipt.creatorFirstBuy.tokensOutRaw, tokenDecimals, locale, 0),
                    // Unknown while the preset is not read: a dash, never a guessed figure.
                    amount: pair ? formatRaw(receipt.creatorFirstBuy.quoteInRaw, pair.decimals, locale, 2) : '—',
                    symbol: pair?.symbol ?? '',
                    cap: formatRaw(receipt.creatorFirstBuy.capRaw, tokenDecimals, locale, 0),
                    pct: preset ? formatBps(preset.firstBuyCapBps, locale) : '—',
                  })
                : // A receipt not read is not «none»: the buy and the lock may well be there.
                  word(receipt ? 'receiptNone' : 'notRead')
            }
          />
          <Row
            label={word('receiptLock')}
            value={
              receipt?.creatorLock ? shortKey(receipt.creatorLock.escrow) : word(receipt ? 'receiptNone' : 'notRead')
            }
          />
          {receipt?.creatorLock ? (
            <ExplorerLink
              label={word('view')}
              url={explorerUrl(token.network, 'account', receipt.creatorLock.escrow)}
            />
          ) : null}
          {receipt?.feeSharing ? (
            <>
              <Row label={word('feeShareTitle')} value={shortKey(receipt.feeSharing.vault)} />
              {receipt.feeSharing.shares.map((share) => (
                <Row
                  key={share.address}
                  label={
                    share.address === receipt.creator
                      ? `${word('label_creator')} · ${shortKey(share.address)}`
                      : shortKey(share.address)
                  }
                  value={formatBps(share.bps, locale)}
                />
              ))}
              <Txt variant="labelSm" tone="faint">
                {word('feeShareLine')}
              </Txt>
            </>
          ) : null}
          {mine ? <ShareReceiptButton doc={doc} /> : null}
        </View>
      </Sheet>
    </Card>
  )
}
