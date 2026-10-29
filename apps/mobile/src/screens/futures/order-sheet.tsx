import { useRef, useState, type ReactNode } from 'react'
import { Modal, Pressable, TextInput, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { ChoiceChips } from '@/components/choice-chips'
import { ToggleRow } from '@/components/field'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { explorerUrl } from '@/features/history/history-model'
import { BUY_COPY } from '@/features/invest/buy-copy'
import { ORDER_COPY, type OrderCopy } from '@/features/futures/order-copy'
import { receiptView, reviewView, shareText, sizeText, stopSlipText, type ViewRow } from '@/features/futures/order-view'
import type {
  FuturesAccount,
  FuturesBook,
  FuturesMarket,
  FuturesOrder,
  FuturesPosition,
} from '@/features/futures/futures-model'
import {
  CUT_SHARES,
  DEFAULT_PERP_SLIPPAGE_BPS,
  legTicks,
  plainUsd,
  sameOrderNoWorse,
  shareLots,
  tradesNow,
  unitsOf,
  type OrderBody,
  type OrderFailure,
  type OrderResult,
  type OrderReview,
  type OrderStates,
  type PerpSide,
  type PerpUnits,
} from '@/features/futures/orders-model'
import {
  BOOK_FRESH_MS,
  clampLeverage,
  decimalInput,
  DEFAULT_LEVERAGE,
  heldUnitsOf,
  legResult,
  leverageChoices,
  leverageKey,
  leverageSteps,
  newPerpDraft,
  PERP_SHARES,
  PERP_SLIPPAGES,
  perpOrderBody,
  perpTicketFigures,
  positionsValueUsdOf,
  sizeAtPercent,
  sizeInUnit,
  wantsDeposit,
  type PerpDraft,
  type SizeUnit,
  type TicketFigures,
} from '@/features/futures/perp-order-model'
import { useFuturesMarkets } from '@/features/futures/use-futures'
import { ORDER_FOLLOW_MS, useFollowedOrder, useOrderActions, useOrderStates } from '@/features/futures/use-orders'
import { useAccount } from '@/features/session/use-account'
import { DOLLAR_PLACES, typedField } from '@/features/trade/keypad-model'
import { SHEET_COPY } from '@/features/trade/sheet-copy'
import { groupedField } from '@/features/trade/trade-model'
import { mayOpenWallet, signableMsOf } from '@/features/wallet/bytes-life'
import { useNow } from '@/hooks/use-now'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'
import { openLink } from '@/lib/open-link'
import { readPreference, writePreference } from '@/lib/preferences'
import { type, useTheme } from '@/theme'
import { formatAmount, formatClock, formatPrice, formatUsd, formatUsdSigned, shortAddress } from '@/utils/format'

import { DoneBody, PoolLine, SheetAction, SheetFrame, ValidFor, WaitBody } from '../trade/sheet-parts'

/**
 * What the sheet does: a new position or an addition, or one act on what the account holds. An open with a `price` (a
 * price pressed in the book) starts on a limit at that price.
 */
export type OrderIntent =
  | Readonly<{ kind: 'open'; side: PerpSide; price?: string }>
  | Readonly<{ kind: 'position'; position: FuturesPosition }>
  | Readonly<{ kind: 'reduce'; position: FuturesPosition }>
  | Readonly<{ kind: 'protect'; position: FuturesPosition }>
  | Readonly<{ kind: 'close'; position: FuturesPosition }>
  | Readonly<{ kind: 'cancel'; order: FuturesOrder }>

/* A Review, its signature and its receipt belong to the wallet they were built for, whatever is connected later. */
type Phase =
  | Readonly<{ kind: 'edit' }>
  | Readonly<{ kind: 'reviewing' }>
  | Readonly<{ kind: 'review'; review: OrderReview; body: OrderBody; receivedAt: number }>
  | Readonly<{ kind: 'signing'; review: OrderReview; body: OrderBody; receivedAt: number }>
  | Readonly<{ kind: 'done'; review: OrderReview; result: OrderResult; at: number; owner: string }>

/** The price places a field takes: enough for a meme's sub-cent mark, never more than Phoenix's ticks can hold. */
const PRICE_PLACES = 8

/** A close takes the position's own size as Phoenix holds it at the Review, whatever the phone saw. */
const closeBody = (owner: string, position: FuturesPosition): OrderBody => ({
  kind: 'reduce',
  owner,
  symbol: position.symbol,
  size: '1',
  close: true,
})

/** The phone's clock, read in a press's handler — never while drawing. */
const clock = () => Date.now()

/** No receipt to follow: a settled stand-in, so the hook asks nothing. */
const SETTLED: OrderResult = { signature: '', state: 'LANDED', fills: [] }

/** A size Phoenix sent, or a dash when its lots could not be read — never «0». */
const sizeOrDash = (size: number | null, locale: Locale) => (size === null ? '—' : sizeText(String(size), locale))

/** A position or an order of the cross-margin account Ryntra's orders act on; another subaccount is isolated. */
export const actsOn = (entry: Readonly<{ subaccount: number | null }>) => entry.subaccount === 0

/** The language's decimal mark, as a field holds it. */
const markOf = (locale: Locale): ',' | '.' => (locale === 'uk' ? ',' : '.')

/** A plain «12.5» the model made, as the field holds it in the language's mark. */
const fieldText = (plain: string, locale: Locale) => (locale === 'uk' ? plain.replace('.', ',') : plain)

/** The leverage this phone keeps for a market, inside its range; ten times (or the highest when lower) until one is picked. */
function keptLeverage(market: Pick<FuturesMarket, 'symbol' | 'maxLeverage'>): number {
  const fallback = String(clampLeverage(DEFAULT_LEVERAGE, market.maxLeverage))
  const kept = readPreference(leverageKey(market.symbol), leverageChoices(market.maxLeverage), fallback)
  return clampLeverage(Number(kept), market.maxLeverage)
}

/** The ticket's figures from what the sheet holds: the wallet's account, the gate's word, the fresh book. */
function ticketOf({
  market,
  units,
  draft,
  leverage,
  account,
  states,
  book,
  heldUnits,
  positionsValueUsd,
}: Readonly<{
  market: FuturesMarket
  units: PerpUnits
  draft: PerpDraft
  leverage: number
  account: FuturesAccount | null
  states: OrderStates
  book: FuturesBook | null
  heldUnits: number
  positionsValueUsd: number | null
}>): TicketFigures {
  return perpTicketFigures({
    market,
    units,
    draft,
    leverage,
    margin: account?.margin ?? null,
    opened: account !== null && account.state !== 'none' && account.state !== 'uninitialized',
    maxNotionalUsd: states.open ? states.maxNotionalUsd : null,
    builder: states.builder,
    builderBps: states.builderBps,
    book,
    heldUnits,
    positionsValueUsd,
  })
}

/** What an open intent sets on the draft: its side, and a limit at a price pressed in the book. */
const intentPatch = (intent: Extract<OrderIntent, { kind: 'open' }>, locale: Locale): Partial<PerpDraft> => ({
  side: intent.side,
  ...(intent.price
    ? { type: 'limit' as const, price: typedField(intent.price, markOf(locale), PRICE_PLACES), percent: null }
    : {}),
})

/** A decimal field the keypad's way: «1 250,5» drawn, «1250,5» held. */
function NumberField({
  label,
  value,
  onChange,
  places,
  editable,
  right,
  under,
  autoFocus = false,
  placeholder = '0',
}: {
  label: string
  value: string
  onChange: (text: string) => void
  places: number
  editable: boolean
  right?: ReactNode
  under?: ReactNode
  autoFocus?: boolean
  /** «0» for an amount; «—» for a price that may stay unset (TP/SL: empty is none). */
  placeholder?: string
}) {
  const locale = useLocale()
  const { colors } = useTheme()
  const mark: ',' | '.' = locale === 'uk' ? ',' : '.'
  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between gap-3">
        <Txt variant="labelSm" tone="faint" caps numberOfLines={1} className="shrink">
          {label}
        </Txt>
        {right}
      </View>
      <TextInput
        value={groupedField(value, locale)}
        onChangeText={(text) => onChange(typedField(text, mark, places))}
        keyboardType="decimal-pad"
        placeholder={placeholder}
        placeholderTextColor={colors.fgMuted}
        selectionColor={colors.brand}
        cursorColor={colors.brand}
        accessibilityLabel={label}
        editable={editable}
        autoFocus={autoFocus}
        className="text-fg"
        style={[type.dataLg, { paddingVertical: 0 }]}
      />
      {under}
    </Card>
  )
}

/** A price the person may type back into a field, in the language's mark. */
const fieldOf = (value: number | null, locale: Locale) => {
  // Every digit Phoenix's trigger holds: an untouched TP/SL goes back to the same tick, never one rounded away.
  const plain = plainUsd(value, 12)
  return plain === null ? '' : locale === 'uk' ? plain.replace('.', ',') : plain
}

/** The rows of a Review's block: a label and its figure, the eye's tone where a figure is a warning. */
function Rows({ rows, emphasisLast = false }: { rows: readonly ViewRow[]; emphasisLast?: boolean }) {
  return (
    <Card level="elevated" padded={false}>
      <View className="px-4">
        {rows.map((row, index) => (
          <View
            key={row.label}
            className={`flex-row items-start justify-between gap-4 py-3 ${index < rows.length - 1 ? 'border-b border-line' : ''}`}
          >
            <Txt variant="ui" tone={emphasisLast && index === rows.length - 1 ? 'fg' : 'muted'} className="flex-1">
              {row.label}
            </Txt>
            <Txt variant="data" tone={row.tone ?? 'fg'} className="max-w-[62%] text-right">
              {row.value}
            </Txt>
          </View>
        ))}
      </View>
    </Card>
  )
}

/**
 * The orders of «Ф'ючерси» on the phone (C4b) — the web's order panel of B6b: a new position or an addition (market
 * or limit, TP/SL with a market order), and the acts on what the account holds — TP/SL, cut and close of a position,
 * the cancel of a resting order. Each goes through one «Перевірка» the server built and simulated — Phoenix's own view
 * of the account after the order — and one signature of the person's wallet, and ends in a receipt with what Phoenix
 * filled. Whether orders are open is the server's word alone: closed, its Review answers «лише перегляд».
 */
export function OrderSheet({
  market,
  account,
  markAt,
  intent,
  onIntent,
  onClose,
  book = null,
  onDeposit,
  sample = null,
}: {
  market: FuturesMarket
  account: FuturesAccount | null
  /** When the mark was read — every figure carries its time. */
  markAt: number | null
  intent: OrderIntent | null
  onIntent: (next: OrderIntent | null) => void
  onClose: () => void
  /** The market's book as the page last read it: a market order's fill is counted from it while it is fresh. */
  book?: FuturesBook | null
  /** Opens the collateral's deposit: offered where the collateral, not the ticket, is what is short. */
  onDeposit?: () => void
  /**
   * The gallery's own: a step of the open path drawn from the server's sample answers (the gate keeps it closed on
   * production until the operator's canary). Its «Підтвердити в гаманці» opens no wallet.
   */
  sample?: Readonly<{ review?: OrderReview; result?: OrderResult }> | null
}) {
  const words = useCopy(ORDER_COPY)
  const buyWords = useCopy(BUY_COPY)
  const locale = useLocale()
  const wallet = useAccount()
  const session = wallet.session
  const owner = wallet.address
  const states = useOrderStates(owner)
  const actions = useOrderActions(session)
  const units = unitsOf(market)
  const [phase, setPhase] = useState<Phase>(() =>
    sample?.review && sample.result
      ? { kind: 'done', review: sample.review, result: sample.result, at: Date.now(), owner: '' }
      : sample?.review
        ? {
            kind: 'review',
            review: sample.review,
            body: { kind: 'cancel', owner: '', symbol: '', order: '' },
            receivedAt: Date.now(),
          }
        : { kind: 'edit' },
  )
  const [failure, setFailure] = useState<OrderFailure | null>(null)
  const [sent, setSent] = useState(false)
  // The Review's bytes are being built again under it (AG-2b): its button waits.
  const [renewing, setRenewing] = useState(false)
  // Late wallet answers in a row: the first builds the Review again by itself, the second tells the person.
  const lateInARow = useRef(0)
  // A press under way — its «Перевірка» built again or its wallet open.
  const pressing = useRef(false)
  // Bumped whenever the person leaves a step: an answer that comes back after it opens nothing.
  const attempt = useRef(0)

  /* The ticket's draft (C4c): it survives a step back from «Перевірка», never a new sheet. */
  const [draft, setDraft] = useState<PerpDraft>(() => ({
    ...newPerpDraft(DEFAULT_PERP_SLIPPAGE_BPS),
    ...(intent?.kind === 'open' ? intentPatch(intent, locale) : {}),
  }))
  /* The leverage picked for this market, kept on the phone per market; another market reads its own. */
  const [picked, setPicked] = useState(() => ({ symbol: market.symbol, value: keptLeverage(market) }))
  let leverage = clampLeverage(picked.value, market.maxLeverage)
  if (picked.symbol !== market.symbol) {
    leverage = keptLeverage(market)
    setPicked({ symbol: market.symbol, value: leverage })
  }
  const markets = useFuturesMarkets()
  // The book's age is read by a clock that ticks, never while drawing.
  const now = useNow(5_000)
  /* The position's TP/SL as the person edits them; the ticket's own legs are the draft's. */
  const [tp, setTp] = useState(() => (intent?.kind === 'protect' ? fieldOf(intent.position.tpPrice, locale) : ''))
  const [sl, setSl] = useState(() => (intent?.kind === 'protect' ? fieldOf(intent.position.slPrice, locale) : ''))
  const [cutShare, setCutShare] = useState<string>('50')

  // A new intent starts its step over: the side a pinned button chose, a price pressed in the book, the position's own
  // TP/SL to edit. A gallery sample starts on its own step; any other sheet adjusts to its first intent as to every later one.
  const [seen, setSeen] = useState<OrderIntent | null>(sample ? intent : null)
  if (seen !== intent) {
    setSeen(intent)
    if (intent?.kind === 'open' && seen?.kind !== 'open') {
      setDraft((current) => ({
        ...newPerpDraft(current.slippageBps, current.unit),
        ...intentPatch(intent, locale),
      }))
    } else if (intent?.kind === 'open') {
      setDraft((current) => ({ ...current, ...intentPatch(intent, locale) }))
    }
    if (intent?.kind === 'protect') {
      setTp(fieldOf(intent.position.tpPrice, locale))
      setSl(fieldOf(intent.position.slPrice, locale))
    }
    if (intent?.kind === 'reduce') setCutShare('50')
    // A close asked from the position's acts is already being reviewed: its «Перевірка» stays on its way.
    if (intent === null || (phase.kind !== 'done' && phase.kind !== 'reviewing')) {
      setPhase({ kind: 'edit' })
      setFailure(null)
    }
  }

  async function review(body: OrderBody, note: OrderFailure | null = null) {
    const mine = ++attempt.current
    setFailure(null)
    setPhase({ kind: 'reviewing' })
    const answer = await actions.review(body)
    if (mine !== attempt.current) return
    if (!answer.ok) {
      setFailure(answer.reason)
      setPhase({ kind: 'edit' })
      return
    }
    setPhase({ kind: 'review', review: answer.review, body, receivedAt: answer.receivedAt })
    if (note) setFailure(note)
  }

  /* The receipt follows its signature on the chain; the footer's «Новий ордер» waits for the same answer. */
  const done = phase.kind === 'done' ? phase : null
  const live = useFollowedOrder(
    sample ? SETTLED : (done?.result ?? SETTLED),
    done?.owner ?? '',
    done ? tradesNow(done.review) : false,
  )
  // A sample's receipt is drawn as it stands: nothing is asked of the chain.
  const followed = sample && done ? done.result : live

  /*
   * AG-2b, one press: bytes that aged before the wallet opened are built again under the Review (its button waits), and
   * the wallet opens on the fresh ones at once while the order is the one on screen and no worse; otherwise the fresh
   * «Перевірка» is shown with its note. Built again once per press — bytes too short even then are said, never chased.
   */
  /* One press at a time: a second tap before the first re-renders neither opens a second wallet nor drops the first's receipt. */
  async function press(shown: Extract<Phase, { kind: 'review' }>) {
    if (sample || pressing.current) return
    pressing.current = true
    try {
      await sign(shown)
    } finally {
      pressing.current = false
    }
  }

  async function sign(shown: Extract<Phase, { kind: 'review' }>, rebuilt = false) {
    if (
      !mayOpenWallet({
        receivedAtMs: shown.receivedAt,
        signableMs: signableMsOf(shown.review.signableMs),
        nowMs: clock(),
      })
    ) {
      if (rebuilt) {
        setFailure('reviewAged')
        return
      }
      const mine = ++attempt.current
      setFailure(null)
      setRenewing(true)
      const fresh = await actions.review(shown.body)
      if (mine !== attempt.current) return
      setRenewing(false)
      if (!fresh.ok) {
        setFailure(fresh.reason)
        setPhase({ kind: 'edit' })
        return
      }
      const next = { kind: 'review' as const, review: fresh.review, body: shown.body, receivedAt: fresh.receivedAt }
      setPhase(next)
      if (!sameOrderNoWorse(shown.review, fresh.review)) {
        setFailure('reviewAged')
        return
      }
      return sign(next, true)
    }
    const mine = ++attempt.current
    setFailure(null)
    setSent(false)
    setPhase({ ...shown, kind: 'signing' })
    const outcome = await actions.sign(shown.review, shown.receivedAt, () => setSent(true))
    if (outcome === null) {
      setPhase({ ...shown, kind: 'review' })
      return
    }
    // A sent order's receipt is shown whatever happened meanwhile: it is never dropped.
    if (outcome.kind === 'sent') {
      lateInARow.current = 0
      setDraft((current) => ({ ...current, size: '', percent: null, tp: '', sl: '' }))
      setTp('')
      setSl('')
      setPhase({ kind: 'done', review: shown.review, result: outcome.result, at: clock(), owner: shown.body.owner })
      return
    }
    if (mine !== attempt.current) return
    // The wallet answered after the bytes could land — never relayed: built again once by itself, then said plainly.
    if (outcome.reason === 'reviewAged' && outcome.afterSignature) {
      lateInARow.current += 1
      if (lateInARow.current > 1) {
        setFailure('deviceConfirm')
        setPhase({ ...shown, kind: 'review' })
        return
      }
      await review(shown.body, 'reviewAged')
      return
    }
    lateInARow.current = 0
    if (outcome.reason === 'reviewAged') {
      await review(shown.body, 'reviewAged')
      return
    }
    setFailure(outcome.reason)
    // A refusal the relay gave once the wallet had signed ends this «Перевірка»: the next press builds a new one.
    setPhase(outcome.afterSignature ? { kind: 'edit' } : { ...shown, kind: 'review' })
  }

  const leave = () => {
    attempt.current += 1
    pressing.current = false
    lateInARow.current = 0
    setRenewing(false)
    actions.cancelSigning()
    setFailure(null)
    setPhase({ kind: 'edit' })
  }
  const close = () => {
    if (phase.kind === 'signing') return
    leave()
    onClose()
  }
  /* A step back drops whatever «Перевірка» is still on its way: it never appears under the step stepped back to. */
  const backTo = (next: OrderIntent) => {
    leave()
    onIntent(next)
  }

  if (!intent) return null

  const busy = phase.kind === 'reviewing'
  const failureLine = failure ? <PoolLine text={words.failures[failure]} /> : null
  /* The ticket's account: the connected wallet's own (a gallery's sample stands in for one), its position on this
     market, every position's value at its mark, and the book while it is fresh. */
  const mine = account && (sample || account.wallet === owner) ? account : null
  const noAccount = mine !== null && (mine.state === 'none' || mine.state === 'uninitialized')
  const heldUnits = heldUnitsOf(mine, market.symbol)
  const positionsValueUsd = positionsValueUsdOf(mine, markets.data?.markets ?? [market])
  const freshBook = book && (sample || now - book.observedAt <= BOOK_FRESH_MS) ? book : null
  let title: string
  let back: (() => void) | null = null
  let body: ReactNode
  let footer: ReactNode = null

  /* A sent order's receipt and an open wallet come first: a session that lapses meanwhile never hides them. */
  if (phase.kind === 'done') {
    title = `${market.symbol}-PERP`
    body = <ReceiptView review={phase.review} result={followed} at={phase.at} words={words} locale={locale} following />
    footer = (
      <DoneFooter
        at={phase.at}
        result={followed}
        words={words}
        onAgain={() => {
          setPhase({ kind: 'edit' })
          onIntent({ kind: 'open', side: draft.side })
        }}
        onClose={close}
      />
    )
  } else if (phase.kind === 'signing') {
    title = words.check
    body = <WaitBody sending={sent} onCancel={actions.cancelSigning} />
  } else if (!session && !sample) {
    title = intent.kind === 'open' ? words.openTitle(intent.side, market.symbol) : market.symbol
    body = <View className="h-2" />
    footer = wallet.address ? (
      <SheetAction title={buyWords.signIn} loading={wallet.signingIn} onPress={() => void wallet.signIn()} />
    ) : (
      <SheetAction title={buyWords.connect} loading={wallet.busy === 'connect'} onPress={() => void wallet.connect()} />
    )
  } else if (phase.kind === 'review') {
    title = words.check
    back =
      intent.kind === 'close'
        ? () => backTo({ kind: 'position', position: intent.position })
        : intent.kind === 'cancel'
          ? close
          : leave
    body = <ReviewBody review={phase.review} receivedAt={phase.receivedAt} signer={phase.body.owner} words={words} />
    footer = <ConfirmAction renewing={renewing} onPress={() => void press(phase)} words={words} />
  } else if (intent.kind === 'open') {
    title = words.openTitle(draft.side, market.symbol)
    const ticket = units
      ? ticketOf({
          market,
          units,
          draft,
          leverage,
          account: mine,
          states,
          book: freshBook,
          heldUnits,
          positionsValueUsd,
        })
      : null
    const setLeverage = (next: number) => {
      const value = clampLeverage(next, market.maxLeverage)
      if (value === leverage) return
      writePreference(leverageKey(market.symbol), String(value))
      setPicked({ symbol: market.symbol, value })
      setFailure(null)
      /* A new leverage keeps the share the slider set, at the new most. */
      if (units && draft.percent !== null) {
        const at = ticketOf({
          market,
          units,
          draft,
          leverage: value,
          account: mine,
          states,
          book: freshBook,
          heldUnits,
          positionsValueUsd,
        })
        setDraft({
          ...draft,
          size: fieldText(sizeAtPercent(draft.percent, at.maxUsd, at.countPrice, draft.unit, units), locale),
        })
      }
    }
    const setSide = (next: PerpSide) => {
      setFailure(null)
      setDraft({ ...draft, side: next })
      onIntent({ kind: 'open', side: next })
    }
    /* Nothing to review yet: a line under the size says what the press waits for — never a grey button alone (C4e). */
    const waiting =
      ticket && ticket.order === null && ticket.block === null && !noAccount
        ? draft.type === 'limit' && draft.price.trim() === '' && !draft.reduceOnly
          ? words.priceHint
          : draft.size.trim() === ''
            ? !(ticket.maxUsd !== null && ticket.maxUsd > 0)
              ? words.sizeOnlyHint
              : words.sizeHint
            : null
        : null
    body =
      units && ticket ? (
        <TicketBody
          market={market}
          units={units}
          draft={draft}
          onDraft={(next) => {
            setFailure(null)
            setDraft(next)
          }}
          onSide={setSide}
          leverage={leverage}
          onLeverage={setLeverage}
          figures={ticket}
          markAt={markAt}
          heldUnits={heldUnits}
          builder={states.builder}
          builderBps={states.builderBps}
          canaryUsd={states.open ? states.maxNotionalUsd : null}
          noAccount={noAccount}
          onDeposit={onDeposit}
          hint={waiting}
          busy={busy}
          words={words}
          locale={locale}
        />
      ) : (
        <>
          <Txt variant="ui" tone="muted">
            {words.gated}
          </Txt>
        </>
      )
    const order = ticket?.order ?? null
    const block = ticket?.block ?? null
    // Collateral is what is short — the draft's own block, or Phoenix's answer to the Review: «Поповнити» beside it.
    const short = block !== null ? wantsDeposit(block) : failure === 'MARGIN_SHORT'
    footer = (
      <View className="gap-2">
        {block ? <PoolLine text={words.perpBlocks[block]} /> : null}
        {short && onDeposit ? (
          <Button
            title={words.deposit}
            variant="secondary"
            onPress={() => {
              // Collateral moved in answers the refusal: the next Review asks Phoenix again.
              setFailure(null)
              onDeposit()
            }}
          />
        ) : null}
        <SheetAction
          title={busy ? words.preparing : draft.reduceOnly ? words.reviewReduce : words.review(draft.side)}
          loading={busy}
          disabled={busy || order === null || noAccount}
          onPress={() => order && owner && void review(perpOrderBody(order, owner, market.symbol))}
        />
      </View>
    )
  } else if (intent.kind === 'position') {
    const position = intent.position
    title = words.positionTitle(position.side, sizeOrDash(position.size, locale), position.symbol)
    const legs =
      position.tpPrice !== null || position.slPrice !== null
        ? words.nowLegs(formatPrice(position.tpPrice, locale), formatPrice(position.slPrice, locale))
        : null
    body = actsOn(position) ? (
      <>
        {legs ? (
          <Txt variant="ui" tone="faint">
            {legs}
          </Txt>
        ) : null}
        <View className="gap-2">
          <Button
            title={words.tpsl}
            variant="secondary"
            size="lg"
            disabled={busy}
            onPress={() => onIntent({ kind: 'protect', position })}
          />
          <Button
            title={words.cut}
            variant="secondary"
            size="lg"
            disabled={busy}
            onPress={() => onIntent({ kind: 'reduce', position })}
          />
          <Button
            disabled={busy}
            title={words.close}
            variant="secondary"
            size="lg"
            onPress={() => {
              // A close has nothing to set: straight to its «Перевірка».
              onIntent({ kind: 'close', position })
              if (owner) void review(closeBody(owner, position))
            }}
          />
        </View>
      </>
    ) : (
      <Txt variant="ui" tone="muted">
        {words.isolatedHere}
      </Txt>
    )
  } else if (intent.kind === 'reduce') {
    const position = intent.position
    title = words.cutTitle(position.side, position.symbol)
    back = () => backTo({ kind: 'position', position })
    const lots = units && position.size !== null ? shareLots(position.size, Number(cutShare), units) : null
    body = (
      <>
        <Txt variant="ui" tone="muted">
          {words.cutShare(sizeOrDash(position.size, locale), position.symbol)}
        </Txt>
        <ChoiceChips
          choices={CUT_SHARES.map((share) => ({
            value: String(share),
            label: `${share}${locale === 'uk' ? ' %' : '%'}`,
          }))}
          value={cutShare}
          onChange={setCutShare}
          role="radiogroup"
          tall
          disabled={busy}
        />
      </>
    )
    footer = (
      <SheetAction
        title={busy ? words.preparing : words.cut}
        loading={busy}
        disabled={busy || lots === null}
        onPress={() =>
          lots !== null &&
          owner &&
          void review({ kind: 'reduce', owner, symbol: position.symbol, size: lots.toString() })
        }
      />
    )
  } else if (intent.kind === 'protect') {
    const position = intent.position
    title = words.protectTitle(position.side, position.symbol)
    back = () => backTo({ kind: 'position', position })
    const legs = units ? legTicks(position.side, tp, sl, units) : null
    const invalid = !legs || legs.tp === undefined || legs.sl === undefined
    body = (
      <>
        <LegFields tp={tp} sl={sl} onTp={setTp} onSl={setSl} editable={!busy} words={words} />
        <Txt variant="labelSm" tone="faint">
          {`${words.protectLine} ${stopSlipText(words, locale)}`}
        </Txt>
      </>
    )
    footer = (
      <SheetAction
        title={busy ? words.preparing : words.tpsl}
        loading={busy}
        disabled={busy || invalid}
        onPress={() =>
          legs &&
          !invalid &&
          owner &&
          void review({
            kind: 'protect',
            owner,
            symbol: position.symbol,
            tp: legs.tp === null ? null : legs.tp!.toString(),
            sl: legs.sl === null ? null : legs.sl!.toString(),
          })
        }
      />
    )
  } else {
    // A close (its «Перевірка» on its way, or refused) or a cancel of one resting order: one press to its «Перевірка».
    title = intent.kind === 'close' ? words.close : words.cancelOrder
    const order = intent.kind === 'cancel' ? intent.order : null
    const sequence = order?.sequence ?? null
    const asked =
      intent.kind === 'close'
        ? owner
          ? closeBody(owner, intent.position)
          : null
        : owner && order && sequence
          ? ({ kind: 'cancel', owner, symbol: order.symbol, order: sequence } as const)
          : null
    if (intent.kind === 'close') back = () => backTo({ kind: 'position', position: intent.position })
    body = (
      <>
        {intent.kind === 'close' ? (
          <Txt variant="ui" tone="muted">
            {words.positionTitle(
              intent.position.side,
              sizeOrDash(intent.position.size, locale),
              intent.position.symbol,
            )}
          </Txt>
        ) : order ? (
          <Txt variant="ui" tone="muted">
            {`${order.side === 'buy' ? words.long : words.short} ${sizeOrDash(order.size, locale)} ${order.symbol} · ${formatPrice(order.price, locale)}`}
          </Txt>
        ) : null}
      </>
    )
    footer = (
      <SheetAction
        title={busy ? words.preparing : title}
        loading={busy}
        disabled={busy || asked === null}
        onPress={() => asked && void review(asked)}
      />
    )
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => (back ?? close)()}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <SheetFrame
        title={title}
        onBack={phase.kind === 'signing' ? null : back}
        onClose={close}
        locked={phase.kind === 'signing'}
        footer={
          failureLine && phase.kind !== 'signing' ? (
            <View className="gap-2">
              {failureLine}
              {footer}
            </View>
          ) : (
            footer
          )
        }
      >
        {body}
      </SheetFrame>
    </Modal>
  )
}

/** A take profit and a stop loss in dollars, side by side; empty is «none». */
function LegFields({
  tp,
  sl,
  onTp,
  onSl,
  editable,
  words,
}: {
  tp: string
  sl: string
  onTp: (text: string) => void
  onSl: (text: string) => void
  editable: boolean
  words: OrderCopy
}) {
  return (
    <View className="gap-2">
      <NumberField
        label={words.tpField}
        value={tp}
        onChange={onTp}
        places={PRICE_PLACES}
        editable={editable}
        placeholder="—"
      />
      <NumberField
        label={words.slField}
        value={sl}
        onChange={onSl}
        places={PRICE_PLACES}
        editable={editable}
        placeholder="—"
      />
    </View>
  )
}

/**
 * The perpetual's ticket (C4c, the web's PERP-2): long or short, market or limit with the cross margin and the leverage
 * on one row, what is free, the size in USD or in the asset with its share of the most the collateral allows at that
 * leverage, reduce-only for a position here, TP/SL with each leg's result — and, before «Перевірка», what the order is:
 * the liquidation (≈), its value, the fill from the book, the margin it takes, the account's leverage after, the fees.
 * Compact rows; the why of each is behind its «?».
 */
function TicketBody({
  market,
  units,
  draft,
  onDraft,
  onSide,
  leverage,
  onLeverage,
  figures,
  markAt,
  heldUnits,
  builder,
  builderBps,
  canaryUsd,
  noAccount,
  onDeposit,
  hint = null,
  busy,
  words,
  locale,
}: {
  market: FuturesMarket
  units: PerpUnits
  draft: PerpDraft
  onDraft: (next: PerpDraft) => void
  onSide: (next: PerpSide) => void
  leverage: number
  onLeverage: (next: number) => void
  figures: TicketFigures
  markAt: number | null
  heldUnits: number
  builder: boolean
  builderBps: number | null
  /** The first check's ceiling, when the gate is a canary. */
  canaryUsd: number | null
  /** The wallet's account was read and Phoenix has none for it yet. */
  noAccount: boolean
  onDeposit?: () => void
  /** Under the size while nothing can be reviewed yet: what the press waits for. */
  hint?: string | null
  busy: boolean
  words: OrderCopy
  locale: Locale
}) {
  const [leverageOpen, setLeverageOpen] = useState(false)
  const [slippageOpen, setSlippageOpen] = useState(false)
  const set = (patch: Partial<PerpDraft>) => onDraft({ ...draft, ...patch })
  const coin = market.symbol
  const limit = draft.type === 'limit'
  const mark = market.markPrice
  const top = Math.max(1, Math.floor(market.maxLeverage ?? 1))
  const rate = (bps: number) => shareText(bps / 100, locale)
  const takerText = market.takerRate === null ? '—' : rate(market.takerRate * 10_000)
  const makerText = market.makerRate === null ? '—' : rate(market.makerRate * 10_000)
  // Ryntra's fee: none without a builder; «у Перевірці» — never «0» — when there is one and its rate was not read.
  const ryntraText = !builder ? rate(0) : builderBps === null ? words.inReview : rate(builderBps)
  const roundShare = Math.round(figures.share)
  // Collateral under one lot: no share to offer, as with no figure at all (C4f).
  const noMost = figures.maxUsd === null || !(figures.maxUsd > 0)

  const setShare = (percent: number) =>
    set({
      percent,
      size: fieldText(sizeAtPercent(percent, figures.maxUsd, figures.countPrice, draft.unit, units), locale),
    })
  /* Another unit keeps the size: what was typed in USD becomes the asset at the counted price, and back. */
  const switchUnit = (unit: SizeUnit) => {
    if (unit === draft.unit) return
    set({ unit, size: fieldText(sizeInUnit(figures.sizeUnits, figures.countPrice, unit, units), locale) })
  }

  const liquidation = figures.liquidation
  const liquidationText =
    liquidation === null
      ? figures.signed === null
        ? '—'
        : words.inReview
      : liquidation.kind === 'price'
        ? `≈ ${formatPrice(liquidation.priceUsd, locale)}`
        : liquidation.kind === 'none'
          ? words.liquidationNever
          : words.inReview
  const liquidationNear =
    liquidation?.kind === 'price' && mark !== null && Math.abs(liquidation.priceUsd - mark) / mark < 0.1
  const feesText = limit
    ? `${makerText} / ${words.feesRates(takerText, ryntraText)}`
    : figures.feesUsd !== null && figures.ryntraKnown
      ? words.feesAmount(formatAmount(figures.feesUsd, 4, locale))
      : words.feesRates(takerText, ryntraText)
  const fill = !limit && figures.fill && figures.fill !== 'thin' ? figures.fill : null

  /* A leg's result on the position at its price — on the margin Phoenix holds, its tier's leverage. */
  const legHint = (text: string, leg: 'tp' | 'sl') => {
    const value = decimalInput(text)
    if (value === null || figures.sizeUnits === null || figures.fillUsd === null) return null
    const result = legResult(draft.side, figures.fillUsd, Number(value), figures.sizeUnits, figures.tier ?? leverage)
    return (
      <Txt variant="ui" tone={leg === 'tp' ? 'success' : 'danger'}>
        {words.legResult(
          `≈ ${formatUsdSigned(result.usd, locale)}`,
          `${result.percent >= 0 ? '+' : '−'}${shareText(Math.abs(result.percent), locale, 1)}`,
        )}
      </Txt>
    )
  }

  const reduceShown = heldUnits !== 0 || draft.reduceOnly
  const legsShown = !limit && !draft.reduceOnly
  return (
    <>
      <ChoiceChips
        choices={[
          { value: 'long' as const, label: words.long },
          { value: 'short' as const, label: words.short },
        ]}
        value={draft.side}
        onChange={onSide}
        role="radiogroup"
        tall
        disabled={busy}
      />
      {/* Market or limit, then the margin mode and the leverage — what every perpetual's ticket opens with. */}
      <View className="flex-row items-center justify-between gap-2">
        <ChoiceChips
          choices={[
            { value: 'market' as const, label: words.market },
            { value: 'limit' as const, label: words.limit },
          ]}
          value={draft.type}
          onChange={(type) =>
            set({
              type,
              percent: null,
              ...(type === 'limit' && draft.price === '' ? { price: fieldOf(mark, locale) } : {}),
            })
          }
          role="radiogroup"
          size="sm"
          tall
          disabled={busy}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: leverageOpen, disabled: busy }}
          accessibilityLabel={`${words.cross}, ${words.leverage} ${leverage}×`}
          disabled={busy}
          onPress={() => setLeverageOpen((open) => !open)}
          className="min-h-11 flex-row items-center gap-1.5 rounded-pill border border-line px-3 active:bg-hover"
        >
          <Txt variant="ui" tone="muted">
            {words.cross}
          </Txt>
          <Txt variant="data">{`${leverage}×`}</Txt>
          <Icon name={leverageOpen ? 'chevron-up' : 'chevron-down'} size={16} color="fgMuted" />
        </Pressable>
      </View>
      {leverageOpen ? (
        <Card className="gap-3">
          <View className="flex-row items-center justify-between gap-3">
            <View className="shrink flex-row items-center gap-1">
              <Txt variant="ui" className="shrink">
                {words.leverageTitle(coin)}
              </Txt>
              <HelpDot
                title={words.leverage}
                body={[words.leverageHelp(formatAmount(market.maxLeverage, 0, locale)), words.crossHelp]}
                size={16}
              />
            </View>
            <Txt variant="dataLg">{`${leverage}×`}</Txt>
          </View>
          <Slider
            value={leverage}
            min={1}
            max={top}
            onChange={onLeverage}
            label={words.leverage}
            valueText={`${leverage}×`}
            disabled={busy || top <= 1}
          />
          <ChoiceChips
            choices={leverageSteps(market.maxLeverage).map((step) => ({ value: String(step), label: `${step}×` }))}
            value={String(leverage)}
            onChange={(value) => onLeverage(Number(value))}
            role="radiogroup"
            size="sm"
            tall
            disabled={busy}
          />
          <Button title={words.leverageDone} variant="secondary" onPress={() => setLeverageOpen(false)} />
        </Card>
      ) : null}

      <View className="flex-row items-center gap-1">
        <Txt variant="ui" tone="muted" className="shrink">
          {words.available(figures.free === null ? '—' : `${formatAmount(figures.free, 2, locale, 2)} USDC`)}
        </Txt>
        <HelpDot title={words.availableTitle} body={words.availableHelp} size={16} />
      </View>
      {noAccount ? (
        <View className="gap-2">
          <Txt variant="ui" tone="muted">
            {words.noAccount}
          </Txt>
        </View>
      ) : null}

      {limit ? (
        <NumberField
          label={words.limitPrice}
          value={draft.price}
          onChange={(text) => set({ price: text, percent: null })}
          places={PRICE_PLACES}
          editable={!busy}
          right={
            mark !== null ? (
              <Button
                title={words.markAt(
                  formatPrice(mark, locale),
                  markAt ? formatClock(new Date(markAt).toISOString()) : '—',
                )}
                variant="ghost"
                size="sm"
                hitSlop={6}
                disabled={busy}
                onPress={() => set({ price: fieldOf(mark, locale), percent: null })}
              />
            ) : null
          }
        />
      ) : null}
      <NumberField
        label={words.size}
        value={draft.size}
        onChange={(text) => set({ size: text, percent: null })}
        places={draft.unit === 'usd' ? DOLLAR_PLACES : Math.max(0, units.baseLotsDecimals)}
        editable={!busy}
        right={
          <ChoiceChips
            choices={[
              { value: 'usd' as const, label: 'USD' },
              { value: 'coin' as const, label: coin },
            ]}
            value={draft.unit}
            onChange={switchUnit}
            role="radiogroup"
            size="sm"
            quiet
            disabled={busy}
          />
        }
        under={
          <View className="gap-1">
            {figures.sizeUnits !== null ? (
              <Txt variant="ui" tone="faint">
                {words.sizeUnder(formatAmount(figures.sizeUnits, 6, locale), coin, formatUsd(figures.valueUsd, locale))}
              </Txt>
            ) : null}
            <View className="flex-row items-center gap-3">
              <View className="flex-1">
                <Slider
                  value={roundShare}
                  min={0}
                  max={100}
                  onChange={setShare}
                  label={`${words.size}, %`}
                  valueText={shareText(roundShare, locale, 0)}
                  disabled={busy || noMost}
                />
              </View>
              <Txt variant="data" tone="muted" className="w-12 text-right">
                {noMost ? '—' : shareText(roundShare, locale, 0)}
              </Txt>
            </View>
            <ChoiceChips
              choices={PERP_SHARES.map((share) => ({
                value: String(share),
                label: share === 100 ? words.max : shareText(share, locale, 0),
              }))}
              value={draft.percent === null ? '' : String(draft.percent)}
              onChange={(value) => setShare(Number(value))}
              role="radiogroup"
              size="sm"
              fill
              tall
              disabled={busy || noMost}
            />
            {hint ? (
              <Txt variant="ui" tone="faint" className="pt-1">
                {hint}
              </Txt>
            ) : null}
          </View>
        }
      />

      {reduceShown || legsShown ? (
        <Card padded={false}>
          <View className="px-4">
            {reduceShown ? (
              <ToggleRow
                label={words.reduceOnly}
                value={draft.reduceOnly}
                onChange={(on) =>
                  // Reduce-only goes against the position held: the side turns to the one that cuts it.
                  set({
                    reduceOnly: on,
                    percent: null,
                    ...(on ? { tpsl: false, side: heldUnits > 0 ? ('short' as const) : ('long' as const) } : {}),
                  })
                }
                last={!legsShown}
              />
            ) : null}
            {legsShown ? (
              <ToggleRow label={words.tpsl} value={draft.tpsl} onChange={(on) => set({ tpsl: on })} last />
            ) : null}
          </View>
          {legsShown && draft.tpsl ? (
            <View className="gap-2 border-t border-line px-4 pb-3 pt-2">
              <NumberField
                label={words.tpField}
                value={draft.tp}
                onChange={(text) => set({ tp: text })}
                places={PRICE_PLACES}
                editable={!busy}
                placeholder="—"
                under={legHint(draft.tp, 'tp')}
              />
              <NumberField
                label={words.slField}
                value={draft.sl}
                onChange={(text) => set({ sl: text })}
                places={PRICE_PLACES}
                editable={!busy}
                placeholder="—"
                under={legHint(draft.sl, 'sl')}
              />
              <Txt variant="labelSm" tone="faint">
                {`${words.legsLine} ${stopSlipText(words, locale)}`}
              </Txt>
            </View>
          ) : null}
        </Card>
      ) : null}

      <Card level="elevated" padded={false}>
        <View className="px-4">
          <SummaryRow
            label={words.liquidation}
            help={words.liquidationHelp}
            value={liquidationText}
            tone={liquidationNear ? 'danger' : undefined}
          />
          <SummaryRow
            label={words.orderValue}
            value={figures.valueUsd === null ? '—' : `${limit ? '' : '≈ '}${formatUsd(figures.valueUsd, locale)}`}
          />
          {fill ? <SummaryRow label={words.bookFill} value={`≈ ${formatPrice(fill.averageUsd, locale)}`} /> : null}
          {!figures.reduces ? (
            <SummaryRow
              label={words.margin}
              help={words.marginHelp}
              value={figures.marginUsd === null ? '—' : `≈ ${formatUsd(figures.marginUsd, locale)}`}
            />
          ) : null}
          <SummaryRow
            label={words.accountLeverage}
            value={figures.leverageAfter === null ? '—' : `${formatAmount(figures.leverageAfter, 2, locale)}×`}
          />
          <SummaryRow
            label={words.feesLabel}
            help={
              limit
                ? words.feesLimitHelp(makerText, takerText, ryntraText)
                : words.feesMarketHelp(takerText, ryntraText)
            }
            value={feesText}
            last={limit}
          />
          {!limit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: slippageOpen }}
              accessibilityLabel={`${words.rows.slippage} ${rate(draft.slippageBps)}`}
              onPress={() => setSlippageOpen((open) => !open)}
              className="min-h-11 flex-row items-center justify-between gap-3 active:opacity-70"
            >
              <Txt variant="ui" tone="muted">
                {words.rows.slippage}
              </Txt>
              <View className="flex-row items-center gap-1">
                <Txt variant="data">{rate(draft.slippageBps)}</Txt>
                <Icon name={slippageOpen ? 'chevron-up' : 'chevron-down'} size={16} color="fgMuted" />
              </View>
            </Pressable>
          ) : null}
        </View>
        {!limit && slippageOpen ? (
          <View className="border-t border-line px-4 pb-3 pt-2">
            <ChoiceChips
              choices={PERP_SLIPPAGES.map((bps) => ({ value: String(bps), label: rate(bps) }))}
              value={String(draft.slippageBps)}
              onChange={(value) => set({ slippageBps: Number(value), percent: null })}
              role="radiogroup"
              size="sm"
              fill
              tall
              disabled={busy}
            />
          </View>
        ) : null}
      </Card>
      <Txt variant="labelSm" tone="faint">
        {words.markAt(formatPrice(mark, locale), markAt ? formatClock(new Date(markAt).toISOString()) : '—')}
      </Txt>

      {canaryUsd !== null ? (
        <Txt variant="ui" tone="faint">
          {words.canary(formatUsd(canaryUsd, locale))}
        </Txt>
      ) : null}
    </>
  )
}

/** One figure of the ticket's summary: its label (with its «?» where it needs one) and its value. */
function SummaryRow({
  label,
  value,
  help,
  tone,
  last = false,
}: {
  label: string
  value: string
  help?: string
  tone?: 'danger'
  last?: boolean
}) {
  return (
    <View
      className={`min-h-11 flex-row items-center justify-between gap-3 py-1.5 ${last ? '' : 'border-b border-line'}`}
    >
      <View className="shrink flex-row items-center gap-1">
        <Txt variant="ui" tone="muted" className="shrink">
          {label}
        </Txt>
        {help ? <HelpDot title={label} body={help} size={16} /> : null}
      </View>
      <Txt variant="data" tone={tone ?? 'fg'} className="max-w-[60%] text-right">
        {value}
      </Txt>
    </View>
  )
}

/**
 * A slider of whole steps — the leverage, the share of the most: dragged or tapped along its track, stepped by the
 * screen reader's increment and decrement. The value is the parent's; the slider only says where the finger is.
 */
function Slider({
  value,
  min,
  max,
  onChange,
  label,
  valueText,
  disabled = false,
}: {
  value: number
  min: number
  max: number
  onChange: (next: number) => void
  label: string
  valueText: string
  disabled?: boolean
}) {
  const THUMB = 20
  const [width, setWidth] = useState(0)
  // Where the finger came down, along the track and on the screen: a drag is counted from there.
  const touch = useRef({ x: 0, page: 0 })
  const pick = (x: number) => {
    if (disabled || width <= THUMB) return
    const share = Math.min(1, Math.max(0, (x - THUMB / 2) / (width - THUMB)))
    const next = Math.round(min + share * (max - min))
    if (next !== value) onChange(next)
  }
  const span = Math.max(1, max - min)
  const share = Math.min(1, Math.max(0, (value - min) / span))
  const left = share * Math.max(0, width - THUMB)
  const step = (by: number) => !disabled && onChange(Math.min(max, Math.max(min, value + by)))
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      accessibilityValue={{ min, max, now: value, text: valueText }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => step(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      className="h-11 justify-center"
      style={{ opacity: disabled ? 0.45 : 1 }}
      // The track holds the finger once it moves along it: a scroll of the sheet does not take it away mid-drag.
      onStartShouldSetResponder={() => !disabled}
      onMoveShouldSetResponder={() => !disabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        touch.current = { x: event.nativeEvent.locationX, page: event.nativeEvent.pageX }
        pick(touch.current.x)
      }}
      onResponderMove={(event) => pick(touch.current.x + event.nativeEvent.pageX - touch.current.page)}
    >
      <View pointerEvents="none" className="h-1.5 rounded-pill bg-track" />
      <View
        pointerEvents="none"
        className="absolute h-1.5 rounded-pill bg-brand"
        style={{ left: 0, width: left + THUMB / 2 }}
      />
      <View
        pointerEvents="none"
        className="absolute rounded-pill border-2 border-surface bg-brand"
        style={{ left, width: THUMB, height: THUMB }}
      />
    </View>
  )
}

/** «Перевірка» of an order, from the server's answer alone: what was built and simulated is what is shown. */
export function ReviewBody({
  review,
  receivedAt,
  signer,
  words,
  failure,
}: {
  review: OrderReview
  receivedAt: number | null
  signer: string
  words: OrderCopy
  failure?: ReactNode
}) {
  const locale = useLocale()
  const sheet = useCopy(SHEET_COPY)
  const [details, setDetails] = useState(false)
  const view = reviewView(review, words, locale)
  // Leverage and liquidation speak to an order that trades; TP/SL and a cancel only have the bytes' life.
  const risk = review.kind === 'open' || review.kind === 'reduce' ? words.risk : words.valid
  return (
    <>
      <View className="flex-row items-start gap-1">
        <Txt variant="title" className="shrink">
          {view.title}
        </Txt>
        <HelpDot
          title={words.whatIs}
          body={review.rentLamports > 0n ? [view.what, words.rentNote, risk] : [view.what, risk]}
        />
      </View>
      <Card className="gap-3">
        <View className="gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {words.pay}
          </Txt>
          <Txt variant="data">{view.pay}</Txt>
        </View>
        <View className="gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {words.get}
          </Txt>
          <Txt variant="title">{view.get}</Txt>
        </View>
      </Card>
      <Rows rows={view.rows} />
      <Rows rows={[...view.costs, { label: sheet.allCosts, value: view.total }]} emphasisLast />
      <Txt variant="labelSm" tone="faint">
        {risk}
      </Txt>
      {receivedAt !== null ? <Countdown review={review} receivedAt={receivedAt} /> : null}
      <Card padded={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: details }}
          accessibilityLabel={words.details}
          onPress={() => setDetails((open) => !open)}
          className="min-h-12 flex-row items-center justify-between px-4 active:bg-hover"
        >
          <Txt variant="ui" tone="muted">
            {words.details}
          </Txt>
          <Icon name={details ? 'chevron-up' : 'chevron-down'} size={18} color="fgMuted" />
        </Pressable>
        {details ? (
          <View className="gap-2 border-t border-line px-4 pb-3 pt-2">
            <Detail label={words.traderAccount} value={shortAddress(review.traderAccount, 6)} />
            <Detail label={words.program} value={shortAddress('EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih', 6)} />
            <Detail label={words.wallet} value={shortAddress(signer, 6)} />
          </View>
        ) : null}
      </Card>
      {failure}
    </>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Txt variant="ui" tone="faint">
        {label}
      </Txt>
      <Txt variant="data" tone="muted">
        {value}
      </Txt>
    </View>
  )
}

/** How long the bytes may still be signed: «Ціна дійсна ще 0:22», then out of date. */
function Countdown({ review, receivedAt }: { review: OrderReview; receivedAt: number }) {
  const sheet = useCopy(SHEET_COPY)
  const now = useNow(1000)
  const left = Math.max(0, Math.ceil((receivedAt + signableMsOf(review.signableMs) - now) / 1000))
  return (
    <ValidFor text={left > 0 ? sheet.validFor(`0:${String(left).padStart(2, '0')}`) : sheet.stale} stale={left === 0} />
  )
}

/** «Підтвердити в гаманці» — one press even when the bytes aged: they are built again first, and the wallet opens by itself. */
function ConfirmAction({ renewing, onPress, words }: { renewing: boolean; onPress: () => void; words: OrderCopy }) {
  const sheet = useCopy(SHEET_COPY)
  return (
    <SheetAction
      title={renewing ? sheet.renewingThenWallet : words.confirm}
      loading={renewing}
      disabled={renewing}
      onPress={onPress}
    />
  )
}

/**
 * The receipt, for a result the sheet follows on the chain: what Phoenix filled once the transaction landed; waiting
 * while the chain has not said; failed otherwise.
 */
export function ReceiptView({
  review,
  result,
  at,
  words,
  locale,
  following = false,
}: {
  review: OrderReview
  result: OrderResult
  at: number
  words: OrderCopy
  locale: Locale
  /** The sheet still asks the chain: two minutes from the relay, then the explorer is the way to see it. */
  following?: boolean
}) {
  const now = useNow(5_000)
  const stillFollowing = following && now - at < ORDER_FOLLOW_MS
  const view = receiptView(review, result, words, locale, stillFollowing)
  const time = formatClock(new Date(at).toISOString())
  return (
    <>
      <DoneBody
        tone={view.status}
        title={view.title}
        big={view.fill}
        line={view.line ?? `${words.network} · ${time}`}
        note={view.note}
        onReceipt={null}
      />
      {view.line ? (
        <Txt variant="ui" tone="faint" className="text-center">
          {`${words.network} · ${time}`}
        </Txt>
      ) : null}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={words.explorer}
        onPress={() => openLink(explorerUrl(result.signature))}
        className="min-h-12 flex-row items-center justify-between border-t border-line pt-3 active:opacity-70"
      >
        <Txt variant="ui" tone="muted">
          {words.explorer}
        </Txt>
        <Icon name="open-outline" size={16} color="fgMuted" />
      </Pressable>
    </>
  )
}

/** «Новий ордер» once the network answered (or two minutes passed); «Готово» closes the sheet. */
function DoneFooter({
  at,
  result,
  words,
  onAgain,
  onClose,
}: {
  at: number
  result: OrderResult
  words: OrderCopy
  onAgain: () => void
  onClose: () => void
}) {
  const sheet = useCopy(SHEET_COPY)
  const now = useNow(1000)
  const waiting = result.state === 'UNKNOWN' && now - at < ORDER_FOLLOW_MS
  return (
    <>
      {waiting ? (
        <Txt variant="labelSm" tone="faint" className="text-center">
          {words.againWait}
        </Txt>
      ) : null}
      <View className="flex-row gap-3">
        <Button
          title={words.again}
          variant="secondary"
          size="lg"
          className="flex-1"
          disabled={waiting}
          onPress={onAgain}
        />
        <Button title={sheet.finish} size="lg" className="flex-1" onPress={onClose} />
      </View>
    </>
  )
}
