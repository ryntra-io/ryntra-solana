import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, RefreshControl, View } from 'react-native'

import { AssetRow, type AssetRowAsset } from '@/components/asset-row'
import { HelpDot } from '@/components/help-dot'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { FUTURES_COPY, sessionWord, type FuturesCopy } from '@/features/futures/futures-copy'
import { dayChangePct, type FuturesMarket } from '@/features/futures/futures-model'
import { useFuturesAccount, useFuturesMarkets } from '@/features/futures/use-futures'
import { useOrderGate } from '@/features/futures/use-orders'
import { useAccount } from '@/features/session/use-account'
import { useRefreshOnOpen } from '@/hooks/use-refresh-on-open'
import { isNetworkError } from '@/lib/api'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { formatAmount, formatClock } from '@/utils/format'

import { FuturesAccountCard } from './account-card'

/** The pull's spinner stands over the list's top; while it spins the list stands this much lower (as Ринки's does). */
const PULL_ROOM = 56

/** A market's line under its symbol: its leverage, then the one state that matters — not open, a session, isolated. */
export function marketNote(market: FuturesMarket, words: FuturesCopy, locale: Locale): string {
  return [
    market.maxLeverage !== null ? words.upTo(formatAmount(market.maxLeverage, 0, locale)) : null,
    market.status === 'gated' ? words.gated : market.calendar ? sessionWord(market.session, words) : null,
    market.isolatedOnly ? words.isolated : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
}

/** A Phoenix market as a row of the phone's lists: the mark price and its day's move, the leverage under the symbol. */
export function rowOf(market: FuturesMarket, words: FuturesCopy, locale: Locale): AssetRowAsset {
  return {
    symbol: market.symbol,
    name: marketNote(market, words, locale),
    icon: null,
    price: market.markPrice,
    change24hPct: dayChangePct(market),
  }
}

/**
 * «Торгівля → Perps» (C4, decision 56, PERP-1): Phoenix's perpetual markets on Solana, the busiest first, each opening its
 * own page; over them the connected wallet's Phoenix account. «View only» beside the time of the read only while the
 * server's gate keeps this wallet's orders closed (C4b) — the market's own page says the same; what it means sits behind
 * «?» in the head.
 */
export function FuturesScreen() {
  const router = useRouter()
  const words = useCopy(FUTURES_COPY)
  const locale = useLocale()
  const { colors } = useTheme()
  const markets = useFuturesMarkets()
  const wallet = useAccount()
  const gate = useOrderGate(wallet.address)
  const account = useFuturesAccount(wallet.address)
  useRefreshOnOpen([markets])
  const [pulled, setPulled] = useState(false)
  // The person's pull reads both again: the markets and, with a wallet, its Phoenix account.
  const pull = () => {
    setPulled(true)
    const reads = [markets.refetch(), ...(wallet.address ? [account.refetch()] : [])]
    void Promise.allSettled(reads).finally(() => setPulled(false))
  }
  /* A market's page; with a side, its ticket open on it at once (C4e: «Відкрити угоду» from the deposit sheet). */
  const open = (symbol: string, side?: 'long' | 'short') =>
    router.push({ pathname: '/futures/[symbol]', params: { symbol, ...(side ? { open: side } : {}) } } as never)
  const rows = useMemo(
    () => (markets.data?.markets ?? []).map((market) => rowOf(market, words, locale)),
    [markets.data, words, locale],
  )

  // This wallet's own reason, as the market's page says it: no Phoenix account, or the gate's word that orders are closed.
  const reason =
    wallet.address === null
      ? null
      : account.data && (account.data.state === 'none' || account.data.state === 'uninitialized')
        ? ('account' as const)
        : gate.read && !gate.states.open
          ? ('gate' as const)
          : null
  const help = reason
    ? [words.whyViewOnly[reason], ...(reason === 'gate' ? words.help : words.helpOrders.slice(0, 2))]
    : words.helpOrders

  const head = (
    <View className="flex-row items-center gap-2 px-4 pb-2">
      <Txt variant="labelSm" tone="faint" numberOfLines={1} className="flex-1">
        {[
          markets.data ? words.readAt(formatClock(new Date(markets.data.observedAt).toISOString())) : null,
          reason ? words.viewOnly : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Txt>
      <HelpDot title={words.helpTitle} body={help} />
    </View>
  )

  let body
  if (markets.isPending) {
    body = (
      <View className="gap-3 px-4" accessibilityRole="progressbar" accessibilityLabel={words.loading}>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full rounded-sm" />
        ))}
      </View>
    )
  } else if (!markets.data) {
    const offline = isNetworkError(markets.error)
    body = (
      <StateView
        icon={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={offline ? words.noConnection : words.down}
        detail={offline ? words.needsNetwork : words.downLine}
        action={{ title: words.tryAgain, onPress: () => void markets.refetch(), loading: markets.isFetching }}
      />
    )
  } else {
    body = (
      <FlatList
        data={rows}
        keyExtractor={(item) => item.symbol}
        renderItem={({ item, index }) => (
          <AssetRow asset={item} onPress={() => open(item.symbol)} last={index === rows.length - 1} />
        )}
        contentContainerClassName="px-4 pb-6"
        contentContainerStyle={pulled ? { paddingTop: PULL_ROOM } : undefined}
        initialNumToRender={14}
        maxToRenderPerBatch={12}
        windowSize={7}
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
          <View className="pb-3">
            <FuturesAccountCard onOpen={open} />
          </View>
        }
        ListEmptyComponent={<StateView icon="list-outline" title={words.noMarkets} />}
      />
    )
  }

  return (
    <View className="flex-1 bg-ground">
      {head}
      {body}
    </View>
  )
}
