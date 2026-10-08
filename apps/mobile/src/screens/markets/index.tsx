import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AssetRow, type AssetRowAsset } from '@/components/asset-row'
import { Chip } from '@/components/chip'
import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { FilterSheet, type FilterOption } from '@/components/filter-sheet'
import { Icon } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { SearchBar } from '@/components/search-field'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { AskRyn } from '@/features/agent/ask-ryn'
import { markPremium } from '@/features/invest/shelf'
import { MARKETS_COPY, type MarketsCopy } from '@/features/markets/copy'
import {
  marketScreenerRow,
  rowsForTab,
  SCREENER_TABS,
  screenerTabOf,
  sortRows,
  sortsFor,
  stockScreenerRow,
  uniqueRows,
  type ScreenerRow,
  type ScreenerSort,
  type ScreenerTab,
} from '@/features/markets/screener'
import { useWatchlist } from '@/features/watchlist/watchlist'
import { useMarkets, useStockUniverse, useWatchlistMarkets } from '@/hooks/use-markets'
import { useNow } from '@/hooks/use-now'
import { isNetworkError, type MarketsResponse } from '@/lib/api'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'
import { readPreference, writePreference } from '@/lib/preferences'
import { issuerLabel, sessionWord } from '@/lib/stocks'
import { useTheme } from '@/theme'
import { formatAge, formatClock } from '@/utils/format'

const TAB_KEY = 'markets.screener.tab'

type Row = AssetRowAsset & Readonly<{ mint: string; source: ScreenerRow }>

function LoadingRows({ label }: { label: string }) {
  return (
    <View className="px-4" accessibilityLabel={label} accessibilityRole="progressbar">
      {Array.from({ length: 8 }, (_, index) => (
        <View key={index} className="flex-row items-center gap-3 border-b border-line py-3">
          <Skeleton className="h-10 w-10 rounded-pill" />
          <View className="flex-1 gap-2">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3 w-36" />
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

/** The oldest of the reads a list is drawn from: the time the whole list is true at. */
function oldest(...times: readonly (string | null | undefined)[]): string | null {
  let found: string | null = null
  for (const time of times) {
    if (!time) continue
    if (found === null || Date.parse(time) < Date.parse(found)) found = time
  }
  return found
}

/**
 * «Ринки» — one screener for every asset (the web's `/app/markets`):
 * Усі · Меми · Крипта · Акції · Приватні · Обране over one list. A row is a
 * logo, the ticker, the name with the issuer and the exchange's session (or
 * «Це не акція» and the price against PreStocks' valuation), the price and the
 * day's change; it opens the token's page. The order is the person's own —
 * «У тренді» first, then «Зростають», «Падають», «Ліквідність», and «До біржі»
 * for stocks. The search above finds any token by its name, ticker or contract
 * address. Every list carries the time it was read; a stale or partial read
 * says so.
 */
export function MarketsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { colors } = useTheme()
  const locale = useLocale()
  const words = useCopy(MARKETS_COPY)
  const now = useNow(15_000)
  const params = useLocalSearchParams<{ tab?: string; kind?: string; mode?: string }>()
  const asked = params.tab || params.kind || params.mode ? screenerTabOf(params) : null
  const [tab, setTabState] = useState<ScreenerTab>(() => asked ?? readPreference(TAB_KEY, SCREENER_TABS, 'all'))
  const [sort, setSort] = useState<ScreenerSort>('volume')
  // A tab asked for while the screen is already mounted (Home → the watchlist) wins once, during render.
  const [askedSeen, setAskedSeen] = useState(asked)
  if (asked !== askedSeen) {
    setAskedSeen(asked)
    if (asked && asked !== tab) {
      setTabState(asked)
      if (asked !== 'stocks' && sort === 'deviation') setSort('volume')
    }
  }
  // The ask is spent once read, so the same link — Home's «Обране» again — switches the tab again.
  useEffect(() => {
    if (asked) router.setParams({ tab: undefined, kind: undefined, mode: undefined })
  }, [asked, router])
  const [sortOpen, setSortOpen] = useState(false)
  const watchlist = useWatchlist()

  const wantsCoins = tab === 'all' || tab === 'memes' || tab === 'crypto'
  const wantsStocks = tab === 'all' || tab === 'stocks' || tab === 'private'
  const crypto = useMarkets('crypto', tab === 'all' || tab === 'crypto')
  const memes = useMarkets('meme', tab === 'all' || tab === 'memes')
  const stocks = useStockUniverse(wantsStocks)
  const watched = useWatchlistMarkets(tab === 'watchlist' ? watchlist.mints : [])

  const setTab = (next: ScreenerTab) => {
    setTabState(next)
    writePreference(TAB_KEY, next)
    if (next !== 'stocks' && sort === 'deviation') setSort('volume')
  }

  const list = useMemo(() => {
    if (tab === 'watchlist') {
      const data = watched.data
      return {
        rows: (data?.rows ?? [])
          .map((row) => marketScreenerRow(row, { stocks: true }))
          .filter((row): row is ScreenerRow => row !== null),
        observedAt: data?.observedAt ?? null,
        stale: data?.stale ?? false,
        partial: false,
        missing: data?.missing.length ?? 0,
      }
    }
    const coinRows = (data: MarketsResponse | undefined) =>
      (data?.rows ?? []).map((row) => marketScreenerRow(row)).filter((row): row is ScreenerRow => row !== null)
    const stockRows = (stocks.data?.rows ?? []).map(stockScreenerRow)
    const rows = uniqueRows(
      tab === 'all' || tab === 'crypto' ? coinRows(crypto.data) : [],
      tab === 'all' || tab === 'memes' ? coinRows(memes.data) : [],
      wantsStocks ? stockRows : [],
    )
    return {
      rows: rowsForTab(rows, tab),
      observedAt: oldest(
        tab === 'all' || tab === 'crypto' ? crypto.data?.observedAt : null,
        tab === 'all' || tab === 'memes' ? memes.data?.observedAt : null,
        wantsStocks ? stocks.data?.fetchedAt : null,
      ),
      stale: Boolean((tab !== 'memes' && crypto.data?.stale) || (tab !== 'crypto' && memes.data?.stale)) && wantsCoins,
      partial:
        Boolean((tab !== 'memes' && crypto.data?.partial) || (tab !== 'crypto' && memes.data?.partial)) && wantsCoins,
      missing: 0,
    }
  }, [tab, watched.data, crypto.data, memes.data, stocks.data, wantsCoins, wantsStocks])

  const rows = useMemo(
    () => sortRows(list.rows, sort).map((row) => rowOf(row, locale, words)),
    [list.rows, sort, locale, words],
  )

  /* the reads this tab stands on, and how each of them answered */
  const reads =
    tab === 'watchlist'
      ? [watched]
      : [
          ...(tab === 'all' || tab === 'crypto' ? [crypto] : []),
          ...(tab === 'all' || tab === 'memes' ? [memes] : []),
          ...(wantsStocks ? [stocks] : []),
        ]
  const pending = reads.some((read) => read.isPending) && rows.length === 0
  const failed = reads.filter((read) => read.isError)
  const fetching = reads.some((read) => read.isFetching)
  const refetch = () => {
    for (const read of reads) void read.refetch()
  }
  const coinsFailed = tab === 'all' && ((crypto.isError && !crypto.data) || (memes.isError && !memes.data))
  const stocksFailed = tab === 'all' && stocks.isError && !stocks.data

  const sortOptions = useMemo(
    (): FilterOption<ScreenerSort>[] => sortsFor(tab).map((value) => ({ value, ...words.sorts[value] })),
    [tab, words],
  )

  const tabs: readonly Choice<ScreenerTab>[] = SCREENER_TABS.map((value) => ({
    value,
    label:
      value === 'watchlist' && watchlist.mints.length > 0
        ? `${words.tabs.watchlist} · ${watchlist.mints.length}`
        : words.tabs[value],
    accessibilityLabel: words.tabs[value],
  }))

  const emptyWatchlist = tab === 'watchlist' && watchlist.mints.length === 0
  const watchlistNote = watchlist.onDevice
    ? words.onDevice
    : watchlist.pending
      ? words.waitingSync
      : watchlist.syncedAt
        ? words.synced(formatClock(watchlist.syncedAt))
        : words.walletList
  const subtitle = emptyWatchlist
    ? watchlist.onDevice
      ? words.keptOnDevice
      : words.walletListTitle
    : list.observedAt
      ? `${formatClock(list.observedAt)} · ${formatAge(list.observedAt, now, locale)}${tab === 'watchlist' ? ` · ${watchlistNote}` : ''}`
      : failed.length > 0
        ? words.notLoaded
        : words.loading

  const open = useCallback(
    (row: Row) => {
      const source = row.source
      const stock = source.kind === 'stock' || source.kind === 'private'
      router.push({
        pathname: '/asset/[mint]',
        params: stock
          ? { mint: row.mint, symbol: source.symbol, category: 'stock' }
          : { mint: row.mint, symbol: source.symbol },
      })
    },
    [router],
  )
  const renderItem = useCallback(
    ({ item, index }: { item: Row; index: number }) => (
      <AssetRow asset={item} onPress={() => open(item)} last={index === rows.length - 1} />
    ),
    [open, rows.length],
  )

  let body
  if (emptyWatchlist) {
    body = <StateView icon="star-outline" title={words.watchEmpty} detail={words.watchEmptyLine} />
  } else if (pending) {
    body = <LoadingRows label={words.loadingA11y} />
  } else if (rows.length === 0 && failed.length > 0) {
    const error = failed[0]!.error
    body = (
      <StateView
        icon={isNetworkError(error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={isNetworkError(error) ? words.noConnection : words.listDown}
        detail={isNetworkError(error) ? words.listNeedsNetwork : words.listDownLine}
        action={{ title: words.tryAgain, onPress: refetch, loading: fetching }}
      />
    )
  } else if (rows.length === 0) {
    body = (
      <StateView
        icon="list-outline"
        title={words.listEmpty}
        detail={tab === 'watchlist' ? words.watchNoneListed : words.categoryEmpty}
        action={{ title: words.refresh, onPress: refetch, loading: fetching }}
      />
    )
  } else {
    const notices = [
      list.stale ? (tab === 'all' ? words.coinsStale : words.stale) : null,
      list.partial ? words.partial : null,
      list.missing > 0 ? words.notListed(list.missing) : null,
      coinsFailed ? words.coinsDown : null,
      stocksFailed ? words.stocksDown : null,
      failed.length > 0 && !coinsFailed && !stocksFailed ? words.refreshFailed : null,
    ].filter((notice): notice is string => notice !== null)
    const line = tab === 'memes' ? words.memesRisk : tab === 'private' ? words.privateLine : null
    body = (
      <FlatList
        data={rows}
        keyExtractor={(item) => item.mint}
        renderItem={renderItem}
        contentContainerClassName="px-4 pb-6"
        initialNumToRender={14}
        maxToRenderPerBatch={12}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={fetching && !pending}
            onRefresh={refetch}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
        ListHeaderComponent={
          notices.length > 0 || line ? (
            <View className="gap-2 pb-2">
              {line ? (
                <Txt variant="ui" tone="muted">
                  {line}
                </Txt>
              ) : null}
              {notices.length > 0 ? (
                <View className="flex-row flex-wrap gap-2">
                  {notices.map((notice) => (
                    <Chip key={notice} label={notice} tone="warning" caps={false} />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null
        }
      />
    )
  }

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <ScreenHeader
        title={words.title}
        subtitle={subtitle}
        right={
          <View className="flex-row items-center gap-2">
            <AskRyn
              context={{ kind: 'page', page: tab === 'stocks' || tab === 'private' ? 'stocks' : 'trends' }}
              label={words.askRyntra}
              className="h-9 w-9 border border-line bg-surface"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={words.sortA11y(words.sorts[sort].label)}
              onPress={() => setSortOpen(true)}
              className="h-9 w-9 items-center justify-center rounded-btn border border-line bg-surface active:bg-hover"
            >
              <Icon name="swap-vertical" size={18} color="muted" />
            </Pressable>
          </View>
        }
      />
      <View className="px-4 pb-3">
        <SearchBar onPress={() => router.push('/search')} />
      </View>
      <View accessibilityLabel={words.tabsA11y}>
        <ChoiceChips choices={tabs} value={tab} onChange={setTab} role="tablist" scroll quiet className="px-4 pb-3" />
      </View>
      {body}
      <FilterSheet
        visible={sortOpen}
        title={words.sortBy}
        options={sortOptions}
        value={sort}
        onSelect={setSort}
        onClose={() => setSortOpen(false)}
      />
    </View>
  )
}

/** «+2,2% до оцінки» — the token against PreStocks' own valuation, the web's «До оцінки»; null when none is stated. */
function valuationNote(
  pct: number | null,
  locale: Locale,
  words: Pick<MarketsCopy, 'toValuation' | 'atValuation'>,
): string | null {
  const premium = markPremium(pct)
  if (!premium) return null
  if (premium.side === 'at') return words.atValuation
  const figure = new Intl.NumberFormat(locale === 'uk' ? 'uk-UA' : 'en-US', { maximumFractionDigits: 1 }).format(
    premium.pct,
  )
  return words.toValuation(`${premium.side === 'above' ? '+' : '−'}${figure}%`)
}

/**
 * A screener row as the list draws it: under the name, the issuer and the
 * session — or, for a private company, «Це не акція» and the token against
 * PreStocks' valuation (the tab's own line names PreStocks, so the row does not).
 */
function rowOf(row: ScreenerRow, locale: Locale, words: MarketsCopy): Row {
  const stock = row.kind === 'stock' || row.kind === 'private'
  const notes =
    row.kind === 'private'
      ? [words.notAShare, valuationNote(row.markPremium, locale, words)]
      : [row.period ? sessionWord(row.period, locale) : null]
  if (stock && !row.tradable && !row.halted) notes.push(words.notOffered)
  return {
    mint: row.mint,
    source: row,
    symbol: row.symbol,
    name: row.name,
    icon: row.icon,
    price: row.price,
    change24hPct: row.change24h,
    issuer: row.kind === 'stock' && row.issuer ? { label: issuerLabel(row.issuer) } : null,
    note: notes.filter(Boolean).join(' · ') || null,
    halted: row.halted,
    verified: stock ? undefined : row.verified,
    suspicious: row.suspicious,
  }
}
