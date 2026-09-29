import { forwardRef } from 'react'
import { Pressable, TextInput, View, type TextInputProps } from 'react-native'

import { COMPONENT_COPY } from '@/components/copy'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { useCopy } from '@/lib/i18n'
import { type, useTheme } from '@/theme'

/** The search field as a door: it looks like the input and opens the search screen. */
export function SearchBar({ onPress }: { onPress: () => void }) {
  const words = useCopy(COMPONENT_COPY)
  return (
    <Pressable
      accessibilityRole="search"
      accessibilityLabel={words.searchMarkets}
      onPress={onPress}
      className="h-11 flex-row items-center gap-2 rounded-btn border border-line bg-surface px-3 active:bg-hover"
    >
      <Icon name="search" size={18} color="fgMuted" />
      <Txt variant="body" tone="faint" className="flex-1">
        {words.searchPlaceholder}
      </Txt>
    </Pressable>
  )
}

export type SearchInputProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  onClear: () => void
  /** What a screen reader calls the field and its clear button, in the screen's language. */
  label?: string
  clearLabel?: string
}

/** The live search input: the query, a clear button, the keyboard's own search key. */
export const SearchInput = forwardRef<TextInput, SearchInputProps>(function SearchInput(
  { onClear, value, placeholder, label, clearLabel, ...props },
  ref,
) {
  const { colors } = useTheme()
  const words = useCopy(COMPONENT_COPY)
  return (
    <View className="h-11 flex-1 flex-row items-center gap-2 rounded-btn border border-line-strong bg-surface px-3">
      <Icon name="search" size={18} color="fgMuted" />
      <TextInput
        ref={ref}
        {...props}
        value={value}
        placeholder={placeholder ?? words.searchPlaceholder}
        placeholderTextColor={colors.fgMuted}
        selectionColor={colors.brand}
        cursorColor={colors.brand}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={label ?? words.searchMarkets}
        className="flex-1 text-fg"
        style={[type.body, { paddingVertical: 0 }]}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearLabel ?? words.clearSearch}
          onPress={onClear}
          hitSlop={8}
          className="h-7 w-7 items-center justify-center rounded-pill bg-elevated active:bg-hover"
        >
          <Icon name="close" size={16} color="muted" />
        </Pressable>
      ) : null}
    </View>
  )
})
