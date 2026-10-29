/**
 * Plans with Ryntra (AI-11, 1.61.0) as values — pure. The plan is the server's: Ryntra writes it on the person's word,
 * the plan engine sizes it and counts the fees, the critic argues with it. This module only turns the person's fields
 * into a request (figures parsed in the person's language, the loss limit or the budget required, at most three
 * targets), says which of the person's words the plan allows now, groups the critic's findings and names a refusal.
 * Nothing here reads the network, and nothing here signs, trades or approves a spend: a plan's trade lives only in the
 * person's own Trading Plan, behind its Review and the wallet's signature.
 */

import { ApiError } from '../../lib/api.ts'
import type {
  AssistantPlan,
  AssistantPlanBody,
  AssistantPlanCreate,
  AssistantPlanFinding,
  AssistantPlanState,
  AssistantPlanUpdate,
} from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/i18n.ts'

/** A Solana mint as the contract takes it (base58, 32–44 characters). */
export const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** A plan's id from a link or a note, read loosely: the server answers «no such plan» for anything else. */
export function isPlanId(raw: string | null | undefined): raw is string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{3,80}$/.test(raw)
}

/** The contract's bound on any dollar figure of a plan. */
const USD_MAX = 1_000_000_000
const IDEA_MAX = 600
const REASON_MAX = 240

/** A field of the plan a person names, as the words say it. */
export type PlanField = 'entry' | 'maxPrice' | 'invalidation' | 'targets' | 'risk' | 'budget' | 'thesis' | 'horizon'

/**
 * A figure as the person typed it: nothing, not a figure, or a positive amount. A comma by the person's language: in
 * Ukrainian it is the decimal («0,125», «212,50»); in English «1,000» is a thousand and «212.50» the decimal.
 */
export function parseFigure(text: string, locale: Locale): number | 'empty' | 'bad' {
  const compact = text.replace(/\s/g, '')
  if (compact === '') return 'empty'
  const normal =
    locale === 'uk'
      ? compact.replace(',', '.')
      : /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(compact)
        ? compact.replace(/,/g, '')
        : compact
  if (!/^\d*\.?\d+$|^\d+\.$/.test(normal)) return 'bad'
  const value = Number(normal)
  return Number.isFinite(value) && value > 0 && value <= USD_MAX ? value : 'bad'
}

/** Targets apart by a space or a semicolon (a comma is a decimal in Ukrainian): at most three, each a figure. */
export function parseTargets(text: string, locale: Locale): readonly number[] | 'bad' | 'tooMany' {
  const parts = text
    .split(/[;\s]+/)
    .map((part) => (locale === 'uk' ? part : part.replace(/,$/, '')))
    .filter((part) => part !== '')
  const values: number[] = []
  for (const part of parts) {
    const value = parseFigure(part, locale)
    if (typeof value !== 'number') return 'bad'
    values.push(value)
  }
  return values.length > 3 ? 'tooMany' : values
}

/** A figure written back into a field in the person's language — «212,5» in Ukrainian. */
export function figureText(value: number, locale: Locale): string {
  const text = String(value)
  return locale === 'uk' ? text.replace('.', ',') : text
}

/** What the composer still needs before its press — one at a time, in the order the form asks. */
export type ComposeNeed =
  | Readonly<{ kind: 'token' }>
  | Readonly<{ kind: 'idea' }>
  | Readonly<{ kind: 'figure'; field: PlanField }>
  | Readonly<{ kind: 'money' }>
  | Readonly<{ kind: 'targets' }>
  | Readonly<{ kind: 'days' }>
  | Readonly<{ kind: 'price' }>

export type ComposeForm = Readonly<{
  mint: string | null
  idea: string
  risk: string
  budget: string
  entry: string
  maxPrice: string
  invalidation: string
  targets: string
  days: string
}>

export const EMPTY_COMPOSE: ComposeForm = {
  mint: null,
  idea: '',
  risk: '',
  budget: '',
  entry: '',
  maxPrice: '',
  invalidation: '',
  targets: '',
  days: '',
}

/**
 * The person's fields as `POST /api/v1/assistant/plans` takes them, or what is missing: the token, the idea, the loss
 * limit or the budget (money is never the model's), every typed figure a figure, the price read. `acceptCredits` is
 * exactly the price shown — 0 included, when the plan is free.
 */
export function composeRequest(
  form: ComposeForm,
  locale: Locale,
  price: number | null,
): Readonly<{ ok: true; request: AssistantPlanCreate }> | Readonly<{ ok: false; need: ComposeNeed }> {
  if (!form.mint || !MINT.test(form.mint)) return { ok: false, need: { kind: 'token' } }
  const idea = form.idea.trim()
  if (idea === '') return { ok: false, need: { kind: 'idea' } }
  const figures: Partial<Record<PlanField, number | null>> = {}
  const singles: readonly (readonly [PlanField, string])[] = [
    ['risk', form.risk],
    ['budget', form.budget],
    ['entry', form.entry],
    ['maxPrice', form.maxPrice],
    ['invalidation', form.invalidation],
  ]
  for (const [field, text] of singles) {
    const value = parseFigure(text, locale)
    if (value === 'bad') return { ok: false, need: { kind: 'figure', field } }
    figures[field] = value === 'empty' ? null : value
  }
  if (figures.risk == null && figures.budget == null) return { ok: false, need: { kind: 'money' } }
  const targets = parseTargets(form.targets, locale)
  if (targets === 'bad') return { ok: false, need: { kind: 'figure', field: 'targets' } }
  if (targets === 'tooMany') return { ok: false, need: { kind: 'targets' } }
  let horizonDays: number | null = null
  if (form.days.trim() !== '') {
    const days = Number(form.days.trim())
    if (!Number.isInteger(days) || days < 1 || days > 365) return { ok: false, need: { kind: 'days' } }
    horizonDays = days
  }
  if (price === null || !Number.isInteger(price) || price < 0) return { ok: false, need: { kind: 'price' } }
  return {
    ok: true,
    request: {
      mint: form.mint,
      idea: idea.slice(0, IDEA_MAX),
      riskUsd: figures.risk ?? null,
      budgetUsd: figures.budget ?? null,
      entryUsd: figures.entry ?? null,
      maxPriceUsd: figures.maxPrice ?? null,
      invalidationUsd: figures.invalidation ?? null,
      targetsUsd: targets,
      horizonDays,
      acceptCredits: price,
      locale,
    },
  }
}

/* ---- the person's change: a new version ---- */

export type EditForm = Readonly<{
  thesis: string
  entry: string
  maxPrice: string
  invalidation: string
  targets: string
  risk: string
  budget: string
  reason: string
}>

/** The plan's current figures, written into the change's fields. */
export function editFormOf(body: AssistantPlanBody, locale: Locale): EditForm {
  return {
    thesis: body.thesis.text,
    entry: figureText(body.entry.priceUsd, locale),
    maxPrice: figureText(body.entry.maxPriceUsd, locale),
    invalidation: figureText(body.invalidation.priceUsd, locale),
    targets: body.targets.map((row) => figureText(row.priceUsd, locale)).join(' '),
    risk: figureText(body.lossLimit.riskUsd, locale),
    budget: figureText(body.lossLimit.budgetUsd, locale),
    reason: '',
  }
}

/**
 * The change as `PUT /api/v1/assistant/plans/{id}` takes it — only what differs from the version read, with
 * `ifVersion` that version; an emptied field keeps its figure. `same` when nothing differs.
 */
export function editRequest(
  body: AssistantPlanBody,
  version: number,
  form: EditForm,
  locale: Locale,
):
  | Readonly<{ kind: 'change'; request: AssistantPlanUpdate }>
  | Readonly<{ kind: 'same' }>
  | Readonly<{ kind: 'need'; need: ComposeNeed }> {
  const change: { -readonly [K in keyof AssistantPlanUpdate]: AssistantPlanUpdate[K] } = { ifVersion: version }
  const thesis = form.thesis.trim()
  if (thesis !== '' && thesis !== body.thesis.text.trim()) change.thesis = thesis.slice(0, IDEA_MAX)
  const singles: readonly (readonly [
    PlanField,
    string,
    number,
    'entryUsd' | 'maxPriceUsd' | 'invalidationUsd' | 'riskUsd' | 'budgetUsd',
  ])[] = [
    ['entry', form.entry, body.entry.priceUsd, 'entryUsd'],
    ['maxPrice', form.maxPrice, body.entry.maxPriceUsd, 'maxPriceUsd'],
    ['invalidation', form.invalidation, body.invalidation.priceUsd, 'invalidationUsd'],
    ['risk', form.risk, body.lossLimit.riskUsd, 'riskUsd'],
    ['budget', form.budget, body.lossLimit.budgetUsd, 'budgetUsd'],
  ]
  for (const [field, text, current, key] of singles) {
    const value = parseFigure(text, locale)
    if (value === 'bad') return { kind: 'need', need: { kind: 'figure', field } }
    if (typeof value === 'number' && value !== current) change[key] = value
  }
  const targets = parseTargets(form.targets, locale)
  if (targets === 'bad') return { kind: 'need', need: { kind: 'figure', field: 'targets' } }
  if (targets === 'tooMany') return { kind: 'need', need: { kind: 'targets' } }
  if (targets.length > 0 && targets.join() !== body.targets.map((row) => row.priceUsd).join())
    change.targetsUsd = targets
  if (Object.keys(change).length === 1) return { kind: 'same' }
  const reason = form.reason.trim()
  change.reason = reason === '' ? null : reason.slice(0, REASON_MAX)
  change.locale = locale
  return { kind: 'change', request: change }
}

/* ---- the plan as the page draws it ---- */

const ENDED: ReadonlySet<AssistantPlanState> = new Set(['done', 'cancelled', 'broken'])

export function isEnded(state: AssistantPlanState): boolean {
  return ENDED.has(state)
}

/** The tone of a plan's state chip: approved is the person's own plan, watched is live, broken is the idea proven wrong. */
export function stateTone(state: AssistantPlanState): 'neutral' | 'brand' | 'success' | 'danger' | 'evidence' {
  switch (state) {
    case 'checked':
      return 'evidence'
    case 'approved':
      return 'brand'
    case 'watching':
      return 'success'
    case 'broken':
      return 'danger'
    default:
      return 'neutral'
  }
}

/** Why an ended plan ended, in one line — or nothing while it stands. */
export function endLineOf(plan: Pick<AssistantPlan, 'state' | 'stateReason'>): 'broken' | 'done' | 'expired' | null {
  if (plan.state === 'broken') return 'broken'
  if (plan.state === 'done') return 'done'
  if (plan.state === 'cancelled' && plan.stateReason === 'expired') return 'expired'
  return null
}

export type PlanButton = 'approveWatch' | 'watch' | 'approve' | 'edit' | 'recheck' | 'cancel'

/**
 * The person's words the plan allows now, in the page's order — the first is the one action drawn orange. Only what
 * `plan.actions` allows; «Перевірити ще раз» only with a price above nothing; an ended plan has none.
 */
export function planButtons(
  plan: Pick<AssistantPlan, 'state' | 'actions'>,
  prices: Readonly<{ recheck: number }> | null,
): readonly PlanButton[] {
  if (isEnded(plan.state)) return []
  const buttons: PlanButton[] = []
  if (plan.actions.watch) buttons.push(plan.state === 'approved' ? 'watch' : 'approveWatch')
  if (plan.actions.approve) buttons.push('approve')
  if (plan.actions.edit) buttons.push('edit')
  if (plan.actions.recheck && prices !== null && prices.recheck > 0) buttons.push('recheck')
  if (plan.actions.cancel) buttons.push('cancel')
  return buttons
}

export type FindingGroups = Readonly<{
  major: readonly AssistantPlanFinding[]
  minor: readonly AssistantPlanFinding[]
  note: readonly AssistantPlanFinding[]
}>

/** The critic's findings as the page groups them: «Серйозне», «Виправити», «Знати» — each in the server's order. */
export function findingGroups(findings: readonly AssistantPlanFinding[]): FindingGroups {
  return {
    major: findings.filter((row) => row.severity === 'major'),
    minor: findings.filter((row) => row.severity === 'minor'),
    note: findings.filter((row) => row.severity === 'note'),
  }
}

/** The wallet's plans with this token's first (newest first in each), and the rest. */
export function plansByToken(
  plans: readonly AssistantPlan[],
  mint: string | null,
): Readonly<{ here: readonly AssistantPlan[]; other: readonly AssistantPlan[] }> {
  const newest = [...plans].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  if (!mint) return { here: [], other: newest }
  return { here: newest.filter((plan) => plan.mint === mint), other: newest.filter((plan) => plan.mint !== mint) }
}

/* ---- a refusal, in one line ---- */

export type PlanFailure =
  | Readonly<{
      kind:
        | 'priceChanged'
        | 'short'
        | 'dayCap'
        | 'busy'
        | 'conflict'
        | 'refused'
        | 'limit'
        | 'notFound'
        | 'signIn'
        | 'network'
        | 'failed'
    }>
  | Readonly<{ kind: 'invalid'; fields: readonly PlanField[] }>

/** An issue's path onto the field a person can change — `entry.maxPriceUsd` is the max price, `stopLoss` the invalidation. */
export function fieldOfIssue(path: string): PlanField | null {
  const p = path.toLowerCase()
  if (/max/.test(p) && /price|entry/.test(p)) return 'maxPrice'
  if (/invalidation|stop/.test(p)) return 'invalidation'
  if (/target|takeprofit|take_profit/.test(p)) return 'targets'
  if (/entry|limit/.test(p)) return 'entry'
  if (/risk|loss/.test(p)) return 'risk'
  if (/budget|capital|notional/.test(p)) return 'budget'
  if (/thesis|idea/.test(p)) return 'thesis'
  if (/horizon|days|valid/.test(p)) return 'horizon'
  return null
}

function issueFields(details: Readonly<Record<string, unknown>>): readonly PlanField[] {
  const issues = Array.isArray(details.issues) ? (details.issues as unknown[]) : []
  const fields: PlanField[] = []
  for (const issue of issues) {
    const path = issue && typeof issue === 'object' ? (issue as { path?: unknown }).path : null
    const text = Array.isArray(path) ? path.join('.') : typeof path === 'string' ? path : ''
    const field = fieldOfIssue(text)
    if (field && !fields.includes(field)) fields.push(field)
  }
  return fields
}

/**
 * A refusal of the plans' routes in the app's words. A credits refusal reaches the plans as `AGENT_BUDGET_EXHAUSTED`
 * with the ledger's reason: a price above the one shown, the balance short, the day's limit — told apart by the
 * ledger's own code where it travels and by its reason where it does not.
 */
export function planFailureOf(error: unknown): PlanFailure {
  if (!(error instanceof ApiError)) return { kind: 'network' }
  const code = error.code
  const reason = error.message ?? ''
  switch (code) {
    case 'PRICE_NOT_SHOWN':
      return { kind: 'priceChanged' }
    case 'CREDITS_EXHAUSTED':
      return { kind: 'short' }
    case 'CREDITS_LIMIT':
    case 'CREDITS_DAY_CAP':
      return { kind: 'dayCap' }
    case 'AGENT_BUDGET_EXHAUSTED':
      if (/price is now|no price was shown/i.test(reason)) return { kind: 'priceChanged' }
      if (/day.?s limit|daily/i.test(reason)) return { kind: 'dayCap' }
      return { kind: 'short' }
    case 'AGENT_BUSY':
    case 'CREDITS_BUSY':
      return { kind: 'busy' }
    case 'PLAN_INVALID':
      return { kind: 'invalid', fields: issueFields(error.details) }
    case 'VALIDATION_ERROR':
      return { kind: 'invalid', fields: [] }
    case 'ASSISTANT_PLAN_NOT_FOUND':
      return { kind: 'notFound' }
    case 'ASSISTANT_PLAN_STATE_REFUSED':
      return /open plans/i.test(reason) ? { kind: 'limit' } : { kind: 'refused' }
    case 'UNAUTHORIZED':
    case 'SESSION_EXPIRED':
    case 'SESSION_REVOKED':
      return { kind: 'signIn' }
    default:
      if (/VERSION/.test(code) || error.status === 409) return { kind: 'conflict' }
      if (error.status === 404) return { kind: 'notFound' }
      if (error.status === 401) return { kind: 'signIn' }
      return { kind: 'failed' }
  }
}

/** Whether a refusal means the plan moved under the person: the page reads it again and says so. */
export function isConflict(failure: PlanFailure): boolean {
  return failure.kind === 'conflict'
}
