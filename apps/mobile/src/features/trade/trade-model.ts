/**
 * Trade as values — pure. The ticket's two legs from the mode and the assets,
 * amounts between the person's units and the chain's raw units, the Review's
 * rows and warnings from the server's order, the client's own readiness rule
 * before a wallet is opened (the same rule the web keeps), the words for
 * every refusal the routes can give, and the one attempt record that survives
 * the app closing. Every word and figure comes out in the language asked for
 * (M22) — English unless Ukrainian is asked. Nothing here talks to the network
 * or holds a key.
 */

import { getBase58Decoder, getTransactionDecoder } from '@solana/kit'

import {
  SOL_MINT,
  USDC_MINT,
  USDT_MINT,
  type ExecutionPlanBinding,
  type RuleBinding,
  type SwapOrderCore,
  type SwapOrigin,
  type SwapPolicyVerdict,
  type SwapSettlement,
} from '../../lib/api.ts'
import type { Locale } from '../../lib/i18n.ts'
import { base64ToBytes } from '../session/siws.ts'

import { TRADE_COPY } from './copy.ts'

export type TradeMode = 'buy' | 'sell' | 'swap'
export type TradeSide = 'BUY' | 'SELL'

export type TradeAsset = Readonly<{
  mint: string
  symbol: string
  name: string
  icon: string | null
  /** The chain's decimals; null until the market row or a quote says. */
  decimals: number | null
  /** Jupiter's check, as the list the token was picked from said it; absent when nothing said it — never assumed. */
  verified?: boolean
  /** Jupiter flagged the token, as the list said it. */
  suspicious?: boolean
  /** The company whose stock this token borrows its ticker or name from while it is not that stock (ST-5 r4). */
  lookalikeOf?: string | null
  /** The market's dollar price as the list said it — the dollar line's last resort when the estimate gives none. */
  price?: number | null
}>

export const USDC_ASSET: TradeAsset = {
  mint: USDC_MINT,
  symbol: 'USDC',
  name: 'USD Coin',
  icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  decimals: 6,
}

export const SOL_ASSET: TradeAsset = {
  mint: SOL_MINT,
  symbol: 'SOL',
  name: 'Solana',
  icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  decimals: 9,
}

/** The two assets a Buy is paid with and a Sell is received in. */
export const QUOTE_ASSETS: readonly TradeAsset[] = [USDC_ASSET, SOL_ASSET]

export type TradeLegs = Readonly<{ pay: TradeAsset | null; receive: TradeAsset | null }>

/**
 * What is paid and what is received: a Buy pays the quote asset for the
 * market's asset, a Sell the other way round, a Swap whatever two assets
 * were chosen. The two legs are never the same mint.
 */
export function ticketLegs(
  mode: TradeMode,
  input: Readonly<{ asset: TradeAsset | null; quote: TradeAsset; pay: TradeAsset | null; receive: TradeAsset | null }>,
): TradeLegs {
  const legs: TradeLegs =
    mode === 'buy'
      ? { pay: input.quote, receive: input.asset }
      : mode === 'sell'
        ? { pay: input.asset, receive: input.quote }
        : { pay: input.pay, receive: input.receive }
  if (legs.pay && legs.receive && legs.pay.mint === legs.receive.mint) return { pay: legs.pay, receive: null }
  return legs
}

/**
 * The `origin` an order carries: Buy and Sell name themselves, a Swap says
 * nothing. A Buy under a plan carries the binding the person read (contract
 * §3b); a Buy under an autoinvest reminder carries the rule and the
 * occurrence (§3j) — neither ever binds a Sell or a Swap.
 */
export function tradeOrigin(
  mode: TradeMode,
  plan: ExecutionPlanBinding | null = null,
  rule: RuleBinding | null = null,
): SwapOrigin | null {
  if (mode === 'buy') return { surface: 'SPOT', side: 'BUY', ...(plan ? { plan } : {}), ...(rule ? { rule } : {}) }
  return mode === 'sell' ? { surface: 'SPOT', side: 'SELL' } : null
}

const AMOUNT = /^(\d+)(?:[.,](\d+)?)?$/

/** A typed amount into the chain's raw units — a positive integer string — or null for anything that is not one. */
export function parseAmount(text: string, decimals: number | null): string | null {
  if (decimals === null || decimals < 0 || decimals > 20) return null
  const match = AMOUNT.exec(text.trim())
  if (!match) return null
  const whole = match[1] ?? '0'
  const fraction = (match[2] ?? '').slice(0, decimals).padEnd(decimals, '0')
  const raw = `${whole}${fraction}`.replace(/^0+(?=\d)/, '')
  return /^[1-9][0-9]{0,19}$/.test(raw) ? raw : null
}

/** Raw units as a number of the asset — for a price, a size, a chart; never for a settled figure. */
export function rawToNumber(raw: string, decimals: number): number {
  const value = Number(raw)
  return Number.isFinite(value) ? value / 10 ** decimals : Number.NaN
}

/** How each language groups thousands and marks the fraction: «1,234.5» · «1 234,5» (a no-break space, as `Intl` writes it). */
const UNIT_MARKS: Readonly<Record<Locale, Readonly<{ group: string; fraction: string }>>> = {
  en: { group: ',', fraction: '.' },
  uk: { group: '\u00a0', fraction: ',' },
}

/** Raw units as the person reads them: the whole part, then the fraction with trailing zeros gone, at most `maxFraction` places. */
export function formatUnits(raw: string, decimals: number, maxFraction: number, locale: Locale): string {
  if (!/^\d+$/.test(raw)) return '—'
  const marks = UNIT_MARKS[locale]
  const padded = raw.padStart(decimals + 1, '0')
  const whole = padded.slice(0, padded.length - decimals)
  let fraction = decimals > 0 ? padded.slice(padded.length - decimals) : ''
  fraction = fraction.slice(0, maxFraction).replace(/0+$/, '')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, marks.group)
  return fraction.length > 0 ? `${grouped}${marks.fraction}${fraction}` : grouped
}

/** Significant digits an estimate's token figure keeps: «≈ 2,07906 USDC» never «≈ 2,079061». */
const SHORT_SIGNIFICANT = 6

/**
 * Raw units as an estimate says them, short (ST-5): a dollar token to the cent, any other token to six significant
 * digits — cut, never rounded up, as `formatUnits` cuts. Display only: the amount itself stays whole.
 */
export function shortUnits(raw: string, decimals: number, mint: string, locale: Locale): string {
  if (!/^\d+$/.test(raw)) return '—'
  if (mint === USDC_MINT || mint === USDT_MINT) {
    const cents = formatUnits(raw, decimals, 2, locale)
    // A crumb under a cent is «< 0,01», never a «0» that says nothing comes (ST-5): a known tiny figure is not zero.
    return cents === '0' && /[1-9]/.test(raw) ? `< 0${UNIT_MARKS[locale].fraction}01` : cents
  }
  const padded = raw.padStart(decimals + 1, '0')
  const whole = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, '')
  if (whole !== '0') return formatUnits(raw, decimals, Math.max(0, SHORT_SIGNIFICANT - whole.length), locale)
  const leadingZeros = padded.slice(padded.length - decimals).match(/^0*/)?.[0].length ?? 0
  return formatUnits(raw, decimals, Math.min(decimals, leadingZeros + SHORT_SIGNIFICANT), locale)
}

/** An estimate's figure with its «≈» — a figure already bounded («< 0,01») keeps its own qualifier, never «≈ < 0,01». */
/**
 * A typed field as a figure is read (ST-5 r8): its whole part grouped in the language's shape — «500000» reads
 * «500,000» · «500 000», as the estimate beside it — the fraction and the mark as typed. Display only: the field
 * itself stays ungrouped.
 */
export function groupedField(text: string, locale: Locale): string {
  const match = /^(\d+)([.,]\d*)?$/.exec(text)
  if (!match) return text
  const whole = match[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, UNIT_MARKS[locale].group)
  return `${whole}${match[2] ?? ''}`
}

export function approxFigure(figure: string): string {
  return figure.startsWith('<') ? figure : `≈ ${figure}`
}

/** Raw units as an amount field holds them — no grouping, the language's own fraction mark («1234.5» · «1234,5»). */
/** The quick shares of what the wallet can spend, as on a company's purchase: 25 · 50 · 75 · 100 %. */
export const PAY_SHARES_PCT = [25, 50, 75, 100] as const

/** A share of a raw spendable amount, rounded down — never more than the wallet can spend; null when not a whole number. */
export function shareOfRaw(raw: string, pct: number): string | null {
  if (!/^\d+$/.test(raw)) return null
  return ((BigInt(raw) * BigInt(Math.round(pct))) / 100n).toString()
}

/**
 * What a swap paid in SOL keeps back beyond the server's own fee reserve (already out of `spendableRaw`): the rent of
 * two token accounts — the wrapped SOL the swap opens and closes, and the bought token's own when it is new — the
 * chain's 2 039 280 lamports each. So «100 %» of SOL is a sum the wallet can sign, never one that fails on rent.
 */
export const SOL_SWAP_RESERVE_LAMPORTS = 4_078_560n

/** What a ticket can spend of the asset it pays with, raw: a token's whole spendable amount; SOL less the swap's reserve. */
export function ticketSpendableRaw(raw: string, mint: string): string {
  if (!/^\d+$/.test(raw)) return '0'
  if (mint !== SOL_MINT) return raw
  const left = BigInt(raw) - SOL_SWAP_RESERVE_LAMPORTS
  return left > 0n ? left.toString() : '0'
}

/** A dollar of USDC or USDT, raw (6 decimals) — the least a purchase is (`MIN_BUY_USD`). */
const ONE_DOLLAR_RAW = 1_000_000n

/** How far under a dollar a sum paid in SOL may read before it is held: a price is a reading, not a promise. */
export const DOLLAR_FLOOR_TOLERANCE = 0.005

/**
 * Whether a purchase spends under a dollar. Paid in dollars
 * it is the sum itself, raw — never a venue's price of the dollar, so exactly $1 always passes. Paid in SOL it is the
 * sum at SOL's own price, with a hair of tolerance; without a price nothing is claimed (false). Raw amounts only.
 */
export function underOneDollar(
  input: Readonly<{ payMint: string; payDecimals: number; amountRaw: string | null; solUsd: number | null }>,
): boolean {
  const { payMint, payDecimals, amountRaw, solUsd } = input
  if (amountRaw === null || !/^\d+$/.test(amountRaw) || BigInt(amountRaw) === 0n) return false
  if (payMint === USDC_MINT || payMint === USDT_MINT) {
    const dollar = payDecimals === 6 ? ONE_DOLLAR_RAW : 10n ** BigInt(Math.max(0, payDecimals))
    return BigInt(amountRaw) < dollar
  }
  if (payMint === SOL_MINT) {
    if (solUsd === null || !Number.isFinite(solUsd) || solUsd <= 0) return false
    const usd = (Number(amountRaw) / 1e9) * solUsd
    return usd < 1 - DOLLAR_FLOOR_TOLERANCE
  }
  return false
}

/**
 * SOL's price for the $1 floor (`underOneDollar`): the market's own figure; while the market has not said it, the one an
 * order paying SOL implies — its dollar value over its SOL — so a purchase in SOL is not let under the floor for want of
 * the market's price. Null when neither says.
 */
export function floorSolUsd(
  marketSolUsd: number | null,
  order: Readonly<{ inputMint: string; inAmountRaw: string; inUsdValue: string | null }> | null,
): number | null {
  if (marketSolUsd !== null && Number.isFinite(marketSolUsd) && marketSolUsd > 0) return marketSolUsd
  if (!order || order.inputMint !== SOL_MINT || order.inUsdValue === null || !/^\d+$/.test(order.inAmountRaw)) {
    return null
  }
  const sol = Number(order.inAmountRaw) / 1e9
  const usd = Number(order.inUsdValue)
  return sol > 0 && Number.isFinite(usd) && usd > 0 ? usd / sol : null
}

/**
 * What a purchase is paid with before the person picks: USDC when the wallet can spend a dollar of it; else SOL when it can spend some; else USDC — so a wallet that holds
 * only SOL is offered its own shares, never «Недостатньо USDC». Never the asset being bought. `spendable` is the
 * wallet's read, raw, by mint; null before the read answers, and then the first quote asset stands.
 */
export function payingAssetFor(
  quoteAssets: readonly TradeAsset[],
  asset: TradeAsset | null,
  spendable: ((mint: string) => string | null) | null,
): TradeAsset {
  const offered = quoteAssets.filter((candidate) => candidate.mint !== asset?.mint)
  const first = offered[0] ?? quoteAssets[0]!
  if (!spendable) return first
  const usdc = offered.find((candidate) => candidate.mint === USDC_MINT)
  const sol = offered.find((candidate) => candidate.mint === SOL_MINT)
  const usdcRaw = usdc ? spendable(usdc.mint) : null
  if (usdc && usdcRaw !== null && /^\d+$/.test(usdcRaw) && BigInt(usdcRaw) >= ONE_DOLLAR_RAW) return usdc
  const solRaw = sol ? spendable(sol.mint) : null
  if (sol && solRaw !== null && BigInt(ticketSpendableRaw(solRaw, sol.mint)) > 0n) return sol
  return first
}

export function unitsForField(raw: string, decimals: number, locale: Locale): string {
  return formatUnits(raw, decimals, decimals, locale).split(UNIT_MARKS[locale].group).join('')
}

/**
 * The network's fee of a quote in SOL, as the server reads it (signature and priority), for «Обмін»'s line beside the
 * rate (NEW-LOOK §3) and the Review's row; null when the quote carries none. A Solana fee is never zero: a total of 0
 * is a fee the quote does not know, so it is null — a dash where it is said, never «0 SOL» (ST-5). A total under six
 * places is said to the lamport, never cut to «0». The figure is the server's — nothing is estimated here.
 */
export function quoteNetworkFee(
  order: Readonly<{ signatureFeeLamports: string; priorityFeeLamports: string }>,
  locale: Locale = 'en',
): string | null {
  if (!/^\d+$/.test(order.signatureFeeLamports) || !/^\d+$/.test(order.priorityFeeLamports)) return null
  const total = lamportsTotal([order.signatureFeeLamports, order.priorityFeeLamports])
  if (BigInt(total) === 0n) return null
  return `${formatUnits(total, 9, BigInt(total) < 1000n ? 9 : 6, locale)} SOL`
}

type FeeLamports = Readonly<{ signatureFeeLamports: string; priorityFeeLamports: string }>

/**
 * «Комісія мережі» on the Swap ticket (ST-5 r8): the quote's own fee; where a quote of the same pair states none, the
 * last fee a quote of that pair stated — the network's fee does not grow with the sum — only when the order says the
 * person pays it (`gasless: false`, the contract's field). A gasless order, or one that does not say, keeps the dash.
 * `last` is the pair's last stated fee. The figure is still the server's — nothing is estimated here.
 */
export function swapNetworkFee(
  order: FeeLamports & Readonly<{ inputMint: string; outputMint: string }>,
  last: (FeeLamports & Readonly<{ inputMint: string; outputMint: string }>) | null,
  locale: Locale = 'en',
): string | null {
  const own = quoteNetworkFee(order, locale)
  if (own !== null) return own
  const personPays = 'gasless' in order && order.gasless === false
  const samePair = last !== null && last.inputMint === order.inputMint && last.outputMint === order.outputMint
  return personPays && samePair ? quoteNetworkFee(last, locale) : null
}

function lamportsTotal(lamports: readonly string[]): string {
  let total = 0n
  for (const value of lamports) {
    if (/^\d+$/.test(value)) total += BigInt(value)
  }
  return total.toString()
}

/** Lamports as SOL with six places — the network fee's own unit. */
export function lamportsToSol(lamports: readonly string[], locale: Locale): string {
  return formatUnits(lamportsTotal(lamports), 9, 6, locale)
}

/** Seconds a Review still has; zero once its window closed. */
export function secondsLeft(expiresAt: string, now: number): number {
  const expires = Date.parse(expiresAt)
  if (!Number.isFinite(expires)) return 0
  return Math.max(0, Math.ceil((expires - now) / 1000))
}

/* ---- the client's readiness rule before a wallet opens (the web's, kept word for word) ---- */

/** Ten seconds: the least a wallet needs to raise its prompt and a person to read and press it. */
export const MIN_ACTIONABLE_REVIEW_MS = 10_000

/** Every rule the swap policy must have judged; a verdict that skips one is no verdict. */
export const REQUIRED_RULES = [
  'NETWORK_MAINNET',
  'PAIR_DISTINCT',
  'OUTPUT_ASSET_REVIEWED',
  'PAYOUT_TO_SIGNER',
  'FEE_PAYER_IS_SIGNER',
  'BYTES_INSPECTED',
  'SIMULATION_OK',
  'OWNER_EFFECTS_PROVEN',
  'SLIPPAGE_BOUNDED',
  'PRICE_IMPACT_DISCLOSED',
  'VALUE_DISCLOSED',
  'REVIEW_FRESH',
] as const

/**
 * Every refusal Trade can say, as a key of its copy — the routes' codes
 * grouped by what the person can do next (`tradeFailureKey`), the flow's own
 * wallet and window refusals, and the readiness rule's. The words live in
 * `copy.ts`, in both languages.
 */
export const TRADE_FAILURE_KEYS = [
  'paused',
  'notOffered',
  'forbiddenOrigin',
  'notSetUp',
  'preSignRefused',
  'finalCheckFailed',
  'routeUnconfirmed',
  'previousStillValid',
  'simulation',
  'implausible',
  'sameMint',
  'buildFailed',
  'providerDown',
  'providerRefused',
  'unchecked',
  'notPassed',
  'planBlocked',
  'planNotFound',
  'planChanged',
  'planInactive',
  'planUnavailable',
  'signIn',
  'otherWallet',
  'bytesChanged',
  'tooLong',
  'offline',
  'noRoute',
  'notEnough',
  'amount',
  'quoteExpired',
  'walletCancelled',
  'rateLimited',
  'checkingPrevious',
  'notAccepted',
  'failed',
  'walletTimeout',
  'ledgerBlind',
  'txVersion',
  'signatureUnrecorded',
  'closedUnderWallet',
  'bytesRebuilt',
  'priceRenewed',
  'deviceConfirm',
  'walletCannotSign',
  'reviewInvalidated',
  'proofNotSigned',
  'simulationNotClear',
  'effectsNotVerified',
  'orderExpired',
  'orderTooShort',
  'policyIncomplete',
] as const

export type TradeFailureKey = (typeof TRADE_FAILURE_KEYS)[number]

export type ReviewReadiness =
  | Readonly<{ ready: true; code: 'READY'; reason: string }>
  | Readonly<{
      ready: false
      code:
        | 'POLICY_BLOCKED'
        | 'PROOF_NOT_SIGNED'
        | 'SIMULATION_NOT_CLEAR'
        | 'EFFECTS_NOT_VERIFIED'
        | 'ORDER_EXPIRED'
        | 'ORDER_TOO_SHORT'
        | 'REVIEW_INVALIDATED'
      /** The words a screen says for it, in either language. */
      key: TradeFailureKey
      /** The same refusal in English — the record's own words. */
      reason: string
    }>

/** A refusal of the readiness rule, with its words in English for the record. */
function notReady(code: Exclude<ReviewReadiness, { ready: true }>['code'], key: TradeFailureKey): ReviewReadiness {
  return { ready: false, code, key, reason: TRADE_COPY.en.failures[key] }
}

export function assessReview(
  input: Readonly<{
    verdict: SwapPolicyVerdict
    proofStatus: string
    simulationStatus: string
    ownerEffectsStatus: string
    expiresAt: string
    now: number
    invalidated?: boolean
  }>,
): ReviewReadiness {
  if (input.invalidated) return notReady('REVIEW_INVALIDATED', 'reviewInvalidated')
  if (input.proofStatus !== 'SIGNED') return notReady('PROOF_NOT_SIGNED', 'proofNotSigned')
  if (input.simulationStatus !== 'OK') return notReady('SIMULATION_NOT_CLEAR', 'simulationNotClear')
  if (input.ownerEffectsStatus !== 'VERIFIED') return notReady('EFFECTS_NOT_VERIFIED', 'effectsNotVerified')
  const expires = Date.parse(input.expiresAt)
  if (!Number.isFinite(expires) || input.now >= expires) return notReady('ORDER_EXPIRED', 'orderExpired')
  if (expires - input.now < MIN_ACTIONABLE_REVIEW_MS) return notReady('ORDER_TOO_SHORT', 'orderTooShort')
  const byRule = new Map(input.verdict.findings.map((finding) => [finding.rule, finding]))
  const complete = REQUIRED_RULES.every((rule) => byRule.has(rule)) && byRule.size === REQUIRED_RULES.length
  const blocking = REQUIRED_RULES.filter((rule) => byRule.get(rule)?.outcome === 'BLOCK')
  if (!complete || blocking.length > 0 || input.verdict.decision === 'BLOCK') {
    return notReady('POLICY_BLOCKED', complete ? 'notPassed' : 'policyIncomplete')
  }
  return { ready: true, code: 'READY', reason: 'The exact reviewed order is ready for the wallet’s visible approval.' }
}

/* ---- the Review as rows ---- */

/** Which of the Review's lines a row is — what the new look's short «Перевірка» picks its four lines by. */
export type ReviewKey =
  'receive' | 'minimum' | 'price' | 'impact' | 'slippage' | 'networkFee' | 'reserve' | 'serviceFee' | 'jupiterFee'

export type ReviewLine = Readonly<{
  label: string
  value: string
  tone?: 'fg' | 'muted' | 'success' | 'danger' | 'warning'
  emphasis?: boolean
  key?: ReviewKey
}>

export type ReviewView = Readonly<{
  /** "You pay" and "You receive" as the person reads them. */
  pay: string
  receive: string
  rows: readonly ReviewLine[]
  warnings: readonly string[]
}>

/** The notes a REVIEW finding carries onto the card — the web's own, by the rule (`swap-card.tsx`). */
export const REVIEW_WARNING_KEYS = [
  'assetReview',
  'slippageDiffers',
  'slippageWide',
  'reviewCarefully',
  'priceImpact',
  'usdUnknown',
] as const

export type ReviewWarningKey = (typeof REVIEW_WARNING_KEYS)[number]

/**
 * What each finding the policy left for the person to judge says, as the web
 * says it: a reviewed asset, a slippage whose minimum disagrees with its bound
 * or runs past 3 %, an impact, a value without a dollar figure; any other rule
 * asks for a careful look. The server's own sentence is never shown — it has
 * no Ukrainian.
 */
export function reviewWarnings(
  findings: readonly SwapPolicyVerdict['findings'][number][],
  order: Readonly<{ outAmountRaw: string; minReceivedRaw: string; slippageBps: number }>,
): ReviewWarningKey[] {
  const out: ReviewWarningKey[] = []
  for (const finding of findings) {
    if (finding.outcome !== 'REVIEW') continue
    if (finding.rule === 'OUTPUT_ASSET_REVIEWED') out.push('assetReview')
    else if (finding.rule === 'SLIPPAGE_BOUNDED') {
      const quoted = /^\d+$/.test(order.outAmountRaw) ? BigInt(order.outAmountRaw) : 0n
      const minimum = /^\d+$/.test(order.minReceivedRaw) ? BigInt(order.minReceivedRaw) : 0n
      const implied = quoted > 0n ? Number(((quoted - minimum) * 10_000n) / quoted) : 0
      const effective = Math.max(order.slippageBps, implied)
      const notes: ReviewWarningKey[] = []
      if (Math.abs(implied - order.slippageBps) > 1) notes.push('slippageDiffers')
      if (effective > 300) notes.push('slippageWide')
      out.push(...(notes.length > 0 ? notes : (['reviewCarefully'] as const)))
    } else if (finding.rule === 'PRICE_IMPACT_DISCLOSED') out.push('priceImpact')
    else if (finding.rule === 'VALUE_DISCLOSED') out.push('usdUnknown')
    else out.push('reviewCarefully')
  }
  return out
}

function decimalsOf(decimals: Readonly<Record<string, number>>, asset: TradeAsset): number | null {
  const known = decimals[asset.mint]
  return typeof known === 'number' ? known : asset.decimals
}

/** Jupiter states impact as a signed fraction of a percent; a favourable −0.0001 is not a warning and never prints as −0.00%. */
export function priceImpactPercent(priceImpactPct: string): number | null {
  const value = Number(priceImpactPct)
  if (!Number.isFinite(value)) return null
  return Math.max(0, Math.round(value * 100) / 100)
}

/** A fixed-point figure in the language's shape: `0.50` · `0,50`. */
function fixed(value: number, places: number, locale: Locale): string {
  const text = value.toFixed(places)
  return locale === 'uk' ? text.replace('.', ',') : text
}

/** Ryntra's fee as one line: the rate, with the amount or the dollar figure the provider stated beside it — never a figure worked out here. */
export function serviceFeeText(fee: SwapOrderCore['ryntraFee'], locale: Locale): string {
  if (!fee || fee.basisPoints === 0) return TRADE_COPY[locale].none
  const rate = `${fixed(fee.basisPoints / 100, 2, locale)}%`
  if (fee.amountRaw && fee.decimals !== null) {
    return `${rate} · ${formatUnits(fee.amountRaw, fee.decimals, 6, locale)}${fee.symbol ? ` ${fee.symbol}` : ''}`
  }
  if (fee.usd === null || fee.usd <= 0) return rate
  return `${rate} · ${fee.usd < 0.01 ? `< $${fixed(0.01, 2, locale)}` : `≈ $${fixed(fee.usd, 2, locale)}`}`
}

/** Jupiter's total already includes Ryntra's share — a referral or, on a `/build` order (1.24.0), the platform fee; what remains is the venue's own. */
export function additionalJupiterFeeBps(total: number, fee: SwapOrderCore['ryntraFee']): number {
  if (!Number.isFinite(total) || total < 0) return 0
  const included =
    fee?.mechanism === 'JUPITER_REFERRAL' || fee?.mechanism === 'JUPITER_PLATFORM_FEE' ? fee.basisPoints : 0
  return Math.max(0, total - included)
}

/**
 * The Review's rows: expected and minimum received, the price of what the
 * person holds, the impact, the slippage the chain will enforce, every known
 * cost. `exact` marks a signable order (the network fees are known only then).
 * The labels, the figures and the notes are in the language asked for.
 */
export function reviewView(
  input: Readonly<{
    order: SwapOrderCore
    mode: TradeMode
    pay: TradeAsset
    receive: TradeAsset
    decimals: Readonly<Record<string, number>>
    exact: boolean
    findings?: readonly SwapPolicyVerdict['findings'][number][]
  }>,
  locale: Locale,
): ReviewView | null {
  const payDecimals = decimalsOf(input.decimals, input.pay)
  const receiveDecimals = decimalsOf(input.decimals, input.receive)
  if (payDecimals === null || receiveDecimals === null) return null
  const words = TRADE_COPY[locale]
  const units = (raw: string, decimals: number) => formatUnits(raw, decimals, 6, locale)
  const { order } = input
  const rows: ReviewLine[] = []
  rows.push({
    key: 'receive',
    label: input.exact ? words.rows.receive : words.rows.receiveEstimate,
    value: `${units(order.outAmountRaw, receiveDecimals)} ${input.receive.symbol}`,
  })
  // The minimum is the chain's guarantee and exists only on the exact order; an estimate has none to promise.
  if (input.exact) {
    rows.push({
      key: 'minimum',
      label: words.rows.minimum,
      value: `${units(order.minReceivedRaw, receiveDecimals)} ${input.receive.symbol}`,
      emphasis: true,
    })
  }
  const inAmount = rawToNumber(order.inAmountRaw, payDecimals)
  const outAmount = rawToNumber(order.outAmountRaw, receiveDecimals)
  // A rate from a crumb is the crumb's rounding, not the market's (ST-5 r7: 1 raw unit of cbBTC read «1 SOL ≈ 0,001», 21 % off): none is said.
  if (inAmount > 0 && outAmount > 0 && rateIsPrecise(order.inAmountRaw, order.outAmountRaw)) {
    // The market's price in the quote asset whichever way the order runs: a Buy, and a Swap paid in USDC, price what is received.
    const priceReceived = input.mode === 'buy' || (input.mode === 'swap' && input.pay.mint === USDC_MINT)
    const price = priceReceived
      ? `1 ${input.receive.symbol} ≈ ${formatRate(inAmount / outAmount, locale)} ${input.pay.symbol}`
      : `1 ${input.pay.symbol} ≈ ${formatRate(outAmount / inAmount, locale)} ${input.receive.symbol}`
    rows.push({ key: 'price', label: words.rows.price, value: price })
  }
  const impact = priceImpactPercent(order.priceImpactPct)
  if (impact !== null) {
    rows.push({
      key: 'impact',
      label: words.rows.impact,
      value: `${fixed(impact, 2, locale)}%`,
      tone: impact >= 3 ? 'danger' : impact >= 1 ? 'warning' : undefined,
    })
  }
  if (input.exact)
    rows.push({ key: 'slippage', label: words.rows.slippage, value: `${fixed(order.slippageBps / 100, 2, locale)}%` })
  if (input.exact) {
    rows.push({
      key: 'networkFee',
      label: words.rows.networkFee,
      // Unknown is a dash, never «0 SOL» (`quoteNetworkFee`).
      value: quoteNetworkFee(order, locale) ?? '—',
    })
    if (/^\d+$/.test(order.rentFeeLamports) && BigInt(order.rentFeeLamports) > 0n) {
      rows.push({
        key: 'reserve',
        label: words.rows.reserve,
        value: `${formatUnits(order.rentFeeLamports, 9, 6, locale)} SOL`,
      })
    }
  }
  rows.push({ key: 'serviceFee', label: words.rows.serviceFee, value: serviceFeeText(order.ryntraFee ?? null, locale) })
  const additional = additionalJupiterFeeBps(order.totalFeeBasisPoints, order.ryntraFee ?? null)
  if (additional > 0)
    rows.push({ key: 'jupiterFee', label: words.rows.jupiterFee, value: `${fixed(additional / 100, 2, locale)}%` })
  const warnings = reviewWarnings(input.findings ?? [], order).map((key) => words.warnings[key])
  return {
    pay: `${units(order.inAmountRaw, payDecimals)} ${input.pay.symbol}`,
    receive: `${units(order.outAmountRaw, receiveDecimals)} ${input.receive.symbol}`,
    rows,
    warnings,
  }
}

/**
 * The new look's short «Перевірка» (NEW-LOOK §3): Спишеться · Отримаєш (with the chain's minimum) · Усі витрати (each
 * cost the server stated, Ryntra's own among them — never a total worked out here) · Що це; the price, the impact,
 * the slippage and any other line stay a tap deeper, as they are. Every figure is the Review's own.
 */
export type CheckSummary = Readonly<{
  spend: string
  receive: string
  minimum: string | null
  /** Each cost on its own line, as the server stated it: Ryntra's fee, the network's, the account's reserve. */
  costs: readonly Readonly<{
    key: 'serviceFee' | 'networkFee' | 'reserve' | 'jupiterFee'
    label: string
    value: string
  }>[]
  /** What stays a tap deeper. */
  details: readonly ReviewLine[]
}>

const COST_KEYS = ['serviceFee', 'networkFee', 'reserve', 'jupiterFee'] as const

export function checkSummary(view: ReviewView): CheckSummary {
  const byKey = (key: ReviewKey) => view.rows.find((row) => row.key === key) ?? null
  const costs = COST_KEYS.flatMap((key) => {
    const row = byKey(key)
    return row ? [{ key, label: row.label, value: row.value }] : []
  })
  const shown = new Set<ReviewKey | undefined>(['receive', 'minimum', ...COST_KEYS])
  return {
    spend: view.pay,
    receive: byKey('receive')?.value ?? view.receive,
    minimum: byKey('minimum')?.value ?? null,
    costs,
    details: view.rows.filter((row) => !shown.has(row.key)),
  }
}

/**
 * The least raw units either side of an order has for its rate to be said: from 1 000 the rounding of a unit moves the
 * rate by at most 0,1 % — under it a satoshi's rounding is the rate (ST-5 r7).
 */
export const RATE_MIN_RAW = 1000n

/** Whether an order's two raw amounts are large enough for their ratio to be the market's rate, not a rounding. */
export function rateIsPrecise(inAmountRaw: string, outAmountRaw: string): boolean {
  if (!/^\d+$/.test(inAmountRaw) || !/^\d+$/.test(outAmountRaw)) return false
  return BigInt(inAmountRaw) >= RATE_MIN_RAW && BigInt(outAmountRaw) >= RATE_MIN_RAW
}

/** Significant digits a rate keeps, in both languages alike (ST-5 r7): «105,25», «0,00127», never 4 places in one and 1 in the other. */
const RATE_SIGNIFICANT = 6

/**
 * A rate as the person reads it: six significant digits (a whole number from 100 000 keeps its whole part), trailing
 * zeros gone, grouped and marked as the language writes — worked out here, not by the engine's `Intl`, so both languages
 * say the same digits. A dash when not a positive number.
 */
export function formatRate(value: number, locale: Locale): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  const magnitude = Math.floor(Math.log10(value))
  const places = Math.min(20, Math.max(0, RATE_SIGNIFICANT - 1 - magnitude))
  const [whole = '0', fraction = ''] = value.toFixed(places).split('.')
  const marks = UNIT_MARKS[locale]
  const kept = fraction.replace(/0+$/, '')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, marks.group)
  return kept.length > 0 ? `${grouped}${marks.fraction}${kept}` : grouped
}

/** What a known amount of a token is worth at its market price, in dollars; null when the amount, the decimals or a positive price is not known. */
export function usdAtPrice(
  raw: string | null,
  decimals: number | null,
  price: number | null | undefined,
): number | null {
  if (raw === null || !/^\d+$/.test(raw) || decimals === null) return null
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null
  const amount = rawToNumber(raw, decimals)
  return Number.isFinite(amount) && amount > 0 ? amount * price : null
}

/** Above this, a swap's two dollar figures name the price lost between them (ST-5 r9) — display only, nothing decided on it. */
export const PRICE_LOSS_SHOWN_PCT = 1

/**
 * What a swap loses on the price, per cent of what is given — the dollars given against the dollars received, both
 * known; null when either is unknown or the loss is within `PRICE_LOSS_SHOWN_PCT` (a gain is no loss).
 */
export function priceLossPct(inUsd: number | null | undefined, outUsd: number | null | undefined): number | null {
  if (typeof inUsd !== 'number' || !Number.isFinite(inUsd) || inUsd <= 0) return null
  if (typeof outUsd !== 'number' || !Number.isFinite(outUsd) || outUsd < 0) return null
  const loss = (1 - outUsd / inUsd) * 100
  return loss > PRICE_LOSS_SHOWN_PCT ? loss : null
}

/** What a leg of a swap says of its token beside it: Jupiter's check, its flag, a stock's look-alike (ST-5 r7). */
export type LegMarks = Readonly<{ unverified: boolean; flagged: boolean; lookalikeOf: string | null }>

/**
 * A leg's marks, from what the list it was picked from said and from its market row read since: a token either calls
 * unverified or flagged is marked; nothing either said is never a mark. Null for no token.
 */
export function legMarks(
  asset: TradeAsset | null,
  row: Readonly<{ verified: boolean; suspicious: boolean }> | null,
): LegMarks | null {
  if (!asset) return null
  return {
    unverified: asset.verified === false || row?.verified === false,
    flagged: asset.suspicious === true || row?.suspicious === true,
    lookalikeOf: asset.lookalikeOf ?? null,
  }
}

/** The one warning a swap says over its legs, the strongest first: a stock's look-alike, then a flag, then no check. */
export function legWarning(
  marks: readonly (LegMarks | null)[],
): Readonly<{ kind: 'lookalike'; company: string } | { kind: 'flagged' } | { kind: 'unverified' }> | null {
  const company = marks.find((mark) => mark?.lookalikeOf)?.lookalikeOf
  if (company) return { kind: 'lookalike', company }
  if (marks.some((mark) => mark?.flagged)) return { kind: 'flagged' }
  if (marks.some((mark) => mark?.unverified)) return { kind: 'unverified' }
  return null
}

/* ---- what went wrong, in the product's words (the web's map, kept in step) ---- */

export type TradeFailureCopy = Readonly<{ key: TradeFailureKey; message: string; retryable: boolean }>

/** The refusals a person can press again for; every other one stops until something changes. */
const RETRYABLE: ReadonlySet<TradeFailureKey> = new Set<TradeFailureKey>([
  'finalCheckFailed',
  'routeUnconfirmed',
  'previousStillValid',
  'implausible',
  'buildFailed',
  'providerDown',
  'providerRefused',
  'planUnavailable',
  'tooLong',
  'offline',
  'noRoute',
  'notEnough',
  'amount',
  'quoteExpired',
  'walletCancelled',
  'rateLimited',
  'checkingPrevious',
  'failed',
  'walletTimeout',
  'ledgerBlind',
  'signatureUnrecorded',
  'closedUnderWallet',
  'bytesRebuilt',
  'priceRenewed',
  'deviceConfirm',
])

/** A route's, the wallet's or Trade's own refusal code — which words say it (the web's map, kept in step). */
export function tradeFailureKey(code: string): TradeFailureKey {
  // A Ledger behind the wallet (M45): «Blind signing» off, or bytes a Ledger cannot sign yet.
  if (/^LEDGER_BLIND_SIGNING$/.test(code)) return 'ledgerBlind'
  if (/^WALLET_CANNOT_SIGN$/.test(code)) return 'walletCannotSign'
  // AG-2: the Review built again after the bytes aged out under a wallet; twice in a row, the plain «within 20 s».
  if (/^BYTES_REBUILT$/.test(code)) return 'bytesRebuilt'
  // AG-2b: the Review renewed its bytes at the press and a figure came out worse — the person looks again.
  if (/^REVIEW_RENEWED$/.test(code)) return 'priceRenewed'
  if (/^BYTES_AGED$/.test(code)) return 'deviceConfirm'
  if (/^TX_VERSION$/.test(code)) return 'txVersion'
  if (/^WALLET_TIMEOUT$/.test(code)) return 'walletTimeout'
  if (/SWAP_PAUSED/.test(code)) return 'paused'
  if (/^ASSET_NOT_OFFERED$/.test(code)) return 'notOffered'
  /* The server answers a native client by its bearer only once line A opens these routes to it (request 13). */
  if (/^FORBIDDEN_ORIGIN$/.test(code)) return 'forbiddenOrigin'
  if (
    /PROOF_NOT_SIGNED|ISSUER_KEY_MISSING|STORE_NOT_DURABLE|PROVIDER_KEY_MISSING|NO_INDEPENDENT_RPC|PRODUCTION_KEY_REQUIRED|DURABLE_MULTI_WRITER/.test(
      code,
    )
  ) {
    return 'notSetUp'
  }
  if (/SWAP_PRE_SIGN_REFUSED/.test(code)) return 'preSignRefused'
  if (/^ADOPTED_SIMULATION_(FAILED|UNAVAILABLE)$/.test(code)) return 'finalCheckFailed'
  if (/^SIMULATION_(FAILED|UNAVAILABLE)$/.test(code)) return 'routeUnconfirmed'
  if (code === 'BLOCKHASH_STILL_VALID') return 'previousStillValid'
  if (/SIMULATION/.test(code)) return 'simulation'
  if (/IMPLAUSIBLE_QUOTE/.test(code)) return 'implausible'
  if (/SAME_MINT/.test(code)) return 'sameMint'
  if (/ORDER_BUILD_FAILED/.test(code)) return 'buildFailed'
  if (/ORDER_UNREACHABLE|ORDER_HTTP_ERROR|EXECUTE_UNREACHABLE|EXECUTE_HTTP_ERROR/.test(code)) return 'providerDown'
  if (/ORDER_REFUSED|ORDER_MALFORMED|EXECUTE_REFUSED|EXECUTE_MALFORMED/.test(code)) return 'providerRefused'
  if (/PASSPORT_REFUSED|MINT_UNREADABLE/.test(code)) return 'unchecked'
  if (/INTENT_REFUSED|SWAP_POLICY_BLOCKED|PREFLIGHT_REFUSED|POLICY_BLOCKED/.test(code)) return 'notPassed'
  /* Under a plan the Strategy block answers first (contract §3b): each refusal is the plan's own, nothing was built or sent. */
  if (/^PLAN_REVIEW_BLOCKED$/.test(code)) return 'planBlocked'
  if (/^PLAN_NOT_FOUND$/.test(code)) return 'planNotFound'
  if (/^PLAN_VERSION_CONFLICT$/.test(code)) return 'planChanged'
  if (/^PLAN_STATE_REFUSED$/.test(code)) return 'planInactive'
  if (/^PLAN_EXECUTION_UNAVAILABLE$/.test(code)) return 'planUnavailable'
  if (/^UNAUTHORIZED$|^SESSION_EXPIRED$|^SESSION_REVOKED$/.test(code)) return 'signIn'
  if (/^WALLET_MISMATCH$/.test(code)) return 'otherWallet'
  if (/TRANSACTION_|REVIEWED_BYTES_MISMATCH|WALLET_MODIFIED_BYTES|WALLET_GUARDS/.test(code)) return 'bytesChanged'
  if (/^HTTP_(502|503|504)$/.test(code) || /TIMEOUT|GATEWAY/.test(code)) return 'tooLong'
  if (/^NETWORK$/.test(code)) return 'offline'
  if (/NO_ROUTE/.test(code)) return 'noRoute'
  if (/INSUFFICIENT|BALANCE/.test(code)) return 'notEnough'
  if (/AMOUNT/.test(code)) return 'amount'
  if (/EXPIRED|STALE|BLOCKHASH|TOO_SHORT/.test(code)) return 'quoteExpired'
  if (/WALLET_REFUSED|USER_REJECTED|CANCELLED|DECLINED/.test(code)) return 'walletCancelled'
  if (/RATE_LIMITED/.test(code)) return 'rateLimited'
  if (/OWNER.*LOCK|SUBMISSION_UNKNOWN|RECOVERY/.test(code)) return 'checkingPrevious'
  if (/VALIDATION/.test(code)) return 'notAccepted'
  return 'failed'
}

/** A refusal's words in the language asked for, and whether pressing again can help. */
export function tradeFailureCopy(code: string, locale: Locale = 'en'): TradeFailureCopy {
  return failureCopyOf(tradeFailureKey(code), locale)
}

/** AG-2: «built again» is a note over a fresh Review, not a refusal — said in the warning tone. */
export function failureTone(key: string): 'danger' | 'warning' {
  return key === 'bytesRebuilt' || key === 'priceRenewed' ? 'warning' : 'danger'
}

/** The words of one refusal by its key. */
export function failureCopyOf(key: TradeFailureKey, locale: Locale = 'en'): TradeFailureCopy {
  return { key, message: TRADE_COPY[locale].failures[key], retryable: RETRYABLE.has(key) }
}

/* ---- the one attempt record: a signature that exists is recovered, never re-signed ---- */

export type TradeAttemptState = 'SIGNED_NOT_SENT' | 'SUBMITTED_UNKNOWN' | 'SETTLED'

/** What the person was doing when they signed — so the settled card can say Bought · Sold · Swapped in their units. */
export type TradeContext = Readonly<{
  mode: TradeMode
  pay: TradeAsset
  receive: TradeAsset
  payDecimals: number
  receiveDecimals: number
  inAmountRaw: string
  outAmountRaw: string
  minReceivedRaw: string
}>

/**
 * Whether a Review the app kept belongs to the ticket on screen now (M44.3): the same kind of order and both of its
 * legs — what is paid and what is received — exactly the ticket's. Anything else would show one order under another
 * order's names, so it is never taken back here.
 */
export function reviewBelongsHere(
  context: Pick<TradeContext, 'mode' | 'pay' | 'receive'>,
  here: Readonly<{ mode: TradeMode; pay: string | null; receive: string | null }>,
): boolean {
  return context.mode === here.mode && context.pay.mint === here.pay && context.receive.mint === here.receive
}

export type TradeAttempt = Readonly<{
  schema: 'ryntra.mobile.trade-attempt'
  schemaVersion: '1.0.0'
  requestId: string
  signature: string
  taker: string
  state: TradeAttemptState
  recordedAt: string
  context: TradeContext | null
}>

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/

export function parseTradeAttempt(stored: string | null | undefined): TradeAttempt | null {
  if (!stored || stored.length > 8_192) return null
  try {
    const value = JSON.parse(stored) as Partial<TradeAttempt>
    if (
      value.schema !== 'ryntra.mobile.trade-attempt' ||
      value.schemaVersion !== '1.0.0' ||
      typeof value.requestId !== 'string' ||
      value.requestId.length < 1 ||
      value.requestId.length > 128 ||
      typeof value.signature !== 'string' ||
      value.signature.length < 64 ||
      value.signature.length > 96 ||
      !BASE58.test(value.signature) ||
      typeof value.taker !== 'string' ||
      value.taker.length < 32 ||
      value.taker.length > 44 ||
      !BASE58.test(value.taker) ||
      !['SIGNED_NOT_SENT', 'SUBMITTED_UNKNOWN', 'SETTLED'].includes(value.state ?? '') ||
      typeof value.recordedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.recordedAt))
    ) {
      return null
    }
    return { ...(value as TradeAttempt), context: value.context ?? null }
  } catch {
    return null
  }
}

/** After the server answered: unresolved stays a recovery state for that signature; anything else is settled. */
export function transitionTradeAttempt(
  attempt: TradeAttempt,
  result: Readonly<{ kind: 'FAILURE' } | { kind: 'SUCCESS'; serverState: string }>,
): TradeAttempt {
  const unresolved =
    result.kind === 'FAILURE' ||
    result.serverState === 'SUBMITTED_UNKNOWN' ||
    result.serverState === 'RECOVERY_PENDING' ||
    result.serverState === 'PENDING' ||
    result.serverState === 'UNKNOWN' ||
    result.serverState === 'RECOVERY'
  return { ...attempt, state: unresolved ? 'SUBMITTED_UNKNOWN' : 'SETTLED' }
}

/** The taker's signature out of the signed wire, base58 — null when the taker did not sign it. */
export function readTakerSignature(signedWireBase64: string, taker: string): string | null {
  try {
    const wire = base64ToBytes(signedWireBase64)
    if (!wire) return null
    const decoded = getTransactionDecoder().decode(wire)
    const raw = (decoded.signatures as unknown as Readonly<Record<string, Uint8Array | null>>)[taker]
    if (!raw || raw.length !== 64 || raw.every((byte) => byte === 0)) return null
    return getBase58Decoder().decode(raw)
  } catch {
    return null
  }
}

/* ---- the settled card ---- */

export type SettledView = Readonly<{
  status: 'settled' | 'pending' | 'failed' | 'recovered'
  title: string
  paid: string
  received: string
  note: string | null
  signature: string | null
}>

/**
 * The execute route's answer to a landed swap is the receipt's own
 * reconciliation state — `MATCHED` when the chain did what the Review said,
 * `DEVIATION_RECORDED` when it filled but not to the figure — and the
 * recovery route's is `RECOVERED` or `ALREADY_RECEIPTED`. All four are a
 * fill; the person's money moved. Only the states below them are not.
 */
const SETTLED_STATES = new Set([
  'MATCHED',
  'DEVIATION_RECORDED',
  'RECEIPTED',
  'RECOVERED',
  'ALREADY_RECEIPTED',
  'SETTLED',
])
const PENDING_STATES = new Set([
  'SUBMITTED_UNKNOWN',
  'RECOVERY_PENDING',
  'PENDING',
  'SEEN_WITHOUT_RECORD',
  'UNKNOWN',
  'RECOVERY',
])
const NOTHING_STATES = new Set(['EXPIRED_BEFORE_SUBMIT', 'UNKNOWN_TO_CHAIN'])

/**
 * How the fill stood against the quote: an AMM moves between the quote and
 * the block, so a little more or a little less is the ordinary case and is
 * said as a figure — above the quote, or below it yet above the minimum.
 */
function fillNote(
  actual: SwapSettlement['observation'],
  context: TradeContext | null,
  deviations: readonly string[],
  locale: Locale,
): string | null {
  const words = TRADE_COPY[locale]
  if (!actual || !context || !/^\d+$/.test(actual.actualOutputRaw) || !/^\d+$/.test(context.outAmountRaw)) {
    return deviations.length > 0 ? words.filledWithNote : null
  }
  const got = BigInt(actual.actualOutputRaw)
  const quoted = BigInt(context.outAmountRaw)
  if (got === quoted) return null
  const difference = formatUnits(
    (got > quoted ? got - quoted : quoted - got).toString(),
    context.receiveDecimals,
    6,
    locale,
  )
  return got > quoted
    ? words.filledAbove(difference, context.receive.symbol)
    : words.filledBelow(difference, context.receive.symbol)
}

/**
 * A sentence the server or the recovery put on a settlement: said as it is in
 * English; in Ukrainian only the one the phone itself writes has its words —
 * any other has none, and the state's own words stand in (null).
 */
function settlementNote(text: string | null | undefined, locale: Locale): string | null {
  if (!text) return null
  if (locale === 'en') return text
  return text === TRADE_COPY.en.seenWithoutReceipt ? TRADE_COPY[locale].seenWithoutReceipt : null
}

const RECEIPT_HEADLINE =
  /^Swap (\d+) raw of [1-9A-HJ-NP-Za-km-z]+ for (\d+) raw of [1-9A-HJ-NP-Za-km-z]+ \(quoted (\d+), minimum (\d+)\)\.$/

/**
 * The chain's figures out of a stored receipt. A recovery that finds the
 * swap already receipted answers with the receipt artifact alone, whose
 * first observed effect names what left and what arrived in raw units; the
 * figures are read from that sentence and nowhere else. Anything that does
 * not match yields nothing — never a guess.
 */
export function observationFromReceipt(receipt: unknown): SwapSettlement['observation'] {
  if (!receipt || typeof receipt !== 'object') return null
  const outcome = (receipt as { outcome?: { observedEffects?: readonly { description?: unknown }[] } }).outcome
  const effects = outcome?.observedEffects
  if (!Array.isArray(effects)) return null
  for (const effect of effects) {
    const text = typeof effect?.description === 'string' ? effect.description : ''
    const match = RECEIPT_HEADLINE.exec(text)
    if (match) return { actualInputRaw: match[1]!, actualOutputRaw: match[2]! }
  }
  return null
}

/** The receipt's own verdict on the fill, when the settlement carries the artifact and nothing else. */
function receiptStatus(receipt: unknown): string | null {
  if (!receipt || typeof receipt !== 'object') return null
  const status = (receipt as { outcome?: { status?: unknown } }).outcome?.status
  return typeof status === 'string' ? status : null
}

/**
 * What the server's settlement means for the person, in their units and
 * language: what left, what arrived, and whether the chain agreed with the Review.
 */
export function settledView(
  settlement: SwapSettlement,
  context: TradeContext | null,
  locale: Locale = 'en',
): SettledView {
  const words = TRADE_COPY[locale]
  const amounts = (input: string, output: string) =>
    context
      ? {
          paid: `${formatUnits(input, context.payDecimals, 6, locale)} ${context.pay.symbol}`,
          received: `${formatUnits(output, context.receiveDecimals, 6, locale)} ${context.receive.symbol}`,
        }
      : { paid: '—', received: '—' }
  // A signature this phone never made — found on the server for this wallet — is named as what it is.
  const earlier = context === null
  const verb = context
    ? context.mode === 'buy'
      ? words.bought(context.receive.symbol)
      : context.mode === 'sell'
        ? words.sold(context.pay.symbol)
        : words.swapped(context.pay.symbol, context.receive.symbol)
    : words.earlierTrade
  // The chain's own figures beside a state that is not a refusal are a fill whatever the state is called.
  const filled =
    SETTLED_STATES.has(settlement.state) ||
    (settlement.observation !== null &&
      !PENDING_STATES.has(settlement.state) &&
      !NOTHING_STATES.has(settlement.state) &&
      !/FAIL|EXPIRED|REFUSED/.test(settlement.state))
  if (filled) {
    const actual = settlement.observation ?? observationFromReceipt(settlement.receipt)
    const figures = actual
      ? amounts(actual.actualInputRaw, actual.actualOutputRaw)
      : context
        ? amounts(context.inAmountRaw, context.outAmountRaw)
        : amounts('', '')
    const deviations = settlement.facts?.reconciliation.deviations ?? []
    const minimumMet = settlement.facts?.reconciliation.minimumMet
    const note =
      minimumMet === false
        ? words.differs
        : !actual && context
          ? words.fromReview
          : receiptStatus(settlement.receipt) === 'DEVIATION_RECORDED' && !fillNote(actual, context, deviations, locale)
            ? words.filledWithNote
            : fillNote(actual, context, deviations, locale)
    return {
      status: settlement.state === 'RECOVERED' ? 'recovered' : 'settled',
      title: verb,
      ...figures,
      note,
      signature: settlement.signature,
    }
  }
  if (PENDING_STATES.has(settlement.state)) {
    const figures = context ? amounts(context.inAmountRaw, context.outAmountRaw) : amounts('', '')
    return {
      status: 'pending',
      title: verb,
      ...figures,
      note:
        settlementNote(settlement.recovery, locale) ??
        settlementNote(settlement.reason, locale) ??
        words.outcomeUnknown,
      signature: settlement.signature,
    }
  }
  if (NOTHING_STATES.has(settlement.state)) {
    return {
      status: 'failed',
      title: earlier ? words.earlierNothing : words.nothingHappened,
      paid: '—',
      received: '—',
      note: words.neverSent(earlier),
      signature: settlement.signature,
    }
  }
  if (settlement.state === 'EXPIRED_AFTER_SUBMIT') {
    return {
      status: 'failed',
      title: earlier ? words.earlierNotFilled : words.notFilled,
      paid: '—',
      received: '—',
      note: words.sentNotLanded(earlier),
      signature: settlement.signature,
    }
  }
  return {
    status: 'failed',
    title: earlier ? words.earlierNotFilled : words.notFilled,
    paid: '—',
    received: '—',
    note:
      settlementNote(settlement.recovery, locale) ??
      settlementNote(settlement.reason, locale) ??
      words.notFilledByNetwork(earlier),
    signature: settlement.signature,
  }
}
