/**
 * One transfer, from the Review to the receipt, and one payment of a Ryntra
 * link — with their dependencies handed in, so they run the same under the app
 * and under a test with doubles. The one submitter: the
 * server builds the exact bytes and «Перевірка», the wallet signs those bytes
 * and nothing else, the server submits once and observes. As on the web, the
 * Review is built again at the press of «Підтвердити в гаманці» — a blockhash
 * lives a minute — and a Review whose terms moved goes back to the person
 * instead of to the wallet. A signature is written down before the settle is
 * asked, and kept until an answer that cannot change.
 */

import { ApiError } from '../../lib/api.ts'
import type {
  PaySubmitResponse,
  PayTransactionRequest,
  PayTransactionResponse,
  SendReturnedRequest,
  SendReturnedResponse,
  TransferAdoptedReview,
  TransferInput,
  TransferRecovery,
  TransferReview,
  TransferSettleRequest,
  TransferSettleResult,
} from '../../lib/api/v1/types.ts'
import {
  decideResume,
  resumeReadOf,
  sendFailureKey,
  settleOutcome,
  settleRefusedBeforeSubmit,
  type PendingSend,
  type ResumeShow,
  type SendFailureKey,
  type SendOutcome,
} from './money-model.ts'

export type SendApi = Readonly<{
  plan: (input: TransferInput) => Promise<TransferReview>
  returned: (request: SendReturnedRequest) => Promise<SendReturnedResponse>
  adopt: (request: TransferSettleRequest) => Promise<TransferAdoptedReview>
  settle: (request: TransferSettleRequest) => Promise<TransferSettleResult>
}>

/** The wallet signs the exact bytes and hands the signed wire back; it never sends. */
export type SendWallet = Readonly<{ signTransaction: (unsignedWireBase64: string) => Promise<string> }>

export type PendingStore = Readonly<{
  get: (wallet: string) => PendingSend | null
  set: (pending: PendingSend) => void
  clear: (wallet: string) => void
}>

export type SendFailure = Readonly<{ code: string; key: SendFailureKey }>

/** A refusal, a network failure or a wallet's answer into the card's words. */
export function failureOf(error: unknown): SendFailure {
  if (error instanceof ApiError) return { code: error.code, key: sendFailureKey(error.code) }
  const code = walletCode(error)
  if (code) return { code, key: sendFailureKey(code) }
  return { code: 'NETWORK', key: 'network' }
}

/** A wallet's refusal, a closed sheet or no wallet — as a code; null when the error is not the wallet's. */
function walletCode(error: unknown): string | null {
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
  if (code.startsWith('ERROR_') || /wallet/i.test(text)) return 'WALLET_FAILED'
  return null
}

function walletFailure(error: unknown): SendFailure {
  const code = walletCode(error) ?? 'WALLET_FAILED'
  return { code, key: sendFailureKey(code) }
}

/** The Review's parts exactly as served — echoed into adopt and settle. */
export function reviewParts(
  review: TransferReview | TransferAdoptedReview,
  signedWireBase64: string,
): TransferSettleRequest {
  return {
    plan: review.plan,
    preflight: review.preflight,
    verdict: review.verdict,
    provider: review.provider,
    canaryIntent: review.canaryIntent,
    canaryVerdict: review.canaryVerdict,
    reviewProof: review.reviewProof,
    signedWireBase64,
  }
}

function returnedRequest(
  review: TransferReview | TransferAdoptedReview,
  signedWireBase64: string,
): SendReturnedRequest {
  return {
    plan: {
      actionKind: review.plan.actionKind,
      unsignedWireBase64: review.plan.unsignedWireBase64,
      fingerprint: { messageHash: review.plan.fingerprint.messageHash, feePayer: review.plan.fingerprint.feePayer },
    },
    signedWireBase64,
  }
}

/** Whether a fresh Review still states the transfer the person read: the same sender, recipient, asset and amount. */
export function sameTerms(read: TransferReview, fresh: TransferReview): boolean {
  return (
    read.check.from === fresh.check.from &&
    read.check.to.address === fresh.check.to.address &&
    read.check.asset.mint === fresh.check.asset.mint &&
    read.check.send.raw === fresh.check.send.raw &&
    read.check.receive.raw === fresh.check.receive.raw &&
    read.check.to.opensAccount === fresh.check.to.opensAccount &&
    (read.check.setup === null) === (fresh.check.setup === null) &&
    (read.check.minimum === null) === (fresh.check.minimum === null) &&
    read.check.warnings.map((warning) => warning.code).join() ===
      fresh.check.warnings.map((warning) => warning.code).join()
  )
}

export type ReviewOutcome =
  Readonly<{ ok: true; review: TransferReview }> | Readonly<{ ok: false; failure: SendFailure }>

/** «Перевірити переказ»: the server's exact transfer and its «Перевірка». */
export async function reviewTransfer(
  input: Readonly<{ api: SendApi; transfer: TransferInput }>,
): Promise<ReviewOutcome> {
  try {
    return { ok: true, review: await input.api.plan(input.transfer) }
  } catch (error) {
    return { ok: false, failure: failureOf(error) }
  }
}

export type SendResult =
  | Readonly<{
      ok: true
      outcome: SendOutcome
      result: TransferSettleResult
      review: TransferReview | TransferAdoptedReview
    }>
  | Readonly<{
      ok: false
      failure: SendFailure
      /** `review`: nothing was sent — the Review stands, is void, or was replaced; `open`: a signature is out and its outcome unknown. */
      phase: 'review' | 'open'
      /** A fresh Review to read instead of the old one — its terms moved, or it is not signable. */
      review?: TransferReview
      signature?: string | null
    }>

/**
 * «Підтвердити в гаманці»: the Review rebuilt, judged, signed, read back and
 * settled once. Refused at once while this wallet has a signed transfer with
 * no outcome — signing over it would drop the record that stops a duplicate.
 */
export async function sendReviewed(
  input: Readonly<{
    api: SendApi
    wallet: SendWallet
    pending: PendingStore
    read: TransferReview
    transfer: TransferInput
    summary: PendingSend['summary']
    now?: () => number
    /** True once the person closed the Review or changed the ticket: the wallet is then never opened. */
    cancelled?: () => boolean
    /** A development build says which step ended how; no secret is in it. */
    trace?: (step: string, detail: string) => void
    /** Told when the wallet opens, and when the signature is written down and the send begins. */
    onSigning?: () => void
    onSending?: () => void
  }>,
): Promise<SendResult> {
  const now = input.now ?? Date.now
  const sender = input.transfer.sender
  if (input.pending.get(sender))
    return { ok: false, failure: { code: 'SUBMISSION_UNKNOWN', key: 'earlier' }, phase: 'review' }

  let fresh: TransferReview
  try {
    fresh = await input.api.plan(input.transfer)
  } catch (error) {
    return { ok: false, failure: failureOf(error), phase: 'review' }
  }
  if (!sameTerms(input.read, fresh)) {
    return { ok: false, failure: { code: 'REVIEW_CHANGED', key: 'changed' }, phase: 'review', review: fresh }
  }
  if (!fresh.check.signable) {
    return { ok: false, failure: { code: 'NOT_SENDABLE', key: 'cannotSend' }, phase: 'review', review: fresh }
  }

  if (input.cancelled?.()) return { ok: false, failure: { code: 'CANCELLED', key: 'walletCancelled' }, phase: 'review' }

  input.onSigning?.()
  let signed: string
  try {
    signed = await input.wallet.signTransaction(fresh.plan.unsignedWireBase64)
  } catch (error) {
    return { ok: false, failure: walletFailure(error), phase: 'review', review: fresh }
  }

  let returned: SendReturnedResponse
  try {
    returned = await input.api.returned(returnedRequest(fresh, signed))
  } catch (error) {
    return { ok: false, failure: failureOf(error), phase: 'review', review: fresh }
  }
  input.trace?.('returned', `${returned.verdict} → ${returned.next}: ${returned.detail}`)
  // A signed transfer is never settled without its signature written down first.
  if (returned.next === 'stop' || !returned.signature) {
    return { ok: false, failure: { code: returned.verdict, key: 'bytes' }, phase: 'review' }
  }

  // Written before the request, not after the answer: everything after this line may be lost, and these bytes are signed.
  const signature = returned.signature
  input.pending.set({
    schema: 'ryntra.mobile.send-pending',
    wallet: sender,
    signature,
    network: 'mainnet',
    signedAt: new Date(now()).toISOString(),
    summary: input.summary,
  })
  input.onSending?.()

  let bundle: TransferReview | TransferAdoptedReview = fresh
  if (returned.next === 'adopt') {
    try {
      bundle = await input.api.adopt(reviewParts(fresh, signed))
      const again = await input.api.returned(returnedRequest(bundle, signed))
      if (again.next !== 'settle') {
        input.pending.clear(sender)
        return { ok: false, failure: { code: again.verdict, key: 'bytes' }, phase: 'review' }
      }
    } catch (error) {
      // Adopt and the reading never broadcast: the bytes went nowhere.
      input.pending.clear(sender)
      return { ok: false, failure: failureOf(error), phase: 'review' }
    }
    if (!bundle.check.signable) {
      input.pending.clear(sender)
      return { ok: false, failure: { code: 'NOT_SENDABLE', key: 'cannotSend' }, phase: 'review' }
    }
  }

  let result: TransferSettleResult
  try {
    result = await input.api.settle(reviewParts(bundle, signed))
  } catch (error) {
    const failure = failureOf(error)
    const named =
      error instanceof ApiError && typeof error.details.signature === 'string' ? error.details.signature : null
    if (error instanceof ApiError && settleRefusedBeforeSubmit(error.code, named)) {
      input.pending.clear(sender)
      return { ok: false, failure, phase: 'review' }
    }
    // No answer, an unknown submission, a deadline: the record stays, and only reading it may close it.
    return { ok: false, failure, phase: 'open', signature: named ?? signature }
  }
  const outcome = settleOutcome(result)
  if (outcome !== 'open') input.pending.clear(sender)
  return { ok: true, outcome, result, review: bundle }
}

/** How long a check keeps asking while the network has not decided, and how often — the web's bounds. */
export const RESUME_DEADLINE_MS = 150_000
export const RESUME_INTERVAL_MS = 3_000

/**
 * Read one signed transfer again until the network has an answer or the
 * deadline passes. Nothing here re-signs or re-sends; the record is dropped
 * only on an answer that cannot change.
 */
export async function resumePending(
  input: Readonly<{
    recover: (signature: string) => Promise<TransferRecovery>
    pending: PendingStore
    record: PendingSend
    show: (show: ResumeShow) => void
    live: () => boolean
    now?: () => number
    sleep?: (ms: number) => Promise<void>
  }>,
): Promise<ResumeShow> {
  const now = input.now ?? Date.now
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline = now() + RESUME_DEADLINE_MS
  input.show('CHECKING')
  for (;;) {
    let read: ReturnType<typeof resumeReadOf> | null = null
    try {
      read = resumeReadOf(await input.recover(input.record.signature))
    } catch {
      read = null
    }
    if (!input.live()) return null
    const decision = decideResume({ read, ageMs: now() - Date.parse(input.record.signedAt) })
    input.show(decision.show)
    if (decision.forget) input.pending.clear(input.record.wallet)
    if (!decision.keepPolling || now() >= deadline) return decision.show
    await sleep(RESUME_INTERVAL_MS)
    if (!input.live()) return null
  }
}

/* ---- paying a Ryntra link (its own routes; the payer is the session's wallet) ---- */

export type PayApi = Readonly<{
  transaction: (id: string, request: PayTransactionRequest) => Promise<PayTransactionResponse>
  submit: (id: string, request: Readonly<{ intentId: string; signedWireBase64: string }>) => Promise<PaySubmitResponse>
}>

export type PayFailure = Readonly<{
  code: string
  key: 'payFailed' | 'payRefused' | 'paySelf' | 'payPending' | 'network' | 'signIn'
}>

function payFailureOf(error: unknown): PayFailure {
  if (error instanceof ApiError) {
    const code = error.code
    if (code === 'SELF_PAYMENT') return { code, key: 'paySelf' }
    if (code === 'PAYMENT_PENDING' || code === 'ALREADY_SUBMITTED') return { code, key: 'payPending' }
    if (
      code === 'UNAUTHORIZED' ||
      code === 'SESSION_EXPIRED' ||
      code === 'SESSION_REVOKED' ||
      code === 'WALLET_MISMATCH'
    )
      return { code, key: 'signIn' }
    return { code, key: 'payFailed' }
  }
  return walletCode(error) ? { code: 'WALLET_REFUSED', key: 'payRefused' } : { code: 'NETWORK', key: 'network' }
}

/** \`sent: 'no'\` — refused, nothing reached the network; \`'unknown'\` — no answer: the link's own state decides. */
export type PayResult =
  | Readonly<{ ok: true; signature: string; createsAccount: boolean }>
  | Readonly<{ ok: false; failure: PayFailure; sent: 'no' | 'unknown' }>

/** «Оплатити»: the link's own transfer with its reference, signed in the wallet, sent once by the server. */
export async function payLink(
  input: Readonly<{
    api: PayApi
    wallet: SendWallet
    id: string
    payer: string
    amount: string | null
    /** Told when the wallet opens, with whether this payment opens the recipient's account (its rent the payer covers). */
    onSigning?: (createsAccount: boolean) => void
    onSending?: () => void
  }>,
): Promise<PayResult> {
  let prepared: PayTransactionResponse
  try {
    prepared = await input.api.transaction(input.id, {
      payer: input.payer,
      ...(input.amount !== null ? { amount: input.amount } : {}),
    })
  } catch (error) {
    return { ok: false, failure: payFailureOf(error), sent: 'no' }
  }
  // A transaction the server already saw fail in simulation never reaches the wallet.
  if (prepared.data.simulated && !prepared.data.simulated.succeeded) {
    return { ok: false, failure: { code: 'SIMULATION_FAILED', key: 'payFailed' }, sent: 'no' }
  }
  input.onSigning?.(prepared.data.createsRecipientAccount)
  let signed: string
  try {
    signed = await input.wallet.signTransaction(prepared.data.unsignedWireBase64)
  } catch {
    return { ok: false, failure: { code: 'WALLET_REFUSED', key: 'payRefused' }, sent: 'no' }
  }
  input.onSending?.()
  try {
    const sent = await input.api.submit(input.id, { intentId: prepared.data.intentId, signedWireBase64: signed })
    return { ok: true, signature: sent.data.signature, createsAccount: prepared.data.createsRecipientAccount }
  } catch (error) {
    // A refusal the server stated (4xx) never broadcast; no answer, a timeout or a server failure is open — the link's state decides.
    const refused = error instanceof ApiError && error.status >= 400 && error.status < 500
    return { ok: false, failure: payFailureOf(error), sent: refused ? 'no' : 'unknown' }
  }
}
