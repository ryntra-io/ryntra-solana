import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Keyboard, Pressable, TextInput, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { Button } from '@/components/button'
import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { HelpDot } from '@/components/help-dot'
import { Icon, type IconName } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { AUTOINVEST_COPY, type AutoinvestCopy } from '@/features/autoinvest/copy'
import {
  checkPriceCondition,
  conditionReviewLine,
  deferralLine,
  type PriceCheck,
} from '@/features/autoinvest/price-condition'
import {
  bindingOf,
  purchaseSumUsd,
  weeklyFromSpent,
  zoneOfRule,
  type RuleBuyState,
} from '@/features/autoinvest/rule-model'
import { useConditionBounds, useConditionFacts } from '@/features/autoinvest/use-condition'
import {
  dueWords,
  gatheredLine,
  priceWord,
  ruleWhenLine,
  unbroken,
  unbrokenTail,
  wholeParts,
} from '@/features/autoinvest/words'
import { explorerUrl } from '@/features/history/history-model'
import { BUY_COPY, type BuyCopy } from '@/features/invest/buy-copy'
import {
  approxUsd,
  buyFailureKey,
  buyOutcome,
  dollarBalanceText,
  dollarsText,
  isCompanyBuy,
  isDollarMint,
  keepTogether,
  MIN_BUY_USD,
  spentText,
  unitsFromRaw,
  unitsPhrase,
  type BuyFailureKey,
  type BuyOutcome,
  type BuyRow,
  type PayDollar,
} from '@/features/invest/buy-model'
import { INVEST_COPY } from '@/features/invest/copy'
import {
  BUY_ENGINE,
  deviationOf,
  fairFromOf,
  heardLive,
  liveAt,
  poolWarningOf,
  poolWarningText,
  quoteFar,
  shareWorthUsd,
  type LiveShareQuote,
} from '@/features/invest/pool-warning'
import { useBuy, type BuyCompany, type BuyController } from '@/features/invest/use-buy'
import { RECEIPTS_COPY } from '@/features/receipts/copy'
import { docFromSwap, outcomeStatus } from '@/features/receipts/receipt-doc'
import { useOpenPlace, usePlaceHold } from '@/features/shell/open-place'
import { PORTFOLIO_HISTORY_PATH } from '@/features/shell/shell'
import type { TradeContext } from '@/features/trade/trade-model'
import { useNow } from '@/hooks/use-now'
import type { AutoinvestRule } from '@/lib/api'
import { useCopy, useSharedCopy, type Locale } from '@/lib/i18n'
import { TopUpSheet } from '@/screens/home/top-up-sheet'
import { EventLine } from '@/screens/invest/event-ui'
import { ShareReceiptSheet } from '@/screens/receipts/share-receipt'
import { type, useTheme } from '@/theme'
import { DASH, formatClock } from '@/utils/format'
import { openLink } from '@/lib/open-link'

const QUOTE_UNREAD: ReadonlySet<BuyFailureKey> = new Set([
  'offline',
  'tooLong',
  'providerDown',
  'rateLimited',
  'failed',
])

const PAY_CHOICES: readonly Choice<PayDollar>[] = [
  { value: 'USDC', label: 'USDC' },
  { value: 'USDT', label: 'USDT' },
]

/**
 * The purchase in dollars — the one action on a company's page
 * (M15), drawn as a sheet over the company's page.
 *
 * **The sum.** A sum in dollars from $1 — typed freely,
 * the sheet opening on $10, a default and never advice — or a share of the
 * wallet's dollars in one tap: 25 % · 50 % · 75 % · 100 % (a share under $1
 * drawn but not offered, none without a wallet); and at once what it buys and
 * what it costs, all of it, from the live quote; USDC or USDT pays where the
 * wallet holds both. Where the quote finds no route for the sum, the company
 * says its own minimum, read from the same quote — «На $1 маршруту зараз
 * немає. IREN — від $5.» — and the one action puts it in. One orange button,
 * «Купити за $10», asks the server for the exact Review on Trade's own path.
 * **«Перевірка»** is four rows — what leaves the wallet, what arrives at
 * least, all costs, what the token is — and «Підписати»: the wallet opens, the
 * person confirms there with the wallet's own biometrics, the server submits
 * once. The one-time reserve that opens a new token's account is its own line
 * under «Усі витрати», never among them: it stays in the wallet; when it is
 * more than the purchase itself, «Перевірка» says so first. **The figures
 * are the server's** (contract 1.20.0): what the sum buys, all costs with the
 * issuer's fee inside them, the reserve and «Що це» are the `check` the quote
 * and the order answer — the web draws the same, so one sum reads the same on
 * both; the sheet counts none of them. **The receipt:**
 * «✓ У тебе є частинка Apple · $10» with what arrived. A signature whose
 * outcome is not known yet is checked here, never repeated.
 *
 * **За правилом (M16.** A reminder of an autoinvest rule opens
 * this sheet on the rule's sum: the rule is read afresh, and while its
 * reminder is open the fresh «Перевірка» is prepared at once — the same four
 * rows, the same signature, the order bound to the rule (`origin.rule`). A
 * reminder that is no longer open says what became of it and offers nothing.
 * The receipt says «За правилом · Щотижня · чт о 19:00»; after a plain
 * purchase it offers «Купувати щотижня» where the company has no rule yet.
 * The reminder's own button reads «Купити $20 за правилом», never mistaken
 * for an ordinary purchase; and an ordinary purchase made while the
 * company's reminder is open says so before any sum — «Це звичайна купівля:
 * нагадування правила на $20 лишиться відкритим».
 *
 * **Умова ціни (M25.** A rule with a price condition is
 * judged again here on the company's figures, read afresh while the sheet is
 * open: met, its purchase carries the condition's line — the deviation, the
 * reference, the limit, the data's time — over the purchase and in
 * «Перевірка»; not met, or the data old, the sheet says «Купівлю відкладено»
 * with the reason, the figure and the data's time and until when the rule
 * checks again, and offers nothing — as it does for a purchase the rule's
 * tick deferred. The order route judges it again and refuses with its own
 * word (`RULE_PRICE_CONDITION`).
 *
 * Nothing here signs or spends: the wallet does, when the person confirms.
 */
export function BuySheet({
  company,
  visible,
  onClose,
  rule = null,
  openReminder = null,
  onBuyWeekly = null,
  onLive = null,
  onAmount = null,
}: {
  company: BuyCompany
  visible: boolean
  onClose: () => void
  /** A purchase under an autoinvest reminder; null for a plain purchase. */
  rule?: RuleBuySheet | null
  /** The company's rule whose reminder is open now, by its sum: a plain purchase says the reminder stays open. */
  openReminder?: Readonly<{ amountUsd: number }> | null
  /** «Купувати щотижня» on a plain purchase's receipt — given only when the company has no rule. */
  onBuyWeekly?: ((amountUsd: number) => void) | null
  /** The live estimate's price for one share, told to the page so its pool warning follows the freshest figure (ST-5 r8). */
  onLive?: ((live: LiveShareQuote) => void) | null
  /** The sum on screen, told to the page: its warning over «Купити» is judged at this sum alone (ST-5 r9). */
  onAmount?: ((usd: number | null) => void) | null
}) {
  if (!visible) return null
  return (
    <BuyFlow
      company={company}
      onClose={onClose}
      rule={rule}
      openReminder={openReminder}
      onBuyWeekly={onBuyWeekly}
      onLive={onLive}
      onAmount={onAmount}
    />
  )
}

/** A reminder as the sheet buys under it: what one tap may do now, read afresh, and how to read it again. */
export type RuleBuySheet = Readonly<{
  state: RuleBuyState
  /** The rule and the inbox read again — after a purchase under it, or the server's refusal. */
  reread: () => void
  /** The month's budget does not cover the reminder: its one action, «Змінити бюджет» — the budget's sheet over this one. */
  changeBudget: () => void
}>

function BuyFlow({
  company,
  onClose,
  rule,
  openReminder,
  onBuyWeekly,
  onLive,
  onAmount,
}: {
  company: BuyCompany
  onClose: () => void
  rule: RuleBuySheet | null
  openReminder: Readonly<{ amountUsd: number }> | null
  onBuyWeekly: ((amountUsd: number) => void) | null
  onLive: ((live: LiveShareQuote) => void) | null
  onAmount: ((usd: number | null) => void) | null
}) {
  const openPlace = useOpenPlace()
  const words = useCopy(BUY_COPY)
  const investWords = useCopy(INVEST_COPY)
  const ruleWords = useCopy(AUTOINVEST_COPY)
  const ruleState = rule?.state ?? null
  const read = ruleState && 'rule' in ruleState ? ruleState.rule : null
  const binding = ruleState ? bindingOf(ruleState) : null
  /* The reminder's own sum (1.19.0): a «З оплат» rule's reminder buys exactly what it gathered — the order route refuses
     any other (`RULE_MISMATCH`); every other rule's, its own sum. */
  const ruleSum = read
    ? purchaseSumUsd(read, ruleState && 'occurrence' in ruleState ? ruleState.occurrence : null)
    : null
  const buy = useBuy(company, ruleState ? { amountUsd: ruleSum, binding } : null)
  const { trade } = buy

  /* The page's pool warning, said again over this sheet's action and judged on the freshest figure for the sum on
     screen (ST-5 r9): the sheet's own live estimate, else a live quote the page saw for this very sum, wins over the
     pool's listed price — a quote for another sum never softens it; a larger sum seen near the share is said beside.
     Only figures from the engine this sheet buys through count (ST-5 r10): the quote card's never feed it. */
  const now = useNow(15_000)
  const pool = company.pool ?? null
  const seen = pool ? (buy.paid ? heardLive(pool.seen, buy.paid) : pool.seen) : []
  const poolWarning = pool
    ? poolWarningOf({
        deviationPct: pool.deviationPct,
        referencePerShare: pool.referencePerShare,
        liquidityUsd: pool.liquidityUsd,
        live: liveAt(seen, buy.amountUsd, now),
        fairFrom: fairFromOf(seen, buy.amountUsd, pool.referencePerShare, now),
      })
    : null
  const poolLine = poolWarning ? poolWarningText(poolWarning, buy.locale, investWords, clockOfMs) : null
  // The page hears the same figure and the same sum, so its warning over «Купити» is judged where this sheet stands.
  const livePerShare = buy.paid?.perShare ?? null
  const liveUsd = buy.paid?.usd ?? null
  const liveAtMs = buy.paid?.at ?? null
  useEffect(() => {
    if (onLive && livePerShare !== null && liveUsd !== null && liveAtMs !== null)
      onLive({ perShare: livePerShare, usd: liveUsd, at: liveAtMs, source: BUY_ENGINE })
  }, [onLive, livePerShare, liveUsd, liveAtMs])
  const sumOnScreen = buy.amountUsd
  useEffect(() => {
    onAmount?.(sumOnScreen)
  }, [onAmount, sumOnScreen])
  // While it is prepared, signed, sent or checked, a note's tap or a quick action waits for it (`place-hold.ts`).
  usePlaceHold(trade.busy)
  const [topUp, setTopUp] = useState(false)
  const address = trade.account.address

  /* «Умова ціни» (1.18.0: a rule with a condition is judged again here on the company's figures, read
     afresh while the sheet is open — the order route judges the same facts the same way. Not met now, or the data old,
     and the purchase is said, never offered; met, it carries the condition's line. */
  const bounds = useConditionBounds()
  const conditionOf = ruleState?.kind === 'open' ? ruleState.rule.priceCondition : null
  const conditionRead = useConditionFacts(company.mint, conditionOf !== null)
  const conditionPending = conditionOf !== null && conditionRead.status === 'reading'
  const conditionCheck =
    conditionOf && !conditionPending
      ? checkPriceCondition(conditionOf.limitPct, conditionRead.facts, now, bounds.maxAgeMinutes)
      : null
  const conditionHolds = conditionCheck !== null && conditionCheck.verdict !== 'met'

  /* The rule a purchase is made under, fixed when its Review is asked for: once History settles it, the reminder
     reads bought and is no longer open, and the receipt still names the rule it was bought by. */
  const [boughtUnder, setBoughtUnder] = useState<AutoinvestRule | null>(null)
  // The condition as judged when the Review was asked for — the Review shows what the order was judged on, not a figure that moves under the signature.
  const [reviewedCondition, setReviewedCondition] = useState<PriceCheck | null>(null)
  const startReview = () => {
    Keyboard.dismiss()
    // A rule's purchase whose condition is not met now is never asked for — the sheet says why instead.
    if (ruleState?.kind === 'open' && (conditionPending || conditionHolds)) return
    setBoughtUnder(ruleState?.kind === 'open' ? ruleState.rule : null)
    setReviewedCondition(ruleState?.kind === 'open' ? conditionCheck : null)
    void trade.review()
  }

  /* One tap from the reminder: the Review opens on its own, once, as soon as the wallet, its session, the rule
     and the wallet's dollars are all read, the wallet can pay and the rule's price condition is met. */
  const autoReviewed = useRef(false)
  const canAuto =
    ruleState?.kind === 'open' &&
    !conditionPending &&
    !conditionHolds &&
    buy.action.kind === 'buy' &&
    buy.payBalance !== null &&
    trade.phase === 'idle' &&
    !trade.attempt
  useEffect(() => {
    if (!canAuto || autoReviewed.current) return
    autoReviewed.current = true
    startReview()
    // startReview reads the state of this render; the ref keeps it to once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAuto])

  /* A settled purchase, or the server's word on the reminder, reads the rule again: History is how the rule learns it was bought. */
  const reread = rule?.reread
  const settledAt = trade.settled?.at ?? null
  const refusal = trade.failure?.code.startsWith('RULE_') ? trade.failure.code : null
  useEffect(() => {
    if (reread && (settledAt || refusal)) reread()
  }, [reread, settledAt, refusal])

  // Nothing closes the sheet while a Review is being prepared, signed, sent or checked: the flow keeps running and says so.
  const close = () => {
    if (trade.busy) return
    if (trade.phase === 'review') trade.closeReview()
    else if (trade.phase === 'settled') trade.reset()
    onClose()
  }
  // «Історія» is a segment of «Портфель» (NEW-LOOK §5): the sheet closes and the place opens on it.
  const toHistory = () => {
    // A purchase being prepared, signed, sent or checked keeps its sheet: History opens once it is not.
    if (trade.busy) return
    close()
    openPlace(PORTFOLIO_HISTORY_PATH)
  }

  const logo = <AssetIcon symbol={company.name} icon={company.icon} size={32} />
  let title = words.buyTitle(company.name)
  let body: ReactNode

  if (trade.phase === 'settled' && trade.settled) {
    title = company.name
    body = (
      <Receipt
        buy={buy}
        company={company}
        words={words}
        byRule={boughtUnder ? { rule: read?.id === boughtUnder.id ? read : boughtUnder, words: ruleWords } : null}
        onBuyWeekly={ruleState ? null : onBuyWeekly}
        onDone={close}
        onHistory={toHistory}
      />
    )
  } else if (trade.phase === 'recovery' || trade.phase === 'recovering') {
    title = company.name
    const own = trade.attempt ? isCompanyBuy(trade.attempt.context, company.mint) : true
    body = (
      <View className="gap-4 pb-2">
        <View className="flex-row items-start gap-3">
          <Icon name="time-outline" size={22} color="warningInk" />
          <Txt variant="body" className="flex-1">
            {own ? words.unknownTx : words.earlierTx}
          </Txt>
        </View>
        {trade.failure ? (
          <Txt
            variant="ui"
            tone={
              trade.failure.code === 'BYTES_REBUILT' || trade.failure.code === 'REVIEW_RENEWED' ? 'warning' : 'danger'
            }
          >
            {words.failures[buyFailureKey(trade.failure.code)]}
          </Txt>
        ) : null}
        <Button
          title={trade.phase === 'recovering' ? words.checkingTx : words.checkTx}
          size="lg"
          disabled={trade.phase === 'recovering'}
          onPress={() => void trade.recover()}
        />
        {trade.phase === 'recovering' ? null : <QuietLinks links={[{ label: words.history, onPress: toHistory }]} />}
      </View>
    )
  } else if ((trade.phase === 'review' || trade.phase === 'signing') && trade.prepared && buy.rows) {
    title = words.review
    body = (
      <Review
        buy={buy}
        words={words}
        byRule={boughtUnder ? `${ruleWords.byRule} · ${ruleWhenLine(boughtUnder, buy.locale)}` : null}
        poolLine={poolLine}
        condition={
          boughtUnder && reviewedCondition
            ? wholeParts(
                `${ruleWords.priceCondition} · ${conditionReviewLine(reviewedCondition, now, zoneOfRule(boughtUnder), buy.locale)}`,
              )
            : null
        }
        onRefresh={startReview}
      />
    )
  } else if (ruleState) {
    const waits = ruleState.kind === 'deferred' || (ruleState.kind === 'open' && conditionHolds)
    title = waits
      ? ruleWords.purchaseDeferred
      : ruleState.kind === 'open' || ruleState.kind === 'reading'
        ? ruleWords.timeToBuy
        : ruleWords.title(company.name)
    body = (
      <RuleCompose
        buy={buy}
        company={company}
        state={ruleState}
        condition={{ check: conditionCheck, holds: conditionHolds, pending: conditionPending, now }}
        poolLine={poolLine}
        words={words}
        ruleWords={ruleWords}
        onBuy={startReview}
        onReread={() => rule?.reread()}
        onDone={close}
        onTopUp={() => setTopUp(true)}
        onChangeBudget={() => rule?.changeBudget()}
      />
    )
  } else {
    body = (
      <Compose
        buy={buy}
        company={company}
        words={words}
        openLine={openReminder ? ruleWords.plainLeavesOpen(dollarsText(openReminder.amountUsd, buy.locale)) : null}
        poolLine={poolLine}
        onTopUp={() => setTopUp(true)}
      />
    )
  }

  return (
    <>
      <Sheet visible title={title} leading={logo} onClose={close} scroll>
        {body}
      </Sheet>
      {address ? <TopUpSheet visible={topUp} address={address} onClose={() => setTopUp(false)} /> : null}
    </>
  )
}

/* ---- the sum ---- */

/** What the sum buys and costs, or why it cannot be said yet; a sum under the minimum is said once, on the button. */
function estimateOf(buy: BuyController, company: BuyCompany, words: BuyCopy): string {
  const { trade, locale } = buy
  if (buy.amountUsd === null || buy.amountUsd < MIN_BUY_USD) return ' '
  if (trade.quoteBlocked) return words.unavailable
  // No route for the sum: the company's own minimum from the same quote, or that it is being read.
  const route = buy.routeMinimum
  if (buy.noRoute && route.state === 'found')
    return words.routeMinimum(dollarsText(buy.amountUsd, locale), company.name, dollarsText(route.minimumUsd, locale))
  if (buy.noRoute && route.state === 'finding') return words.findingMinimum
  // The limiter held the quote back and it is being asked again by itself: pricing, not a failure (ST-5).
  if (buy.quoteHeld) return words.pricing
  if (trade.quoteFailure) {
    // A price that could not be read is said as that — no purchase was under way to say «nothing was sent» of.
    const key = buyFailureKey(trade.quoteFailure.code)
    return QUOTE_UNREAD.has(key) ? words.quoteDown : words.failures[key]
  }
  // The server's figures (1.20.0); «≈» never ends a line apart from its figure.
  if (buy.estimate?.units !== null && buy.estimate?.units !== undefined) {
    const units = keepTogether(`≈ ${unitsPhrase(buy.estimate.units, company.unit, company.name, locale)}`)
    /* A price far from the share (ST-5 r8: SGOVx, $10 for ≈ 0,0002 of a share, «усі витрати ≈ $0,12»): the fees say
       nothing of the loss, so what the shares are worth at the share's reference is said in their place. */
    const reference = company.pool?.referencePerShare ?? null
    const worth = buy.paid ? shareWorthUsd(buy.estimate.units, reference) : null
    // The estimate's own time, quietly at its end (ST-5 r9): a route that changes between two asks reads as two moments.
    const at = trade.quotedAt ? ` · ${words.quotedAt(formatClock(trade.quotedAt))}` : ''
    if (buy.paid && worth !== null && quoteFar(deviationOf(buy.paid.perShare, reference), reference))
      return `${units} · ${words.shareWorth(keepTogether(approxUsd(worth, locale)), dollarsText(buy.paid.usd, locale))}${at}`
    return `${units} · ${words.allCosts}\u00a0${
      buy.estimate.costsUsd !== null ? keepTogether(approxUsd(buy.estimate.costsUsd, locale)) : DASH
    }${at}`
  }
  // The server answered without a figure for what arrives: nothing is said in its place, as on the web.
  if (buy.estimate) return ' '
  return words.pricing
}

type SheetButton = { title: string; onPress?: () => void; disabled?: boolean; loading?: boolean }

/** The one button by what stands between the person and a Review (`composeAction`); only `buy` asks for one. */
function buttonOf(buy: BuyController, words: BuyCopy, enter: string, onBuy: () => void): SheetButton {
  const { trade, action, locale } = buy
  const account = trade.account
  const sum = (usd: number) => dollarsText(usd, locale)
  switch (action.kind) {
    case 'release':
      return { title: words.refreshPrice, onPress: () => void trade.release(), loading: trade.busy }
    case 'connect':
      return { title: words.connect, onPress: () => void account.connect(), loading: account.busy === 'connect' }
    case 'sign-in':
      return { title: words.signIn, onPress: () => void account.signIn(), loading: account.signingIn }
    case 'minimum':
      return { title: words.minimum, disabled: true }
    case 'enter':
      return { title: enter, disabled: true }
    case 'use-minimum':
      // No route for the sum: the one action puts the company's own minimum in — never a dead button.
      return { title: words.setMinimum(sum(action.usd)), onPress: () => buy.pickSum(action.usd) }
    case 'finding-minimum':
      return { title: words.buyFor(sum(action.usd)), disabled: true }
    case 'preparing':
      return { title: words.preparing, disabled: true }
    case 'need-sol':
      return { title: words.needSol, disabled: true }
    case 'not-enough':
      return {
        title: action.alsoSol ? words.notEnoughAndSol(buy.payAsset.symbol) : words.notEnough(buy.payAsset.symbol),
        disabled: true,
      }
    case 'unavailable':
      return { title: words.unavailable, disabled: true }
    case 'settling':
      return { title: words.buyFor(sum(action.usd)), disabled: true }
    case 'buy':
      return { title: words.buyFor(sum(action.usd)), onPress: onBuy }
  }
}

/** A refusal of the wallet, the session or the server, in the purchase's words. */
function failureOf(buy: BuyController, words: BuyCopy): string | null {
  const account = buy.trade.account
  const signIn = account.signInFailure
  if (signIn) {
    if (signIn.kind === 'network') return words.signInOffline
    if (signIn.kind === 'outdated') return words.signInOutdated
    if (signIn.kind === 'no-wallet') return words.failures.noWallet
    return words.signInFailed
  }
  if (account.failure) return account.failure.kind === 'no-wallet' ? words.failures.noWallet : words.connectFailed
  return buy.trade.failure ? words.failures[buyFailureKey(buy.trade.failure.code)] : null
}

/** What was, or was not, priced — a price that failed to read is asked for again with one tap. */
function EstimateLine({ buy, estimate, words }: { buy: BuyController; estimate: string; words: BuyCopy }) {
  const { trade } = buy
  if (
    !buy.noRoute &&
    !buy.quoteHeld &&
    trade.quoteFailure?.retryable &&
    buy.amountUsd !== null &&
    buy.amountUsd >= MIN_BUY_USD
  )
    // After a wallet's round trip, on a flaky network, the price is asked for again with one tap.
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${estimate} ${words.tryAgain}`}
        onPress={trade.refreshQuote}
        hitSlop={6}
        className="active:opacity-70"
      >
        <Txt variant="ui" tone="muted" className="text-center" accessibilityLiveRegion="polite">
          {`${estimate} · `}
          <Txt variant="ui" tone="fg">
            {words.tryAgain}
          </Txt>
        </Txt>
      </Pressable>
    )
  return (
    <Txt variant="ui" tone="muted" className="text-center" accessibilityLiveRegion="polite">
      {estimate}
    </Txt>
  )
}

/**
 * Under the button: that signing in moves nothing, behind «?» (ST-4); or what the wallet holds of the paying dollars,
 * with «Поповнити» when short.
 */
function WalletLine({ buy, words, onTopUp }: { buy: BuyController; words: BuyCopy; onTopUp: () => void }) {
  const { action, locale } = buy
  const short =
    action.kind === 'need-sol' || action.kind === 'not-enough' || (action.kind === 'sign-in' && action.short !== null)
  // Short before signing in: what the wallet holds, with «Поповнити», says more than that signing in moves nothing.
  if (action.kind === 'sign-in' && action.short === null) return <SignInHelp />
  if (!buy.trade.account.address || buy.payBalance === null) return null
  return (
    <View className="flex-row flex-wrap items-center justify-center gap-x-2 gap-y-1">
      <Txt variant="ui" tone="faint" tabular>
        {words.walletHas(`${dollarBalanceText(buy.payBalance, locale)} ${buy.payAsset.symbol}`)}
      </Txt>
      {short ? (
        <Pressable accessibilityRole="button" accessibilityLabel={words.topUp} onPress={onTopUp} hitSlop={8}>
          <Txt variant="ui" tone="fg">
            {`· ${words.topUp}`}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  )
}

/**
 * Over «Увійти гаманцем»: the wallet's balance, already read, does not cover the sum (ST-5 r6) — said before the
 * person signs in, in the words the disabled button says once signed in.
 */
function ShortfallLine({ buy, words }: { buy: BuyController; words: BuyCopy }) {
  const { action } = buy
  if (action.kind !== 'sign-in' || action.short === null) return null
  const symbol = buy.payAsset.symbol
  return (
    <Txt variant="ui" tone="warning" className="text-center" accessibilityLiveRegion="polite">
      {action.short.alsoSol ? words.notEnoughAndSol(symbol) : words.notEnough(symbol)}
    </Txt>
  )
}

/** A seen quote's time on the phone's clock («11:56»), as every figure's time is said. */
function clockOfMs(ms: number): string {
  return formatClock(new Date(ms).toISOString())
}

/** The page's pool warning over the sheet's action (ST-5 r8): the line the page says, in a box one cannot read past. */
function PoolWarningLine({ text }: { text: string }) {
  return (
    <View
      accessibilityRole="alert"
      className="flex-row items-start gap-2 rounded-sm border border-warning-soft bg-warning-soft px-4 py-3"
    >
      <Icon name="warning-outline" size={18} color="warningInk" style={{ marginTop: 1 }} />
      <Txt variant="ui" tone="warning" className="flex-1">
        {text}
      </Txt>
    </View>
  )
}

/** A private company's truth before any sum — and, where the issuer opened a swap window, that the token bought must be swapped by its deadline. */
function TruthWarning({ company }: { company: BuyCompany }) {
  if (!company.preIpo || !company.truth) return null
  return (
    <View className="gap-2">
      <View className="flex-row items-start gap-2">
        <Icon name="warning-outline" size={16} color="warningInk" style={{ marginTop: 1 }} />
        <Txt variant="ui" tone="warning" className="flex-1">
          {company.truth}
        </Txt>
      </View>
      {company.eventLine ? <EventLine line={company.eventLine} /> : null}
    </View>
  )
}

function Compose({
  buy,
  company,
  words,
  openLine,
  poolLine,
  onTopUp,
}: {
  buy: BuyController
  company: BuyCompany
  words: BuyCopy
  /** «Це звичайна купівля: нагадування правила на $20 лишиться відкритим.» while the company's reminder is open; null otherwise. */
  openLine: string | null
  /** The page's pool warning, judged on this sheet's live estimate (ST-5 r8); null for none. */
  poolLine: string | null
  onTopUp: () => void
}) {
  const { colors } = useTheme()
  const invest = useCopy(INVEST_COPY)
  const { trade, locale } = buy
  const busy = trade.busy
  // Shares of the wallet's dollars, never fixed sums (chosen 2026-09-25); a share under $1 is not offered.
  const shares: readonly Choice<string>[] = buy.shares.map((share) => ({
    value: String(share.pct),
    label: `${share.pct}%`,
    accessibilityLabel: `${share.pct}% · ${dollarsText(share.usd, locale)}`,
    disabled: !share.offered,
  }))
  const sharesOf = new Map(buy.shares.map((share) => [String(share.pct), share.usd]))
  const button = buttonOf(buy, words, invest.buy, () => {
    Keyboard.dismiss()
    void trade.review()
  })
  const failure = failureOf(buy, words)
  /* The pre-filled sum is replaced by what is typed, never typed into (ST-5 r6: «2» on «$1|0» made «$120»): a tap
     selects the whole sum, and after every accepted key — or a quick share — the caret stands at the sum's end, past
     the «$» the field draws in front of it. */
  const shown = buy.amountText.length > 0 ? `$${buy.amountText}` : ''
  const [focused, setFocused] = useState(false)
  const [selectAll, setSelectAll] = useState(false)
  const selection = focused
    ? selectAll
      ? { start: 0, end: shown.length }
      : { start: shown.length, end: shown.length }
    : undefined

  return (
    <View className="gap-4 pb-2">
      <TruthWarning company={company} />
      {openLine ? (
        // Said before any sum: this purchase leaves the rule's reminder open.
        <View className="flex-row items-start gap-2 rounded-sm border border-line bg-surface px-4 py-3">
          <Icon name="repeat-outline" size={16} color="muted" style={{ marginTop: 1 }} />
          <Txt variant="ui" tone="muted" className="flex-1">
            {openLine}
          </Txt>
        </View>
      ) : null}

      <TextInput
        value={shown}
        onChangeText={(text) => {
          setSelectAll(false)
          buy.setAmountText(text)
        }}
        selectTextOnFocus
        selection={selection}
        onFocus={() => {
          setFocused(true)
          setSelectAll(true)
        }}
        onBlur={() => setFocused(false)}
        keyboardType="decimal-pad"
        placeholder="$0"
        placeholderTextColor={colors.fgMuted}
        selectionColor={colors.brand}
        cursorColor={colors.brand}
        accessibilityLabel={words.amount}
        editable={!busy}
        textAlign="center"
        className="text-fg"
        style={[type.display, { fontSize: 44, lineHeight: 52, paddingVertical: 4 }]}
      />

      {shares.length > 0 ? (
        <View accessibilityLabel={words.quickShares(buy.payAsset.symbol)}>
          <ChoiceChips
            choices={shares}
            value={buy.pickedShare !== null ? String(buy.pickedShare) : ''}
            onChange={(value) => {
              const usd = sharesOf.get(value)
              if (usd !== undefined) buy.pickSum(usd)
            }}
            quiet
            fill
            disabled={busy}
          />
        </View>
      ) : null}

      <EstimateLine buy={buy} estimate={estimateOf(buy, company, words)} words={words} />

      {buy.offersPayChoice ? (
        <View className="flex-row items-center justify-center gap-3">
          <Txt variant="ui" tone="faint">
            {words.payWith}
          </Txt>
          <ChoiceChips choices={PAY_CHOICES} value={buy.pay} onChange={buy.pickPay} quiet size="sm" disabled={busy} />
        </View>
      ) : null}

      {failure ? (
        <Txt variant="ui" tone="danger" className="text-center">
          {failure}
        </Txt>
      ) : null}

      {poolLine ? <PoolWarningLine text={poolLine} /> : null}
      <ShortfallLine buy={buy} words={words} />
      <Button
        title={button.title}
        size="lg"
        onPress={button.onPress}
        disabled={button.disabled}
        loading={button.loading}
      />

      <WalletLine buy={buy} words={words} onTopUp={onTopUp} />
    </View>
  )
}

/* ---- a reminder's purchase ---- */

/**
 * The sheet under an autoinvest reminder, before «Перевірка»: the rule's sum
 * and when it reminds, what the sum buys now, and one button. While the
 * reminder is open the Review opens on its own (the page's one tap); anything
 * in the way — the wallet, its session, its dollars, the network fee — is the
 * button, as in a plain purchase. A reminder that is no longer open says
 * what became of it, and «Готово» is all it offers: nothing is caught up. One
 * the month's budget does not cover says so and offers «Змінити бюджет»:
 * a larger ceiling opens the Review at once, a smaller month
 * keeps the rules standing until the 1st.
 */
/** The rule's price condition as the sheet judged it now (1.18.0): the judgement, whether it holds the purchase back, whether its figures are still being read. */
type RuleCondition = Readonly<{ check: PriceCheck | null; holds: boolean; pending: boolean; now: number }>

function RuleCompose({
  buy,
  company,
  state,
  condition,
  poolLine,
  words,
  ruleWords,
  onBuy,
  onReread,
  onDone,
  onTopUp,
  onChangeBudget,
}: {
  buy: BuyController
  company: BuyCompany
  state: RuleBuyState
  condition: RuleCondition
  /** The page's pool warning, judged on this sheet's live estimate (ST-5 r8); null for none. */
  poolLine: string | null
  words: BuyCopy
  ruleWords: AutoinvestCopy
  onBuy: () => void
  onReread: () => void
  onDone: () => void
  onTopUp: () => void
  onChangeBudget: () => void
}) {
  const { trade, locale, action } = buy
  const rule = 'rule' in state ? state.rule : null
  const zone = rule ? zoneOfRule(rule) : 'UTC'
  // The purchase is the reminder's own sum (1.19.0) — what a «З оплат» rule gathered — or the rule's.
  const sum = rule ? purchaseSumUsd(rule, 'occurrence' in state ? state.occurrence : null) : null
  // What comes next once this reminder is over: the next day of a schedule, the line a fall's price must reach, or what payments gather now.
  const next =
    rule?.status !== 'active'
      ? null
      : rule.payments
        ? gatheredLine(rule.payments.gatheredUsd, rule.amountUsd, locale)
        : rule.dip
          ? `${ruleWords.remindAtLine} ${priceWord(rule.dip.triggerUsd, locale)}`
          : rule.nextDueAt
            ? `${ruleWords.nextPurchase}: ${dueWords(Date.parse(rule.nextDueAt), zone, locale)}`
            : null

  /* The price condition holds the purchase back (1.18.0): the tick deferred it, or the figures read now do not meet
     it — the reason, the figure and the data's time, and until when the rule judges it again. */
  const open = state.kind === 'open'
  const waiting = state.kind === 'deferred' || (open && condition.holds)
  const waitingOn =
    state.kind === 'deferred' ? state.occurrence.condition : open && condition.holds ? condition.check : null
  const waitsUntil =
    waiting && (state.kind === 'deferred' || state.kind === 'open')
      ? `${ruleWords.checksAgainUntil} ${unbroken(dueWords(Date.parse(state.occurrence.openUntil), zone, locale))}.`
      : null
  const offered = open && !condition.holds

  /* What became of the reminder when it is not open: said plainly, with no purchase offered. */
  const closedWord = waiting
    ? waitingOn
      ? unbrokenTail(deferralLine(waitingOn, company.name, condition.now, zone, locale))
      : ruleWords.deferredShort
    : state.kind === 'read-failed'
      ? ruleWords.ruleReadFailed
      : state.kind === 'gone'
        ? ruleWords.ruleGone
        : state.kind === 'held'
          ? `${ruleWords.budgetBlocks} ${ruleWords.rulesStand}.`
          : state.kind === 'bought'
            ? ruleWords.reminderBought
            : state.kind === 'pending'
              ? ruleWords.reminderPending
              : state.kind === 'paused'
                ? ruleWords.rulePaused
                : state.kind === 'closed'
                  ? state.rule.dip
                    ? ruleWords.reminderClosedDip
                    : state.rule.payments
                      ? ruleWords.reminderClosedPayments
                      : ruleWords.reminderClosed
                  : null
  // The condition met now: why the purchase is offered — the deviation, the reference, the limit, the data's time.
  const metLine =
    offered && condition.check
      ? wholeParts(`${ruleWords.priceCondition} · ${conditionReviewLine(condition.check, condition.now, zone, locale)}`)
      : null

  /* The wallet and its session come first — the rule is the wallet's own and is read behind its session. */
  let button: SheetButton
  if (action.kind === 'release' || action.kind === 'connect' || action.kind === 'sign-in')
    button = buttonOf(buy, words, ruleWords.reading, onBuy)
  else if (state.kind === 'read-failed') button = { title: ruleWords.tryAgain, onPress: onReread }
  else if (state.kind === 'held') button = { title: ruleWords.changeBudget, onPress: onChangeBudget }
  else if (closedWord) button = { title: ruleWords.done, onPress: onDone }
  else if (state.kind === 'reading' || condition.pending) button = { title: ruleWords.reading, disabled: true }
  else {
    const plain = buttonOf(buy, words, ruleWords.reading, onBuy)
    // The reminder's purchase is said as the rule's, never as an ordinary one.
    button =
      action.kind === 'buy' || action.kind === 'settling'
        ? { ...plain, title: ruleWords.buyByRule(dollarsText(action.usd, locale)) }
        : plain
  }

  const failure = failureOf(buy, words)
  return (
    <View className="gap-4 pb-2">
      <TruthWarning company={company} />
      {rule && sum !== null ? (
        <View className="items-center gap-1 py-1">
          <Txt variant="display" tabular className="text-center">
            {locale === 'uk'
              ? `${dollarsText(sum, locale)} в ${company.name}`
              : `${dollarsText(sum, locale)} of ${company.name}`}
          </Txt>
          <Txt variant="ui" tone="muted">
            {ruleWhenLine(rule, locale)}
          </Txt>
        </View>
      ) : state.kind === 'reading' ? (
        <View className="items-center py-1">
          <Skeleton className="h-9 w-48" />
        </View>
      ) : null}

      {offered ? <EstimateLine buy={buy} estimate={estimateOf(buy, company, words)} words={words} /> : null}
      {metLine ? (
        <Txt variant="ui" tone="faint" className="text-center" tabular>
          {metLine}
        </Txt>
      ) : null}
      {closedWord ? (
        <Txt variant="ui" className="text-center">
          {closedWord}
        </Txt>
      ) : null}
      {waitsUntil ? (
        <Txt variant="ui" tone="faint" className="text-center" tabular>
          {waitsUntil}
        </Txt>
      ) : closedWord && next && state.kind !== 'gone' ? (
        <Txt variant="ui" tone="faint" className="text-center" tabular>
          {next}
        </Txt>
      ) : null}

      {failure && !(trade.failure && closedWord) ? (
        <Txt variant="ui" tone="danger" className="text-center">
          {failure}
        </Txt>
      ) : null}

      {poolLine && offered ? <PoolWarningLine text={poolLine} /> : null}
      <ShortfallLine buy={buy} words={words} />
      <Button
        title={button.title}
        size="lg"
        onPress={button.onPress}
        disabled={button.disabled}
        loading={button.loading}
      />
      {offered || action.kind === 'sign-in' ? <WalletLine buy={buy} words={words} onTopUp={onTopUp} /> : null}
    </View>
  )
}

/* ---- «Перевірка» ---- */

const ROW_LABEL: Readonly<Record<BuyRow['key'], keyof BuyCopy>> = {
  spend: 'rowSpend',
  get: 'rowGet',
  costs: 'rowCosts',
  what: 'rowWhat',
}

function Review({
  buy,
  words,
  byRule,
  poolLine = null,
  condition = null,
  onRefresh,
}: {
  buy: BuyController
  words: BuyCopy
  /** «За правилом · Щотижня · чт о 19:00» under a reminder; null for a plain purchase. */
  byRule: string | null
  /** The page's pool warning, said again over the signature (ST-5 r8); null for none. */
  poolLine?: string | null
  /** «Умова ціни · +2,1 % до оцінки PreStocks $1 000,00 · ліміт 5 % · дані 10:32» — the rule's condition as judged for this Review (1.18.0). */
  condition?: string | null
  /** Ask for a fresh Review — under a reminder, bound to the same rule. */
  onRefresh: () => void
}) {
  const { trade } = buy
  const rows = buy.rows ?? []
  const left = trade.reviewLeft
  const closed = left !== null && left <= 0
  // Ten seconds is the least a wallet needs to raise its prompt and a person to read and press it (Trade's own rule).
  const signable = !closed && !trade.invalidated && left !== null && left >= 10
  const signing = trade.phase === 'signing'
  const refresh = () => {
    trade.closeReview()
    onRefresh()
  }
  const reserveFirst = buy.reserveFirst
  return (
    <View className="gap-4 pb-2">
      {reserveFirst ? (
        // More than the purchase itself: said before the rows; what it is — it stays in the wallet — behind «?».
        <ReserveFirstLine
          line={words.reserveFirst(
            approxUsd(reserveFirst.reserveUsd, buy.locale),
            dollarsText(reserveFirst.spendUsd, buy.locale),
          )}
          help={{ title: words.reserveTitle, body: words.reserveHelp }}
        />
      ) : null}
      <BuyReviewTable rows={rows} words={words} />
      {byRule ? <RuleMarkLine line={byRule} next={condition} /> : null}
      {trade.failure ? (
        <Txt
          variant="ui"
          tone={
            trade.failure.code === 'BYTES_REBUILT' || trade.failure.code === 'REVIEW_RENEWED' ? 'warning' : 'danger'
          }
          className="text-center"
        >
          {words.failures[buyFailureKey(trade.failure.code)]}
        </Txt>
      ) : null}
      {poolLine && !signing ? <PoolWarningLine text={poolLine} /> : null}
      <Txt variant="ui" tone="faint" className="text-center" tabular>
        {signing ? ' ' : signable ? words.priceHolds(left) : words.priceExpired}
      </Txt>
      {signing ? (
        <Button title={trade.sending ? words.sending : words.inWallet} size="lg" disabled />
      ) : signable ? (
        <Button title={words.sign} size="lg" onPress={() => void trade.sign()} />
      ) : (
        <Button title={words.refreshPrice} size="lg" onPress={refresh} />
      )}
      <Button title={words.cancel} variant="ghost" onPress={trade.closeReview} disabled={signing} />
    </View>
  )
}

/** «Разовий резерв ≈ $1,20 у SOL більший за саму покупку. …» — said in amber before the rows. */
export function ReserveFirstLine({
  line,
  help = null,
}: {
  line: string
  /** What the reserve is, one tap deep (ST-4). */
  help?: Readonly<{ title: string; body: string }> | null
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Icon name="information-circle-outline" size={16} color="warningInk" />
      <Txt variant="ui" tone="warning" className="flex-1">
        {line}
      </Txt>
      {help ? <HelpDot title={help.title} body={help.body} /> : null}
    </View>
  )
}

/** «?» under a sign-in button: that signing in proves the wallet and moves nothing — one tap deep, never a line. */
export function SignInHelp() {
  const shared = useSharedCopy()
  return (
    <View className="items-center">
      <HelpDot title={shared.signInWhy} body={shared.signInHelp} label={shared.signInWhy} />
    </View>
  )
}

/** The four rows as a person reads them: the label on the left, the figure and its quieter line on the right. */
export function BuyReviewTable({ rows, words }: { rows: readonly BuyRow[]; words: BuyCopy }) {
  return (
    <ReviewTable
      rows={rows.map((row) => ({
        key: row.key,
        label: words[ROW_LABEL[row.key]] as string,
        value: row.value,
        fee: row.fee,
        sub: row.sub,
        caution: row.caution,
        inlineSub: row.key === 'spend',
        tabular: row.key !== 'what',
        // The reserve under «Усі витрати» is said as a figure; what it is sits behind «?» beside the label (ST-4).
        help: row.key === 'costs' && row.sub ? { title: words.reserveTitle, body: words.reserveHelp } : null,
      }))}
    />
  )
}

/** One row of a «Перевірка» table: its label, its figure, the issuer's fee on a line of its own, a quieter line. */
export type ReviewTableRow = Readonly<{
  key: string
  label: string
  value: string
  fee: string | null
  sub: string | null
  /** Said in amber. */
  caution?: boolean
  /** The quieter line follows the figure on its own line's end, as what leaves the wallet does. */
  inlineSub?: boolean
  tabular?: boolean
  /** What the row means, behind «?» beside its label (ST-4). */
  help?: Readonly<{ title: string; body: string }> | null
}>

/** «Перевірка»'s rows — a purchase's four, a swap's four — drawn one way. */
export function ReviewTable({ rows }: { rows: readonly ReviewTableRow[] }) {
  return (
    <View className="rounded-sm border border-line bg-surface">
      {rows.map((row, index) => (
        <View
          key={row.key}
          className={index === 0 ? 'flex-row gap-3 px-4 py-3' : 'flex-row gap-3 border-t border-line px-4 py-3'}
        >
          <Txt variant="ui" tone="faint" style={{ width: 104 }}>
            {row.label}
          </Txt>
          <View className="flex-1 gap-0.5">
            {row.inlineSub ? (
              <Txt variant="ui" tabular>
                {row.value}
                {row.sub ? <Txt variant="ui" tone="faint">{` ${row.sub}`}</Txt> : null}
              </Txt>
            ) : (
              <>
                <Txt variant="ui" tone={row.caution ? 'warning' : 'fg'} tabular={row.tabular !== false}>
                  {row.value}
                </Txt>
                {row.fee ? (
                  <Txt variant="ui" tone="muted" tabular>
                    {row.fee}
                  </Txt>
                ) : null}
                {row.sub ? (
                  // A row said in amber says its quieter line in amber too — a private company's event under «Що це».
                  <Txt variant="ui" tone={row.caution ? 'warning' : 'faint'} tabular={row.tabular !== false}>
                    {row.sub}
                  </Txt>
                ) : null}
              </>
            )}
          </View>
          {/* What the row's figure means sits at the row's end, never squeezing its label (ST-4). */}
          {row.help ? (
            <View className="-my-1.5">
              <HelpDot title={row.help.title} body={row.help.body} size={16} />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  )
}

/* ---- the receipt ---- */

export type ReceiptFace = Readonly<{
  icon: IconName
  color: 'successInk' | 'warningInk' | 'dangerInk' | 'fgMuted'
  headline: string
  detail: string | null
  note: string | null
  noteTone: 'warning' | 'faint'
}>

/** What a settled answer looks like on the sheet — the mark, the headline with the sum, what arrived, and a note only where one is due. */
export function receiptFace(
  outcome: BuyOutcome,
  context: TradeContext | null,
  company: Pick<BuyCompany, 'name' | 'unit' | 'multiplier'>,
  words: BuyCopy,
  locale: Locale,
): ReceiptFace {
  if (outcome.kind === 'filled') {
    const spent = context ? spentText(outcome.spentRaw, context.pay, context.payDecimals, locale) : null
    const got = context ? unitsFromRaw(outcome.gotRaw, context.receiveDecimals, company.multiplier) : null
    const own = company.unit === 'token' ? words.ownToken(company.name) : words.ownPiece(company.name)
    return {
      icon: outcome.belowMinimum ? 'alert-circle' : 'checkmark-circle',
      color: outcome.belowMinimum ? 'warningInk' : 'successInk',
      headline: spent ? `${own} · ${spent}` : own,
      detail:
        got === null
          ? null
          : `${outcome.fromReview ? '≈ ' : ''}${unitsPhrase(got, company.unit, company.name, locale)}`,
      // «≈» says the figure is the Review's; the receipt keeps the network's (ST-4: no line says so).
      note: outcome.belowMinimum ? words.belowMinimum : null,
      noteTone: outcome.belowMinimum ? 'warning' : 'faint',
    }
  }
  if (outcome.kind === 'nothing')
    return {
      icon: 'remove-circle-outline',
      color: 'fgMuted',
      headline: words.nothingHappened,
      detail: null,
      note: null,
      noteTone: 'faint',
    }
  if (outcome.kind === 'not-filled')
    return {
      icon: 'close-circle',
      color: 'dangerInk',
      headline: words.notFilled,
      detail: null,
      note: null,
      noteTone: 'faint',
    }
  return {
    icon: 'time-outline',
    color: 'warningInk',
    headline: words.unknownTx,
    detail: null,
    note: null,
    noteTone: 'faint',
  }
}

/** The receipt's face: the mark, the headline, what arrived. */
export function BuyReceiptFace({ face }: { face: ReceiptFace }) {
  return (
    <View className="items-center gap-2 py-2" accessibilityRole="summary">
      <Icon name={face.icon} size={56} color={face.color} />
      <Txt variant="title" className="text-center">
        {face.headline}
      </Txt>
      {face.detail ? (
        <Txt variant="ui" tone="muted" className="text-center" tabular>
          {face.detail}
        </Txt>
      ) : null}
      {face.note ? (
        <Txt variant="ui" tone={face.noteTone} className="text-center">
          {face.note}
        </Txt>
      ) : null}
    </View>
  )
}

function Receipt({
  buy,
  company,
  words,
  byRule,
  onBuyWeekly,
  onDone,
  onHistory,
}: {
  buy: BuyController
  company: BuyCompany
  words: BuyCopy
  /** The rule the purchase was made under (as it reads now, when it was read again), and the words to say it in. */
  byRule: Readonly<{ rule: AutoinvestRule; words: AutoinvestCopy }> | null
  /** «Купувати щотижня» after a plain purchase, on the sum just bought — given only when the company has no rule. */
  onBuyWeekly: ((amountUsd: number) => void) | null
  onDone: () => void
  onHistory: () => void
}) {
  const ruleWords = useCopy(AUTOINVEST_COPY)
  const receiptWords = useCopy(RECEIPTS_COPY)
  const [sharing, setSharing] = useState(false)
  const { trade, locale } = buy
  const settled = trade.settled!
  const context = settled.context
  const outcome = buyOutcome(settled.settlement, context)
  const own = isCompanyBuy(context, company.mint)
  const signature = settled.settlement.signature
  const spent =
    outcome.kind === 'filled' && context && isDollarMint(context.pay.mint)
      ? unitsFromRaw(outcome.spentRaw, context.payDecimals, null)
      : null
  const weekly = outcome.kind === 'filled' && onBuyWeekly ? weeklyFromSpent(spent) : null
  const ruleMark = outcome.kind === 'filled' && byRule ? byRule : null
  const nextOfRule =
    ruleMark && ruleMark.rule.status === 'active' && ruleMark.rule.nextDueAt
      ? dueWords(Date.parse(ruleMark.rule.nextDueAt), zoneOfRule(ruleMark.rule), locale)
      : null
  const links = [
    { label: words.history, onPress: onHistory },
    ...(signature && outcome.kind !== 'nothing'
      ? [{ label: `${words.transaction} ↗`, onPress: () => openLink(explorerUrl(signature)) }]
      : []),
  ]

  if (!own) {
    // An earlier signature of this wallet, checked here before anything new: said in one line, then the sum again.
    const line =
      outcome.kind === 'filled'
        ? words.earlierDone
        : outcome.kind === 'nothing'
          ? words.earlierNothing
          : outcome.kind === 'not-filled'
            ? words.earlierNotFilled
            : words.unknownTx
    return (
      <View className="gap-4 pb-2">
        <Txt variant="body">{line}</Txt>
        <Button title={words.continue} size="lg" onPress={trade.reset} />
        <QuietLinks links={links} />
      </View>
    )
  }

  const face = receiptFace(outcome, context, company, words, locale)
  const doc = docFromSwap(
    {
      // The picture's title carries no sum: the amounts are the person's to show.
      title:
        outcome.kind === 'filled'
          ? company.unit === 'token'
            ? words.ownToken(company.name)
            : words.ownPiece(company.name)
          : face.headline,
      status: outcomeStatus(outcome.kind),
      settlement: settled.settlement,
      context,
      at: settled.at,
      rule: ruleMark !== null,
      multipliers: { receive: company.multiplier },
    },
    locale,
  )
  return (
    <View className="gap-4 pb-2">
      <BuyReceiptFace face={face} />
      {ruleMark ? (
        // The receipt's mark of the rule, and when it reminds next («квитанція з позначкою правила»).
        <RuleMarkLine
          line={`${ruleMark.words.byRule} · ${ruleWhenLine(ruleMark.rule, locale)}`}
          next={nextOfRule ? `${ruleMark.words.nextPurchase}: ${nextOfRule}` : null}
        />
      ) : null}
      {outcome.kind === 'filled' ? (
        <Button title={words.done} size="lg" onPress={onDone} />
      ) : (
        <Button title={words.tryAgain} size="lg" onPress={trade.reset} />
      )}
      {weekly !== null && onBuyWeekly ? (
        <Button title={ruleWords.buyWeekly} variant="secondary" size="lg" onPress={() => onBuyWeekly(weekly)} />
      ) : null}
      <QuietLinks links={[...links, { label: receiptWords.share, onPress: () => setSharing(true) }]} />
      {sharing ? <ShareReceiptSheet doc={doc} visible onClose={() => setSharing(false)} /> : null}
    </View>
  )
}

/** A purchase's mark of the rule it was made under — «За правилом · Щотижня · чт о 19:00» — and when the rule reminds next. */
export function RuleMarkLine({ line, next }: { line: string; next: string | null }) {
  return (
    <View className="items-center gap-1">
      <View className="flex-row items-center gap-1.5">
        <Icon name="repeat-outline" size={14} color="muted" />
        <Txt variant="ui" tone="muted" tabular>
          {line}
        </Txt>
      </View>
      {next ? (
        <Txt variant="ui" tone="faint" className="text-center" tabular>
          {next}
        </Txt>
      ) : null}
    </View>
  )
}

export function QuietLinks({ links }: { links: readonly { label: string; onPress: () => void }[] }) {
  return (
    <View className="flex-row flex-wrap items-center justify-center gap-x-5 gap-y-1">
      {links.map((link) => (
        <Pressable
          key={link.label}
          accessibilityRole="button"
          accessibilityLabel={link.label}
          onPress={link.onPress}
          hitSlop={8}
          className="py-1 active:opacity-70"
        >
          <Txt variant="ui" tone="muted">
            {link.label}
          </Txt>
        </Pressable>
      ))}
    </View>
  )
}
