import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { segmentOf, TRADE_SEGMENTS, tradeSegmentAsked } from '@/features/shell/trade-place'
import { SHEET_COPY, type TradeSegment } from '@/features/trade/sheet-copy'
import { useCopy } from '@/lib/i18n'
import { FuturesScreen } from '@/screens/futures'
import { MarketsScreen } from '@/screens/markets'
import { PredictionsScreen } from '@/screens/predictions'
import { TradeScreen } from '@/screens/trade'
import { cn } from '@/utils/cn'

/**
 * «Торгівля» (NEW-LOOK §3): in the head's place a switch of its segments — Ринки · Обмін · Ф'ючерси, and Прогнози where
 * the build shows them — search on the right. Ринки
 * is the screener; Обмін a market swap of one token for another; Ф'ючерси Phoenix's perpetuals (C4, C4b);
 * Прогнози AGG's markets on outcomes, entered with the Solana wallet (M12), drawn only in a build that shows them
 * (`PREDICTIONS_LIVE`, the second release) — all in Ryntra on Solana, the phone's only
 * network. `?seg=` opens a segment; an address that names a chip of Ринки (`?tab=`, `?kind=`, `?mode=` — Home's
 * «Обране») opens Ринки on it even when the place was left on Обмін. The ask is spent once read.
 */
export function TradePlace() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const words = useCopy(SHEET_COPY)
  const params = useLocalSearchParams<{ seg?: string; tab?: string; kind?: string; mode?: string }>()
  const asked = tradeSegmentAsked(params)
  const [segment, setSegment] = useState<TradeSegment>(asked ?? 'markets')
  // A segment asked for while the place is already open (Home's «Обмін») wins once, during render.
  const [askedSeen, setAskedSeen] = useState(asked)
  if (asked !== askedSeen) {
    setAskedSeen(asked)
    if (asked) setSegment(asked)
  }
  // `seg` is spent here; a chip's ask is Ринки's own to read and spend (`screens/markets`) — but the other segments,
  // where Ринки is not drawn, spend it with the segment, so a leftover chip never pulls the place back to Ринки.
  const segAsked = segmentOf(params.seg)
  useEffect(() => {
    if (segAsked && segAsked !== 'markets')
      router.setParams({ seg: undefined, tab: undefined, kind: undefined, mode: undefined })
    else if (segAsked) router.setParams({ seg: undefined })
  }, [segAsked, router])

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-1.5 pb-3 pl-4 pr-1.5 pt-2">
        <View
          accessibilityRole="tablist"
          accessibilityLabel={words.segmentsA11y}
          className="flex-1 flex-row gap-1 rounded-lg border border-line bg-surface p-1"
        >
          {TRADE_SEGMENTS.map((value) => {
            const on = value === segment
            return (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={words.segments[value]}
                onPress={() => setSegment(value)}
                // Each segment as wide as its word, the room left shared alike: even with Прогнози all four words fit
                // at 390 dp in both languages, «Predictions» the longest (M12).
                className={cn(
                  'h-10 grow items-center justify-center rounded-md px-2',
                  on ? 'border border-line-strong bg-elevated' : 'active:bg-hover',
                )}
              >
                <Txt variant="ui" tone={on ? 'fg' : 'muted'} numberOfLines={1}>
                  {words.segments[value]}
                </Txt>
              </Pressable>
            )
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={words.search}
          onPress={() => router.push('/search')}
          className="h-12 w-12 items-center justify-center rounded-pill active:bg-hover"
        >
          <Icon name="search" size={22} color="fg" />
        </Pressable>
      </View>
      {segment === 'markets' ? (
        <MarketsScreen />
      ) : segment === 'futures' ? (
        <FuturesScreen />
      ) : segment === 'predictions' ? (
        <PredictionsScreen />
      ) : (
        <TradeScreen variant="swap" />
      )}
    </View>
  )
}
