import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { useAccount } from '@/features/session/use-account'
import { useWallet } from '@/features/wallet/use-wallet'
import { useDebounced } from '@/hooks/use-debounced'
import { useNow } from '@/hooks/use-now'
import {
  cancelSwapReview,
  createSwapOrder,
  executeSwap,
  fetchSwapQuote,
  recoverSwap,
  type ExecutionPlanBinding,
  type RuleBinding,
  type SwapSettlement,
} from '@/lib/api'
import { feel } from '@/lib/haptics'

import {
  failureFrom,
  prepareReview,
  recoverAttempt,
  releaseReview,
  signAndSend,
  type Prepared,
  type TradeApi,
  type TradeFailure,
} from './trade-flow'
import {
  parseAmount,
  secondsLeft,
  tradeOrigin,
  type TradeAsset,
  type TradeContext,
  type TradeLegs,
  type TradeMode,
} from './trade-model'
import { failureCue, settlementCue } from './trade-cues'
import { attemptStore, clearReview, loadReview, saveReview, useAttempt } from './trade-store'

/** A development build says which step ended how; a person never sees this and no secret is in it. */
function trace(step: string, detail: string) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.log(`[trade] ${step}: ${detail}`)
}

const api: TradeApi = {
  quote: fetchSwapQuote,
  order: createSwapOrder,
  execute: executeSwap,
  recover: recoverSwap,
  cancel: cancelSwapReview,
}

/** A typed amount settles this long before it is priced. */
const QUOTE_DEBOUNCE_MS = 450
/** How many times in a row the ticket may ask for a fresh price on its own after one expired. */
const AUTO_REFRESH_LIMIT = 3

export type TradePhase = 'idle' | 'preparing' | 'review' | 'signing' | 'sending' | 'settled' | 'recovery' | 'recovering'

export type Settled = Readonly<{ settlement: SwapSettlement; context: TradeContext | null; at: string }>

/**
 * One trade on the phone: the live estimate while an amount is typed, the
 * exact Review from the server, the wallet's signature and the server's one
 * submission, the receipt, and the recovery of a signature the app closed
 * on. The rules live in `trade-flow`; this hook only binds them to the
 * wallet, the session, the store and the screen.
 */
export function useTrade(
  input: Readonly<{
    mode: TradeMode
    legs: TradeLegs
    amountText: string
    plan?: ExecutionPlanBinding | null
    /** The autoinvest reminder a purchase is made under (1.12.0, `origin.rule`); the server holds the order to the rule's own sum. */
    rule?: RuleBinding | null
    /** Which saved Review this surface shows as its own when it opens; every one when absent (Trade). */
    restore?: (prepared: Prepared) => boolean
  }>,
) {
  const account = useAccount()
  const wallet = useWallet()
  const now = useNow(1000)
  const { mode, legs } = input
  const plan = input.plan ?? null
  const rule = input.rule ?? null
  const pay = legs.pay
  const receive = legs.receive
  const settledAmount = useDebounced(input.amountText, QUOTE_DEBOUNCE_MS)
  const amountRaw = pay ? parseAmount(settledAmount, pay.decimals) : null
  const typedRaw = pay ? parseAmount(input.amountText, pay.decimals) : null

  const [phase, setPhase] = useState<TradePhase>('idle')
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [invalidated, setInvalidated] = useState(false)
  // A refusal belongs to the quote it answered: it leaves the screen with that quote, never outliving it.
  const [failure, setFailureState] = useState<(TradeFailure & { quoteId: string | null }) | null>(null)
  const [lockedReview, setLockedReview] = useState<string | null>(null)
  const [settled, setSettled] = useState<Settled | null>(null)
  // The wallet has answered and the signature is remembered: the send is under way.
  const [sent, setSent] = useState(false)
  const chased = useRef(0)
  const ticket = useRef(0)

  const attempt = useAttempt(account.session?.address ?? null)

  // A Review the app closed on comes back for its window (state adjusted during render, as React prescribes).
  const [restoredFor, setRestoredFor] = useState<string | null>(null)
  const sessionAddress = account.session?.address ?? null
  if (sessionAddress !== restoredFor) {
    setRestoredFor(sessionAddress)
    const saved = sessionAddress ? loadReview(sessionAddress) : null
    if (saved && !attempt && (input.restore ? input.restore(saved) : true)) {
      setPrepared(saved)
      setInvalidated(false)
      setPhase('review')
      trace('restore', `the Review ${saved.order.order.requestId} is back for its window`)
    }
  }
  const quoteIdRef = useRef<string | null>(null)
  const setFailure = useCallback((next: TradeFailure | null) => {
    setFailureState(next ? { ...next, quoteId: quoteIdRef.current } : null)
  }, [])

  /* ---- the estimate ---- */

  const quoteKey = pay && receive && amountRaw ? { inputMint: pay.mint, outputMint: receive.mint, amountRaw } : null
  const quote = useQuery({
    queryKey: ['trade', 'quote', quoteKey?.inputMint ?? '', quoteKey?.outputMint ?? '', quoteKey?.amountRaw ?? ''],
    queryFn: ({ signal }) => fetchSwapQuote(quoteKey!, signal),
    enabled: quoteKey !== null && phase === 'idle',
    staleTime: 0,
    retry: 0,
    placeholderData: keepPreviousData,
  })
  const quoteMatches =
    quote.data !== undefined &&
    quoteKey !== null &&
    quote.data.order.inputMint === quoteKey.inputMint &&
    quote.data.order.outputMint === quoteKey.outputMint &&
    quote.data.order.inAmountRaw === quoteKey.amountRaw
  const quoteLeft = quote.data ? secondsLeft(quote.data.expiresAt, now) : null
  const quoteFresh = quoteMatches && quoteLeft !== null && quoteLeft > 0

  useEffect(() => {
    if (quoteFresh) chased.current = 0
  }, [quoteFresh])

  // An expired estimate is the one number on screen that is no longer true: ask again, a bounded number of times.
  useEffect(() => {
    if (!quoteMatches || quoteLeft === null || quoteLeft > 0) return
    if (phase !== 'idle' || quote.isFetching || attempt) return
    if (AppState.currentState !== 'active') return
    if (chased.current >= AUTO_REFRESH_LIMIT) return
    chased.current += 1
    void quote.refetch()
  }, [quoteMatches, quoteLeft, phase, quote, attempt])

  const quoteFailure = quote.error ? failureFrom(quote.error) : null
  const currentQuoteId = quoteMatches ? (quote.data?.order.requestId ?? null) : null
  useEffect(() => {
    quoteIdRef.current = currentQuoteId
  }, [currentQuoteId])
  const quoteBlocked = quoteMatches && quote.data?.verdict.verdict === 'BLOCKED'

  /* ---- the Review ---- */

  const wallet_ = useMemo(() => ({ signTransaction: wallet.signTransaction }), [wallet.signTransaction])

  const review = useCallback(async () => {
    const session = account.session
    if (!session || !pay || !receive || !amountRaw) return
    const my = ++ticket.current
    setFailure(null)
    setLockedReview(null)
    setPhase('preparing')
    const outcome = await prepareReview({
      api,
      session,
      attempts: attemptStore,
      mode,
      pay,
      receive,
      amountRaw,
      origin: tradeOrigin(mode, plan, rule),
      // A pause before the order is asked again ends it when the sheet closed or a new Review was asked for (M27).
      cancelled: () => ticket.current !== my,
    })
    if (ticket.current !== my) return
    if (!outcome.ok) {
      trace(
        'prepare',
        `refused ${outcome.failure.code}${outcome.attempt ? ' (an attempt to recover)' : ''}${outcome.lockedReview ? ' (a Review to release)' : ''}`,
      )
      setFailure(outcome.failure)
      if (outcome.lockedReview) setLockedReview(outcome.lockedReview.requestId)
      setPhase(outcome.attempt ? 'recovery' : 'idle')
      return
    }
    trace(
      'prepare',
      `the Review ${outcome.prepared.order.order.requestId} closes at ${outcome.prepared.order.expiresAt}`,
    )
    saveReview(session.address, outcome.prepared)
    setPrepared(outcome.prepared)
    setInvalidated(false)
    setPhase('review')
    feel('review')
  }, [account.session, amountRaw, mode, pay, plan, receive, rule, setFailure])

  const closeReview = useCallback(() => {
    ticket.current += 1
    if (account.session) clearReview(account.session.address)
    setPrepared(null)
    setInvalidated(false)
    setPhase('idle')
  }, [account.session])

  const sign = useCallback(async () => {
    const session = account.session
    if (!session || !prepared) return
    const my = ++ticket.current
    setFailure(null)
    setSent(false)
    setPhase('signing')
    const outcome = await signAndSend({
      api,
      wallet: wallet_,
      session,
      attempts: attemptStore,
      prepared,
      onSigned: () => {
        if (ticket.current === my) setSent(true)
      },
    })
    if (ticket.current !== my) return
    trace('sign', outcome.ok ? `settled ${outcome.settlement.state}` : `${outcome.phase} ${outcome.failure.code}`)
    if (outcome.ok || outcome.phase === 'recovery' || outcome.invalidated) clearReview(session.address)
    // The signature's answer, felt: filled, on its way, the wallet's «no», or refused.
    feel(
      outcome.ok
        ? settlementCue(outcome.settlement)
        : outcome.phase === 'recovery'
          ? 'sent'
          : failureCue(outcome.failure.code),
    )
    if (!outcome.ok) {
      setFailure(outcome.failure)
      if (outcome.invalidated) setInvalidated(true)
      if (outcome.phase === 'recovery') {
        setPrepared(null)
        setPhase('recovery')
        return
      }
      setPhase('review')
      return
    }
    setPrepared(null)
    setSettled({ settlement: outcome.settlement, context: prepared.context, at: new Date().toISOString() })
    setPhase(outcome.attempt.state === 'SETTLED' ? 'settled' : 'recovery')
  }, [account.session, prepared, wallet_, setFailure])

  /* ---- recovery ---- */

  const recover = useCallback(async () => {
    const session = account.session
    const open = attempt
    if (!session || !open) return
    const my = ++ticket.current
    setFailure(null)
    setPhase('recovering')
    const outcome = await recoverAttempt({ api, session, attempts: attemptStore, attempt: open })
    if (ticket.current !== my) return
    trace(
      'recover',
      outcome.ok ? `${outcome.settlement.state}${outcome.final ? ' (final)' : ''}` : outcome.failure.code,
    )
    if (!outcome.ok) {
      setFailure(outcome.failure)
      setPhase('recovery')
      return
    }
    setSettled({ settlement: outcome.settlement, context: open.context, at: new Date().toISOString() })
    if (outcome.final) feel(settlementCue(outcome.settlement))
    setPhase(outcome.final ? 'settled' : 'recovery')
  }, [account.session, attempt, setFailure])

  const release = useCallback(async () => {
    const session = account.session
    if (!session || !lockedReview) return
    const my = ++ticket.current
    setPhase('preparing')
    const outcome = await releaseReview({ api, session, requestId: lockedReview })
    if (ticket.current !== my) return
    if (!outcome.ok) setFailure(outcome.failure)
    else {
      setFailure(null)
      setLockedReview(null)
    }
    setPhase('idle')
  }, [account.session, lockedReview, setFailure])

  const reset = useCallback(() => {
    ticket.current += 1
    if (account.session) clearReview(account.session.address)
    setPrepared(null)
    setSettled(null)
    setFailure(null)
    setInvalidated(false)
    setLockedReview(null)
    setPhase('idle')
  }, [account.session, setFailure])

  // A signature the app closed on is found at the next open: the screen says so and offers the one check.
  const shown: TradePhase =
    attempt && !settled && (phase === 'idle' || phase === 'settled')
      ? 'recovery'
      : !attempt && !settled && phase === 'recovery'
        ? 'idle'
        : phase

  const reviewLeft = prepared ? secondsLeft(prepared.order.expiresAt, now) : null

  return {
    account,
    phase: shown,
    busy: phase === 'preparing' || phase === 'signing' || phase === 'sending' || phase === 'recovering',
    quote: quoteMatches ? quote.data! : null,
    quoting: quote.isFetching && !quoteMatches,
    quoteFresh,
    quoteLeft,
    quoteBlocked,
    quoteFailure,
    refreshQuote: () => void quote.refetch(),
    typedRaw,
    /** The settled amount a quote and a Review are asked for; it trails `typedRaw` by the debounce. */
    amountRaw,
    /** The wallet has signed and the one submission is under way. */
    sending: phase === 'signing' && sent,
    prepared,
    reviewLeft,
    invalidated,
    // A refusal from a quote no longer on screen is not shown; the settled and recovery phases keep theirs.
    // A plan's refusal is the plan's verdict, not the quote's: it stays until the next Review, so a
    // violated rule is never blinked away by the quote that refreshes under it. So is a reminder's (RULE_…).
    failure:
      failure &&
      (failure.quoteId === currentQuoteId ||
        failure.code.startsWith('PLAN_') ||
        failure.code.startsWith('RULE_') ||
        phase !== 'idle')
        ? failure
        : null,
    lockedReview,
    attempt,
    settled,
    review,
    closeReview,
    sign,
    recover,
    release,
    reset,
  }
}

export type TradeController = ReturnType<typeof useTrade>

/** The asset a Buy is paid with or a Sell is received in, by the market the person came from. */
export function defaultQuoteAsset(quoteAssets: readonly TradeAsset[], asset: TradeAsset | null): TradeAsset {
  const first = quoteAssets[0]!
  if (!asset) return first
  return quoteAssets.find((candidate) => candidate.mint !== asset.mint) ?? first
}
