import { Image } from 'expo-image'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Txt } from '@/components/txt'

export type AssetIconProps = {
  symbol: string
  icon: string | null
  size?: number
}

/** The token's image over its first two letters, so a missing image is still an identity. */
export function AssetIcon({ symbol, icon, size = 40 }: AssetIconProps) {
  /* The image that failed to load, by its address: the initials stay instead, and a new token's address is tried
     afresh. Remembering the address, not a flag, means a chip that changes token never carries the old failure. */
  const [failed, setFailed] = useState<string | null>(null)
  const shown = icon && icon !== failed ? icon : null
  return (
    <View
      className="items-center justify-center overflow-hidden rounded-pill bg-elevated"
      style={{ width: size, height: size }}
    >
      <Txt variant={size >= 48 ? 'ui' : 'label'} tone="faint">
        {symbol.slice(0, 2)}
      </Txt>
      {/* Keyed and recycled by its address (ST-5): picking PUMP after SOL never keeps SOL's logo while PUMP's loads
          or fails — expo-image would otherwise hold the previous source on screen. */}
      {shown ? (
        <Image
          key={shown}
          recyclingKey={shown}
          source={{ uri: shown }}
          style={{ position: 'absolute', width: size, height: size }}
          contentFit="cover"
          transition={120}
          onError={() => setFailed(shown)}
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
