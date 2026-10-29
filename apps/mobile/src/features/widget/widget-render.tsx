'use no memo'
// The widget library draws plain functions; the React Compiler's memoization breaks its tree (M9).

import Constants from 'expo-constants'
import { requestWidgetUpdate, type WidgetInfo, type WidgetRepresentation } from 'react-native-android-widget'

import { amountsHidden } from '@/features/home/last-look'
import { getLocale } from '@/lib/i18n'
import { getThemeMode } from '@/theme/theme-mode'

import { PORTFOLIO_WIDGET, PortfolioWidget } from './portfolio-widget'
import { widgetFace, type WidgetState } from './widget-model'
import { readWidgetState } from './widget-store'

/** Portfolio by the app's own scheme — `ryntra://`, or the development build's `ryntra-dev://` (M27). */
function portfolioUri(): string {
  const configured = Constants.expoConfig?.scheme
  const scheme = (Array.isArray(configured) ? configured[0] : configured) ?? 'ryntra'
  return `${scheme}:///(tabs)/portfolio`
}

/** A widget this tall or taller draws its value larger. */
const LARGE_HEIGHT_DP = 170
/** A widget lower than this keeps the value and its time; the day's move needs the room. */
const ROOMY_HEIGHT_DP = 140

/**
 * The widget as the app would draw it now: the app's language, its theme —
 * both themes when the app follows the system, so the launcher picks — and
 * Home's choice to hide amounts.
 */
export function portfolioWidgetFor(info: WidgetInfo | null, state: WidgetState): WidgetRepresentation {
  const face = widgetFace(state, { locale: getLocale(), now: Date.now(), hidden: amountsHidden() })
  const uri = portfolioUri()
  const large = info !== null && info.height >= LARGE_HEIGHT_DP
  const roomy = info === null || info.height <= 0 || info.height >= ROOMY_HEIGHT_DP
  const mode = getThemeMode()
  if (mode === 'system') {
    return {
      light: <PortfolioWidget face={face} theme="light" uri={uri} large={large} roomy={roomy} />,
      dark: <PortfolioWidget face={face} theme="dark" uri={uri} large={large} roomy={roomy} />,
    }
  }
  return <PortfolioWidget face={face} theme={mode} uri={uri} large={large} roomy={roomy} />
}

/** Draws every Portfolio widget on the home screen again from what the device knows. */
export function redrawPortfolioWidgets(state: WidgetState = readWidgetState()) {
  requestWidgetUpdate({
    widgetName: PORTFOLIO_WIDGET,
    renderWidget: (info) => portfolioWidgetFor(info, state),
  }).catch(() => undefined)
}
