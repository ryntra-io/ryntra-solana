/**
 * What Launch's screens say, decided once and in one place: a refusal's
 * words by its code and where it happened, a claim's outcome, the launch's
 * outcome, the «Чесний лаунч» mark by whose liquidity it is, a fact of risk
 * by its figures. The server's figures are never recomputed — only read and
 * said. Pure: the screens and the tests read it.
 */

import type {
  LaunchCabinetRow,
  LaunchClaimSubmitResponse,
  LaunchCreatorCabinetResponse,
  LaunchMarketResponse,
  LaunchRiskFact,
  LaunchSubmitResponse,
  LaunchTokenResponse,
} from '../../lib/api/v1/types.ts'
import type { LaunchWord, LaunchWordKey } from './copy.ts'
import { lostAfterSend, type LaunchFailure } from './launch-flow.ts'

/** Launch's operator stop: a build or a send waits — said as a pause, never as a person's failure. */
export const PAUSED_CODE = 'LAUNCH_PAUSED'

export function isPaused(code: string | null | undefined): boolean {
  return code === PAUSED_CODE
}

/** The launch's refusal in the person's words; the server's own message stays one tap deeper. */
export function createFailureKey(failure: LaunchFailure): LaunchWordKey {
  // Whatever the code, an answer at the send that may hide a landed launch is said as such first.
  if (lostAfterSend(failure)) return 'errUnknownAfterSend'
  switch (failure.code) {
    case 'WALLET_REFUSED':
      return 'errWalletRefused'
    case 'WALLET_NOT_FOUND':
      return 'walletMissing'
    case 'WALLET_FAILED':
      return 'walletUnfinished'
    case 'LAUNCH_NAME_BORROWED':
      return 'errBorrowedServer'
    case 'LAUNCH_IMAGE_INVALID':
      return 'pictureBad'
    case 'LAUNCH_LIMIT':
      return 'errLimit'
    case 'LAUNCH_PAUSED':
      return 'errLaunchingPaused'
    case 'RATE_LIMITED':
      return 'errRateLimited'
    case 'LAUNCH_FIRST_BUY_ABOVE_CAP':
      return 'errAboveCap'
    case 'LAUNCH_BUILD_EXPIRED':
      return 'errExpired'
    case 'LAUNCH_BUILD_USED':
      return 'errUsed'
    case 'LAUNCH_SIGNED_OTHER_BYTES':
      return 'errSignedOther'
    case 'LAUNCH_SUBMIT_FAILED':
      return 'errSubmit'
    default:
      if (lostAfterSend(failure)) return 'errUnknownAfterSend'
      // The build simulated for this wallet and the network refused it — most often too little SOL for the cost.
      if (failure.step === 'before' && /does not simulate/i.test(failure.detail ?? '')) return 'buildNotSimulated'
      return 'errGeneric'
  }
}

/** The title over a refusal: «Відповідь не прийшла» when what was sent may have landed. */
export function sendTitleKey(failure: LaunchFailure, title: LaunchWordKey): LaunchWordKey {
  return lostAfterSend(failure) ? 'errClaimTitleUnknown' : title
}

/** A trade's refusal in the person's words; at the send with no answer, it may have gone through. */
export function tradeFailureKey(code: string, atSend = false): LaunchWordKey {
  if (atSend && lostAfterSend({ step: 'send', code, detail: null })) return 'tradeUnknown'
  switch (code) {
    case 'LAUNCH_BALANCE_LOW':
      return 'errBalance'
    case 'LAUNCH_GRADUATING':
      return 'errGraduating'
    case 'LAUNCH_BUILD_EXPIRED':
      return 'errTradeExpired'
    case 'LAUNCH_SLIPPAGE':
      return 'errSlippage'
    case 'LAUNCH_SUBMIT_FAILED':
      return 'errTradeSubmit'
    case 'LAUNCH_SIGNED_OTHER_BYTES':
      return 'errSignedOther'
    case 'WALLET_REFUSED':
      return 'errWalletRefused'
    case 'WALLET_NOT_FOUND':
      return 'walletMissing'
    case 'WALLET_FAILED':
      return 'walletUnfinished'
    case 'LAUNCH_PAUSED':
      return 'errLaunchPaused'
    case 'RATE_LIMITED':
      return 'errRateLimited'
    default:
      return 'errGeneric'
  }
}

/** The codes after which nothing was claimed for certain — even when they came at the send. */
const CLAIM_KNOWN = [
  'LAUNCH_NOTHING_TO_CLAIM',
  'LAUNCH_SIGNED_OTHER_BYTES',
  'LAUNCH_BUILD_EXPIRED',
  'WALLET_CHANGED',
  'WALLET_MISMATCH',
  'LAUNCH_NOT_FOUND',
  'LAUNCH_PAUSED',
]

/** The title says only what is known: «nothing was claimed» where the claim was refused, else what happened. */
export function claimFailureTitleKey(code: string, atSend: boolean): LaunchWordKey {
  if (code === 'LAUNCH_BUILD_USED') return 'errClaimTitleSent'
  return atSend && !CLAIM_KNOWN.includes(code) ? 'errClaimTitleUnknown' : 'errClaimTitle'
}

export function claimFailureKey(code: string, atSend: boolean): LaunchWordKey {
  switch (code) {
    case 'LAUNCH_NOTHING_TO_CLAIM':
      return 'errClaimNothing'
    case 'WALLET_MISMATCH':
      return 'errClaimMismatch'
    case 'WALLET_CHANGED':
      return 'errClaimWalletChanged'
    case 'LAUNCH_BUILD_EXPIRED':
      return 'errTradeExpired'
    case 'LAUNCH_SIGNED_OTHER_BYTES':
      return 'errSignedOther'
    case 'LAUNCH_SUBMIT_FAILED':
      // At the send it may still have landed: the receipts below say.
      return atSend ? 'errClaimUnknown' : 'errClaimSubmit'
    case 'LAUNCH_BUILD_USED':
      return 'errClaimUsed'
    case 'LAUNCH_PAUSED':
      return 'errLaunchPaused'
    case 'RATE_LIMITED':
      return 'errRateLimited'
    case 'WALLET_NOT_FOUND':
      return 'walletMissing'
    case 'WALLET_FAILED':
      return 'walletUnfinished'
    default:
      // No answer at the send is not «nothing was sent»: the claim may have gone out.
      return atSend ? 'errClaimUnknown' : 'errGeneric'
  }
}

export type ClaimView = Readonly<{
  kind: 'done' | 'partial' | 'pending'
  receivedRaw: bigint
  /** A part that went into the shared vault — the wallet itself received nothing yet: the sum the programs paid in. */
  intoVaultRaw: bigint | null
  /** Every transaction the claim sent, landed or not yet. */
  signatures: readonly string[]
}>

/**
 * A claim's answer as the person reads it: «Забрано» only when every
 * transaction landed; «Забрано частину» only when something was received
 * and a later one did not land; otherwise «Надіслано — ще не підтверджено».
 */
export function claimView(result: LaunchClaimSubmitResponse): ClaimView {
  const receivedRaw = result.receipts.reduce((total, receipt) => total + BigInt(receipt.receivedRaw), 0n)
  const paidRaw = result.receipts.reduce(
    (total, receipt) => total + BigInt(receipt.paid.curve) + BigInt(receipt.paid.graduation) + BigInt(receipt.paid.lp),
    0n,
  )
  const signatures = [...result.receipts.map((receipt) => receipt.signature), ...result.pending]
  if (result.state === 'CONFIRMED') return { kind: 'done', receivedRaw, intoVaultRaw: null, signatures }
  // A part landed whenever a receipt came back: what the wallet received, or what went into the shared vault.
  if (result.state === 'PARTIAL' && receivedRaw > 0n)
    return { kind: 'partial', receivedRaw, intoVaultRaw: null, signatures }
  if (result.state === 'PARTIAL' && paidRaw > 0n)
    return { kind: 'partial', receivedRaw, intoVaultRaw: paidRaw, signatures }
  return { kind: 'pending', receivedRaw, intoVaultRaw: null, signatures }
}

export type LaunchedView = Readonly<{
  pending: boolean
  locked: Readonly<{ cliffAt: string; endsAt: string }> | null
  lockPending: boolean
  lockFailed: boolean
}>

/** The launch's answer and the token's read after it — the read outranks the send's own word for the lock. */
export function launchedView(submit: LaunchSubmitResponse, token: LaunchTokenResponse | null): LaunchedView {
  const pending = submit.state === 'PENDING'
  const tokenLock = token?.lock ?? null
  const locked =
    tokenLock?.state === 'LOCKED' && tokenLock.cliffAt && tokenLock.endsAt
      ? { cliffAt: tokenLock.cliffAt, endsAt: tokenLock.endsAt }
      : null
  return {
    pending,
    locked,
    lockPending: submit.lock?.state === 'PENDING' && tokenLock?.state !== 'LOCKED',
    lockFailed: submit.lock?.state === 'FAILED' && tokenLock?.state !== 'LOCKED' && !pending,
  }
}

/** A cabinet's figure while it waits: a recipient's sharing not confirmed is «після підтвердження», else «не прочитано» — never a zero. */
export function earningsUnreadKey(row: LaunchCabinetRow): LaunchWordKey {
  return row.role === 'recipient' && row.feeSharing?.state !== 'SHARED' ? 'mineShareWaiting' : 'mineNotRead'
}

/** What a launch's row can still claim for this wallet now; zero when its earnings were not read. */
export function unclaimedOf(row: LaunchCabinetRow): bigint {
  return row.earnings ? BigInt(row.earnings.mine.unclaimedRaw) : 0n
}

/** Whether «Забрати» stands on a row: something waits, the server says it can be claimed, and Launch is not paused. */
export function canClaim(row: LaunchCabinetRow, paused: boolean): boolean {
  return row.claimable && unclaimedOf(row) > 0n && !paused
}

/** The line under a row with nothing to claim now. */
export function noClaimKey(row: LaunchCabinetRow): LaunchWordKey {
  if (row.role === 'recipient' && row.feeSharing?.state !== 'SHARED') return 'mineSharePending'
  // Not read is not «nothing to claim».
  if (!row.earnings) return 'claimUnread'
  if (row.earnings.mine.shareBps === 0) return 'claimNotYours'
  return 'claimNothing'
}

/** A preset's own name: the network's list first, then the product's words — never the raw id; null when unknown. */
export function presetName(
  id: string,
  presets: readonly Readonly<{ id: string; name: Readonly<{ en: string; uk: string }> }>[] | undefined,
  locale: 'en' | 'uk',
  word: LaunchWord,
): string | null {
  const listed = presets?.find((entry) => entry.id === id)?.name[locale]
  if (listed) return listed
  return id === 'classic' || id === 'protected' || id === 'community' ? word(`presetName_${id}`) : null
}

/** What can be claimed now across the cabinet, by pair currency — only from launches that were read. */
export function toClaimByPair(data: LaunchCreatorCabinetResponse): ReadonlyMap<string, bigint> {
  const sums = new Map<string, bigint>()
  for (const row of data.launches)
    if (row.earnings) sums.set(row.pair.mint, (sums.get(row.pair.mint) ?? 0n) + BigInt(row.earnings.mine.unclaimedRaw))
  return sums
}

export type SourceRow = Readonly<{
  source: 'curve' | 'graduation' | 'lp'
  /** Graduation and the locked liquidity begin only once the token reaches the DEX. */
  later: boolean
  earnedRaw: bigint
  /** What is left to claim of this source, said beside it only when it differs; null otherwise. */
  leftRaw: bigint | null
}>

const SOURCES = ['curve', 'graduation', 'lp'] as const

/**
 * Where a launch's fees came from — the curve, the move to the DEX, the
 * locked pool — three rows once read (not read, the card says so in one
 * line); shared: the wallet's part of each, so the rows add up to what it
 * earned.
 */
export function sourceRows(row: LaunchCabinetRow): readonly SourceRow[] {
  const earnings = row.earnings
  if (!earnings) return []
  const shared = row.feeSharing !== null && row.feeSharing.state !== 'FAILED'
  return SOURCES.map((source) => {
    const part = earnings.role[source]
    const earnedRaw = shared
      ? (BigInt(part.earnedRaw) * BigInt(earnings.mine.shareBps)) / 10_000n
      : BigInt(part.earnedRaw)
    const left = BigInt(part.unclaimedRaw)
    return {
      source,
      later: source !== 'curve' && row.migrated === false,
      earnedRaw,
      leftRaw: !shared && left > 0n && left !== earnedRaw ? left : null,
    }
  })
}

type Receipt = NonNullable<LaunchTokenResponse['receipt']>

/** A «Чесний лаунч» mark's words; a locked position of the graduated pool named by its owner — the creator's, or Ryntra's. */
export function markKey(mark: Readonly<{ code: string; account: string }>, receipt: Receipt): LaunchWordKey {
  if (mark.code !== 'LP_LOCKED_FOREVER') return `mark_${mark.code}` as LaunchWordKey
  const owner = receipt.graduated?.positions.find((position) => position.position === mark.account)?.owner
  if (owner === undefined) return 'mark_LP_LOCKED_FOREVER'
  return owner === receipt.creator ? 'mark_LP_LOCKED_FOREVER_creator' : 'mark_LP_LOCKED_FOREVER_partner'
}

/** In «Варто глянути перед угодою»: every fact worth a look but «the creator sold» (the banner above), and a history read in part. */
export function inAttention(fact: LaunchRiskFact): boolean {
  return (fact.level === 'attention' && fact.code !== 'CREATOR_SOLD') || fact.code === 'HISTORY_PARTIAL'
}

/** A fact's words: «of the supply» when the creator sold more than they bought here, «at least» for a bundle read in part. */
export function riskKey(fact: LaunchRiskFact): LaunchWordKey {
  if (fact.code === 'CREATOR_SOLD' && fact.values.soldBps === undefined) return 'risk_CREATOR_SOLD_SUPPLY'
  if (fact.code === 'BUNDLE_HOLDS' && fact.values.atLeast) return 'risk_BUNDLE_HOLDS_AT_LEAST'
  if (fact.code === 'HISTORY_PARTIAL' && !fact.values.trades) return 'risk_HISTORY_UNREAD'
  return `risk_${fact.code}` as LaunchWordKey
}

/** How long, in Launch's own short words: «12 с» · «4 хв» · «3 год» · «2 дн». */
export function durationText(word: LaunchWord, seconds: number): string {
  if (seconds < 60) return word('sec', { n: seconds })
  if (seconds < 3600) return word('min', { n: Math.floor(seconds / 60) })
  if (seconds < 86_400) return word('hour', { n: Math.floor(seconds / 3600) })
  return word('day', { n: Math.floor(seconds / 86_400) })
}

/** «щойно» under ten seconds, else «N тому». */
export function agoText(word: LaunchWord, seconds: number): string {
  if (seconds < 10) return word('justNow')
  return word('ago', { time: durationText(word, seconds) })
}

/** A token's age from its chart's first point; a dash when the chart is empty. */
export function ageOf(market: LaunchMarketResponse, nowSeconds: number, word: LaunchWord): string {
  const opened = market.chart.points[0]?.t
  return opened ? durationText(word, Math.max(0, nowSeconds - opened)) : '—'
}

/** A lock's schedule as a period: «1 рік» from a year, else whole months. */
export function periodWord(days: number, word: LaunchWord): string {
  return days >= 365 ? word('year') : word('months', { n: Math.round(days / 30) })
}

/** The share of the whole supply a first buy gets, in percent to two places. */
export function supplyPct(tokensRaw: string | bigint, supplyRaw: bigint): number {
  const tokens = typeof tokensRaw === 'string' ? BigInt(tokensRaw) : tokensRaw
  if (supplyRaw <= 0n) return 0
  return Number((tokens * 1_000_000n) / supplyRaw) / 10_000
}

/** Every launch's supply: a billion tokens with six decimals. */
export const SUPPLY_RAW = 1_000_000_000n * 1_000_000n

/** Before the build, the network cost as the web measured it; the build replaces it with the simulated figure. */
export const COST_ESTIMATE_SOL = { plain: '0.010', locked: '0.014' } as const
