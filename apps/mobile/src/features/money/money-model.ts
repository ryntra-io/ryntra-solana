/**
 * «Гроші» as values — pure. What the wallet can send and in which units, the
 * transfer's input, «Перевірка» drawn from the server's `check` (the phone
 * counts none of it), what a recipient check, a settle, a recovery and a
 * payment link mean in the person's words, and the one record of a signed
 * transfer that survives the app closing. The rule for that record is the
 * web's, word for word (`lib/solana/send-pending.client.ts`). Nothing here
 * talks to the network or holds a key.
 */

import type {
  AddressEvidenceRead,
  PayLink,
  PayLinkStatus,
  RecipientCheckResponse,
  TransferCheck,
  TransferInput,
  TransferRecovery,
  TransferSettleResult,
} from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/locale.ts'
import { formatUnits } from '../trade/trade-model.ts'
import { MONEY_COPY, type EvidenceSummary, type MoneyCopy } from './copy.ts'

export const SEND_NETWORK = 'mainnet' as const
export const NATIVE_SOL_DECIMALS = 9
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

/* ---- what the wallet can send ---- */

/** One holding as Send offers it: `mint` null is native SOL. Amounts in the chain's raw units. */
export type SendAsset = Readonly<{
  key: string
  mint: string | null
  symbol: string
  name: string | null
  icon: string | null
  decimals: number
  /** The balance with the network's reserve already withheld — what a transfer can carry. */
  spendableRaw: string
  usdPrice: number | null
}>

/** The fields of a holding Send reads — the holdings route's own shape. */
export type HoldingLike = Readonly<{
  kind: string
  mint: string | null
  spendableRaw: string
  decimals: number
  symbol: string | null
  name: string | null
  catalog: Readonly<{
    symbol: string | null
    name: string | null
    usdPrice: string | null
    icon?: string | null
  }> | null
}>

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`
}

/** What the wallet holds and can move: USDC first, SOL next, then the rest by their dollar worth. A zero balance is not offered. */
export function sendAssets(holdings: readonly HoldingLike[]): readonly SendAsset[] {
  const rows: SendAsset[] = []
  for (const holding of holdings) {
    if (!/^\d+$/.test(holding.spendableRaw) || BigInt(holding.spendableRaw) === 0n) continue
    const native = holding.kind === 'NATIVE_SOL'
    if (!native && !holding.mint) continue
    const price = holding.catalog?.usdPrice ? Number(holding.catalog.usdPrice) : null
    rows.push({
      key: native ? 'SOL' : (holding.mint as string),
      mint: native ? null : holding.mint,
      symbol: native ? 'SOL' : holding.catalog?.symbol || holding.symbol || shortMint(holding.mint as string),
      name: native ? 'Solana' : holding.catalog?.name || holding.name || null,
      icon: holding.catalog?.icon ?? null,
      decimals: native ? NATIVE_SOL_DECIMALS : holding.decimals,
      spendableRaw: holding.spendableRaw,
      usdPrice: price !== null && Number.isFinite(price) ? price : null,
    })
  }
  const worth = (asset: SendAsset) =>
    asset.usdPrice === null ? -1 : (Number(asset.spendableRaw) / 10 ** asset.decimals) * asset.usdPrice
  const rank = (asset: SendAsset) => (asset.mint === USDC_MINT ? 0 : asset.mint === null ? 1 : 2)
  return rows.sort((left, right) => rank(left) - rank(right) || worth(right) - worth(left))
}

/** The transfer as the plan route takes it: native SOL or a token, the sender, the recipient, the raw amount. */
export function transferInput(
  asset: Pick<SendAsset, 'mint'>,
  sender: string,
  recipient: string,
  amountRaw: string,
): TransferInput {
  return asset.mint === null
    ? {
        schemaVersion: '1.0.0',
        actionRef: 'action:solana-token-2022/native-sol-transfer@1',
        network: SEND_NETWORK,
        sender,
        recipient,
        amountRaw,
      }
    : {
        schemaVersion: '1.0.0',
        actionRef: 'action:solana-token-2022/spl-transfer@1',
        network: SEND_NETWORK,
        mint: asset.mint,
        sender,
        recipient,
        amountRaw,
      }
}

/** True when the typed raw amount is more than the asset can carry. */
export function overBalance(amountRaw: string | null, asset: Pick<SendAsset, 'spendableRaw'> | null): boolean {
  if (!amountRaw || !asset || !/^\d+$/.test(asset.spendableRaw)) return false
  return BigInt(amountRaw) > BigInt(asset.spendableRaw)
}

/**
 * «Можна надіслати»: what one asset can carry, in raw units, or null when it is unknown (a dash, never a zero).
 * A row the read carries says its own spendable; a row absent says zero only when the read was complete — for a
 * token, the token accounts read whole; for SOL, a native balance of zero.
 */
export function spendableOf(
  row: Readonly<{ spendableRaw?: string | null; decimals?: number | null }> | null | undefined,
  absentIsZero: boolean,
): Readonly<{ raw: string; decimals: number | null }> | null {
  if (!row) return absentIsZero ? { raw: '0', decimals: null } : null
  const raw = row.spendableRaw
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null
  return { raw, decimals: typeof row.decimals === 'number' ? row.decimals : null }
}

/* ---- exact decimals, said in the person's language ---- */

const EXACT = /^(\d+)(?:\.(\d+))?$/

/** An exact decimal the server sent («1250.5», never grouped) as the person reads it: «1,250.5» · «1 250,5». A malformed one is a dash. */
export function decimalText(exact: string | null | undefined, locale: Locale): string {
  const match = exact ? EXACT.exec(exact) : null
  if (!match) return '—'
  const fraction = (match[2] ?? '').replace(/0+$/, '')
  const raw = `${match[1]}${fraction}`
  return formatUnits(raw.replace(/^0+(?=\d)/, ''), fraction.length, fraction.length, locale)
}

/** A whole address in groups of four, as the eye checks it against what was pasted — a look-alike copies only the start and the end. */
export function addressGroups(value: string): readonly string[] {
  return value.match(/.{1,4}/g) ?? []
}

/**
 * Which groups of four «Кому» draws strongest (M44.4): an address's first and last groups — what a person compares —
 * or, for a look-alike of a recent address, the groups where it differs from that address: its edges already match,
 * so the edges are no comparison at all.
 */
export function strongGroups(value: string, lookalikeOf: string | null = null): readonly boolean[] {
  const groups = addressGroups(value)
  if (!lookalikeOf) return groups.map((_, index) => index === 0 || index === groups.length - 1)
  // Where the two differ, counted from both ends — addresses run 32 to 44 characters, so a look-alike may be longer
  // or shorter; a matching edge stays quiet whatever the lengths.
  let head = 0
  while (head < value.length && head < lookalikeOf.length && value[head] === lookalikeOf[head]) head += 1
  let tail = 0
  while (
    tail < value.length - head &&
    tail < lookalikeOf.length - head &&
    value[value.length - 1 - tail] === lookalikeOf[lookalikeOf.length - 1 - tail]
  )
    tail += 1
  const from = head
  const to = value.length - tail
  return groups.map((group, index) => {
    const start = index * 4
    const end = start + group.length
    return start < to && end > from
  })
}

export function shortAddress(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}…${value.slice(-6)}`
}

/* ---- «Перевірка»: the server's rows, labelled ---- */

export type CheckRow = Readonly<{ label: string; value: string; emphasis?: boolean }>

/**
 * The Review's rows in the card's order — Надсилаєш · Комісія емітента ·
 * Отримувач отримає (only when less arrives) · Комісія мережі ·
 * Відкриття рахунку or the least a new address takes. Every figure is the
 * server's; a rent it could not read is a dash, never a zero.
 */
export function checkRows(check: TransferCheck, symbol: string, locale: Locale): readonly CheckRow[] {
  const words = MONEY_COPY[locale]
  const rows: CheckRow[] = [
    { label: words.youSend, value: `${decimalText(check.send.amount, locale)} ${symbol}`, emphasis: true },
  ]
  if (check.issuerFee)
    rows.push({ label: words.issuerFee, value: `${decimalText(check.issuerFee.amount, locale)} ${symbol}` })
  if (check.receive.less)
    rows.push({ label: words.recipientGets, value: `${decimalText(check.receive.amount, locale)} ${symbol}` })
  rows.push({ label: words.networkFee, value: `${decimalText(check.networkFee.sol, locale)} SOL` })
  if (check.setup)
    rows.push({
      label: words.accountSetup,
      value: check.setup.sol === null ? '—' : `${decimalText(check.setup.sol, locale)} SOL`,
    })
  if (check.minimum)
    rows.push({
      label: words.newAddressMinimum,
      value: check.minimum.sol === null ? '—' : `${decimalText(check.minimum.sol, locale)} SOL`,
    })
  return rows
}

export type CheckLine = Readonly<{ line: string; stops: boolean }>

/** What to read before confirming, and why a Review is not ready — both in the server's own words, in the person's language. */
export function checkNotes(
  check: TransferCheck,
  locale: Locale = 'en',
): Readonly<{ blocked: string | null; warnings: readonly CheckLine[] }> {
  return {
    blocked: check.blocked ? check.blocked[locale] : null,
    warnings: check.warnings.map((warning) => ({ line: warning[locale], stops: warning.stops })),
  }
}

/* ---- refusals into words ---- */

export type SendFailureKey = keyof MoneyCopy['failures']

/** A route's code into the card's sentence — matched, as the web matches it, because one answer arrives under four names. */
export function sendFailureKey(code: string | null): SendFailureKey {
  const value = code ?? ''
  if (value === 'NETWORK') return 'network'
  // M41.2: a `.skr` name read again before a step — before the generic patterns, which would read «UNAVAILABLE» in them.
  if (value === 'SKR_GONE') return 'nameGone'
  if (value === 'SKR_CHANGED') return 'nameMoved'
  if (value === 'SKR_UNREAD') return 'nameUnread'
  if (value === 'SKR_UNREAD_SIGNED') return 'nameUnreadSigned'
  if (value === 'SKR_UNCHECKED') return 'nameUnchecked'
  if (value === 'REVIEW_CHANGED') return 'changed'
  if (value === 'NOT_SENDABLE') return 'cannotSend'
  if (value === 'WALLET_REFUSED') return 'walletCancelled'
  if (value === 'WALLET_TIMEOUT') return 'walletTimeout'
  if (value === 'LEDGER_BLIND_SIGNING') return 'ledgerBlind'
  if (value === 'TX_VERSION') return 'txVersion'
  if (value === 'WALLET_CANNOT_SIGN') return 'cannotSign'
  if (value === 'WALLET_FAILED' || value === 'WALLET_NOT_FOUND') return 'walletFailed'
  if (/RATE_LIMITED/.test(value)) return 'rateLimited'
  if (/INSUFFICIENT|BALANCE|AMOUNT/.test(value)) return 'amount'
  if (/RECIPIENT|ADDRESS|DESTINATION/.test(value)) return 'recipient'
  if (/PLAN_EXPIRED|DUPLICATE_INTENT|EXPIRED|STALE|BLOCKHASH/.test(value)) return 'window'
  if (/WALLET_REFUSED|USER_REJECTED|CANCELLED/.test(value)) return 'walletCancelled'
  if (/BYTES|FINGERPRINT|SIGNED_BYTES|NOT_SIGNED|UNREADABLE/.test(value)) return 'bytes'
  if (/SUBMISSION_UNKNOWN|RECOVERY/.test(value)) return 'earlier'
  if (/SEND_NOT_PERMITTED|PAUSED/.test(value)) return 'turnedOff'
  if (/UNAVAILABLE|STORE|READBACK|PROOF|POLICY/.test(value)) return 'unavailable'
  return 'generic'
}

/**
 * A settle refusal the server gave before anything reached the network — the
 * signed bytes were never broadcast, so the record of them may go. Anything
 * else (no answer, an unknown submission, a deadline) keeps the record: the
 * one costly mistake is letting a second transfer through.
 */
const SETTLE_BEFORE_SUBMIT = new Set([
  'RATE_LIMITED',
  'OWNER_CANARY_UNAVAILABLE',
  'JSON_REQUIRED',
  'INVALID_CONTENT_LENGTH',
  'BODY_TOO_LARGE',
  'BODY_REQUIRED',
  'INVALID_BODY_STREAM',
  'INVALID_JSON',
  'VALIDATION_ERROR',
  'SEND_NOT_PERMITTED',
  'REVIEW_PROOF_UNAVAILABLE',
  'SETTLEMENT_STORE_UNAVAILABLE',
  'REVIEW_PROVIDER_CHANGED',
  'PLAN_INVALID',
  'PLAN_PREFLIGHT_DISAGREE',
  'REVIEW_PROOF_INVALID',
  'NOT_READY',
  'SIGNED_BYTES_REJECTED',
  'PLAN_EXPIRED',
  'NOT_CLEARED',
])

export function settleRefusedBeforeSubmit(code: string, signature: string | null): boolean {
  return signature === null && SETTLE_BEFORE_SUBMIT.has(code)
}

/* ---- the outcome ---- */

export type SendOutcome = 'sent' | 'not-sent' | 'open'

/** What a settle answer means for the money: sent with a receipt, nothing moved, or still open. */
export function settleOutcome(result: TransferSettleResult): SendOutcome {
  if (result.state === 'RECEIPTED') return result.landingState === 'LANDED_FAILED' ? 'not-sent' : 'sent'
  // Landed and confirmed by the chain, its receipt not observed yet: the money moved.
  if (result.state === 'RECOVERY') return result.landingState === 'LANDED_FAILED' ? 'not-sent' : 'sent'
  if (result.state === 'EXPIRED') return 'not-sent'
  return 'open'
}

/* ---- a signed transfer the app may close on (the web's rule, word for word) ---- */

export type PendingSend = Readonly<{
  schema: 'ryntra.mobile.send-pending'
  wallet: string
  signature: string
  network: 'mainnet'
  /** When this device learned the signature, not when the network saw it. */
  signedAt: string
  /** What was sent, said again on the card: «12,5 USDC → 7xKX…». */
  summary: Readonly<{ amount: string; symbol: string; to: string }> | null
}>

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** A stored record read back is untrusted: a malformed one is «nothing pending». */
export function parsePendingSend(stored: string | null | undefined): PendingSend | null {
  if (!stored) return null
  try {
    const value = JSON.parse(stored) as Record<string, unknown>
    if (value.schema !== 'ryntra.mobile.send-pending') return null
    if (typeof value.wallet !== 'string' || !WALLET.test(value.wallet)) return null
    if (typeof value.signature !== 'string' || !SIGNATURE.test(value.signature)) return null
    if (value.network !== 'mainnet') return null
    if (typeof value.signedAt !== 'string' || Number.isNaN(Date.parse(value.signedAt))) return null
    const summary = value.summary as PendingSend['summary'] | undefined
    const keptSummary =
      summary &&
      typeof summary === 'object' &&
      typeof summary.amount === 'string' &&
      typeof summary.symbol === 'string' &&
      typeof summary.to === 'string'
        ? summary
        : null
    return {
      schema: 'ryntra.mobile.send-pending',
      wallet: value.wallet,
      signature: value.signature,
      network: 'mainnet',
      signedAt: value.signedAt,
      summary: keptSummary,
    }
  } catch {
    return null
  }
}

/** How long signed bytes can still reach the network — a blockhash's ninety seconds with room. */
export const BLOCKHASH_WINDOW_MS = 120_000

export type ResumeShow = 'CHECKING' | 'LANDED' | 'FAILED' | 'UNKNOWN' | null

export type ResumeDecision = Readonly<{ show: ResumeShow; forget: boolean; keepPolling: boolean }>

/** What a recovery answer means for a signed transfer nobody has an outcome for. No answer is not an outcome. */
export function decideResume(answer: {
  read: Readonly<{ seen: boolean; err: string | null; hasAttempt: boolean }> | null
  ageMs: number
}): ResumeDecision {
  const { read, ageMs } = answer
  if (!read) return { show: 'UNKNOWN', forget: false, keepPolling: true }
  if (read.seen) return { show: read.err !== null ? 'FAILED' : 'LANDED', forget: true, keepPolling: false }
  if (!read.hasAttempt && Number.isFinite(ageMs) && ageMs > BLOCKHASH_WINDOW_MS) {
    return { show: null, forget: true, keepPolling: false }
  }
  return { show: 'UNKNOWN', forget: false, keepPolling: true }
}

/** The recovery route's answer as `decideResume` reads it: the primary read, the independent one when it saw more. */
export function resumeReadOf(
  recovery: TransferRecovery,
): Readonly<{ seen: boolean; err: string | null; hasAttempt: boolean }> {
  const independent = recovery.independent?.status ?? null
  const primary = recovery.primary.status
  const seenBy = primary.seen ? primary : independent?.seen ? independent : primary
  return { seen: seenBy.seen, err: seenBy.err, hasAttempt: recovery.attempt !== null }
}

/** Whether an earlier transfer in this state must hold back a new signature: an open question does, an answer does not. */
export function blocksNewSend(show: ResumeShow): boolean {
  switch (show) {
    case 'CHECKING':
    case 'UNKNOWN':
      return true
    case 'LANDED':
    case 'FAILED':
    case null:
      return false
    default: {
      const unreachable: never = show
      void unreachable
      return true
    }
  }
}

/* ---- the recipient ---- */

export type RecipientView =
  | Readonly<{ kind: 'transfer'; address: string; opensAccount: boolean }>
  | Readonly<{ kind: 'pay-link'; link: PayLink }>
  | Readonly<{ kind: 'problem'; line: string }>

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** How many bytes a base58 text decodes to — a Solana address is exactly 32; null when it is not base58 at all. */
export function base58ByteLength(text: string): number | null {
  if (text.length === 0) return null
  let value = 0n
  for (const char of text) {
    const digit = BASE58_ALPHABET.indexOf(char)
    if (digit < 0) return null
    value = value * 58n + BigInt(digit)
  }
  // Each leading «1» is a zero byte of its own; the rest is the number's own bytes.
  let zeros = 0
  while (zeros < text.length && text[zeros] === '1') zeros += 1
  let bytes = 0
  while (value > 0n) {
    value >>= 8n
    bytes += 1
  }
  return zeros + bytes
}

/** The shortest a Solana address is written: 32 characters. */
export const ADDRESS_MIN_CHARS = 32

/**
 * What the phone itself knows of a typed recipient before asking the server: a plain base58 text that cannot be
 * an address is the wrong length — said without a request (the server's own answer for such text named something
 * else). While the text is still short and being typed, nothing is said yet: `typing` until it is 32 characters, or
 * the person left the field or pressed «Далі». Anything else — a link, a request, a full address — is the server's.
 */
export function recipientLocal(typed: string, finished: boolean): 'typing' | 'wrong-length' | null {
  const text = typed.trim()
  if (text === '') return null
  const bytes = base58ByteLength(text)
  if (bytes === null) return null
  if (text.length < ADDRESS_MIN_CHARS && !finished) return 'typing'
  return bytes === 32 ? null : 'wrong-length'
}

/** The wrong length in the recipient check's own words. */
export function wrongLengthView(locale: Locale = 'en'): RecipientView {
  return { kind: 'problem', line: MONEY_COPY[locale].recipientProblems.WRONG_LENGTH }
}

/** An Ethereum address: «0x» and forty hex digits. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

/**
 * The recipient check's one decision, in words. An Ethereum «0x…» address the
 * server refused is named as one — not read as a Solana address mistyped.
 */
export function recipientView(check: RecipientCheckResponse, locale: Locale = 'en', typed = ''): RecipientView {
  const words = MONEY_COPY[locale]
  if (check.next === 'transfer' && check.address) {
    return { kind: 'transfer', address: check.address, opensAccount: check.destination?.opensAccount ?? false }
  }
  if (check.next === 'pay-link' && check.link) return { kind: 'pay-link', link: check.link }
  if (check.problem === 'SELF' && check.input === 'pay-link') return { kind: 'problem', line: words.selfLink }
  if (EVM_ADDRESS.test(typed.trim())) return { kind: 'problem', line: words.evmAddress }
  return {
    kind: 'problem',
    line: words.recipientProblems[check.problem ?? 'NOT_AN_ADDRESS'] ?? words.failures.recipient,
  }
}

/* ---- the security source's one line (the web's six words, never «safe») ---- */

export function evidenceSummary(read: AddressEvidenceRead): EvidenceSummary {
  if (!read.evidence) return read.state === 'UNKNOWN' ? 'unsupported' : 'unavailable'
  const { sanctions, findings } = read.evidence
  if (sanctions.state === 'sanctioned') return 'sanctioned'
  if (findings.state === 'answered' && ((findings.high ?? 0) > 0 || (findings.medium ?? 0) > 0)) return 'evidence-found'
  if (findings.state === 'unsupported') return 'unsupported'
  const findingsClean = findings.state === 'answered'
  const sanctionsClean = sanctions.state === 'clean'
  if (findingsClean && sanctionsClean) return 'nothing-found'
  if (findingsClean || sanctionsClean) return 'partly-checked'
  return 'unavailable'
}

/* ---- payment links ---- */

/** While a payment can still arrive the link is read again; the server itself reads the chain at most every eight seconds. */
export const PAY_LINK_POLL_MS = 8_000

export function linkIsLive(status: PayLinkStatus): boolean {
  return status === 'AWAITING' || status === 'CHECKING' || status === 'UNKNOWN'
}

/** The link's amount in the person's language with its token, or null when the payer chooses. */
export function linkAmount(link: PayLink, locale: Locale): string | null {
  if (!link.amount || !/^\d+$/.test(link.amount.raw)) return null
  return `${formatUnits(link.amount.raw, link.token.decimals, link.token.decimals, locale)} ${link.token.symbol}`
}

/** What arrived on a paid link, in the person's language. */
export function linkCredited(link: PayLink, locale: Locale): string | null {
  if (!link.paid || !/^\d+$/.test(link.paid.creditedRaw)) return null
  return `${formatUnits(link.paid.creditedRaw, link.token.decimals, link.token.decimals, locale)} ${link.token.symbol}`
}

/** The tone of a link's state: paid is the one green word; a note beside a payment is a warning. */
export function linkTone(link: PayLink): 'success' | 'warning' | 'neutral' | 'danger' {
  if (link.status === 'PAID') return link.note ? 'warning' : 'success'
  if (link.status === 'EXPIRED') return 'danger'
  if (link.status === 'AWAITING') return 'neutral'
  return 'warning'
}

/** A typed amount for a link as the contract takes it: an exact decimal with a dot and no grouping, or null for «the payer chooses». */
export function linkAmountInput(text: string): string | null | 'invalid' {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return null
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return 'invalid'
  if (!/[1-9]/.test(trimmed)) return 'invalid'
  return trimmed.replace(/^0+(?=\d)/, '')
}

/** The address QR's text — what any Solana wallet scans to pay this address. */
export function addressPayUrl(address: string): string {
  return `solana:${address}`
}

/** The explorer page of one signature. */
export function explorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`
}
