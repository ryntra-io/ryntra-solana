/**
 * The three things Launch sends — a token's launch, a trade on its curve or
 * pool, a claim of the creator's fees — each from the server's build to its
 * answer, with the server and the wallet handed in, so they run the same under
 * the app and under a test with doubles. One submitter: the server builds the
 * exact bytes, the wallet signs them through Mobile Wallet Adapter and never
 * sends, the server sends once. Nothing here decides what the server answers;
 * a refusal comes back as its code, with where it happened.
 */

import { ApiError } from '../../lib/api.ts'
import { walletErrorKind } from '../session/session-client.ts'
import type {
  LaunchBuildRequest,
  LaunchBuildResponse,
  LaunchClaimBuildResponse,
  LaunchClaimSubmitResponse,
  LaunchLockId,
  LaunchMetadataRequest,
  LaunchMetadataResponse,
  LaunchPresetId,
  LaunchSubmitRequest,
  LaunchSubmitResponse,
  LaunchTokenResponse,
  LaunchTradeBuildResponse,
  LaunchTradeQuoteResponse,
  LaunchTradeSide,
  LaunchTradeSubmitResponse,
} from '../../lib/api/v1/types.ts'

/** The wallet signs exact transactions, all in one prompt, and hands each back signed — it never sends. */
export type LaunchWallet = Readonly<{ signTransactions: (unsignedWireBase64: readonly string[]) => Promise<string[]> }>

/** Where a refusal came from: before anything reached the network, or at the send — when an answer may be lost after it went out. */
export type LaunchFailure = Readonly<{ step: 'before' | 'send'; code: string; detail: string | null }>

export type FlowStep = 'prepare' | 'sign' | 'send'

/** A refusal, a lost answer or the wallet's own answer into a code: the server's, `UNAVAILABLE`, or `WALLET_REFUSED`. */
export function codeOf(error: unknown): Readonly<{ code: string; detail: string | null }> {
  if (error instanceof ApiError) return { code: error.code, detail: error.message || null }
  return { code: 'UNAVAILABLE', detail: null }
}

/**
 * The wallet's own answer, by what it was: the person's cancel or the
 * wallet's refusal (`WALLET_REFUSED`), no wallet on the phone
 * (`WALLET_NOT_FOUND`), or a wallet that did not finish — a session that
 * timed out, a wallet that closed on its own (`WALLET_FAILED`). Never the server's.
 */
export function walletFailure(error: unknown): Readonly<{ code: string; detail: string | null }> {
  // The app's one reading of a wallet's answer — the same the sign-in and the trade use.
  const kind = walletErrorKind(error)
  if (kind === 'no-wallet') return { code: 'WALLET_NOT_FOUND', detail: null }
  if (kind === 'cancelled') return { code: 'WALLET_REFUSED', detail: null }
  return { code: 'WALLET_FAILED', detail: error instanceof Error ? error.message || null : null }
}

/** A wallet that handed back fewer signed transactions than it was given did not finish. */
const SHORT = { code: 'WALLET_FAILED', detail: null } as const

/* ---------------------------------------------------------------- the launch */

export type CreateApi = Readonly<{
  metadata: (request: LaunchMetadataRequest) => Promise<LaunchMetadataResponse>
  build: (request: LaunchBuildRequest) => Promise<LaunchBuildResponse>
  submit: (request: LaunchSubmitRequest) => Promise<LaunchSubmitResponse>
  token: (mint: string) => Promise<LaunchTokenResponse>
}>

export type CreateInput = Readonly<{
  api: CreateApi
  wallet: LaunchWallet
  creator: string
  preset: LaunchPresetId
  fields: Omit<LaunchMetadataRequest, 'imageBase64'>
  imageBase64: string
  firstBuyRaw: bigint
  lock: LaunchLockId | null
  onStep?: (step: FlowStep) => void
  /** Told what the build costs the creator and how many transactions the wallet signs, before it opens. */
  onBuilt?: (built: Readonly<{ creatorCostLamports: string; transactions: number }>) => void
}>

export type CreateOutcome =
  | Readonly<{
      ok: true
      submit: LaunchSubmitResponse
      /** The token as read after the send; null when that read did not answer — the send's own word stands. */
      token: LaunchTokenResponse | null
      symbol: string
      image: string | null
    }>
  | Readonly<{ ok: false; failure: LaunchFailure; token: string | null }>

/**
 * «Запустити токен»: the picture and words stored, the creation (and the lock)
 * built, signed in one wallet prompt, sent once, the token read back. A lock
 * is asked only with a first buy.
 */
export async function launchToken(input: CreateInput): Promise<CreateOutcome> {
  const step = input.onStep ?? (() => undefined)
  step('prepare')
  let metadata: LaunchMetadataResponse
  let built: LaunchBuildResponse
  try {
    metadata = await input.api.metadata({ ...input.fields, imageBase64: input.imageBase64 })
    built = await input.api.build({
      creator: input.creator,
      preset: input.preset,
      metadataUri: metadata.metadataUri,
      firstBuyRaw: input.firstBuyRaw.toString(),
      lock: input.firstBuyRaw > 0n ? input.lock : null,
    })
  } catch (error) {
    return { ok: false, failure: { step: 'before', ...codeOf(error) }, token: null }
  }
  const lockWire = built.lockUnsignedWireBase64 ?? null
  const splitWire = built.splitUnsignedWireBase64 ?? null
  const wires = [built.unsignedWireBase64, ...(lockWire ? [lockWire] : []), ...(splitWire ? [splitWire] : [])]
  input.onBuilt?.({ creatorCostLamports: built.creatorCostLamports, transactions: wires.length })
  step('sign')
  let signed: string[]
  try {
    signed = await input.wallet.signTransactions(wires)
  } catch (error) {
    return { ok: false, failure: { step: 'before', ...walletFailure(error) }, token: null }
  }
  if (signed.length !== wires.length) return { ok: false, failure: { step: 'before', ...SHORT }, token: null }
  step('send')
  let submitted: LaunchSubmitResponse
  try {
    submitted = await input.api.submit({
      buildId: built.buildId,
      creator: input.creator,
      signedWireBase64: signed[0] as string,
      signedLockWireBase64: lockWire ? (signed[1] ?? null) : null,
      signedSplitWireBase64: splitWire ? (signed[lockWire ? 2 : 1] ?? null) : null,
    })
  } catch (error) {
    return { ok: false, failure: { step: 'send', ...codeOf(error) }, token: built.token }
  }
  let token: LaunchTokenResponse | null = null
  try {
    token = await input.api.token(submitted.token)
  } catch {
    token = null
  }
  return { ok: true, submit: submitted, token, symbol: metadata.symbol, image: metadata.imageUrl }
}

/**
 * The send's refusals the server answers before anything reaches the network:
 * after any of these nothing landed. «The network refused it»
 * (`LAUNCH_SUBMIT_FAILED`) is not among them: the server has said it of a
 * launch that landed (its confirmation never saw the transaction before the
 * blockhash expired), so it is read as «may have landed» until the chain says.
 */
const SEND_REFUSALS = [
  'LAUNCH_BUILD_USED',
  'LAUNCH_BUILD_EXPIRED',
  'LAUNCH_SIGNED_OTHER_BYTES',
  'LAUNCH_SLIPPAGE',
  'LAUNCH_BALANCE_LOW',
  'LAUNCH_GRADUATING',
  'WALLET_MISMATCH',
  'LAUNCH_PAUSED',
  'RATE_LIMITED',
  'VALIDATION_ERROR',
  'LAUNCH_LIMIT',
  'LAUNCH_FIRST_BUY_ABOVE_CAP',
  'LAUNCH_NAME_BORROWED',
  'LAUNCH_NOT_FOUND',
  'LAUNCH_UNAVAILABLE',
  'LAUNCH_NOTHING_TO_CLAIM',
  'WALLET_CHANGED',
]

/**
 * The answer to a send was lost — no answer, a gateway's error without a
 * code, the server's own failure — so what was sent may have landed. Said as
 * «Відповідь не прийшла», never as «Нічого не надіслано».
 */
export function lostAfterSend(failure: LaunchFailure): boolean {
  return failure.step === 'send' && !SEND_REFUSALS.includes(failure.code)
}

/* ---------------------------------------------------------------- a trade */

export type TradeApi = Readonly<{
  build: (
    request: Readonly<{ wallet: string; side: LaunchTradeSide; amountRaw: string; slippageBps: number }>,
  ) => Promise<LaunchTradeBuildResponse>
  submit: (
    request: Readonly<{ buildId: string; wallet: string; signedWireBase64: string }>,
  ) => Promise<LaunchTradeSubmitResponse>
}>

export type TradeOutcome =
  | Readonly<{ ok: true; side: LaunchTradeSide; quote: LaunchTradeQuoteResponse; submit: LaunchTradeSubmitResponse }>
  | Readonly<{ ok: false; failure: LaunchFailure }>

/** «Купити» / «Продати»: the swap built for this wallet, signed, sent once. */
export async function tradeLaunch(
  input: Readonly<{
    api: TradeApi
    wallet: LaunchWallet
    address: string
    side: LaunchTradeSide
    amountRaw: bigint
    slippageBps: number
    onStep?: (step: FlowStep) => void
  }>,
): Promise<TradeOutcome> {
  const step = input.onStep ?? (() => undefined)
  step('prepare')
  let built: LaunchTradeBuildResponse
  try {
    built = await input.api.build({
      wallet: input.address,
      side: input.side,
      amountRaw: input.amountRaw.toString(),
      slippageBps: input.slippageBps,
    })
  } catch (error) {
    return { ok: false, failure: { step: 'before', ...codeOf(error) } }
  }
  step('sign')
  let signed: string[]
  try {
    signed = await input.wallet.signTransactions([built.unsignedWireBase64])
  } catch (error) {
    return { ok: false, failure: { step: 'before', ...walletFailure(error) } }
  }
  if (!signed[0]) return { ok: false, failure: { step: 'before', ...SHORT } }
  step('send')
  try {
    const submit = await input.api.submit({
      buildId: built.buildId,
      wallet: input.address,
      signedWireBase64: signed[0],
    })
    return { ok: true, side: input.side, quote: built.quote, submit }
  } catch (error) {
    return { ok: false, failure: { step: 'send', ...codeOf(error) } }
  }
}

/* ---------------------------------------------------------------- a claim */

export type ClaimApi = Readonly<{
  build: (request: Readonly<{ wallet: string }>) => Promise<LaunchClaimBuildResponse>
  submit: (
    request: Readonly<{ buildId: string; wallet: string; signedWireBase64: readonly string[] }>,
  ) => Promise<LaunchClaimSubmitResponse>
}>

export type ClaimOutcome =
  Readonly<{ ok: true; result: LaunchClaimSubmitResponse }> | Readonly<{ ok: false; failure: LaunchFailure }>

/**
 * «Забрати»: every source holding a fee now, in one transaction or two, signed
 * in one wallet prompt and handed to the server in the order it built them —
 * it sends them once, in that order.
 */
export async function claimFees(
  input: Readonly<{
    api: ClaimApi
    wallet: LaunchWallet
    address: string
    onStep?: (step: FlowStep) => void
    onBuilt?: (built: LaunchClaimBuildResponse) => void
  }>,
): Promise<ClaimOutcome> {
  const step = input.onStep ?? (() => undefined)
  step('prepare')
  let built: LaunchClaimBuildResponse
  try {
    built = await input.api.build({ wallet: input.address })
  } catch (error) {
    return { ok: false, failure: { step: 'before', ...codeOf(error) } }
  }
  input.onBuilt?.(built)
  step('sign')
  let signed: string[]
  try {
    signed = await input.wallet.signTransactions(built.unsignedWireBase64)
  } catch (error) {
    return { ok: false, failure: { step: 'before', ...walletFailure(error) } }
  }
  if (signed.length !== built.unsignedWireBase64.length) return { ok: false, failure: { step: 'before', ...SHORT } }
  step('send')
  try {
    const result = await input.api.submit({ buildId: built.buildId, wallet: input.address, signedWireBase64: signed })
    return { ok: true, result }
  } catch (error) {
    return { ok: false, failure: { step: 'send', ...codeOf(error) } }
  }
}
