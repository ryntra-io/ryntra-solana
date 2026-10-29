import '../global.css'

import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { useEffect } from 'react'

import { CITY_GROUND } from '@/features/city/city-look'
import { CityProviders } from '@/features/city/city-providers'

// The launch screen stays until the city's own picture is on screen (`screens/city`), so nothing flashes between them.
SplashScreen.preventAutoHideAsync().catch(() => undefined)
SplashScreen.setOptions({ fade: true, duration: 350 })

/**
 * The app is the city and nothing else (decision 75): one route, `index` — Ryntra City on ryntra.io, full screen.
 * Every link the app is opened with lands there (`+native-intent`); an address it does not know does too (`+not-found`).
 */
export default function RootLayout() {
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(CITY_GROUND).catch(() => undefined)
  }, [])
  return (
    <CityProviders>
      <StatusBar style="light" />
      <Stack
        screenOptions={{ headerShown: false, animation: 'none', contentStyle: { backgroundColor: CITY_GROUND } }}
      />
    </CityProviders>
  )
}
