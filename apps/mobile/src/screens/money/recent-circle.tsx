import { Pressable, View } from 'react-native'

import { Txt } from '@/components/txt'
import { shortAddress } from '@/features/money/money-model'
import { useSkrName } from '@/features/seeker/use-seeker'

/**
 * One of «Нещодавні» as a circle: the recipient's primary `.skr` name when that
 * wallet chose one (M41.2), else its short address — the whole address is what
 * a screen reader says, and what a tap puts in «Кому».
 */
export function RecentCircle({ address, label, onPress }: { address: string; label?: string; onPress: () => void }) {
  const name = useSkrName(address)
  const said = name ? `${name}, ${address}` : address
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ? `${label}: ${said}` : said}
      onPress={onPress}
      className="w-16 items-center gap-1.5 active:opacity-80"
    >
      <View className="h-[52px] w-[52px] items-center justify-center rounded-pill border border-line-strong bg-elevated">
        <Txt variant="ui">{(name ?? address).slice(0, 2)}</Txt>
      </View>
      <Txt variant="labelSm" tone="muted" numberOfLines={1}>
        {name ?? shortAddress(address)}
      </Txt>
    </Pressable>
  )
}
