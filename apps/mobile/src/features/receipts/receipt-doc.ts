/**
 * A receipt as a document — pure. Every finished operation the phone shows
 * (a purchase, a sale, a swap, a launch, «Забрати», a launch's trade, a
 * transfer) and every entry of «Бортовий журнал» folds into one shape: what
 * kind of operation, what left and what arrived in the asset's own units, the
 * fees each on its own row, the time, the state. The picture a person shares
 * is drawn from it by `shareFace`: never a wallet's address — the document
 * holds none — and no amount unless the person chose to show the amounts;
 * a fee hidden that way keeps only its rate. The transaction's signature
 * stays on the phone's own card: one hop on an explorer names the wallet.
 * Nothing here reads the network.
 */

import { SOL_MINT, USDC_MINT, type SwapSettlement } from '../../lib/api.ts'
import type {
  LaunchClaimReceipt,
  LaunchJournalEvent,
  LaunchJournalResponse,
  LaunchPairView,
  LaunchTokenResponse,
  LaunchTradeQuoteResponse,
  LaunchTradeSubmitResponse,
  TransferSettleResult,
} from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/i18n.ts'
import { DASH, formatAmount } from '../../utils/format.ts'
import type { HistoryRow } from '../history/history-model.ts'
import { formatShareUnits, unitsFromRaw } from '../invest/buy-model.ts'
import { decimalText } from '../money/money-model.ts'
import type { LaunchWord } from '../launch/copy.ts'
import { journalDetail, journalFigures, journalMark, journalName, type JournalMark } from '../launch/journal-view.ts'
import { formatRaw, fromRaw } from '../launch/launch-format.ts'
import { formatUnits, observationFromReceipt, type TradeContext } from '../trade/trade-model.ts'

/** What stands in for an amount the person chose not to show. */
export const MASK = '•••'

export type DocKind =
  | 'buy'
  | 'sell'
  | 'swap'
  | 'launch'
  | 'claim'
  | 'launchBuy'
  | 'launchSell'
  | 'send'
  | 'receive'
  | 'bridge'
  | 'crossSwap'
  | 'journal'
  | 'other'

export type DocStatus = 'done' | 'pending' | 'failed' | 'partial' | 'needsYou'

/** An amount in an asset's own units: the figure (null — not read, a dash) and the asset's name. */
export type DocLeg = Readonly<{ amount: string | null; symbol: string; dollar: boolean }>

/** Where a fee went: the network, the venue the trade ran on, Ryntra, the token's creator, the pool's liquidity, a new account's rent, the token's own transfer fee. */
export type DocFeeKind = 'network' | 'venue' | 'ryntra' | 'creator' | 'liquidity' | 'rent' | 'tokenFee'

export type DocFee = Readonly<{
  kind: DocFeeKind
  /** The amount with its unit, or null where only the rate is known. */
  amount: string | null
  /** The rate in percent, where the record states one. */
  percent: number | null
  /** False when the fee was due and not taken. */
  collected: boolean
}>

/** A part of what arrived, by where it came from — «Забрати» by source. */
export type DocPartKind = 'curve' | 'graduation' | 'lp' | 'vault'
export type DocPart = Readonly<{ kind: DocPartKind; leg: DocLeg }>

export type DocInitiator = 'you' | 'rule' | 'plan'

export type ReceiptDoc = Readonly<{
  id: string
  kind: DocKind
  /** «Куплено SOL», «Запущено $THUMB» — in the person's language, from the surface's own words. */
  title: string
  status: DocStatus
  gave: readonly DocLeg[]
  got: readonly DocLeg[]
  parts: readonly DocPart[]
  fees: readonly DocFee[]
  at: string | null
  initiator: DocInitiator | null
  /** A journal entry's line, with its amounts and without them. */
  detail: Readonly<{ shown: string; masked: string }> | null
  mark: JournalMark
  /** What a journal entry is about — the token's ticker, «$COMM». */
  subject: string | null
  /** The transaction — the phone's card only, never the picture. */
  signature: string | null
  /** The assets the receipt touches, for the search: tickers and market addresses. */
  symbols: readonly string[]
  mints: readonly string[]
}>

const leg = (amount: string | null, symbol: string, dollar = false): DocLeg => ({
  amount: amount === DASH || amount === '' ? null : amount,
  symbol,
  dollar,
})

const isRaw = (value: string | null | undefined): value is string => typeof value === 'string' && /^\d+$/.test(value)

const positive = (raw: string | null | undefined): raw is string => isRaw(raw) && BigInt(raw) > 0n

/** A pair as a launch's preset or market names it; the preset does not say whether it is a dollar. */
type PairUnits = Readonly<{ symbol: string; decimals: number; dollar?: boolean }>

function pairLeg(raw: string, pair: PairUnits, locale: Locale): DocLeg {
  const dollar = pair.dollar ?? false
  if (!dollar) return leg(formatRaw(raw, pair.decimals, locale, Math.min(pair.decimals, 6)), pair.symbol)
  // Dollars to the cent, cut and never rounded up; a crumb is «< 0,01», never a false zero.
  const cents = Number(fromRaw(raw, pair.decimals, 2))
  if (cents === 0 && BigInt(raw) > 0n) return leg(`< ${formatCents(0.01, locale)}`, pair.symbol, true)
  return leg(formatCents(cents, locale), pair.symbol, true)
}

const formatCents = (value: number, locale: Locale) =>
  new Intl.NumberFormat(locale === 'uk' ? 'uk-UA' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)

function tokenLeg(raw: string, decimals: number, symbol: string, locale: Locale): DocLeg {
  return leg(formatRaw(raw, decimals, locale, Math.min(decimals, 4)), `$${symbol}`)
}

const unique = (values: readonly (string | null | undefined)[]): string[] => [
  ...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)),
]

function base(id: string, kind: DocKind, title: string, status: DocStatus): ReceiptDoc {
  return {
    id,
    kind,
    title,
    status,
    gave: [],
    got: [],
    parts: [],
    fees: [],
    at: null,
    initiator: null,
    detail: null,
    mark: null,
    subject: null,
    signature: null,
    symbols: [],
    mints: [],
  }
}

/* ---- the sources ---- */

/** A row of History — the server's ledger: a purchase, a sale, a swap, a launch's trade, a transfer. */
export function docFromHistory(row: HistoryRow, title: string): ReceiptDoc {
  const kind: DocKind = row.launch
    ? row.kind === 'sell'
      ? 'launchSell'
      : 'launchBuy'
    : row.kind === 'other'
      ? 'other'
      : row.kind
  const fees: DocFee[] = []
  if (row.fee) {
    const rateOnly = row.fee.text === DASH || row.fee.text.endsWith('%')
    fees.push({
      kind: 'ryntra',
      amount: rateOnly ? null : row.fee.text,
      percent: row.fee.basisPoints === null ? null : row.fee.basisPoints / 100,
      collected: row.fee.collected,
    })
  }
  const status = row.status
  // Nothing moved on an operation that did not happen: no legs, and only a fee that was taken all the same.
  const failed = status === 'failed'
  const known = row.kind === 'buy' || row.kind === 'sell' || row.kind === 'swap' || row.kind === 'send'
  return {
    ...base(row.id, kind, title, status),
    gave: row.out && !failed ? [leg(row.out.amountText, row.out.symbol)] : [],
    got: row.in && !failed ? [leg(row.in.amountText, row.in.symbol)] : [],
    fees: failed ? fees.filter((fee) => fee.collected) : fees,
    at: row.at,
    initiator: !known ? null : row.rule ? 'rule' : row.plan ? 'plan' : 'you',
    signature: row.signature ?? (row.destinationTx && !row.destinationTx.startsWith('0x') ? row.destinationTx : null),
    symbols: unique([row.out?.symbol, row.in?.symbol]),
    mints: unique([...row.mints, row.launch?.token]),
  }
}

/** An amount in units, never a false zero: a crumb below the last place shown is «< 0,000001». */
function unitsText(raw: string, decimals: number, places: number, locale: Locale): string {
  const text = formatUnits(raw, decimals, places, locale)
  if (BigInt(raw) === 0n || /[1-9]/.test(text)) return text
  return `< ${formatAmount(10 ** -places, places, locale)}`
}

/**
 * Ryntra's fee on a swap: a row only where it was due — taken (`COLLECTED`,
 * the only income) or due and not taken (`NOT_COLLECTED`); none where
 * there was no fee to take. The amount the chain shows it took, else the
 * one the provider stated.
 */
function serviceFee(settlement: SwapSettlement | null, locale: Locale): DocFee[] {
  const fee = settlement?.facts?.fees?.serviceFee
  if (!fee || (fee.state !== 'COLLECTED' && fee.state !== 'NOT_COLLECTED')) return []
  const collected = fee.state === 'COLLECTED'
  const decimals = fee.decimals ?? (fee.asset === USDC_MINT ? 6 : fee.asset === SOL_MINT ? 9 : null)
  const raw = collected ? (settlement?.observation?.serviceFeeCollectedRaw ?? fee.amountRaw) : null
  const amount =
    isRaw(raw) && decimals !== null && fee.symbol
      ? `${unitsText(raw, decimals, Math.min(6, decimals), locale)} ${fee.symbol}`
      : null
  return [
    {
      kind: 'ryntra',
      amount,
      percent: Number.isFinite(fee.basisPoints) ? fee.basisPoints / 100 : null,
      collected,
    },
  ]
}

/** The network's fee as the chain shows it — the base and the priority, both read — in SOL; not read, no row. */
function networkFee(base: string | null | undefined, priority: string | null | undefined, locale: Locale): DocFee[] {
  if (!isRaw(base) || !isRaw(priority)) return []
  const lamports = (BigInt(base) + BigInt(priority)).toString()
  return [{ kind: 'network', amount: `${formatUnits(lamports, 9, 9, locale)} SOL`, percent: null, collected: true }]
}

/**
 * A swap the phone signed — in Trade, a company's purchase, sale or
 * exchange: the chain's figures, else the Review's marked «≈». A company's
 * token counted in shares carries its multiplier, as the sheet counts it.
 * An operation that did not happen moved nothing and shows no figure.
 */
export function docFromSwap(
  args: Readonly<{
    title: string
    status: DocStatus
    settlement: SwapSettlement | null
    context: TradeContext | null
    at: string
    rule?: boolean
    multipliers?: Readonly<{ pay?: number | null; receive?: number | null }>
  }>,
  locale: Locale,
): ReceiptDoc {
  const { settlement, context } = args
  const kind: DocKind = context ? context.mode : 'swap'
  const actual = settlement ? (settlement.observation ?? observationFromReceipt(settlement.receipt)) : null
  const input = actual?.actualInputRaw ?? context?.inAmountRaw ?? null
  const output = actual?.actualOutputRaw ?? context?.outAmountRaw ?? null
  const approx = actual ? '' : '≈ '
  const amount = (raw: string | null, decimals: number, multiplier: number | null | undefined) => {
    if (!isRaw(raw)) return null
    const text =
      typeof multiplier === 'number'
        ? formatShareUnits(unitsFromRaw(raw, decimals, multiplier) ?? 0, locale)
        : unitsText(raw, decimals, Math.min(6, decimals), locale)
    return `${approx}${text}`
  }
  const failed = args.status === 'failed'
  const observation = settlement?.observation ?? null
  const facts = settlement?.facts?.fees
  return {
    ...base(settlement?.signature ?? `${kind}:${args.at}`, kind, args.title, args.status),
    gave:
      context && !failed ? [leg(amount(input, context.payDecimals, args.multipliers?.pay), context.pay.symbol)] : [],
    got:
      context && !failed
        ? [leg(amount(output, context.receiveDecimals, args.multipliers?.receive), context.receive.symbol)]
        : [],
    fees: failed
      ? []
      : [
          ...networkFee(
            observation?.baseFeeLamports ?? facts?.baseLamports,
            observation?.priorityFeeLamports ?? facts?.priorityLamports,
            locale,
          ),
          ...serviceFee(settlement, locale),
        ],
    at: args.at,
    initiator: args.rule ? 'rule' : 'you',
    signature: settlement?.signature ?? null,
    symbols: unique([context?.pay.symbol, context?.receive.symbol]),
    mints: unique([context?.pay.mint, context?.receive.mint]),
  }
}

/** A launch: the creator's first buy — what was paid and the tokens it bought — from the launch receipt. */
export function docFromLaunch(
  token: LaunchTokenResponse,
  pair: PairUnits | null,
  title: string,
  locale: Locale,
): ReceiptDoc {
  const first = token.receipt?.creatorFirstBuy ?? null
  const decimals = token.receipt?.token2022.decimals ?? null
  return {
    ...base(token.signature, 'launch', title, 'done'),
    gave: first && pair ? [pairLeg(first.quoteInRaw, pair, locale)] : first ? [leg(null, DASH)] : [],
    got: first && decimals !== null ? [tokenLeg(first.tokensOutRaw, decimals, token.symbol, locale)] : [],
    at: token.receipt?.created.at ?? token.launchedAt,
    initiator: 'you',
    signature: token.signature,
    symbols: unique([token.symbol, `$${token.symbol}`, pair?.symbol]),
    mints: [token.token],
  }
}

/** A launch as «Мої лаунчі» lists it, before its receipt is read: its name and its time. */
export function docFromLaunchRow(
  row: Readonly<{ token: string; symbol: string; launchedAt: string }>,
  title: string,
): ReceiptDoc {
  return {
    ...base(`launch:${row.token}`, 'launch', title, 'done'),
    at: row.launchedAt,
    initiator: 'you',
    symbols: unique([row.symbol, `$${row.symbol}`]),
    mints: [row.token],
  }
}

/** A buy or a sale of a launched token, as the phone sent it: the fill, and the trade's fee by who it went to. */
export function docFromLaunchTrade(
  args: Readonly<{
    token: string
    symbol: string
    tokenDecimals: number
    pair: Pick<LaunchPairView, 'symbol' | 'decimals' | 'dollar' | 'mint'>
    quote: LaunchTradeQuoteResponse
    submit: LaunchTradeSubmitResponse
    title: string
    at: string
  }>,
  locale: Locale,
): ReceiptDoc {
  const { quote, submit, pair } = args
  const buy = quote.side === 'buy'
  const tokensRaw = submit.filled?.tokensRaw ?? (buy ? quote.amountOutRaw : quote.amountInRaw)
  const pairRaw = submit.filled?.pairRaw ?? (buy ? quote.amountInRaw : quote.amountOutRaw)
  // Not filled yet: the quote's figures, said as an estimate.
  const approx = (value: DocLeg): DocLeg =>
    submit.filled || value.amount === null ? value : { ...value, amount: `≈ ${value.amount}` }
  const tokens = approx(tokenLeg(tokensRaw, args.tokenDecimals, args.symbol, locale))
  const money = approx(pairLeg(pairRaw, pair, locale))
  // The fee by who it went to, from the quote: said as an estimate until the trade is filled.
  const fee = (kind: DocFeeKind, raw: string | null): DocFee | null =>
    positive(raw)
      ? {
          kind,
          amount: `${submit.filled ? '' : '≈ '}${moneyText(pairLeg(raw, pair, locale))}`,
          percent: null,
          collected: true,
        }
      : null
  const fees = [
    fee('venue', quote.fee.meteoraRaw),
    fee('creator', quote.fee.creatorRaw),
    fee('liquidity', quote.fee.liquidityRaw),
    fee('ryntra', quote.fee.ryntraRaw),
  ].filter((entry): entry is DocFee => entry !== null)
  return {
    ...base(
      submit.signature,
      buy ? 'launchBuy' : 'launchSell',
      args.title,
      submit.state === 'CONFIRMED' ? 'done' : 'pending',
    ),
    gave: [buy ? money : tokens],
    got: [buy ? tokens : money],
    fees,
    at: args.at,
    initiator: 'you',
    signature: submit.signature,
    symbols: unique([args.symbol, `$${args.symbol}`, pair.symbol]),
    mints: unique([args.token, pair.mint]),
  }
}

/** «Забрати» as its receipt states it: what arrived, and what each program paid. */
export function docFromClaim(receipt: LaunchClaimReceipt, title: string, locale: Locale): ReceiptDoc {
  const parts: DocPart[] = []
  for (const kind of ['curve', 'graduation', 'lp'] as const) {
    if (positive(receipt.paid[kind])) parts.push({ kind, leg: pairLeg(receipt.paid[kind], receipt.pair, locale) })
  }
  if (positive(receipt.vaultPaidRaw))
    parts.push({ kind: 'vault', leg: pairLeg(receipt.vaultPaidRaw, receipt.pair, locale) })
  return {
    ...base(receipt.signature, 'claim', title, 'done'),
    got: [pairLeg(receipt.receivedRaw, receipt.pair, locale)],
    parts,
    at: receipt.at,
    initiator: 'you',
    signature: receipt.signature,
    symbols: unique([receipt.symbol, `$${receipt.symbol}`, receipt.pair.symbol]),
    mints: unique([receipt.token, receipt.pair.mint]),
  }
}

/** «Забрати» just sent: what arrived by now — the whole, a part, or not yet. */
export function docFromClaimResult(
  args: Readonly<{
    token: string
    symbol: string
    pair: LaunchPairView
    kind: 'done' | 'partial' | 'pending'
    receivedRaw: bigint
    /** What went into the shared vault rather than to the wallet. */
    intoVaultRaw: bigint | null
    signature: string | null
    title: string
    at: string
  }>,
  locale: Locale,
): ReceiptDoc {
  return {
    ...base(args.signature ?? `claim:${args.token}:${args.at}`, 'claim', args.title, args.kind),
    got:
      args.kind === 'pending' || (args.receivedRaw === 0n && args.intoVaultRaw !== null)
        ? []
        : [pairLeg(args.receivedRaw.toString(), args.pair, locale)],
    parts:
      args.intoVaultRaw !== null && args.intoVaultRaw > 0n
        ? [{ kind: 'vault', leg: pairLeg(args.intoVaultRaw.toString(), args.pair, locale) }]
        : [],
    at: args.at,
    initiator: 'you',
    signature: args.signature,
    symbols: unique([args.symbol, `$${args.symbol}`, args.pair.symbol]),
    mints: unique([args.token, args.pair.mint]),
  }
}

const LAMPORTS = 9

/** A transfer: what left, and what it cost — the network's fee, a new account's rent, the token's own fee. Never the recipient. */
export function docFromSend(
  args: Readonly<{
    outcome: 'sent' | 'not-sent' | 'open'
    result: TransferSettleResult | null
    signature: string | null
    amount: string
    symbol: string
    title: string
    at: string
  }>,
  locale: Locale,
): ReceiptDoc {
  const facts = args.result && 'sendReceiptFacts' in args.result ? args.result.sendReceiptFacts : null
  const fees: DocFee[] = []
  if (facts) {
    fees.push(...networkFee(facts.actualBaseFeeLamports, facts.actualPriorityFeeLamports, locale))
    const sol = (lamports: string) => `${formatUnits(lamports, LAMPORTS, LAMPORTS, locale)} SOL`
    if (positive(facts.ataRentLamports))
      fees.push({ kind: 'rent', amount: sol(facts.ataRentLamports), percent: null, collected: true })
    if (positive(facts.transferFeeRaw)) {
      const decimals = facts.mint === USDC_MINT ? 6 : facts.mint === SOL_MINT ? 9 : null
      fees.push({
        kind: 'tokenFee',
        amount:
          decimals === null ? null : `${formatUnits(facts.transferFeeRaw, decimals, decimals, locale)} ${args.symbol}`,
        percent: null,
        collected: true,
      })
    }
  }
  const status: DocStatus = args.outcome === 'sent' ? 'done' : args.outcome === 'open' ? 'pending' : 'failed'
  return {
    ...base(args.signature ?? `send:${args.at}`, 'send', args.title, status),
    gave: status === 'failed' ? [] : [leg(decimalText(args.amount, locale), args.symbol)],
    fees,
    at: args.at,
    initiator: 'you',
    signature: args.signature,
    symbols: [args.symbol],
    mints: facts ? [facts.mint] : [],
  }
}

/** An entry of «Бортовий журнал»: its name, its line with the amounts and without them, its mark, its time. */
export function docFromJournal(
  entry: LaunchJournalEvent,
  log: LaunchJournalResponse,
  symbol: string,
  word: LaunchWord,
  locale: Locale,
): ReceiptDoc {
  const shown = journalDetail(entry, journalFigures(log, symbol, locale), word, locale)
  const masked = journalDetail(
    entry,
    { money: () => MASK, tokens: () => `${MASK} $${symbol}`, price: () => MASK },
    word,
    locale,
  )
  return {
    ...base(`${entry.signature}:${entry.kind}`, 'journal', journalName(entry, word), 'done'),
    detail: shown && masked ? { shown, masked } : null,
    mark: journalMark(entry),
    subject: `$${symbol}`,
    at: entry.at,
    signature: entry.signature,
    symbols: unique([symbol, `$${symbol}`]),
    mints: [log.token],
  }
}

/** What a leg that left is called: sent on a transfer, sold on a sale, paid on everything else. */
export function gaveWord(kind: DocKind): 'sent' | 'sold' | 'gave' {
  return kind === 'send' ? 'sent' : kind === 'sell' || kind === 'launchSell' ? 'sold' : 'gave'
}

/* ---- the picture ---- */

/** A leg as a line: «1,25 SOL», «$12,40» — or «••• SOL» while the amounts are hidden; a dash where the figure was not read. */
export function legText(value: DocLeg, show: boolean): string {
  if (value.symbol === DASH) return DASH
  if (!show) return `${MASK} ${value.symbol}`
  if (value.amount === null) return value.symbol === DASH ? DASH : `${DASH} ${value.symbol}`
  if (!value.dollar) return `${value.amount} ${value.symbol}`
  return value.amount.startsWith('< ') ? `< $${value.amount.slice(2)}` : `$${value.amount}`
}

function moneyText(value: DocLeg): string {
  return legText(value, true)
}

/** A fee's figure: the amount, with its rate where both are known; hidden, the rate alone — it says nothing of the sum. */
export function feeText(fee: DocFee, show: boolean, locale: Locale): string {
  const rate = fee.percent === null ? null : `${formatAmount(fee.percent, 2, locale)}%`
  if (!show) return rate ?? MASK
  if (fee.amount && rate) return `${fee.amount} · ${rate}`
  return fee.amount ?? rate ?? DASH
}

export type DocTimes = Readonly<{ local: string; utc: string }>

const MONTHS: Readonly<Record<Locale, Intl.DateTimeFormat>> = {
  en: new Intl.DateTimeFormat('en-US', { month: 'short' }),
  uk: new Intl.DateTimeFormat('uk-UA', { month: 'short' }),
}
const pad = (value: number) => String(value).padStart(2, '0')

/** The time twice — as the phone's clock reads it, and in UTC — each with its day and year; a dash when absent. */
export function docTimes(at: string | null, locale: Locale): DocTimes {
  const time = at ? Date.parse(at) : Number.NaN
  if (Number.isNaN(time)) return { local: DASH, utc: DASH }
  const date = new Date(time)
  const local = `${date.getDate()} ${MONTHS[locale].format(date)} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
  const utcDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12))
  const utc = `${date.getUTCDate()} ${MONTHS[locale].format(utcDay)} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  return { local, utc }
}

export type ShareFace = Readonly<{
  kind: DocKind
  title: string
  status: DocStatus
  /** The figure that leads the picture — what arrived, or what was sent — only while the amounts are shown. */
  hero: string | null
  /** Which leg the hero is: what arrived, or what was sent. */
  lead: 'got' | 'gave' | null
  /** The rows of the table under it, the hero not repeated. */
  gave: readonly string[]
  got: readonly string[]
  parts: readonly Readonly<{ kind: DocPartKind; text: string }>[]
  fees: readonly Readonly<{ kind: DocFeeKind; text: string; collected: boolean }>[]
  detail: string | null
  mark: JournalMark
  subject: string | null
  /** The time in UTC: the one a recipient anywhere reads the same. */
  time: string
  /** Whether the picture carries any amount the person could hide — the switch is offered only then. */
  hasAmounts: boolean
}>

/**
 * What the picture says: the document without its transaction and without
 * who started it — «Ти» on a picture would name its reader — the amounts
 * only when shown. A journal entry's line is left out while they are
 * hidden: a sentence of masks says nothing.
 */
export function shareFace(doc: ReceiptDoc, show: boolean, locale: Locale): ShareFace {
  const gave = doc.gave.map((value) => legText(value, show))
  const got = doc.got.map((value) => legText(value, show))
  const lead = show && doc.status !== 'failed' ? (got.length > 0 ? 'got' : gave.length > 0 ? 'gave' : null) : null
  return {
    kind: doc.kind,
    title: doc.title,
    status: doc.status,
    hero: lead === 'got' ? got[0]! : lead === 'gave' ? gave[0]! : null,
    lead,
    gave: lead === 'gave' ? gave.slice(1) : gave,
    got: lead === 'got' ? got.slice(1) : got,
    parts: doc.parts.map((part) => ({ kind: part.kind, text: legText(part.leg, show) })),
    fees: doc.fees.map((fee) => ({ kind: fee.kind, text: feeText(fee, show, locale), collected: fee.collected })),
    detail: doc.detail && show ? doc.detail.shown : null,
    mark: doc.mark,
    subject: doc.subject,
    time: docTimes(doc.at, locale).utc,
    hasAmounts:
      [...doc.gave, ...doc.got, ...doc.parts.map((part) => part.leg)].some((value) => value.amount !== null) ||
      doc.fees.some((fee) => fee.amount !== null) ||
      doc.detail !== null,
  }
}

/* ---- the list ---- */

/** Whether a receipt touches what the person typed: a ticker (with or without «$»), a market address, a word of its title. */
export function matchesQuery(doc: ReceiptDoc, query: string): boolean {
  const needle = query.trim().toLowerCase().replace(/^\$/, '')
  if (needle === '') return true
  if (
    doc.mints.some(
      (mint) => mint.toLowerCase() === needle || (needle.length >= 4 && mint.toLowerCase().startsWith(needle)),
    )
  )
    return true
  if (doc.symbols.some((symbol) => symbol.toLowerCase().replace(/^\$/, '').startsWith(needle))) return true
  return doc.title.toLowerCase().includes(needle)
}

/** Receipts from every source, newest first, each once — the same transaction from two sources is one receipt. */
export function mergeDocs(...sources: readonly (readonly ReceiptDoc[])[]): ReceiptDoc[] {
  const byKey = new Map<string, ReceiptDoc>()
  for (const doc of sources.flat()) {
    const key = doc.signature ?? doc.id
    const held = byKey.get(key)
    // The richer document wins: a bare «Операція» of the ledger gives way to the launch's own receipt.
    if (!held || (held.kind === 'other' && doc.kind !== 'other')) byKey.set(key, doc)
  }
  const time = (doc: ReceiptDoc) => (doc.at ? Date.parse(doc.at) || 0 : 0)
  return [...byKey.values()].sort((a, b) => time(b) - time(a))
}

/** A company's purchase, sale or exchange as its sheet settled it: filled, not known yet, or nothing moved. */
export function outcomeStatus(kind: 'filled' | 'pending' | 'nothing' | 'not-filled'): DocStatus {
  return kind === 'filled' ? 'done' : kind === 'pending' ? 'pending' : 'failed'
}
