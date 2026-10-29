import { useEffect, useRef } from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { Txt } from '@/components/txt'
import { cn } from '@/utils/cn'

export type Choice<T extends string> = {
  value: T
  label: string
  accessibilityLabel?: string
  /** This one choice cannot be picked now — drawn, never offered (a share of the wallet under the minimum). */
  disabled?: boolean
}

export type ChoiceChipsProps<T extends string> = {
  choices: readonly Choice<T>[]
  value: T
  onChange: (value: T) => void
  /** Tabs switch a list; radios pick a setting. Announced accordingly. */
  role?: 'tablist' | 'radiogroup'
  /** Scrolls sideways when the chips outgrow the row (a list of views); otherwise wraps. */
  scroll?: boolean
  size?: 'md' | 'sm'
  /**
   * The selected chip in the ink colour, not the brand's: a screen whose one
   * orange action is elsewhere keeps its choices quiet.
   */
  quiet?: boolean
  /** Each chip takes an equal share of the row — a fixed set of sums or ranges. */
  fill?: boolean
  /** Small chips that still take a full finger: each pill is drawn inside a 44-point press, the row as tall. */
  tall?: boolean
  disabled?: boolean
  className?: string
}

/** A row of pill chips with one selected — views, timeframes, sides, amounts. */
export function ChoiceChips<T extends string>({
  choices,
  value,
  onChange,
  role = 'radiogroup',
  scroll = false,
  size = 'md',
  quiet = false,
  fill = false,
  tall = false,
  disabled = false,
  className,
}: ChoiceChipsProps<T>) {
  // A scrolled row keeps its selected chip in view — a tab a link opens is never hidden past the edge —
  // and moves only when that chip is out of view, never on a tap at a chip already seen. A chip wider
  // than the row is «seen» by its start: its words read from the first.
  const scroller = useRef<ScrollView>(null)
  const chipBoxes = useRef(new Map<string, Readonly<{ x: number; width: number }>>())
  const viewport = useRef(0)
  const offset = useRef(0)
  const revealed = useRef(false)
  const reveal = useRef((selected: string, animated: boolean) => {
    const box = chipBoxes.current.get(selected)
    if (!box || viewport.current === 0) return false
    const edge = 16
    const wide = box.width + 2 * edge > viewport.current
    const startHidden = box.x < offset.current || box.x + edge > offset.current + viewport.current
    if (box.x < offset.current || (wide && startHidden))
      scroller.current?.scrollTo({ x: Math.max(0, box.x - edge), animated })
    else if (!wide && box.x + box.width > offset.current + viewport.current)
      scroller.current?.scrollTo({ x: box.x + box.width - viewport.current + edge, animated })
    return true
  })
  useEffect(() => {
    if (scroll && revealed.current) reveal.current(value, true)
  }, [scroll, value])
  // The first time the row knows its own width and the selected chip's place, it shows that chip — once.
  const revealOnce = () => {
    if (!revealed.current && reveal.current(value, false)) revealed.current = true
  }
  const chips = choices.map((choice) => {
    const selected = choice.value === value
    const off = disabled || choice.disabled === true
    const pill = cn(
      'items-center justify-center rounded-pill border',
      size === 'md' ? 'h-9 px-4' : 'h-8 px-3',
      fill && 'flex-1',
      selected
        ? quiet
          ? 'border-line-strong bg-hover'
          : 'border-brand-chip-line bg-brand-chip'
        : 'border-line bg-surface',
      off && 'opacity-50',
    )
    return (
      <Pressable
        key={choice.value}
        accessibilityRole={role === 'tablist' ? 'tab' : 'radio'}
        accessibilityLabel={choice.accessibilityLabel ?? choice.label}
        accessibilityState={{ selected, disabled: off }}
        disabled={off}
        onPress={() => onChange(choice.value)}
        onLayout={
          scroll
            ? (event) => {
                const { x, width } = event.nativeEvent.layout
                chipBoxes.current.set(choice.value, { x, width })
                if (selected) revealOnce()
              }
            : undefined
        }
        className={tall ? cn('h-11 justify-center', fill && 'flex-1') : cn(pill, !selected && 'active:bg-hover')}
      >
        {({ pressed }) => {
          const label = (
            <Txt
              variant={size === 'md' ? 'ui' : 'labelSm'}
              tone={selected ? (quiet ? 'fg' : 'brand') : 'muted'}
              tabular={quiet}
            >
              {choice.label}
            </Txt>
          )
          return tall ? <View className={cn(pill, !selected && pressed && 'bg-hover')}>{label}</View> : label
        }}
      </Pressable>
    )
  })
  if (scroll) {
    return (
      <ScrollView
        ref={scroller}
        onLayout={(event) => {
          viewport.current = event.nativeEvent.layout.width
          revealOnce()
        }}
        onScroll={(event) => {
          offset.current = event.nativeEvent.contentOffset.x
        }}
        scrollEventThrottle={16}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        accessibilityRole={role}
        contentContainerClassName={cn('flex-row gap-2', className)}
        keyboardShouldPersistTaps="handled"
      >
        {chips}
      </ScrollView>
    )
  }
  return (
    <View accessibilityRole={role} className={cn('flex-row flex-wrap gap-2', className)}>
      {chips}
    </View>
  )
}
