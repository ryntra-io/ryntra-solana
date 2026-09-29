import type { ReactNode } from 'react'
import { Pressable, ScrollView, View, type ScrollViewProps } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { useSharedCopy } from '@/lib/i18n'
import { cn } from '@/utils/cn'

export type ScreenHeaderProps = {
  title: string
  /** One short line under the title: a time, a state, a count — never prose. */
  subtitle?: string
  right?: ReactNode
  /** A stack screen's way back, drawn as the arrow before the title; a tab has none. */
  onBack?: () => void
  backLabel?: string
}

/** The screen's own header: a headline, an optional fact line and one slot on the right. */
export function ScreenHeader({ title, subtitle, right, onBack, backLabel }: ScreenHeaderProps) {
  const shared = useSharedCopy()
  return (
    <View className="flex-row items-end justify-between gap-3 px-4 pb-3 pt-2">
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backLabel ?? shared.back}
          onPress={onBack}
          hitSlop={8}
          className="-ml-2 h-10 w-10 items-center justify-center rounded-btn active:bg-hover"
        >
          <Icon name="arrow-back" size={22} color="fg" />
        </Pressable>
      ) : null}
      <View className="flex-1 gap-0.5">
        <Txt variant="headline" accessibilityRole="header">
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="ui" tone="faint">
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right ? <View className="pb-1">{right}</View> : null}
    </View>
  )
}

export type ScreenProps = ScreenHeaderProps & {
  children: ReactNode
  /** Scrolls by default; pass `false` when the body is its own list. */
  scroll?: boolean
  /** Reserve room for a BottomAction docked below the content. */
  bottomInset?: number
  contentClassName?: string
  refreshControl?: ScrollViewProps['refreshControl']
}

/** The ground, the safe area and the header — every tab starts here. */
export function Screen({
  children,
  scroll = true,
  bottomInset = 0,
  contentClassName,
  refreshControl,
  ...header
}: ScreenProps) {
  const insets = useSafeAreaInsets()
  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <ScreenHeader {...header} />
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={cn('gap-3 px-4 pb-6', contentClassName)}
          contentContainerStyle={{ paddingBottom: 24 + bottomInset }}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View className="flex-1">{children}</View>
      )}
    </View>
  )
}
