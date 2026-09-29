import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
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
import { MARKETS_COPY, type MarketsSortKey } from '@/features/markets/copy'
import { useWatchlist } from '@/features/watchlist/watchlist'
import { useMarkets, useStockUniverse, useWatchlistMarkets } from '@/hooks/use-markets'
import { useNow } from '@/hooks/use-now'
import { isNetworkError, type MarketRow, type StockUniverseRow } from '@/lib/api'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'
import { readPreference, writePreference } from '@/lib/preferences'
import { issuerLabel, sessionWord } from '@/lib/stocks'
import { useTheme } from '@/theme'
import { formatAge, formatClock } from '@/utils/format'

const TABS = ['watchlist', 'stock', 'crypto', 'meme'] as const
type MarketsTab = (typeof TABS)[number]

const TAB_KEY = 'markets.tab'

function isTab(value: unknown): value is MarketsTab {
  return typeof value === 'string' && (TABS as readonly string[]).includes(value)
}

type SortKey = MarketsSortKey

const SORT_KEYS: readonly SortKey[] = ['volume', 'change', 'name']
const STOCK_SORT_KEYS: readonly SortKey[] = [...SORT_KEYS, 'deviation']

/** One row of any list: what AssetRow draws, plus the figures the sort reads. */
type ListRow = AssetRowAsset & Readonly<{ mint: string; volume: number | null; deviation: number | null }>

function fromMarket(row: MarketRow): ListRow {
  return {
    mint: row.mint,
    symbol: row.symbol,
    name: row.name,
    icon: row.icon,
    price: row.price,
    change24hPct: row.change24hPct,
    issuer: row.issuer,
    verified: row.verified,
    suspicious: row.suspicious,
    volume: row.volume24hUsd,
    deviation: null,
  }
}

function fromStock(row: StockUniverseRow, locale: Locale): ListRow {
  return {
    mint: row.mint,
    symbol: row.symbol,
    name: row.name,
    icon: row.icon,
    price: row.price,
    change24hPct: row.change24h,
    issuer: { label: issuerLabel(row.issuer) },
    note: row.period === 'unknown' ? null : sessionWord(row.period, locale),
    halted: row.halted,
    volume: row.volume,
    deviation: row.deviation,
  }
}

const size = (value: number | null | undefined): number =>
  value === null || value === undefined ? Number.NEGATIVE_INFINITY : Math.abs(value)

function sortRows(rows: readonly ListRow[], sort: SortKey): ListRow[] {
  const copy = [...rows]
  switch (sort) {
    case 'name':
      return copy.sort((a, b) => a.symbol.localeCompare(b.symbol))
    case 'change':
      return copy.sort((a, b) => size(b.change24hPct) - size(a.change24hPct))
    case 'deviation':
      return copy.sort((a, b) => size(b.deviation) - size(a.deviation))
    default:
      return copy.sort((a, b) => size(b.volume) - size(a.volume))
  }
}

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

/**
 * The market catalogue, wallet-free: search on top, then Watchlist · Stocks ·
 * Crypto · Memes. Every price carries the time the server observed it; a
 * stale or partial list says so instead of pretending. The watchlist lives
 * on the device until the wallet session syncs it. Since one version (canon
 * v5.3 В28) a stack screen of Markets' «Для досвідчених» — «Акції» opens it
 * on Stocks, «Тренди» on Crypto — with its way back. Every word and figure is
 * in the person's language (M22): Список спостереження · Акції · Крипта · Меми.
 */
export function MarketsScreen({ onBack }: { onBack?: () => void } = {}) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { colors } = useTheme()
  const locale = useLocale()
  const words = useCopy(MARKETS_COPY)
  const now = useNow(15_000)
  const params = useLocalSearchParams<{ tab?: string }>()
  const asked = isTab(params.tab) ? params.tab : null
  const [tab, setTabState] = useState<MarketsTab>(() => asked ?? readPreference(TAB_KEY, TABS, 'stock'))
  // A tab asked for while the screen is already mounted (Home → the watchlist) wins once, during render.
  const [askedSeen, setAskedSeen] = useState(asked)
  if (asked !== askedSeen) {
    setAskedSeen(asked)
    if (asked && asked !== tab) setTabState(asked)
  }
  const [sort, setSort] = useState<SortKey>('volume')
  const [sortOpen, setSortOpen] = useState(false)
  const watchlist = useWatchlist()

  const watched = useWatchlistMarkets(tab === 'watchlist' ? watchlist.mints : [])
  const stocks = useStockUniverse(tab === 'stock')
  const crypto = useMarkets('crypto', tab === 'crypto')
  const memes = useMarkets('meme', tab === 'meme')

  const sortOptions = useMemo(() => {
    const option = (value: SortKey): FilterOption<SortKey> => ({ value, ...words.sorts[value] })
    return { all: SORT_KEYS.map(option), stock: STOCK_SORT_KEYS.map(option) }
  }, [words])

  const setTab = (next: MarketsTab) => {
    setTabState(next)
    writePreference(TAB_KEY, next)
    if (next !== 'stock' && sort === 'deviation') setSort('volume')
  }

  const query = tab === 'watchlist' ? watched : tab === 'stock' ? stocks : tab === 'crypto' ? crypto : memes
  const list = useMemo((): {
    rows: ListRow[]
    observedAt: string | null
    stale: boolean
    partial: boolean
    missing: number
  } => {
    if (tab === 'stock') {
      const data = stocks.data
      return {
        rows: data ? data.rows.map((row) => fromStock(row, locale)) : [],
        observedAt: data?.fetchedAt ?? null,
        stale: false,
        partial: false,
        missing: 0,
      }
    }
    if (tab === 'watchlist') {
      const data = watched.data
      return {
        rows: data ? data.rows.map(fromMarket) : [],
        observedAt: data?.observedAt ?? null,
        stale: data?.stale ?? false,
        partial: false,
        missing: data?.missing.length ?? 0,
      }
    }
    const data = tab === 'crypto' ? crypto.data : memes.data
    return {
      rows: data ? data.rows.map(fromMarket) : [],
      observedAt: data?.observedAt ?? null,
      stale: data?.stale ?? false,
      partial: data?.partial ?? false,
      missing: 0,
    }
  }, [tab, stocks.data, watched.data, crypto.data, memes.data, locale])
  const rows = useMemo(() => sortRows(list.rows, sort), [list.rows, sort])

  const tabs: readonly Choice<MarketsTab>[] = TABS.map((value) => ({
    value,
    label:
      value === 'watchlist' && watchlist.mints.length > 0
        ? `${words.lists.watchlist} · ${watchlist.mints.length}`
        : words.lists[value],
    accessibilityLabel: words.lists[value],
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
      : query.isError
        ? words.notLoaded
        : words.loading

  const open = useCallback(
    (row: ListRow) => router.push({ pathname: '/asset/[mint]', params: { mint: row.mint, symbol: row.symbol } }),
    [router],
  )
  const renderItem = useCallback(
    ({ item, index }: { item: ListRow; index: number }) => (
      <AssetRow asset={item} onPress={() => open(item)} last={index === rows.length - 1} />
    ),
    [open, rows.length],
  )

  let body
  if (emptyWatchlist) {
    body = (
      <StateView
        icon="star-outline"
        title={words.watchEmpty}
        detail={words.watchEmptyLine}
        action={{ title: words.searchMarkets, onPress: () => router.push('/search') }}
      />
    )
  } else if (query.isPending) {
    body = <LoadingRows label={words.loadingA11y} />
  } else if (query.isError && rows.length === 0) {
    body = (
      <StateView
        icon={isNetworkError(query.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={isNetworkError(query.error) ? words.noConnection : words.listDown}
        detail={
          isNetworkError(query.error)
            ? words.listNeedsNetwork
            : locale === 'en'
              ? query.error.message
              : words.listDownLine
        }
        action={{ title: words.tryAgain, onPress: () => void query.refetch(), loading: query.isFetching }}
      />
    )
  } else if (rows.length === 0) {
    body = (
      <StateView
        icon="list-outline"
        title={words.listEmpty}
        detail={tab === 'watchlist' ? words.watchNoneListed : words.categoryEmpty}
        action={{ title: words.refresh, onPress: () => void query.refetch(), loading: query.isFetching }}
      />
    )
  } else {
    const notices = [
      list.stale ? words.stale : null,
      list.partial ? words.partial : null,
      list.missing > 0 ? words.notListed(list.missing) : null,
      query.isError ? words.refreshFailed : null,
    ].filter((notice): notice is string => notice !== null)
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
            refreshing={query.isFetching && !query.isPending}
            onRefresh={() => void query.refetch()}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
        ListHeaderComponent={
          notices.length > 0 ? (
            <View className="flex-row flex-wrap gap-2 pb-3">
              {notices.map((notice) => (
                <Chip key={notice} label={notice} tone="warning" caps={false} />
              ))}
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
        onBack={onBack}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={words.sortA11y(words.sorts[sort].label)}
            onPress={() => setSortOpen(true)}
            className="h-9 w-9 items-center justify-center rounded-btn border border-line bg-surface active:bg-hover"
          >
            <Icon name="swap-vertical" size={18} color="muted" />
          </Pressable>
        }
      />
      <View className="px-4 pb-3">
        <SearchBar onPress={() => router.push('/search')} />
      </View>
      <ChoiceChips choices={tabs} value={tab} onChange={setTab} role="tablist" scroll className="px-4 pb-3" />
      {body}
      <FilterSheet
        visible={sortOpen}
        title={words.sortBy}
        options={tab === 'stock' ? sortOptions.stock : sortOptions.all}
        value={sort}
        onSelect={setSort}
        onClose={() => setSortOpen(false)}
      />
    </View>
  )
}
