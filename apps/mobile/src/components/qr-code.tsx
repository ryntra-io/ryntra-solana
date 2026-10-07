import { useMemo } from 'react'
import { View } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'

import { qrPath } from '@/features/money/qr'
import { brand, themes } from '@/theme/tokens'

/** A code is dark on white in either theme: the brand's white and the dark ground. */
const PAPER = brand.onBrand
const INK = themes.dark.ground

export type QrCodeProps = {
  /** What the code carries — an address's `solana:` request or a payment link's page. */
  value: string
  /** The side in points; the code fills it with its quiet zone. */
  size?: number
  /** What a screen reader says the code is for. */
  label: string
}

/**
 * A scannable code: dark modules on white in either theme, with the four-module
 * quiet zone a camera needs — a code drawn in the dark theme's light ink on
 * near-black is one many scanners refuse.
 */
export function QrCode({ value, size = 224, label }: QrCodeProps) {
  const code = useMemo(() => qrPath(value), [value])
  const quiet = 4
  const grid = code.size + quiet * 2
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      className="items-center justify-center overflow-hidden rounded-sm"
      style={{ width: size, height: size, backgroundColor: PAPER }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${grid} ${grid}`}>
        <Rect x={0} y={0} width={grid} height={grid} fill={PAPER} />
        <Path d={code.path} fill={INK} transform={`translate(${quiet} ${quiet})`} />
      </Svg>
    </View>
  )
}
