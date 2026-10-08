import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import { useAmountsHidden } from '@/features/home/last-look'
import { portfolioView } from '@/features/portfolio/portfolio-model'
import { useAccount } from '@/features/session/use-account'
import type { HoldingsResponse } from '@/lib/api'
import { getLocale, useLocale } from '@/lib/i18n'
import { useTheme } from '@/theme'

import { figuresOf } from './widget-model'
import { redrawPortfolioWidgets } from './widget-render'
import { setWidgetFigures, setWidgetWallet } from './widget-store'

/**
 * Keeps the home-screen widget in step with the app (M9): the wallet
 * connected — or none — and the app's language, theme and hidden amounts,
 * drawn again each time the app leaves the screen. The figures themselves
 * come from Portfolio's own read (`usePortfolio`).
 */
export function WidgetBinder() {
  const account = useAccount()
  const address = account.address
  const locale = useLocale()
  const hidden = useAmountsHidden()
  const { name: theme } = useTheme()
  const queryClient = useQueryClient()

  // The address the app last saw: «no wallet» is written only when a connected wallet goes, never for the
  // moment at start before the wallet is restored.
  const seen = useRef<string | null>(null)
  useEffect(() => {
    const before = seen.current
    seen.current = address
    if (address === null && before === null) return
    let changed = setWidgetWallet(address)
    // The wallet's read may already be in the cache — Portfolio's, or the one kept on the device: the widget takes it now.
    const read = address ? queryClient.getQueryData<HoldingsResponse>(['trade', 'holdings', address]) : undefined
    const view = read && read.data.tokenRead !== 'UNAVAILABLE' ? portfolioView(read.data, getLocale()) : null
    // Never a read still waiting for its prices: the widget keeps its last priced figures.
    if (view?.pricesRead) changed = setWidgetFigures(figuresOf(view)) ?? changed
    if (changed) redrawPortfolioWidgets(changed)
  }, [address, queryClient])

  useEffect(() => {
    redrawPortfolioWidgets()
  }, [locale, hidden, theme])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') redrawPortfolioWidgets()
    })
    return () => subscription.remove()
  }, [])

  return null
}
