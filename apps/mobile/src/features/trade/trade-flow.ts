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

export type Prepared = Readonly<{
  order: SwapOrderResponse
  context: TradeContext
}>

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
  }>,
): Promise<SignOutcome> {
  const now = input.now ?? Date.now
  const { prepared, session } = input
  const before = readiness(prepared.order, now())
  if (!before.ready) {
    return {
      ok: false,
      failure: { code: before.code, key: before.key, message: before.reason, retryable: true },
      phase: 'review',
      invalidated: before.code === 'REVIEW_INVALIDATED',
    }
  }
  const deadlineMs = Math.max(0, Date.parse(prepared.order.expiresAt) - now()) + SIGNING_GRACE_MS
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let signed: string
  try {
    const answer = await Promise.race([
      input.wallet
        .signTransaction(prepared.order.order.transactionBase64)
        .then((wire) => ({ kind: 'signed' as const, wire })),
      sleep(deadlineMs).then(() => ({ kind: 'timeout' as const })),
    ])
    if (answer.kind === 'timeout') {
      return {
        ok: false,
        failure: { code: 'WALLET_TIMEOUT', ...failureCopyOf('walletTimeout') },
        phase: 'review',
        invalidated: true,
      }
    }
    signed = answer.wire
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
  }>,
): Promise<RecoverOutcome> {
  const now = input.now ?? Date.now
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline = now() + (input.deadlineMs ?? RECOVERY_DEADLINE_MS)
  const { attempt, session } = input
  for (;;) {
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
      input.attempts.set(unresolved)
      if (now() >= deadline)
        return { ok: true, settlement: { ...recovered, state: 'RECOVERY_PENDING' }, attempt: unresolved, final: false }
      await sleep(input.intervalMs ?? RECOVERY_INTERVAL_MS)
      continue
    }
    const resolved = transitionTradeAttempt(attempt, { kind: 'SUCCESS', serverState: recovered.state })
    if (resolved.state === 'SETTLED') input.attempts.clear(session.address)
    else input.attempts.set(resolved)
    return { ok: true, settlement: recovered, attempt: resolved, final: resolved.state === 'SETTLED' }
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
