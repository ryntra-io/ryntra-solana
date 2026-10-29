/**
 * A Phoenix order's Review, its one signature and its one relay — with the wallet and the routes handed in, so it runs
 * the same under the app and under a test with doubles (C4b; the web's `orders-api.ts` of B6b).
 *
 * The one submitter: the server builds the exact bytes and seals them in a ticket; the wallet signs those
 * bytes and nothing else (MWA `signTransactions`, never sign-and-send); the server holds the signed bytes to the ticket
 * — the same message, the same wallet, the gate as it stands now — and sends them once. A signature that went out is
 * never sent again from here: an answer lost after it is an order whose state the chain tells, and the receipt asks it.
 */

import { ApiError, isNetworkError, type Session } from '../../lib/api.ts'
import { readTakerSignature } from '../trade/trade-model.ts'
import { mayOpenWallet, signableMsOf, signableWindowClosed } from '../wallet/bytes-life.ts'
import {
  ledgerBlindSigning,
  ledgerCanSign,
  waitForWallet,
  walletCannotSign,
  type WalletCancel,
} from '../wallet/wallet-wait.ts'

import type { OrdersApi } from './orders-api.ts'
import {
  ORDERS_REFUSED_BEFORE_SENDING,
  orderFailureOf,
  parseOrderResult,
  parseOrderReview,
  parseOrderStates,
  type OrderBody,
  type OrderFailure,
  type OrderResult,
  type OrderReview,
  type OrderStates,
} from './orders-model.ts'

export type OrderWallet = Readonly<{ signTransaction: (unsignedWireBase64: string) => Promise<string> }>

/** A route's refusal before anything was built or signed, in the phone's words. */
export function failureOfError(error: unknown): OrderFailure {
  if (isNetworkError(error)) return 'network'
  return orderFailureOf(error instanceof ApiError ? error.code : null)
}

/** The gate's word for this wallet; any failure to read it is a closed gate — the Review asks the server again anyway. */
export async function readOrderStates(
  api: OrdersApi,
  owner: string | null,
  signal?: AbortSignal,
): Promise<OrderStates> {
  return parseOrderStates(await api.states(owner, signal))
}

export type Reviewed =
  /** `receivedAt`: the phone's own clock when the Review arrived — its window is counted from there, never the server's clock. */
  Readonly<{ ok: true; review: OrderReview; receivedAt: number }> | Readonly<{ ok: false; reason: OrderFailure }>

/** Ask the server for the Review. Nothing is signed here; a refusal says why in the phone's words. */
export async function reviewOrder(
  api: OrdersApi,
  session: Session,
  body: OrderBody,
  now: () => number = Date.now,
): Promise<Reviewed> {
  try {
    const review = parseOrderReview(await api.review(session, body))
    if (!review) return { ok: false, reason: 'general' }
    return { ok: true, review, receivedAt: now() }
  } catch (error) {
    return { ok: false, reason: failureOfError(error) }
  }
}

export type OrderOutcome =
  /** The relay answered, or its answer was lost after the bytes left: the receipt follows the signature on the chain. */
  | Readonly<{ kind: 'sent'; result: OrderResult }>
  /** Nothing reached the network. `afterSignature` tells which: the wallet signed, and the relay refused before sending. */
  | Readonly<{ kind: 'refused'; reason: OrderFailure; afterSignature: boolean }>

export type OrderWait = Readonly<{
  cancel?: WalletCancel | null
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Told the moment the wallet answered with bytes that will be relayed: from then on there is nothing to cancel. */
  onSigned?: () => void
}>

/**
 * Sign the reviewed bytes in the wallet and hand them to the relay, once. Bytes that age out while the wallet is open
 * are never relayed (`reviewAged` — the screen builds the Review again); once the bytes have left, a lost answer is
 * never «nothing was sent».
 */
export async function signAndRelay(
  input: Readonly<{
    api: OrdersApi
    wallet: OrderWallet
    session: Session
    review: OrderReview
    receivedAt: number
    wait?: OrderWait
  }>,
): Promise<OrderOutcome> {
  const { review, wait = {} } = input
  const now = wait.now ?? Date.now
  const signableMs = signableMsOf(review.signableMs)
  if (!ledgerCanSign(review.wireBase64)) return { kind: 'refused', reason: 'txVersion', afterSignature: false }
  if (!mayOpenWallet({ receivedAtMs: input.receivedAt, signableMs, nowMs: now() })) {
    return { kind: 'refused', reason: 'reviewAged', afterSignature: false }
  }
  let signed: string
  try {
    const answer = await waitForWallet(input.wallet.signTransaction(review.wireBase64), wait)
    if (answer.kind !== 'signed') {
      return {
        kind: 'refused',
        reason: answer.kind === 'timeout' ? 'walletTimeout' : 'walletCancelled',
        afterSignature: false,
      }
    }
    signed = answer.value
  } catch (error) {
    return {
      kind: 'refused',
      reason: ledgerBlindSigning(error)
        ? 'ledgerBlind'
        : walletCannotSign(error)
          ? 'walletCannotSign'
          : 'walletRefused',
      afterSignature: false,
    }
  }
  // A signature after the bytes' window is never relayed: it would die with its blockhash; the Review is built again.
  if (signableWindowClosed({ receivedAtMs: input.receivedAt, signableMs, nowMs: now() })) {
    return { kind: 'refused', reason: 'reviewAged', afterSignature: true }
  }
  wait.onSigned?.()
  const signature = readTakerSignature(signed, input.session.address)
  try {
    const result = parseOrderResult(await input.api.submit(input.session, { ticket: review.ticket, signed: [signed] }))
    if (result) return { kind: 'sent', result }
    // An answer that is not the relay's may hide a send that landed: the chain is asked.
    return signature
      ? { kind: 'sent', result: { signature, state: 'UNKNOWN' } }
      : { kind: 'refused', reason: 'outcomeUnknown', afterSignature: true }
  } catch (error) {
    if (error instanceof ApiError && ORDERS_REFUSED_BEFORE_SENDING.has(error.code)) {
      const reason = error.code === 'TICKET_EXPIRED' ? 'reviewAged' : orderFailureOf(error.code)
      return { kind: 'refused', reason, afterSignature: true }
    }
    // No answer, a gateway's page, a code the phone does not know: the bytes may have left — the receipt follows them.
    return signature
      ? { kind: 'sent', result: { signature, state: 'UNKNOWN' } }
      : { kind: 'refused', reason: 'outcomeUnknown', afterSignature: true }
  }
}

/** The status route's word on one signature, merged into what the receipt holds; a read that failed keeps it as it is. */
export async function followOrder(
  api: OrdersApi,
  owner: string,
  current: OrderResult,
  signal?: AbortSignal,
): Promise<OrderResult> {
  try {
    const seen = parseOrderResult(await api.status(owner, current.signature, signal))
    if (!seen || seen.signature !== current.signature || seen.state === 'UNKNOWN') return current
    const fills = seen.fills ?? current.fills
    return { signature: current.signature, state: seen.state, ...(fills === undefined ? {} : { fills }) }
  } catch {
    return current
  }
}
