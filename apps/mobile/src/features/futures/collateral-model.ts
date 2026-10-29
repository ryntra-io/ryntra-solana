/**
 * Phoenix collateral on the phone as values — pure (C4c, the web's B6: `lib/phoenix/collateral-model.ts`,
 * `collateral-actions.ts` and `collateral-panel.tsx` on line A). The phone builds nothing: the server's routes
 * (`/api/solana/futures/collateral*`) decide whether a wallet may move collateral, build the deposit or the withdrawal
 * with Phoenix's own SDK, simulate it and seal the bytes in a ticket. What the phone holds here is the amount as the
 * route takes it — micro-dollars as a string of digits, never a float — and the server's answers read again rather
 * than trusted: an answer without its bytes or its ticket is no Review, and a figure that is missing is a dash.
 *
 * USDC has six decimals: 1 USDC is 1 000 000 micro-dollars. A field shows dollars down to the cent.
 */

import type { Locale } from '../../lib/i18n.ts'
import { DASH, formatAmount } from '../../utils/format.ts'

import type { CollateralCopy } from './collateral-copy.ts'
import { solText, usdcText, type ViewRow } from './order-view.ts'

export type CollateralAction = 'deposit' | 'withdraw'

/** The least one move takes: one dollar (the operator's minimum for every money action). */
export const MIN_COLLATERAL_MICRO = 1_000_000n
/** The most one move takes, as the route allows it: a ceiling against a slip of the finger. */
export const MAX_COLLATERAL_MICRO = 1_000_000_000_000n
/** The quick shares of what can move; «Макс» is the whole of it. */
export const COLLATERAL_SHARES = [25, 50, 75] as const

const MICRO = 1_000_000n
const CENT = 10_000n

/* ------------------------------------------------------------------ amounts */

/** Dollars typed by a person («12.5», «12,50», «1 250») as micro-dollars; null for anything that is not a plain amount. */
export function microFromText(text: string): bigint | null {
  const clean = text.trim().replace(/[\s  ]/g, '')
  const match = /^(\d{1,10})(?:[.,](\d{0,6}))?$/.exec(clean)
  if (!match) return null
  return BigInt(match[1]!) * MICRO + BigInt((match[2] ?? '').padEnd(6, '0') || '0')
}

/** Micro-dollars as a field holds them — down to the cent, no trailing zeros, the language's mark: «12,5». */
export function fieldFromMicro(micro: bigint, mark: ',' | '.'): string {
  const cents = (micro < 0n ? 0n : micro) / CENT
  const whole = cents / 100n
  const rest = cents % 100n
  if (rest === 0n) return whole.toString()
  return `${whole}${mark}${rest.toString().padStart(2, '0').replace(/0$/, '')}`
}

/** Micro-dollars as a number for the screen only — never sent back. */
export const usdOf = (micro: bigint | null): number | null => (micro === null ? null : Number(micro) / 1e6)

/** Micro-dollars as an amount of USDC in the language's shape, two to six decimals; a dash when unknown. */
export const microText = (micro: bigint | null, locale: Locale): string => usdcText(usdOf(micro), locale)

/**
 * The most one move may take now: what can move — the wallet's USDC for a deposit, what Phoenix lets the account
 * withdraw for a withdrawal — under the first check's ceiling when there is one. Null when what can move is unknown.
 */
export function topOf(limit: bigint | null, canary: bigint | null): bigint | null {
  if (limit === null) return null
  const top = canary !== null && canary < limit ? canary : limit
  return top > 0n ? top : 0n
}

/** A share of what can move, down to the cent: never more than it. */
export function shareOf(top: bigint, percent: number): bigint {
  return ((top * BigInt(percent)) / 100n / CENT) * CENT
}

export type CollateralChip = Readonly<{ key: '25' | '50' | '75' | 'max'; micro: bigint | null }>

/**
 * The quick amounts — 25 %, 50 %, 75 % and «Макс» of what can move, each down to the cent. A chip whose amount is
 * under the minimum, or of nothing known, has none (null): it is drawn but cannot be pressed.
 */
export function collateralChips(top: bigint | null): readonly CollateralChip[] {
  const usable = (micro: bigint) => (micro >= MIN_COLLATERAL_MICRO ? micro : null)
  return [
    ...COLLATERAL_SHARES.map((share) => ({
      key: String(share) as '25' | '50' | '75',
      micro: top === null ? null : usable(shareOf(top, share)),
    })),
    { key: 'max' as const, micro: top === null ? null : usable(shareOf(top, 100)) },
  ]
}

/** Why the amount cannot be reviewed yet — each a line of its own under the field. */
export type CollateralBlock = 'minimum' | 'overWallet' | 'overWithdrawable' | 'canary'

/** The amount against the minimum, what can move and the first check's ceiling; null when it may be reviewed. */
export function amountBlock(
  action: CollateralAction,
  amount: bigint | null,
  limit: bigint | null,
  canary: bigint | null,
): CollateralBlock | null {
  if (amount === null) return null
  if (amount < MIN_COLLATERAL_MICRO) return 'minimum'
  if (limit !== null && amount > limit) return action === 'deposit' ? 'overWallet' : 'overWithdrawable'
  if (canary !== null && amount > canary) return 'canary'
  return null
}

/**
 * A wallet that cannot make a deposit at all (C4e — the operator's Seeker on 2026-10-23: 0.0058 USDC in the wallet, the
 * amount typed, «Перевірити» grey and no way on): its USDC is under the minimum one move takes. A wallet that holds
 * some but less than was typed keeps the «more than the wallet holds» line and its Max. Unknown holdings say nothing.
 */
export function walletShort(walletUsdc: bigint | null): boolean {
  return walletUsdc !== null && walletUsdc < MIN_COLLATERAL_MICRO
}

/** The least free collateral said to be «enough to open a trade»: a one-dollar order at the lowest leverage. */
export const FREE_FOR_TRADE_USD = 1

/**
 * The deposit sheet's one next action (C4e): its Review while a deposit can be made; with a wallet short of USDC and
 * deposits open, a trade on the collateral already free — only where the sheet was opened outside a ticket and the
 * account may trade — else USDC for the wallet. A closed gate keeps the Review and its line: no USDC is offered for a
 * deposit that cannot happen.
 */
export type DepositWay = 'review' | 'buy' | 'trade'

export function depositWay(input: {
  walletUsdc: bigint | null
  /** The gate read, deposits open for this wallet, and Phoenix taking one on this account. */
  open: boolean
  freeUsd: number | null
  /** The sheet can lead to a trade (opened outside a ticket, on an account that trades). */
  toTrade: boolean
}): DepositWay {
  if (!input.open || !walletShort(input.walletUsdc)) return 'review'
  return input.toTrade && input.freeUsd !== null && input.freeUsd >= FREE_FOR_TRADE_USD ? 'trade' : 'buy'
}

/* ----------------------------------------------------------- server answers */

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)
const DIGITS = /^\d{1,24}$/
const SIGNED = /^-?\d{1,24}$/
const digits = (value: unknown): bigint | null =>
  typeof value === 'string' && DIGITS.test(value) ? BigInt(value) : null

/** What a wallet may do now and the USDC it holds — the gate's word; closed until it says otherwise. */
export type CollateralStates = Readonly<{
  deposit: boolean
  withdraw: boolean
  /** The first check's ceiling for one move, either way, micro-dollars; null without one. */
  maxMicro: bigint | null
  /** The wallet's USDC, micro-dollars; null when the chain did not answer. */
  walletUsdc: bigint | null
}>

export const COLLATERAL_CLOSED: CollateralStates = { deposit: false, withdraw: false, maxMicro: null, walletUsdc: null }

/** The gate's answer; anything but a plain «true» is closed. The ceiling's older name is read when the new one is absent. */
export function parseCollateralStates(raw: unknown): CollateralStates {
  if (!isObject(raw)) return COLLATERAL_CLOSED
  return {
    deposit: raw.deposit === true,
    withdraw: raw.withdraw === true,
    maxMicro: digits(raw.maxMicro) ?? digits(raw.maxDeposit),
    walletUsdc: digits(raw.walletUsdc),
  }
}

/** The account's margin as far as a move needs it: what may leave now, and whether Phoenix takes either move. */
export type CollateralMargin = Readonly<{ withdrawableMicro: bigint | null; canDeposit: boolean; canWithdraw: boolean }>

/** The account route's `margin` (Phoenix's view, `marginWire` on line A); null without one. */
export function parseCollateralMargin(raw: unknown): CollateralMargin | null {
  if (!isObject(raw)) return null
  return {
    withdrawableMicro: digits(raw.withdrawableMicro),
    canDeposit: raw.canDeposit === true,
    canWithdraw: raw.canWithdraw === true,
  }
}

/**
 * What the account may withdraw now, from a margin the account model holds — when it carries Phoenix's figure; null
 * otherwise (the sheet reads it afresh).
 */
export function withdrawableOf(margin: unknown): bigint | null {
  return isObject(margin) ? digits(margin.withdrawableMicro) : null
}

/** The server's Review of one move, read again. Amounts in micro-dollars, the chain's fees in lamports. */
export type CollateralReview = Readonly<{
  action: CollateralAction
  amountMicro: bigint
  /** What lands where it goes, by the simulation: a deposit's collateral, a withdrawal's USDC in the wallet. */
  receiveMicro: bigint
  /** Kept by Phoenix on the way (a withdrawal's fee); 0 when nothing is kept. */
  phoenixFeeMicro: bigint
  walletUsdcMicro: bigint | null
  /** A withdrawal's after: what the account may still withdraw once this one is out; null for a deposit or unknown. */
  freeAfterMicro: bigint | null
  /** Rent of the token accounts the transaction opens for the wallet — it stays the wallet's. */
  rentLamports: bigint
  networkFeeLamports: bigint
  traderAccount: string
  wireBase64: string
  ticket: string
  signableMs: number | null
}>

/**
 * The server's Review: an answer without its action, its amounts, its bytes or its ticket is no Review at all (null —
 * the general refusal). What is signed is the server's bytes, never rebuilt here.
 */
export function parseCollateralReview(raw: unknown): CollateralReview | null {
  if (!isObject(raw)) return null
  if (raw.action !== 'deposit' && raw.action !== 'withdraw') return null
  const amount = digits(raw.amount)
  const receive = digits(raw.receive)
  const wire = isObject(raw.transaction) ? text(raw.transaction.wireBase64) : null
  const ticket = text(raw.ticket)
  const network = digits(raw.networkFeeLamports)
  const rent = digits(raw.rentLamports)
  if (amount === null || receive === null || !wire || !ticket || network === null || rent === null) return null
  /* A Review that moves nothing, or gets back more than it moves, is not one to sign. */
  if (amount <= 0n || receive > amount) return null
  return {
    action: raw.action,
    amountMicro: amount,
    receiveMicro: receive,
    phoenixFeeMicro: digits(raw.phoenixFee) ?? amount - receive,
    walletUsdcMicro: digits(raw.walletUsdc),
    freeAfterMicro: digits(raw.freeAfter),
    rentLamports: rent,
    networkFeeLamports: network,
    traderAccount: text(raw.traderAccount) ?? '',
    wireBase64: wire,
    ticket,
    signableMs: finite(raw.signableMs),
  }
}

/**
 * AG-2b, one press: is a move built again — its bytes aged before the wallet opened — the one the person pressed on,
 * and no worse? The same action and amount, no less arriving, no more kept by Phoenix and no more SOL for the network.
 * Then the wallet opens on the fresh bytes by itself; otherwise the fresh «Перевірка» is shown to be read again.
 */
export function sameMoveNoWorse(shown: CollateralReview, fresh: CollateralReview): boolean {
  if (shown.action !== fresh.action || shown.amountMicro !== fresh.amountMicro) return false
  if (fresh.receiveMicro < shown.receiveMicro || fresh.phoenixFeeMicro > shown.phoenixFeeMicro) return false
  return fresh.networkFeeLamports + fresh.rentLamports <= shown.networkFeeLamports + shown.rentLamports
}

export type CollateralRelayState = 'LANDED' | 'FAILED' | 'UNKNOWN' | 'NOT_SENT'

/**
 * Where the one signature stands and — once landed — the wallet's USDC as the chain's record of the transaction
 * changed it, micro-dollars with a sign (a deposit's is negative): absent until landed and read, null when the chain
 * did not show it. What a receipt states — not what the Review expected.
 */
export type CollateralResult = Readonly<{ signature: string; state: CollateralRelayState; usdcMoved?: bigint | null }>

const RELAY_STATES: readonly CollateralRelayState[] = ['LANDED', 'FAILED', 'UNKNOWN', 'NOT_SENT']

/** The relay's (or the status route's) first result, read again; null when it names no signature. */
export function parseCollateralResult(raw: unknown): CollateralResult | null {
  const results = isObject(raw) && Array.isArray(raw.results) ? raw.results : []
  const first = results[0]
  if (!isObject(first) || !text(first.signature)) return null
  const state = RELAY_STATES.includes(first.state as CollateralRelayState)
    ? (first.state as CollateralRelayState)
    : 'UNKNOWN'
  const moved = first.usdcMoved
  const usdcMoved =
    moved === undefined ? undefined : typeof moved === 'string' && SIGNED.test(moved) ? BigInt(moved) : null
  return { signature: first.signature as string, state, ...(usdcMoved === undefined ? {} : { usdcMoved }) }
}

/** Still to read from the chain: how it ended, or — landed — the USDC it moved. */
export const unsettled = (result: CollateralResult): boolean =>
  result.state === 'UNKNOWN' || (result.state === 'LANDED' && result.usdcMoved == null)

/** The status route's word on one signature, merged into what the receipt holds; an unknown word keeps it as it is. */
export function mergeSeen(current: CollateralResult, seen: CollateralResult | null): CollateralResult {
  if (!seen || seen.signature !== current.signature || seen.state === 'UNKNOWN') return current
  const usdcMoved = seen.usdcMoved ?? current.usdcMoved
  return { signature: current.signature, state: seen.state, ...(usdcMoved === undefined ? {} : { usdcMoved }) }
}

/**
 * The relay's own refusals, every one given before anything was sent (the web's `REFUSED_BEFORE_SENDING`). Any other
 * answer after the wallet signed — no answer, a gateway's page, a code the phone does not know — may come after a send:
 * the outcome is the chain's to say, and the receipt asks it.
 */
export const COLLATERAL_REFUSED_BEFORE_SENDING: ReadonlySet<string> = new Set([
  'BAD_REQUEST',
  'TICKET_INVALID',
  'TICKET_EXPIRED',
  'ACTIONS_CLOSED',
  'CANARY_LIMIT',
  'SIGNED_MISMATCH',
  'NOT_SIGNED',
  'RELAY_REFUSED',
  'UNAVAILABLE',
  'WALLET_MISMATCH',
  'RATE_LIMITED',
  'FORBIDDEN_ORIGIN',
  'UNAUTHORIZED',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'BODY_REQUIRED',
  'BODY_TOO_LARGE',
  'INVALID_BODY_STREAM',
  'INVALID_CONTENT_LENGTH',
  'INVALID_JSON',
  'JSON_REQUIRED',
])

/** The route's refusals the phone says in words of their own (the web's `fail.*`); any other code is the general line. */
export const COLLATERAL_FAILURES = [
  'ACTIONS_CLOSED',
  'CANARY_LIMIT',
  'INSUFFICIENT_USDC',
  'OVER_WITHDRAWABLE',
  'ACCOUNT_NEEDED',
  'DEPOSIT_CLOSED',
  'WITHDRAW_CLOSED',
  'NEEDS_SOL',
  'SIMULATION_FAILED',
  'PHOENIX_UNAVAILABLE',
  'RELAY_REFUSED',
  'WALLET_MISMATCH',
  'RATE_LIMITED',
] as const

export type CollateralFailure =
  | (typeof COLLATERAL_FAILURES)[number]
  | 'signIn'
  | 'network'
  | 'walletRefused'
  | 'walletCancelled'
  | 'walletTimeout'
  | 'walletCannotSign'
  | 'ledgerBlind'
  | 'txVersion'
  | 'reviewAged'
  | 'deviceConfirm'
  | 'outcomeUnknown'
  | 'general'

const KNOWN: ReadonlySet<string> = new Set(COLLATERAL_FAILURES)

/** A route's code as the phone's failure; a lapsed session asks for a new signature, an aged ticket for a new Review. */
export function collateralFailureOf(code: string | null | undefined): CollateralFailure {
  if (code === 'UNAUTHORIZED' || code === 'SESSION_EXPIRED' || code === 'SESSION_REVOKED') return 'signIn'
  if (code === 'TICKET_EXPIRED') return 'reviewAged'
  return code && KNOWN.has(code) ? (code as CollateralFailure) : 'general'
}

/* -------------------------------------------------------------------- views */

export type CollateralReviewView = Readonly<{
  title: string
  pay: string
  get: string
  rows: readonly ViewRow[]
  costs: readonly ViewRow[]
  total: string
  what: string
}>

/** «Перевірка» of a move, from the server's answer alone: what was built and simulated is what is shown. */
export function collateralReviewView(
  review: CollateralReview,
  words: CollateralCopy,
  locale: Locale,
): CollateralReviewView {
  const deposit = review.action === 'deposit'
  const amount = microText(review.amountMicro, locale)
  const receive = microText(review.receiveMicro, locale)
  const rows: ViewRow[] = deposit
    ? []
    : [
        ...(review.freeAfterMicro === null
          ? []
          : [{ label: words.freeAfter, value: `${microText(review.freeAfterMicro, locale)} USDC` }]),
        { label: words.marginAfter, value: words.closerToLiquidation, tone: 'warning' as const },
      ]
  const costs: ViewRow[] = [
    { label: words.costRyntra, value: words.costNone },
    {
      label: words.costPhoenix,
      value: review.phoenixFeeMicro > 0n ? `${microText(review.phoenixFeeMicro, locale)} USDC` : words.costNone,
    },
    { label: words.costNetwork, value: solText(review.networkFeeLamports, locale) },
    ...(review.rentLamports > 0n ? [{ label: words.costRent, value: solText(review.rentLamports, locale) }] : []),
  ]
  return {
    title: deposit ? words.reviewDeposit(amount) : words.reviewWithdraw(amount),
    pay: deposit ? words.payWallet(amount) : words.payAccount(amount),
    get: deposit ? words.getAccount(receive) : words.getWallet(receive),
    rows,
    costs,
    total: words.costsTotal(solText(review.networkFeeLamports + review.rentLamports, locale)),
    what: deposit ? words.whatDeposit : words.whatWithdraw,
  }
}

export type CollateralReceiptView = Readonly<{
  status: 'done' | 'pending' | 'failed'
  title: string
  /** What moved — the big line; null while the chain has not said. */
  big: string | null
  /** Where it went; «очікувано» while the chain has not shown a withdrawal's arrival. */
  line: string | null
  note: string | null
}>

/**
 * The receipt: done once the transaction landed — what moved by the chain's record of the wallet's USDC, the Review's
 * figures only until the chain says; waiting while it has not; failed otherwise.
 */
export function collateralReceiptView(
  review: CollateralReview,
  result: CollateralResult,
  words: CollateralCopy,
  locale: Locale,
  following = true,
): CollateralReceiptView {
  const status = result.state === 'LANDED' ? 'done' : result.state === 'UNKNOWN' ? 'pending' : 'failed'
  const deposit = review.action === 'deposit'
  if (status !== 'done') {
    return {
      status,
      title: status === 'pending' ? words.receiptPending : words.receiptFailed,
      big: null,
      line: null,
      note:
        status === 'pending'
          ? following
            ? words.pendingLine
            : words.pendingStopped
          : result.state === 'NOT_SENT'
            ? words.notSent
            : words.receiptNothing,
    }
  }
  const moved = result.usdcMoved ?? null
  /* A withdrawal's arrival is Phoenix's to settle at landing: until the chain shows it, the Review's figure is expected. */
  const expected = !deposit && moved === null
  const sent = deposit && moved !== null && moved <= 0n ? -moved : review.amountMicro
  const received = deposit ? review.amountMicro : moved !== null && moved >= 0n ? moved : review.receiveMicro
  const big = `${deposit ? '−' : '+'}${expected ? '≈ ' : ''}${microText(deposit ? sent : received, locale)} USDC`
  const got = deposit ? words.getAccount(microText(received, locale)) : words.getWallet(microText(received, locale))
  return {
    status,
    title: deposit ? words.receiptDeposit : words.receiptWithdraw,
    big,
    line: expected ? `${got} · ${words.expected}` : got,
    note: null,
  }
}

/** A figure of USDC the field's line names, with the time it was read: «120,50 USDC · 12:03»; a dash when unknown. */
export function heldLine(micro: bigint | null, time: string | null, locale: Locale): string {
  if (micro === null) return DASH
  return `${formatAmount(usdOf(micro), 2, locale, 2)} USDC${time ? ` · ${time}` : ''}`
}
