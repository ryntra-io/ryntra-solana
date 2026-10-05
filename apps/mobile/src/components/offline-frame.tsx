import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, type ReactNode } from 'react'
import { View } from 'react-native'
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context'

import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { useSharedCopy } from '@/lib/i18n'
import { useOffline } from '@/lib/network'

/**
 * Every screen under one line when the phone has no network: «Немає
 * з’єднання», above the screen's own header. The screens keep showing what
 * they last read, each with its own time, and a figure whose refresh failed
 * says so where it stands («Оновлення не вдалося · показано останнє
 * прочитане»), so the line never claims a read a screen does not have. The line
 * takes the status bar's room, so the screens below it start under it; the
 * tree under it never changes shape, so nothing on screen is lost when the
 * network goes or comes back. When it comes back, what is on screen is read
 * again.
 */
export function OfflineFrame({ children }: { children: ReactNode }) {
  const offline = useOffline()
  const insets = useSafeAreaInsets()
  const shared = useSharedCopy()
  const queryClient = useQueryClient()

  const wasOffline = useRef(offline)
  useEffect(() => {
    if (wasOffline.current && !offline) void queryClient.refetchQueries({ type: 'active' })
    wasOffline.current = offline
  }, [offline, queryClient])

  return (
    <View className="flex-1 bg-ground">
      {offline ? (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="flex-row items-center gap-2 border-b border-line bg-surface px-4 pb-2"
          style={{ paddingTop: insets.top + 8 }}
        >
          <Icon name="cloud-offline-outline" size={16} color="warningInk" />
          <Txt variant="ui" tone="muted" numberOfLines={1} className="flex-1">
            {shared.offline}
          </Txt>
        </View>
      ) : null}
      <SafeAreaInsetsContext.Provider value={offline ? { ...insets, top: 0 } : insets}>
        {children}
      </SafeAreaInsetsContext.Provider>
    </View>
  )
}
