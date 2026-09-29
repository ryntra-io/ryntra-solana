/**
 * A plan's market rules as values — pure. A rule is the contract's
 * `EvidenceCondition`: a metric the evidence layer reads, a window, a
 * comparison and a figure, advisory (the Review names it) or required (the
 * Review refuses the version when it is not met or cannot be judged). The
 * metric's own words and unit come from the deployment's registry
 * (`capabilities.research.metrics`); a rule arrives carried from Ryntra's draft
 * or from a link as `metric:window:operator:threshold`, parsed here exactly
 * as the web builder parses it. Nothing here reads the network or judges a
 * rule — the Review does, on the reads it makes.
 */

import type { EvidenceCondition, EvidenceMetricDefinition, EvidenceMetricId } from '../../lib/api.ts'
import type { Locale } from '../../lib/i18n.ts'

const CARRIED = /^([a-z0-9_]{1,64}):(24h|7d|now):(gt|gte|lt|lte):(-?\d{1,15}(?:\.\d{1,6})?)$/

/** What the Review does with a rule it cannot judge follows its mode: a required rule blocks, an advisory one warns. */
export function onUnknownOf(mode: EvidenceCondition['mode']): EvidenceCondition['onUnknown'] {
  return mode === 'required' ? 'block' : 'warn'
}

/**
 * A rule carried in a link, as the web builder reads it: advisory until the
 * person says otherwise, the figure kept to two significant digits from a
 * hundred up (the figure at the press, not a promise of precision). Null for
 * anything that is not one.
 */
export function conditionFromParam(raw: string | null | undefined): EvidenceCondition | null {
  if (typeof raw !== 'string') return null
  const match = CARRIED.exec(raw)
  if (!match) return null
  const figure = Number(match[4])
  if (!Number.isFinite(figure)) return null
  const magnitude = Math.abs(figure)
  const step = magnitude >= 100 ? 10 ** (Math.floor(Math.log10(magnitude)) - 1) : 1
  const rounded = Math.floor(magnitude / step) * step
  return {
    metric: match[1] as EvidenceMetricId,
    window: match[2] as EvidenceCondition['window'],
    operator: match[3] as EvidenceCondition['operator'],
    threshold: figure < 0 ? -rounded : rounded,
    mode: 'advisory',
    onUnknown: 'warn',
  }
}

/** A rule's place on a plan: one rule per metric and window. */
export function conditionKey(condition: Pick<EvidenceCondition, 'metric' | 'window'>): string {
  return `${condition.metric}:${condition.window}`
}

/** One rule per metric and window on a plan: a carried rule replaces the plan's own on the same pair. */
export function withCondition(
  conditions: readonly EvidenceCondition[],
  carried: EvidenceCondition,
): readonly EvidenceCondition[] {
  const same = (condition: EvidenceCondition) =>
    condition.metric === carried.metric && condition.window === carried.window
  return [...conditions.filter((condition) => !same(condition)), carried]
}

export function metricOf(
  metrics: readonly EvidenceMetricDefinition[] | null | undefined,
  id: string,
): EvidenceMetricDefinition | null {
  return metrics?.find((metric) => metric.id === id) ?? null
}

/** The metric in the reader's words, or its id when the registry has not answered. */
export function metricLabel(metric: EvidenceMetricDefinition | null, id: string, locale: Locale): string {
  return metric ? metric.words[locale].label : id.replace(/_/g, ' ')
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** A rule's figure in its unit: dollars compact, a share as a percent, a count whole, an authority as present or renounced. */
export function thresholdText(
  metric: EvidenceMetricDefinition | null,
  threshold: number,
  flags: Readonly<{ present: string; renounced: string }>,
): string {
  switch (metric?.unit) {
    case 'usd':
      return `${threshold < 0 ? '−' : ''}$${compact.format(Math.abs(threshold))}`
    case 'percent':
      return `${threshold}%`
    case 'count':
    case 'wallets':
      return whole.format(threshold)
    case 'flag':
      return threshold >= 1 ? flags.present : flags.renounced
    default:
      return String(threshold)
  }
}
