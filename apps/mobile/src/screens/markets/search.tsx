import { useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { FlatList, Keyboard, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AssetRow } from '@/components/asset-row'
import { Chip } from '@/components/chip'
import { Icon } from '@/components/icon'
import { SearchInput } from '@/components/search-field'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { MARKETS_COPY } from '@/features/markets/copy'
import { useDebounced } from '@/hooks/use-debounced'
import { useMarketSearch, useStockUniverse } from '@/hooks/use-markets'
import { isNetworkError } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { matchStocks, mergeHits, type SearchHit } from '@/lib/search'
import { formatClock } from '@/utils/format'

function LoadingRows({ label }: { label: string }) {
  return (
    <View className="px-4" accessibilityLabel={label} accessibilityRole="progressbar">
      {Array.from({ length: 5 }, (_, index) => (
        <View key={index} className="flex-row items-center gap-3 border-b border-line py-3">
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
 * Search by company, ticker or token. The confirmed stocks answer company
 * names at once from the universe already loaded; the venue's catalogue
 * answers everything else after the typing settles. Copies are shown as
 * copies — unverified, flagged — never hidden and never promoted. Every word
 * and figure is in the person's language (M22).
 */
export function SearchScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const locale = useLocale()
  const words = useCopy(MARKETS_COPY)
  const [query, setQuery] = useState('')
  const settled = useDebounced(query, 250)
  const universe = useStockUniverse()
  const catalogue = useMarketSearch(settled)
  const needle = query.trim()

  const hits = useMemo(
    () => mergeHits(matchStocks(universe.data?.rows ?? [], needle), catalogue.data?.rows ?? [], needle, locale),
    [universe.data, catalogue.data, needle, locale],
  )

  const open = useCallback(
    (hit: SearchHit) => {
      Keyboard.dismiss()
      router.push({ pathname: '/asset/[mint]', params: { mint: hit.mint, symbol: hit.symbol } })
    },
    [router],
  )
  const renderItem = useCallback(
    ({ item, index }: { item: SearchHit; index: number }) => (
      <AssetRow asset={item} onPress={() => open(item)} last={index === hits.length - 1} />
    ),
    [open, hits.length],
  )

  const searching = needle.length > 0 && (catalogue.isPending || settled !== query || universe.isPending)

  let body
  if (needle.length === 0) {
    body = <StateView icon="search-outline" title={words.searchIdle} detail={words.searchIdleLine} />
  } else if (hits.length === 0 && searching) {
    body = <LoadingRows label={words.searching} />
  } else if (hits.length === 0 && catalogue.isError && universe.isError) {
    body = (
      <StateView
        icon={isNetworkError(catalogue.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={isNetworkError(catalogue.error) ? words.noConnection : words.searchDown}
        detail={
          isNetworkError(catalogue.error)
            ? words.searchNeedsNetwork
            : locale === 'en'
              ? catalogue.error.message
              : words.searchDownLine
        }
        action={{ title: words.tryAgain, onPress: () => void catalogue.refetch(), loading: catalogue.isFetching }}
      />
    )
  } else if (hits.length === 0) {
    body = <StateView icon="search-outline" title={words.nothingFound} detail={words.noAnswer(needle)} />
  } else {
    const observedAt = catalogue.data?.observedAt ?? universe.data?.fetchedAt ?? null
    body = (
      <FlatList
        data={hits}
        keyExtractor={(item) => item.mint}
        renderItem={renderItem}
        contentContainerClassName="px-4 pb-6"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        ListHeaderComponent={
          <View className="flex-row flex-wrap items-center gap-2 pb-2">
            <Txt variant="labelSm" tone="faint">
              {`${words.results(hits.length)}${observedAt ? ` · ${formatClock(observedAt)}` : ''}`}
            </Txt>
            {catalogue.isError ? <Chip label={words.catalogueDown} tone="warning" caps={false} /> : null}
            {catalogue.data?.stale ? <Chip label={words.staleMark} tone="warning" /> : null}
          </View>
        }
      />
    )
  }

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
        <SearchInput value={query} onChangeText={setQuery} onClear={() => setQuery('')} autoFocus />
      </View>
      {body}
    </View>
  )
}
