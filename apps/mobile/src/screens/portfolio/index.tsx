import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { AskRyn } from '@/features/agent/ask-ryn'
import { RULES_KEY, useRules } from '@/features/autoinvest/use-rules'
import { activeCount } from '@/features/bots/bots'
import { eventFor, eventLine, SELL_FOR_USDC, swapActionWord, windowOpen } from '@/features/invest/conversion-watch'
import { INVEST_COPY } from '@/features/invest/copy'
import { shelfCardFor } from '@/features/invest/shelf'
import { useCompanyShelf } from '@/features/invest/use-shelf'
import { webHrefOf } from '@/features/monitoring/deep-link'
import { PORTFOLIO_COPY } from '@/features/portfolio/copy'
import type { PortfolioGroupView, PortfolioRow } from '@/features/portfolio/portfolio-model'
import { usePlans } from '@/features/plans/use-plans'
import { usePortfolio } from '@/features/portfolio/use-portfolio'
import { collateralValueUsd, phoenixHolding, valueWithPhoenix } from '@/features/futures/phoenix-portfolio'
import { useFuturesAccount, useFuturesMarkets } from '@/features/futures/use-futures'
import { useSkrName } from '@/features/seeker/use-seeker'
import { useAccount } from '@/features/session/use-account'
import { DOOR_DESTINATIONS, PLACES_COPY, PORTFOLIO_DOORS } from '@/features/shell/places'
import { WalletGate } from '@/features/wallet/wallet-gate'
import { useNow } from '@/hooks/use-now'
import { isNetworkError } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { useSpace, useTheme } from '@/theme'
import { cn } from '@/utils/cn'
import {
  DASH,
  formatClock,
  formatMoment,
  isToday,
  formatPercent,
  formatUsd,
  formatUsdSigned,
  saidFigure,
  shortAddress,
} from '@/utils/format'

import { openCount } from '@/features/limits/limit-model'
import { useLimitOrders } from '@/features/limits/use-limits'
import { PORTFOLIO_SEGMENTS, type PortfolioSegment } from '@/features/shell/places'
import { HistoryScreen } from '@/screens/history'
import { OrdersScreen } from '@/screens/orders'

import { HoldingRow, type RowEvent } from './holding-row'
import { HoldingSheet } from './holding-sheet'
import { PhoenixOrders, PhoenixSection } from './phoenix-section'
import { BuyPickSheet } from '@/screens/home/buy-pick-sheet'
import { SellSheet } from '@/screens/invest/sell-sheet'
import { openLink } from '@/lib/open-link'

function LoadingBody({ label }: { label: string }) {
  const space = useSpace()
  return (
    <View className="gap-3 px-4" accessibilityRole="progressbar" accessibilityLabel={label}>
      <Card className="gap-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-3.5 w-48" />
      </Card>
      <View className="flex-row gap-2">
        <Skeleton className="h-11 flex-1 rounded-btn" />
        <Skeleton className="h-11 flex-1 rounded-btn" />
      </View>
      {Array.from({ length: 6 }, (_, index) => (
        <View key={index} className={`flex-row items-center gap-3 border-b border-line ${space.row}`}>
          <Skeleton className="h-10 w-10 rounded-pill" />
          <View className="flex-1 gap-2">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3 w-28" />
          </View>
          <View className="items-end gap-2">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-4 w-14 rounded-pill" />
          </View>
        </View>
      ))}
    </View>
  )
}

/**
 * Under the assets: «Боти» — the plans and the recurring buys live there, and
 * the door says how many run, «Боти · 2 активні», only when that is read — and
 * «Квитанції». Ордери and Історія are the place's own segments.
 */
function PlaceDoors({ className }: { className?: string }) {
  const router = useRouter()
  const places = useCopy(PLACES_COPY)
  const account = useAccount()
  const rules = useRules(account.session)
  const plans = usePlans(account.session)
  const running = account.session ? activeCount(rules.data?.rules ?? null, plans.data?.plans ?? null) : null
  return (
    <View className={cn('flex-row flex-wrap gap-2', className)}>
      {PORTFOLIO_DOORS.map((door) => {
        const destination = DOOR_DESTINATIONS[door]
        const web = destination.kind === 'web' ? webHrefOf(destination.path) : null
        const label =
          door === 'bots' && running !== null && running > 0
            ? `${places.doors[door]} · ${places.active(running)}`
            : places.doors[door]
        return (
          <Pressable
            key={door}
            accessibilityRole="button"
            accessibilityLabel={web ? `${label}, ${places.onWeb}` : label}
            onPress={() => {
              if (web) openLink(web)
              else if (destination.kind === 'screen') router.push(destination.path as never)
            }}
            className="h-11 grow basis-[45%] flex-row items-center justify-center gap-1.5 rounded-btn border border-line bg-surface px-2 active:border-line-strong active:bg-hover"
          >
            <Txt variant="ui" numberOfLines={1}>
              {label}
            </Txt>
            {web ? <Icon name="open-outline" size={14} color="fgMuted" /> : null}
          </Pressable>
        )
      })}
    </View>
  )
}

function GroupSection({
  group,
  label,
  onPick,
  eventOf,
}: {
  group: PortfolioGroupView
  label: string
  onPick: (row: PortfolioRow) => void
  eventOf: (row: PortfolioRow) => RowEvent | null
}) {
  const copy = useCopy(PORTFOLIO_COPY)
  const locale = useLocale()
  return (
    <View>
      <View className="flex-row items-end justify-between px-1 pb-1 pt-4">
        <Txt variant="labelSm" tone="faint" caps>
          {label} · {group.rows.length}
        </Txt>
        <Txt variant="data" tone="muted">
          {group.subtotal === null ? DASH : formatUsd(group.subtotal, locale)}
        </Txt>
      </View>
      {group.rows.map((row, index) => (
        <HoldingRow
          key={row.key}
          row={row}
          copy={copy}
          onPress={() => onPick(row)}
          last={index === group.rows.length - 1}
          event={eventOf(row)}
        />
      ))}
    </View>
  )
}

/**
 * What the wallet holds — the value of what could be priced, how many rows
 * could not be, the day's move over the rows that carry one, the doors to
 * «Боти» and the history, then the positions grouped by
 * what they are, and the dust folded under one line.
 * Public by address: the connected wallet is enough; nothing here needs a
 * signature. A position opens a sheet with its figures and its doors.
 * A held token whose issuer opened a window to swap it carries the deadline
 * under its row — «Обміняй SPACEX до 12 березня 2027 — після строку токен
 * згорить.» — with «Обміняти на SpaceX (SPCXx)» and the quiet «Продати за
 * USDC», each opening the swap's sheet on the token's page; the window
 * comes from the universe the shelf reads, the same answer the page reads.
 */
export function PortfolioScreen({
  asked = null,
  onAskedSeen,
}: {
  /** An older `/orders` link, a note's or a push's: «Ордери» on that order. */
  asked?: Readonly<{ segment: PortfolioSegment; order: string | null }> | null
  onAskedSeen?: () => void
} = {}) {
  const router = useRouter()
  const { colors } = useTheme()
  const locale = useLocale()
  const copy = useCopy(PORTFOLIO_COPY)
  const investCopy = useCopy(INVEST_COPY)
  const shared = useSharedCopy()
  const now = useNow(15_000)
  const account = useAccount()
  const accountName = useSkrName(account.address, account.session)
  const queryClient = useQueryClient()
  const { query, view, heldBack } = usePortfolio(account.address)
  const places = useCopy(PLACES_COPY)
  const [segment, setSegment] = useState<PortfolioSegment>(asked?.segment ?? 'assets')
  const [focusOrder, setFocusOrder] = useState<string | null>(asked?.order ?? null)
  // A position's «Історія» opens the place's own segment on that asset (NEW-LOOK §5).
  const [historyAsset, setHistoryAsset] = useState<Readonly<{ mint: string; symbol: string }> | null>(null)
  // A segment asked for while the place is open (a note's «Мої ордери») wins once, during render.
  const [askedSeen, setAskedSeen] = useState(asked)
  if (asked !== askedSeen) {
    setAskedSeen(asked)
    if (asked) {
      setSegment(asked.segment)
      setHistoryAsset(null)
      setFocusOrder(asked.order)
    }
  }
  useEffect(() => {
    if (asked) onAskedSeen?.()
  }, [asked, onAskedSeen])
  const limitOrders = useLimitOrders(account.session)
  /* The wallet's Phoenix account (C4f): a trade opened on the web, or anywhere, is the same position here. */
  const phoenixRead = useFuturesAccount(account.address)
  // The marks price the positions' results: read only while there are positions.
  const futuresMarkets = useFuturesMarkets((phoenixRead.data?.positions.length ?? 0) > 0)
  const holding = phoenixHolding(phoenixRead.data, futuresMarkets.data?.markets ?? [])
  const waiting = (limitOrders.data ? openCount(limitOrders.data.orders) : 0) + (holding?.orders.length ?? 0)
  const [dustOpen, setDustOpen] = useState(false)
  // «Купити» under an empty Portfolio opens Home's «Що купити».
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<PortfolioRow | null>(null)
  // A company's position sold from here: the position's sheet closes and the sale's opens in its place.
  const [selling, setSelling] = useState<PortfolioRow | null>(null)
  const shelf = useCompanyShelf()
  const events = shelf.shelf?.events ?? null
  // A company sold on its own sheet: one the shelf offers — a supported issuer, trading, priced; anything else in Trade.
  const onShelf = new Set(
    [...(shelf.shelf?.companies ?? []), ...(shelf.shelf?.privateCompanies ?? [])].map((card) => card.mint),
  )
  /* The issuer's window on a held token: the holder's line, and while it is open the swap and the sale on its page. */
  const eventOf = (row: PortfolioRow): RowEvent | null => {
    const event = eventFor(events, row.mint)
    if (!event || row.amountRaw === '0') return null
    const open = windowOpen(event, now)
    const page = (action: 'convert' | 'sell') => () => {
      setPicked(null)
      router.push({
        pathname: '/asset/[mint]',
        params: { mint: row.mint, symbol: row.symbol, category: 'stock', [action]: '1' },
      })
    }
    const swap = open ? swapActionWord(event, locale) : null
    return {
      line: eventLine(event, 'holder', locale, now),
      actions: open
        ? {
            swap: swap ? { title: swap, onPress: page('convert') } : null,
            sell: { title: SELL_FOR_USDC[locale], onPress: page('sell') },
          }
        : null,
    }
  }
  const refresh = () => {
    void query.refetch()
    if (account.address) void phoenixRead.refetch()
    if (account.session) void queryClient.invalidateQueries({ queryKey: RULES_KEY })
  }

  const observedAt = view?.observedAt ?? null
  /* Portfolio's value with the collateral on Phoenix (SOL-C6, C4f): the USDC and SOL posted, at the wallet's SOL price. */
  const solPrice = view?.rows.find((row) => row.native)?.price ?? null
  const value = view
    ? valueWithPhoenix(
        view.empty ? 0 : view.total,
        account.address ? { status: phoenixRead.status, account: phoenixRead.data } : null,
        solPrice,
      )
    : null
  const headTotal = value?.total ?? null
  // The day's move is the wallet's: said so under a value that holds the collateral too.
  const dayWord = value?.phoenix === 'counted' ? copy.walletOverDay : copy.overDay
  const phoenixLine =
    value?.phoenix === 'counted' && value.phoenixUsd !== null
      ? // A kept read older than two polls says its time: the collateral is as Phoenix stood then.
        [
          copy.withPhoenix(formatUsd(value.phoenixUsd, locale)),
          phoenixRead.data && now - phoenixRead.data.observedAt > 60_000
            ? formatClock(new Date(phoenixRead.data.observedAt).toISOString())
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : value?.phoenix === 'reading'
        ? copy.phoenixReading
        : value?.phoenix === 'unread'
          ? copy.phoenixUnread
          : null
  // Whose portfolio: the wallet's `.skr` name when it has one, else its short address (M41.2).
  const owner = account.address ? (accountName ?? shortAddress(account.address)) : null
  const subtitle = owner
    ? observedAt
      ? `${owner} · ${formatMoment(observedAt, now, locale)}${view?.empty && query.isError ? ` · ${copy.notUpdated}` : ''}`
      : query.isError
        ? `${owner} · ${shared.didNotLoad}`
        : `${owner} · ${shared.loading}`
    : undefined

  let body
  if (!account.address) {
    body = null
  } else if (query.isPending) {
    body = <LoadingBody label={copy.loading} />
  } else if (query.isError && !view) {
    body = (
      <StateView
        icon={isNetworkError(query.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={isNetworkError(query.error) ? shared.noConnection : copy.didNotLoad}
        detail={isNetworkError(query.error) ? shared.needsNetwork : query.error.message}
        action={{ title: shared.tryAgain, onPress: () => void query.refetch(), loading: query.isFetching }}
      />
    )
  } else if (view && view.empty && !holding) {
    body = (
      <ScrollView className="flex-1" contentContainerClassName="pb-8">
        {/* As «Гроші» say it: one quiet line, and its one way on — «Купити» opens «Що купити»; the doors under it. */}
        <View className="items-center gap-3 px-4 pt-2">
          <Txt variant="ui" tone="faint" className="text-center">
            {copy.emptyLine}
          </Txt>
          <Button title={copy.buy} variant="secondary" size="sm" hitSlop={6} onPress={() => setPicking(true)} />
        </View>
        <PlaceDoors className="px-4 pt-6" />
      </ScrollView>
    )
  } else if (view) {
    const notices = [
      heldBack ? copy.heldBack(formatMoment(view.observedAt, now, locale)) : null,
      view.coverage === 'PARTIAL' ? copy.partlyRead : null,
      view.coverage === 'UNAVAILABLE' ? copy.notRead : null,
      query.isError ? shared.refreshFailed : null,
    ].filter((notice): notice is string => notice !== null)
    body = (
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-8"
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching && !query.isPending}
            onRefresh={refresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        <View className="gap-2">
          {view.pricesRead ? null : (
            <Txt variant="labelSm" tone="faint">
              {copy.readingPrices}
            </Txt>
          )}
          {notices.length > 0 ? (
            <View className="flex-row flex-wrap gap-2 pt-1">
              {notices.map((notice) => (
                <Chip key={notice} label={notice} tone="warning" caps={false} />
              ))}
            </View>
          ) : null}
        </View>

        {view.groups.map((group) => (
          <GroupSection
            key={group.id}
            group={group}
            label={copy.groups[group.id]}
            onPick={setPicked}
            eventOf={eventOf}
          />
        ))}

        {holding ? (
          <PhoenixSection holding={holding} valueUsd={collateralValueUsd(phoenixRead.data, solPrice)} />
        ) : null}

        {view.dust.length > 0 ? (
          <View className="pt-4">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: dustOpen }}
              onPress={() => setDustOpen((open) => !open)}
              className="flex-row items-center justify-between rounded-sm border border-line bg-surface px-4 py-3 active:bg-hover"
            >
              <Txt variant="ui" tone="muted">
                {dustOpen ? copy.hideDust : copy.dust(view.dust.length)}
              </Txt>
              <Icon name={dustOpen ? 'chevron-up' : 'chevron-down'} size={18} />
            </Pressable>
            {dustOpen
              ? view.dust.map((row, index) => (
                  <HoldingRow
                    key={row.key}
                    row={row}
                    copy={copy}
                    onPress={() => setPicked(row)}
                    last={index === view.dust.length - 1}
                    event={eventOf(row)}
                  />
                ))
              : null}
          </View>
        ) : null}

        {/* Under the list (NEW-LOOK §3): Боти · Квитанції. */}
        <PlaceDoors className="pt-4" />
      </ScrollView>
    )
  }

  // The place's head (NEW-LOOK §3): the value and the day's move above the switch, whichever segment is open.
  // A day's move belongs to its day: a read kept from an earlier day shows its value and time, not «today».
  const headView = view && (!view.empty || holding) ? view : null
  const headChange = headView && isToday(headView.observedAt, now) ? headView.dayChange : null
  const head = headView ? (
    <View className="mx-4 mb-3 gap-1">
      <View className="flex-row flex-wrap items-center gap-1">
        <View
          accessible
          accessibilityLabel={[
            copy.totalValue,
            headView.pricesRead
              ? saidFigure(headTotal === null ? DASH : formatUsd(headTotal, locale), locale)
              : copy.readingPrices,
            phoenixLine,
            headChange
              ? `${formatUsdSigned(headChange.usd, locale)} · ${formatPercent(headChange.pct, locale)} ${dayWord}`
              : null,
          ]
            .filter(Boolean)
            .join(', ')}
        >
          {headView.pricesRead ? (
            <Txt variant="dataLg" tone={headTotal === null ? 'muted' : 'fg'}>
              {headTotal === null ? DASH : formatUsd(headTotal, locale)}
            </Txt>
          ) : (
            // The balances came back before the venue's prices: the total is being read, not a dash.
            <Skeleton className="h-7 w-36" accessibilityRole="progressbar" />
          )}
        </View>
        {/* Balances without a price are said one tap deep, beside the total they are not in (ST-4). */}
        {headView.pricesRead && headView.unpriced > 0 ? (
          <Txt variant="labelSm" tone="faint" className="pl-1">
            {investCopy.unpriced(headView.unpriced)}
          </Txt>
        ) : null}
        {headView.pricesRead && headView.unpriced > 0 ? (
          <HelpDot
            title={investCopy.unpricedTitle}
            body={investCopy.unpricedHelp(headView.unpriced, headView.rows.length)}
          />
        ) : null}
      </View>
      {/* What Phoenix adds to the value, or why it is not in it (SOL-C6): never a silent drop of the collateral. */}
      {headView.pricesRead && phoenixLine ? (
        <Txt variant="labelSm" tone="faint" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {phoenixLine}
        </Txt>
      ) : null}
      {headChange ? (
        <Txt
          variant="data"
          tone={headChange.usd > 0 ? 'success' : headChange.usd < 0 ? 'danger' : 'muted'}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {`${formatUsdSigned(headChange.usd, locale)} · ${formatPercent(headChange.pct, locale)} ${dayWord}`}
        </Txt>
      ) : null}
    </View>
  ) : null

  return (
    <Screen
      title={copy.title}
      subtitle={subtitle}
      scroll={false}
      right={
        account.address ? (
          <View className="flex-row items-center gap-2">
            {account.session ? (
              <AskRyn context={{ kind: 'portfolio' }} className="h-9 w-9 border border-line bg-surface" />
            ) : null}
          </View>
        ) : undefined
      }
    >
      {head}
      {/* Активи · Ордери · Історія (NEW-LOOK §3 «Портфель»); «Ордери» counts what waits. */}
      <View
        accessibilityRole="tablist"
        accessibilityLabel={copy.title}
        className="mx-4 mb-3 flex-row gap-1 rounded-lg border border-line bg-surface p-1"
      >
        {PORTFOLIO_SEGMENTS.map((value) => {
          const on = value === segment
          return (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={
                value === 'orders' && waiting > 0 ? `${places.segments[value]}, ${waiting}` : places.segments[value]
              }
              onPress={() => {
                setSegment(value)
                setHistoryAsset(null)
              }}
              className={cn(
                'h-12 flex-1 flex-row items-center justify-center gap-1.5 rounded-md',
                on ? 'border border-line-strong bg-elevated' : 'active:bg-hover',
              )}
            >
              <Txt variant="ui" tone={on ? 'fg' : 'muted'} numberOfLines={1}>
                {places.segments[value]}
              </Txt>
              {value === 'orders' && waiting > 0 ? (
                <Txt variant="data" tone="muted">
                  {String(waiting)}
                </Txt>
              ) : null}
            </Pressable>
          )
        })}
      </View>
      {segment === 'orders' ? (
        <OrdersScreen
          embedded
          order={focusOrder}
          above={holding && holding.orders.length > 0 ? <PhoenixOrders holding={holding} /> : null}
          onRefresh={account.address ? () => void phoenixRead.refetch() : undefined}
        />
      ) : segment === 'history' ? (
        <HistoryScreen
          embedded
          key={historyAsset?.mint ?? 'all'}
          asset={historyAsset}
          onAllAssets={() => setHistoryAsset(null)}
        />
      ) : (
        <WalletGate what={copy.title}>{body}</WalletGate>
      )}
      <HoldingSheet
        row={picked}
        observedAt={observedAt}
        now={now}
        locale={locale}
        copy={copy}
        event={picked ? eventOf(picked) : null}
        onClose={() => setPicked(null)}
        onHistory={(row) => {
          setPicked(null)
          setHistoryAsset({ mint: row.mint, symbol: row.symbol })
          setSegment('history')
        }}
        onSell={
          // Only a movable balance is sold on the sheet; anything else goes to Trade, as before.
          picked &&
          onShelf.has(picked.mint) &&
          eventFor(events, picked.mint) === null &&
          /^\d+$/.test(picked.spendableRaw) &&
          BigInt(picked.spendableRaw) > 0n
            ? (row) => {
                setPicked(null)
                setSelling(row)
              }
            : undefined
        }
      />
      {selling ? (
        <SellSheet
          visible
          mint={selling.mint}
          hint={{
            // The company as the shelf names it; a row carries the token's catalogue name.
            name: shelfCardFor(shelf.shelf, selling.mint)?.name ?? selling.name ?? selling.symbol,
            icon: selling.icon,
            ticker: selling.symbol,
          }}
          onClose={() => setSelling(null)}
        />
      ) : null}
      <BuyPickSheet visible={picking} onClose={() => setPicking(false)} />
    </Screen>
  )
}
