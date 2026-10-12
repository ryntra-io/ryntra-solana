import { useMemo, useState } from 'react'
import { View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native'
import Svg, { Circle, Line, Path } from 'react-native-svg'

import { COMPONENT_COPY } from '@/components/copy'
import { Txt } from '@/components/txt'
import type { Candle, Timeframe } from '@/lib/api'
import { chartGeometry, nearestPoint, type ChartPoint } from '@/lib/chart'
import type { Locale } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { formatBarTime, formatPrice } from '@/utils/format'

export type PriceChartProps = {
  candles: readonly Candle[]
  timeframe: Timeframe
  height?: number
  /** The language of the figures and the days on the chart. */
  locale?: Locale
  /**
   * The line is drawn through each bar's middle, not its close (a day's line): every figure it names is said as
   * «≈», an estimate between the two sides of the pool's trades rather than one trade.
   */
  approx?: boolean
}

/** How a bar's time is written for the window a timeframe spans (300 bars). */
export function barScale(timeframe: Timeframe): 'intraday' | 'days' | 'months' {
  if (timeframe === '1m' || timeframe === '5m') return 'intraday'
  if (timeframe === '15m' || timeframe === '1h') return 'days'
  return 'months'
}

const PAD = 18
const LABEL_WIDTH = 96

/**
 * One line of closes in the chart series colour — never green or red, the
 * direction is a figure beside it. The low and the high are named on the
 * line; a finger on the chart reads any bar's close and time. A line drawn
 * through bars' middles (`approx`) says each of those figures as «≈».
 */
export function PriceChart({ candles, timeframe, height = 168, locale = 'en', approx = false }: PriceChartProps) {
  const { colors } = useTheme()
  const price = (value: number) => `${approx ? '≈ ' : ''}${formatPrice(value, locale)}`
  const words = COMPONENT_COPY[locale]
  const [width, setWidth] = useState(0)
  const [touch, setTouch] = useState<ChartPoint | null>(null)
  const geometry = useMemo(() => chartGeometry(candles, width, height, PAD), [candles, width, height])
  const scale = barScale(timeframe)

  const onLayout = (event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width))
  const read = (event: GestureResponderEvent) => {
    if (!geometry) return
    setTouch(nearestPoint(geometry.points, event.nativeEvent.locationX))
  }

  const labelLeft = (point: ChartPoint) =>
    Math.min(Math.max(0, point.x - LABEL_WIDTH / 2), Math.max(0, width - LABEL_WIDTH))

  return (
    <View className="gap-2">
      <View
        onLayout={onLayout}
        style={{ height }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={read}
        onResponderMove={read}
        onResponderRelease={() => setTouch(null)}
        onResponderTerminate={() => setTouch(null)}
        accessible
        accessibilityRole="image"
        accessibilityLabel={
          geometry
            ? words.priceLineA11y(
                price(geometry.first.value),
                price(geometry.last.value),
                price(geometry.low.value),
                price(geometry.high.value),
              )
            : words.priceLine
        }
      >
        {geometry && width > 0 ? (
          <>
            <Svg width={width} height={height}>
              <Path d={geometry.path} stroke={colors.chart2} strokeWidth={1.5} fill="none" strokeLinejoin="round" />
              {touch ? (
                <>
                  <Line x1={touch.x} x2={touch.x} y1={0} y2={height} stroke={colors.lineStrong} strokeWidth={1} />
                  <Circle cx={touch.x} cy={touch.y} r={4} fill={colors.fg} />
                </>
              ) : (
                <Circle cx={geometry.last.x} cy={geometry.last.y} r={3} fill={colors.chart2} />
              )}
            </Svg>
            {touch ? (
              <View
                pointerEvents="none"
                className="absolute top-0 items-center rounded-xs border border-line bg-elevated px-2 py-1"
                style={{ left: labelLeft(touch), width: LABEL_WIDTH }}
              >
                <Txt variant="data">{price(touch.value)}</Txt>
                <Txt variant="labelSm" tone="faint">
                  {formatBarTime(touch.time, scale, locale)}
                </Txt>
              </View>
            ) : (
              <>
                <View
                  pointerEvents="none"
                  className="absolute items-center"
                  style={{ left: labelLeft(geometry.high), top: 0, width: LABEL_WIDTH }}
                >
                  <Txt variant="labelSm" tone="faint">
                    {price(geometry.high.value)}
                  </Txt>
                </View>
                <View
                  pointerEvents="none"
                  className="absolute items-center"
                  style={{ left: labelLeft(geometry.low), bottom: 0, width: LABEL_WIDTH }}
                >
                  <Txt variant="labelSm" tone="faint">
                    {price(geometry.low.value)}
                  </Txt>
                </View>
              </>
            )}
          </>
        ) : null}
      </View>
      {geometry ? (
        <View className="flex-row justify-between">
          <Txt variant="labelSm" tone="faint">
            {formatBarTime(geometry.first.time, scale, locale)}
          </Txt>
          <Txt variant="labelSm" tone="faint">
            {formatBarTime(geometry.last.time, scale, locale)}
          </Txt>
        </View>
      ) : null}
    </View>
  )
}
