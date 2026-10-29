import { useState, type ReactNode } from 'react'
import { Keyboard, Pressable, TextInput, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { Button } from '@/components/button'
import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { explorerUrl } from '@/features/history/history-model'
import { BUY_COPY, type BuyCopy } from '@/features/invest/buy-copy'
import {
  approxUsd,
  buyFailureKey,
  buyOutcome,
  dollarsText,
  unitsFromRaw,
  unitsPhrase,
  type BuyRow,
} from '@/features/invest/buy-model'
import { CONVERT_COPY } from '@/features/invest/convert-copy'
import { SALE_COPY, type SaleCopy } from '@/features/invest/sale-copy'
import { heldUnitsText, isCompanySale, type SaleCompany, type SalePct } from '@/features/invest/sale-model'
import { useSale, useSaleCompany, type SaleController, type SaleHint } from '@/features/invest/use-sale'
import { RECEIPTS_COPY } from '@/features/receipts/copy'
import { docFromSwap, outcomeStatus } from '@/features/receipts/receipt-doc'
import { useOpenPlace, usePlaceHold } from '@/features/shell/open-place'
import { PORTFOLIO_HISTORY_PATH } from '@/features/shell/shell'
import { useCopy } from '@/lib/i18n'
import { TopUpSheet } from '@/screens/home/top-up-sheet'
import { ShareReceiptSheet } from '@/screens/receipts/share-receipt'
import { type, useTheme } from '@/theme'
import { DASH } from '@/utils/format'
import { openLink } from '@/lib/open-link'

import { BuyReceiptFace, QuietLinks, ReviewTable, SignInHelp, type ReceiptFace } from './buy-sheet'

const QUOTE_UNREAD = new Set(['offline', 'tooLong', 'providerDown', 'rateLimited', 'failed'])

/**
 * «Продати» from a position — a company's page and a position in Portfolio
 * open the same sheet, as the web's sale from a position: the sum in dollars
 * or a share of the position (25 · 50 · 75 · 100 %, the whole position exactly),
 * what it brings and costs from the live quote, «Перевірка» as the server
 * counts it, the wallet's signature through Mobile Wallet Adapter, the server's
 * one submission, and «Продано» with its receipt — on Trade's own path, so a
 * signature the app closed on is checked, never sent twice.
 *
 * Nothing here signs or spends: the wallet does, when the person confirms.
 */
export function SellSheet({
  visible,
  mint,
  hint,
  onClose,
}: {
  visible: boolean
  mint: string
  /** What is known of the company before its read answers. */
  hint: SaleHint
  onClose: () => void
}) {
  if (!visible) return null
  return <SaleLoader mint={mint} hint={hint} onClose={onClose} />
}

function SaleLoader({ mint, hint, onClose }: { mint: string; hint: SaleHint; onClose: () => void }) {
  const words = useCopy(SALE_COPY)
  const buyWords = useCopy(BUY_COPY)
  const read = useSaleCompany(mint, hint)
  if (read.company) return <SellFlow company={read.company} onClose={onClose} />
  const logo = <AssetIcon symbol={hint.name} icon={hint.icon} size={32} />
  return (
    <Sheet visible title={words.sellTitle(hint.name)} leading={logo} onClose={onClose} scroll>
      {read.failed ? (
        <View className="gap-4 pb-2">
          <Txt variant="body" tone="muted" className="text-center">
            {words.companyUnread}
          </Txt>
          <Button title={buyWords.tryAgain} size="lg" onPress={read.retry} />
          <Button title={buyWords.cancel} variant="ghost" onPress={onClose} />
        </View>
      ) : (
        <View className="items-center gap-4 pb-2" accessibilityLabel={words.reading}>
          <Skeleton className="h-12 w-40" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-12 w-full" />
        </View>
      )}
    </Sheet>
  )
}

function SellFlow({ company, onClose }: { company: SaleCompany; onClose: () => void }) {
  const openPlace = useOpenPlace()
  const words = useCopy(SALE_COPY)
  const buyWords = useCopy(BUY_COPY)
  const fails = useCopy(CONVERT_COPY).failures
  const sale = useSale(company)
  const { trade } = sale
  // While it is prepared, signed, sent or checked, a note's tap or a quick action waits for it (`place-hold.ts`).
  usePlaceHold(trade.busy)
  const [topUp, setTopUp] = useState(false)
  const address = trade.account.address

  // Nothing closes the sheet while a Review is being prepared, signed, sent or checked: the flow keeps running and says so.
  const close = () => {
    if (trade.busy) return
    if (trade.phase === 'review') trade.closeReview()
    else if (trade.phase === 'settled') trade.reset()
    onClose()
  }
  const toHistory = () => {
    // A sale being prepared, signed, sent or checked keeps its sheet: History opens once it is not.
    if (trade.busy) return
    close()
    openPlace(PORTFOLIO_HISTORY_PATH)
  }

  const logo = <AssetIcon symbol={company.name} icon={company.icon} size={32} />
  let title = words.sellTitle(company.name)
  let body: ReactNode

  if (trade.phase === 'settled' && trade.settled) {
    title = company.name
    body = (
      <Receipt sale={sale} company={company} words={words} buyWords={buyWords} onDone={close} onHistory={toHistory} />
    )
  } else if (trade.phase === 'recovery' || trade.phase === 'recovering') {
    title = company.name
    const own = trade.attempt ? isCompanySale(trade.attempt.context, company.mint) : true
    body = (
      <View className="gap-4 pb-2">
        <View className="flex-row items-start gap-3">
          <Icon name="time-outline" size={22} color="warningInk" />
          <Txt variant="body" className="flex-1">
            {own ? words.saleUnknownTx : buyWords.earlierTx}
          </Txt>
        </View>
        {trade.failure ? (
          <Txt
            variant="ui"
            tone={
              trade.failure.code === 'BYTES_REBUILT' || trade.failure.code === 'REVIEW_RENEWED' ? 'warning' : 'danger'
            }
          >
            {failureWord(fails, trade.failure.code)}
          </Txt>
        ) : null}
        <Button
          title={trade.phase === 'recovering' ? buyWords.checkingTx : buyWords.checkTx}
          size="lg"
          disabled={trade.phase === 'recovering'}
          onPress={() => void trade.recover()}
        />
        {trade.phase === 'recovering' ? null : <QuietLinks links={[{ label: buyWords.history, onPress: toHistory }]} />}
      </View>
    )
  } else if ((trade.phase === 'review' || trade.phase === 'signing') && trade.prepared && sale.rows) {
    title = buyWords.review
    body = <SaleReview sale={sale} words={words} buyWords={buyWords} fails={fails} />
  } else {
    body = (
      <SaleCompose
        sale={sale}
        company={company}
        words={words}
        buyWords={buyWords}
        fails={fails}
        onDone={close}
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

/** The neutral refusals the issuer's swap and sale already say — a sale is never called a purchase. */
type Fails = (typeof CONVERT_COPY)['en']['failures']

/** A refusal in the sale's words: the wallet's, the session's or the server's. */
function failureWord(fails: Fails, code: string): string {
  return fails[buyFailureKey(code)]
}

/* ---- the sum ---- */

/** What the sum brings and costs, or why it cannot be said yet; a sum under the minimum is said once, on the button. */
function estimateOf(sale: SaleController, words: SaleCopy, buyWords: BuyCopy, fails: Fails): string {
  const { trade, locale, action } = sale
  if (action.kind === 'sell-all') return `${words.overPosition} · ${dollarsText(action.usd, locale)}`
  if (action.kind === 'minimum' || action.kind === 'enter' || action.kind === 'reading' || action.kind === 'none')
    return ' '
  if (action.kind === 'connect' || action.kind === 'sign-in') return ' '
  if (trade.quoteBlocked) return words.saleUnavailable
  // Not sellable now: the button says so, and no estimate stands over it.
  if (action.kind === 'unavailable' && !trade.quoteFailure) return ' '
  if (trade.quoteFailure) {
    const key = buyFailureKey(trade.quoteFailure.code)
    return QUOTE_UNREAD.has(key) ? buyWords.quoteDown : failureWord(fails, trade.quoteFailure.code)
  }
  const estimate = sale.estimate
  if (estimate && estimate.gotUsd !== null)
    return `≈ ${dollarsText(estimate.gotUsd, locale)} USDC · ${buyWords.allCosts} ${
      estimate.costsUsd !== null ? approxUsd(estimate.costsUsd, locale) : DASH
    }`
  return buyWords.pricing
}

type SheetButton = { title: string; onPress?: () => void; disabled?: boolean; loading?: boolean }

function buttonOf(sale: SaleController, words: SaleCopy, buyWords: BuyCopy, onDone: () => void): SheetButton {
  const { trade, action, locale } = sale
  const account = trade.account
  const sum = (usd: number) => dollarsText(usd, locale)
  switch (action.kind) {
    case 'release':
      return { title: buyWords.refreshPrice, onPress: () => void trade.release(), loading: trade.busy }
    case 'connect':
      return { title: buyWords.connect, onPress: () => void account.connect(), loading: account.busy === 'connect' }
    case 'sign-in':
      return { title: buyWords.signIn, onPress: () => void account.signIn(), loading: account.signingIn }
    case 'reading':
      return { title: words.reading, disabled: true }
    case 'none':
      return { title: buyWords.done, onPress: onDone }
    case 'unavailable':
      return { title: words.saleUnavailable, disabled: true }
    case 'sell-all':
      // More than the position: the one action puts the whole position in — never a dead button.
      return { title: words.sellFor(sum(action.usd), true), onPress: () => sale.pickShare(100) }
    case 'minimum':
      return { title: buyWords.minimum, disabled: true }
    case 'enter':
      return { title: words.sell, disabled: true }
    case 'preparing':
      return { title: buyWords.preparing, disabled: true }
    case 'need-sol':
      return { title: buyWords.needSol, disabled: true }
    case 'settling':
      return { title: words.sellFor(sum(action.usd), action.whole), disabled: true }
    case 'sell':
      return {
        title: words.sellFor(sum(action.usd), action.whole),
        onPress: () => {
          Keyboard.dismiss()
          void trade.review()
        },
      }
  }
}

/** A refusal of the wallet, the session or the server, in the sale's words. */
function failureOf(sale: SaleController, buyWords: BuyCopy, fails: Fails): string | null {
  const account = sale.trade.account
  const signIn = account.signInFailure
  if (signIn) {
    if (signIn.kind === 'network') return buyWords.signInOffline
    if (signIn.kind === 'outdated') return buyWords.signInOutdated
    if (signIn.kind === 'no-wallet') return buyWords.failures.noWallet
    return buyWords.signInFailed
  }
  if (account.failure) return account.failure.kind === 'no-wallet' ? buyWords.failures.noWallet : buyWords.connectFailed
  return sale.trade.failure ? failureWord(fails, sale.trade.failure.code) : null
}

/** The sum on the sheet — exported for the development gallery's samples. */
export function SaleCompose({
  sale,
  company,
  words,
  buyWords,
  fails,
  onDone,
  onTopUp,
}: {
  sale: SaleController
  company: SaleCompany
  words: SaleCopy
  buyWords: BuyCopy
  fails: Fails
  onDone: () => void
  onTopUp: () => void
}) {
  const { colors } = useTheme()
  const { trade, locale, action } = sale
  const busy = trade.busy
  const shares: readonly Choice<string>[] = sale.shares.map((share) => ({
    value: String(share.pct),
    label: words.shareLabel[share.pct],
    accessibilityLabel:
      share.usd === null ? words.shareLabel[share.pct] : `${share.pct}% · ${dollarsText(share.usd, locale)}`,
    disabled: !share.offered,
  }))
  const button = buttonOf(sale, words, buyWords, onDone)
  const failure = failureOf(sale, buyWords, fails)
  const estimate = estimateOf(sale, words, buyWords, fails)
  const retry =
    trade.quoteFailure?.retryable === true && (action.kind === 'sell' || action.kind === 'settling')
      ? () => trade.refreshQuote()
      : null
  const heldUnits = heldUnitsText(
    sale.heldRaw,
    { ...company, decimals: sale.decimals, multiplier: sale.multiplier },
    locale,
  )

  if (action.kind === 'none')
    return (
      <View className="gap-4 pb-2">
        <Txt variant="body" tone="muted" className="text-center">
          {words.nothingToSell}
        </Txt>
        <Button title={button.title} size="lg" onPress={button.onPress} />
      </View>
    )

  return (
    <View className="gap-4 pb-2">
      {company.preIpo ? (
        // A private company's sale may not go through: said before any sum; what the token is stands in «Перевірка».
        <View className="flex-row items-start gap-2">
          <Icon name="warning-outline" size={16} color="warningInk" style={{ marginTop: 1 }} />
          <Txt variant="ui" tone="warning" className="flex-1">
            {words.saleMayFail}
          </Txt>
        </View>
      ) : null}

      <TextInput
        value={sale.amountText.length > 0 ? `$${sale.amountText}` : ''}
        onChangeText={sale.setAmountText}
        keyboardType="decimal-pad"
        placeholder="$0"
        placeholderTextColor={colors.fgMuted}
        selectionColor={colors.brand}
        cursorColor={colors.brand}
        accessibilityLabel={buyWords.amount}
        editable={!busy}
        textAlign="center"
        className="text-fg"
        style={[type.display, { fontSize: 44, lineHeight: 52, paddingVertical: 4 }]}
      />

      {shares.length > 0 ? (
        <View accessibilityLabel={words.quickShares}>
          <ChoiceChips
            choices={shares}
            value={sale.pickedPct !== null ? String(sale.pickedPct) : ''}
            onChange={(value) => sale.pickShare(Number(value) as SalePct)}
            quiet
            fill
            disabled={busy}
          />
        </View>
      ) : null}

      {retry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${estimate} ${buyWords.tryAgain}`}
          onPress={retry}
          hitSlop={6}
          className="active:opacity-70"
        >
          <Txt variant="ui" tone="muted" className="text-center" accessibilityLiveRegion="polite">
            {`${estimate} · `}
            <Txt variant="ui" tone="fg">
              {buyWords.tryAgain}
            </Txt>
          </Txt>
        </Pressable>
      ) : estimate.trim().length === 0 ? null : (
        <Txt
          variant="ui"
          tone={action.kind === 'sell-all' ? 'warning' : 'muted'}
          className="text-center"
          tabular
          accessibilityLiveRegion="polite"
        >
          {estimate}
        </Txt>
      )}

      {failure ? (
        <Txt variant="ui" tone="danger" className="text-center">
          {failure}
        </Txt>
      ) : null}

      <Button
        title={button.title}
        size="lg"
        onPress={button.onPress}
        disabled={button.disabled}
        loading={button.loading}
      />

      {heldUnits ? (
        <View className="flex-row flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <Txt variant="ui" tone="muted" className="text-center" tabular>
            {words.heldLine(heldUnits, sale.valueUsd === null ? null : dollarsText(sale.valueUsd, locale))}
          </Txt>
          {action.kind === 'need-sol' ? (
            <Pressable accessibilityRole="button" accessibilityLabel={buyWords.topUp} onPress={onTopUp} hitSlop={8}>
              <Txt variant="ui" tone="fg">
                {`· ${buyWords.topUp}`}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {/* That signing in moves nothing sits behind «?» (ST-4). */}
      {action.kind === 'sign-in' ? <SignInHelp /> : null}
    </View>
  )
}

/* ---- «Перевірка» ---- */

function rowLabel(key: BuyRow['key'], words: SaleCopy, buyWords: BuyCopy): string {
  if (key === 'spend') return words.rowSell
  if (key === 'get') return buyWords.rowGet
  if (key === 'costs') return buyWords.rowCosts
  return buyWords.rowWhat
}

/** «Перевірка» on the sheet — exported for the development gallery's samples. */
export function SaleReview({
  sale,
  words,
  buyWords,
  fails,
}: {
  sale: SaleController
  words: SaleCopy
  buyWords: BuyCopy
  fails: Fails
}) {
  const { trade } = sale
  const rows = sale.rows ?? []
  const left = trade.reviewLeft
  const closed = left !== null && left <= 0
  // Ten seconds is the least a wallet needs to raise its prompt and a person to read and press it (Trade's own rule).
  const signable = !closed && !trade.invalidated && left !== null && left >= 10
  const signing = trade.phase === 'signing'
  const refresh = () => {
    trade.closeReview()
    void trade.review()
  }
  return (
    <View className="gap-4 pb-2">
      <ReviewTable
        rows={rows.map((row) => ({
          key: row.key,
          label: rowLabel(row.key, words, buyWords),
          value: row.value,
          fee: row.fee,
          sub: row.sub,
          caution: row.caution,
          tabular: row.key !== 'what',
        }))}
      />
      {trade.failure ? (
        <Txt
          variant="ui"
          tone={
            trade.failure.code === 'BYTES_REBUILT' || trade.failure.code === 'REVIEW_RENEWED' ? 'warning' : 'danger'
          }
          className="text-center"
        >
          {failureWord(fails, trade.failure.code)}
        </Txt>
      ) : null}
      <Txt variant="ui" tone="muted" className="text-center" tabular>
        {signing ? ' ' : signable ? buyWords.priceHolds(left) : buyWords.priceExpired}
      </Txt>
      {signing ? (
        <Button title={trade.sending ? buyWords.sending : buyWords.inWallet} size="lg" disabled />
      ) : signable ? (
        <Button title={buyWords.sign} size="lg" onPress={() => void trade.sign()} />
      ) : (
        <Button title={buyWords.refreshPrice} size="lg" onPress={refresh} />
      )}
      <Button title={buyWords.cancel} variant="ghost" onPress={trade.closeReview} disabled={signing} />
    </View>
  )
}

/* ---- the receipt ---- */

/**
 * What a settled sale looks like on the sheet — «✓ Продано · $9,97» with
 * «0,0787 частки Apple» under it; the chain's own figures where the answer
 * carries them, the Review's said as such.
 */
export function saleReceiptFace(
  input: Readonly<{
    outcome: ReturnType<typeof buyOutcome>
    context: Parameters<typeof isCompanySale>[0]
    company: Pick<SaleCompany, 'name' | 'unit'>
    multiplier: number | null
    words: SaleCopy
    buyWords: BuyCopy
    locale: Parameters<typeof dollarsText>[1]
  }>,
): ReceiptFace {
  const { outcome, context, words, buyWords, locale } = input
  if (outcome.kind === 'filled') {
    const got = context ? unitsFromRaw(outcome.gotRaw, context.receiveDecimals, null) : null
    const gave = context ? unitsFromRaw(outcome.spentRaw, context.payDecimals, input.multiplier) : null
    return {
      icon: outcome.belowMinimum ? 'alert-circle' : 'checkmark-circle',
      color: outcome.belowMinimum ? 'warningInk' : 'successInk',
      headline: got === null ? words.sold : `${words.sold} · ${dollarsText(got, locale)}`,
      detail:
        gave === null
          ? null
          : `${outcome.fromReview ? '≈ ' : ''}${unitsPhrase(gave, input.company.unit, input.company.name, locale)}`,
      // «≈» says the figure is the Review's; the receipt keeps the network's (ST-4: no line says so).
      note: outcome.belowMinimum ? buyWords.belowMinimum : null,
      noteTone: outcome.belowMinimum ? 'warning' : 'faint',
    }
  }
  if (outcome.kind === 'nothing')
    return {
      icon: 'remove-circle-outline',
      color: 'fgMuted',
      headline: words.nothingSold,
      detail: null,
      note: null,
      noteTone: 'faint',
    }
  if (outcome.kind === 'not-filled')
    return {
      icon: 'close-circle',
      color: 'dangerInk',
      headline: words.saleRejected,
      detail: null,
      note: null,
      noteTone: 'faint',
    }
  return {
    icon: 'time-outline',
    color: 'warningInk',
    headline: words.saleUnknownTx,
    detail: null,
    note: null,
    noteTone: 'faint',
  }
}

function Receipt({
  sale,
  company,
  words,
  buyWords,
  onDone,
  onHistory,
}: {
  sale: SaleController
  company: SaleCompany
  words: SaleCopy
  buyWords: BuyCopy
  onDone: () => void
  onHistory: () => void
}) {
  const receiptWords = useCopy(RECEIPTS_COPY)
  const [sharing, setSharing] = useState(false)
  const { trade, locale } = sale
  const settled = trade.settled!
  const context = settled.context
  const outcome = buyOutcome(settled.settlement, context)
  const own = isCompanySale(context, company.mint)
  const signature = settled.settlement.signature
  const links = [
    { label: buyWords.history, onPress: onHistory },
    ...(signature && outcome.kind !== 'nothing'
      ? [{ label: `${buyWords.transaction} ↗`, onPress: () => openLink(explorerUrl(signature)) }]
      : []),
  ]

  if (!own) {
    // An earlier signature of this wallet, checked here before anything new: said in one line, then the sale again.
    const line =
      outcome.kind === 'filled'
        ? buyWords.earlierDone
        : outcome.kind === 'nothing'
          ? buyWords.earlierNothing
          : outcome.kind === 'not-filled'
            ? buyWords.earlierNotFilled
            : words.saleUnknownTx
    return (
      <View className="gap-4 pb-2">
        <Txt variant="body">{line}</Txt>
        <Button title={buyWords.continue} size="lg" onPress={trade.reset} />
        <QuietLinks links={links} />
      </View>
    )
  }

  const face = saleReceiptFace({
    outcome,
    context,
    company,
    multiplier: sale.multiplier,
    words,
    buyWords,
    locale,
  })

  return (
    <View className="gap-4 pb-2">
      <BuyReceiptFace face={face} />
      {outcome.kind === 'filled' ? (
        <Button title={buyWords.done} size="lg" onPress={onDone} />
      ) : outcome.kind === 'pending' ? (
        // Not known yet: never a second sale — the one check of this signature while it is kept, else the sheet closes.
        trade.attempt ? (
          <Button title={buyWords.checkTx} size="lg" onPress={() => void trade.recover()} />
        ) : (
          <Button title={buyWords.done} size="lg" onPress={onDone} />
        )
      ) : (
        <Button title={buyWords.tryAgain} size="lg" onPress={trade.reset} />
      )}
      <QuietLinks links={[...links, { label: receiptWords.share, onPress: () => setSharing(true) }]} />
      {sharing ? (
        <ShareReceiptSheet
          doc={docFromSwap(
            {
              title: outcome.kind === 'filled' ? words.sold : face.headline,
              status: outcomeStatus(outcome.kind),
              settlement: settled.settlement,
              context,
              at: settled.at,
              multipliers: { pay: sale.multiplier },
            },
            locale,
          )}
          visible
          onClose={() => setSharing(false)}
        />
      ) : null}
    </View>
  )
}

/**
 * «Твоя позиція» on a company's page: its worth as the one figure, what the
 * wallet holds under it, and «Продати» when the company can be sold now.
 */
export function PositionCard({
  label,
  value,
  detail,
  sellLabel,
  onSell,
}: {
  label: string
  /** The position's worth — or, unpriced, what is held. */
  value: string
  /** What is held, under the worth; null when the figure above already says it. */
  detail: string | null
  /** Null when the company cannot be sold now: the position is said, no button that cannot work. */
  sellLabel: string | null
  onSell: () => void
}) {
  return (
    <View className="flex-row items-center gap-3 rounded-sm border border-line bg-surface px-4 py-3">
      <View className="flex-1 gap-0.5">
        <Txt variant="labelSm" tone="muted">
          {label}
        </Txt>
        <Txt variant="title" tabular>
          {value}
        </Txt>
        {detail ? (
          <Txt variant="ui" tone="muted" tabular>
            {detail}
          </Txt>
        ) : null}
      </View>
      {sellLabel ? <Button title={sellLabel} variant="secondary" size="sm" onPress={onSell} /> : null}
    </View>
  )
}
