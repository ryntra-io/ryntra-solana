import * as QuickActions from 'expo-quick-actions'
import { useQuickActionRouting } from 'expo-quick-actions/router'
import { useEffect } from 'react'

import { useLocale } from '@/lib/i18n'

import { quickActions } from './quick-actions'

/**
 * The launcher's quick actions, in the app's language — set again when the
 * language changes — and a press on one opens its place (M9). Lives in the
 * tabs' layout: a press while the app is closed lands after the shell is up.
 */
export function useQuickActions() {
  const locale = useLocale()
  useQuickActionRouting()
  useEffect(() => {
    QuickActions.setItems(quickActions(locale).map((action) => ({ ...action, params: { ...action.params } }))).catch(
      () => undefined,
    )
  }, [locale])
}
