/**
 * A limit order's one signature and one relay, placed or cancelled — with
 * the wallet and the routes handed in, so it runs the same under the app and
 * under a test with doubles.
 *
 * The one submitter: the server builds the exact bytes, the
 * wallet signs those bytes and nothing else. A signature that went out is never sent again from here: an answer
 * lost after it is an order whose state the server's record and the venue
 * tell — «Мої ордери» reads it, the reconciler settles it and the note
 * «Квитанція готова» says so.
 */

import { ApiError, isNetworkError, needsSignIn, type Session } from '../../lib/api.ts'

import { limitFailureKey, type LimitFailureKey, type LimitReview, type LimitVenue } from './limit-model.ts'
import { termsOf, type LimitsApi } from './limits-api.ts'
import { ledgerBlindSigning, ledgerCanSign, waitForWallet, walletCannotSign, type WalletCancel } from '../wallet/wallet-wait.ts'
import { signFresh } from '../wallet/sign-fresh.ts'

export type LimitWallet = Readonly<{ signTransaction: (unsignedWireBase64: string) => Promise<string> }>

export type LimitOutcome =
  /** The relay answered: the order stands (or is taken back), `settled` when the chain confirmed it. */
  | Readonly<{ kind: 'done'; signature: string; settled: boolean }>
  /**
   * Nothing reached the network: the wallet did not sign, the route refused before the signature, or — after it — the
   * server said so itself (`submitBoundary: NOT_CROSSED`). `afterSignature` tells which: the words differ.
   */
  | Readonly<{ kind: 'refused'; reason: LimitFailureKey; afterSignature: boolean }>
  /** The network answered no: the placement failed on chain and does not stand, or the cancellation failed and the order still waits. */
  | Readonly<{ kind: 'failed'; what: 'place' | 'cancel'; signature: string | null }>
  /** The signed bytes may have reached the network and no definite answer came back: «Мої ордери» and the record tell. */
  | Readonly<{ kind: 'unknown'; signature: string | null }>

/**
 * A refusal before the signature: nothing was signed, so nothing can have been sent.
 */
function before(error: unknown): LimitOutcome {
  if (needsSignIn(error)) return { kind: 'refused', reason: 'signIn', afterSignature: false }
  if (isNetworkError(error)) return { kind: 'refused', reason: 'network', afterSignature: false }
  return { kind: 'refused', reason: limitFailureKey(error instanceof ApiError ? error.code : null), afterSignature: false }
}

/**
 * An answer after the signature. «Nothing sent» only on the server's own word (`NOT_CROSSED`, never an
 * `ALREADY_SUBMITTED` — that one says the bytes are already on their way); the chain's definite «no» is said as
 * that; everything else — a lost answer, a gateway's 504, a body that is not the route's — may hide a relay that
 * landed, and is unknown. Never a second relay from here.
 */
function after(error: unknown, what: 'place' | 'cancel'): LimitOutcome {
  if (!(error instanceof ApiError)) return { kind: 'unknown', signature: null }
  const signature = typeof error.details.signature === 'string' ? error.details.signature : null
  if (error.code === 'PLACEMENT_FAILED' || error.code === 'CANCEL_FAILED') return { kind: 'failed', what, signature }
  if (error.details.submitBoundary === 'NOT_CROSSED' && error.code !== 'ALREADY_SUBMITTED') {
    if (needsSignIn(error)) return { kind: 'refused', reason: 'signIn', afterSignature: true }
    const reason = limitFailureKey(error.code)
    return { kind: 'refused', reason: reason === 'general' ? (what === 'place' ? 'notPlaced' : 'notCancelled') : reason, afterSignature: true }
  }
  // A refusal at the route's gate comes before it reads the body: nothing was relayed (`lib/solana/limits/http.server.ts`).
  if (needsSignIn(error)) return { kind: 'refused', reason: 'signIn', afterSignature: true }
  if (GATE_CODES.has(error.code)) {
    const reason = limitFailureKey(error.code)
    return { kind: 'refused', reason: reason === 'general' ? (what === 'place' ? 'notPlaced' : 'notCancelled') : reason, afterSignature: true }
  }
  return { kind: 'unknown', signature }
}

/** The submit route's own gate, before it reads the signed bytes: the rate limit, the lane's stop, the carrier, the body, the wallet. */
const GATE_CODES: ReadonlySet<string> = new Set(['RATE_LIMITED', 'SWAP_PAUSED', 'WALLET_MISMATCH', 'VALIDATION_ERROR'])

/** The wallet's wait for one signature (M45): ninety seconds at least, «Скасувати», bytes a Ledger can sign only. */
export type LimitWait = Readonly<{
  cancel?: WalletCancel | null
  sleep?: (ms: number) => Promise<void>
  /** The Review's last moment on the phone's clock: a signature after it is never relayed — a new «Перевірка». */
  freshUntil?: number | null
  now?: () => number
  /** Told the moment the wallet answered with bytes that will be relayed: from then on there is nothing to cancel. */
  onSigned?: () => void
  /** What a wait without an answer is called: a new «Перевірка» for a placement, the plain line for an order's cancel. */
  timeoutReason?: LimitFailureKey
}>

/** The signed bytes, or why there are none — nothing reached the network either way. */
async function signed(
  wallet: LimitWallet,
  unsigned: string,
  wait: LimitWait = {},
): Promise<Readonly<{ bytes: string }> | Readonly<{ reason: LimitFailureKey }>> {
  if (!ledgerCanSign(unsigned)) return { reason: 'txVersion' }
  try {
    const answer = await waitForWallet(wallet.signTransaction(unsigned), wait)
    if (answer.kind === 'signed') {
      const now = wait.now ?? Date.now
      if (wait.freshUntil != null && now() > wait.freshUntil) return { reason: 'reviewClosed' }
      wait.onSigned?.()
      return { bytes: answer.value }
    }
    // A signature after the wait is never relayed: the next press builds a new Review.
    return { reason: answer.kind === 'timeout' ? (wait.timeoutReason ?? 'walletTimeout') : 'walletCancelled' }
  } catch (error) {
    return { reason: ledgerBlindSigning(error) ? 'ledgerBlind' : walletCannotSign(error) ? 'walletCannotSign' : 'walletRefused' }
  }
}

/** Sign the reviewed placement in the wallet and hand the bytes to the relay, once. */
export async function placeLimit(
  input: Readonly<{ api: LimitsApi; wallet: LimitWallet; session: Session; review: LimitReview; wait?: LimitWait }>,
): Promise<LimitOutcome> {
  const answer = await signed(input.wallet, input.review.transactionBase64, input.wait)
  if (!('bytes' in answer)) return { kind: 'refused', reason: answer.reason, afterSignature: false }
  const bytes = answer.bytes
  try {
    const answer = await input.api.submit(input.session, {
      kind: 'place',
      venue: input.review.venue,
      owner: input.session.address,
      order: input.review.order,
      requestId: input.review.requestId,
      signedTransactionBase64: bytes,
      terms: termsOf(input.review),
    })
    return { kind: 'done', signature: answer.signature, settled: answer.settled }
  } catch (error) {
    return after(error, 'place')
  }
}

/** Build, sign and relay the cancellation of one order — on DLMM also the taking back of what converted. */
export async function cancelLimit(
  input: Readonly<{
    api: LimitsApi
    wallet: LimitWallet
    session: Session
    order: Readonly<{ venue: LimitVenue; order: string }>
    wait?: LimitWait
  }>,
): Promise<LimitOutcome> {
  /*
   * AG-2: the cancellation is built and signed in one press, and its bytes live ~30 s. A signature the wallet returns
   * later is never relayed: the cancellation is built again and the wallet asked once more; a second late answer
   * tells the person the device must confirm within ~20 s.
   */
  type Built = Readonly<{ transactionBase64: string; requestId: string | null; signableMs?: number }>
  const fresh = await signFresh<Built, string, LimitOutcome, LimitFailureKey>({
    now: input.wait?.now,
    build: async () => {
      try {
        return { ok: true, data: (await input.api.cancel(input.session, input.order)) as Built }
      } catch (error) {
        return { ok: false, failure: before(error) }
      }
    },
    signableMsOf: (built) => built.signableMs ?? null,
    sign: async (built) => {
      const answer = await signed(input.wallet, built.transactionBase64, { timeoutReason: 'walletSilent', ...input.wait, freshUntil: null })
      return 'bytes' in answer ? { ok: true, value: answer.bytes } : { ok: false, error: answer.reason }
    },
  })
  if (!fresh.ok) {
    if (fresh.stage === 'build') return fresh.failure
    if (fresh.stage === 'aged') return { kind: 'refused', reason: fresh.late ? 'deviceConfirm' : 'notCancelled', afterSignature: false }
    return { kind: 'refused', reason: fresh.error, afterSignature: false }
  }
  const built = fresh.built
  const bytes = fresh.signed
  try {
    const answer = await input.api.submit(input.session, {
      kind: 'cancel',
      venue: input.order.venue,
      owner: input.session.address,
      order: input.order.order,
      requestId: built.requestId,
      signedTransactionBase64: bytes,
      terms: null,
    })
    return { kind: 'done', signature: answer.signature, settled: answer.settled }
  } catch (error) {
    return after(error, 'cancel')
  }
}
