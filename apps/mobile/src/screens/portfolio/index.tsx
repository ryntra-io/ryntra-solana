import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'

import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { Icon } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { AskRyn } from '@/features/agent/ask-ryn'
import { RULES_KEY, useRules } from '@/features/autoinvest/use-rules'
import { activeCount } from '@/features/bots/bots'
import { eventFor, eventLine, SELL_FOR_USDC, swapActionWord, windowOpen } from '@/features/invest/conversion-watch'
import { shelfCardFor } from '@/features/invest/shelf'
import { useCompanyShelf } from '@/features/invest/use-shelf'
import { webHrefOf } from '@/features/monitoring/deep-link'
import { PORTFOLIO_COPY } from '@/features/portfolio/copy'
import type { PortfolioGroupView, PortfolioRow } from '@/features/portfolio/portfolio-model'
import { usePlans } from '@/features/plans/use-plans'
import { usePortfolio } from '@/features/portfolio/use-portfolio'
import { useAccount } from '@/features/session/use-account'
import { DOOR_DESTINATIONS, PLACES_COPY, PORTFOLIO_DOORS } from '@/features/shell/places'
import { WalletGate } from '@/features/wallet/wallet-gate'
import { useNow } from '@/hooks/use-now'
import { isNetworkError } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { cn } from '@/utils/cn'
import { DASH, formatMoment, isToday, formatPercent, formatUsd, formatUsdSigned, shortAddress } from '@/utils/format'

import { HoldingRow, type RowEvent } from './holding-row'
import { HoldingSheet } from './holding-sheet'
import { SellSheet } from '@/screens/invest/sell-sheet'
import { openLink } from '@/lib/open-link'

function LoadingBody({ label }: { label: string }) {
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
        <View key={index} className="flex-row items-center gap-3 border-b border-line py-3">
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
 * Beside the positions, the web's Портфель — Позиції · Історія — and «Боти»:
 * the plans and the recurring buys live there now, and the door
 * says how many run — «Боти · 2 активні» — only when that is read.
 */
function PlaceDoors({ className }: { className?: string }) {
  const router = useRouter()
  const places = useCopy(PLACES_COPY)
  const account = useAccount()
  const rules = useRules(account.session)
  const plans = usePlans(account.session)
  const running = account.session ? activeCount(rules.data?.rules ?? null, plans.data?.plans ?? null) : null
  return (
    <View className={cn('flex-row gap-2', className)}>
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
            className="h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-btn border border-line bg-surface px-2 active:border-line-strong active:bg-hover"
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
export function PortfolioScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const locale = useLocale()
  const copy = useCopy(PORTFOLIO_COPY)
  const shared = useSharedCopy()
  const now = useNow(15_000)
  const account = useAccount()
  const queryClient = useQueryClient()
  const { query, view, heldBack } = usePortfolio(account.address)
  const [dustOpen, setDustOpen] = useState(false)
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
    if (account.session) void queryClient.invalidateQueries({ queryKey: RULES_KEY })
  }

  const observedAt = view?.observedAt ?? null
  const subtitle = account.address
    ? observedAt
      ? `${shortAddress(account.address, 6)} · ${formatMoment(observedAt, now, locale)}${view?.empty && query.isError ? ` · ${copy.notUpdated}` : ''}`
      : query.isError
        ? `${shortAddress(account.address, 6)} · ${shared.didNotLoad}`
        : `${shortAddress(account.address, 6)} · ${shared.loading}`
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
  } else if (view && view.empty) {
    body = (
      <ScrollView className="flex-1" contentContainerClassName="pb-8">
        <PlaceDoors className="px-4 pt-1" />
        <StateView
          icon="pie-chart-outline"
          title={copy.emptyTitle}
          detail={copy.emptyDetail}
          action={{ title: copy.markets, onPress: () => router.navigate('/(tabs)/markets') }}
        />
      </ScrollView>
    )
  } else if (view) {
    // A day's move belongs to its day: a read kept from an earlier day shows its value and time, not «today».
    const change = isToday(view.observedAt, now) ? view.dayChange : null
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
        <Card className="gap-2">
          <Txt variant="labelSm" tone="faint" caps>
            {copy.totalValue}
          </Txt>
          {view.pricesRead ? (
            <Txt variant="dataLg" tone={view.total === null ? 'muted' : 'fg'}>
              {view.total === null ? DASH : formatUsd(view.total, locale)}
            </Txt>
          ) : (
            // The balances came back before the venue's prices: the total is being read, not a dash.
            <Skeleton className="h-7 w-36" accessibilityRole="progressbar" />
          )}
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            {change ? (
              <Chip
                label={`${formatUsdSigned(change.usd, locale)} · ${formatPercent(change.pct, locale)} ${copy.today}`}
                tone={change.usd > 0 ? 'success' : change.usd < 0 ? 'danger' : 'neutral'}
                mono
              />
            ) : null}
            <Txt variant="labelSm" tone="faint">
              {view.pricesRead
                ? `${copy.priced(view.priced, view.rows.length)}${view.unpriced > 0 ? ` · ${copy.withoutPrice(view.unpriced)} · ${copy.notInTotal}` : ''}`
                : copy.readingPrices}
            </Txt>
          </View>
          {notices.length > 0 ? (
            <View className="flex-row flex-wrap gap-2 pt-1">
              {notices.map((notice) => (
                <Chip key={notice} label={notice} tone="warning" caps={false} />
              ))}
            </View>
          ) : null}
        </Card>

        <PlaceDoors className="pt-3" />

        {view.groups.map((group) => (
          <GroupSection
            key={group.id}
            group={group}
            label={copy.groups[group.id]}
            onPick={setPicked}
            eventOf={eventOf}
          />
        ))}

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
      </ScrollView>
    )
  }

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
      <WalletGate what={copy.title}>{body}</WalletGate>
      <HoldingSheet
        row={picked}
        observedAt={observedAt}
        now={now}
        locale={locale}
        copy={copy}
        event={picked ? eventOf(picked) : null}
        onClose={() => setPicked(null)}
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
    </Screen>
  )
}
