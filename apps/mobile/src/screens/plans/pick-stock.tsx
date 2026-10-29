import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, Keyboard, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AssetRow } from '@/components/asset-row'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { SearchInput } from '@/components/search-field'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { MARKETS_COPY, pricesLine } from '@/features/markets/copy'
import { PLANS_COPY } from '@/features/plans/copy'
import { useStockUniverse } from '@/hooks/use-markets'
import { useNow } from '@/hooks/use-now'
import { isNetworkError, type StockUniverseRow } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { matchStocks, stockPoolFar } from '@/lib/search'
import { issuerLabel, sessionWord } from '@/lib/stocks'
import { formatAt } from '@/utils/format'

function LoadingRows() {
  return (
    <View className="px-4" accessibilityRole="progressbar">
      {Array.from({ length: 6 }, (_, index) => (
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

const size = (value: number | null) => (value === null ? Number.NEGATIVE_INFINITY : value)

/** A plan starts from a stock: the confirmed representations, the most traded first, searched by symbol or company. */
export function PickStockScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const copy = useCopy(PLANS_COPY)
  const locale = useLocale()
  const shared = useSharedCopy()
  const markets = useCopy(MARKETS_COPY)
  const now = useNow(60_000)
  const universe = useStockUniverse()
  const [query, setQuery] = useState('')
  const needle = query.trim()

  const rows = useMemo((): StockUniverseRow[] => {
    const all = universe.data?.rows ?? []
    if (needle.length > 0) return matchStocks(all, needle)
    return [...all]
      .filter((row) => !row.halted)
      .sort((a, b) => size(b.volume) - size(a.volume))
      .slice(0, 60)
  }, [universe.data, needle])

  const back = () => (router.canGoBack() ? router.back() : router.replace('/bots'))
  const pick = (row: StockUniverseRow) => {
    Keyboard.dismiss()
    router.replace({ pathname: '/plans/new', params: { mint: row.mint, symbol: row.symbol } })
  }

  /* The prices listed carry their time, as the Swap and Buy pickers say it (ST-5 r8); a refresh that did not answer
     leaves them standing under it, with no «Ціни не оновлюються» line (ST-7). */
  const freshness =
    universe.data && rows.length > 0
      ? pricesLine(markets, universe.data.fetchedAt, (iso) => formatAt(iso, now, locale))
      : null

  let body
  if (universe.isPending) {
    body = <LoadingRows />
  } else if (universe.isError && !universe.data) {
    body = (
      <StateView
        icon={isNetworkError(universe.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={isNetworkError(universe.error) ? shared.noConnection : copy.pickerUnavailable}
        action={{ title: shared.tryAgain, onPress: () => void universe.refetch(), loading: universe.isFetching }}
      />
    )
  } else if (rows.length === 0) {
    body = <StateView icon="search-outline" title={copy.noMatches} />
  } else {
    body = (
      <FlatList
        data={rows}
        keyExtractor={(row) => row.mint}
        renderItem={({ item, index }) => (
          <AssetRow
            asset={{
              symbol: item.symbol,
              name: item.name,
              icon: item.icon,
              price: item.price,
              change24hPct: item.change24h,
              issuer: { label: issuerLabel(item.issuer) },
              note:
                item.unitBasis === 'token'
                  ? copy.perToken
                  : item.period === 'unknown'
                    ? null
                    : sessionWord(item.period, locale),
              halted: item.halted,
              // The chip Markets and Search carry (ST-5 r10): a pool price far from the share.
              poolFar: stockPoolFar(item),
            }}
            onPress={() => pick(item)}
            last={index === rows.length - 1}
          />
        )}
        contentContainerClassName="px-4 pb-8"
        keyboardShouldPersistTaps="handled"
        initialNumToRender={14}
      />
    )
  }

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-1 px-2 pt-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shared.back}
          onPress={back}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-btn active:bg-hover"
        >
          <Icon name="arrow-back" size={22} color="fg" />
        </Pressable>
        <View className="flex-1">
          <ScreenHeader
            title={copy.newPlan}
            subtitle={copy.whichStock}
            right={<HelpDot title={copy.whichStock} body={copy.plansForStocks} />}
          />
        </View>
      </View>
      <View className="flex-row px-4 pb-3">
        <SearchInput
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder={copy.searchStocks}
          autoFocus={false}
        />
      </View>
      {freshness ? (
        <Txt variant="labelSm" tone="faint" tabular className="px-5 pb-1">
          {freshness}
        </Txt>
      ) : null}
      {body}
    </View>
  )
}
