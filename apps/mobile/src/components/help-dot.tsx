import Ionicons from '@expo/vector-icons/Ionicons'
import { useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import { useSharedCopy } from '@/lib/i18n'
import { useTheme } from '@/theme'

export type HelpDotProps = {
  /** The sheet's title — what is being explained. */
  title: string
  /** The explanation: one paragraph or a few. */
  body?: string | readonly string[]
  /** Anything the words alone cannot say — a time, a row. */
  children?: ReactNode
  size?: number
  /** A few words beside the mark, where a bare «?» would not say what it answers («Why sign in»). */
  label?: string
}

/** The «?» mark alone. `inline` is a glyph at the end of a line of text, inside a `Txt`. */
export function HelpMark({
  title,
  onPress,
  size = 18,
  inline = false,
}: {
  title: string
  onPress: () => void
  size?: number
  /** A glyph at the end of a line of text: drawn only — the line around it is what is pressed (see StateView). */
  inline?: boolean
}) {
  const shared = useSharedCopy()
  const { colors } = useTheme()
  if (inline)
    // Inside a line of text the mark is a glyph of the line itself: it wraps with the words and never clips them.
    return (
      <Ionicons
        name="help-circle-outline"
        size={size + 4}
        color={colors.muted}
        accessible={false}
        importantForAccessibility="no"
      />
    )
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${shared.whatItMeans}`}
      onPress={onPress}
      hitSlop={10}
      className="h-8 w-8 items-center justify-center rounded-pill active:bg-hover"
    >
      <Icon name="help-circle-outline" size={size} color="muted" />
    </Pressable>
  )
}

/** The sheet a «?» opens: the title, the explanation, and whatever else it needs. */
export function HelpSheet({
  visible,
  onClose,
  title,
  body,
  children,
}: HelpDotProps & { visible: boolean; onClose: () => void }) {
  const paragraphs = body === undefined ? [] : typeof body === 'string' ? [body] : body
  return (
    <Sheet visible={visible} title={title} onClose={onClose} scroll>
      <View className="gap-3 pb-4">
        {paragraphs.map((line, index) => (
          <Txt key={index} variant="body" tone="muted">
            {line}
          </Txt>
        ))}
        {children}
      </View>
    </Sheet>
  )
}

/**
 * «?» : a screen carries no line that
 * explains it; what a person may need to know sits one tap deep, in a sheet
 * behind this mark.
 */
export function HelpDot({ title, body, children, size = 18, label }: HelpDotProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {label ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => setOpen(true)}
          hitSlop={8}
          className="min-h-10 flex-row items-center gap-1.5 self-center rounded-pill px-2 active:bg-hover"
        >
          <Icon name="help-circle-outline" size={size} color="muted" />
          <Txt variant="ui" tone="muted">
            {label}
          </Txt>
        </Pressable>
      ) : (
        <HelpMark title={title} onPress={() => setOpen(true)} size={size} />
      )}
      <HelpSheet visible={open} onClose={() => setOpen(false)} title={title} body={body}>
        {children}
      </HelpSheet>
    </>
  )
}
