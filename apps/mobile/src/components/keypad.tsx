import { Pressable, View } from 'react-native'

import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { PAD_KEYS, type PadKey } from '@/features/trade/keypad-model'

/**
 * The sheet's keypad: three keys a row, the language's decimal mark beside the zero, delete last. Each key is a
 * 52dp target; the figures are Geist Mono.
 */
export function Keypad({
  mark,
  onKey,
  deleteLabel,
  disabled = false,
}: {
  mark: ',' | '.'
  onKey: (key: PadKey) => void
  deleteLabel: string
  disabled?: boolean
}) {
  const rows = [PAD_KEYS.slice(0, 3), PAD_KEYS.slice(3, 6), PAD_KEYS.slice(6, 9), PAD_KEYS.slice(9, 12)]
  return (
    <View className="gap-0.5">
      {rows.map((row) => (
        <View key={row.join('')} className="flex-row gap-0.5">
          {row.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={key === 'delete' ? deleteLabel : key === 'mark' ? mark : key}
              disabled={disabled}
              onPress={() => onKey(key)}
              className="h-[52px] flex-1 items-center justify-center rounded-btn active:bg-hover"
            >
              {key === 'delete' ? (
                <Icon name="backspace-outline" size={22} color={disabled ? 'fgMuted' : 'fg'} />
              ) : (
                <Txt variant="dataLg" tone={disabled ? 'muted' : 'fg'} style={{ fontSize: 23, lineHeight: 28 }}>
                  {key === 'mark' ? mark : key}
                </Txt>
              )}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  )
}
