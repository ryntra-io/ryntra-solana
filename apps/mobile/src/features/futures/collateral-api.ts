/**
 * The phone's calls to the collateral routes of «Perps» and the one flow over them (C4c) — the same routes the web's
 * collateral panel calls (B6, `app/solana/workspace/futures/collateral-api.ts` on line A): what the wallet may do now
 * and the USDC it holds, the Review, the relay of the wallet's signed bytes, and the chain's word on a signature. The
 * routes live outside `/api/v1` as the order routes do (C4b), so they are carried here; the server's contract is read
 * as it is, never changed. A bearer acts only for its own wallet (`lib/phoenix/collateral-routes.ts`).
 *
 * The one submitter, as for orders (`orders-flow.ts`): the server builds the exact bytes and seals them
 * in a ticket; the wallet signs those bytes and nothing else (MWA `signTransactions`, never sign-and-send); the server
 * holds the signed bytes to the ticket and sends them once. A signature that went out is never sent again from here: an
 * answer lost after it is a move whose state the chain tells, and the receipt asks it. The wallet and the routes are
 * handed in, so the flow runs the same under the app and under a test with doubles.
 */

import { ApiError, apiRequest, isNetworkError, type Session } from '../../lib/api.ts'
import { readTakerSignature } from '../trade/trade-model.ts'
import { mayOpenWallet, signableMsOf, signableWindowClosed } from '../wallet/bytes-life.ts'
import {
  ledgerBlindSigning,
  ledgerCanSign,
  waitForWallet,
  walletCannotSign,
  type WalletCancel,
} from '../wallet/wallet-wait.ts'

import {
  COLLATERAL_REFUSED_BEFORE_SENDING,
  collateralFailureOf,
  mergeSeen,
  parseCollateralMargin,
  parseCollateralResult,
  parseCollateralReview,
  parseCollateralStates,
  type CollateralAction,
  type CollateralFailure,
  type CollateralMargin,
  type CollateralResult,
  type CollateralReview,
  type CollateralStates,
} from './collateral-model.ts'

/** The Review simulates on the chain; the relay waits for the network's answer and the chain's record of the USDC. */
const REVIEW_TIMEOUT_MS = 30_000
const SUBMIT_TIMEOUT_MS = 60_000

/** How long a receipt follows its signature on the chain, and how often it asks: the web's two minutes, every four seconds. */
export const COLLATERAL_FOLLOW_MS = 120_000
export const COLLATERAL_FOLLOW_EVERY_MS = 4_000

/**
 * The move as the route takes it: `amount` in micro-dollars as digits (the route's `parseCollateralRequest` on line
 * A), never a decimal. No `format`: the phone's wallets sign legacy bytes, and a Ledger cannot sign v1 yet.
 */
export type CollateralBody = Readonly<{ action: CollateralAction; owner: string; amount: string }>

export type CollateralApi = Readonly<{
  /** The gate's word for this wallet and the USDC it holds. Public, like the web's. */
  states: (owner: string | null, signal?: AbortSignal) => Promise<unknown>
  /** The account route's answer: its `margin` holds what may leave now. Public, read by the address alone. */
  account: (owner: string, signal?: AbortSignal) => Promise<unknown>
  review: (session: Session, body: CollateralBody) => Promise<unknown>
  submit: (session: Session, body: Readonly<{ ticket: string; signed: readonly string[] }>) => Promise<unknown>
  status: (signature: string, signal?: AbortSignal) => Promise<unknown>
}>

const query = (values: Readonly<Record<string, string>>) => new URLSearchParams(values).toString()

export const collateralApi: CollateralApi = {
  states: (owner, signal) =>
    apiRequest<unknown>('GET', `/api/solana/futures/collateral${owner ? `?${query({ owner })}` : ''}`, undefined, {
      signal,
    }),
  account: (owner, signal) =>
    apiRequest<unknown>('GET', `/api/solana/futures/account?${query({ wallet: owner })}`, undefined, { signal }),
  review: (session, body) =>
    apiRequest<unknown>('POST', '/api/solana/futures/collateral/review', body, {
      session,
      timeoutMs: REVIEW_TIMEOUT_MS,
    }),
  submit: (session, body) =>
    apiRequest<unknown>('POST', '/api/solana/futures/collateral/submit', body, {
      session,
      timeoutMs: SUBMIT_TIMEOUT_MS,
    }),
  status: (signature, signal) =>
    apiRequest<unknown>('GET', `/api/solana/futures/collateral/status?${query({ signatures: signature })}`, undefined, {
      signal,
    }),
}

export type CollateralWallet = Readonly<{ signTransaction: (unsignedWireBase64: string) => Promise<string> }>

/** A route's refusal before anything was built or signed, in the phone's words. */
export function collateralFailureOfError(error: unknown): CollateralFailure {
  if (isNetworkError(error)) return 'network'
  return collateralFailureOf(error instanceof ApiError ? error.code : null)
}

/** The gate's word for this wallet; any failure to read it is a closed gate — the Review asks the server again anyway. */
export async function readCollateralStates(
  api: CollateralApi,
  owner: string | null,
  signal?: AbortSignal,
): Promise<CollateralStates> {
  return parseCollateralStates(await api.states(owner, signal))
}

/** The account's margin as Phoenix states it now — what may leave — or null when the account has none. */
export async function readCollateralMargin(
  api: CollateralApi,
  owner: string,
  signal?: AbortSignal,
): Promise<CollateralMargin | null> {
  const raw = await api.account(owner, signal)
  return parseCollateralMargin(typeof raw === 'object' && raw !== null ? (raw as { margin?: unknown }).margin : null)
}

export type CollateralReviewed =
  /** `receivedAt`: the phone's own clock when the Review arrived — its window is counted from there. */
  | Readonly<{ ok: true; review: CollateralReview; receivedAt: number }>
  | Readonly<{ ok: false; reason: CollateralFailure }>

/** Ask the server for the Review. Nothing is signed here; a refusal says why in the phone's words. */
export async function reviewCollateral(
  api: CollateralApi,
  session: Session,
  body: CollateralBody,
  now: () => number = Date.now,
): Promise<CollateralReviewed> {
  try {
    const review = parseCollateralReview(await api.review(session, body))
    /* The bytes are for the move asked: another action or amount is no Review of it. */
    if (!review || review.action !== body.action || review.amountMicro.toString() !== body.amount) {
      return { ok: false, reason: 'general' }
    }
    return { ok: true, review, receivedAt: now() }
  } catch (error) {
    return { ok: false, reason: collateralFailureOfError(error) }
  }
}

export type CollateralOutcome =
  /** The relay answered, or its answer was lost after the bytes left: the receipt follows the signature on the chain. */
  | Readonly<{ kind: 'sent'; result: CollateralResult }>
  /** Nothing reached the network. `afterSignature` tells which: the wallet signed, and the relay refused before sending. */
  | Readonly<{ kind: 'refused'; reason: CollateralFailure; afterSignature: boolean }>

export type CollateralWait = Readonly<{
  cancel?: WalletCancel | null
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Told the moment the wallet answered with bytes that will be relayed: from then on there is nothing to cancel. */
  onSigned?: () => void
}>

/**
 * Sign the reviewed bytes in the wallet and hand them to the relay, once. Bytes that age out while the wallet is open
 * are never relayed (`reviewAged` — the sheet builds the Review again); once the bytes have left, a lost answer is
 * never «nothing was sent».
 */
export async function signAndRelayCollateral(
  input: Readonly<{
    api: CollateralApi
    wallet: CollateralWallet
    session: Session
    review: CollateralReview
    receivedAt: number
    wait?: CollateralWait
  }>,
): Promise<CollateralOutcome> {
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
    const result = parseCollateralResult(
      await input.api.submit(input.session, { ticket: review.ticket, signed: [signed] }),
    )
    if (result) return { kind: 'sent', result }
    // An answer that is not the relay's may hide a send that landed: the chain is asked.
    return signature
      ? { kind: 'sent', result: { signature, state: 'UNKNOWN' } }
      : { kind: 'refused', reason: 'outcomeUnknown', afterSignature: true }
  } catch (error) {
    if (error instanceof ApiError && COLLATERAL_REFUSED_BEFORE_SENDING.has(error.code)) {
      return { kind: 'refused', reason: collateralFailureOf(error.code), afterSignature: true }
    }
    // No answer, a gateway's page, a code the phone does not know: the bytes may have left — the receipt follows them.
    return signature
      ? { kind: 'sent', result: { signature, state: 'UNKNOWN' } }
      : { kind: 'refused', reason: 'outcomeUnknown', afterSignature: true }
  }
}

/** The status route's word on one signature, merged into what the receipt holds; a read that failed keeps it as it is. */
export async function followCollateral(
  api: CollateralApi,
  current: CollateralResult,
  signal?: AbortSignal,
): Promise<CollateralResult> {
  try {
    return mergeSeen(current, parseCollateralResult(await api.status(current.signature, signal)))
  } catch {
    return current
  }
}
