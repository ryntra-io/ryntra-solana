import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal, Pressable, TextInput, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import {
  COLLATERAL_FOLLOW_EVERY_MS,
  COLLATERAL_FOLLOW_MS,
  collateralApi,
  followCollateral,
  readCollateralMargin,
  readCollateralStates,
  reviewCollateral,
  signAndRelayCollateral,
  type CollateralBody,
  type CollateralOutcome,
  type CollateralReviewed,
} from '@/features/futures/collateral-api'
import { COLLATERAL_COPY, type CollateralCopy } from '@/features/futures/collateral-copy'
import {
  amountBlock,
  COLLATERAL_CLOSED,
  depositWay,
  collateralChips,
  collateralReceiptView,
  collateralReviewView,
  fieldFromMicro,
  heldLine,
  microFromText,
  microText,
  MIN_COLLATERAL_MICRO,
  sameMoveNoWorse,
  topOf,
  unsettled,
  withdrawableOf,
  type CollateralAction,
  type CollateralFailure,
  type CollateralResult,
  type CollateralReview,
  type DepositWay,
} from '@/features/futures/collateral-model'
import type { FuturesAccount } from '@/features/futures/futures-model'
import { freeCollateralUsd } from '@/features/futures/perp-order-model'
import type { ViewRow } from '@/features/futures/order-view'
import { explorerUrl } from '@/features/history/history-model'
import { BUY_COPY } from '@/features/invest/buy-copy'
import { useAccount } from '@/features/session/use-account'
import { DOLLAR_PLACES, typedField } from '@/features/trade/keypad-model'
import { SHEET_COPY } from '@/features/trade/sheet-copy'
import { groupedField } from '@/features/trade/trade-model'
import { mayOpenWallet, signableMsOf } from '@/features/wallet/bytes-life'
import { useWallet } from '@/features/wallet/use-wallet'
import { walletCancel, type WalletCancel } from '@/features/wallet/wallet-wait'
import { useNow } from '@/hooks/use-now'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'
import { USDC_MINT, type Session } from '@/lib/api'
import { openLink } from '@/lib/open-link'
import { type, useTheme } from '@/theme'
import { formatAmount, formatClock, shortAddress } from '@/utils/format'

import { DoneBody, PoolLine, SheetAction, SheetFrame, ValidFor, WaitBody } from '../trade/sheet-parts'

/* A Review, its signature and its receipt belong to the wallet they were built for, whatever is connected later. */
type Phase =
  | Readonly<{ kind: 'edit' }>
  | Readonly<{ kind: 'reviewing' }>
  | Readonly<{ kind: 'review'; review: CollateralReview; body: CollateralBody; receivedAt: number }>
  | Readonly<{ kind: 'signing'; review: CollateralReview; body: CollateralBody; receivedAt: number }>
  | Readonly<{ kind: 'done'; review: CollateralReview; result: CollateralResult; at: number }>

/** The phone's clock, read in a press's handler — never while drawing. */
const clock = () => Date.now()

/** No receipt to follow: a settled stand-in, so the hook asks nothing. */
const SETTLED: CollateralResult = { signature: '', state: 'LANDED', usdcMoved: 0n }

/** Phoenix's perps program, the one the Review's bytes call. */
const PHOENIX_PROGRAM = 'EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih'

const timeOf = (ms: number | null | undefined) => (ms ? formatClock(new Date(ms).toISOString()) : null)

/* ------------------------------------------------------------------- hooks */

/**
 * Whether this wallet may move collateral now and the USDC it holds, by the server's gate — closed until it says
 * otherwise. Only a word for the screen: every Review and every relay asks the gate again on the server.
 */
export function useCollateralStates(owner: string | null, enabled = true) {
  const states = useQuery({
    queryKey: ['futures', 'collateral', 'states', owner],
    queryFn: ({ signal }) => readCollateralStates(collateralApi, owner, signal),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
    enabled: enabled && owner !== null,
  })
  return { states: states.data ?? COLLATERAL_CLOSED, read: states.data !== undefined, at: states.dataUpdatedAt }
}

/**
 * What the account may withdraw now, read afresh while the sheet is open — Phoenix's own figure. Under the account's
 * key, so the account's refresh after a move refreshes it too.
 */
function useCollateralMargin(owner: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['futures', 'account', owner, 'collateral'],
    queryFn: ({ signal }) => readCollateralMargin(collateralApi, owner ?? '', signal),
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 1,
    enabled: enabled && owner !== null,
  })
}

/**
 * The wallet's acts on a move: ask for the Review, then sign it and relay it — one signature, one relay; the account and
 * the gate's figures are read again after a relay, whatever the answer. A second press before the first re-renders
 * opens no second wallet prompt.
 */
function useCollateralActions(session: Session | null) {
  const wallet = useWallet()
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  const waiting = useRef<WalletCancel | null>(null)

  const review = useCallback(
    async (body: CollateralBody): Promise<CollateralReviewed> => {
      if (!session) return { ok: false, reason: 'signIn' }
      return reviewCollateral(collateralApi, session, body)
    },
    [session],
  )

  const sign = useCallback(
    async (
      reviewed: CollateralReview,
      receivedAt: number,
      onSigned?: () => void,
    ): Promise<CollateralOutcome | null> => {
      if (!session) return { kind: 'refused', reason: 'signIn', afterSignature: false }
      if (inFlight.current) return null
      inFlight.current = true
      const cancel = walletCancel()
      waiting.current = cancel
      try {
        return await signAndRelayCollateral({
          api: collateralApi,
          wallet: { signTransaction: wallet.signTransaction },
          session,
          review: reviewed,
          receivedAt,
          wait: { cancel, onSigned },
        })
      } finally {
        if (waiting.current === cancel) waiting.current = null
        inFlight.current = false
        void queryClient.invalidateQueries({ queryKey: ['futures', 'account'] })
        void queryClient.invalidateQueries({ queryKey: ['futures', 'collateral'] })
      }
    },
    [session, wallet.signTransaction, queryClient],
  )

  /** «Скасувати» while the wallet is asked: back to the Review, nothing relayed. */
  const cancelSigning = useCallback(() => waiting.current?.cancel(), [])

  return { review, sign, cancelSigning }
}

/**
 * A relayed move as the chain sees it: the relay's answer, then the chain's word every few seconds for two minutes,
 * while it has not said how it ended or — landed — the USDC it moved. Once it settles, the account and the wallet's
 * USDC are read again.
 */
function useFollowedCollateral(result: CollateralResult): CollateralResult {
  const queryClient = useQueryClient()
  const [current, setCurrent] = useState(result)
  // A new relay starts its receipt from its own answer (state adjusted during render, as React prescribes).
  const [base, setBase] = useState(result)
  if (base !== result) {
    setBase(result)
    setCurrent(result)
  }
  useEffect(() => {
    if (!unsettled(result)) return
    let live = true
    const started = Date.now()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    let seen = result
    const tick = async () => {
      seen = await followCollateral(collateralApi, seen, controller.signal)
      if (!live) return
      setCurrent(seen)
      if (!unsettled(seen)) {
        void queryClient.invalidateQueries({ queryKey: ['futures', 'account'] })
        void queryClient.invalidateQueries({ queryKey: ['futures', 'collateral'] })
        return
      }
      if (Date.now() - started < COLLATERAL_FOLLOW_MS) timer = setTimeout(() => void tick(), COLLATERAL_FOLLOW_EVERY_MS)
    }
    timer = setTimeout(() => void tick(), COLLATERAL_FOLLOW_EVERY_MS)
    return () => {
      live = false
      controller.abort()
      if (timer !== null) clearTimeout(timer)
    }
  }, [result, queryClient])
  return current
}

/* ------------------------------------------------------------------- sheet */

/**
 * «Поповнити» and «Вивести» of Perps on the phone (C4c) — the web's collateral panel of B6: USDC from the person's own
 * wallet into their Phoenix account and back, each through one «Перевірка» the server built and simulated — what
 * leaves, what arrives, Phoenix's collateral after, the network's fee — and one signature of that wallet, ending in a
 * receipt with the USDC the chain moved. Phoenix's program holds the collateral, never Ryntra, and no fee of Ryntra's
 * is added. Whether moves are open is the server's word alone: closed, the sheet says so and reviews nothing.
 */
export function CollateralSheet({
  owner,
  action,
  account,
  onClose,
  onDone,
  onTrade,
  onLeave,
}: {
  /** The wallet whose collateral moves; null — nothing to move, the sheet asks for a wallet. */
  owner: string | null
  /** Which move the sheet makes; null — closed. */
  action: CollateralAction | null
  /** The account as the page read it: its margin's figure of what may leave, until the sheet's own read arrives. */
  account: FuturesAccount | null
  onClose: () => void
  /** Told once a move landed on the chain — the page reads its account again. */
  onDone?: (result: CollateralResult) => void
  /**
   * The way to a trade where the deposit cannot go on and Phoenix already holds free collateral (C4e): the page opens a
   * ticket. Given only outside a ticket and for an account that trades; without it the sheet offers USDC for the wallet.
   */
  onTrade?: () => void
  /** Told before the sheet leaves for another screen (USDC for the wallet): the page closes what would stand over it. */
  onLeave?: () => void
}) {
  const words = useCopy(COLLATERAL_COPY)
  const buyWords = useCopy(BUY_COPY)
  const locale = useLocale()
  const { colors } = useTheme()
  const wallet = useAccount()
  const router = useRouter()
  const session = wallet.session && owner !== null && wallet.session.address === owner ? wallet.session : null
  const shown = action !== null
  const gate = useCollateralStates(owner, shown)
  const margin = useCollateralMargin(owner, shown)
  const actions = useCollateralActions(session)
  const mark: ',' | '.' = locale === 'uk' ? ',' : '.'

  const [phase, setPhase] = useState<Phase>({ kind: 'edit' })
  const [failure, setFailure] = useState<CollateralFailure | null>(null)
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  // The Review's bytes are being built again under it (AG-2b): its button waits.
  const [renewing, setRenewing] = useState(false)
  // Late wallet answers in a row: the first builds the Review again by itself, the second tells the person.
  const lateInARow = useRef(0)
  // A press under way — its «Перевірка» built again or its wallet open.
  const pressing = useRef(false)
  // Bumped whenever the person leaves a step: an answer that comes back after it opens nothing.
  const attempt = useRef(0)

  // Another move — or the sheet opened again — starts from its own empty field; a receipt on screen stays.
  const [seen, setSeen] = useState<CollateralAction | null>(null)
  if (seen !== action) {
    setSeen(action)
    if (phase.kind !== 'done' || action === null) {
      setPhase({ kind: 'edit' })
      setFailure(null)
      setText('')
    }
  }

  /*
   * The deposit's way on (C4e), known before drawing so the field lets go of the keyboard once a wallet short of USDC is
   * read: the lines and the buttons that lead on must not sit under the keys.
   */
  const freeUsd = freeCollateralUsd(account?.margin)
  const way: DepositWay =
    action === 'deposit'
      ? depositWay({
          walletUsdc: gate.states.walletUsdc,
          open: gate.read && gate.states.deposit && !(margin.data != null && !margin.data.canDeposit),
          freeUsd,
          toTrade: onTrade !== undefined,
        })
      : 'review'
  const short = way !== 'review'
  const field = useRef<TextInput>(null)
  useEffect(() => {
    if (short) field.current?.blur()
  }, [short])
  // One way out per opening: a second tap before the sheet is gone never opens a second screen.
  const leaving = useRef(false)
  useEffect(() => {
    leaving.current = false
  }, [action])

  /* The receipt follows its signature on the chain; the footer's «Нова дія» waits for the same answer. */
  const done = phase.kind === 'done' ? phase : null
  const followed = useFollowedCollateral(done?.result ?? SETTLED)
  const told = useRef<string | null>(null)
  useEffect(() => {
    if (!done || followed.signature !== done.result.signature || followed.state !== 'LANDED') return
    if (told.current === followed.signature) return
    told.current = followed.signature
    onDone?.(followed)
  }, [done, followed, onDone])

  async function review(body: CollateralBody, note: CollateralFailure | null = null) {
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

  /* One press at a time: a second tap before the first re-renders neither opens a second wallet nor drops a receipt. */
  async function press(current: Extract<Phase, { kind: 'review' }>) {
    if (pressing.current) return
    pressing.current = true
    try {
      await sign(current)
    } finally {
      pressing.current = false
    }
  }

  /*
   * AG-2b, one press: bytes that aged before the wallet opened are built again under the Review (its button waits), and
   * the wallet opens on the fresh ones at once while the move is the one on screen and no worse; otherwise the fresh
   * «Перевірка» is shown with its note. Built again once per press — bytes too short even then are said, never chased.
   */
  async function sign(current: Extract<Phase, { kind: 'review' }>, rebuilt = false) {
    if (
      !mayOpenWallet({
        receivedAtMs: current.receivedAt,
        signableMs: signableMsOf(current.review.signableMs),
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
      const fresh = await actions.review(current.body)
      if (mine !== attempt.current) return
      setRenewing(false)
      if (!fresh.ok) {
        setFailure(fresh.reason)
        setPhase({ kind: 'edit' })
        return
      }
      const next = { kind: 'review' as const, review: fresh.review, body: current.body, receivedAt: fresh.receivedAt }
      setPhase(next)
      if (!sameMoveNoWorse(current.review, fresh.review)) {
        setFailure('reviewAged')
        return
      }
      return sign(next, true)
    }
    const mine = ++attempt.current
    setFailure(null)
    setSent(false)
    setPhase({ ...current, kind: 'signing' })
    const outcome = await actions.sign(current.review, current.receivedAt, () => setSent(true))
    if (outcome === null) {
      setPhase({ ...current, kind: 'review' })
      return
    }
    // A sent move's receipt is shown whatever happened meanwhile: it is never dropped.
    if (outcome.kind === 'sent') {
      lateInARow.current = 0
      setText('')
      setPhase({ kind: 'done', review: current.review, result: outcome.result, at: clock() })
      return
    }
    if (mine !== attempt.current) return
    // The wallet answered after the bytes could land — never relayed: built again once by itself, then said plainly.
    if (outcome.reason === 'reviewAged' && outcome.afterSignature) {
      lateInARow.current += 1
      if (lateInARow.current > 1) {
        setFailure('deviceConfirm')
        setPhase({ ...current, kind: 'review' })
        return
      }
      await review(current.body, 'reviewAged')
      return
    }
    lateInARow.current = 0
    if (outcome.reason === 'reviewAged') {
      await review(current.body, 'reviewAged')
      return
    }
    setFailure(outcome.reason)
    // A refusal the relay gave once the wallet had signed ends this «Перевірка»: the next press builds a new one.
    setPhase(outcome.afterSignature ? { kind: 'edit' } : { ...current, kind: 'review' })
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
    setText('')
    onClose()
  }

  if (!action) return null

  const move = action
  const deposit = move === 'deposit'
  const busy = phase.kind === 'reviewing'
  const failureLine = failure ? <PoolLine text={words.failures[failure]} /> : null
  let title = deposit ? words.depositTitle : words.withdrawTitle
  let back: (() => void) | null = null
  let body: ReactNode
  let footer: ReactNode = null

  /* A sent move's receipt and an open wallet come first: a session that lapses meanwhile never hides them. */
  if (phase.kind === 'done') {
    body = <CollateralReceipt review={phase.review} result={followed} at={phase.at} words={words} locale={locale} />
    footer = (
      <DoneFooter
        at={phase.at}
        result={followed}
        words={words}
        onAgain={() => {
          setFailure(null)
          setPhase({ kind: 'edit' })
        }}
        onClose={close}
      />
    )
  } else if (phase.kind === 'signing') {
    title = words.check
    body = <WaitBody sending={sent} onCancel={actions.cancelSigning} />
  } else if (!session) {
    body = (
      <Txt variant="ui" tone="muted">
        {words.failures.signIn}
      </Txt>
    )
    footer =
      wallet.address && wallet.address === owner ? (
        <SheetAction title={buyWords.signIn} loading={wallet.signingIn} onPress={() => void wallet.signIn()} />
      ) : (
        <SheetAction
          title={buyWords.connect}
          loading={wallet.busy === 'connect'}
          onPress={() => void wallet.connect()}
        />
      )
  } else if (phase.kind === 'review') {
    title = words.check
    back = leave
    body = (
      <ReviewBody
        review={phase.review}
        receivedAt={phase.receivedAt}
        signer={phase.body.owner}
        words={words}
        failure={failureLine}
      />
    )
    footer = (
      <SheetAction
        title={renewing ? words.renewing : words.confirm}
        loading={renewing}
        disabled={renewing}
        onPress={() => void press(phase)}
      />
    )
  } else {
    const states = gate.states
    const open = deposit ? states.deposit : states.withdraw
    const phoenix = margin.data ?? null
    /* What may leave: Phoenix's figure as read now, else the one the page holds. */
    const withdrawable = phoenix?.withdrawableMicro ?? withdrawableOf(account?.margin)
    const limit = deposit ? states.walletUsdc : withdrawable
    const canary = states.maxMicro
    const top = topOf(limit, canary)
    const amount = microFromText(text)
    /* A wallet short of USDC (C4e) is said once, with USDC for it in the app — never a grey button alone. */
    const typedBlock = text.trim() === '' ? null : amountBlock(move, amount, limit, canary)
    const block = short && typedBlock === 'overWallet' ? null : typedBlock
    const leaveTo = (path: Parameters<typeof router.push>[0]) => {
      if (leaving.current) return
      leaving.current = true
      close()
      onLeave?.()
      router.push(path)
    }
    const toTrade = () => {
      if (leaving.current || !onTrade) return
      leaving.current = true
      close()
      onTrade()
    }
    const freeAt = timeOf(account?.observedAt)
    const freeHeld = [`${formatAmount(freeUsd, 2, locale, 2)} USDC`, freeAt].filter(Boolean).join(' · ')
    const buyUsdc = () =>
      leaveTo({ pathname: '/trade', params: { mint: USDC_MINT, symbol: 'USDC', side: 'buy' } } as never)
    const receiveUsdc = () => leaveTo('/money/receive' as never)
    /* Phoenix itself may not take a move on this account now: said before anything is built. */
    const phoenixClosed = phoenix !== null && (deposit ? !phoenix.canDeposit : !phoenix.canWithdraw)
    const ready =
      open &&
      !phoenixClosed &&
      amount !== null &&
      amount >= MIN_COLLATERAL_MICRO &&
      block === null &&
      !busy &&
      owner !== null
    const held = deposit
      ? words.inWallet(heldLine(states.walletUsdc, gate.read ? timeOf(gate.at) : null, locale))
      : words.canWithdraw(
          heldLine(
            withdrawable,
            timeOf(phoenix?.withdrawableMicro != null ? margin.dataUpdatedAt : account?.observedAt),
            locale,
          ),
        )
    const chips = collateralChips(top)
    body = (
      <>
        <Card className="gap-2">
          <Txt variant="labelSm" tone="faint" caps numberOfLines={1}>
            {words.amount}
          </Txt>
          <TextInput
            ref={field}
            value={groupedField(text, locale)}
            onChangeText={(typed) => setText(typedField(typed, mark, DOLLAR_PLACES))}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.fgMuted}
            selectionColor={colors.brand}
            cursorColor={colors.brand}
            accessibilityLabel={words.amount}
            editable={!busy}
            // A wallet short of USDC known at once (the gate read before) opens with no keyboard over its lines.
            autoFocus={!short}
            className="text-fg"
            style={[type.dataLg, { paddingVertical: 0 }]}
          />
          <Txt variant="ui" tone="faint">
            {held}
          </Txt>
        </Card>
        <View className="flex-row gap-2">
          {chips.map((chip) => (
            <Button
              key={chip.key}
              title={chip.key === 'max' ? words.max : `${chip.key}${locale === 'uk' ? ' %' : '%'}`}
              variant="secondary"
              size="sm"
              className="flex-1"
              disabled={busy || chip.micro === null}
              onPress={() => chip.micro !== null && setText(fieldFromMicro(chip.micro, mark))}
            />
          ))}
        </View>
        {open && canary !== null ? (
          <Txt variant="ui" tone="faint">
            {words.canaryAmount(microText(canary, locale))}
          </Txt>
        ) : null}
        {block ? (
          <Txt variant="ui" tone="warning">
            {words.blocks[block]}
          </Txt>
        ) : null}
        {short ? (
          <View className="gap-2">
            <Txt variant="ui" tone="warning">
              {words.walletShort}
            </Txt>
            {way === 'trade' ? (
              <Txt variant="ui" tone="muted">
                {words.freeNow(freeHeld)}
              </Txt>
            ) : null}
            <View className="flex-row gap-2">
              {way === 'trade' ? (
                <Button title={words.buyUsdc} variant="secondary" size="sm" className="flex-1" onPress={buyUsdc} />
              ) : null}
              <Button
                title={words.receiveUsdc}
                variant="secondary"
                size="sm"
                className="flex-1"
                onPress={receiveUsdc}
              />
            </View>
          </View>
        ) : null}
        {gate.read && !open ? (
          <Txt variant="ui" tone="muted">
            {words.closed}
          </Txt>
        ) : phoenixClosed ? (
          <Txt variant="ui" tone="muted">
            {words.failures[deposit ? 'DEPOSIT_CLOSED' : 'WITHDRAW_CLOSED']}
          </Txt>
        ) : null}
        {failureLine}
      </>
    )
    /* Short of USDC, the one next action leads on: to a trade on the free collateral, else to USDC for the wallet. */
    footer =
      way === 'trade' ? (
        <SheetAction title={words.toTrade} onPress={toTrade} />
      ) : way === 'buy' ? (
        <SheetAction title={words.buyUsdc} onPress={buyUsdc} />
      ) : (
        <SheetAction
          title={busy ? words.preparing : words.review}
          loading={busy}
          disabled={!ready}
          onPress={() =>
            ready &&
            owner !== null &&
            amount !== null &&
            void review({ action: move, owner, amount: amount.toString() })
          }
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
        footer={footer}
      >
        {body}
      </SheetFrame>
    </Modal>
  )
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

/** «Перевірка» of a move, from the server's answer alone: what was built and simulated is what is shown. */
function ReviewBody({
  review,
  receivedAt,
  signer,
  words,
  failure,
}: {
  review: CollateralReview
  receivedAt: number
  signer: string
  words: CollateralCopy
  failure?: ReactNode
}) {
  const locale = useLocale()
  const sheet = useCopy(SHEET_COPY)
  const [details, setDetails] = useState(false)
  const view = collateralReviewView(review, words, locale)
  return (
    <>
      <View className="flex-row items-start gap-1">
        <Txt variant="title" className="shrink">
          {view.title}
        </Txt>
        <HelpDot
          title={words.whatIs}
          body={review.rentLamports > 0n ? [view.what, words.rentNote, words.risk] : [view.what, words.risk]}
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
      {view.rows.length > 0 ? <Rows rows={view.rows} /> : null}
      <Rows rows={[...view.costs, { label: sheet.allCosts, value: view.total }]} emphasisLast />
      <Countdown review={review} receivedAt={receivedAt} words={words} />
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
            <Detail label={words.program} value={shortAddress(PHOENIX_PROGRAM, 6)} />
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

/** How long the bytes may still be signed: «Дійсно ще 0:22», then out of date. */
function Countdown({
  review,
  receivedAt,
  words,
}: {
  review: CollateralReview
  receivedAt: number
  words: CollateralCopy
}) {
  const now = useNow(1000)
  const left = Math.max(0, Math.ceil((receivedAt + signableMsOf(review.signableMs) - now) / 1000))
  return (
    <ValidFor text={left > 0 ? words.validFor(`0:${String(left).padStart(2, '0')}`) : words.stale} stale={left === 0} />
  )
}

/** The receipt: what moved once the transaction landed, waiting while the chain has not said, failed otherwise. */
function CollateralReceipt({
  review,
  result,
  at,
  words,
  locale,
}: {
  review: CollateralReview
  result: CollateralResult
  at: number
  words: CollateralCopy
  locale: Locale
}) {
  const now = useNow(5_000)
  const view = collateralReceiptView(review, result, words, locale, now - at < COLLATERAL_FOLLOW_MS)
  const time = formatClock(new Date(at).toISOString())
  return (
    <>
      <DoneBody
        tone={view.status}
        title={view.title}
        big={view.big}
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

/** «Нова дія» once the network answered (or two minutes passed); «Готово» closes the sheet. */
function DoneFooter({
  at,
  result,
  words,
  onAgain,
  onClose,
}: {
  at: number
  result: CollateralResult
  words: CollateralCopy
  onAgain: () => void
  onClose: () => void
}) {
  const sheet = useCopy(SHEET_COPY)
  const now = useNow(1000)
  const waiting = result.state === 'UNKNOWN' && now - at < COLLATERAL_FOLLOW_MS
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
