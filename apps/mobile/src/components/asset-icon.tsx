import { Image } from 'expo-image'
import { StyleSheet, View } from 'react-native'

import { Txt } from '@/components/txt'

export type AssetIconProps = {
  symbol: string
  icon: string | null
  size?: number
}

/** The token's image over its first two letters, so a missing image is still an identity. */
export function AssetIcon({ symbol, icon, size = 40 }: AssetIconProps) {
  return (
    <View
      className="items-center justify-center overflow-hidden rounded-pill bg-elevated"
      style={{ width: size, height: size }}
    >
      <Txt variant={size >= 48 ? 'ui' : 'label'} tone="faint">
        {symbol.slice(0, 2)}
      </Txt>
      {icon ? (
        <Image
          source={{ uri: icon }}
          style={{ position: 'absolute', width: size, height: size }}
          contentFit="cover"
          transition={120}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {/* A hairline ring keeps a dark logo apart from a dark page, and a light one from a light page. */}
      <View
        pointerEvents="none"
        className="rounded-pill border-line"
        style={{ position: 'absolute', width: size, height: size, borderWidth: StyleSheet.hairlineWidth * 2 }}
      />
    </View>
  )
}
