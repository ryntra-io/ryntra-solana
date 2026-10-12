import '../global.css'

import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { useEffect } from 'react'

import { OfflineFrame } from '@/components/offline-frame'
import { NotificationsBinder } from '@/features/notifications/notifications-binder'
import { AppProviders } from '@/features/wallet/app-providers'
import { applyStoredThemeMode, useTheme } from '@/theme'

// The stored theme is applied before the first frame so the app never flashes the other one.
applyStoredThemeMode()

export default function RootLayout() {
  return (
    <AppProviders>
      <NotificationsBinder />
      <OfflineFrame>
        <RootStack />
      </OfflineFrame>
    </AppProviders>
  )
}

function RootStack() {
  const { colors, isDark } = useTheme()

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.ground).catch(() => undefined)
  }, [colors.ground])

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground }, animation: 'fade' }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="asset/[mint]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="search" options={{ animation: 'fade' }} />
        <Stack.Screen name="changes" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="trade" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ryn" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="history" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="receipts" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="rewards" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="bots/index" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="money/index" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="token/[mint]" options={{ animation: 'fade' }} />
        <Stack.Screen name="money/send" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="money/receive" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="launch/index" options={{ animation: 'fade' }} />
        <Stack.Screen name="launch/markets" options={{ animation: 'fade' }} />
        <Stack.Screen name="launch/mine" options={{ animation: 'fade' }} />
        <Stack.Screen name="launch/[mint]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="plans/index" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="plans/pick" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="plans/new" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="plans/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="monitoring/index" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="monitoring/preferences" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="monitoring/open" options={{ animation: 'fade' }} />
        <Stack.Screen name="gallery" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
    </>
  )
}
