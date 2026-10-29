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
import { signFresh } from '../wallet/sign-fresh.ts'
import { walletCannotSign } from '../wallet/wallet-wait.ts'

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
  if (walletCannotSign(error)) return { code: 'WALLET_CANNOT_SIGN', detail: null }
  const kind = walletErrorKind(error)
  if (kind === 'no-wallet') return { code: 'WALLET_NOT_FOUND', detail: null }
  if (kind === 'cancelled') return { code: 'WALLET_REFUSED', detail: null }
  return { code: 'WALLET_FAILED', detail: error instanceof Error ? error.message || null : null }
}

/** A wallet that handed back fewer signed transactions than it was given did not finish. */
const SHORT = { code: 'WALLET_FAILED', detail: null } as const

/**
 * AG-2: the build's bytes live ~30 s, less a margin for each transaction sent after the first. The server says how long
 * from arrival they may still be signed (`signableMs`, contract-additive — the pinned types predate it).
 */
function buildSignableMs(built: unknown): number | null {
  const given = (built as Readonly<{ signableMs?: unknown }>).signableMs
  return typeof given === 'number' ? given : null
}

/** A signature after the bytes' window, twice in a row: nothing was sent; the device has to confirm within ~20 s. */
const AGED_LATE = { code: 'LAUNCH_SIGN_LATE', detail: null } as const
/** Both builds came with too little of their life for a wallet: nothing was asked, nothing sent. */
const AGED_SHORT = { code: 'LAUNCH_BYTES_SHORT', detail: null } as const
/** A rebuild whose figures came out worse than the first: nothing was sent; the person looks at the figures again. */
const MOVED = { code: 'LAUNCH_QUOTE_MOVED', detail: null } as const

/* ---------------------------------------------------------------- the launch */

/**
 * 1.71.0 (MC-1): `format: "v1"` — the wallet signs v1; on Micro and the demo market the one way a first buy (and its
 * lock, in the same transaction) is built. Contract-additive — the pinned types (1.66.0) predate it; the pin follows
 * production.
 */
export type LaunchBuildRequestV1 = LaunchBuildRequest & Readonly<{ format?: 'v1' }>

export type CreateApi = Readonly<{
  metadata: (request: LaunchMetadataRequest) => Promise<LaunchMetadataResponse>
  build: (request: LaunchBuildRequestV1) => Promise<LaunchBuildResponse>
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
  /**
   * The wallet signs v1 (1.71.0): on Micro a first purchase and its lock are then one transaction — the build answers
   * `lockUnsignedWireBase64: null` and the wallet signs one. Sent only with a first purchase.
   */
  format?: 'v1'
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
  try {
    metadata = await input.api.metadata({ ...input.fields, imageBase64: input.imageBase64 })
  } catch (error) {
    return { ok: false, failure: { step: 'before', ...codeOf(error) }, token: null }
  }
  const wiresOf = (b: LaunchBuildResponse) => [
    b.unsignedWireBase64,
    ...(b.lockUnsignedWireBase64 ? [b.lockUnsignedWireBase64] : []),
    ...(b.splitUnsignedWireBase64 ? [b.splitUnsignedWireBase64] : []),
  ]
  /* AG-2: signed after the bytes' window, the launch is built again (never sent dead) — only if the first buy still gets at least as much. */
  let first: LaunchBuildResponse | null = null
  type Stop = Readonly<{ code: string; detail: string | null }>
  let rebuilding = false
  const fresh = await signFresh<LaunchBuildResponse, string[], Stop, Stop>({
    build: async () => {
      // The first build is the «prepare» the flow already said; a second one says it again.
      if (rebuilding) step('prepare')
      rebuilding = true
      try {
        const b = await input.api.build({
          creator: input.creator,
          preset: input.preset,
          metadataUri: metadata.metadataUri,
          firstBuyRaw: input.firstBuyRaw.toString(),
          lock: input.firstBuyRaw > 0n ? input.lock : null,
          ...(input.format && input.firstBuyRaw > 0n ? { format: input.format } : {}),
        })
        if (first && BigInt(b.firstBuyOutRaw) < BigInt(first.firstBuyOutRaw)) return { ok: false, failure: MOVED }
        first ??= b
        return { ok: true, data: b }
      } catch (error) {
        return { ok: false, failure: codeOf(error) }
      }
    },
    signableMsOf: buildSignableMs,
    sign: async (b) => {
      const wires = wiresOf(b)
      input.onBuilt?.({ creatorCostLamports: b.creatorCostLamports, transactions: wires.length })
      step('sign')
      try {
        const signed = await input.wallet.signTransactions(wires)
        return signed.length === wires.length ? { ok: true, value: signed } : { ok: false, error: SHORT }
      } catch (error) {
        return { ok: false, error: walletFailure(error) }
      }
    },
  })
  if (!fresh.ok) {
    const failure =
      fresh.stage === 'build'
        ? fresh.failure
        : fresh.stage === 'sign'
          ? fresh.error
          : fresh.late
            ? AGED_LATE
            : AGED_SHORT
    return { ok: false, failure: { step: 'before', ...failure }, token: null }
  }
  const built = fresh.built
  const signed = fresh.signed
  const lockWire = built.lockUnsignedWireBase64 ?? null
  const splitWire = built.splitUnsignedWireBase64 ?? null
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
  /* AG-2: signed after the bytes' window, the trade is built again — only if its minimum and fee are no worse. */
  let first: LaunchTradeBuildResponse | null = null
  type Stop = Readonly<{ code: string; detail: string | null }>
  let rebuilding = false
  const fresh = await signFresh<LaunchTradeBuildResponse, string[], Stop, Stop>({
    build: async () => {
      // The first build is the «prepare» the flow already said; a second one says it again.
      if (rebuilding) step('prepare')
      rebuilding = true
      try {
        const b = await input.api.build({
          wallet: input.address,
          side: input.side,
          amountRaw: input.amountRaw.toString(),
          slippageBps: input.slippageBps,
        })
        if (
          first &&
          (BigInt(b.quote.minimumOutRaw) < BigInt(first.quote.minimumOutRaw) ||
            BigInt(b.quote.fee.totalRaw) > BigInt(first.quote.fee.totalRaw))
        ) {
          return { ok: false, failure: MOVED }
        }
        first ??= b
        return { ok: true, data: b }
      } catch (error) {
        return { ok: false, failure: codeOf(error) }
      }
    },
    signableMsOf: buildSignableMs,
    sign: async (b) => {
      step('sign')
      try {
        const signed = await input.wallet.signTransactions([b.unsignedWireBase64])
        return signed[0] ? { ok: true, value: signed } : { ok: false, error: SHORT }
      } catch (error) {
        return { ok: false, error: walletFailure(error) }
      }
    },
  })
  if (!fresh.ok) {
    const failure =
      fresh.stage === 'build'
        ? fresh.failure
        : fresh.stage === 'sign'
          ? fresh.error
          : fresh.late
            ? AGED_LATE
            : AGED_SHORT
    return { ok: false, failure: { step: 'before', ...failure } }
  }
  const built = fresh.built
  const signed = fresh.signed as [string, ...string[]]
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
  /* AG-2: signed after the bytes' window, the claim is built again and the wallet asked once more — never sent dead. */
  type Stop = Readonly<{ code: string; detail: string | null }>
  let rebuilding = false
  const fresh = await signFresh<LaunchClaimBuildResponse, string[], Stop, Stop>({
    build: async () => {
      // The first build is the «prepare» the flow already said; a second one says it again.
      if (rebuilding) step('prepare')
      rebuilding = true
      try {
        const b = await input.api.build({ wallet: input.address })
        input.onBuilt?.(b)
        return { ok: true, data: b }
      } catch (error) {
        return { ok: false, failure: codeOf(error) }
      }
    },
    signableMsOf: buildSignableMs,
    sign: async (b) => {
      step('sign')
      try {
        const signed = await input.wallet.signTransactions(b.unsignedWireBase64)
        return signed.length === b.unsignedWireBase64.length ? { ok: true, value: signed } : { ok: false, error: SHORT }
      } catch (error) {
        return { ok: false, error: walletFailure(error) }
      }
    },
  })
  if (!fresh.ok) {
    const failure =
      fresh.stage === 'build'
        ? fresh.failure
        : fresh.stage === 'sign'
          ? fresh.error
          : fresh.late
            ? AGED_LATE
            : AGED_SHORT
    return { ok: false, failure: { step: 'before', ...failure } }
  }
  const built = fresh.built
  const signed = fresh.signed
  step('send')
  try {
    const result = await input.api.submit({ buildId: built.buildId, wallet: input.address, signedWireBase64: signed })
    return { ok: true, result }
  } catch (error) {
    return { ok: false, failure: { step: 'send', ...codeOf(error) } }
  }
}
