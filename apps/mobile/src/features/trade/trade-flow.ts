/**
 * One trade, from the quote to the receipt — the flow, with its dependencies
 * handed in so it runs the same under the app and under a test with doubles.
 * The one submitter: the server builds the exact bytes
 * and the Review, the wallet signs those bytes and nothing else, the server
 * submits once and observes. A signature that exists is a recovery state
 * for that signature — never permission to ask for new bytes — and an
 * attempt survives the app closing so the same operation is restored, not
 * repeated. A stale Review can only be refreshed, never signed.
 */

import {
  ApiError,
  isNetworkError,
  type PlanReview,
  type Session,
  type SwapExecuteInput,
  type SwapOrderResponse,
  type SwapOrigin,
  type SwapQuoteInput,
  type SwapQuoteResponse,
  type SwapRecoveryInput,
  type SwapSettlement,
} from '../../lib/api.ts'

import {
  ledgerBlindSigning,
  ledgerCanSign,
  waitForWallet,
  walletCannotSign,
  type WalletCancel,
} from '../wallet/wallet-wait.ts'
import {
  MAX_SIGNABLE_MS,
  mayOpenWallet,
  msUntilBytesDie,
  signableMsOf,
  signableWindowClosed,
} from '../wallet/bytes-life.ts'

import { TRADE_COPY } from './copy.ts'
import {
  assessReview,
  failureCopyOf,
  readTakerSignature,
  tradeFailureCopy,
  transitionTradeAttempt,
  type TradeAsset,
  type TradeAttempt,
  type TradeContext,
  type TradeFailureKey,
  type TradeMode,
} from './trade-model.ts'

export type TradeApi = Readonly<{
  quote: (input: SwapQuoteInput, signal?: AbortSignal) => Promise<SwapQuoteResponse>
  order: (
    session: Session,
    input: SwapQuoteInput,
    origin: SwapOrigin | null,
    signal?: AbortSignal,
  ) => Promise<SwapOrderResponse>
  execute: (session: Session, input: SwapExecuteInput) => Promise<SwapSettlement>
  recover: (session: Session, input: SwapRecoveryInput) => Promise<SwapSettlement>
  cancel: (
    session: Session,
    input: Readonly<{ owner: string; requestId: string }>,
  ) => Promise<Readonly<{ state: string }>>
}>

/** The wallet signs the exact bytes and hands the signed wire back; it never sends. */
export type TradeWallet = Readonly<{ signTransaction: (unsignedWireBase64: string) => Promise<string> }>

/** The one attempt per wallet on this device. */
export type AttemptStore = Readonly<{
  get: (taker: string) => TradeAttempt | null
  set: (attempt: TradeAttempt) => void
  clear: (taker: string) => void
}>

export type OwnerLock = Readonly<{ state: string; requestId: string; signature: string | null }>

export type TradeFailure = Readonly<{
  code: string
  /** The words a screen says for it, in the person's language (`TRADE_COPY.failures`). */
  key: TradeFailureKey
  /** The same refusal in English — the record's own words. */
  message: string
  retryable: boolean
  /** The server refused before the network saw anything: the Review is void, nothing was sent. */
  notCrossed?: boolean
  ownerLock?: OwnerLock | null
  /** Under a plan: the Strategy block the refusal carries, so the sheet can name each check. */
  planReview?: PlanReview | null
}>

/** A server refusal or a network failure into the words a screen says. */
export function failureFrom(error: unknown): TradeFailure {
  if (error instanceof ApiError) {
    const copy = tradeFailureCopy(error.code)
    const lock = error.details.ownerLock
    const ownerLock =
      lock && typeof lock === 'object' && typeof (lock as OwnerLock).requestId === 'string'
        ? {
            state: String((lock as OwnerLock).state),
            requestId: (lock as OwnerLock).requestId,
            signature: typeof (lock as OwnerLock).signature === 'string' ? (lock as OwnerLock).signature : null,
          }
        : null
    const planReview = error.details.planReview
    return {
      code: error.code,
      key: copy.key,
      message: copy.message,
      retryable: copy.retryable,
      notCrossed: error.details.submitBoundary === 'NOT_CROSSED',
      ownerLock,
      planReview:
        planReview && typeof planReview === 'object' && Array.isArray((planReview as PlanReview).checks)
          ? (planReview as PlanReview)
          : null,
    }
  }
  if (isNetworkError(error)) return { code: 'NETWORK', ...tradeFailureCopy('NETWORK') }
  return { code: 'FAILED', ...tradeFailureCopy('FAILED') }
}

/**
 * ST-3: a quote refused for a moment — the venue's «too many requests», a gateway that took too long, the
 * venue down, the network dropped — is asked once more after `QUOTE_ASK_AGAIN_MS` by itself, so the figure comes and
 * no red line asks the person to press «Спробувати ще». A refusal that stands (no route, an amount, a blocked asset)
 * is said at once.
 */
export const QUOTE_ASK_AGAIN_MS = 1_000
const QUOTE_PASSING: ReadonlySet<TradeFailureKey> = new Set(['rateLimited', 'tooLong', 'providerDown', 'offline'])

export function quoteAskAgain(error: unknown, failures: number): boolean {
  if (failures >= 1 || !QUOTE_PASSING.has(failureFrom(error).key)) return false
  // Ryntra's own limiter is a fixed window: asked again at one second it refuses again — said at once, the budget kept.
  if (error instanceof ApiError && error.code === 'RATE_LIMITED') return false
  // Any limiter that names a longer pause is the same.
  const named = error instanceof ApiError ? error.details.retryAfterSeconds : undefined
  return !(typeof named === 'number' && named * 1000 > 2 * QUOTE_ASK_AGAIN_MS)
}

/**
 * ST-5 r9–r10: a «too many requests» the quote is not asked again for at once is asked AFTER the window, never inside
 * it: the pause the refusal names (`retryAfterSeconds` — Ryntra's 60-second window says up to 60 s — with a small
 * margin), else `QUOTE_LIMIT_WAIT_MS`. Meanwhile the ticket says «Рахуємо ціну…» and starts no new ask — the newest
 * amount is asked when the wait ends. The refusal is said only if that ask fails too; even then the ticket asks again
 * by itself — after the pause named, else every `QUOTE_LIMIT_AGAIN_MS` — while it is open, so it never stands on
 * «Забагато запитів» until a press (ST-5 r10: > 70 s).
 */
export const QUOTE_LIMIT_WAIT_MS = 2_000
export const QUOTE_LIMIT_AGAIN_MS = 10_000
export const QUOTE_LIMIT_MARGIN_MS = 250
/** The longest pause named that is waited out (`RETRY_AFTER_MAX_SECONDS`); a longer one is waited this long. */
export const QUOTE_LIMIT_WAIT_MAX_MS = 60_000 + QUOTE_LIMIT_MARGIN_MS

/**
 * How long the ticket waits before it asks once more after this refusal — `again` after the ask past a window was
 * refused too; null for a refusal that is not «too many requests».
 */
export function quoteLimitWait(error: unknown, again = false): number | null {
  if (!(error instanceof ApiError) || failureFrom(error).key !== 'rateLimited') return null
  const named = error.details.retryAfterSeconds
  const wait =
    typeof named === 'number' && Number.isFinite(named) && named >= 0
      ? Math.max(QUOTE_ASK_AGAIN_MS, named * 1000 + QUOTE_LIMIT_MARGIN_MS)
      : again
        ? QUOTE_LIMIT_AGAIN_MS
        : QUOTE_LIMIT_WAIT_MS
  return Math.min(wait, QUOTE_LIMIT_WAIT_MAX_MS)
}

/**
 * The ticket's pacing after a «too many requests»: `waiting` until the window passes — no ask starts, «Рахуємо ціну…»
 * — then `spent` for the amount asked once after it; refused too, `resting`: said, and asked again at `until` while the
 * ticket is open. Any answer ends it.
 */
export type QuoteLimit =
  | Readonly<{ phase: 'waiting'; until: number }>
  | Readonly<{ phase: 'spent'; key: string }>
  | Readonly<{ phase: 'resting'; key: string; until: number }>
  | null

export type QuoteLimitEvent =
  | Readonly<{ kind: 'refused'; error: unknown; key: string; nowMs: number }>
  | Readonly<{ kind: 'waited'; key: string | null }>
  /** A resting ticket's pause is over: the amount on screen now (null for none). */
  | Readonly<{ kind: 'again'; key: string | null }>
  | Readonly<{ kind: 'answered' }>

export function quoteLimitNext(held: QuoteLimit, event: QuoteLimitEvent): QuoteLimit {
  if (event.kind === 'answered') return null
  if (event.kind === 'waited') {
    if (held?.phase !== 'waiting') return held
    // Nothing typed to ask: the wait is over and nothing is owed.
    return event.key === null ? null : { phase: 'spent', key: event.key }
  }
  if (event.kind === 'again') {
    if (held?.phase !== 'resting') return held
    // Asked again for the amount said; another amount on screen is asked as any amount is.
    return event.key === held.key ? { phase: 'spent', key: held.key } : null
  }
  const wait = quoteLimitWait(event.error)
  if (wait === null || held?.phase === 'waiting') return held
  // The ask after the window was refused too: said, and asked again after the next pause.
  if ((held?.phase === 'spent' || held?.phase === 'resting') && held.key === event.key) {
    return { phase: 'resting', key: event.key, until: event.nowMs + (quoteLimitWait(event.error, true) ?? wait) }
  }
  return { phase: 'waiting', until: event.nowMs + wait }
}

/** Whether the ticket holds a refusal back as «Рахуємо ціну…» — the wait, or a refusal about to start one. */
export function quoteLimitHolds(held: QuoteLimit, error: unknown, key: string | null): boolean {
  if (held?.phase === 'waiting') return true
  if (!error || key === null || quoteLimitWait(error) === null) return false
  return !((held?.phase === 'spent' || held?.phase === 'resting') && held.key === key)
}

/**
 * ST-5 r10: an estimate is never asked longer than this (the request's own 12 s and a margin). An ask that has not
 * answered by then — a socket that never settles, an abort that never lands — is a «took too long» refusal: asked
 * once more by itself (`quoteAskAgain`), then said with «Спробувати ще». Never a ticket pending for minutes.
 */
export const QUOTE_ASK_LIMIT_MS = 13_000

/** An ask that settles within `ms` or is refused as `QUOTE_TIMEOUT` (`tooLong`); `onLate` lets the caller abort it. */
export function quoteWithin<T>(ask: Promise<T>, ms: number = QUOTE_ASK_LIMIT_MS, onLate?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onLate?.()
      reject(new ApiError('QUOTE_TIMEOUT', 'The price took too long.', 0))
    }, ms)
  })
  return Promise.race([ask, late]).finally(() => clearTimeout(timer))
}

/** How long a typed sum may stand with no estimate, no ask under way and no refusal before it is asked again. */
export const QUOTE_STUCK_MS = 1_500
/** How many times one amount is asked again that way. */
export const QUOTE_STUCK_ASKS = 2

/**
 * What the ticket shows for its estimate (ST-5): the quote for the amount on screen — unless the latest ask for it
 * failed. A failed refresh keeps the last answer in the cache, but its figure is no longer the ticket's: the price
 * and «could not get the price» are never on screen together; the figure is «—» beside the one status line. While it
 * is asked again the ticket says it is pricing.
 */
export function ticketEstimate(
  input: Readonly<{ matches: boolean; failed: boolean; fetching: boolean }>,
): 'shown' | 'pricing' | 'none' {
  if (input.matches && !input.failed) return 'shown'
  return input.fetching ? 'pricing' : 'none'
}

export type Prepared = Readonly<{
  order: SwapOrderResponse
  context: TradeContext
  /**
   * When the order arrived on this phone (AG-2): the bytes' signable window — the server's `signableMs`, ~30 s of life
   * less a margin — counts from here. Absent on a Review kept from before AG-2: that one is built again.
   */
  receivedAtMs?: number
}>

/**
 * AG-2b: how many times an open Review renews its bytes by itself while it is read (~30 s each, about two minutes in
 * all). Each renewal is one to four releases and an order, spread over its ~30 s — a few of the twelve actions a minute,
 * leaving room for the press's execute; past the last the Review goes stale and «Оновити «Перевірку»» asks again.
 */
export const REVIEW_RENEWALS = 4

type OrderTerms = Pick<
  SwapOrderResponse['order'],
  | 'inputMint'
  | 'outputMint'
  | 'inAmountRaw'
  | 'minReceivedRaw'
  | 'totalFeeBasisPoints'
  | 'platformFee'
  | 'signatureFeeLamports'
  | 'priorityFeeLamports'
  | 'rentFeeLamports'
>

function rawOf(value: string | null | undefined): bigint | null {
  return typeof value === 'string' && /^\d{1,40}$/.test(value) ? BigInt(value) : null
}

/**
 * AG-2b (the web's `freshOrderNoWorse`, AG-1): may fresh bytes go to the wallet on a press made over the old Review?
 * The same pair and amount, at least the same minimum received and no fee higher — otherwise the person looks again.
 */
export function freshOrderNoWorse(reviewed: OrderTerms, fresh: OrderTerms): boolean {
  if (
    fresh.inputMint !== reviewed.inputMint ||
    fresh.outputMint !== reviewed.outputMint ||
    fresh.inAmountRaw !== reviewed.inAmountRaw
  )
    return false
  const pairs: readonly (readonly [string, string, 'atLeast' | 'atMost'])[] = [
    [fresh.minReceivedRaw, reviewed.minReceivedRaw, 'atLeast'],
    [fresh.signatureFeeLamports, reviewed.signatureFeeLamports, 'atMost'],
    [fresh.priorityFeeLamports, reviewed.priorityFeeLamports, 'atMost'],
    [fresh.rentFeeLamports, reviewed.rentFeeLamports, 'atMost'],
  ]
  for (const [now, then, rule] of pairs) {
    const a = rawOf(now)
    const b = rawOf(then)
    if (a === null || b === null) return false
    if (rule === 'atLeast' ? a < b : a > b) return false
  }
  return (
    fresh.totalFeeBasisPoints <= reviewed.totalFeeBasisPoints &&
    (fresh.platformFee?.basisPoints ?? 0) <= (reviewed.platformFee?.basisPoints ?? 0)
  )
}

/** The server's `signableMs` on an order (AG-1, contract-additive; the pinned copy of the types predates it). */
export function orderSignableMs(order: SwapOrderResponse): number {
  return signableMsOf((order as SwapOrderResponse & Readonly<{ signableMs?: unknown }>).signableMs)
}

export type PrepareOutcome =
  | Readonly<{ ok: true; prepared: Prepared }>
  | Readonly<{
      ok: false
      failure: TradeFailure
      /** A signature of this wallet is unresolved: check it, never sign another. */
      attempt?: TradeAttempt
      /** An open Review nobody signed holds the wallet; it can be released. */
      lockedReview?: Readonly<{ requestId: string }>
    }>

function readiness(order: SwapOrderResponse, now: number, invalidated = false) {
  return assessReview({
    verdict: order.policy.verdict,
    proofStatus: order.proof.status,
    simulationStatus: order.simulation.status,
    ownerEffectsStatus: order.simulation.ownerEffects?.status ?? 'MISSING',
    expiresAt: order.expiresAt,
    now,
    invalidated,
  })
}

/**
 * The pauses before the order is asked again when the venue said it was asked too often (`ORDER_RATE_LIMITED`) or
 * refused to build it a moment ago (`ORDER_REFUSED`, its own 4xx; `ORDER_HTTP_ERROR`, its 5xx): the route checks the
 * owner's lock is free, then asks the venue, and reserves the lock and stores the Review only at its very end (line
 * A's `SOLANA_SWAP_PREPARE`), so asking again builds at most the one Review the first ask would have. Production
 * showed these refusals pass on the next press (2026-10-03, -04: two and three presses within seconds) — the phone
 * asks again itself, so the person's first press is the one that works. A pause the server names
 * (`retryAfterSeconds`) is kept when it is longer; one longer than `ORDER_RETRY_MAX_MS` is not waited out here — the
 * refusal is said.
 */
export const ORDER_RETRY_DELAYS_MS: readonly number[] = [1_500, 3_000]
export const ORDER_RETRY_MAX_MS = 5_000
/** The venue's refusals that pass on their own: asked again, never a route that does not exist or a wallet short of funds. */
const ORDER_RETRY_CODES: ReadonlySet<string> = new Set(['ORDER_RATE_LIMITED', 'ORDER_REFUSED', 'ORDER_HTTP_ERROR'])

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** How long to wait before the order is asked again, or null when this refusal is not asked again. */
export function orderRetryDelay(error: unknown, tries: number): number | null {
  if (!(error instanceof ApiError) || !ORDER_RETRY_CODES.has(error.code)) return null
  // A venue's 4xx may be for good (a mint it never routes): asked again once, never twice.
  if (error.code === 'ORDER_REFUSED' && tries > 0) return null
  const planned = ORDER_RETRY_DELAYS_MS[tries]
  if (planned === undefined) return null
  const named = error.details.retryAfterSeconds
  const asked = typeof named === 'number' && Number.isFinite(named) && named > 0 ? named * 1000 : 0
  if (asked > ORDER_RETRY_MAX_MS) return null
  return Math.max(planned, asked)
}

/**
 * Ask the server for the exact signable Review. Refused on the phone when a
 * signature of this wallet is still unresolved, and by the server when the
 * wallet holds an open Review elsewhere (`OWNER_SWAP_LOCKED`) — with a
 * signature that is an attempt to recover, without one a Review to release.
 * The venue's own «too many requests» and its own failure are asked again
 * twice, its refusal of a moment once, with a pause, before it is said
 * (`orderRetryDelay`) — never after `cancelled` says
 * the person closed the sheet or asked anew during a pause.
 */
export async function prepareReview(
  input: Readonly<{
    api: TradeApi
    session: Session
    attempts: AttemptStore
    mode: TradeMode
    pay: TradeAsset
    receive: TradeAsset
    amountRaw: string
    origin: SwapOrigin | null
    now?: () => number
    wait?: (ms: number) => Promise<void>
    /** True once the person has closed the sheet or asked again: a pause then ends the asking. */
    cancelled?: () => boolean
  }>,
): Promise<PrepareOutcome> {
  const open = input.attempts.get(input.session.address)
  if (open && open.state !== 'SETTLED') {
    return { ok: false, failure: { code: 'ATTEMPT_OPEN', ...tradeFailureCopy('RECOVERY') }, attempt: open }
  }
  const askOrder = async (): Promise<SwapOrderResponse> => {
    for (let tries = 0; ; tries += 1) {
      try {
        return await input.api.order(
          input.session,
          { inputMint: input.pay.mint, outputMint: input.receive.mint, amountRaw: input.amountRaw },
          input.origin,
        )
      } catch (error) {
        const delay = orderRetryDelay(error, tries)
        if (delay === null || input.cancelled?.()) throw error
        await (input.wait ?? sleep)(delay)
        if (input.cancelled?.()) throw error
      }
    }
  }
  let order: SwapOrderResponse
  try {
    order = await askOrder()
  } catch (error) {
    const failure = failureFrom(error)
    if (failure.code === 'OWNER_SWAP_LOCKED' && failure.ownerLock) {
      if (failure.ownerLock.signature) {
        const attempt: TradeAttempt = {
          schema: 'ryntra.mobile.trade-attempt',
          schemaVersion: '1.0.0',
          requestId: failure.ownerLock.requestId,
          signature: failure.ownerLock.signature,
          taker: input.session.address,
          state: 'SUBMITTED_UNKNOWN',
          recordedAt: new Date((input.now ?? Date.now)()).toISOString(),
          context: null,
        }
        input.attempts.set(attempt)
        return { ok: false, failure, attempt }
      }
      return { ok: false, failure, lockedReview: { requestId: failure.ownerLock.requestId } }
    }
    return { ok: false, failure }
  }
  const now = (input.now ?? Date.now)()
  const ready = readiness(order, now)
  if (!order.preSign.ready) {
    return { ok: false, failure: { code: order.preSign.code, ...tradeFailureCopy(order.preSign.code) } }
  }
  if (!ready.ready)
    return {
      ok: false,
      failure: { code: ready.code, key: ready.key, message: ready.reason, retryable: ready.code !== 'POLICY_BLOCKED' },
    }
  const payDecimals = order.decimals[input.pay.mint] ?? input.pay.decimals
  const receiveDecimals = order.decimals[input.receive.mint] ?? input.receive.decimals
  if (payDecimals === null || receiveDecimals === null) {
    return {
      ok: false,
      failure: { code: 'DECIMALS_UNKNOWN', ...failureCopyOf('unchecked') },
    }
  }
  return {
    ok: true,
    prepared: {
      order,
      receivedAtMs: now,
      context: {
        mode: input.mode,
        pay: input.pay,
        receive: input.receive,
        payDecimals,
        receiveDecimals,
        inAmountRaw: order.order.inAmountRaw,
        outAmountRaw: order.order.outAmountRaw,
        minReceivedRaw: order.order.minReceivedRaw,
      },
    },
  }
}

export type SignOutcome =
  | Readonly<{ ok: true; settlement: SwapSettlement; attempt: TradeAttempt }>
  | Readonly<{
      ok: false
      failure: TradeFailure
      /** `review`: nothing was sent, the Review stands or is void; `recovery`: a signature is out and its outcome unknown. */
      phase: 'review' | 'recovery'
      attempt?: TradeAttempt
      /** The Review must not be signed again as it is. */
      invalidated?: boolean
      /**
       * AG-2: the bytes were too short-lived to open the wallet on (`short`), or the wallet answered after they could
       * still land (`late`). Nothing was sent; the screen builds the Review again (`afterLateAnswer`).
       */
      aged?: 'short' | 'late'
    }>

/** Milliseconds past the Review's window a wallet may still answer before the app stops waiting. */
const SIGNING_GRACE_MS = 5_000

/**
 * The wallet signs the exact reviewed bytes and the server submits them once.
 * Before the wallet opens the Review is judged again; after it answers, the
 * signature is read and remembered before anything is sent, so a closed app
 * finds it; an execute the network never saw voids the Review and frees the
 * wallet; an execute whose answer is unknown is a recovery state.
 */
export async function signAndSend(
  input: Readonly<{
    api: TradeApi
    wallet: TradeWallet
    session: Session
    attempts: AttemptStore
    prepared: Prepared
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    /** Told once the wallet has answered and its signature is remembered — the send begins; a screen may say so. */
    onSigned?: () => void
    /** «Скасувати» while the wallet is asked (M45): the wait ends, and an answer after it is never sent. */
    cancel?: WalletCancel | null
  }>,
): Promise<SignOutcome> {
  const now = input.now ?? Date.now
  const { prepared, session } = input
  // One moment for every check before the wallet opens: the press.
  const pressedAt = now()
  const before = readiness(prepared.order, pressedAt)
  if (!before.ready) {
    return {
      ok: false,
      failure: { code: before.code, key: before.key, message: before.reason, retryable: true },
      phase: 'review',
      invalidated: before.code === 'REVIEW_INVALIDATED',
    }
  }
  // Only bytes a Ledger behind the wallet can sign reach the wallet: v0 (or legacy), never a later version (PLAN §8).
  if (!ledgerCanSign(prepared.order.order.transactionBase64)) {
    return {
      ok: false,
      failure: { code: 'TX_VERSION', ...failureCopyOf('txVersion') },
      phase: 'review',
      invalidated: true,
    }
  }
  // AG-2: the bytes live ~30 s. Too little of that left for a wallet (and a Ledger) to confirm: no wallet — a fresh Review.
  const signableMs = orderSignableMs(prepared.order)
  const receivedAtMs = prepared.receivedAtMs ?? Number.NaN
  if (!mayOpenWallet({ receivedAtMs, signableMs, nowMs: pressedAt })) {
    return {
      ok: false,
      failure: { code: 'BYTES_REBUILT', ...failureCopyOf('bytesRebuilt') },
      phase: 'review',
      invalidated: true,
      aged: 'short',
    }
  }
  // A Ledger's review on the device can outlast the Review's window: the wait is never cut before ninety seconds,
  // and a signature that comes back after the bytes' window is dropped below — a fresh «Перевірка», never a repeat.
  const waitMs = Math.max(0, Date.parse(prepared.order.expiresAt) - pressedAt) + SIGNING_GRACE_MS
  let signed: string
  try {
    const answer = await waitForWallet(input.wallet.signTransaction(prepared.order.order.transactionBase64), {
      waitMs,
      sleep: input.sleep,
      cancel: input.cancel,
    })
    if (answer.kind === 'cancelled') {
      return { ok: false, failure: { code: 'WALLET_REFUSED', ...failureCopyOf('walletCancelled') }, phase: 'review' }
    }
    if (answer.kind === 'timeout') {
      return {
        ok: false,
        failure: { code: 'WALLET_TIMEOUT', ...failureCopyOf('walletTimeout') },
        phase: 'review',
        invalidated: true,
      }
    }
    signed = answer.value
  } catch (error) {
    const code = walletRefusalCode(error)
    return { ok: false, failure: { code, ...tradeFailureCopy(code) }, phase: 'review' }
  }
  const signature = readTakerSignature(signed, session.address)
  if (!signature) {
    return {
      ok: false,
      failure: { code: 'SIGNATURE_UNREADABLE', ...failureCopyOf('signatureUnrecorded') },
      phase: 'review',
    }
  }
  // AG-2: the wallet answered after the bytes could still land — the network would refuse them. Never sent.
  if (signableWindowClosed({ receivedAtMs, signableMs, nowMs: now() })) {
    return {
      ok: false,
      failure: { code: 'BYTES_REBUILT', ...failureCopyOf('bytesRebuilt') },
      phase: 'review',
      invalidated: true,
      aged: 'late',
    }
  }
  const stillFresh = readiness(prepared.order, now())
  if (!stillFresh.ready) {
    return {
      ok: false,
      failure: { code: 'REVIEW_CLOSED_UNDER_WALLET', ...failureCopyOf('closedUnderWallet') },
      phase: 'review',
      invalidated: true,
    }
  }
  const pending: TradeAttempt = {
    schema: 'ryntra.mobile.trade-attempt',
    schemaVersion: '1.0.0',
    requestId: prepared.order.order.requestId,
    signature,
    taker: session.address,
    state: 'SIGNED_NOT_SENT',
    recordedAt: new Date(now()).toISOString(),
    context: prepared.context,
  }
  input.attempts.set(pending)
  input.onSigned?.()
  let settlement: SwapSettlement
  try {
    settlement = await input.api.execute(session, {
      bundle: prepared.order.bundle,
      proof: prepared.order.proof,
      signedTransactionBase64: signed,
      reviewedTransactionBase64: prepared.order.order.transactionBase64,
    })
  } catch (error) {
    const failure = failureFrom(error)
    if (failure.notCrossed) {
      // The server refused before the network saw anything: the signature is let go, the Review is void.
      input.attempts.clear(session.address)
      return { ok: false, failure, phase: 'review', invalidated: true }
    }
    const unknown = transitionTradeAttempt(pending, { kind: 'FAILURE' })
    input.attempts.set(unknown)
    return { ok: false, failure, phase: 'recovery', attempt: unknown }
  }
  const recorded = transitionTradeAttempt(pending, { kind: 'SUCCESS', serverState: settlement.state })
  if (recorded.state === 'SETTLED') input.attempts.clear(session.address)
  else input.attempts.set(recorded)
  return { ok: true, settlement, attempt: recorded }
}

/** The wallet's own refusal, a closed sheet, or a wallet that is not there — as a code the copy knows. */
function walletRefusalCode(error: unknown): string {
  const code =
    error !== null && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : ''
  const text = error instanceof Error ? error.message : String(error ?? '')
  if (ledgerBlindSigning(error)) return 'LEDGER_BLIND_SIGNING'
  if (walletCannotSign(error)) return 'WALLET_CANNOT_SIGN'
  if (code === 'ERROR_WALLET_NOT_FOUND' || /no installed wallet/i.test(text)) return 'WALLET_NOT_FOUND'
  if (
    code === 'ERROR_ASSOCIATION_CANCELLED' ||
    code === 'ERROR_SESSION_CLOSED' ||
    code === '-1' ||
    code === '-3' ||
    /cancel|declin|rejected/i.test(text)
  )
    return 'WALLET_REFUSED'
  return 'WALLET_FAILED'
}

export type RecoverOutcome =
  | Readonly<{ ok: true; settlement: SwapSettlement; attempt: TradeAttempt; final: boolean }>
  | Readonly<{ ok: false; failure: TradeFailure; attempt: TradeAttempt }>

/** How long a check keeps asking while the network has not decided, and how often. */
export const RECOVERY_DEADLINE_MS = 150_000
export const RECOVERY_INTERVAL_MS = 3_000
/** ST-3: a swap lands in a second or two — the first asks of a check come sooner, the rest at the usual pace. */
export const RECOVERY_QUICK_ASKS = 4
export const RECOVERY_QUICK_INTERVAL_MS = 1_500

/**
 * ST-3: the signature that went out and whose end the phone did not hear — the execute's «still pending» or an answer
 * that never came — is checked at once by itself, so «Готово» follows without a press of «Перевірити транзакцію». The
 * check only reads what the server observed by signature; nothing is sent again. Null when there is nothing to check.
 */
export function checkAfterSend(outcome: SignOutcome): TradeAttempt | null {
  if (outcome.ok) return outcome.attempt.state === 'SETTLED' ? null : outcome.attempt
  return outcome.phase === 'recovery' ? (outcome.attempt ?? null) : null
}

/**
 * Recover one signature: ask the server what it observed, and keep asking
 * while the answer is pending — up to the deadline. Nothing here resubmits.
 * A signature the chain never saw and never can frees the wallet.
 */
export async function recoverAttempt(
  input: Readonly<{
    api: TradeApi
    session: Session
    attempts: AttemptStore
    attempt: TradeAttempt
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    deadlineMs?: number
    intervalMs?: number
    /** True once the person left the screen: a check still pending stops asking and keeps the attempt for the next look. */
    cancelled?: () => boolean
  }>,
): Promise<RecoverOutcome> {
  const now = input.now ?? Date.now
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline = now() + (input.deadlineMs ?? RECOVERY_DEADLINE_MS)
  const { attempt, session } = input
  for (let asked = 1; ; asked += 1) {
    let recovered: SwapSettlement
    try {
      recovered = await input.api.recover(session, {
        signature: attempt.signature,
        owner: attempt.taker,
        requestId: attempt.requestId,
      })
    } catch (error) {
      return { ok: false, failure: failureFrom(error), attempt }
    }
    if (recovered.state === 'UNKNOWN_TO_CHAIN') {
      input.attempts.clear(session.address)
      return { ok: true, settlement: recovered, attempt: { ...attempt, state: 'SETTLED' }, final: true }
    }
    if (recovered.state === 'SEEN_WITHOUT_RECORD') {
      const unresolved = { ...attempt, state: 'SUBMITTED_UNKNOWN' as const }
      input.attempts.set(unresolved)
      return {
        ok: true,
        settlement: {
          ...recovered,
          recovery: TRADE_COPY.en.seenWithoutReceipt,
        },
        attempt: unresolved,
        final: false,
      }
    }
    if (recovered.state === 'PENDING') {
      const unresolved = { ...attempt, state: 'SUBMITTED_UNKNOWN' as const }
      const pending = { ok: true as const, settlement: { ...recovered, state: 'RECOVERY_PENDING' }, attempt: unresolved, final: false }
      // A check nobody waits on any more writes nothing: another check may have settled this signature meanwhile.
      if (input.cancelled?.()) return pending
      input.attempts.set(unresolved)
      if (now() >= deadline) return pending
      await sleep(
        input.intervalMs ?? (asked < RECOVERY_QUICK_ASKS ? RECOVERY_QUICK_INTERVAL_MS : RECOVERY_INTERVAL_MS),
      )
      if (input.cancelled?.()) return pending
      continue
    }
    const resolved = transitionTradeAttempt(attempt, { kind: 'SUCCESS', serverState: recovered.state })
    if (resolved.state === 'SETTLED') input.attempts.clear(session.address)
    else input.attempts.set(resolved)
    return { ok: true, settlement: recovered, attempt: resolved, final: resolved.state === 'SETTLED' }
  }
}

/**
 * AG-2: release a Review whose bytes aged out, so a fresh one can be asked for. The old bytes may still land until
 * their blockhash dies — about when their signable window plus its margin is over — and the server releases the owner
 * lock only once the chain says so (`cancel-review` asks `isBlockhashValid` of an independent RPC). So the phone waits
 * for that moment first and then asks at most four times, three seconds apart (ST-3: the first ask half a second past
 * the death, not one and a half — a fresh Review a second sooner; the last still about ten seconds past it, for an
 * independent RPC that lags): the action budget is twelve a minute and the new order and the execute need it too.
 * "Dead" stays the chain's word, never this clock.
 */
export const RELEASE_AFTER_DEATH_MS = 500
export const RELEASE_ASK_EVERY_MS = 3_000
export const RELEASE_ASKS = 4

export async function releaseAgedReview(
  input: Readonly<{
    api: TradeApi
    session: Session
    prepared: Prepared
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    cancelled?: () => boolean
  }>,
): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; failure: TradeFailure }>> {
  const now = input.now ?? Date.now
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  // A Review kept from before AG-2 has no arrival: taken as one window ago, so the chain is asked about now.
  const receivedAtMs = input.prepared.receivedAtMs ?? now() - MAX_SIGNABLE_MS
  await sleep(
    msUntilBytesDie({ receivedAtMs, signableMs: orderSignableMs(input.prepared.order), nowMs: now() }) +
      RELEASE_AFTER_DEATH_MS,
  )
  for (let asked = 1; ; asked += 1) {
    if (input.cancelled?.()) return { ok: false, failure: { code: 'CANCELLED', ...failureCopyOf('failed') } }
    const released = await releaseReview({
      api: input.api,
      session: input.session,
      requestId: input.prepared.order.order.requestId,
    })
    if (released.ok) return released
    // No lock left for this wallet: nothing holds it — as released.
    if (released.failure.code === 'OWNER_SWAP_LOCK_ABSENT') return { ok: true }
    if (released.failure.code !== 'BLOCKHASH_STILL_VALID' || asked >= RELEASE_ASKS) return released
    await sleep(RELEASE_ASK_EVERY_MS)
  }
}

/** Release an open Review nobody signed, so the wallet may ask for another. */
export async function releaseReview(
  input: Readonly<{ api: TradeApi; session: Session; requestId: string }>,
): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; failure: TradeFailure }>> {
  try {
    await input.api.cancel(input.session, { owner: input.session.address, requestId: input.requestId })
    return { ok: true }
  } catch (error) {
    return { ok: false, failure: failureFrom(error) }
  }
}
