import { useRouter } from 'expo-router'
import { useMemo, useState, type ReactNode } from 'react'
import { ScrollView, useWindowDimensions, View } from 'react-native'

import { AssetRow } from '@/components/asset-row'
import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { DoorRow } from '@/components/door-row'
import { SearchInput } from '@/components/search-field'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { PLACE_HOME_COPY } from '@/features/home/place-copy'
import { INVEST_COPY } from '@/features/invest/copy'
import { usePopularCompanies } from '@/features/invest/use-popular'
import { useShelfNames } from '@/features/invest/use-shelf'
import { MARKETS_COPY, pricesLine } from '@/features/markets/copy'
import { marketsPath } from '@/features/markets/screener'
import { useOpenPlace } from '@/features/shell/open-place'
import { useDebounced } from '@/hooks/use-debounced'
import { useMarkets, useMarketSearch, useStockUniverse } from '@/hooks/use-markets'
import { useNow } from '@/hooks/use-now'
import { useRefreshWhenShown } from '@/hooks/use-refresh-on-open'
import { isNetworkError } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { catalogueMatches, hitsObservedAt, matchStocks, mergeHits } from '@/lib/search'
import { issuerLabel } from '@/lib/stocks'
import { formatAt } from '@/utils/format'

/** How many coins and companies «Що купити» offers at rest — the top of each list, the server's own order. */
export const PICK_COINS = 4
export const PICK_COMPANIES = 8
/** How many answers a typed search shows before «Усі ринки» takes over. */
const PICK_HITS = 12

type Pick = Readonly<{ mint: string; symbol: string; category: 'stock' | null }>

function Rows({ label }: { label: string }) {
  return (
    <View accessibilityLabel={label} accessibilityRole="progressbar" className="px-4">
      {Array.from({ length: 4 }, (_, index) => (
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

function Group({ title, line, children }: { title: string; line?: string | null; children: ReactNode }) {
  return (
    <View className="gap-1">
      <View className="gap-0.5 px-1">
        <Txt variant="ui" accessibilityRole="header">
          {title}
        </Txt>
        {line ? (
          <Txt variant="labelSm" tone="faint">
            {line}
          </Txt>
        ) : null}
      </View>
      {children}
    </View>
  )
}

/**
 * «Що купити» — Home's «Купити» (NEW-LOOK §3, the prototype's sheet): the search on top, and at rest the popular
 * coins and the popular companies — the screener's coins and the server's companies by the day's trading, each list
 * with its time — then «Усі ринки». A pick opens the asset's page with its purchase already open, where the sum is
 * the person's own: a share of what the wallet holds or any sum from $1. Nothing here buys anything.
 */
export function BuyPickSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter()
  const openPlace = useOpenPlace()
  const { height } = useWindowDimensions()
  const locale = useLocale()
  const now = useNow(60_000)
  const words = useCopy(PLACE_HOME_COPY)
  const invest = useCopy(INVEST_COPY)
  const markets = useCopy(MARKETS_COPY)
  const shared = useSharedCopy()
  const [query, setQuery] = useState('')
  const settled = useDebounced(query, 250)
  const needle = query.trim()
  const coins = useMarkets('crypto', visible && needle.length === 0)
  // While the sheet is open its lists are read again every minute, quietly (ST-7).
  const popular = usePopularCompanies(visible ? 60_000 : 120_000)
  const universe = useStockUniverse(visible && needle.length > 0)
  const search = useMarketSearch(visible ? settled : '')
  // The sheet opened, or the app came back to it: the lists on it are read again, quietly, if their answer is past its
  // fresh time (ST-7); the minute's own reads follow from `refetchInterval`. A query typed asks its own.
  useRefreshWhenShown(visible && needle.length === 0, [coins, popular])
  // A company as Markets names it («NVIDIA»), never the token's own «NVIDIA xStock».
  const nameOf = useShelfNames()

  const hits = useMemo(
    () =>
      needle.length === 0
        ? []
        : mergeHits(
            matchStocks(universe.data?.rows ?? [], needle),
            // An answer kept from the last query shows only its rows that match what is typed now (ST-5 r6).
            (search.data?.rows ?? []).filter(
              (row) => (!search.isPlaceholderData && settled === query) || catalogueMatches(row, needle),
            ),
            needle,
            locale,
            universe.data?.rows ?? [],
          ).slice(0, PICK_HITS),
    [needle, universe.data, search.data, search.isPlaceholderData, settled, query, locale],
  )

  const close = () => {
    setQuery('')
    onClose()
  }
  const pick = ({ mint, symbol, category }: Pick) => {
    close()
    router.push({
      pathname: '/asset/[mint]',
      params: { mint, symbol, ...(category ? { category } : {}), buy: '1' },
    })
  }
  const allMarkets = () => {
    close()
    openPlace(marketsPath('all'))
  }

  let body: ReactNode
  if (needle.length > 0) {
    const searching = search.isPending || search.isPlaceholderData || settled !== query
    // The rows drawn carry the time of the oldest read they come from — as Markets does, and as the lists at rest
    // below (ST-5 r7); their prices stand and are read again quietly, with no «Ціни не оновлюються» line (ST-7).
    const line = pricesLine(markets, hitsObservedAt(hits, search.data?.observedAt, universe.data?.fetchedAt), (iso) =>
      formatAt(iso, now, locale),
    )
    body =
      hits.length > 0 ? (
        <Group title={markets.results(hits.length)} line={line}>
          <Card padded={false} className="px-4">
            {hits.map((hit, index) => (
              <AssetRow
                key={hit.mint}
                asset={{ ...hit, name: nameOf(hit.mint) ?? hit.name }}
                onPress={() => pick({ mint: hit.mint, symbol: hit.symbol, category: null })}
                last={index === hits.length - 1}
              />
            ))}
          </Card>
        </Group>
      ) : searching ? (
        <Rows label={markets.searching} />
      ) : search.isError ? (
        // A search that did not answer is said as such — never «nothing found».
        <View className="gap-1 px-1 py-6">
          <Txt variant="ui">{isNetworkError(search.error) ? markets.noConnection : markets.searchDown}</Txt>
          <Txt variant="ui" tone="faint">
            {isNetworkError(search.error) ? markets.searchNeedsNetwork : markets.searchDownLine}
          </Txt>
        </View>
      ) : (
        <View className="gap-1 px-1 py-6">
          <Txt variant="ui">{markets.nothingFound}</Txt>
          <Txt variant="ui" tone="faint">
            {markets.noAnswer(needle)}
          </Txt>
        </View>
      )
  } else {
    const coinRows = (coins.data?.rows ?? []).slice(0, PICK_COINS)
    const companies = popular.data?.companies.slice(0, PICK_COMPANIES) ?? []
    body = (
      <>
        <Group
          title={words.coins}
          line={coins.data ? words.pricesAt(formatAt(coins.data.observedAt, now, locale)) : null}
        >
          {coinRows.length > 0 ? (
            <Card padded={false} className="px-4">
              {coinRows.map((row, index) => (
                <AssetRow
                  key={row.mint}
                  asset={row}
                  onPress={() => pick({ mint: row.mint, symbol: row.symbol, category: null })}
                  last={index === coinRows.length - 1}
                />
              ))}
            </Card>
          ) : coins.isError ? (
            <View className="flex-row items-center justify-between gap-3 px-1 py-2">
              <Txt variant="ui" tone="muted" className="flex-1">
                {shared.didNotLoad}
              </Txt>
              <Button
                title={shared.tryAgain}
                variant="secondary"
                size="sm"
                hitSlop={6}
                loading={coins.isFetching}
                onPress={() => void coins.refetch()}
              />
            </View>
          ) : (
            <Rows label={shared.loading} />
          )}
        </Group>
        <Group
          title={invest.popularCompanies}
          line={popular.data ? `${invest.byVolume} · ${formatAt(popular.data.fetchedAt, now, locale)}` : null}
        >
          {companies.length > 0 ? (
            <Card padded={false} className="px-4">
              {companies.map((company, index) => (
                <AssetRow
                  key={company.mint}
                  asset={{
                    symbol: company.ticker,
                    name: company.name,
                    icon: company.icon,
                    price: company.price,
                    change24hPct: company.change24h,
                    // The issuer beside the company, as Markets says it: two tokens of one company never look alike.
                    issuer: { label: issuerLabel(company.issuer) },
                  }}
                  onPress={() => pick({ mint: company.mint, symbol: company.ticker, category: 'stock' })}
                  last={index === companies.length - 1}
                />
              ))}
            </Card>
          ) : popular.isError ? (
            <View className="flex-row items-center justify-between gap-3 px-1 py-2">
              <Txt variant="ui" tone="muted" className="flex-1">
                {invest.shelfDown}
              </Txt>
              <Button
                title={invest.reload}
                variant="secondary"
                size="sm"
                hitSlop={6}
                loading={popular.isFetching}
                onPress={() => void popular.refetch()}
              />
            </View>
          ) : (
            <Rows label={shared.loading} />
          )}
        </Group>
      </>
    )
  }

  return (
    <Sheet visible={visible} title={words.pickTitle} onClose={close}>
      <View style={{ height: Math.round(height * 0.7) }} className="gap-3">
        <View className="flex-row">
          <SearchInput value={query} onChangeText={setQuery} onClear={() => setQuery('')} />
        </View>
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-4 pb-2"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {body}
          <Card padded={false}>
            <DoorRow icon="list-outline" label={words.allMarkets} onPress={allMarkets} last />
          </Card>
        </ScrollView>
      </View>
    </Sheet>
  )
}
