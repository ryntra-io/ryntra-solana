/**
 * The person's side of «Прогнози» as values — pure (M12, PM-S1 on the web). Three answers of the Predictions line's
 * routes, each needing the wallet's session (the same bearer as `/api/v1`):
 *
 *   account  (`GET /api/predictions/account`) — the simulation's account: whether the wallet is linked to AGG, the
 *            simulated balance and positions, Ryntra's own order records;
 *   funding  (`GET /api/predictions/funding`) — the live money: the deposit address on Solana, the balance AGG holds,
 *            deposits and Ryntra's withdrawal records; while live money is off (`enabled: false`) only that, and no
 *            address;
 *   review   (`POST /api/predictions/quote`) — one simulated order priced and checked by the server.
 *
 * AGG holds the balance in a managed wallet (Portal), not the person's wallet; AGG signs every trade and withdrawal —
 * the phone never signs one. The phone signs only the link's message, as a sign-in. Every figure is read again here:
 * a field that is missing is no figure (a dash), never a zero.
 */

import { isPredictionId } from './predictions-model.ts'

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

const nonNegative = (value: unknown): number | null => {
  const parsed = finite(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

const probability = (value: unknown): number | null => {
  const parsed = finite(value)
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed : null
}

const isoOrNull = (value: unknown): string | null => {
  const raw = text(value)
  return raw !== null && !Number.isNaN(Date.parse(raw)) ? raw : null
}

const readAtOf = (body: Json, fallback: number): number => {
  const raw = text(body.readAt)
  const time = raw === null ? Number.NaN : Date.parse(raw)
  return Number.isFinite(time) && time > 0 ? time : fallback
}

/** A Solana address as the routes write one; anything else is no address. */
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const addressOf = (value: unknown): string | null => {
  const raw = text(value)
  return raw !== null && SOLANA_ADDRESS.test(raw) ? raw : null
}

/* ------------------------------------------------------------------------------------------------- the account */

export type LinkState = 'none' | 'active' | 'expired' | 'revoked'

export type PredictionLink = Readonly<{
  state: LinkState
  /** false when the server cannot link anyone now (no store, AGG refuses the host). */
  available: boolean
}>

export type PaperBalance = Readonly<{
  cashUsd: number | null
  positionsUsd: number | null
  /** Realised and unrealised together — what the simulation made or lost so far. */
  pnlUsd: number | null
}>

export type PaperPosition = Readonly<{
  /** The event to open; null when the provider did not say which of Ryntra's events it is. */
  eventId: string | null
  question: string
  label: string
  shares: number | null
  valueUsd: number | null
  pnlUsd: number | null
  price: number | null
  /** true once resolved in this outcome's favour, false against it; null while open. */
  won: boolean | null
}>

export type OrderState = 'reviewed' | 'submitted' | 'filled' | 'partially_filled' | 'failed' | 'expired' | 'cancelled'

export type PaperOrder = Readonly<{
  quoteId: string
  eventId: string
  title: string
  question: string
  label: string
  side: 'buy' | 'sell'
  state: OrderState
  /** Dollars asked to spend on a buy; null on a sell. */
  spendUsd: number | null
  createdAt: string | null
}>

export type PredictionAccount = Readonly<{
  wallet: string
  link: PredictionLink
  balance: PaperBalance | null
  positions: readonly PaperPosition[]
  /** Orders the person placed, newest first; a Review that was never placed is not among them. */
  orders: readonly PaperOrder[]
  /** The provider could not be read: the balance and positions are not known now (the records still are). */
  providerDown: boolean
  /** The provider's own word that this person may not trade from where they are; null when it was not read. */
  locationBlocked: boolean | null
  readAt: number
}>

const LINK_STATES: readonly LinkState[] = ['none', 'active', 'expired', 'revoked']

export function linkOf(raw: unknown): PredictionLink {
  const body = isObject(raw) ? raw : {}
  const state = LINK_STATES.includes(body.state as LinkState) ? (body.state as LinkState) : 'none'
  return { state, available: body.available !== false }
}

const ORDER_STATES: readonly OrderState[] = [
  'reviewed',
  'submitted',
  'filled',
  'partially_filled',
  'failed',
  'expired',
  'cancelled',
]

export const orderStateOf = (value: unknown): OrderState =>
  ORDER_STATES.includes(value as OrderState) ? (value as OrderState) : 'failed'

/** A state that will not change by itself: the order is done one way or another. */
export const orderSettled = (state: OrderState): boolean => state !== 'reviewed' && state !== 'submitted'

function positionsOf(raw: unknown): PaperPosition[] {
  if (!Array.isArray(raw)) return []
  const out: PaperPosition[] = []
  for (const entry of raw) {
    if (!isObject(entry)) continue
    const question = text(entry.question)
    if (question === null || !Array.isArray(entry.outcomes)) continue
    const eventId = isPredictionId(entry.eventId) ? entry.eventId : null
    for (const outcome of entry.outcomes) {
      if (!isObject(outcome)) continue
      const label = text(outcome.label)
      const shares = nonNegative(outcome.totalSize)
      if (label === null || shares === 0) continue
      out.push({
        eventId,
        question,
        label,
        shares,
        valueUsd: nonNegative(outcome.totalValue),
        pnlUsd: finite(outcome.unrealizedPnl),
        price: probability(outcome.currentPrice),
        won: typeof outcome.winner === 'boolean' ? outcome.winner : null,
      })
    }
  }
  return out
}

export function orderOf(entry: unknown): PaperOrder | null {
  if (!isObject(entry)) return null
  const quoteId = text(entry.quoteId)
  const eventId = isPredictionId(entry.eventId) ? entry.eventId : null
  const title = text(entry.eventTitle)
  const question = text(entry.question)
  const label = text(entry.outcomeLabel)
  if (quoteId === null || eventId === null || title === null || question === null || label === null) return null
  const side = entry.side === 'sell' ? 'sell' : 'buy'
  return {
    quoteId,
    eventId,
    title,
    question,
    label,
    side,
    state: orderStateOf(entry.state),
    spendUsd: side === 'buy' ? nonNegative(entry.requested) : null,
    createdAt: isoOrNull(entry.submittedAt) ?? isoOrNull(entry.createdAt),
  }
}

export function parseAccount(raw: unknown, now: number = Date.now()): PredictionAccount | null {
  const body = isObject(raw) ? raw : {}
  const wallet = addressOf(body.wallet)
  if (wallet === null) return null
  const balanceRaw = isObject(body.balance) ? body.balance : null
  const realized = balanceRaw ? finite(balanceRaw.realizedPnl) : null
  const unrealized = balanceRaw ? finite(balanceRaw.unrealizedPnl) : null
  const orders: PaperOrder[] = []
  for (const entry of Array.isArray(body.orders) ? body.orders : []) {
    const order = orderOf(entry)
    if (order !== null && order.state !== 'reviewed') orders.push(order)
  }
  const access = isObject(body.access) ? body.access : null
  return {
    wallet,
    link: linkOf(body.link),
    balance: balanceRaw
      ? {
          cashUsd: finite(balanceRaw.cashBalance),
          positionsUsd: nonNegative(balanceRaw.positionsValue),
          pnlUsd: realized !== null && unrealized !== null ? realized + unrealized : null,
        }
      : null,
    positions: positionsOf(body.positions),
    orders,
    providerDown: isObject(body.providerFailure),
    locationBlocked: access && typeof access.locationBlocked === 'boolean' ? access.locationBlocked : null,
    readAt: readAtOf(body, now),
  }
}

/* ------------------------------------------------------------------------------------------------- the money */

export type DepositTarget =
  | Readonly<{ state: 'ready'; address: string; symbol: string; mint: string }>
  | Readonly<{ state: 'preparing' | 'unsupported' | 'off' | 'failed' }>

/** A deposit as the provider listed it: on its way, credited, or a status the server does not know — never credited. */
export type DepositRow = Readonly<{
  id: string
  amount: number | null
  symbol: string
  state: 'pending' | 'credited' | 'unknown'
  at: string | null
}>

export type WithdrawalPhase = 'sending' | 'in_flight' | 'completed' | 'partial' | 'failed' | 'unknown' | 'refused'

export type Withdrawal = Readonly<{
  requestId: string
  phase: WithdrawalPhase
  amountUsd: number | null
  receiveUsd: number | null
  feeUsd: number | null
  completedUsd: number | null
  /** The newest of the transfer's signatures, to open in an explorer; null before one exists. */
  signature: string | null
  /** Unknown past the window in which the server asks again on its own: look at the AGG account or ask support. */
  aged: boolean
  /** AGG names another destination than the person's Solana wallet: never «being checked» — support first. */
  mismatch: boolean
  at: string | null
}>

export type PredictionFunding = Readonly<{
  /** Live money is switched on for this deployment; while off, nothing but this is read. */
  enabled: boolean
  /** Every withdrawal goes here: the wallet the person proved. */
  destination: string
  withdrawMinUsd: number | null
  /** A balance held on another network counts only from this much into Solana. */
  crossChainMinUsd: number | null
  feeUsd: number | null
  deposit: DepositTarget
  /** What AGG holds now; null when it was not read. */
  cashUsd: number | null
  availableUsd: number | null
  deposits: readonly DepositRow[]
  withdrawals: readonly Withdrawal[]
  providerDown: boolean
  readAt: number
}>

const DEPOSIT_STATES = ['preparing', 'unsupported', 'off', 'failed'] as const

function depositOf(raw: unknown): DepositTarget {
  if (!isObject(raw)) return { state: 'failed' }
  if (raw.state === 'ready') {
    const address = addressOf(raw.address)
    const token = isObject(raw.token) ? raw.token : {}
    // The token is USDC on Solana: an address is shown only with its mint, so a transfer from the wallet sends exactly it.
    const mint = addressOf(token.mint)
    return address === null || mint === null
      ? { state: 'failed' }
      : { state: 'ready', address, symbol: text(token.symbol) ?? 'USDC', mint }
  }
  const state = DEPOSIT_STATES.find((value) => value === raw.state)
  return { state: state ?? 'failed' }
}

const depositStateOf = (value: unknown): DepositRow['state'] =>
  value === 'credited' || value === 'pending' ? value : 'unknown'

const WITHDRAWAL_PHASES: readonly WithdrawalPhase[] = [
  'sending',
  'in_flight',
  'completed',
  'partial',
  'failed',
  'unknown',
  'refused',
]

export function withdrawalOf(entry: unknown): Withdrawal | null {
  if (!isObject(entry)) return null
  const requestId = text(entry.requestId)
  if (requestId === null) return null
  const phase = WITHDRAWAL_PHASES.includes(entry.phase as WithdrawalPhase)
    ? (entry.phase as WithdrawalPhase)
    : 'unknown'
  const hashes = Array.isArray(entry.txHashes) ? entry.txHashes.filter((hash) => typeof hash === 'string') : []
  return {
    requestId,
    phase,
    amountUsd: nonNegative(entry.amountUsd),
    receiveUsd: nonNegative(entry.reviewedReceiveUsd),
    feeUsd: nonNegative(entry.reviewedFeeUsd),
    completedUsd: nonNegative(entry.completedUsd),
    signature: (hashes.at(-1) as string | undefined) ?? null,
    aged: entry.aged === true,
    mismatch: entry.note === DESTINATION_MISMATCH,
    at: isoOrNull(entry.createdAt) ?? isoOrNull(entry.updatedAt),
  }
}

/** The server's note on a withdrawal AGG names another destination for. */
export const DESTINATION_MISMATCH = 'DESTINATION_MISMATCH'

/** A withdrawal whose state is not known yet and still asked about: a new one waits for it (the server's `holdsBack`). */
export const withdrawalHolds = (withdrawal: Withdrawal): boolean =>
  !withdrawal.aged && (withdrawal.phase === 'sending' || withdrawal.phase === 'unknown')

/**
 * A withdrawal still moving or not known yet — the list is read again sooner while one is, and only with live money on
 * (switched off, the server asks AGG nothing). Another destination is not waited on: it waits for support.
 */
export const withdrawalMoving = (withdrawal: Withdrawal, live: boolean): boolean =>
  live && !withdrawal.mismatch && (withdrawalHolds(withdrawal) || withdrawal.phase === 'in_flight')

/** Why the withdraw form is held: an earlier one still checked, or one AGG names another destination for. */
export function withdrawHold(withdrawals: readonly Withdrawal[]): 'mismatch' | 'open' | null {
  const holding = withdrawals.filter(withdrawalHolds)
  if (holding.length === 0) return null
  return holding.some((withdrawal) => withdrawal.mismatch) ? 'mismatch' : 'open'
}

/** Whether «Перевірити ще раз» can tell anything: live money on, its state unknown, not aged, not another destination. */
export const withdrawalCheckable = (withdrawal: Withdrawal, live: boolean): boolean =>
  live && withdrawalHolds(withdrawal) && !withdrawal.mismatch

/**
 * A withdrawal's figure as the web's list writes it: what arrived once it arrived («≈» the reviewed figure while AGG
 * has not said how much), what arrived of a partial one, and the sum asked for otherwise — never «arrives» for one that
 * did not.
 */
export function withdrawalFigure(
  withdrawal: Withdrawal,
): Readonly<{ usd: number | null; approx: boolean; arrived: boolean }> {
  if (withdrawal.phase === 'completed')
    return withdrawal.completedUsd !== null
      ? { usd: withdrawal.completedUsd, approx: false, arrived: true }
      : { usd: withdrawal.receiveUsd, approx: withdrawal.receiveUsd !== null, arrived: true }
  if (withdrawal.phase === 'partial') return { usd: withdrawal.completedUsd, approx: false, arrived: true }
  return { usd: withdrawal.amountUsd, approx: false, arrived: false }
}

export type WithdrawalNote = 'mismatch' | 'aged' | 'unknown' | 'unknownOff' | 'failed' | 'refused'

/** The one line under a withdrawal: what to do about it; none for one that is moving or arrived. */
export function withdrawalNote(withdrawal: Withdrawal, live: boolean): WithdrawalNote | null {
  if (withdrawal.phase === 'unknown' || withdrawal.phase === 'sending') {
    if (withdrawal.mismatch) return 'mismatch'
    if (withdrawal.aged) return 'aged'
    if (withdrawal.phase === 'unknown') return live ? 'unknown' : 'unknownOff'
    return null
  }
  if (withdrawal.phase === 'failed') return 'failed'
  if (withdrawal.phase === 'refused') return 'refused'
  return null
}

/** A preview is reviewed only when the server answered it for this very wallet and names it as the destination. */
export const previewForWallet = (
  answer: Readonly<{ destination: string | null; wallet: string | null }>,
  wallet: string,
): boolean => answer.destination === wallet && answer.wallet === wallet

/** The deposit as a Solana Pay request: the person's «Надіслати» then sends exactly USDC to the address, never SOL. */
export const depositRequest = (deposit: Readonly<{ address: string; mint: string }>): string =>
  `solana:${deposit.address}?spl-token=${deposit.mint}`

export function parseFunding(raw: unknown, now: number = Date.now()): PredictionFunding | null {
  const body = isObject(raw) ? raw : {}
  const destination = addressOf(body.destination) ?? addressOf(body.wallet)
  if (destination === null) return null
  const enabled = body.enabled === true
  const limits = isObject(body.limits) ? body.limits : {}
  const balance = isObject(body.balance) ? body.balance : null
  const deposits: DepositRow[] = []
  for (const entry of Array.isArray(body.deposits) ? body.deposits : []) {
    if (!isObject(entry)) continue
    const id = text(entry.id) ?? text(entry.txHash)
    if (id === null) continue
    deposits.push({
      id,
      amount: nonNegative(entry.amount),
      symbol: text(entry.symbol) ?? 'USDC',
      state: depositStateOf(entry.phase),
      at: isoOrNull(entry.at),
    })
  }
  const withdrawals: Withdrawal[] = []
  for (const entry of Array.isArray(body.withdrawals) ? body.withdrawals : []) {
    const withdrawal = withdrawalOf(entry)
    if (withdrawal !== null) withdrawals.push(withdrawal)
  }
  return {
    enabled,
    destination,
    withdrawMinUsd: nonNegative(limits.withdrawMinUsd),
    crossChainMinUsd: nonNegative(limits.crossChainMinUsd),
    feeUsd: nonNegative(limits.bridgeFeeUsd),
    deposit: enabled ? depositOf(body.deposit) : { state: 'off' },
    cashUsd: balance ? nonNegative(balance.cashUsd) : null,
    availableUsd: balance ? nonNegative(balance.availableUsd) : null,
    deposits,
    withdrawals,
    providerDown: isObject(body.providerFailure),
    readAt: readAtOf(body, now),
  }
}

/* -------------------------------------------------------------------------------------- a withdrawal's preview */

/** USDC has six decimals: the routes count withdrawals in its smallest unit, as a string of digits. */
export const USDC_DECIMALS = 6

const RAW = /^\d{1,18}$/

/** USDC's raw digits as dollars; null for anything that is not digits. */
export function usdOfRaw(raw: unknown): number | null {
  if (typeof raw !== 'string' || !RAW.test(raw)) return null
  return Number(raw) / 10 ** USDC_DECIMALS
}

export type WithdrawPreview = Readonly<{
  /** `unviable` — at this amount nothing would arrive, or the provider will not route it; `reason` says why. */
  status: 'quoted' | 'unviable'
  amountRaw: string
  receiveRaw: string | null
  feeRaw: string | null
  expiresAt: string | null
  /** The most that could arrive now (all of the balance); null when not said. */
  maxRaw: string | null
  /** Why it cannot be sent, in Ryntra's terms. */
  reason: WithdrawReason | null
}>

export type WithdrawReason =
  'below_minimum' | 'insufficient' | 'above_max' | 'fee_exceeds' | 'route_unavailable' | 'other'
const WITHDRAW_REASONS: readonly WithdrawReason[] = [
  'below_minimum',
  'insufficient',
  'above_max',
  'fee_exceeds',
  'route_unavailable',
  'other',
]

export function parsePreview(raw: unknown): WithdrawPreview | null {
  const body = isObject(raw) ? raw : {}
  const preview = isObject(body.preview) ? body.preview : null
  if (preview === null) return null
  const amountRaw = typeof preview.amountRaw === 'string' && RAW.test(preview.amountRaw) ? preview.amountRaw : null
  if (amountRaw === null) return null
  const digits = (value: unknown) => (typeof value === 'string' && RAW.test(value) ? value : null)
  const receiveRaw = digits(preview.receiveRaw)
  return {
    status: preview.status === 'quoted' && receiveRaw !== null && receiveRaw !== '0' ? 'quoted' : 'unviable',
    amountRaw,
    receiveRaw,
    feeRaw: digits(preview.feeRaw),
    expiresAt: isoOrNull(preview.expiresAt),
    maxRaw: digits(preview.maxDeliverableRaw),
    reason: WITHDRAW_REASONS.includes(preview.reason as WithdrawReason)
      ? (preview.reason as WithdrawReason)
      : preview.status === 'quoted'
        ? null
        : 'other',
  }
}

/** The withdraw route's answer: recorded (202) — the withdrawal to follow; repriced (200) — a new Review to confirm. */
export type WithdrawOutcome =
  | Readonly<{ outcome: 'recorded'; withdrawal: Withdrawal }>
  | Readonly<{ outcome: 'repriced'; preview: WithdrawPreview }>

export function parseWithdrawOutcome(raw: unknown): WithdrawOutcome | null {
  const body = isObject(raw) ? raw : {}
  if (body.outcome === 'repriced') {
    const preview = parsePreview(body)
    return preview ? { outcome: 'repriced', preview } : null
  }
  const withdrawal = withdrawalOf(body.withdrawal)
  return withdrawal ? { outcome: 'recorded', withdrawal } : null
}

/* ------------------------------------------------------------------------------------------------- the Review */

/**
 * One check of the Review that is not a plain pass. The server writes its own sentence in the person's language; a
 * warning the route names is a venue and a code («venue: low_liquidity») — kept as its code alone (`routeCode`), said
 * in the phone's words without the venue, once however many venues name it.
 */
export type ReviewCheck = Readonly<{ id: string; state: 'warn' | 'fail'; detail: string; routeCode: string | null }>

export type PaperReview = Readonly<{
  quoteId: string
  question: string
  label: string
  side: 'buy' | 'sell'
  probability: number | null
  shares: number | null
  /** What the order costs with every fee. */
  totalUsd: number | null
  feesUsd: number | null
  payoutUsd: number | null
  profitUsd: number | null
  maxLossUsd: number | null
  expiresAt: string | null
  /** Only the checks that are not a plain pass — those are what the person reads; each once. */
  checks: readonly ReviewCheck[]
  canPlace: boolean
}>

/**
 * A route warning's kind out of «venue: reason»: the provider's own code where it sends one (`low_liquidity`), else the
 * few free-text reasons it is known to send — the region, a venue account it needs — and `other` for the rest.
 */
export function routeCodeOf(detail: string): string {
  const reason = detail.replace(/^[^:]*:\s*/, '').trim()
  if (/region|location|country|geo|restricted|jurisdiction/i.test(reason)) return 'region'
  if (/^[a-z0-9_]+$/i.test(reason)) return reason.toLowerCase()
  if (/\b(venue key|api key|kyc|verification|account required|needs an account)\b/i.test(reason)) return 'account'
  return 'other'
}

export function parseReview(raw: unknown): PaperReview | null {
  const body = isObject(raw) ? raw : {}
  const review = isObject(body.review) ? body.review : null
  if (review === null) return null
  const quoteId = text(review.quoteId)
  const market = isObject(review.market) ? review.market : {}
  const outcome = isObject(review.outcome) ? review.outcome : {}
  const question = text(market.question)
  const label = text(outcome.label)
  if (quoteId === null || question === null || label === null) return null
  const figures = isObject(review.figures) ? review.figures : {}
  const quote = isObject(review.quote) ? review.quote : {}
  // The server lists every warning twice (in `checks` and in `warnings`): the checks alone are read, each once.
  const checks: ReviewCheck[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(review.checks) ? review.checks : []) {
    if (!isObject(entry)) continue
    const detail = text(entry.detail)
    if (detail === null || (entry.state !== 'fail' && entry.state !== 'warn')) continue
    const id = text(entry.id) ?? detail
    const routeCode = id === 'route_warning' ? routeCodeOf(detail) : null
    const key = routeCode !== null ? `route:${routeCode}` : `${entry.state}:${detail}`
    if (seen.has(key)) continue
    seen.add(key)
    checks.push({ id, state: entry.state, detail, routeCode })
  }
  const expired = quote.expired === true
  return {
    quoteId,
    question,
    label,
    side: review.side === 'sell' ? 'sell' : 'buy',
    probability: probability(figures.probability),
    shares: nonNegative(figures.shares),
    totalUsd: nonNegative(figures.totalUsd),
    feesUsd: nonNegative(figures.feesUsd),
    payoutUsd: nonNegative(figures.payoutIfRightUsd),
    profitUsd: finite(figures.profitIfRightUsd),
    maxLossUsd: nonNegative(figures.maxLossUsd),
    expiresAt: isoOrNull(quote.expiresAt),
    checks,
    canPlace: review.canPlace === true && !expired && !checks.some((check) => check.state === 'fail'),
  }
}

/** The smallest and largest dollars one simulated order may spend (the server's own limits, `paper.ts`). */
export const SPEND_MIN_USD = 1
export const SPEND_MAX_USD = 10_000

/** A typed sum in dollars, a comma read as a point, up to two decimals; null for anything that is not a plain amount. */
export function spendOf(text: string): number | null {
  const value = text.trim().replace(',', '.')
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(value)) return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

export type LinkFailure = 'busy' | 'unavailable' | 'declined' | 'failed'

/** The link's refusal by the server's code; a refusal the wallet gave is `declined`, anything else `failed`. */
export function linkFailureOf(code: string | null, walletDeclined: boolean): LinkFailure {
  if (code === 'CHALLENGE_REQUIRED' || code === 'CHALLENGE_FAILED' || code === 'RATE_LIMITED') return 'busy'
  if (code === 'LINK_UNAVAILABLE') return 'unavailable'
  if (code === null && walletDeclined) return 'declined'
  return 'failed'
}

/** How much less than the Review's figure a send may still deliver (1 %) — the server's own bound. */
export const RECEIVE_DROP_TOLERANCE_BPS = 100

/**
 * The least the send may deliver and still go as reviewed, rounded down to whole cents so the figure the Review names
 * is never above the server's bound; null when there is no quote.
 */
export function receiveFloorRaw(reviewedRaw: string | null, toleranceBps = RECEIVE_DROP_TOLERANCE_BPS): string | null {
  if (reviewedRaw === null || !RAW.test(reviewedRaw)) return null
  const scaled = BigInt(reviewedRaw) * BigInt(10_000 - toleranceBps)
  const floor = (scaled + 9_999n) / 10_000n
  const cent = 10n ** BigInt(USDC_DECIMALS - 2)
  return ((floor / cent) * cent).toString()
}

/** A typed amount of USDC as its raw digits, up to six decimals, a comma read as a point; null for anything else. */
export function rawOfTyped(text: string): string | null {
  const value = text.trim().replace(',', '.')
  const match = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(value)
  if (!match) return null
  const raw = `${match[1]}${(match[2] ?? '').padEnd(USDC_DECIMALS, '0')}`.replace(/^0+(?=\d)/, '')
  return raw === '0' || /^0+$/.test(raw) ? null : raw
}

/** One id per Review of a withdrawal: confirming the same Review twice is one withdrawal. */
export function newRequestId(random: (bytes: Uint8Array) => Uint8Array = fillRandom): string {
  const bytes = random(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function fillRandom(bytes: Uint8Array): Uint8Array {
  const source = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto
  if (!source?.getRandomValues) throw new Error('No secure random source.')
  return source.getRandomValues(bytes)
}

/* ------------------------------------------------------------------------------------------------- the link */

/**
 * The 64-byte signature out of what a wallet hands back for a signed message: Mobile Wallet Adapter's «signed payload»
 * is the signature alone in some wallets and the message with the signature after it in others. Null for anything
 * else — a payload that does not carry this very message is never sent on.
 */
export function signatureOf(message: Uint8Array, signed: Uint8Array): Uint8Array | null {
  if (signed.length === 64) return signed
  if (signed.length !== message.length + 64) return null
  for (let index = 0; index < message.length; index += 1) if (signed[index] !== message[index]) return null
  return signed.slice(message.length)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Bytes as standard base64 — what the link's check reads by default. */
export function base64Of(bytes: Uint8Array): string {
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!
    const b = bytes[index + 1]
    const c = bytes[index + 2]
    out += B64[a >> 2]
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : B64[c & 63]
  }
  return out
}
