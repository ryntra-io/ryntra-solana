import { useMemo, useState } from 'react'
import { FlatList, Keyboard, Pressable, useWindowDimensions, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { AssetRow } from '@/components/asset-row'
import { Icon } from '@/components/icon'
import { SearchInput } from '@/components/search-field'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { companyDisplayName } from '@/features/invest/shelf'
import { MARKETS_COPY, pricesLine } from '@/features/markets/copy'
import { TRADE_COPY } from '@/features/trade/copy'
import { QUOTE_ASSETS, type TradeAsset } from '@/features/trade/trade-model'
import { useDebounced } from '@/hooks/use-debounced'
import { useMarkets, useMarketSearch, useStockUniverse } from '@/hooks/use-markets'
import { useNow } from '@/hooks/use-now'
import type { MarketIssuer, MarketRow } from '@/lib/api'
import { isBlockedToken } from '@/lib/blocked-names'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import {
  catalogueMatches,
  hitsObservedAt,
  matchStocks,
  mergeHits,
  stockPoolFar,
  type SearchHit,
} from '@/lib/search'
import { ISSUER_FULL, ISSUER_SHORT, issuerLabel } from '@/lib/stocks'
import { formatAt } from '@/utils/format'

/** A market row as the ticket needs it: identity, icon and the chain's decimals when the venue states them. */
export function assetFromRow(row: MarketRow): TradeAsset {
  // The list's marks and price travel with the pick, so the ticket says what the row said (ST-5 r7).
  return {
    mint: row.mint,
    symbol: row.symbol,
    name: row.name,
    icon: row.icon,
    decimals: row.decimals,
    verified: row.verified,
    suspicious: row.suspicious,
    price: row.price,
  }
}

/** A search hit as the ticket needs it; the decimals come from the catalogue row when it was one, else from the market later. */
function assetFromHit(hit: SearchHit, catalogue: readonly MarketRow[]): TradeAsset {
  const row = catalogue.find((candidate) => candidate.mint === hit.mint)
  return {
    mint: hit.mint,
    symbol: hit.symbol,
    name: hit.name,
    icon: hit.icon,
    decimals: row?.decimals ?? null,
    verified: hit.verified,
    suspicious: hit.suspicious,
    lookalikeOf: hit.lookalikeOf,
    price: hit.price,
  }
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A row's name and issuer as Markets says them (`screens/markets/index.tsx`): the issuer by its short word
 * («Backpack»), and the name without the issuer the venue's token name repeats — «SpaceX - Backpack Securities ·
 * Backpack Securities» reads «SpaceX · Backpack».
 */
export function pickerNaming(
  name: string,
  issuer: MarketIssuer | null | undefined,
): Readonly<{ name: string; issuer: Readonly<{ label: string }> | null }> {
  if (!issuer) return { name, issuer: null }
  const words = [ISSUER_FULL[issuer.tag], ISSUER_SHORT[issuer.tag], issuer.label].filter(
    (word): word is string => typeof word === 'string' && word.length > 0,
  )
  const repeat = new RegExp(`\\s*[-–—·:|]\\s*(?:${words.map(escaped).join('|')})\\s*$`, 'i')
  const bare = name.replace(repeat, '').trim()
  return { name: companyDisplayName(bare.length > 0 ? bare : name), issuer: { label: issuerLabel(issuer.tag) } }
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

/** `poolFar`: a confirmed stock whose pool price stands far from the share — the chip Markets and Search carry (ST-5 r10). */
type PickerRow = Readonly<{ asset: TradeAsset; row: SearchHit | MarketRow | null; poolFar: boolean }>

/**
 * Pick the asset for one leg. The quote leg offers the two quote assets;
 * the market leg offers the venue's catalogue — the top of it at rest, and
 * when something is typed the same answer as the Markets search: the
 * confirmed stocks by company, ticker or token first, then the venue's rows,
 * verified before copies. Copies are shown as copies, never hidden. The prices
 * carry their read's time in one quiet line over the list, as Markets does
 * (ST-5 r7), and are read again quietly (ST-7). Its words
 * are the search's own, in the person's language. `inline` — a step inside
 * the one sheet of a purchase: the list stands in the sheet, never a sheet
 * over it.
 */
export function AssetPickerSheet({
  visible,
  title,
  kind,
  exclude,
  onClose,
  onPick,
  inline = false,
}: AssetPickerProps & { inline?: boolean }) {
  const { height: windowHeight } = useWindowDimensions()
  /* The list's height is taken once, when the picker opens, and kept while it stays open: the keyboard the search field
     opens, and the rows that land after it, never resize the sheet under a finger (ST-5 r4 — it opened tall and dropped
     ~600 px when the list loaded, so the first tap missed). A larger window (a turn of the phone) still grows it. */
  const [height, setHeight] = useState(windowHeight)
  const [openSeen, setOpenSeen] = useState(visible)
  if (visible !== openSeen) {
    setOpenSeen(visible)
    if (visible) setHeight(windowHeight)
  } else if (windowHeight > height) {
    setHeight(windowHeight)
  }
  const locale = useLocale()
  const words = useCopy(MARKETS_COPY)
  const shared = useSharedCopy()
  const now = useNow(60_000)
  const [query, setQuery] = useState('')
  const settled = useDebounced(query, 250)
  const needle = query.trim()
  const market = visible && kind === 'market'
  const list = useMarkets('all', market && needle.length === 0)
  const universe = useStockUniverse(market)
  const search = useMarketSearch(market ? settled : '')

  const rows = useMemo((): readonly PickerRow[] => {
    if (kind === 'quote') {
      return QUOTE_ASSETS.filter((asset) => asset.mint !== exclude).map((asset) => ({ asset, row: null, poolFar: false }))
    }
    // The stocks whose pool stands far from the share, by their own row (`stockPoolFar`) — said beside any list's row.
    const far = new Set((universe.data?.rows ?? []).filter((row) => stockPoolFar(row)).map((row) => row.mint))
    if (needle.length === 0) {
      // A token whose symbol or name carries a slur is never offered (ST-5 r5); the search drops it the same way.
      return (list.data?.rows ?? [])
        .filter((row) => row.mint !== exclude && !isBlockedToken(row))
        .map((row) => ({ asset: assetFromRow(row), row, poolFar: far.has(row.mint) }))
    }
    // An answer kept from the last query shows only its rows that match what is typed now (ST-5 r6).
    const current = !search.isPlaceholderData && settled === query
    const catalogue = (search.data?.rows ?? []).filter((row) => current || catalogueMatches(row, needle))
    return mergeHits(
      matchStocks(universe.data?.rows ?? [], needle),
      catalogue,
      needle,
      locale,
      universe.data?.rows ?? [],
    )
      .filter((hit) => hit.mint !== exclude)
      .map((hit) => ({ asset: assetFromHit(hit, catalogue), row: hit, poolFar: hit.poolFar || far.has(hit.mint) }))
  }, [kind, exclude, needle, list.data, search.data, search.isPlaceholderData, settled, query, universe.data, locale])

  /* The prices of the list drawn, as Markets says them: the read's time (ST-5 r7 — a price is never drawn without it).
     They stand and are read again quietly, with no «Ціни не оновлюються» line (ST-7). The quote leg shows no price. */
  const freshness = useMemo((): string | null => {
    if (kind === 'quote' || rows.length === 0) return null
    const at = (iso: string) => formatAt(iso, now, locale)
    if (needle.length === 0) {
      return list.data ? pricesLine(words, list.data.observedAt, at) : null
    }
    const hits = rows.flatMap((entry) => (entry.row && 'origin' in entry.row ? [entry.row] : []))
    return pricesLine(words, hitsObservedAt(hits, search.data?.observedAt, universe.data?.fetchedAt), at)
  }, [kind, rows, needle, list.data, search.data, universe.data, words, now, locale])

  /* The first tap on a row picks it (ST-5 r5). The field is not focused on opening, so the sheet does not open lifted
     by a keyboard that a tap would close and drop it under the finger; the list keeps every tap while the keyboard is up
     (`always`) and a drag does not close it, and the keyboard goes when the row is chosen. */
  const pick = (asset: TradeAsset) => {
    Keyboard.dismiss()
    setQuery('')
    onPick(asset)
  }

  const loading =
    kind === 'market' &&
    (needle.length > 0 ? search.isPending || search.isPlaceholderData || settled !== query : list.isPending)

  const content = (
    <View style={{ height: Math.round(height * (inline ? 0.56 : 0.62)) }} className="gap-3">
      {kind === 'market' ? (
        <View className="flex-row">
          <SearchInput value={query} onChangeText={setQuery} onClear={() => setQuery('')} />
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
              bare
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
        <View className="flex-1 gap-1">
          {freshness ? (
            <Txt variant="labelSm" tone="faint">
              {freshness}
            </Txt>
          ) : null}
          <FlatList
            data={rows}
            keyExtractor={(item) => item.asset.mint}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
            initialNumToRender={14}
            renderItem={({ item, index }) => {
              const naming = pickerNaming(item.asset.name, item.row?.issuer)
              return (
                <AssetRow
                  asset={{
                    symbol: item.asset.symbol,
                    name: naming.name,
                    icon: item.asset.icon,
                    price: item.row?.price ?? null,
                    change24hPct: item.row?.change24hPct ?? null,
                    issuer: naming.issuer,
                    verified: item.row?.verified,
                    suspicious: item.row?.suspicious,
                    note: item.row && 'note' in item.row ? item.row.note : null,
                    halted: item.row && 'halted' in item.row ? item.row.halted : false,
                    lookalikeOf: item.row && 'lookalikeOf' in item.row ? item.row.lookalikeOf : null,
                    poolFar: item.poolFar,
                  }}
                  onPress={() => pick(item.asset)}
                  last={index === rows.length - 1}
                />
              )
            }}
          />
        </View>
      )}
    </View>
  )
  if (inline) return visible ? content : null
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      {content}
    </Sheet>
  )
}
