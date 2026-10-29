import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { useAccount } from '@/features/session/use-account'
import { useWallet } from '@/features/wallet/use-wallet'
import { afterLateAnswer, mayOpenWallet, MIN_WALLET_WINDOW_MS } from '@/features/wallet/bytes-life'
import { walletCancel, type WalletCancel } from '@/features/wallet/wallet-wait'
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
  type Session,
  type SwapSettlement,
} from '@/lib/api'
import { feel } from '@/lib/haptics'

import {
  checkAfterSend,
  failureFrom,
  freshOrderNoWorse,
  orderSignableMs,
  prepareReview,
  QUOTE_ASK_AGAIN_MS,
  QUOTE_ASK_LIMIT_MS,
  QUOTE_STUCK_ASKS,
  QUOTE_STUCK_MS,
  quoteAskAgain,
  quoteLimitHolds,
  quoteLimitNext,
  quoteWithin,
  type QuoteLimit,
  REVIEW_RENEWALS,
  recoverAttempt,
  releaseAgedReview,
  releaseReview,
  signAndSend,
  ticketEstimate,
  type Prepared,
  type TradeApi,
  type TradeFailure,
} from './trade-flow'
import {
  failureCopyOf,
  parseAmount,
  secondsLeft,
  tradeOrigin,
  type TradeAttempt,
  type TradeContext,
  type TradeLegs,
  type TradeMode,
} from './trade-model'
import { clockMark } from './trade-clock'
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

/** A typed amount settles this long before it is priced (ST-3: 300 ms, from 450 — the gap between a person's keys). */
const QUOTE_DEBOUNCE_MS = 300
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
    /** ST-3: an amount put in whole — a share chip — is priced at once, with no typing to wait out. */
    amountNow?: string | null
    plan?: ExecutionPlanBinding | null
    /** The autoinvest reminder a purchase is made under (1.12.0, `origin.rule`); the server holds the order to the rule's own sum. */
    rule?: RuleBinding | null
    /** Which saved Review this surface shows as its own when it opens; every one when absent (Trade). */
    restore?: (prepared: Prepared) => boolean
    /**
     * AG-2b: the Review renews its bytes by itself while it is read — for a surface that shows it (`keepsFresh`,
     * `renewing`, `awaitingFresh`); elsewhere a press on aged bytes still renews them, shown as «preparing».
     */
    renewWhileRead?: boolean
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
  const debouncedAmount = useDebounced(input.amountText, QUOTE_DEBOUNCE_MS)
  const settledAmount =
    input.amountNow != null && input.amountText === input.amountNow ? input.amountText : debouncedAmount
  const amountRaw = pay ? parseAmount(settledAmount, pay.decimals) : null
  const typedRaw = pay ? parseAmount(input.amountText, pay.decimals) : null

  const [phase, setPhase] = useState<TradePhase>('idle')
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [invalidated, setInvalidated] = useState(false)
  // A refusal belongs to the quote it answered: it leaves the screen with that quote, never outliving it.
  // A Review's refusal belongs to the amount and pair it was asked for, whatever estimate refreshes under it.
  const [failure, setFailureState] = useState<
    (TradeFailure & { quoteId: string | null; reviewKey: string | null }) | null
  >(null)
  const [lockedReview, setLockedReview] = useState<string | null>(null)
  const [settled, setSettled] = useState<Settled | null>(null)
  // The wallet has answered and the signature is remembered: the send is under way.
  const [sent, setSent] = useState(false)
  const chased = useRef(0)
  const ticket = useRef(0)
  /* AG-2: late wallet answers in a row — the first builds the Review again by itself, the second tells the person. */
  const lateInARow = useRef(0)
  /*
   * AG-2b: an open Review renews its bytes by itself while it is read — released once the chain says the old ones are
   * dead, the same order asked again — so a press finds bytes a wallet can open on. A press made while they are being
   * renewed waits for them and opens the wallet itself: one press, never a second Review to press again.
   */
  const renewal = useRef<Promise<Prepared | null> | null>(null)
  const [renewals, setRenewals] = useState(0)
  const [renewing, setRenewing] = useState(false)
  const [awaitingFresh, setAwaitingFresh] = useState(false)
  // When a background renewal last changed a figure for the worse: a press in the next moment was meant for the old one.
  const worseAt = useRef(0)
  // The Review a renewal just made, before the screen has drawn it: a press in that frame takes it, never the dead one.
  const renewedTo = useRef<Prepared | null>(null)
  // The note on screen is a renewal's own refusal — a later renewal that succeeds takes it away, and nothing else.
  const refusedRenewal = useRef(false)
  // One press at a time: a double tap never opens the wallet twice.
  const pressing = useRef(false)
  // The phase as of the last render, for timers that fire between renders.
  const phaseNow = useRef<TradePhase>('idle')
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setAppActive(state === 'active'))
    return () => sub.remove()
  }, [])
  /** A renewal no Review waits for any more is let go, so the next Review starts clean. */
  const dropRenewal = useCallback(() => {
    renewal.current = null
    renewedTo.current = null
    setRenewing(false)
    setAwaitingFresh(false)
  }, [])
  // «Скасувати» for the wallet's wait now open, if one is (M45).
  const waiting = useRef<WalletCancel | null>(null)

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
  const setFailure = useCallback((next: TradeFailure | null, reviewKey: string | null = null) => {
    setFailureState(next ? { ...next, quoteId: quoteIdRef.current, reviewKey } : null)
  }, [])
  const currentReviewKey = pay && receive && typedRaw ? `${pay.mint}:${receive.mint}:${typedRaw}` : null

  /* ---- the estimate ---- */

  const quoteKey = pay && receive && amountRaw ? { inputMint: pay.mint, outputMint: receive.mint, amountRaw } : null
  const quoteKeyText = quoteKey ? `${quoteKey.inputMint}:${quoteKey.outputMint}:${quoteKey.amountRaw}` : null
  /* ST-5 r9: a «too many requests» is asked once more after its window, never inside it (`quoteLimitNext`): while the
     window runs no ask starts — the newest amount is asked when it ends — and the ticket says «Рахуємо ціну…». */
  const [limit, setLimit] = useState<QuoteLimit>(null)
  const limitWaiting = limit?.phase === 'waiting'
  const quoteEnabled = quoteKey !== null && phase === 'idle' && !limitWaiting
  const quote = useQuery({
    queryKey: ['trade', 'quote', quoteKey?.inputMint ?? '', quoteKey?.outputMint ?? '', quoteKey?.amountRaw ?? ''],
    queryFn: async ({ signal }) => {
      clockMark('quote:ask')
      // ST-5 r10: the ask always settles — its own abort, the query's cancel, or the watchdog's «took too long».
      const controller = new AbortController()
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', () => controller.abort(), { once: true })
      const answer = await quoteWithin(fetchSwapQuote(quoteKey!, controller.signal), QUOTE_ASK_LIMIT_MS, () =>
        controller.abort(),
      )
      clockMark('quote:answer')
      return answer
    },
    enabled: quoteEnabled,
    staleTime: 0,
    retry: (failures, error) => quoteAskAgain(error, failures),
    retryDelay: QUOTE_ASK_AGAIN_MS,
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
  // A refresh that failed keeps the old answer in the cache; the ticket does not show it beside the refusal (ST-5).
  const estimateState = ticketEstimate({
    matches: quoteMatches,
    failed: quote.error != null,
    fetching: quote.isFetching,
  })
  const quoteShown = estimateState === 'shown'

  /* A refusal settled for the amount asked starts the wait (once per refusal, state adjusted during render); its own
     time is when it arrived. The one ask after the window that answers ends it. */
  const refusalSeen = quote.error && !quote.isFetching && quoteKeyText ? `${quoteKeyText}@${quote.errorUpdatedAt}` : null
  const [limitRefusal, setLimitRefusal] = useState<string | null>(null)
  if (refusalSeen !== limitRefusal) {
    setLimitRefusal(refusalSeen)
    if (refusalSeen && quoteKeyText) {
      const refused = { kind: 'refused', error: quote.error, key: quoteKeyText, nowMs: quote.errorUpdatedAt } as const
      setLimit((held) => quoteLimitNext(held, refused))
    }
  }
  if (limit && limit.phase !== 'waiting' && quoteShown) setLimit(quoteLimitNext(limit, { kind: 'answered' }))
  // The window's end asks the amount on screen then — the query is enabled again — once.
  useEffect(() => {
    if (limit?.phase !== 'waiting') return
    const timer = setTimeout(
      () => setLimit((held) => quoteLimitNext(held, { kind: 'waited', key: quoteKeyText })),
      Math.max(0, limit.until - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [limit, quoteKeyText])
  /* Refused again after the window (ST-5 r10): said, and asked again by itself after the next pause while the ticket is
     open and in front — never «Забагато запитів» until a press. */
  const refetchQuote = useRef(quote.refetch)
  useEffect(() => {
    refetchQuote.current = quote.refetch
  })
  useEffect(() => {
    if (limit?.phase !== 'resting' || !appActive || phase !== 'idle') return
    const timer = setTimeout(
      () => {
        const next = quoteLimitNext(limit, { kind: 'again', key: quoteKeyText })
        setLimit(next)
        if (next?.phase === 'spent') {
          clockMark('quote:again')
          void refetchQuote.current()
        }
      },
      Math.max(0, limit.until - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [limit, quoteKeyText, appActive, phase])
  const limitHolds = quoteKeyText !== null && quoteLimitHolds(limit, quote.error, quoteKeyText)

  /* ST-5 r10: a typed amount with no estimate, no ask under way and no refusal — an ask cancelled under it left the
     query idle — is asked again by itself, a bounded number of times; meanwhile the ticket says «Рахуємо ціну…». */
  const stuck = quoteEnabled && !quoteMatches && !quote.isFetching && quote.error == null
  const [stuckAsks, setStuckAsks] = useState<Readonly<{ key: string | null; asked: number }>>({ key: null, asked: 0 })
  const stuckAsked = stuckAsks.key === quoteKeyText ? stuckAsks.asked : 0
  useEffect(() => {
    if (!stuck || quoteKeyText === null || stuckAsked >= QUOTE_STUCK_ASKS) return
    const timer = setTimeout(() => {
      setStuckAsks({ key: quoteKeyText, asked: stuckAsked + 1 })
      clockMark('quote:unstuck')
      void refetchQuote.current()
    }, QUOTE_STUCK_MS)
    return () => clearTimeout(timer)
  }, [stuck, quoteKeyText, stuckAsked])
  const stuckAsking = stuck && quoteKeyText !== null && stuckAsked < QUOTE_STUCK_ASKS

  useEffect(() => {
    if (quoteFresh) chased.current = 0
  }, [quoteFresh])
  useEffect(() => {
    phaseNow.current = phase
    if (phase === 'review') clockMark('review:shown')
    if (phase === 'settled') clockMark('done:shown')
    if (phase === 'recovery') clockMark('recovery:shown')
  }, [phase])
  // A surface that goes ends what it started: a renewal or a press waiting on one never opens a wallet after it.
  useEffect(
    () => () => {
      ticket.current += 1
    },
    [],
  )

  // An expired estimate is the one number on screen that is no longer true: ask again, a bounded number of times.
  useEffect(() => {
    if (!quoteMatches || quoteLeft === null || quoteLeft > 0) return
    if (phase !== 'idle' || quote.isFetching || attempt || limitWaiting) return
    if (AppState.currentState !== 'active') return
    if (chased.current >= AUTO_REFRESH_LIMIT) return
    chased.current += 1
    void quote.refetch()
  }, [quoteMatches, quoteLeft, phase, quote, attempt, limitWaiting])

  // A refusal held back for its window is no line on screen: the ticket is pricing (ST-5 r9).
  const quoteFailure = quote.error && !limitHolds ? failureFrom(quote.error) : null
  const currentQuoteId = quoteMatches ? (quote.data?.order.requestId ?? null) : null
  useEffect(() => {
    quoteIdRef.current = currentQuoteId
    if (currentQuoteId) clockMark('quote:shown')
  }, [currentQuoteId])
  useEffect(() => {
    if (input.amountText) clockMark('amount:typed', true)
  }, [input.amountText])
  const quoteBlocked = quoteMatches && quote.data?.verdict.verdict === 'BLOCKED'

  /* ---- the Review ---- */

  const walletSign = wallet.signTransaction
  const wallet_ = useMemo(
    () => ({
      signTransaction: async (wire: string) => {
        clockMark('wallet:ask')
        const signed = await walletSign(wire)
        clockMark('wallet:answer')
        return signed
      },
    }),
    [walletSign],
  )

  // The Review is asked for the amount on screen now, never the one the estimate trails by its debounce.
  // `note` is said over the new Review: AG-2's «built again» after bytes aged out under a wallet. `terms`: that rebuild
  // asks for the aged Review's own pair, amount and kind — never the screen's, which a restored Review does not fill.
  const reviewWith = useCallback(
    async (note: TradeFailure | null, terms: TradeContext | null = null) => {
      const session = account.session
      const legPay = terms?.pay ?? pay
      const legReceive = terms?.receive ?? receive
      const amountRaw = terms?.inAmountRaw ?? typedRaw
      const legMode = terms?.mode ?? mode
      if (!session || !legPay || !legReceive || !amountRaw) {
        if (terms) setPhase('idle')
        return
      }
      const my = ++ticket.current
      dropRenewal()
      setFailure(null)
      setLockedReview(null)
      setPhase('preparing')
      const outcome = await prepareReview({
        api,
        session,
        attempts: attemptStore,
        mode: legMode,
        pay: legPay,
        receive: legReceive,
        amountRaw,
        origin: tradeOrigin(legMode, plan, rule),
        // A pause before the order is asked again ends it when the sheet closed or a new Review was asked for (M27).
        cancelled: () => ticket.current !== my,
      })
      clockMark(`order:answer ${outcome.ok ? 'ok' : outcome.failure.code}`)
      if (ticket.current !== my) return
      if (!outcome.ok) {
        trace(
          'prepare',
          `refused ${outcome.failure.code}${outcome.attempt ? ' (an attempt to recover)' : ''}${outcome.lockedReview ? ' (a Review to release)' : ''}`,
        )
        setFailure(outcome.failure, `${legPay.mint}:${legReceive.mint}:${amountRaw}`)
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
      setRenewals(0)
      setInvalidated(false)
      setPhase('review')
      if (note) setFailure(note)
      feel('review')
    },
    [account.session, typedRaw, mode, pay, plan, receive, rule, setFailure, dropRenewal],
  )

  const review = useCallback(() => {
    clockMark('review:press', true)
    lateInARow.current = 0
    setRenewals(0)
    return reviewWith(null)
  }, [reviewWith])

  /** Fresh bytes for the Review on screen, its own terms asked again; one renewal at a time, shared by its callers. */
  const renew = useCallback(
    (from: Prepared): Promise<Prepared | null> => {
      if (renewal.current) return renewal.current
      const session = account.session
      if (!session) return Promise.resolve(null)
      const my = ticket.current
      const gone = () => ticket.current !== my
      // The wait for the old bytes' death ends early when the Review is closed or replaced.
      const sleepUnlessGone = async (ms: number) => {
        const until = Date.now() + ms
        while (!gone() && Date.now() < until) {
          await new Promise<void>((resolve) => setTimeout(resolve, Math.min(500, Math.max(0, until - Date.now()))))
        }
      }
      setRenewals((n) => n + 1)
      setRenewing(true)
      clockMark('renew:start')
      const run = (async (): Promise<Prepared | null> => {
        const released = await releaseAgedReview({
          api,
          session,
          prepared: from,
          cancelled: gone,
          sleep: sleepUnlessGone,
        })
        clockMark(`renew:released ${released.ok ? 'ok' : released.failure.code}`)
        if (gone()) return null
        if (!released.ok) {
          // Said, never a dead end: the old bytes may still be alive (or the chain unread); the next press asks again.
          // No more renewals by themselves after a refusal — the action budget is kept for the press.
          setFailure(released.failure)
          refusedRenewal.current = true
          setRenewals(REVIEW_RENEWALS)
          return null
        }
        clearReview(session.address)
        const terms = from.context
        const outcome = await prepareReview({
          api,
          session,
          attempts: attemptStore,
          mode: terms.mode,
          pay: terms.pay,
          receive: terms.receive,
          amountRaw: terms.inAmountRaw,
          origin: tradeOrigin(terms.mode, plan, rule),
          cancelled: gone,
        })
        if (gone()) return null
        if (!outcome.ok) {
          trace('renew', `refused ${outcome.failure.code}`)
          setPrepared(null)
          setFailure(outcome.failure, `${terms.pay.mint}:${terms.receive.mint}:${terms.inAmountRaw}`)
          if (outcome.lockedReview) setLockedReview(outcome.lockedReview.requestId)
          setPhase(outcome.attempt ? 'recovery' : 'idle')
          return null
        }
        trace(
          'renew',
          `the Review ${outcome.prepared.order.order.requestId} closes at ${outcome.prepared.order.expiresAt}`,
        )
        clockMark('renew:fresh')
        saveReview(session.address, outcome.prepared)
        renewedTo.current = outcome.prepared
        setPrepared(outcome.prepared)
        setInvalidated(false)
        // A figure that came out worse than the one being read is said over it — never changed silently; an earlier
        // refusal of a renewal no longer stands.
        if (!freshOrderNoWorse(from.order.order, outcome.prepared.order.order)) {
          worseAt.current = Date.now()
          setFailure({ code: 'REVIEW_RENEWED', ...failureCopyOf('priceRenewed') })
        } else if (refusedRenewal.current) {
          setFailure(null)
        }
        refusedRenewal.current = false
        return outcome.prepared
      })()
      renewal.current = run
      void run.finally(() => {
        if (renewal.current !== run) return
        renewal.current = null
        setRenewing(false)
      })
      return run
    },
    [account.session, plan, rule, setFailure],
  )

  // The Review renews itself when its bytes can no longer open a wallet — while the app is in front, a bounded number of times.
  useEffect(() => {
    if (!input.renewWhileRead) return
    if (!appActive || phase !== 'review' || !prepared || invalidated || renewing || renewals >= REVIEW_RENEWALS) return
    const openUntil = (prepared.receivedAtMs ?? 0) + orderSignableMs(prepared.order) - MIN_WALLET_WINDOW_MS
    const timer = setTimeout(
      () => {
        // A press may have begun since this render: a renewal never starts under the wallet.
        if (phaseNow.current === 'review' && !pressing.current) void renew(prepared)
      },
      Math.max(0, openUntil - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [input.renewWhileRead, appActive, phase, prepared, invalidated, renewing, renewals, renew])

  const closeReview = useCallback(() => {
    ticket.current += 1
    dropRenewal()
    if (account.session) clearReview(account.session.address)
    setPrepared(null)
    setInvalidated(false)
    setPhase('idle')
  }, [account.session, dropRenewal])

  /**
   * What the server observed for a signature, asked until the network decides (`recoverAttempt`): at once after a send
   * whose end the phone did not hear (ST-3), and on «Перевірити транзакцію». It only reads; nothing is sent again.
   */
  const checkSent = useCallback(
    async (session: Session, open: TradeAttempt, my: number) => {
      setPhase('recovering')
      const outcome = await recoverAttempt({
        api,
        session,
        attempts: attemptStore,
        attempt: open,
        cancelled: () => ticket.current !== my,
      })
      clockMark(`check:answer ${outcome.ok ? outcome.settlement.state : outcome.failure.code}`)
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
      setFailure(null)
      setSettled({ settlement: outcome.settlement, context: open.context, at: new Date().toISOString() })
      if (outcome.final) feel(settlementCue(outcome.settlement))
      setPhase(outcome.final ? 'settled' : 'recovery')
    },
    [setFailure],
  )

  const press = useCallback(
    async (session: Session, shown: Prepared) => {
      let current = shown
      // AG-2b: bytes too short for a wallet, or being renewed — the press waits for fresh ones and opens the wallet itself.
      const short = !mayOpenWallet({
        receivedAtMs: current.receivedAtMs ?? Number.NaN,
        signableMs: orderSignableMs(current.order),
        nowMs: Date.now(),
      })
      if (renewal.current || short) {
        setFailure(null)
        setAwaitingFresh(true)
        // A surface without the renewal's words shows the wait as its own «preparing».
        if (!input.renewWhileRead) setPhase('preparing')
        let fresh: Prepared | null = null
        try {
          fresh = await (renewal.current ?? renew(current))
        } finally {
          setAwaitingFresh(false)
          if (!input.renewWhileRead) setPhase((now) => (now === 'preparing' ? 'review' : now))
        }
        if (!fresh) return
        // The app went away while it waited: the fresh Review waits for the person, the wallet is not opened over another app.
        if (AppState.currentState !== 'active') return
        if (!freshOrderNoWorse(current.order.order, fresh.order.order)) {
          setFailure({ code: 'REVIEW_RENEWED', ...failureCopyOf('priceRenewed') })
          return
        }
        // Fresh bytes that came too short even so are said, never chased into another round.
        if (
          !mayOpenWallet({
            receivedAtMs: fresh.receivedAtMs ?? Number.NaN,
            signableMs: orderSignableMs(fresh.order),
            nowMs: Date.now(),
          })
        ) {
          setFailure({ code: 'BYTES_REBUILT', ...failureCopyOf('bytesRebuilt') })
          return
        }
        current = fresh
      }
      const my = ++ticket.current
      setFailure(null)
      setSent(false)
      setPhase('signing')
      const cancel = walletCancel()
      waiting.current = cancel
      const outcome = await signAndSend({
        api,
        wallet: wallet_,
        session,
        attempts: attemptStore,
        prepared: current,
        cancel,
        onSigned: () => {
          clockMark('execute:ask')
          if (ticket.current === my) setSent(true)
        },
      })
      clockMark(`execute:answer ${outcome.ok ? outcome.settlement.state : `${outcome.phase} ${outcome.failure.code}`}`)
      if (waiting.current === cancel) waiting.current = null
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
      if (!outcome.ok && outcome.aged) {
        /*
         * AG-2: nothing was sent — the bytes were too short-lived for the wallet, or it answered after they could land.
         * The first time the Review is built again by itself; a second late answer in a row tells the person plainly.
         */
        if (outcome.aged === 'late') lateInARow.current += 1
        const tell = outcome.aged === 'late' && afterLateAnswer(lateInARow.current) === 'tell'
        // Either way the old Review is released (once the chain says its bytes are dead), so a fresh one can be asked for.
        setPhase('preparing')
        const released = await releaseAgedReview({
          api,
          session,
          prepared: current,
          cancelled: () => ticket.current !== my,
        })
        if (ticket.current !== my) return
        if (tell || !released.ok) {
          // The plain words stay over the void Review — «Оновити «Перевірку»» asks for a fresh one, its lock released.
          setFailure(
            tell ? { code: 'BYTES_AGED', ...failureCopyOf('deviceConfirm') } : released.ok ? null : released.failure,
          )
          setInvalidated(true)
          setPhase('review')
          return
        }
        clearReview(session.address)
        setPrepared(null)
        await reviewWith(outcome.failure, current.context)
        return
      }
      if (outcome.ok) lateInARow.current = 0
      // ST-3: a send whose end the phone did not hear is asked of the server at once — «Готово» needs no press.
      const unheard = checkAfterSend(outcome)
      if (!outcome.ok) {
        setFailure(outcome.failure)
        if (outcome.invalidated) setInvalidated(true)
        if (outcome.phase === 'recovery') {
          setPrepared(null)
          setPhase('recovery')
          // Not awaited: the press is over once the send is; the check runs on a screen that can be closed.
          if (unheard) void checkSent(session, unheard, my)
          return
        }
        setPhase('review')
        return
      }
      setPrepared(null)
      setSettled({ settlement: outcome.settlement, context: current.context, at: new Date().toISOString() })
      setPhase(unheard ? 'recovery' : 'settled')
      if (unheard) void checkSent(session, unheard, my)
    },
    [wallet_, setFailure, reviewWith, renew, checkSent, input.renewWhileRead],
  )

  const sign = useCallback(async () => {
    const session = account.session
    if (!session || !prepared || pressing.current) return
    // A renewal that finished in the frame before this press: its Review, not the dead one the screen still draws.
    const shown =
      renewedTo.current && renewedTo.current.receivedAtMs! > (prepared.receivedAtMs ?? 0) ? renewedTo.current : prepared
    // A press in the moment a renewal changed a figure for the worse was meant for the old figure: the new one is read first.
    if (Date.now() - worseAt.current < 1_500) return
    clockMark('wallet:press', true)
    pressing.current = true
    try {
      await press(session, shown)
    } finally {
      pressing.current = false
    }
  }, [account.session, prepared, press])

  /** «Скасувати» while the wallet is asked: back to «Перевірка», nothing sent; a signature after this is dropped. */
  const cancelSigning = useCallback(() => {
    waiting.current?.cancel()
  }, [])

  /* ---- recovery ---- */

  const recover = useCallback(async () => {
    const session = account.session
    const open = attempt
    if (!session || !open) return
    const my = ++ticket.current
    setFailure(null)
    await checkSent(session, open, my)
  }, [account.session, attempt, setFailure, checkSent])

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
    dropRenewal()
    if (account.session) clearReview(account.session.address)
    setPrepared(null)
    setSettled(null)
    setFailure(null)
    setInvalidated(false)
    setLockedReview(null)
    setPhase('idle')
  }, [account.session, setFailure, dropRenewal])

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
    busy:
      awaitingFresh || phase === 'preparing' || phase === 'signing' || phase === 'sending' || phase === 'recovering',
    // The estimate for the amount on screen — never one whose latest ask failed (`ticketEstimate`). «Перевірка» never
    // takes it: the Review asks the server for its own fresh order.
    quote: quoteShown ? quote.data! : null,
    quoting: estimateState === 'pricing' || (estimateState !== 'shown' && (limitHolds || stuckAsking)),
    /** When the phone received the estimate shown — its figure's time; null when none is shown. */
    quotedAt: quoteShown && quote.dataUpdatedAt > 0 ? new Date(quote.dataUpdatedAt).toISOString() : null,
    quoteFresh: quoteShown && quoteFresh,
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
    /** AG-2b: the Review renews its bytes by itself (it does not go stale while renewals remain). */
    keepsFresh: Boolean(account.session) && (renewing || (renewals < REVIEW_RENEWALS && !invalidated)),
    renewing,
    /** A press waits for fresh bytes; the wallet opens by itself when they come. */
    awaitingFresh,
    // A refusal from a quote no longer on screen is not shown; the settled and recovery phases keep theirs.
    // A plan's refusal is the plan's verdict, not the quote's: it stays until the next Review, so a
    // violated rule is never blinked away by the quote that refreshes under it. So is a reminder's (RULE_…).
    // A Review's own refusal stays while the same pair and amount stand — never blinked away by the estimate.
    failure:
      failure &&
      (failure.code.startsWith('PLAN_') ||
        failure.code.startsWith('RULE_') ||
        phase !== 'idle' ||
        (failure.reviewKey !== null ? failure.reviewKey === currentReviewKey : failure.quoteId === currentQuoteId))
        ? failure
        : null,
    lockedReview,
    attempt,
    settled,
    review,
    closeReview,
    sign,
    cancelSigning,
    recover,
    release,
    reset,
  }
}

export type TradeController = ReturnType<typeof useTrade>
