import { Pressable, View } from 'react-native'

import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'

export type FilterOption<T extends string> = { value: T; label: string; detail?: string }

export type FilterSheetProps<T extends string> = {
  visible: boolean
  title: string
  options: readonly FilterOption<T>[]
  value: T
  onSelect: (value: T) => void
  onClose: () => void
}

/** A bottom sheet with one choice per row. Selecting closes it; the backdrop closes it. */
export function FilterSheet<T extends string>({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
}: FilterSheetProps<T>) {
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => {
              onSelect(option.value)
              onClose()
            }}
            className={`flex-row items-center justify-between py-3.5 active:bg-hover ${index < options.length - 1 ? 'border-b border-line' : ''}`}
          >
            <View className="flex-1 gap-0.5">
              <Txt variant="ui" tone={selected ? 'brand' : 'fg'}>
                {option.label}
              </Txt>
              {option.detail ? (
                <Txt variant="ui" tone="faint">
                  {option.detail}
                </Txt>
              ) : null}
            </View>
            {selected ? <Icon name="checkmark" size={20} color="brand" /> : null}
          </Pressable>
        )
      })}
    </Sheet>
  )
}
