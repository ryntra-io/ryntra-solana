import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ScreenHeader } from '@/components/screen'
import { StateView } from '@/components/state-view'
import { useLaunchToken } from '@/features/launch/use-launch'
import { MARKETS_COPY } from '@/features/markets/copy'
import { isContractAddress, tokenDestination } from '@/features/markets/screener'
import { useStockUniverse } from '@/hooks/use-markets'
import { useCopy, useSharedCopy } from '@/lib/i18n'

/**
 * `/token/<address>` — a token by its contract address: what a pasted address
 * in the search opens, and the web's `/app/token/<address>`. It finds the
 * token's own page, in the web's order: a tokenized stock's or a private
 * company's page, a launch's page when the token was launched on Ryntra, else
 * the token's page, which reads any mint the venue knows and says so when it
 * knows none. It replaces itself, so «Назад» returns to where the address
 * was pasted.
 */
export default function TokenRoute() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const words = useCopy(MARKETS_COPY)
  const shared = useSharedCopy()
  const { mint: raw } = useLocalSearchParams<{ mint?: string }>()
  const mint = typeof raw === 'string' && isContractAddress(raw) ? raw.trim() : null
  const stocks = useStockUniverse(mint !== null)
  const launch = useLaunchToken(mint)
  const left = useRef(false)

  const stocksSettled = stocks.data !== undefined || stocks.isError
  const launchSettled = launch.data !== undefined || launch.isError
  useEffect(() => {
    if (!mint || left.current || !stocksSettled) return
    const stock = stocks.data?.rows.find((row) => row.mint === mint) ?? null
    // A stock is known without the launch's answer; anything else waits for it — a read that failed is no launch.
    if (!stock && !launchSettled) return
    left.current = true
    const destination = tokenDestination(mint, {
      stockSymbol: stock?.symbol ?? null,
      launched: launch.data !== undefined && !stock,
    })
    router.replace({ pathname: destination.pathname, params: { mint, ...destination.params } } as never)
  }, [mint, stocksSettled, launchSettled, stocks.data, launch.data, router])

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/markets'))
  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <ScreenHeader title={words.openAddress} onBack={back} backLabel={shared.back} />
      {mint ? (
        <StateView icon="search-outline" title={words.finding} />
      ) : (
        <StateView icon="search-outline" title={words.nothingFound} detail={words.noAnswer(raw ?? '')} />
      )}
    </View>
  )
}
