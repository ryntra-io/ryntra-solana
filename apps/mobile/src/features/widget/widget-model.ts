/**
 * The home-screen widget as values — pure (M9). The widget shows what Home's
 * portfolio card shows, smaller: the wallet's value, the day's move, the time
 * of the read; a wallet not connected says so, and a press opens Ryntra on
 * Portfolio. Amounts Home hides stay hidden here. Every figure carries its
 * time; a read that could not be refreshed is labelled, never shown as
 * fresh; unknown is a dash.
 */

import type { Copy, Locale } from '../../lib/i18n.ts'
import { DASH, formatMoment, formatPercent, formatUsd, formatUsdSigned, isToday, signOf } from '../../utils/format.ts'
import { HIDDEN_AMOUNT } from '../home/home-model.ts'
import type { PortfolioView } from '../portfolio/portfolio-model.ts'

/** The figures of one wallet's read, as the widget keeps them. */
export type WidgetFigures = Readonly<{
  owner: string
  observedAt: string
  /** Home's total: an empty wallet read whole is a known zero; null when nothing could be priced. */
  total: number | null
  dayUsd: number | null
  dayPct: number | null
  /** The read saw the whole wallet. */
  whole: boolean
}>

/** What the widget knows: the wallet connected in the app, its last figures, and a refresh that failed after them. */
export type WidgetState = Readonly<{
  wallet: string | null
  figures: WidgetFigures | null
  failedAt: string | null
}>

export const EMPTY_WIDGET: WidgetState = { wallet: null, figures: null, failedAt: null }

/** A read older than this is labelled as not updated, whatever the reason. */
export const WIDGET_STALE_MS = 60 * 60 * 1000

/** A read younger than this is not asked again when the launcher asks the widget to update. */
export const WIDGET_FRESH_MS = 5 * 60 * 1000

export function figuresOf(view: PortfolioView): WidgetFigures {
  return {
    owner: view.owner,
    observedAt: view.observedAt,
    total: view.empty ? 0 : view.total,
    dayUsd: view.dayChange?.usd ?? null,
    dayPct: view.dayChange?.pct ?? null,
    whole: view.coverage === 'COMPLETE',
  }
}

/** The widget's state read back from the device; anything unreadable is the empty state. */
export function parseWidgetState(raw: string | undefined | null): WidgetState {
  if (!raw) return EMPTY_WIDGET
  try {
    const value = JSON.parse(raw) as Partial<WidgetState>
    const wallet = typeof value.wallet === 'string' && value.wallet.length > 0 ? value.wallet : null
    const figures = value.figures
    const kept =
      figures &&
      typeof figures.owner === 'string' &&
      typeof figures.observedAt === 'string' &&
      !Number.isNaN(Date.parse(figures.observedAt))
        ? figures
        : null
    const failedAt = typeof value.failedAt === 'string' ? value.failedAt : null
    return { wallet, figures: kept, failedAt }
  } catch {
    return EMPTY_WIDGET
  }
}

/** Whether the launcher's update should ask the wallet again: a wallet is connected and its read is not a fresh one. */
export function wantsRead(state: WidgetState, now: number): boolean {
  if (!state.wallet) return false
  const figures = state.figures
  if (!figures || figures.owner !== state.wallet) return true
  return now - Date.parse(figures.observedAt) >= WIDGET_FRESH_MS
}

const WORDS: Copy<
  Readonly<{ title: string; today: string; notUpdated: string; partly: string; connect: string; open: string }>
> = {
  en: {
    title: 'Portfolio',
    today: 'today',
    notUpdated: 'not updated',
    partly: 'partly read',
    connect: 'Connect your wallet',
    open: 'Open Portfolio in Ryntra',
  },
  uk: {
    title: 'Портфель',
    today: 'за день',
    notUpdated: 'не оновлено',
    partly: 'не все прочитано',
    connect: 'Під’єднай гаманець',
    open: 'Відкрити Портфель у Ryntra',
  },
}

export type WidgetFace =
  | Readonly<{ kind: 'connect'; title: string; line: string; label: string }>
  | Readonly<{
      kind: 'value'
      title: string
      value: string
      /** The value is a figure (not a dash or hidden), drawn in the foreground colour. */
      known: boolean
      change: Readonly<{ text: string; move: 'up' | 'down' | 'flat' }> | null
      time: string
      /** One warning word beside the time: not updated, or read in part. */
      note: string | null
      label: string
    }>

/** What the widget draws, in the app's language, at `now`. */
export function widgetFace(
  state: WidgetState,
  options: Readonly<{ locale: Locale; now: number; hidden: boolean }>,
): WidgetFace {
  const { locale, now, hidden } = options
  const words = WORDS[locale]
  if (!state.wallet) return { kind: 'connect', title: words.title, line: words.connect, label: words.connect }
  const figures = state.figures && state.figures.owner === state.wallet ? state.figures : null
  if (!figures) {
    return {
      kind: 'value',
      title: words.title,
      value: hidden ? HIDDEN_AMOUNT : DASH,
      known: false,
      change: null,
      time: DASH,
      note: state.failedAt ? words.notUpdated : null,
      label: words.open,
    }
  }
  const observed = Date.parse(figures.observedAt)
  const failedLater = state.failedAt !== null && Date.parse(state.failedAt) > observed
  const note = failedLater || now - observed > WIDGET_STALE_MS ? words.notUpdated : figures.whole ? null : words.partly
  // A day's move belongs to its day: a read from an earlier day keeps its value and its time, not «today».
  const change =
    figures.dayUsd !== null && figures.dayPct !== null && isToday(figures.observedAt, now)
      ? {
          text: `${hidden ? '' : `${formatUsdSigned(figures.dayUsd, locale)} · `}${formatPercent(figures.dayPct, locale)} ${words.today}`,
          move: signOf(figures.dayUsd),
        }
      : null
  const value = hidden ? HIDDEN_AMOUNT : figures.total === null ? DASH : formatUsd(figures.total, locale)
  const time = formatMoment(figures.observedAt, now, locale)
  return {
    kind: 'value',
    title: words.title,
    value,
    known: !hidden && figures.total !== null,
    change,
    time,
    note,
    label: `${words.open}. ${hidden ? '' : `${value}, `}${time}${note ? `, ${note}` : ''}`,
  }
}
