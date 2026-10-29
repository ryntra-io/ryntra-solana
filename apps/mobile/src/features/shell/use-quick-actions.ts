import * as QuickActions from 'expo-quick-actions'
import { useQuickActionRouting } from 'expo-quick-actions/router'
import { useCallback, useEffect, useRef } from 'react'

import { useLocale } from '@/lib/i18n'

import { useOpenPlace } from './open-place'
import { onPlacesFree, placesHeld } from './place-hold'
import { quickActions } from './quick-actions'

/**
 * The launcher's quick actions, in the app's language — set again when the
 * language changes — and a press on one opens its place (M9). Lives in the
 * tabs' layout: a press while the app is closed lands after the shell is up.
 * A place of the bar (Ринки, Портфель) opens through the bar's own opener, never
 * a second bar over the screen in front, and while money is moving it waits for
 * the operation to let go (`place-hold.ts`); Search and the assistant open over
 * whatever stands in front.
 */
export function useQuickActions() {
  const locale = useLocale()
  const openPlace = useOpenPlace()
  // The router helper reads the launch's own action again whenever its handler changes: one handler for the app's
  // life, opening through the opener of the moment.
  const opener = useRef(openPlace)
  const waiting = useRef<string | null>(null)
  useEffect(() => {
    opener.current = openPlace
  }, [openPlace])
  useEffect(
    () =>
      onPlacesFree(() => {
        const href = waiting.current
        waiting.current = null
        if (href) opener.current(href)
      }),
    [],
  )
  const handle = useCallback((action: QuickActions.Action) => {
    const href = action.params?.href
    if (typeof href !== 'string' || !href.startsWith('/(tabs)')) return false
    if (placesHeld()) waiting.current = href
    else setTimeout(() => opener.current(href))
    return true
  }, [])
  useQuickActionRouting(handle)
  useEffect(() => {
    QuickActions.setItems(quickActions(locale).map((action) => ({ ...action, params: { ...action.params } }))).catch(
      () => undefined,
    )
  }, [locale])
}
