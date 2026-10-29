import { useMemo, useRef, useState } from 'react'
import { View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native'
import Svg, { G, Line, Rect } from 'react-native-svg'

import { COMPONENT_COPY } from '@/components/copy'
import { Txt } from '@/components/txt'
import type { Candle } from '@/lib/api'
import type { Locale } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { formatBarTime, formatPrice, saidFigure } from '@/utils/format'

/** A candle's slot on a phone: its body and the gap after it. */
const SLOT = 7
const BODY = 5
/** The price scale on the right: room for a price of eight characters. */
const AXIS = 64
const PAD_Y = 10
/** The readout's row over the plot: one line, the same height whether a finger is on the chart or not. */
const READOUT = 18

export type CandleChartProps = {
  candles: readonly Candle[]
  /** How a bar's time is written: within a day, across days, across months. */
  scale: 'intraday' | 'days' | 'months'
  height?: number
  locale?: Locale
}

type Geometry = Readonly<{
  bars: readonly Candle[]
  low: number
  high: number
  y: (price: number) => number
  x: (index: number) => number
  ticks: readonly number[]
}>

/** Three round prices inside the range for the scale on the right. */
function ticksOf(low: number, high: number): number[] {
  const span = high - low
  if (!(span > 0)) return [low]
  const raw = span / 3
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw
  const start = Math.ceil(low / step) * step
  const out: number[] = []
  for (let i = 0; i < 8 && start + i * step <= high; i++) out.push(start + i * step)
  return out
}

function geometryOf(candles: readonly Candle[], width: number, height: number): Geometry | null {
  const plotW = width - AXIS
  if (plotW <= SLOT || candles.length === 0) return null
  const bars = candles.slice(-Math.max(1, Math.floor(plotW / SLOT)))
  let low = Infinity
  let high = -Infinity
  for (const bar of bars) {
    low = Math.min(low, bar.low)
    high = Math.max(high, bar.high)
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null
  // A range of a few floating-point steps is flat: drawn around its price, never divided by nearly nothing.
  if (high - low <= Math.abs(high) * 1e-9) {
    high += Math.abs(high) * 0.001 || 1
    low -= Math.abs(low) * 0.001 || 1
  }
  const top = PAD_Y
  const bottom = height - PAD_Y
  const y = (price: number) => bottom - ((price - low) / (high - low)) * (bottom - top)
  // The newest bar stands at the scale's edge; older ones run left from it.
  const x = (index: number) => plotW - (bars.length - index) * SLOT + SLOT / 2
  return { bars, low, high, y, x, ticks: ticksOf(low, high) }
}

/**
 * A market's candles as a phone draws them: the bodies and wicks in the up and down colours, the last price on the
 * scale at the right, three round prices beside it and the first and last bar's time under it. No tools: a finger on
 * the chart reads a bar — its time, open, high, low and close in the row over the plot, which otherwise reads the last.
 */
export function CandleChart({ candles, scale, height = 220, locale = 'en' }: CandleChartProps) {
  const { colors } = useTheme()
  const words = COMPONENT_COPY[locale]
  const [width, setWidth] = useState(0)
  const [touched, setTouched] = useState<number | null>(null)
  const geometry = useMemo(() => geometryOf(candles, width, height), [candles, width, height])

  const onLayout = (event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width))
  // Where the finger came down: a drag mostly sideways stays the chart's, a mostly upright one goes to the page.
  const start = useRef<Readonly<{ x: number; y: number }> | null>(null)
  const sideways = (event: GestureResponderEvent) => {
    const from = start.current
    if (!from) return false
    return Math.abs(event.nativeEvent.pageX - from.x) > Math.abs(event.nativeEvent.pageY - from.y)
  }
  const read = (event: GestureResponderEvent) => {
    if (!geometry) return
    const index = Math.round((event.nativeEvent.locationX - geometry.x(0)) / SLOT)
    setTouched(Math.min(geometry.bars.length - 1, Math.max(0, index)))
  }

  const shown = geometry ? geometry.bars[touched ?? geometry.bars.length - 1] : null
  const last = geometry ? geometry.bars[geometry.bars.length - 1] : null
  const price = (value: number) => formatPrice(value, locale)
  // The readout's figures without the currency sign: five of them fit one line of a phone in either language.
  const plain = (value: number) => price(value).replace('$', '')

  return (
    <View className="gap-1.5">
      <View style={{ height: READOUT }} className="flex-row items-center gap-2">
        {shown ? (
          <Txt
            variant="labelSm"
            tone="faint"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            className="flex-1"
          >
            {words.candleReadout(
              formatBarTime(shown.time, scale, locale),
              plain(shown.open),
              plain(shown.high),
              plain(shown.low),
              plain(shown.close),
            )}
          </Txt>
        ) : null}
      </View>
      <View
        onLayout={onLayout}
        style={{ height }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={(event) => !sideways(event)}
        onResponderGrant={(event) => {
          start.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }
          read(event)
        }}
        onResponderMove={read}
        onResponderRelease={() => setTouched(null)}
        onResponderTerminate={() => setTouched(null)}
        accessible
        accessibilityRole="image"
        accessibilityLabel={
          geometry && last
            ? words.candlesA11y(
                saidFigure(price(geometry.bars[0]!.open), locale),
                saidFigure(price(last.close), locale),
                saidFigure(price(geometry.low), locale),
                saidFigure(price(geometry.high), locale),
              )
            : words.priceLine
        }
      >
        {geometry && last ? (
          <>
            <Svg width={width} height={height}>
              {geometry.ticks.map((tick) => (
                <Line
                  key={tick}
                  x1={0}
                  x2={width - AXIS}
                  y1={geometry.y(tick)}
                  y2={geometry.y(tick)}
                  stroke={colors.line}
                  strokeWidth={1}
                />
              ))}
              {geometry.bars.map((bar, index) => {
                const up = bar.close >= bar.open
                const fill = up ? colors.success : colors.danger
                const cx = geometry.x(index)
                const top = geometry.y(Math.max(bar.open, bar.close))
                const body = Math.max(1, geometry.y(Math.min(bar.open, bar.close)) - top)
                return (
                  <G key={bar.time}>
                    <Line
                      x1={cx}
                      x2={cx}
                      y1={geometry.y(bar.high)}
                      y2={geometry.y(bar.low)}
                      stroke={fill}
                      strokeWidth={1}
                    />
                    <Rect x={cx - BODY / 2} y={top} width={BODY} height={body} fill={fill} />
                  </G>
                )
              })}
              <Line
                x1={0}
                x2={width - AXIS}
                y1={geometry.y(last.close)}
                y2={geometry.y(last.close)}
                stroke={last.close >= last.open ? colors.success : colors.danger}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              {touched !== null ? (
                <Line
                  x1={geometry.x(touched)}
                  x2={geometry.x(touched)}
                  y1={0}
                  y2={height}
                  stroke={colors.lineStrong}
                  strokeWidth={1}
                />
              ) : null}
            </Svg>
            {/* A round price next to the last one's label would sit under it: only the last is said there. */}
            {geometry.ticks
              .filter((tick) => Math.abs(geometry.y(tick) - geometry.y(last.close)) > 18)
              .map((tick) => (
                <View
                  key={tick}
                  pointerEvents="none"
                  className="absolute"
                  style={{ right: 0, width: AXIS - 6, top: geometry.y(tick) - 8 }}
                >
                  <Txt variant="labelSm" tone="faint" numberOfLines={1} className="text-right">
                    {price(tick)}
                  </Txt>
                </View>
              ))}
            <View
              pointerEvents="none"
              className={`absolute rounded-xs px-1 ${last.close >= last.open ? 'bg-success-soft' : 'bg-danger-soft'}`}
              style={{ right: 0, width: AXIS - 4, top: geometry.y(last.close) - 9 }}
            >
              <Txt
                variant="labelSm"
                tone={last.close >= last.open ? 'success' : 'danger'}
                numberOfLines={1}
                className="text-right"
              >
                {price(last.close)}
              </Txt>
            </View>
          </>
        ) : null}
      </View>
      {geometry ? (
        <View className="flex-row justify-between" style={{ paddingRight: AXIS }}>
          <Txt variant="labelSm" tone="faint">
            {formatBarTime(geometry.bars[0]!.time, scale, locale)}
          </Txt>
          <Txt variant="labelSm" tone="faint">
            {formatBarTime(last!.time, scale, locale)}
          </Txt>
        </View>
      ) : null}
    </View>
  )
}
