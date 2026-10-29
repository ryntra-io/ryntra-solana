import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { useSharedCopy } from '@/lib/i18n'
import { page } from '@/theme'

export type SheetProps = {
  visible: boolean
  title: string
  /** One short fact under the title — a time, a source. */
  subtitle?: string
  /** A mark before the title — the logo of what the sheet is about. */
  leading?: ReactNode
  onClose: () => void
  /** Scrolls when the content is taller than the screen allows. */
  scroll?: boolean
  children: ReactNode
}

/**
 * A bottom sheet: one layer up from the screen, closed by the backdrop, the
 * handle's row or the system back gesture. Details live here, one tap deep,
 * never on the screen itself.
 */
export function Sheet({ visible, title, subtitle, leading, onClose, scroll = false, children }: SheetProps) {
  const insets = useSafeAreaInsets()
  const shared = useSharedCopy()
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {/* A modal's window does not resize for the keyboard on Android: the sheet moves up itself, so a field in it is never typed into blind. */}
      <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shared.close}
          onPress={onClose}
          className="absolute inset-0 bg-black/50"
        />
        {/* On a wide window the sheet stands in the middle at the action column's width, never edge to edge. */}
        <View
          className="w-full self-center rounded-t-lg border-t border-line bg-elevated pt-3"
          style={{ maxHeight: '88%', maxWidth: page.action, paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <View className="mb-2 h-1 w-10 self-center rounded-pill bg-line-strong" />
          <View className="flex-row items-center gap-3 px-4 py-2">
            {leading}
            <View className="flex-1 gap-0.5">
              <Txt variant="title" accessibilityRole="header">
                {title}
              </Txt>
              {subtitle ? (
                <Txt variant="ui" tone="faint">
                  {subtitle}
                </Txt>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={shared.close}
              onPress={onClose}
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-btn active:bg-hover"
            >
              <Icon name="close" size={20} color="muted" />
            </Pressable>
          </View>
          {scroll ? (
            <ScrollView contentContainerClassName="px-4 pb-2" keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          ) : (
            <View className="px-4">{children}</View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
