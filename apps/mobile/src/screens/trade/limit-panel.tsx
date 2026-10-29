import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, Pressable, TextInput, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { ChoiceChips } from '@/components/choice-chips'
import { DoorRow } from '@/components/door-row'
import { Chip } from '@/components/chip'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { ReviewBlock, type ReviewRow } from '@/components/review-block'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import { explorerUrl } from '@/features/history/history-model'
import { BUY_COPY } from '@/features/invest/buy-copy'
import { LIMIT_COPY } from '@/features/limits/copy'
import {
  carriedAmount,
  distanceFromMarket,
  estimatedOut,
  limitFailureKey,
  LIMIT_QUOTES,
  offsetPrice,
  openCount,
  PRICE_OFFSETS,
  plainDecimal,
  quoteFor,
  rawToDecimal,
  ticketBlock,
  typedPrice,
  VENUE_NAME,
  type LimitReview,
  type LimitSide,
  type LimitFailureKey,
  type LimitVenue,
} from '@/features/limits/limit-model'
import { limitsApi } from '@/features/limits/limits-api'
import { estimateAmount, marketPriceText, quotePrice, solAmount } from '@/features/limits/limit-words'
import type { LimitOutcome } from '@/features/limits/limits-flow'
import { useLimitActions, useLimitMarket, useLimitOrders } from '@/features/limits/use-limits'
import { useHoldings } from '@/features/portfolio/use-portfolio'
import { useAccount } from '@/features/session/use-account'
import { afterLateAnswer, mayOpenWallet, signableMsOf } from '@/features/wallet/bytes-life'
import { useOpenPlace } from '@/features/shell/open-place'
import { PORTFOLIO_ORDERS_PATH } from '@/features/shell/shell'
import { DOLLAR_PLACES, typedField } from '@/features/trade/keypad-model'
import { SHEET_COPY } from '@/features/trade/sheet-copy'
import { limitBase, referencePerToken, shareDistance, shareFar } from '@/features/trade/stock-pool'
import {
  PAY_SHARES_PCT,
  shareOfRaw,
  ticketSpendableRaw,
  unitsForField,
  formatUnits,
  groupedField,
  type TradeAsset,
} from '@/features/trade/trade-model'
import { ApiError, isNetworkError, needsSignIn, SOL_MINT, USDC_MINT, USDT_MINT } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { openLink } from '@/lib/open-link'
import { type, useTheme } from '@/theme'
import { cn } from '@/utils/cn'
import { formatAmount, formatClock } from '@/utils/format'

import { PoolLine, SheetScroll, SolKeptHelp, WaitBody } from './sheet-parts'

/** What a signature came to: the order placed (or sent and waiting for the network), or an answer that did not come back. */
export function LimitOutcomeCard({
  review,
  outcome,
  inputSymbol,
  quoteSymbol,
}: {
  review: LimitReview
  outcome: Extract<LimitOutcome, { kind: 'done' | 'unknown' }>
  inputSymbol: string
  quoteSymbol: string
}) {
  const locale = useLocale()
  const words = useCopy(LIMIT_COPY)
  const payDecimals = review.side === 'buy' ? review.pair.quoteDecimals : review.pair.baseDecimals
  if (outcome.kind === 'unknown') {
    return (
      <Card className="gap-2">
        <Txt variant="title">{words.unknownTitle}</Txt>
        <Txt variant="ui" tone="muted">
          {words.unknownLine}
        </Txt>
      </Card>
    )
  }
  /* Placed is not filled: the order waits — said as its state in «Мої ордери», with what it spends and the price it fills at. */
  return (
    <Card className="gap-3">
      <View className="flex-row items-start justify-between gap-3">
        <Txt variant="title" className="shrink">
          {`${outcome.settled ? words.placed : words.sentWaiting} · ${VENUE_NAME[review.venue]}`}
        </Txt>
        <Chip
          label={outcome.settled ? words.states.OPEN : words.states.PLACING}
          tone={outcome.settled ? 'brand' : 'warning'}
          caps={false}
        />
      </View>
      <View className="flex-row justify-between gap-3">
        <View className="gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {words.youPay}
          </Txt>
          <Txt variant="data">{`${formatUnits(review.makingRaw, payDecimals, 6, locale)} ${inputSymbol}`}</Txt>
        </View>
        <View className="items-end gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {words.fillsAt}
          </Txt>
          <Txt variant="data">{`${quotePrice(review.fillPrice, locale)} ${quoteSymbol}`}</Txt>
        </View>
      </View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={words.explorer}
        onPress={() => openLink(explorerUrl(outcome.signature))}
        className="min-h-12 flex-row items-center justify-between border-t border-line pt-3 active:opacity-70"
      >
        <Txt variant="ui" tone="muted">
          {words.explorer}
        </Txt>
        <Icon name="open-outline" size={16} color="fgMuted" />
      </Pressable>
    </Card>
  )
}

/**
 * A limit's bytes carry a recent blockhash and live ~30 s (AG-2): the server says how long from arrival they may still
 * be signed (`signableMs`); past it the Review can only be built again, never signed. The wallet is opened only with
 * `MIN_WALLET_WINDOW_MS` of it left — a Ledger needs the time on the device (M45).
 */
function reviewSignableMs(review: LimitReview): number {
  return signableMsOf((review as LimitReview & Readonly<{ signableMs?: unknown }>).signableMs)
}

function reviewFailureKey(error: unknown): LimitFailureKey {
  return needsSignIn(error)
    ? 'signIn'
    : isNetworkError(error)
      ? 'network'
      : limitFailureKey(error instanceof ApiError ? error.code : null)
}

/** AG-2b: is a limit built again the one the person pressed on — the same sides, amounts, price and fees? */
function sameLimitTerms(a: LimitReview, b: LimitReview): boolean {
  return (
    a.venue === b.venue &&
    a.side === b.side &&
    a.inputMint === b.inputMint &&
    a.outputMint === b.outputMint &&
    a.makingRaw === b.makingRaw &&
    a.takingRaw === b.takingRaw &&
    a.price === b.price &&
    a.fee.ryntraBps === b.fee.ryntraBps &&
    a.fee.venueBps === b.fee.venueBps &&
    a.networkFeeLamports >= b.networkFeeLamports &&
    (a.depositLamports ?? 0) >= (b.depositLamports ?? 0)
  )
}

type Phase =
  | Readonly<{ kind: 'edit' }>
  | Readonly<{ kind: 'reviewing' }>
  /* `receivedAt`: the phone's own clock when the Review arrived — its age is never the server's clock against the phone's. */
  | Readonly<{ kind: 'review'; review: LimitReview; receivedAt: number }>
  | Readonly<{ kind: 'signing'; review: LimitReview; receivedAt: number }>
  | Readonly<{ kind: 'after'; review: LimitReview; outcome: Extract<LimitOutcome, { kind: 'done' | 'unknown' }> }>

/**
 * «Ліміт» in Trade (C3) — the web's limit ticket (B3) on the phone, through
 * the same server: a price, an amount, where the order waits, one
 * «Перевірка» with every cost on its own line, one signature in the wallet.
 * The order then waits on chain in the venue's own account — the wallet's
 * money never sits with Ryntra — and lives in «Мої ордери», on the phone and
 * on the web alike. The side is the ticket's own Buy or Sell. `inline` — inside
 * the one sheet of a purchase (NEW-LOOK §1): its «Перевірка» takes the
 * ticket's place in the same sheet, never a sheet over it.
 */
export function LimitPanel({
  asset,
  side,
  inline = false,
  onLocked,
  typed = null,
  stock = null,
}: {
  asset: TradeAsset
  side: LimitSide
  inline?: boolean
  /** Inside the sheet: told while the wallet is asked, so the sheet holds still and never closes under a signature. */
  onLocked?: (locked: boolean) => void
  /**
   * The sum the market ticket held when «Ліміт» was chosen, in the units it was typed in: carried over only where the
   * limit's amount is in the same units (`carriedAmount`) — never converted, never into another token's field.
   */
  typed?: Readonly<{ mint: string; text: string }> | null
  /**
   * A stock token's pool (ST-5 r9): the warning said over the action where the pool cannot stand for the share, and the
   * facts the presets stand on then — the reference per share and the shares a token stands for. `pending` while the
   * stock's read is coming: nothing is pre-filled meanwhile. Null for a token that is no stock.
   */
  stock?: Readonly<{
    warning: string | null
    pending: boolean
    referencePerShare: number | null
    sharesPerToken: number | null
  }> | null
}) {
  const openPlace = useOpenPlace()
  const locale = useLocale()
  const words = useCopy(LIMIT_COPY)
  const buyWords = useCopy(BUY_COPY)
  const { colors } = useTheme()
  const account = useAccount()
  const session = account.session
  // The market ticket's sum, where its units are the limit's own (state's first value only: the panel is new each time).
  const [carried] = useState(() => carriedAmount({ side, assetMint: asset.mint, typed }))
  const [quoteMint, setQuoteMint] = useState<string>(carried?.quoteMint ?? LIMIT_QUOTES[0]!.mint)
  const quote = quoteFor(asset.mint, quoteMint)
  const [pickedVenue, setVenue] = useState<LimitVenue>('trigger')
  const [typedPriceText, setPrice] = useState('')
  /* Until the person types a price it follows the market one per cent on their side: a limit at the market is a market order. */
  const [priceTouched, setPriceTouched] = useState(false)
  const [amount, setAmount] = useState(carried?.text ?? '')
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' })
  // The wallet answered a placement and the relay is under way: the wait says «Надсилаємо…», nothing to cancel.
  const [signedNow, setSignedNow] = useState(false)
  /* AG-2b: a press on aged bytes builds the same limit again under the Review (its button waits), then the wallet opens. */
  const [rebuilding, setRebuildingState] = useState(false)
  // The same, for a second tap in the frame before the first one's render.
  const rebuildingNow = useRef(false)
  const setRebuilding = (on: boolean) => {
    rebuildingNow.current = on
    setRebuildingState(on)
  }
  // Bumped whenever the person leaves the Review (or the panel goes): a rebuild that comes back after it opens nothing.
  const leaveSeq = useRef(0)
  useEffect(
    () => () => {
      leaveSeq.current += 1
    },
    [],
  )
  const leaveReview = () => {
    leaveSeq.current += 1
    setRebuilding(false)
    setPhase({ kind: 'edit' })
  }
  const [failure, setFailure] = useState<LimitFailureKey | null>(null)
  /* AG-2: late wallet answers in a row — the first builds the Review again by itself, the second tells the person. */
  const lateInARow = useRef(0)
  const [refusedOnChain, setRefusedOnChain] = useState(false)
  // A new pair or side starts the ticket over (state adjusted during render, as React prescribes).
  const ticketKey = `${asset.mint}:${quote.mint}:${side}`
  const [seenTicket, setSeenTicket] = useState(ticketKey)
  if (seenTicket !== ticketKey) {
    setSeenTicket(ticketKey)
    setPriceTouched(false)
    setPrice('')
    setAmount('')
    setPhase({ kind: 'edit' })
    setFailure(null)
    setRefusedOnChain(false)
  }

  const market = useLimitMarket(session, asset.mint, quote.mint)
  const orders = useLimitOrders(session)
  const actions = useLimitActions(session)
  const holdings = useHoldings(account.address)
  const marketPrice = market.data?.price ?? null
  // When the market's price was read — the server's moment, else when the phone received it: every figure has its time.
  const marketAt =
    market.data?.observedAt ?? (market.dataUpdatedAt > 0 ? new Date(market.dataUpdatedAt).toISOString() : null)
  const dlmmAvailable = market.data?.dlmm.available === true
  // A pair without a Meteora pool that takes limits waits on Jupiter.
  const venue: LimitVenue = pickedVenue === 'dlmm' && !dlmmAvailable ? 'trigger' : pickedVenue
  /* A stock token's pool far from the share or nearly empty (ST-5 r9: SGOVx «Ринок $2 090,70» against a $100,59
     share): the presets never stand on its price — on the issuer's reference for the token, or on nothing. */
  const shareRef = stock
    ? referencePerToken({
        referencePerShare: stock.referencePerShare,
        sharesPerToken: stock.sharesPerToken,
        quoteUsd: market.data?.quoteUsd ?? null,
        dollarQuote: quote.mint === USDC_MINT || quote.mint === USDT_MINT,
      })
    : null
  const base = limitBase({
    marketPrice,
    warned: Boolean(stock?.warning),
    pending: stock?.pending ?? false,
    referencePerToken: shareRef,
  })
  const price = priceTouched ? typedPriceText : base !== null ? inField(offsetPrice(side, 1, base.price), locale) : ''

  const inputMint = side === 'buy' ? quote.mint : asset.mint
  const inputSymbol = side === 'buy' ? quote.symbol : asset.symbol
  const outputSymbol = side === 'buy' ? asset.symbol : quote.symbol
  const spendable = useMemo(() => {
    const rows = holdings.data?.data.holdings
    if (!rows) return null
    const row = rows.find((holding) =>
      inputMint === SOL_MINT ? holding.kind === 'NATIVE_SOL' : holding.mint === inputMint,
    )
    const decimals = row?.decimals ?? (side === 'buy' ? quote.decimals : asset.decimals)
    if (decimals === null || decimals === undefined) return null
    // SOL less the reserve its order's accounts need (`ticketSpendableRaw`), so «100%» is a sum the wallet can sign.
    return { raw: ticketSpendableRaw(row?.spendableRaw ?? '0', inputMint), decimals }
  }, [holdings.data, inputMint, side, quote.decimals, asset.decimals])
  const spendableNumber = spendable ? Number(rawToDecimal(spendable.raw, spendable.decimals)) : null
  /* The spend field keeps the Market keypad's rules (ST-5 r10: «007» stayed, «1250» ungrouped): no zero before a whole
     number, one mark, a dollar to the cent, a token to its own places; drawn grouped in the language's shape. */
  const inputDollar = inputMint === USDC_MINT || inputMint === USDT_MINT
  const inputDecimals = spendable?.decimals ?? (side === 'buy' ? quote.decimals : asset.decimals) ?? null
  const amountPlaces = inputDollar ? Math.min(DOLLAR_PLACES, inputDecimals ?? DOLLAR_PLACES) : inputDecimals
  const amountMark: ',' | '.' = locale === 'uk' ? ',' : '.'

  const priceNumber = Number(plainDecimal(price) ?? 0)
  const amountNumber = Number(plainDecimal(amount) ?? 0)
  const distance = marketPrice !== null ? distanceFromMarket(priceNumber, marketPrice) : null
  // How far the price stands from the share, where the stock's read gives the reference for a token (ST-5 r9).
  const toShare = shareDistance(priceNumber, shareRef)
  const farFromShare = shareFar(toShare)
  const farLine = farFromShare && toShare !== null ? words.shareFar(wholePercent(toShare, locale), toShare > 0) : null
  // Presets on the share: the distance said is from it — «−1 % від акції», «≈ … вище за акцію» once it is far.
  const shareLine =
    base?.basis !== 'reference'
      ? null
      : toShare === null
        ? '—'
        : (farLine ?? words.fromShare(signedPercent(toShare, locale)))
  // The chips' own distance — from what they stand on.
  const basePrice = base?.price ?? null
  const baseDistance = basePrice !== null ? distanceFromMarket(priceNumber, basePrice) : null
  const presetChosen =
    PRICE_OFFSETS.find(
      (step) =>
        baseDistance !== null &&
        Math.abs(Math.abs(baseDistance) - step) < 0.05 &&
        Math.sign(baseDistance) === (side === 'buy' ? -1 : 1),
    )?.toString() ?? ''
  const out = estimatedOut(side, amountNumber, priceNumber)
  const block = ticketBlock({ side, price, amount, marketPrice, spendable: spendableNumber })
  // Read after an await: the newest render's verdict, never the one the press closed over.
  const blockNow = useRef(block)
  useEffect(() => {
    blockNow.current = block
  }, [block])
  const busy = phase.kind === 'reviewing' || phase.kind === 'signing'
  const signingNow = phase.kind === 'signing'
  useEffect(() => {
    onLocked?.(signingNow)
  }, [signingNow, onLocked])
  // A panel that leaves the sheet lets the sheet go.
  useEffect(() => () => onLocked?.(false), [onLocked])
  /*
   * Inside the sheet, while the amount is typed, the sheet keeps its end — the status line and «Перевірка» — above the
   * keyboard: when the keyboard opens and whenever a line appears or changes under the amount (ST-5).
   */
  const sheetScroll = useContext(SheetScroll)
  const [amountFocused, setAmountFocused] = useState(false)
  const statusKey = `${block && amount !== '' ? block : ''}|${refusedOnChain ? 'chain' : ''}|${failure ?? ''}`
  useEffect(() => {
    if (inline && amountFocused) sheetScroll?.revealEnd()
  }, [inline, amountFocused, statusKey, sheetScroll])
  useEffect(() => {
    if (!inline || !amountFocused || !sheetScroll) return
    const sub = Keyboard.addListener('keyboardDidShow', () => sheetScroll.revealEnd())
    return () => sub.remove()
  }, [inline, amountFocused, sheetScroll])
  const waiting = orders.data ? openCount(orders.data.orders) : 0

  const ordersDoor = (
    <Card padded={false}>
      <DoorRow
        icon="list-outline"
        label={words.myOrders}
        line={waiting > 0 ? words.myOrdersLine(waiting) : undefined}
        onPress={() => openPlace(PORTFOLIO_ORDERS_PATH)}
        last
      />
    </Card>
  )

  if (!session) {
    return (
      <View className="gap-3">
        {/* The button says what is needed (ST-4): no line repeats it. */}
        <View className="gap-3">
          {account.address ? (
            <Button
              title={buyWords.signIn}
              size="lg"
              loading={account.signingIn}
              onPress={() => void account.signIn()}
            />
          ) : (
            <Button
              title={buyWords.connect}
              size="lg"
              loading={account.busy === 'connect'}
              onPress={() => void account.connect()}
            />
          )}
        </View>
      </View>
    )
  }

  /**
   * `asked`: the venue chosen from «Перевірка»'s «Де чекає», read before the state has it. `note`: said over the new
   * Review — AG-2's «built again» after the bytes aged out under the wallet.
   */
  async function review(
    asked: LimitVenue | null = null,
    note: LimitFailureKey | null = null,
  ): Promise<Readonly<{ review: LimitReview; receivedAt: number }> | null> {
    // Inside the sheet the ticket always asks Jupiter; the other venue is chosen from «Перевірка» only, so a
    // refused or abandoned DLMM Review never leaves a hidden choice behind (M44.6).
    const venueNow = asked ?? (inline ? 'trigger' : venue)
    // The market moved under an untouched price and it crosses now: back to the ticket, where the reason is said.
    if (!session || block) {
      setPhase({ kind: 'edit' })
      return null
    }
    // A new Review (the ticket's, or «Натомість чекати на …») ends a press's rebuild in flight.
    leaveSeq.current += 1
    setRebuilding(false)
    setFailure(null)
    setRefusedOnChain(false)
    setPhase({ kind: 'reviewing' })
    try {
      const built = { review: await askReview(venueNow), receivedAt: Date.now() }
      setPhase({ kind: 'review', ...built })
      if (note) setFailure(note)
      return built
    } catch (error) {
      setFailure(reviewFailureKey(error))
      setPhase({ kind: 'edit' })
      return null
    }
  }

  async function askReview(venueNow: LimitVenue): Promise<LimitReview> {
    const answer = await limitsApi.review(session!, {
      venue: venueNow,
      side,
      baseMint: asset.mint,
      quoteMint: quote.mint,
      amount: plainDecimal(amount)!,
      price: plainDecimal(price)!,
      quoteUsd: market.data?.quoteUsd ?? null,
    })
    return answer.review
  }

  async function sign(reviewed: LimitReview, receivedAt: number, rebuilt = false) {
    if (actions.acting !== null) return
    /*
     * AG-2: the wallet opens only with its window left on the bytes. Less than that — the same limit is built again and
     * the wallet opens on it at once (AG-2b): one press, as long as the order is the one on screen; if a figure moved,
     * the new Review is shown with its note instead.
     */
    if (!mayOpenWallet({ receivedAtMs: receivedAt, signableMs: reviewSignableMs(reviewed), nowMs: Date.now() })) {
      // Built again once at a press; bytes that come too short even then are said, never chased.
      if (rebuilt) {
        setFailure('bytesRebuilt')
        return
      }
      if (!session || block) {
        leaveReview()
        return
      }
      if (rebuildingNow.current) return
      const seq = leaveSeq.current
      setFailure(null)
      setRebuilding(true)
      let fresh: LimitReview
      try {
        fresh = await askReview(reviewed.venue)
      } catch (error) {
        if (leaveSeq.current !== seq) return
        setRebuilding(false)
        setFailure(reviewFailureKey(error))
        setPhase({ kind: 'edit' })
        return
      }
      // The person left while it was built: nothing opens.
      if (leaveSeq.current !== seq) return
      setRebuilding(false)
      // The market crossed the price meanwhile: back to the ticket, where the reason is said.
      if (blockNow.current) {
        setPhase({ kind: 'edit' })
        return
      }
      const freshAt = Date.now()
      setPhase({ kind: 'review', review: fresh, receivedAt: freshAt })
      if (!sameLimitTerms(reviewed, fresh)) {
        setFailure('bytesRebuilt')
        return
      }
      return sign(fresh, freshAt, true)
    }
    setFailure(null)
    setRefusedOnChain(false)
    setPhase({ kind: 'signing', review: reviewed, receivedAt })
    setSignedNow(false)
    const outcome = await actions.place(reviewed, receivedAt + reviewSignableMs(reviewed), () => setSignedNow(true))
    if (outcome === null) return
    // AG-2: the wallet answered after the bytes could land — never relayed. Built again once by itself, then said plainly.
    if (outcome.kind === 'refused' && outcome.reason === 'reviewClosed') {
      lateInARow.current += 1
      if (afterLateAnswer(lateInARow.current) === 'tell') {
        setFailure('deviceConfirm')
        setPhase({ kind: 'review', review: reviewed, receivedAt })
        return
      }
      await review(reviewed.venue, 'bytesRebuilt')
      return
    }
    lateInARow.current = 0
    if (outcome.kind === 'refused') {
      setFailure(outcome.reason)
      setPhase({ kind: 'review', review: reviewed, receivedAt })
      return
    }
    if (outcome.kind === 'failed') {
      // The chain said no: the order does not stand — said in the ticket, which builds a new Review.
      setRefusedOnChain(true)
      setPhase({ kind: 'edit' })
      return
    }
    setPhase({ kind: 'after', review: reviewed, outcome })
  }

  if (phase.kind === 'after') {
    return (
      <View className="gap-3">
        <LimitOutcomeCard
          review={phase.review}
          outcome={phase.outcome}
          inputSymbol={inputSymbol}
          quoteSymbol={quote.symbol}
        />
        {ordersDoor}
        <Button
          title={words.newLimit}
          variant="secondary"
          onPress={() => {
            setAmount('')
            setPhase({ kind: 'edit' })
          }}
        />
      </View>
    )
  }

  const shares = spendable && /^\d+$/.test(spendable.raw) && BigInt(spendable.raw) > 0n ? PAY_SHARES_PCT : []
  const reviewOpen = phase.kind === 'review' || phase.kind === 'signing'

  // Inside the sheet the venue is a row of «Перевірка» (NEW-LOOK §3): Jupiter first, the other a touch away.
  const otherVenue: LimitVenue | null = reviewOpen
    ? phase.review.venue === 'trigger'
      ? dlmmAvailable
        ? 'dlmm'
        : null
      : 'trigger'
    : null
  const switchVenue =
    otherVenue && phase.kind === 'review' && !rebuilding
      ? {
          label: words.changeVenue(VENUE_NAME[otherVenue]),
          onPress: () => {
            setVenue(otherVenue)
            void review(otherVenue)
          },
        }
      : null

  if (inline && reviewOpen) {
    return (
      <View className="gap-3">
        <Txt variant="title" accessibilityRole="header">
          {words.reviewTitle(phase.review.side, asset.symbol, VENUE_NAME[phase.review.venue])}
        </Txt>
        <LimitReviewBody
          review={phase.review}
          signing={phase.kind === 'signing'}
          inputSymbol={inputSymbol}
          outputSymbol={outputSymbol}
          quoteSymbol={quote.symbol}
          marketPrice={marketPrice}
          failure={failure}
          receivedAt={phase.receivedAt}
          onSign={() => void sign(phase.review, phase.receivedAt)}
          rebuilding={rebuilding}
          onBack={leaveReview}
          onCancelWait={actions.cancelSigning}
          sent={signedNow}
          switchVenue={switchVenue}
        />
      </View>
    )
  }

  return (
    <View className="gap-3">
      <Card className="gap-2">
        <View className="flex-row items-center justify-between gap-3">
          <Txt variant="labelSm" tone="faint" caps numberOfLines={1} className="shrink-0">
            {words.limitPrice}
          </Txt>
          {marketPrice !== null ? (
            <Button
              // The app's price shape with its time (ST-5): «Ринок $0,0₅295 · 05:02», never eleven places.
              title={`${words.market} ${marketPriceText(
                marketPrice,
                { symbol: quote.symbol, dollar: quote.mint === USDC_MINT || quote.mint === USDT_MINT },
                locale,
              )}${marketAt ? ` · ${formatClock(marketAt)}` : ''}`}
              variant="ghost"
              size="sm"
              hitSlop={6}
              disabled={busy}
              onPress={() => {
                setPriceTouched(true)
                setPrice(inField(typedPrice(marketPrice), locale))
              }}
            />
          ) : null}
        </View>
        <View className="flex-row items-center gap-3">
          <TextInput
            value={price}
            onChangeText={(text) => {
              setPriceTouched(true)
              setPrice(text.replace(/[^\d.,]/g, ''))
            }}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.fgMuted}
            selectionColor={colors.brand}
            cursorColor={colors.brand}
            accessibilityLabel={`${words.limitPrice}, ${quote.symbol}`}
            editable={!busy}
            className="flex-1 text-fg"
            style={[type.dataLg, { paddingVertical: 0 }]}
          />
          <Txt variant="data" tone="muted">
            {quote.symbol}
          </Txt>
        </View>
        {shareLine !== null ? (
          <Txt variant="ui" tone={farFromShare || block === 'crosses' ? 'warning' : 'faint'}>
            {shareLine}
          </Txt>
        ) : (
          <>
            <Txt variant="ui" tone={block === 'crosses' ? 'warning' : 'faint'}>
              {distance === null ? '—' : words.fromMarket(signedPercent(distance, locale))}
            </Txt>
            {/* A typed price far from the share, beside the market's distance (ST-5 r9). */}
            {farLine ? (
              <Txt variant="ui" tone="warning">
                {farLine}
              </Txt>
            ) : null}
          </>
        )}
        {basePrice !== null ? (
          <View>
            <ChoiceChips
              choices={PRICE_OFFSETS.map((step) => ({
                value: String(step),
                label: `${side === 'buy' ? '−' : '+'}${step}${percentMark(locale)}`,
              }))}
              value={presetChosen}
              onChange={(step) => {
                setPriceTouched(true)
                setPrice(inField(offsetPrice(side, Number(step), basePrice), locale))
              }}
              size="sm"
              tall
              quiet
              disabled={busy}
            />
          </View>
        ) : null}
        <View>
          <ChoiceChips
            choices={LIMIT_QUOTES.filter((entry) => entry.mint !== asset.mint).map((entry) => ({
              value: entry.mint,
              label: entry.symbol,
            }))}
            value={quote.mint}
            onChange={setQuoteMint}
            role="radiogroup"
            size="sm"
            tall
            disabled={busy}
          />
        </View>
      </Card>

      <Card className="gap-2">
        <View className="flex-row items-center justify-between gap-3">
          <Txt variant="labelSm" tone="faint" caps numberOfLines={1} className="shrink-0">
            {side === 'buy' ? words.spend : words.amount}
          </Txt>
          {spendable ? (
            <View className="shrink flex-row items-center gap-0.5">
              <Txt variant="labelSm" tone={block === 'balance' ? 'danger' : 'muted'} className="shrink">
                {words.canUse(`${formatUnits(spendable.raw, spendable.decimals, 6, locale)} ${inputSymbol}`)}
              </Txt>
              {inputMint === SOL_MINT ? <SolKeptHelp /> : null}
            </View>
          ) : null}
        </View>
        <View className="flex-row items-center gap-3">
          <TextInput
            value={groupedField(amount, locale)}
            onChangeText={(text) => setAmount(typedField(text, amountMark, amountPlaces))}
            onFocus={() => setAmountFocused(true)}
            onBlur={() => setAmountFocused(false)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.fgMuted}
            selectionColor={colors.brand}
            cursorColor={colors.brand}
            accessibilityLabel={`${side === 'buy' ? words.spend : words.amount}, ${inputSymbol}`}
            editable={!busy}
            className="flex-1 text-fg"
            style={[type.dataLg, { paddingVertical: 0 }]}
          />
          <Txt variant="data" tone="muted">
            {inputSymbol}
          </Txt>
        </View>
        {shares.length > 0 && spendable ? (
          <View className="flex-row gap-2">
            {shares.map((share) => (
              <Button
                key={share}
                title={`${share}%`}
                variant="secondary"
                size="sm"
                hitSlop={6}
                className="flex-1"
                disabled={busy}
                onPress={() => {
                  const raw = shareOfRaw(spendable.raw, share)
                  if (!raw) return
                  // Dollars are shared to the cent, rounded down — as the Market ticket's shares.
                  const cent = inputDollar && spendable.decimals > 2 ? 10n ** BigInt(spendable.decimals - 2) : 1n
                  setAmount(unitsForField(((BigInt(raw) / cent) * cent).toString(), spendable.decimals, locale))
                }}
              />
            ))}
          </View>
        ) : null}
        <View className="flex-row items-center justify-between gap-3 border-t border-line pt-2">
          <Txt variant="ui" tone="muted">
            {side === 'buy' ? words.youGet : words.youReceive}
          </Txt>
          <Txt variant="data">{out === null ? '—' : `${estimateAmount(out, locale)} ${outputSymbol}`}</Txt>
        </View>
      </Card>

      {inline ? null : (
        <View className="gap-2" accessibilityRole="radiogroup" accessibilityLabel={words.whereItWaits}>
          {/* What each place takes sits behind «?» (ST-4); an option says only its name, or why it is not offered. */}
          <View className="flex-row items-center gap-1">
            <Txt variant="labelSm" tone="faint" caps className="shrink">
              {words.whereItWaits}
            </Txt>
            <HelpDot
              title={words.whereItWaits}
              body={[words.whatTrigger, words.venueTrigger, words.whatDlmm, words.venueDlmm]}
            />
          </View>
          {(['trigger', 'dlmm'] as const).map((entry) => {
            const unavailable = entry === 'dlmm' && !dlmmAvailable
            return (
              <VenueRow
                key={entry}
                name={VENUE_NAME[entry]}
                line={unavailable ? (market.data === undefined ? words.checkingPools : words.noPool) : null}
                selected={venue === entry}
                disabled={busy || unavailable}
                onPress={() => setVenue(entry)}
              />
            )
          })}
        </View>
      )}

      {/* The pool that cannot stand for the share, over the action (ST-5 r9). */}
      {stock?.warning ? <PoolLine text={stock.warning} /> : null}
      {block && amount !== '' ? (
        <Txt variant="ui" tone={block === 'crosses' || block === 'balance' ? 'danger' : 'muted'}>
          {words.block[block]}
        </Txt>
      ) : null}
      {refusedOnChain && !reviewOpen ? (
        <Txt variant="ui" tone="danger" accessibilityLiveRegion="polite">
          {words.placeFailed}
        </Txt>
      ) : null}
      {failure && !reviewOpen ? (
        <Txt variant="ui" tone="danger" accessibilityLiveRegion="polite">
          {words.failures[failure]}
        </Txt>
      ) : null}
      <Button
        title={phase.kind === 'reviewing' ? words.preparing : words.review}
        size="lg"
        loading={phase.kind === 'reviewing'}
        disabled={busy || block !== null}
        onPress={() => void review()}
      />
      {/* Inside the sheet «Review» stays last (NEW-LOOK §1); the orders live in «Портфель · Ордери», and the placed
          card keeps its door (C3). */}
      {inline ? null : ordersDoor}

      <Sheet
        visible={reviewOpen && !inline}
        title={
          reviewOpen ? words.reviewTitle(phase.review.side, asset.symbol, VENUE_NAME[phase.review.venue]) : words.review
        }
        onClose={phase.kind === 'signing' ? () => undefined : leaveReview}
        scroll
      >
        {reviewOpen ? (
          <LimitReviewBody
            review={phase.review}
            signing={phase.kind === 'signing'}
            inputSymbol={inputSymbol}
            outputSymbol={outputSymbol}
            quoteSymbol={quote.symbol}
            marketPrice={marketPrice}
            failure={failure}
            receivedAt={phase.receivedAt}
            onSign={() => void sign(phase.review, phase.receivedAt)}
            rebuilding={rebuilding}
            onBack={leaveReview}
            onCancelWait={actions.cancelSigning}
            sent={signedNow}
          />
        ) : null}
      </Sheet>
    </View>
  )
}

/** A typed figure as the field shows it: the language's own decimal mark («103,489» · «103.489»); the route reads either. */
function inField(value: string, locale: 'en' | 'uk'): string {
  return locale === 'uk' ? value.replace('.', ',') : value
}

function signedPercent(value: number, locale: 'en' | 'uk'): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatAmount(Math.abs(value), 2, locale)}${percentMark(locale)}`
}

/** An unsigned distance in whole per cent, the words saying which way: «1 978 %» · «1,978%». */
function wholePercent(value: number, locale: 'en' | 'uk'): string {
  return `${formatAmount(Math.abs(value), 0, locale)}${percentMark(locale)}`
}

/** The percent sign as each language writes it (ST-5): «−1%» in English, «−1 %» in Ukrainian. */
function percentMark(locale: 'en' | 'uk'): string {
  return locale === 'uk' ? ' %' : '%'
}

/** One place an order can wait: its name and what it means, a radio — the web's venue buttons. */
function VenueRow({
  name,
  line,
  selected,
  disabled,
  onPress,
}: {
  name: string
  /** Only why the place is not offered (or still being checked) — never what it does. */
  line: string | null
  selected: boolean
  disabled: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={line ? `${name}. ${line}` : name}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        'min-h-12 gap-0.5 rounded-sm border px-4 py-3',
        selected ? 'border-brand bg-brand-chip' : 'border-line bg-surface active:bg-hover',
        disabled ? 'opacity-50' : '',
      )}
    >
      <Txt variant="ui" tone={selected ? 'brand' : 'fg'}>
        {name}
      </Txt>
      {line ? (
        <Txt variant="ui" tone="muted">
          {line}
        </Txt>
      ) : null}
    </Pressable>
  )
}

export function LimitReviewBody({
  review,
  signing,
  rebuilding = false,
  inputSymbol,
  outputSymbol,
  quoteSymbol,
  marketPrice,
  failure,
  receivedAt,
  onSign,
  onBack,
  onCancelWait = null,
  sent = false,
  switchVenue = null,
}: {
  /** «Де чекає»'s touch to the other venue, inside the sheet: a new «Перевірка» is built there. */
  switchVenue?: Readonly<{ label: string; onPress: () => void }> | null
  review: LimitReview
  signing: boolean
  /** AG-2b: the same limit is being built again at the press; the wallet opens by itself after. */
  rebuilding?: boolean
  /** The wallet answered and the relay is under way: «Скасувати» goes. */
  sent?: boolean
  /** «Скасувати» while the wallet is asked (M45). */
  onCancelWait?: (() => void) | null
  inputSymbol: string
  outputSymbol: string
  quoteSymbol: string
  marketPrice: number | null
  failure: LimitFailureKey | null
  /** The phone's clock when the Review arrived. */
  receivedAt: number
  onSign: () => void
  onBack: () => void
}) {
  const locale = useLocale()
  const words = useCopy(LIMIT_COPY)
  const sheet = useCopy(SHEET_COPY)
  const inDecimals = review.side === 'buy' ? review.pair.quoteDecimals : review.pair.baseDecimals
  const outDecimals = review.side === 'buy' ? review.pair.baseDecimals : review.pair.quoteDecimals
  const pay = `${formatUnits(review.makingRaw, inDecimals, inDecimals, locale)} ${inputSymbol}`
  const get = `${formatUnits(review.takingRaw, outDecimals, outDecimals, locale)} ${outputSymbol}`
  const bps = (value: number) => `${formatAmount(value / 100, 2, locale)}${percentMark(locale)}`
  // «Де чекає» stands over the rows with its «?» (ST-4): where the amount waits, in plain words, one tap deep.
  const where = { label: words.whereWaits, value: VENUE_NAME[review.venue] }
  const whereHelp =
    review.venue === 'trigger'
      ? [words.whatTrigger]
      : [words.whatDlmm, ...(review.makerFeeShare ? [words.makerShare] : [])]
  const rows: ReviewRow[] = [
    { label: words.yourPrice, value: `${quotePrice(Number(review.price), locale)} ${quoteSymbol}` },
    { label: words.fillsAt, value: `${quotePrice(review.fillPrice, locale)} ${quoteSymbol}`, emphasis: true },
    ...(marketPrice !== null
      ? [{ label: words.marketNow, value: `${quotePrice(marketPrice, locale)} ${quoteSymbol}` }]
      : []),
    {
      label: `${words.ryntraFee} · ${bps(review.fee.ryntraBps)}`,
      value:
        review.fee.ryntraBps > 0
          ? `${formatUnits(review.fee.ryntraFeeRaw, outDecimals, 6, locale)} ${outputSymbol}`
          : review.fee.reason === 'NO_FEE_ACCOUNT'
            ? words.feeNotCharged
            : words.none,
    },
    review.venue === 'trigger'
      ? {
          label: `Jupiter · ${bps(review.fee.venueBps)}`,
          value:
            review.fee.venueBps > 0
              ? `${formatUnits(review.fee.venueFeeRaw, outDecimals, 6, locale)} ${outputSymbol}`
              : words.none,
        }
      : { label: `Meteora · 0${percentMark(locale)}`, value: words.none },
    { label: words.network, value: solAmount(review.networkFeeLamports, locale) },
    ...(review.depositLamports !== null && review.depositLamports > 0
      ? [
          {
            label: review.venue === 'dlmm' ? words.rentDlmm : words.rentTrigger,
            value: solAmount(review.depositLamports, locale),
          },
        ]
      : []),
    {
      label: words.total,
      value: `${bps(review.fee.ryntraBps + review.fee.venueBps)} · ${solAmount(review.networkFeeLamports, locale)}`,
    },
  ]
  return (
    <View className="gap-3 pb-2">
      <View className="flex-row gap-3">
        <View className="flex-1 gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {words.youPay}
          </Txt>
          <Txt variant="data">{pay}</Txt>
        </View>
        <View className="flex-1 gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {review.side === 'buy' ? words.youGet : words.youReceive}
          </Txt>
          <Txt variant="data">{get}</Txt>
        </View>
      </View>
      <View className="flex-row items-center justify-between gap-3 pl-4 pr-4">
        <View className="shrink flex-row items-center gap-1">
          <Txt variant="ui" tone="muted" className="shrink">
            {where.label}
          </Txt>
          <HelpDot title={where.label} body={whereHelp} />
        </View>
        <Txt variant="data">{where.value}</Txt>
      </View>
      <ReviewBlock
        rows={rows}
        quotedAt={new Date(receivedAt).toISOString()}
        // The limit's price is the person's own; its bytes are built again at the press when they aged (AG-2b).
        quoteTtlSeconds={Number.POSITIVE_INFINITY}
        warnings={[words.risk]}
      />
      {switchVenue && !signing ? (
        <Button title={switchVenue.label} variant="ghost" size="lg" onPress={switchVenue.onPress} />
      ) : null}
      {failure ? (
        <Txt variant="ui" tone={failure === 'bytesRebuilt' ? 'warning' : 'danger'} accessibilityLiveRegion="polite">
          {words.failures[failure]}
        </Txt>
      ) : null}
      {/* The wallet's wait, the same as every operation's (NEW-LOOK §4): the Ledger line and «Скасувати». */}
      {signing ? (
        <WaitBody sending={sent} onCancel={onCancelWait} />
      ) : (
        <Button title={failure === 'ledgerBlind' ? sheet.tryAgain : words.sign} onPress={onSign} loading={rebuilding} />
      )}
      {signing ? null : <Button title={words.back} variant="ghost" onPress={onBack} />}
    </View>
  )
}
