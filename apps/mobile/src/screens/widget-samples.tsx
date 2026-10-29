import { View } from 'react-native'
import { WidgetPreview } from 'react-native-android-widget'

import { PortfolioWidget } from '@/features/widget/portfolio-widget'
import { widgetFace, type WidgetFigures, type WidgetState } from '@/features/widget/widget-model'
import { useLocale } from '@/lib/i18n'
import { useNow } from '@/hooks/use-now'
import { useTheme } from '@/theme'

const SAMPLE_WALLET = 'Samp1eWa11et11111111111111111111111111111111'

/**
 * The home-screen widget in the development gallery (M9): the launcher's own
 * drawing of it, by the same library, in the app's theme and language — a
 * fresh read, one from yesterday not updated, hidden amounts, a wallet not
 * connected, and the lowest size. Sample figures, never a wallet's.
 */
export function WidgetSamples() {
  const locale = useLocale()
  const { name: theme } = useTheme()
  const now = useNow(60_000)
  const figures = (over: Partial<WidgetFigures> = {}): WidgetFigures => ({
    owner: SAMPLE_WALLET,
    observedAt: new Date(now - 2 * 60_000).toISOString(),
    total: 1284.37,
    dayUsd: 12.4,
    dayPct: 0.97,
    whole: true,
    ...over,
  })
  const samples: readonly { state: WidgetState; hidden: boolean; height: number }[] = [
    { state: { wallet: SAMPLE_WALLET, figures: figures(), failedAt: null }, hidden: false, height: 150 },
    {
      state: {
        wallet: SAMPLE_WALLET,
        figures: figures({ observedAt: new Date(now - 20 * 60 * 60_000).toISOString(), dayUsd: -8.1, dayPct: -0.63 }),
        failedAt: new Date(now - 60_000).toISOString(),
      },
      hidden: false,
      height: 150,
    },
    { state: { wallet: SAMPLE_WALLET, figures: figures(), failedAt: null }, hidden: true, height: 150 },
    { state: { wallet: null, figures: null, failedAt: null }, hidden: false, height: 150 },
    // The lowest the launcher allows: the value and its time.
    { state: { wallet: SAMPLE_WALLET, figures: figures(), failedAt: null }, hidden: false, height: 110 },
  ]
  return (
    <View className="gap-3">
      {samples.map((sample, index) => {
        const face = widgetFace(sample.state, { locale, now, hidden: sample.hidden })
        return (
          <WidgetPreview
            key={index}
            width={300}
            height={sample.height}
            renderWidget={() => (
              <PortfolioWidget
                face={face}
                theme={theme}
                uri="ryntra:///(tabs)/portfolio"
                large={false}
                roomy={sample.height >= 140}
              />
            )}
          />
        )
      })}
    </View>
  )
}
