import { useMemo, useState } from 'react'
import { FlatList, Pressable, useWindowDimensions, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { AssetRow } from '@/components/asset-row'
import { Icon } from '@/components/icon'
import { SearchInput } from '@/components/search-field'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { MARKETS_COPY } from '@/features/markets/copy'
import { TRADE_COPY } from '@/features/trade/copy'
import { QUOTE_ASSETS, type TradeAsset } from '@/features/trade/trade-model'
import { useDebounced } from '@/hooks/use-debounced'
import { useMarkets, useMarketSearch, useStockUniverse } from '@/hooks/use-markets'
import type { MarketRow } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { matchStocks, mergeHits, type SearchHit } from '@/lib/search'

/** A market row as the ticket needs it: identity, icon and the chain's decimals when the venue states them. */
export function assetFromRow(row: MarketRow): TradeAsset {
  return { mint: row.mint, symbol: row.symbol, name: row.name, icon: row.icon, decimals: row.decimals }
}

/** A search hit as the ticket needs it; the decimals come from the catalogue row when it was one, else from the market later. */
function assetFromHit(hit: SearchHit, catalogue: readonly MarketRow[]): TradeAsset {
  const row = catalogue.find((candidate) => candidate.mint === hit.mint)
  return { mint: hit.mint, symbol: hit.symbol, name: hit.name, icon: hit.icon, decimals: row?.decimals ?? null }
}

/** The asset on one leg of the ticket, as a pill that opens the picker. */
export function AssetPill({
  asset,
  placeholder,
  onPress,
  disabled,
}: {
  asset: TradeAsset | null
  placeholder: string
  onPress: () => void
  disabled?: boolean
}) {
  const words = useCopy(TRADE_COPY)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={asset ? words.changeAsset(asset.symbol) : placeholder}
      onPress={onPress}
      disabled={disabled}
      className="h-11 flex-row items-center gap-2 rounded-pill border border-line bg-elevated pl-1.5 pr-3 active:bg-hover"
    >
      {asset ? <AssetIcon symbol={asset.symbol} icon={asset.icon} size={28} /> : null}
      <Txt variant="ui" tone={asset ? 'fg' : 'muted'}>
        {asset ? asset.symbol : placeholder}
      </Txt>
      <Icon name="chevron-down" size={16} color="muted" />
    </Pressable>
  )
}

export type AssetPickerProps = {
  visible: boolean
  title: string
  /** `quote`: USDC or SOL only — what a Buy is paid with, a Sell received in. `market`: any market the venue lists. */
  kind: 'quote' | 'market'
  /** The other leg — never offered, so the two legs cannot be the same. */
  exclude: string | null
  onClose: () => void
  onPick: (asset: TradeAsset) => void
}

function LoadingRows({ label }: { label: string }) {
  return (
    <View accessibilityLabel={label} accessibilityRole="progressbar">
      {Array.from({ length: 6 }, (_, index) => (
        <View key={index} className="flex-row items-center gap-3 border-b border-line py-3">
          <Skeleton className="h-10 w-10 rounded-pill" />
          <View className="flex-1 gap-2">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3 w-36" />
          </View>
        </View>
      ))}
    </View>
  )
}

type PickerRow = Readonly<{ asset: TradeAsset; row: SearchHit | MarketRow | null }>

/**
 * Pick the asset for one leg. The quote leg offers the two quote assets;
 * the market leg offers the venue's catalogue — the top of it at rest, and
 * when something is typed the same answer as the Markets search: the
 * confirmed stocks by company, ticker or token first, then the venue's rows,
 * verified before copies. Copies are shown as copies, never hidden. Its words
 * are the search's own, in the person's language.
 */
export function AssetPickerSheet({ visible, title, kind, exclude, onClose, onPick }: AssetPickerProps) {
  const { height } = useWindowDimensions()
  const locale = useLocale()
  const words = useCopy(MARKETS_COPY)
  const shared = useSharedCopy()
  const [query, setQuery] = useState('')
  const settled = useDebounced(query, 250)
  const needle = query.trim()
  const market = visible && kind === 'market'
  const list = useMarkets('all', market && needle.length === 0)
  const universe = useStockUniverse(market)
  const search = useMarketSearch(market ? settled : '')

  const rows = useMemo((): readonly PickerRow[] => {
    if (kind === 'quote') {
      return QUOTE_ASSETS.filter((asset) => asset.mint !== exclude).map((asset) => ({ asset, row: null }))
    }
    if (needle.length === 0) {
      return (list.data?.rows ?? [])
        .filter((row) => row.mint !== exclude)
        .map((row) => ({ asset: assetFromRow(row), row }))
    }
    const catalogue = search.data?.rows ?? []
    return mergeHits(matchStocks(universe.data?.rows ?? [], needle), catalogue, needle, locale)
      .filter((hit) => hit.mint !== exclude)
      .map((hit) => ({ asset: assetFromHit(hit, catalogue), row: hit }))
  }, [kind, exclude, needle, list.data, search.data, universe.data, locale])

  const pick = (asset: TradeAsset) => {
    setQuery('')
    onPick(asset)
  }

  const loading = kind === 'market' && (needle.length > 0 ? search.isPending || settled !== query : list.isPending)

  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View style={{ height: Math.round(height * 0.62) }} className="gap-3">
        {kind === 'market' ? (
          <View className="flex-row">
            <SearchInput value={query} onChangeText={setQuery} onClear={() => setQuery('')} autoFocus />
          </View>
        ) : null}
        {kind === 'quote' ? (
          <View>
            {rows.map(({ asset }, index) => (
              <AssetRow
                key={asset.mint}
                asset={{
                  symbol: asset.symbol,
                  name: asset.name,
                  icon: asset.icon,
                  price: null,
                  change24hPct: null,
                  verified: true,
                }}
                onPress={() => pick(asset)}
                last={index === rows.length - 1}
              />
            ))}
          </View>
        ) : loading && rows.length === 0 ? (
          <LoadingRows label={shared.loading} />
        ) : rows.length === 0 ? (
          <StateView
            icon="search-outline"
            title={needle ? words.nothingFound : words.noMarkets}
            detail={needle ? words.noAnswer(needle) : words.catalogueSilent}
          />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(item) => item.asset.mint}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            initialNumToRender={14}
            renderItem={({ item, index }) => (
              <AssetRow
                asset={{
                  symbol: item.asset.symbol,
                  name: item.asset.name,
                  icon: item.asset.icon,
                  price: item.row?.price ?? null,
                  change24hPct: item.row?.change24hPct ?? null,
                  issuer: item.row?.issuer ?? null,
                  verified: item.row?.verified,
                  suspicious: item.row?.suspicious,
                  note: item.row && 'note' in item.row ? item.row.note : null,
                  halted: item.row && 'halted' in item.row ? item.row.halted : false,
                }}
                onPress={() => pick(item.asset)}
                last={index === rows.length - 1}
              />
            )}
          />
        )}
      </View>
    </Sheet>
  )
}
