import { useRouter } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { FlatList, Keyboard, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AssetRow } from '@/components/asset-row'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { DoorRow } from '@/components/door-row'
import { Icon } from '@/components/icon'
import { SearchInput } from '@/components/search-field'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { MARKETS_COPY } from '@/features/markets/copy'
import { isContractAddress } from '@/features/markets/screener'
import { useDebounced } from '@/hooks/use-debounced'
import { useNow } from '@/hooks/use-now'
import { useMarketSearch, useStockUniverse } from '@/hooks/use-markets'
import { useRefreshOnOpen } from '@/hooks/use-refresh-on-open'
import { isNetworkError } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { catalogueMatches, hitsObservedAt, matchStocks, mergeHits, type SearchHit } from '@/lib/search'
import { useSpace } from '@/theme'
import { formatAge, formatClock, shortAddress } from '@/utils/format'

function LoadingRows({ label }: { label: string }) {
  const space = useSpace()
  return (
    <View className="px-4" accessibilityLabel={label} accessibilityRole="progressbar">
      {Array.from({ length: 5 }, (_, index) => (
        <View key={index} className={`flex-row items-center gap-3 border-b border-line ${space.row}`}>
          <Skeleton className="h-10 w-10 rounded-pill" />
          <View className="flex-1 gap-2">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3 w-36" />
          </View>
          <Skeleton className="h-3.5 w-20" />
        </View>
      ))}
    </View>
  )
}

/**
 * Search by name, ticker or contract address (the menu v6.2). The
 * confirmed stocks answer company names at once from the universe already
 * loaded; the venue's catalogue answers everything else after the typing
 * settles. A pasted contract address opens its token at once (`/token/<address>`
 * finds its page); one typed by hand offers «Відкрити токен» first. Copies are
 * shown as copies — unverified, flagged — never hidden and never promoted.
 * Every word and figure is in the person's language.
 */
export function SearchScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const locale = useLocale()
  // The answer's age, as Markets says it in its head, moves on by itself (ST-7).
  const now = useNow(15_000)
  const words = useCopy(MARKETS_COPY)
  const [query, setQuery] = useState('')
  const settled = useDebounced(query, 250)
  const universe = useStockUniverse()
  const catalogue = useMarketSearch(settled)
  const needle = query.trim()
  // The answer on screen is read again, quietly, when Search opens and when the app comes back (ST-7); an empty query
  // asks the catalogue nothing.
  useRefreshOnOpen(settled.trim().length > 0 && !catalogue.isPlaceholderData ? [universe, catalogue] : [universe])
  const address = isContractAddress(needle) ? needle : null
  const previous = useRef('')
  const openAddress = useCallback(
    (mint: string) => {
      Keyboard.dismiss()
      router.push({ pathname: '/token/[mint]', params: { mint } })
    },
    [router],
  )
  // A paste lands whole: an address that arrived in one change opens its token; typing never jumps away.
  const change = (text: string) => {
    const pasted = text.trim().length - previous.current.trim().length >= 32
    previous.current = text
    setQuery(text)
    if (pasted && isContractAddress(text)) openAddress(text.trim())
  }

  // The catalogue's answer is this query's only once the typing settled and the answer is not the previous query's kept
  // on screen (ST-5 r6: «bonk» showed the rows for «b» under «20 результатів»). Until then only its rows that hold the
  // typed words stand, and the header says «Шукаємо…»; the stocks are matched here, on the device, and always current.
  const catalogueCurrent = !catalogue.isPlaceholderData && settled === query
  const hits = useMemo(() => {
    const rows = catalogue.data?.rows ?? []
    return mergeHits(
      matchStocks(universe.data?.rows ?? [], needle),
      catalogueCurrent ? rows : rows.filter((row) => catalogueMatches(row, needle)),
      needle,
      locale,
      universe.data?.rows ?? [],
    )
  }, [universe.data, catalogue.data, catalogueCurrent, needle, locale])
  // The address's own door finds the token's page (a stock's, a launch's or the token's): the same token is not a second row.
  const named = address ? (hits.find((hit) => hit.mint === address) ?? null) : null
  const rows = useMemo(() => (address ? hits.filter((hit) => hit.mint !== address) : hits), [hits, address])

  const open = useCallback(
    (hit: SearchHit) => {
      Keyboard.dismiss()
      router.push({ pathname: '/asset/[mint]', params: { mint: hit.mint, symbol: hit.symbol } })
    },
    [router],
  )
  const renderItem = useCallback(
    ({ item, index }: { item: SearchHit; index: number }) => (
      <AssetRow asset={item} onPress={() => open(item)} last={index === rows.length - 1} />
    ),
    [open, rows.length],
  )

  const searching = needle.length > 0 && (catalogue.isPending || !catalogueCurrent || universe.isPending)

  // The list is true at the oldest read its rows come from (ST-5 r7). Its prices stand and are read again quietly: the
  // venue's `stale` flag draws no «Ціни не оновлюються» bar.
  const drawn = named ? [...rows, named] : rows
  const observedAt = hitsObservedAt(drawn, catalogue.data?.observedAt, universe.data?.fetchedAt)
  // Only a catalogue that never answered this query is said; a quiet refresh that failed keeps its last answer.
  const catalogueLost = catalogue.isError && catalogue.data === undefined
  let body
  if (needle.length === 0) {
    body = <StateView icon="search-outline" title={words.searchIdle} />
  } else if (rows.length === 0 && searching) {
    body = <LoadingRows label={words.searching} />
  } else if (rows.length === 0 && catalogue.isError) {
    // The catalogue did not answer and no stock matched: that is not «nothing found» — the search could not look. Its
    // words are the screen's own in both languages, never the request's error text (ST-5 r5).
    const offline = isNetworkError(catalogue.error)
    body = (
      <StateView
        icon={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={offline ? words.noConnection : words.searchDown}
        detail={offline ? words.searchNeedsNetwork : words.searchDownLine}
        action={{
          title: words.tryAgain,
          onPress: () => {
            void catalogue.refetch()
            if (universe.isError) void universe.refetch()
          },
          loading: catalogue.isFetching,
        }}
      />
    )
  } else if (rows.length === 0) {
    // An address the catalogue does not answer still opens: its row above is the way.
    body = address ? null : (
      <StateView icon="search-outline" title={words.nothingFound} detail={words.noAnswer(needle)} />
    )
  } else {
    body = (
      <FlatList
        data={rows}
        keyExtractor={(item) => item.mint}
        renderItem={renderItem}
        contentContainerClassName="px-4 pb-6"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        ListHeaderComponent={
          <View className="flex-row flex-wrap items-center gap-2 pb-2">
            {/* The first rows come from the device's list; while the catalogue still answers, the count is not final. */}
            <Txt variant="labelSm" tone="faint">
              {searching
                ? words.searching
                : `${words.results(rows.length)}${observedAt ? ` · ${formatClock(observedAt)} · ${formatAge(observedAt, now, locale)}` : ''}`}
            </Txt>
            {catalogueLost && !searching ? <Chip label={words.catalogueDown} tone="warning" caps={false} /> : null}
          </View>
        }
      />
    )
  }

  // The catalogue knows the address: its own row — logo, price and every mark a copy wears — opens the token's page.
  // Unknown to it: a door that still finds the page (a launch, a stock, or the token's own).
  const addressRow = address ? (
    <View className="px-4 pb-2">
      {named ? (
        <>
          <AssetRow asset={named} onPress={() => openAddress(address)} last />
          {rows.length === 0 && observedAt ? (
            <Txt variant="labelSm" tone="faint">
              {formatClock(observedAt)}
            </Txt>
          ) : null}
        </>
      ) : (
        <Card padded={false}>
          <DoorRow
            icon="open-outline"
            label={words.openAddress}
            line={shortAddress(address, 6)}
            onPress={() => openAddress(address)}
            last
          />
        </Card>
      )}
    </View>
  ) : null

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-2 px-4 pb-3 pt-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={words.back}
          onPress={() => router.back()}
          hitSlop={8}
          className="h-11 w-11 items-center justify-center rounded-btn active:bg-hover"
        >
          <Icon name="arrow-back" size={22} color="fg" />
        </Pressable>
        <SearchInput
          value={query}
          onChangeText={change}
          onClear={() => change('')}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      {addressRow}
      {body}
    </View>
  )
}
