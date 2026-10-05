import { createMMKV } from 'react-native-mmkv'

import { parseWidgetState, type WidgetFigures, type WidgetState } from './widget-model'

/**
 * What the home-screen widget knows, on the device: the wallet connected in
 * the app, that wallet's last figures, a refresh that failed after them. The
 * app writes it as it reads; the widget's own task reads it, and writes its
 * own refresh, while the app is closed.
 */
const storage = createMMKV({ id: 'ryntra.widget' })
const KEY = 'state'

export function readWidgetState(): WidgetState {
  return parseWidgetState(storage.getString(KEY))
}

function write(state: WidgetState) {
  storage.set(KEY, JSON.stringify(state))
}

/**
 * The wallet connected in the app. Figures are kept with the wallet they
 * belong to and shown only for it; another wallet's are dropped when it
 * connects, and none at all forgets them. Returns the new state, or null
 * when nothing changed.
 */
export function setWidgetWallet(wallet: string | null): WidgetState | null {
  const current = readWidgetState()
  if (current.wallet === wallet) return null
  const figures = wallet !== null && current.figures?.owner === wallet ? current.figures : null
  const next: WidgetState = { wallet, figures, failedAt: null }
  write(next)
  return next
}

/** A read of the connected wallet, kept unless an equal or newer read is already there. Null when nothing changed. */
export function setWidgetFigures(figures: WidgetFigures): WidgetState | null {
  const current = readWidgetState()
  if (current.wallet !== figures.owner) return null
  const kept = current.figures
  if (kept && kept.owner === figures.owner && Date.parse(kept.observedAt) > Date.parse(figures.observedAt)) {
    return null
  }
  // A read that could price nothing never replaces a priced one: the priced figures stay, labelled «не оновлено».
  if (kept && kept.owner === figures.owner && kept.total !== null && figures.total === null) {
    return setWidgetFailed(figures.observedAt, figures.owner)
  }
  const same =
    kept !== null &&
    kept.owner === figures.owner &&
    kept.observedAt === figures.observedAt &&
    kept.total === figures.total &&
    kept.dayUsd === figures.dayUsd &&
    kept.dayPct === figures.dayPct &&
    kept.whole === figures.whole
  // The same read again says nothing new: a refresh that failed since stays labelled.
  if (same) return null
  const next: WidgetState = { ...current, figures, failedAt: null }
  write(next)
  return next
}

/**
 * A refresh of this wallet that failed — the widget's own, or the app's: the
 * last figures stay, labelled. Another wallet connected since is left alone.
 * Null when nothing changed.
 */
export function setWidgetFailed(at: string, wallet: string): WidgetState | null {
  const current = readWidgetState()
  if (current.wallet !== wallet || current.failedAt === at) return null
  const next: WidgetState = { ...current, failedAt: at }
  write(next)
  return next
}
