/**
 * Trading plans as values — pure. The draft a person writes on the phone
 * and the rules it becomes (the server's own schema, refused by name before
 * a request leaves), the starting price a plan begins from and where it
 * came from, the deterministic size the contract documents (a preview until
 * the server's own figure returns with the saved plan), what the market is
 * doing against the plan's bounds right now, and which monitoring card
 * belongs to which plan. Nothing here reads the network or signs anything;
 * the Review judges at signing and nothing here is a verdict.
 */

import type {
  AgentDraftCard,
  EvidenceCondition,
  MarketDetail,
  MonitoringCard,
  MonitoringSurface,
  PlanAsset,
  PlanAssetKind,
  PlanAssetRead,
  PlanCheck,
  PlanReview,
  PlanRules,
  PlanSizing,
  PlanStatus,
  StockAsset,
  TradingPlan,
  UnitBasis,
} from '../../lib/api.ts'
import { isSupportedIssuer } from '../../lib/stocks.ts'
import { withCondition } from './evidence-model.ts'

/* ---- units ---- */

/** The unit every per-unit price of a plan is in (1.4.0); absent means a share. */
export function unitBasisOf(asset: PlanAsset): UnitBasis {
  return asset.unitBasis === 'token' ? 'token' : 'share'
}

/** What the asset is (1.7.0): a stock when the field is absent — every plan written before tokens. */
export function assetKindOf(asset: PlanAsset): PlanAssetKind {
  return asset.kind ?? 'stock'
}

/**
 * Whose token a stock plan stands on, as its lines name it. A plan written on
 * the token of an issuer Ryntra no longer supports stays the
 * record it is — only its issuer is said as no longer supported.
 */
export function planIssuerLabel(asset: PlanAsset, retired: string): string {
  return assetKindOf(asset) === 'stock' && !isSupportedIssuer(asset.issuer.id) ? retired : asset.issuer.label
}

export function stockUnitBasis(stock: StockAsset): UnitBasis {
  return stock.row.representation.instrument?.unitBasis === 'token' ? 'token' : 'share'
}

/* ---- the starting price ---- */

export type StartingPriceSource = 'reference' | 'token-per-share' | 'token-price'
export type StartingPrice = Readonly<{ perUnit: number; source: StartingPriceSource }>

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Where a new plan's entry starts: the issuer's reference per share when
 * there is one, else the token's own market price through the multiplier,
 * else nothing — a token price labelled as a share price would be a false
 * figure. A token-priced instrument starts from the token's price: the plan
 * is per token and no share is implied. Money is never prefilled.
 */
export function startingPrice(stock: StockAsset): StartingPrice | null {
  const row = stock.row
  if (stockUnitBasis(stock) === 'token') {
    return positive(row.market.priceUsd) ? { perUnit: row.market.priceUsd, source: 'token-price' } : null
  }
  if (positive(row.reference.perShare)) return { perUnit: row.reference.perShare, source: 'reference' }
  if (positive(row.tokenPerShareUsd)) return { perUnit: row.tokenPerShareUsd, source: 'token-per-share' }
  return null
}

/**
 * Where a plan on a token starts (1.7.0): the planning price the server read
 * for this mint, with its source — an indication beside the person's own
 * entry, never the executable quote. Null when the server had none: the
 * person enters the figure.
 */
export function startingPriceOfRead(read: PlanAssetRead): StartingPrice | null {
  const price = read.planningPrice
  if (!price || !positive(price.perUnit)) return null
  const source: StartingPriceSource =
    price.source === 'issuer-reference'
      ? 'reference'
      : price.source === 'jupiter-per-share'
        ? 'token-per-share'
        : 'token-price'
  return { perUnit: price.perUnit, source }
}

/* ---- the draft ---- */

/** The bound the builder offers above the starting price: two per cent, a protective default. */
export const MAX_PRICE_OVER_ENTRY = 1.02
/** How long a new entry rule stays valid unless the person chooses otherwise. */
export const ENTRY_VALID_DAYS = 30
export const VALIDITY_PRESETS = [7, 14, 30, 90] as const

export type HorizonUnit = 'none' | 'days' | 'weeks' | 'months'

/** Every field as the person typed it; the rules are made from it and refused by name. */
export type PlanDraft = Readonly<{
  thesis: string
  whyNow: string
  horizonUnit: HorizonUnit
  horizonValue: string
  entryPrice: string
  maxPrice: string
  maxPriceOn: boolean
  /** ISO, or empty for no expiry. */
  validUntil: string
  budget: string
  reserve: string
  invalidation: string
  plannedRisk: string
  costBufferPct: string
  target: string
  /** ISO, or empty. */
  timeExit: string
  maxSlippagePct: string
  maxQuoteAge: string
  maxDeviationPct: string
  deviationOn: boolean
  referenceRequired: boolean
  minLiquidity: string
  reason: string
  /** The version's market rules, kept whole across a new version; a rule Ryntra drafted joins them. */
  conditions: readonly EvidenceCondition[]
}>

/**
 * A price as text for an input: two places from a hundred up, four from one,
 * six below — and below a cent (a meme's per-token price) four significant
 * digits, so a figure is never written as a zero. Trailing zeros gone.
 */
export function priceText(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (value > 0 && value < 0.01) {
    const places = Math.min(18, 3 - Math.floor(Math.log10(value)))
    return value.toFixed(places).replace(/\.?0+$/, '')
  }
  const places = value >= 100 ? 2 : value >= 1 ? 4 : 6
  return value.toFixed(places).replace(/\.?0+$/, '')
}

export function moneyText(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2).replace(/\.?0+$/, '') : ''
}

/** The draft's figure fields, shown in the person's own shape — «236,12» in Ukrainian; `parseDecimal` reads either mark. */
const FIGURE_FIELDS = [
  'entryPrice',
  'maxPrice',
  'budget',
  'reserve',
  'invalidation',
  'plannedRisk',
  'costBufferPct',
  'target',
  'maxSlippagePct',
  'maxDeviationPct',
  'minLiquidity',
] as const

export function draftInLocale(draft: PlanDraft, locale: 'en' | 'uk'): PlanDraft {
  if (locale !== 'uk') return draft
  const shaped: Record<string, string> = {}
  for (const field of FIGURE_FIELDS) {
    const value = draft[field]
    if (typeof value === 'string' && /^-?\d+\.\d+$/.test(value)) shaped[field] = value.replace('.', ',')
  }
  return { ...draft, ...shaped }
}

/** A new plan from the asset's own figures: the entry at the price the desk knows, the bound two per cent above it, thirty days, the execution defaults. */
export function draftFromStock(stock: StockAsset, now: number): PlanDraft {
  const start = startingPrice(stock)
  const hasReference = positive(stock.row.reference.perShare) && stockUnitBasis(stock) === 'share'
  return {
    thesis: '',
    whyNow: '',
    horizonUnit: 'none',
    horizonValue: '',
    entryPrice: start ? priceText(start.perUnit) : '',
    maxPrice: start ? priceText(start.perUnit * MAX_PRICE_OVER_ENTRY) : '',
    maxPriceOn: true,
    validUntil: new Date(now + ENTRY_VALID_DAYS * 86_400_000).toISOString(),
    budget: '',
    reserve: '',
    invalidation: '',
    plannedRisk: '',
    costBufferPct: '1',
    target: '',
    timeExit: '',
    maxSlippagePct: '0.5',
    maxQuoteAge: '60',
    maxDeviationPct: '1.5',
    deviationOn: hasReference,
    referenceRequired: hasReference,
    minLiquidity: '',
    reason: '',
    conditions: [],
  }
}

/**
 * A new plan on a token (1.7.0) from the server's read of the mint: the entry
 * at the planning price when there is one, the bound two per cent above it,
 * thirty days, the execution defaults. A token plan has no reference, so no
 * deviation bound and no required reference exist on it.
 */
export function draftFromRead(read: PlanAssetRead, now: number): PlanDraft {
  const start = startingPriceOfRead(read)
  return {
    thesis: '',
    whyNow: '',
    horizonUnit: 'none',
    horizonValue: '',
    entryPrice: start ? priceText(start.perUnit) : '',
    maxPrice: start ? priceText(start.perUnit * MAX_PRICE_OVER_ENTRY) : '',
    maxPriceOn: true,
    validUntil: new Date(now + ENTRY_VALID_DAYS * 86_400_000).toISOString(),
    budget: '',
    reserve: '',
    invalidation: '',
    plannedRisk: '',
    costBufferPct: '1',
    target: '',
    timeExit: '',
    maxSlippagePct: '0.5',
    maxQuoteAge: '60',
    maxDeviationPct: '',
    deviationOn: false,
    referenceRequired: false,
    minLiquidity: '',
    reason: '',
    conditions: [],
  }
}

/**
 * Ryntra's draft laid over the builder's own start, as the web builder lays it:
 * a plan draft brings its rules (the thesis stays the person's to write) and
 * every figure it established — the entry, the bound, the invalidation, the
 * target, the risk and the budget the person named, the validity; a market
 * rule draft joins the version's own rules. Every field stays editable and
 * nothing is saved here.
 */
export function withAgentDraft(base: PlanDraft, card: AgentDraftCard): PlanDraft {
  if (card.kind === 'monitoringDraft') return { ...base, conditions: withCondition(base.conditions, card.condition) }
  if (card.kind !== 'planDraft') return base
  const from = card.rules
    ? { ...draftFromRules(card.rules), thesis: card.rules.thesis.text.trim() === '—' ? '' : card.rules.thesis.text }
    : base
  const prefill = card.prefill
  const price = (value: number | null, fallback: string) => (value !== null && value > 0 ? priceText(value) : fallback)
  const money = (value: number | null, fallback: string) => (value !== null && value > 0 ? moneyText(value) : fallback)
  return {
    ...from,
    entryPrice: price(prefill.entryUsd, from.entryPrice),
    maxPrice: price(prefill.maxPriceUsd, from.maxPrice),
    maxPriceOn: prefill.maxPriceUsd !== null || from.maxPriceOn,
    invalidation: price(prefill.invalidationUsd, from.invalidation),
    target: price(prefill.targetUsd, from.target),
    plannedRisk: money(prefill.riskUsd, from.plannedRisk),
    budget: money(prefill.budgetUsd, from.budget),
    validUntil: prefill.validUntil ?? from.validUntil,
    // A token plan never carries the reference rules, whatever the start said.
    deviationOn: card.asset.unitBasis === 'token' ? false : from.deviationOn,
    referenceRequired: card.asset.unitBasis === 'token' ? false : from.referenceRequired,
  }
}

/** An existing version back into a draft, for a new version. */
export function draftFromRules(rules: PlanRules): PlanDraft {
  return {
    thesis: rules.thesis.text,
    whyNow: rules.thesis.whyNow ?? '',
    horizonUnit: rules.thesis.horizon?.unit ?? 'none',
    horizonValue: rules.thesis.horizon ? String(rules.thesis.horizon.value) : '',
    entryPrice: priceText(rules.entry.pricePerShare),
    maxPrice: rules.entry.maxPricePerShare === null ? '' : priceText(rules.entry.maxPricePerShare),
    maxPriceOn: rules.entry.maxPricePerShare !== null,
    validUntil: rules.entry.validUntil ?? '',
    budget: moneyText(rules.capital.budgetUsd),
    reserve: rules.capital.reserveForCostsUsd === 0 ? '' : moneyText(rules.capital.reserveForCostsUsd),
    invalidation: priceText(rules.risk.invalidationPerShare),
    plannedRisk: moneyText(rules.risk.plannedRiskUsd),
    costBufferPct: String(rules.risk.costBufferBps / 100),
    target: rules.exit.targetPerShare === null ? '' : priceText(rules.exit.targetPerShare),
    timeExit: rules.exit.timeExitAt ?? '',
    maxSlippagePct: String(rules.execution.maxSlippageBps / 100),
    maxQuoteAge: String(rules.execution.maxQuoteAgeSeconds),
    maxDeviationPct:
      rules.execution.maxReferenceDeviationPct === null ? '' : String(rules.execution.maxReferenceDeviationPct),
    deviationOn: rules.execution.maxReferenceDeviationPct !== null,
    referenceRequired: rules.execution.referenceRequired,
    minLiquidity: rules.execution.minLiquidityUsd === null ? '' : moneyText(rules.execution.minLiquidityUsd),
    reason: '',
    // A new version keeps the version's market rules — a phone that cannot edit a rule never drops one.
    conditions: rules.evidenceConditions,
  }
}

/* ---- the rules ---- */

/** A typed figure — digits, one separator, spaces ignored — as a number; null for anything else. */
export function parseDecimal(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(cleaned) && !/^\.\d+$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

export type DraftField = keyof PlanDraft
export type DraftNeed =
  'thesis' | 'number' | 'positive' | 'range' | 'belowEntry' | 'aboveEntry' | 'belowBudget' | 'date'
export type DraftIssue = Readonly<{ field: DraftField; need: DraftNeed }>

const blank = (text: string) => text.trim().length === 0
const validIso = (text: string) => Number.isFinite(Date.parse(text))

/**
 * The draft as the server's rules, or the fields the schema itself would
 * refuse, each named by what it needs — a person corrects a field, never
 * reads a validator's path. The pairs the size depends on are checked
 * here too: an invalidation must sit under the entry, a reserve under
 * the budget.
 */
export function rulesOf(
  draft: PlanDraft,
): Readonly<{ ok: true; rules: PlanRules }> | Readonly<{ ok: false; issues: readonly DraftIssue[] }> {
  const issues: DraftIssue[] = []
  const need = (field: DraftField, what: DraftNeed) => issues.push({ field, need: what })
  const money = (field: DraftField, text: string, min = 0): number => {
    const value = parseDecimal(text)
    if (value === null) {
      need(field, 'number')
      return Number.NaN
    }
    if (value <= min) need(field, 'positive')
    return value
  }
  const optionalMoney = (field: DraftField, text: string): number | null => (blank(text) ? null : money(field, text))

  const thesis = draft.thesis.trim()
  if (thesis.length === 0 || thesis.length > 2000) need('thesis', 'thesis')
  if (draft.whyNow.trim().length > 500) need('whyNow', 'range')
  let horizon: PlanRules['thesis']['horizon'] = null
  if (draft.horizonUnit !== 'none') {
    const value = parseDecimal(draft.horizonValue)
    if (value === null || !Number.isInteger(value) || value < 1 || value > 60) need('horizonValue', 'range')
    else horizon = { unit: draft.horizonUnit, value }
  }

  const entry = money('entryPrice', draft.entryPrice)
  const maxPrice = draft.maxPriceOn ? money('maxPrice', draft.maxPrice) : null
  if (maxPrice !== null && Number.isFinite(maxPrice) && Number.isFinite(entry) && maxPrice < entry)
    need('maxPrice', 'aboveEntry')
  if (!blank(draft.validUntil) && !validIso(draft.validUntil)) need('validUntil', 'date')

  const budget = money('budget', draft.budget)
  const reserve = blank(draft.reserve) ? 0 : money('reserve', draft.reserve, -1)
  if (Number.isFinite(reserve) && Number.isFinite(budget) && reserve >= budget) need('reserve', 'belowBudget')

  const invalidation = money('invalidation', draft.invalidation)
  if (Number.isFinite(invalidation) && Number.isFinite(entry) && invalidation >= entry)
    need('invalidation', 'belowEntry')
  const plannedRisk = money('plannedRisk', draft.plannedRisk)
  if (Number.isFinite(plannedRisk) && Number.isFinite(budget) && plannedRisk > budget)
    need('plannedRisk', 'belowBudget')
  const costBufferPct = parseDecimal(draft.costBufferPct)
  if (costBufferPct === null || costBufferPct < 0 || costBufferPct > 20) need('costBufferPct', 'range')

  const target = optionalMoney('target', draft.target)
  if (target !== null && Number.isFinite(target) && Number.isFinite(entry) && target <= entry)
    need('target', 'aboveEntry')
  if (!blank(draft.timeExit) && !validIso(draft.timeExit)) need('timeExit', 'date')

  const slippage = parseDecimal(draft.maxSlippagePct)
  if (slippage === null || slippage < 0.01 || slippage > 20) need('maxSlippagePct', 'range')
  const quoteAge = parseDecimal(draft.maxQuoteAge)
  if (quoteAge === null || !Number.isInteger(quoteAge) || quoteAge < 5 || quoteAge > 600) need('maxQuoteAge', 'range')
  let deviation: number | null = null
  if (draft.deviationOn) {
    deviation = parseDecimal(draft.maxDeviationPct)
    if (deviation === null || deviation < 0 || deviation > 100) need('maxDeviationPct', 'range')
  }
  const minLiquidity = optionalMoney('minLiquidity', draft.minLiquidity)

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    rules: {
      thesis: { text: thesis, whyNow: draft.whyNow.trim() || null, horizon, sources: [], assumptions: [] },
      entry: {
        pricePerShare: entry,
        maxPricePerShare: maxPrice,
        validUntil: blank(draft.validUntil) ? null : draft.validUntil,
      },
      capital: { budgetUsd: budget, reserveForCostsUsd: reserve },
      risk: {
        invalidationPerShare: invalidation,
        plannedRiskUsd: plannedRisk,
        costBufferBps: Math.round(costBufferPct! * 100),
      },
      exit: {
        targetPerShare: target,
        timeExitAt: blank(draft.timeExit) ? null : draft.timeExit,
        invalidationIsOrder: false,
      },
      execution: {
        maxSlippageBps: Math.round(slippage! * 100),
        maxQuoteAgeSeconds: Math.round(quoteAge!),
        maxReferenceDeviationPct: deviation,
        referenceRequired: draft.referenceRequired,
        minLiquidityUsd: minLiquidity,
      },
      evidenceConditions: [...draft.conditions],
    },
  }
}

/* ---- the size ---- */

/**
 * The deterministic size the contract documents (§9.4), computed here only
 * as a preview while the person writes — the saved plan carries the
 * server's own figure, which is the one every screen shows afterwards.
 *
 *   lossPerShare        = entry − invalidation + entry × costBufferBps / 10 000
 *   riskLimitedUnits    = plannedRiskUsd / lossPerShare
 *   capitalLimitedUnits = (budgetUsd − reserveForCostsUsd) / entry
 *   units               = min(riskLimitedUnits, capitalLimitedUnits)
 *   notionalUsd         = units × entry
 */
export function sizingPreview(rules: PlanRules): PlanSizing | null {
  const entry = rules.entry.pricePerShare
  const lossPerShareUsd = entry - rules.risk.invalidationPerShare + (entry * rules.risk.costBufferBps) / 10_000
  const spendable = rules.capital.budgetUsd - rules.capital.reserveForCostsUsd
  if (!(lossPerShareUsd > 0) || !(spendable > 0) || !(entry > 0)) return null
  // Units are truncated to six places and the notional to cents, as the server truncates them.
  const riskLimitedUnits = truncate(rules.risk.plannedRiskUsd / lossPerShareUsd, 6)
  const capitalLimitedUnits = truncate(spendable / entry, 6)
  const units = Math.min(riskLimitedUnits, capitalLimitedUnits)
  if (!(units > 0)) return null
  return {
    model: 'spot-long-v1',
    lossPerShareUsd: Math.round(lossPerShareUsd * 1e6) / 1e6,
    riskLimitedUnits,
    capitalLimitedUnits,
    units,
    notionalUsd: truncate(units * entry, 2),
    limitedBy: riskLimitedUnits <= capitalLimitedUnits ? 'risk' : 'capital',
    assumptions: [],
  }
}

function truncate(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.floor(value * factor + 1e-9) / factor
}

/* ---- the plan as a screen reads it ---- */

export type PlanGroups = Readonly<{
  active: readonly TradingPlan[]
  drafts: readonly TradingPlan[]
  closed: readonly TradingPlan[]
}>

/** Active plans first (newest first), then drafts, then the closed ones. */
export function groupPlans(plans: readonly TradingPlan[]): PlanGroups {
  const byUpdated = (a: TradingPlan, b: TradingPlan) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  const sorted = [...plans].sort(byUpdated)
  return {
    active: sorted.filter((plan) => plan.status === 'active'),
    drafts: sorted.filter((plan) => plan.status === 'draft'),
    closed: sorted.filter((plan) => plan.status !== 'active' && plan.status !== 'draft'),
  }
}

/** An active plan whose entry rule has run out: the Review refuses it until a new version. */
export function entryExpired(plan: TradingPlan, now: number): boolean {
  const until = plan.current.rules.entry.validUntil
  return plan.status === 'active' && until !== null && Date.parse(until) <= now
}

export type PlanStatusTone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning' | 'evidence'

export function statusTone(status: PlanStatus): PlanStatusTone {
  switch (status) {
    case 'active':
      return 'success'
    case 'draft':
      return 'evidence'
    case 'executed':
      return 'brand'
    case 'expired':
      return 'warning'
    default:
      return 'neutral'
  }
}

/** The actions a plan's state really offers; nothing else is drawn. */
export function planActions(
  plan: TradingPlan,
): Readonly<{ review: boolean; edit: boolean; activate: boolean; cancel: boolean }> {
  return {
    review: plan.status === 'active',
    edit: plan.status === 'active' || plan.status === 'draft',
    activate: plan.status === 'draft',
    cancel: plan.status === 'active' || plan.status === 'draft',
  }
}

/* ---- the market against the plan's bounds ---- */

export type BoundState = 'within' | 'above' | 'noBound' | 'unknown'
export type InvalidationState = 'above' | 'below' | 'unknown'

export type MarketNow = Readonly<{
  unitBasis: UnitBasis
  /** The price the plan's unit trades at now — the token price per share through the multiplier, or the token's own price. */
  pricePerUnit: number | null
  at: string | null
  stale: boolean
  reference: number | null
  referenceState: string | null
  deviationPct: number | null
  vsMax: BoundState
  vsInvalidation: InvalidationState
  /** Deviation against the version's bound: within, above, no bound, unknown. */
  vsDeviation: BoundState
}>

const STALE_AFTER_MS = 5 * 60_000

/**
 * What the market is doing against the version being read — an orientation,
 * never a verdict: the price of the person's own order may differ, and the
 * Review decides at signing. A listed share is read through the issuer's
 * reference and the token's per-share price; a token-priced instrument
 * through the token's own price.
 */
export function marketNow(
  plan: TradingPlan,
  stock: StockAsset | null,
  market: MarketDetail | null,
  now: number,
  /** When the venue's read of a token plan's market was made (the Spot route's `observedAt`). */
  marketAt: string | null = null,
): MarketNow {
  const unitBasis = unitBasisOf(plan.asset)
  const rules = plan.current.rules
  const row = stock?.row ?? null
  const perUnit =
    unitBasis === 'token' ? (row?.market.priceUsd ?? market?.price ?? null) : (row?.tokenPerShareUsd ?? null)
  const at = row?.market.observedAt ?? stock?.fetchedAt ?? (market ? (marketAt ?? market.updatedAt) : null)
  const stale = at !== null && now - Date.parse(at) > STALE_AFTER_MS
  const reference = unitBasis === 'share' ? (row?.reference.perShare ?? null) : null
  const deviationPct = unitBasis === 'share' ? (row?.deviationPct ?? null) : null
  const price = positive(perUnit) ? perUnit : null
  const bound = rules.entry.maxPricePerShare
  const vsMax: BoundState =
    bound === null ? 'noBound' : price === null ? 'unknown' : price <= bound ? 'within' : 'above'
  const vsInvalidation: InvalidationState =
    price === null ? 'unknown' : price < rules.risk.invalidationPerShare ? 'below' : 'above'
  const deviationBound = rules.execution.maxReferenceDeviationPct
  const vsDeviation: BoundState =
    deviationBound === null
      ? 'noBound'
      : deviationPct === null
        ? 'unknown'
        : Math.abs(deviationPct) <= deviationBound
          ? 'within'
          : 'above'
  return {
    unitBasis,
    pricePerUnit: price,
    at,
    stale,
    reference: positive(reference) ? reference : null,
    referenceState: row?.reference.state ?? null,
    deviationPct,
    vsMax,
    vsInvalidation,
    vsDeviation,
  }
}

/* ---- monitoring ---- */

/** The monitoring card that speaks of this plan: the surface names plans by their asset symbol, attention before watching. */
export function attentionCard(plan: TradingPlan, surface: MonitoringSurface | null): MonitoringCard | null {
  // The surface names a plan only by its symbol (request 16); only an active plan is watched, so a
  // draft or a closed plan on the same stock never wears the other plan's card.
  if (!surface || plan.status !== 'active') return null
  const mine = (card: MonitoringCard) => !card.paper && card.label === plan.asset.symbol
  return surface.attention.find(mine) ?? surface.watching.find(mine) ?? null
}

/** The symbols the surface says need attention — for the list's chips. */
export function attentionSymbols(surface: MonitoringSurface | null): ReadonlySet<string> {
  return new Set((surface?.attention ?? []).filter((card) => !card.paper).map((card) => card.label))
}

/** The plans an attention card may mean: the active ones on its symbol. */
export function plansForCard(card: MonitoringCard, plans: readonly TradingPlan[]): TradingPlan[] {
  return plans.filter((plan) => plan.asset.symbol === card.label && plan.status === 'active')
}

/** The symbols more than one active plan wears — a card on such a symbol cannot be attributed to one plan (request 22). */
export function sharedSymbols(plans: readonly TradingPlan[]): ReadonlySet<string> {
  const counts = new Map<string, number>()
  for (const plan of plans) {
    if (plan.status !== 'active') continue
    counts.set(plan.asset.symbol, (counts.get(plan.asset.symbol) ?? 0) + 1)
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([symbol]) => symbol))
}

/* ---- the Strategy block ---- */

export type StrategyBlockView = Readonly<{
  verdict: PlanReview['verdict']
  failed: readonly PlanCheck[]
  unknown: readonly PlanCheck[]
  passed: number
  fitUsd: number | null
  modelledLossUsd: number | null
  perUnitUsd: number | null
  unit: 'underlying' | 'token'
}>

/** The Review's judgement of the plan on this exact order, as the sheet draws it: what failed, what could not be known, how many held. */
export function strategyBlock(review: PlanReview): StrategyBlockView {
  return {
    verdict: review.verdict,
    failed: review.checks.filter((check) => check.outcome === 'fail'),
    unknown: review.checks.filter((check) => check.outcome === 'unknown'),
    passed: review.checks.filter((check) => check.outcome === 'pass').length,
    fitUsd: review.quote.fitUsd,
    modelledLossUsd: review.quote.modelledLossUsd,
    perUnitUsd: review.quote.perShareUsd,
    unit: review.quote.unit,
  }
}
