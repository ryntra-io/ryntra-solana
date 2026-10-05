import type { WidgetTaskHandler } from 'react-native-android-widget'

import { portfolioView } from '@/features/portfolio/portfolio-model'
import { fetchHoldings } from '@/lib/api'

import { figuresOf, wantsRead } from './widget-model'
import { portfolioWidgetFor } from './widget-render'
import { readWidgetState, setWidgetFailed, setWidgetFigures } from './widget-store'

/**
 * The widget's own task, run by the launcher while the app may be closed:
 * when the widget is placed, resized, or its half-hour comes round. It draws
 * what the device knows at once; then, when the connected wallet's read is
 * not a fresh one, reads the wallet's positions by its address — the same
 * public read Portfolio makes, no session, no signature — and draws again. A
 * read that fails leaves the last figures, labelled «не оновлено».
 */
export const portfolioWidgetTask: WidgetTaskHandler = async ({ widgetInfo, widgetAction, renderWidget }) => {
  if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return
  let state = readWidgetState()
  renderWidget(portfolioWidgetFor(widgetInfo, state))
  const wallet = state.wallet
  if (!wallet || !wantsRead(state, Date.now())) return
  try {
    const read = await fetchHoldings(wallet)
    // As Portfolio holds back a read that could not see the token accounts, so does the widget: the earlier figures stay, labelled.
    const held = read.data.tokenRead === 'UNAVAILABLE' && state.figures?.owner === wallet
    state =
      (held
        ? setWidgetFailed(new Date().toISOString(), wallet)
        : setWidgetFigures(figuresOf(portfolioView(read.data)))) ?? readWidgetState()
  } catch {
    state = setWidgetFailed(new Date().toISOString(), wallet) ?? readWidgetState()
  }
  renderWidget(portfolioWidgetFor(widgetInfo, state))
}
