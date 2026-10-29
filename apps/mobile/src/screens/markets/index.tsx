import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'

import { AssetRow, type AssetRowAsset } from '@/components/asset-row'
import { Chip } from '@/components/chip'
import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { FilterSheet, type FilterOption } from '@/components/filter-sheet'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { AskRyn } from '@/features/agent/ask-ryn'
import { markPremium } from '@/features/invest/shelf'
import { useCompanyShelf, useShelfNames } from '@/features/invest/use-shelf'
import { MARKETS_COPY, type MarketsCopy } from '@/features/markets/copy'
import {
  askedPlaceChip,
  kindsOfChip,
  marketScreenerRow,
  openingChip,
  PLACE_CHIPS,
  PLACE_DEFAULT,
  sortRows,
  sortsFor,
  stockScreenerRow,
  uniqueRows,
  type ScreenerRow,
  type ScreenerSort,
  type PlaceChip,
} from '@/features/markets/screener'
import { SHEET_COPY } from '@/features/trade/sheet-copy'
import { useWatchlist } from '@/features/watchlist/watchlist'
import { useMarkets, useStockUniverse, useWatchlistMarkets } from '@/hooks/use-markets'
import { useNow } from '@/hooks/use-now'
import { useRefreshOnOpen } from '@/hooks/use-refresh-on-open'
import { isNetworkError, type MarketsResponse } from '@/lib/api'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'
import { readPreference, readPreferenceText, writePreference } from '@/lib/preferences'
import { issuerLabel, sessionWord } from '@/lib/stocks'
import { useSpace, useTheme } from '@/theme'
import { formatAge, formatClock } from '@/utils/format'
import { LaunchMarketsList } from '@/screens/launch/markets'
import { Button } from '@/components/button'

/**
 * The chip the person chose last. Its key is new with the order of 2026-10-18 (Усі first, Обране last): a chip tapped
 * under the older order, where «Обране» stood first, is not carried over — so the first visit after the update opens
 * «Усі», and the next choice is remembered as before.
 */
const CHIP_KEY = 'markets.place.chip.v2'

/** The room the pull-to-refresh spinner takes over the list while it spins, dp. */
const PULL_ROOM = 56

type Row = AssetRowAsset & Readonly<{ mint: string; source: ScreenerRow }>

function LoadingRows({ label }: { label: string }) {
  const space = useSpace()
  return (
    <View className="px-4" accessibilityLabel={label} accessibilityRole="progressbar">
      {Array.from({ length: 8 }, (_, index) => (
        <View key={index} className={`flex-row items-center gap-3 border-b border-line ${space.row}`}>
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
 * «Торгівля · Ринки» — one screener for every asset, under the chips Усі · Акції · Крипто · Меми · Лаунчі · Обране, opened on «Усі» unless a link asks for a chip or the person chose one before. A row
 * is a logo, the ticker, the name with the issuer and the exchange's session (or «Це не акція» and the price against
 * PreStocks' valuation), the price and the day's change; it opens the token's own page — Купити, Продати with a
 * position, Ліміт in the purchase's «Тип». «Лаунчі» lists the markets launched through Ryntra under «Запустити свій
 * токен»; under «Акції» a «?» says what a tokenized stock is, under «Меми» one sentence says a meme's risk, and in
 * «Усі» and «Обране» a meme's row says «Мем». The
 * order is the person's own — «У тренді» first, then «Зростають», «Падають», «Ліквідність», and «До біржі» for stocks.
 * Every list carries the time it was read; its prices stand and are read again quietly — every 60 s and when the screen
 * opens — with no «Ціни не оновлюються» bar over them (ST-7); a list that never answered is «Ринки не завантажилися» with
 * «Спробувати ще». The place's head — the segments and
 * search — is «Торгівля»'s own (`screens/trade-place`).
 */
export function MarketsScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const locale = useLocale()
  const words = useCopy(MARKETS_COPY)
  const sheet = useCopy(SHEET_COPY)
  const now = useNow(15_000)
  const watchlist = useWatchlist()
  // The shelf this session read names a company as Stocks does; a watchlist read before it names the token.
  useCompanyShelf()
  const nameOf = useShelfNames()
  const params = useLocalSearchParams<{ tab?: string; kind?: string; mode?: string }>()
  const asked = askedPlaceChip(params)
  const [tab, setTabState] = useState<PlaceChip>(() =>
    openingChip(
      asked,
      readPreferenceText(CHIP_KEY) === null ? null : readPreference(CHIP_KEY, PLACE_CHIPS, PLACE_DEFAULT),
    ),
  )
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

  const kinds = kindsOfChip(tab)
  const wantsCrypto = kinds.includes('crypto')
  const wantsMemes = kinds.includes('meme')
  const wantsStocks = kinds.includes('stock')
  const crypto = useMarkets('crypto', wantsCrypto)
  const memes = useMarkets('meme', wantsMemes)
  const stocks = useStockUniverse(wantsStocks)
  const watched = useWatchlistMarkets(tab === 'watchlist' ? watchlist.mints : [])

  const setTab = (next: PlaceChip) => {
    setTabState(next)
    writePreference(CHIP_KEY, next)
    if (next !== 'stocks' && sort === 'deviation') setSort('volume')
  }

  const list = useMemo(() => {
    if (tab === 'watchlist') {
      const data = watched.data
      return {
        // A company by the name the Stocks list gives it («NVIDIA»), not the token's own «NVIDIA xStock».
        rows: (data?.rows ?? [])
          .map((row) => marketScreenerRow(row, { stocks: true }))
          .filter((row): row is ScreenerRow => row !== null)
          .map((row) => (row.kind === 'stock' ? { ...row, name: nameOf(row.mint) ?? row.name } : row)),
        observedAt: data?.observedAt ?? null,
        missing: data?.missing.length ?? 0,
      }
    }
    const coinRows = (data: MarketsResponse | undefined) =>
      (data?.rows ?? []).map((row) => marketScreenerRow(row)).filter((row): row is ScreenerRow => row !== null)
    const stockRows = (stocks.data?.rows ?? []).map(stockScreenerRow)
    const rows = uniqueRows(
      wantsCrypto ? coinRows(crypto.data) : [],
      wantsMemes ? coinRows(memes.data) : [],
      wantsStocks ? stockRows : [],
    )
    return {
      rows: rows.filter((row) => kinds.includes(row.kind)),
      observedAt: oldest(
        wantsCrypto ? crypto.data?.observedAt : null,
        wantsMemes ? memes.data?.observedAt : null,
        wantsStocks ? stocks.data?.fetchedAt : null,
      ),
      missing: 0,
    }
  }, [tab, kinds, watched.data, crypto.data, memes.data, stocks.data, wantsCrypto, wantsMemes, wantsStocks, nameOf])

  /* On «Акції» one session for every stock (the exchange's hours are one) is said once in the head, not on each row (ST-4). */
  const sharedPeriod = useMemo(() => {
    if (tab !== 'stocks') return null
    const periods = list.rows.flatMap((row) => (row.kind === 'stock' && row.period !== null ? [row.period] : []))
    return periods.length > 1 && periods.every((period) => period === periods[0]) ? periods[0] : null
  }, [list.rows, tab])
  const rows = useMemo(
    () =>
      sortRows(list.rows, sort).map((row) =>
        rowOf(row, locale, words, tab === 'all' || tab === 'watchlist', sharedPeriod),
      ),
    [list.rows, sort, locale, words, tab, sharedPeriod],
  )

  /* the reads this tab stands on, and how each of them answered */
  const reads =
    tab === 'watchlist'
      ? [watched]
      : [...(wantsCrypto ? [crypto] : []), ...(wantsMemes ? [memes] : []), ...(wantsStocks ? [stocks] : [])]
  const pending = reads.some((read) => read.isPending) && rows.length === 0
  const failed = reads.filter((read) => read.isError)
  const fetching = reads.some((read) => read.isFetching)
  const refetch = () => {
    for (const read of reads) void read.refetch()
  }
  // The tab's lists are read again, quietly, when «Ринки» opens and when the app comes back (ST-7).
  useRefreshOnOpen(reads)
  /* The spinner is the person's own pull, not every read in the background: a list refreshed on its own is not covered
     by it (ST-5 r5). While it spins the list stands a spinner's height lower, so the first row is never under it. */
  const [pulled, setPulled] = useState(false)
  const pull = () => {
    setPulled(true)
    void Promise.allSettled(reads.map((read) => read.refetch())).finally(() => setPulled(false))
  }
  // A list drawn from several reads says which of them did not answer: the coins (crypto or memes) or the stocks.
  const lost = (read: Readonly<{ isError: boolean; data?: unknown }>) => read.isError && read.data === undefined
  const cryptoFailed = reads.length > 1 && wantsCrypto && lost(crypto)
  const memesFailed = reads.length > 1 && wantsMemes && lost(memes)
  const stocksFailed = reads.length > 1 && wantsStocks && lost(stocks)

  const sortOptions = useMemo(
    (): FilterOption<ScreenerSort>[] =>
      sortsFor(tab === 'stocks' ? 'stocks' : 'all').map((value) => ({
        value,
        ...words.sorts[value],
      })),
    [tab, words],
  )

  const chipWord = (chip: PlaceChip) => sheet.chips[chip]
  const tabs: readonly Choice<PlaceChip>[] = PLACE_CHIPS.map((value) => ({
    value,
    label:
      value === 'watchlist' && watchlist.mints.length > 0
        ? `${chipWord(value)} · ${watchlist.mints.length}`
        : chipWord(value),
    accessibilityLabel: chipWord(value),
  }))

  const emptyWatchlist = tab === 'watchlist' && watchlist.mints.length === 0
  /* The list's time and age. The prices stand and are read again quietly: no «Ціни не оновлюються» bar is drawn for the
     server's `stale` flag, nor for a refresh that did not answer while the last read is on screen — its age says how old
     it is.
     Where the favourites are kept (the device, the wallet) and their sync are not drawn (ST-4): the list is the person's. */
  // A list that never answered says so once, in its own screen below — not again in the head.
  const subtitle =
    emptyWatchlist || (rows.length === 0 && failed.length > 0)
      ? ''
      : list.observedAt
        ? `${formatClock(list.observedAt)} · ${formatAge(list.observedAt, now, locale)}`
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
  if (tab === 'launches') {
    body = (
      <LaunchMarketsList
        head={
          <View className="pb-3">
            <Button title={sheet.launchOwn} variant="secondary" onPress={() => router.push('/launch' as never)} />
          </View>
        }
      />
    )
  } else if (emptyWatchlist) {
    body = <StateView icon="star-outline" title={words.watchEmpty} />
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
        detail={tab === 'watchlist' ? words.watchNoneListed : undefined}
        action={{ title: words.refresh, onPress: refetch, loading: fetching }}
      />
    )
  } else {
    const notices = [
      list.missing > 0 ? words.notListed(list.missing) : null,
      // Both coin reads lost (one source) is one notice, not two.
      cryptoFailed && memesFailed
        ? words.coinsDown
        : cryptoFailed
          ? words.cryptoDown
          : memesFailed
            ? words.memesDown
            : null,
      stocksFailed ? words.stocksDown : null,
    ].filter((notice): notice is string => notice !== null)
    // Under «Меми», a meme's risk — one sentence that guards money. What a tokenized stock is sits behind «?» in the
    // head (ST-4). In «Усі» a meme's row says «Мем» instead, so the default list opens on the assets, not on a warning.
    const line = tab === 'memes' ? words.memesRisk : null
    body = (
      <FlatList
        // Each chip is its own list, opened at its top — not where the chip before it was scrolled to.
        key={tab}
        data={rows}
        keyExtractor={(item) => item.mint}
        renderItem={renderItem}
        contentContainerClassName="px-4 pb-6"
        initialNumToRender={14}
        maxToRenderPerBatch={12}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={pulled ? { paddingTop: PULL_ROOM } : undefined}
        refreshControl={
          <RefreshControl
            refreshing={pulled}
            onRefresh={pull}
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

  // The head's time and session; a line with nothing to say is not drawn, so a screen reader finds no old words in it.
  const headLine =
    tab === 'launches'
      ? ''
      : [subtitle, sharedPeriod ? sessionWord(sharedPeriod, locale) : ''].filter(Boolean).join(' · ')

  return (
    <View className="flex-1 bg-ground">
      <View className="flex-row items-center gap-2 px-4 pb-2">
        {headLine ? (
          <Txt variant="labelSm" tone="faint" numberOfLines={1} className="flex-1">
            {headLine}
          </Txt>
        ) : (
          <View className="flex-1" />
        )}
        {tab === 'stocks' ? <HelpDot title={sheet.stocksTitle} body={sheet.stocksNote} /> : null}
        <AskRyn
          context={{ kind: 'page', page: tab === 'stocks' ? 'stocks' : 'trends' }}
          label={words.askRyntra}
          className="h-9 w-9 border border-line bg-surface"
        />
        {tab === 'launches' || emptyWatchlist ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={words.sortA11y(words.sorts[sort].label)}
            onPress={() => setSortOpen(true)}
            className="h-9 w-9 items-center justify-center rounded-btn border border-line bg-surface active:bg-hover"
          >
            <Icon name="swap-vertical" size={18} color="muted" />
          </Pressable>
        )}
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
 * PreStocks' valuation (the tab's own line names PreStocks, so the row does not);
 * in a list of mixed kinds (`mixed`), a meme says «Мем».
 */
function rowOf(
  row: ScreenerRow,
  locale: Locale,
  words: MarketsCopy,
  mixed: boolean,
  sharedPeriod: ScreenerRow['period'],
): Row {
  const stock = row.kind === 'stock' || row.kind === 'private'
  const notes =
    row.kind === 'private'
      ? [words.notAShare, valuationNote(row.markPremium, locale, words)]
      : // The session is one word on a row: «Exchange closed» never breaks across two lines.
        [row.period && row.period !== sharedPeriod ? sessionWord(row.period, locale).replace(/ /g, '\u00a0') : null]
  if (mixed && row.kind === 'meme') notes.push(words.memeMark)
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
    poolFar: row.poolFar,
  }
}
