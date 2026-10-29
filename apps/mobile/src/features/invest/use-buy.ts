import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useHoldings } from '@/features/portfolio/use-portfolio'
import type { Prepared } from '@/features/trade/trade-flow'
import type { TradeAsset } from '@/features/trade/trade-model'
import { useTrade } from '@/features/trade/use-trade'
import { useWallet } from '@/features/wallet/use-wallet'
import { USDC_MINT, USDT_MINT, type RuleBinding } from '@/lib/api'
import { useLocale } from '@/lib/i18n'

import { BUY_COPY } from './buy-copy'
import {
  amountFieldInput,
  amountFieldText,
  buyCheckRows,
  buyEstimate,
  buyOrderRows,
  buyShares,
  composeAction,
  DEFAULT_BUY_USD,
  isBuyableSum,
  isCompanyBuy,
  isNoRoute,
  isRateLimited,
  limitPause,
  namedWaitSeconds,
  offersPayChoice,
  PAY_ASSETS,
  payDollar,
  parseDollars,
  pickedShare,
  quotedSpendUsd,
  quoteForSum,
  reserveFirstOf,
  ryntraFeeFigures,
  sumText,
  unitsFromRaw,
  type BuyUnit,
  type IssuerFee,
  type PayDollar,
} from './buy-model'
import { BUY_ENGINE, perSharePaid, type LiveShareQuote } from './pool-warning'
import { useRouteMinimum } from './use-route-minimum'

/** A company as the purchase needs it — named, drawn and counted as the page read it. */
export type BuyCompany = Readonly<{
  mint: string
  /** The token's symbol — the venue's key, never a title on the sheet. */
  ticker: string
  /** The company as a person names it. */
  name: string
  icon: string | null
  /** The mint's decimals, when the market or the chain said; the order states them again. */
  decimals: number | null
  /** The Scaled UI Amount multiplier in force, when the mint carries one. */
  multiplier: number | null
  unit: BuyUnit
  preIpo: boolean
  /** The one line of truth; null when no issuer document was read. */
  truth: string | null
  /**
   * The issuer's event before a purchase (the IPO and conversion watch; M19): the token bought must
   * be swapped by the issuer's deadline — said under the truth, before any sum, and again in «Перевірка»; null for none.
   */
  eventLine?: string | null
  /** The fee the mint withholds on the transfer that delivers the token — PreStocks' 1 %; null when none. */
  issuerFee: IssuerFee | null
  /**
   * The share's reference and the pool as the page read them (ST-5 r8): the sheet says the page's pool warning over its
   * own action, judged again on its own live estimate, and what the shares are worth at the reference where the price
   * stands far from it. Absent or null where no issuer states a reference.
   */
  pool?: BuyPool | null
}>

/** The share's reference and the pool, as the company's page read them — display only, never part of the order. */
export type BuyPool = Readonly<{
  referencePerShare: number | null
  /** The pool's own price against the reference, per cent, as the issuer's row states it. */
  deviationPct: number | null
  liquidityUsd: number | null
  /**
   * The live quotes the page saw for the share, each with its sum and time (the sheet's own estimates, its quote for an
   * amount): the warning is judged only by the one for the sum on screen (ST-5 r9), never by another sum's.
   */
  seen: readonly LiveShareQuote[]
}>

/** How far past a limiter's pause the sheet asks, so an ask Trade's own flow makes at the window's end goes first. */
const LIMIT_YIELD_MS = 500

const rawOf = (value: string | undefined): bigint | null => (value && /^\d+$/.test(value) ? BigInt(value) : null)

/**
 * A purchase under an autoinvest reminder: the rule's own sum — null
 * until the rule is read — paid in USDC, and the occurrence it is bought
 * under while the reminder is open (`origin.rule`; the server refuses anything
 * but exactly the rule's sum of USDC for its company).
 */
export type RuleBuy = Readonly<{ amountUsd: number | null; binding: RuleBinding | null }>

/**
 * One purchase in dollars on the phone — the sheet's state over Trade's own
 * flow (M3: the server's exact Review, the wallet's signature over those
 * bytes, the one submission, the receipt, the recovery of a signature the app
 * closed on). This hook adds only what the company's sheet says around it:
 * the sum in dollars — from $1, opening on $10 — and its quick shares of the
 * wallet's dollars, which dollars pay, what the sum buys and costs, the
 * company's own minimum where the sum has no route, the four rows of
 * «Перевірка» with the account's reserve apart — the server's `check`, never
 * a count of the phone's own (contract 1.20.0) — and the one action the sheet
 * offers. A Review the app closed on comes back only
 * when it is this company's purchase. Under a reminder the sum is the rule's
 * and the dollars are USDC.
 */
export function useBuy(company: BuyCompany, rule: RuleBuy | null = null) {
  const locale = useLocale()
  const queryClient = useQueryClient()
  const wallet = useWallet()
  const [picked, setPicked] = useState<PayDollar | null>(null)

  /* ---- the wallet's dollars and its SOL — the read Trade and Portfolio share ---- */
  const holdings = useHoldings(wallet.address)
  const read = holdings.data?.data ?? null
  const complete = read?.tokenRead === 'COMPLETE'
  const balanceOf = (mint: string): bigint | null => {
    if (!read) return null
    const row = read.holdings.find((holding) => holding.mint === mint)
    if (row) return rawOf(row.spendableRaw)
    // A token account not seen is a zero only when the whole wallet was read.
    return complete ? 0n : null
  }
  const usdcRaw = balanceOf(USDC_MINT)
  const usdtRaw = balanceOf(USDT_MINT)
  // A reminder's purchase is paid in USDC: the rule's sum is dollars of USDC (contract §3j).
  const pay: PayDollar = rule ? 'USDC' : payDollar({ picked, usdcRaw, usdtRaw })
  const payAsset = PAY_ASSETS[pay]
  const payRaw = pay === 'USDT' ? usdtRaw : usdcRaw
  const payBalance = payRaw === null ? null : unitsFromRaw(payRaw.toString(), payAsset.decimals, null)
  const needsSol = read !== null && /^0+$/.test(read.lamports)

  // The sheet opens on $10 — a default, never advice: any sum from a dollar is the person's own (chosen 2026-09-25).
  const [amountText, setAmountText] = useState(() => String(DEFAULT_BUY_USD))
  const amountUsd = rule ? rule.amountUsd : parseDollars(amountText, locale)
  const valid = isBuyableSum(amountUsd)
  // The quick choices: 25 · 50 · 75 · 100 % of the paying dollars a connected wallet holds; none without one.
  const shares = useMemo(
    () => (rule || !wallet.address ? [] : buyShares(payRaw, payAsset.decimals ?? 6)),
    [rule, wallet.address, payRaw, payAsset.decimals],
  )

  /* ---- Trade's own flow, on this company's legs ---- */
  const receive = useMemo(
    (): TradeAsset => ({
      mint: company.mint,
      symbol: company.ticker,
      name: company.name,
      icon: company.icon,
      decimals: company.decimals,
    }),
    [company.mint, company.ticker, company.name, company.icon, company.decimals],
  )
  const legs = useMemo(() => ({ pay: payAsset, receive }), [payAsset, receive])
  const restore = useCallback((prepared: Prepared) => isCompanyBuy(prepared.context, company.mint), [company.mint])
  // Held by its fields: the binding is rebuilt on every read of the rule, the Review is asked under the same one.
  const ruleId = rule?.binding?.ruleId ?? null
  const dueAt = rule?.binding?.dueAt ?? null
  const binding = useMemo(() => (ruleId && dueAt ? { ruleId, dueAt } : null), [ruleId, dueAt])
  const trade = useTrade({
    mode: 'buy',
    legs,
    amountText: valid ? sumText(amountUsd) : '',
    restore,
    rule: binding,
  })

  /* ---- a quote the server's limiter held back: asked again by itself after the window, «Рахуємо ціну…» meanwhile ---- */
  // Typing at a person's pace asks once per settled sum; two asks inside the limiter's window are refused (ST-5).
  const limitedKey =
    trade.phase === 'idle' && trade.amountRaw !== null && isRateLimited(trade.quoteFailure?.code)
      ? `${payAsset.mint}:${trade.amountRaw}`
      : null
  const quoting = trade.quoting
  const refreshQuote = useRef(trade.refreshQuote)
  useEffect(() => {
    refreshQuote.current = trade.refreshQuote
  })
  // The refusal's own query, read for the wait the server named (`retryAfterSeconds`; absent — the sheet's own pauses).
  const quoteQueryKey = useMemo(
    () => ['trade', 'quote', payAsset.mint, company.mint, trade.amountRaw ?? ''] as const,
    [payAsset.mint, company.mint, trade.amountRaw],
  )
  const limitAsks = useRef<{ key: string | null; asked: number; since: number }>({ key: null, asked: 0, since: 0 })
  const [limitWaiting, setLimitWaiting] = useState<string | null>(null)
  // The sum whose asks ran out (about a minute): only then is its refusal said.
  const [limitSpent, setLimitSpent] = useState<string | null>(null)
  // A quote that came (or a new sum) lets a later refusal be waited out again (state adjusted during render).
  if (limitedKey === null && !quoting && limitSpent !== null) setLimitSpent(null)
  // A pause whose ask yielded is looked at again, so the count and the minute go on even if nothing else changed.
  const [limitLook, setLimitLook] = useState(0)
  useEffect(() => {
    if (limitedKey === null) {
      // A quote that came (or a new sum) starts the count again; one in flight keeps it.
      if (!quoting) limitAsks.current = { key: null, asked: 0, since: 0 }
      return
    }
    if (quoting) return
    if (limitAsks.current.key !== limitedKey) limitAsks.current = { key: limitedKey, asked: 0, since: Date.now() }
    const error: unknown = queryClient.getQueryState(quoteQueryKey)?.error
    const named = namedWaitSeconds(error && typeof error === 'object' ? (error as { details?: unknown }).details : null)
    const pause = limitPause(limitAsks.current.asked, Date.now() - limitAsks.current.since, named)
    if (pause === null) {
      setLimitSpent(limitedKey)
      return
    }
    limitAsks.current.asked += 1
    setLimitWaiting(limitedKey)
    const refusedAt = queryClient.getQueryState(quoteQueryKey)?.errorUpdatedAt ?? 0
    // A moment past the pause: when Trade's own flow asks again at the same window's end, this ask yields to it.
    const timer = setTimeout(() => {
      setLimitWaiting(null)
      const state = queryClient.getQueryState(quoteQueryKey)
      // Asked already (Trade's own pacing) or answered since: one ask per window, never two.
      if (!state || state.fetchStatus === 'fetching' || state.status !== 'error' || state.errorUpdatedAt !== refusedAt) {
        setLimitLook((look) => look + 1)
        return
      }
      refreshQuote.current()
    }, pause + LIMIT_YIELD_MS)
    return () => {
      clearTimeout(timer)
      setLimitWaiting(null)
    }
  }, [limitedKey, quoting, queryClient, quoteQueryKey, limitLook])
  /**
   * The quote was held back by the limiter and is being asked again: the sheet says it is pricing, not that it failed —
   * until its asks ran out.
   */
  const quoteHeld = limitedKey !== null && (limitSpent !== limitedKey || limitWaiting === limitedKey || quoting)

  /* ---- what the sum buys and costs, from the live quote — the server's count (contract 1.20.0) ---- */
  // Only a quote for the sum on screen says what it buys (ST-5 r10); until it comes the sheet is pricing.
  const payDecimals = payAsset.decimals ?? 6
  const forSum = quoteForSum(trade.quote, trade.typedRaw, payDecimals)
  const estimate = forSum ? buyEstimate(trade.quote, company) : null
  /* What the estimate paid for one share (ST-5 r8): the dollars the quote was made for — the server's count, else the
     order's own input; never the sum on screen standing in (ST-5 r10) — over the shares that arrive. A figure for
     display alone: the page's pool warning and the sheet's worth at the reference read it; nothing here prices or
     changes the order. */
  const paidUsd = forSum ? quotedSpendUsd(trade.quote, estimate, payDecimals) : null
  const paidPerShare =
    (estimate?.unit ?? company.unit) === 'share' ? perSharePaid(paidUsd, estimate?.units ?? null) : null
  // The estimate's own time — when the phone received it (ST-5 r9): a figure with no time is not told on.
  const quotedMs = trade.quotedAt ? Date.parse(trade.quotedAt) : Number.NaN
  // Priced by the engine the purchase buys through: the page's warning over «Купити» is judged by these alone (r10).
  const paid: LiveShareQuote | null =
    paidPerShare !== null && paidUsd !== null && Number.isFinite(quotedMs)
      ? { perShare: paidPerShare, usd: paidUsd, at: quotedMs, source: BUY_ENGINE }
      : null

  /* ---- no route for the sum: the company's own minimum, from the same quote at the ladder's larger sums ---- */
  // A reminder's sum is the rule's own, so only a sum the person types looks for one.
  const noRoute = rule === null && valid && isNoRoute(trade.quoteFailure?.code)
  const routeMinimum = useRouteMinimum(payAsset.mint, company.mint, valid ? amountUsd : null, noRoute)

  /* ---- «Перевірка»: the exact order in four rows, as the server counted them on the bytes the wallet signs ---- */
  const prepared = trade.prepared
  const orderCheck = prepared?.order.check ?? null
  const words = BUY_COPY[locale]
  // Ryntra's own fee on the exact order, said inside «Усі витрати» beside the issuer's, as the web says it.
  const ryntraFee = ryntraFeeFigures(prepared?.order.order, locale)
  const rows = !prepared
    ? null
    : orderCheck
      ? buyCheckRows(orderCheck, { unit: company.unit, company: company.name, locale, words, ryntraFee })
      : buyOrderRows({
          order: prepared.order.order,
          pay: prepared.context.pay,
          payDecimals: prepared.context.payDecimals,
          receiveDecimals: prepared.context.receiveDecimals,
          multiplier: company.multiplier,
          unit: company.unit,
          company: company.name,
          truth: company.truth,
          preIpo: company.preIpo,
          eventLine: company.eventLine ?? null,
          issuerFee: company.issuerFee,
          ryntraFee,
          locale,
          words,
        })
  // The account's one-time reserve, said before the rows when the server judged it more than the purchase itself.
  const reserveFirst = reserveFirstOf(orderCheck)

  /* ---- the one action ---- */
  const insufficient =
    payRaw !== null && trade.typedRaw !== null && /^\d+$/.test(trade.typedRaw) && BigInt(trade.typedRaw) > payRaw
  const priced = trade.amountRaw !== null && trade.amountRaw === trade.typedRaw
  const action = composeAction({
    connected: trade.account.address !== null,
    signedIn: trade.account.session !== null,
    amountUsd,
    lockedReview: trade.lockedReview !== null,
    preparing: trade.phase === 'preparing',
    priced,
    needsSol,
    insufficient,
    unavailable: trade.quoteBlocked || (trade.quoteFailure !== null && !trade.quoteFailure.retryable),
    route: routeMinimum,
  })

  /* ---- after a fill the wallet is read again, so Home and Portfolio show what arrived ---- */
  const address = trade.account.address
  const settledAt = trade.settled?.at ?? null
  useEffect(() => {
    if (!settledAt || !address) return
    void queryClient.invalidateQueries({ queryKey: ['trade', 'holdings', address] })
  }, [settledAt, address, queryClient])

  return {
    trade,
    locale,
    amountText,
    // One decimal mark and cents at most; a key past them is refused, so the field shows the sum that is read (ST-5).
    setAmountText: (text: string) => setAmountText((held) => amountFieldInput(held, text, 2, locale)),
    pickSum: (usd: number) => setAmountText(amountFieldText(usd, locale)),
    amountUsd,
    /** The quick shares of the paying dollars — each drawn, offered only from $1; none without a wallet's read. */
    shares,
    /** The share the sum on screen is, to the cent; null otherwise. */
    pickedShare: pickedShare(shares, amountUsd),
    /** The sum's quote found no route: the company's own minimum, as the ladder has read it. */
    noRoute,
    routeMinimum,
    pay,
    payAsset,
    pickPay: setPicked,
    offersPayChoice: rule === null && offersPayChoice(usdtRaw),
    /** A purchase under a reminder: the rule's sum, in USDC, bound to the occurrence. */
    ruleMode: rule !== null,
    /** What the wallet holds of the paying dollars, in dollars; null until read. */
    payBalance,
    needsSol,
    insufficient,
    estimate,
    /** What the live estimate paid for one share and the dollars it spends; null where it cannot be said. */
    paid,
    quoteHeld,
    rows,
    /** «Перевірка»'s first line when the account's reserve is more than the purchase; null otherwise. */
    reserveFirst,
    action,
  }
}

export type BuyController = ReturnType<typeof useBuy>
