import { useRouter } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'

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
  formatShareUnits,
  unitsFromRaw,
  type BuyOutcome,
} from '@/features/invest/buy-model'
import {
  deadlineExact,
  isConvert,
  type ConvertMode,
  type ConvertRow,
  type ConvertShare,
  type IssuerEvent,
} from '@/features/invest/conversion-watch'
import { CONVERT_COPY, type ConvertCopy } from '@/features/invest/convert-copy'
import { useConvert, type ConvertController, type ConvertInto, type ConvertToken } from '@/features/invest/use-convert'
import type { TradeContext } from '@/features/trade/trade-model'
import { useCopy, type Locale } from '@/lib/i18n'
import { TopUpSheet } from '@/screens/home/top-up-sheet'
import { openLink } from '@/lib/open-link'

import { BuyReceiptFace, QuietLinks, ReviewTable, type ReceiptFace } from './buy-sheet'

const QUOTE_UNREAD = new Set(['offline', 'tooLong', 'providerDown', 'rateLimited', 'failed'])

/**
 * The swap before the issuer's deadline, and the quiet sale — the IPO and
 * conversion watch's one action, drawn as the
 * purchase's sheet is and running on the same path: Trade's quote, the
 * server's exact «Перевірка», the wallet's signature through Mobile Wallet
 * Adapter, the server's one submission, the receipt, the recovery of a
 * signature the app closed on.
 *
 * «Обміняти на SpaceX (SPCXx)» sells the private token straight into the
 * listed token the issuer points to; «Продати за USDC» sells it for dollars.
 * Either is an ordinary swap at the live quote — the issuer's own word: the
 * conversion «happens through normal trading» — so no ratio is promised.
 *
 * **Скільки.** All, half or a quarter of what the wallet holds, and at once
 * what it brings from the live quote. **«Перевірка»** is four rows — what
 * leaves the wallet, what arrives at least, all costs with the issuer's 1 % on
 * its own line, and the rate against the company's price; the route, the
 * issuer's deadline to the minute, what the listed token is and the issuer's
 * notice are one tap deeper, under «Деталі». **The receipt:** «✓ Обміняно ·
 * 0,0664 SpaceX (SPCXx)» or «✓ Продано · $9,88».
 *
 * Nothing here signs or spends: the wallet does, when the person confirms.
 */
export function ConvertSheet({
  visible,
  mode,
  token,
  into,
  event,
  onClose,
}: {
  visible: boolean
  /** The swap into the listed token, or the sale for USDC; a swap without a target read is offered as the sale. */
  mode: ConvertMode
  token: ConvertToken
  into: ConvertInto | null
  event: IssuerEvent
  onClose: () => void
}) {
  if (!visible) return null
  return <ConvertFlow key={mode} mode={mode} token={token} into={into} event={event} onClose={onClose} />
}

function ConvertFlow({
  mode,
  token,
  into,
  event,
  onClose,
}: {
  mode: ConvertMode
  token: ConvertToken
  into: ConvertInto | null
  event: IssuerEvent
  onClose: () => void
}) {
  const router = useRouter()
  const words = useCopy(CONVERT_COPY)
  const buyWords = useCopy(BUY_COPY)
  const convert = useConvert(token, mode, into)
  const { trade } = convert
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
    close()
    router.push('/history')
  }

  const logo = <AssetIcon symbol={token.name} icon={token.icon} size={32} />
  let title = words.title(convert.mode, token.symbol)
  let body: ReactNode

  if (trade.phase === 'settled' && trade.settled) {
    title = token.name
    body = (
      <Receipt convert={convert} token={token} words={words} buyWords={buyWords} onDone={close} onHistory={toHistory} />
    )
  } else if (trade.phase === 'recovery' || trade.phase === 'recovering') {
    title = token.name
    const own = trade.attempt ? isConvert(trade.attempt.context, token.mint, convert.receive.mint) : true
    body = (
      <View className="gap-4 pb-2">
        <View className="flex-row items-start gap-3">
          <Icon name="time-outline" size={22} color="warningInk" />
          <Txt variant="body" className="flex-1">
            {own ? words.unknownTx : buyWords.earlierTx}
          </Txt>
        </View>
        {trade.failure ? (
          <Txt variant="ui" tone="danger">
            {words.failures[buyFailureKey(trade.failure.code)]}
          </Txt>
        ) : null}
        <Button
          title={trade.phase === 'recovering' ? buyWords.checkingTx : buyWords.checkTx}
          size="lg"
          disabled={trade.phase === 'recovering'}
          onPress={() => void trade.recover()}
        />
        <QuietLinks links={[{ label: buyWords.history, onPress: toHistory }]} />
      </View>
    )
  } else if ((trade.phase === 'review' || trade.phase === 'signing') && trade.prepared && convert.rows) {
    title = buyWords.review
    body = <Review convert={convert} event={event} into={into} words={words} buyWords={buyWords} />
  } else {
    body = (
      <Compose
        convert={convert}
        token={token}
        into={into}
        words={words}
        buyWords={buyWords}
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

/* ---- how much ---- */

/** «SpaceX (SPCXx)» for the swap, «USDC» for the sale. */
function targetWord(convert: ConvertController, into: ConvertInto | null): string {
  return convert.mode === 'swap' && into ? `${into.company} (${into.symbol})` : 'USDC'
}

/** What the share brings and costs, or why it cannot be said yet. */
function estimateOf(convert: ConvertController, into: ConvertInto | null, words: ConvertCopy, buyWords: BuyCopy) {
  const { trade, locale } = convert
  if (convert.giveUnits === null) return ' '
  if (trade.quoteBlocked) return words.unavailable(convert.mode)
  if (trade.quoteFailure) {
    const key = buyFailureKey(trade.quoteFailure.code)
    return QUOTE_UNREAD.has(key) ? buyWords.quoteDown : words.failures[key]
  }
  const estimate = convert.estimate
  if (estimate?.units !== null && estimate?.units !== undefined) {
    const got =
      convert.mode === 'swap'
        ? `${formatShareUnits(estimate.units, locale)} ${targetWord(convert, into)}`
        : `${dollarsText(estimate.units, locale)} USDC`
    return `≈ ${got} · ${buyWords.allCosts} ${estimate.costs ? approxUsd(estimate.costs.totalUsd, locale) : '—'}`
  }
  return buyWords.pricing
}

type SheetButton = { title: string; onPress?: () => void; disabled?: boolean; loading?: boolean }

function buttonOf(convert: ConvertController, words: ConvertCopy, buyWords: BuyCopy, onDone: () => void): SheetButton {
  const { trade, action } = convert
  const account = trade.account
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
    case 'preparing':
      return { title: buyWords.preparing, disabled: true }
    case 'need-sol':
      return { title: buyWords.needSol, disabled: true }
    case 'unavailable':
      return { title: words.unavailable(convert.mode), disabled: true }
    case 'pricing':
      return { title: words.review(convert.mode), disabled: true }
    case 'review':
      return { title: words.review(convert.mode), onPress: () => void trade.review() }
  }
}

/** A refusal of the wallet, the session or the server, in the swap's words. */
function failureOf(convert: ConvertController, words: ConvertCopy, buyWords: BuyCopy): string | null {
  const account = convert.trade.account
  const signIn = account.signInFailure
  if (signIn) {
    if (signIn.kind === 'network') return buyWords.signInOffline
    if (signIn.kind === 'outdated') return buyWords.signInOutdated
    if (signIn.kind === 'no-wallet') return words.failures.noWallet
    return buyWords.signInFailed
  }
  if (account.failure) return account.failure.kind === 'no-wallet' ? words.failures.noWallet : buyWords.connectFailed
  return convert.trade.failure ? words.failures[buyFailureKey(convert.trade.failure.code)] : null
}

function Compose({
  convert,
  token,
  into,
  words,
  buyWords,
  onDone,
  onTopUp,
}: {
  convert: ConvertController
  token: ConvertToken
  into: ConvertInto | null
  words: ConvertCopy
  buyWords: BuyCopy
  onDone: () => void
  onTopUp: () => void
}) {
  const { trade, locale, action } = convert
  const busy = trade.busy
  const shares: readonly Choice<string>[] = convert.shares.map((share) => ({
    value: String(share.pct),
    label: words.shares[share.pct],
    disabled: !share.offered,
  }))
  const button = buttonOf(convert, words, buyWords, onDone)
  const failure = failureOf(convert, words, buyWords)
  const estimate = estimateOf(convert, into, words, buyWords)
  const retry = trade.quoteFailure?.retryable === true && convert.giveUnits !== null ? () => trade.refreshQuote() : null

  return (
    <View className="gap-4 pb-2">
      {/* Where it goes: the token, and the listed token or the dollars. */}
      <View className="flex-row flex-wrap items-center justify-center gap-2">
        <Txt variant="ui" tone="muted">
          {token.symbol}
        </Txt>
        <Icon name="arrow-forward" size={16} color="fgMuted" />
        {convert.mode === 'swap' && into ? (
          <AssetIcon symbol={into.company} icon={into.icon} size={20} />
        ) : (
          <AssetIcon symbol="USDC" icon={convert.receive.icon} size={20} />
        )}
        <Txt variant="ui">{targetWord(convert, into)}</Txt>
      </View>

      {action.kind === 'none' ? (
        <Txt variant="body" tone="muted" className="text-center">
          {words.noneHeld(convert.mode, token.symbol)}
        </Txt>
      ) : (
        <>
          <View className="gap-2">
            <Txt variant="labelSm" tone="faint" caps className="text-center">
              {words.howMuch}
            </Txt>
            <ChoiceChips
              choices={shares}
              value={String(convert.share)}
              onChange={(value) => convert.pickShare(Number(value) as ConvertShare)}
              quiet
              fill
              disabled={busy || action.kind === 'reading'}
            />
          </View>
          <View className="items-center py-1">
            {convert.giveUnits !== null ? (
              <Txt variant="display" tabular className="text-center">
                {`${formatShareUnits(convert.giveUnits, locale)} ${token.symbol}`}
              </Txt>
            ) : (
              <Skeleton className="h-9 w-40" />
            )}
          </View>
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
          ) : (
            <Txt variant="ui" tone="muted" className="text-center" accessibilityLiveRegion="polite">
              {estimate}
            </Txt>
          )}
        </>
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

      {action.kind === 'sign-in' ? (
        <Txt variant="ui" tone="faint" className="text-center">
          {buyWords.signInLine}
        </Txt>
      ) : null}
      {action.kind === 'need-sol' ? (
        <Pressable accessibilityRole="button" accessibilityLabel={buyWords.topUp} onPress={onTopUp} hitSlop={8}>
          <Txt variant="ui" tone="fg" className="text-center">
            {buyWords.topUp}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  )
}

/* ---- «Перевірка» ---- */

const ROW_LABEL: Readonly<Record<ConvertRow['key'], keyof ConvertCopy>> = {
  give: 'rowGive',
  get: 'rowGet',
  costs: 'rowCosts',
  rate: 'rowRate',
}

function Review({
  convert,
  event,
  into,
  words,
  buyWords,
}: {
  convert: ConvertController
  event: IssuerEvent
  into: ConvertInto | null
  words: ConvertCopy
  buyWords: BuyCopy
}) {
  const { trade, locale } = convert
  const [details, setDetails] = useState(false)
  const rows = convert.rows ?? []
  const left = trade.reviewLeft
  const closed = left !== null && left <= 0
  // Ten seconds is the least a wallet needs to raise its prompt and a person to read and press it (Trade's own rule).
  const signable = !closed && !trade.invalidated && left !== null && left >= 10
  const signing = trade.phase === 'signing'
  const refresh = () => {
    trade.closeReview()
    void trade.review()
  }
  const order = trade.prepared?.order.order ?? null
  const route = order && order.route.length > 0 ? order.route.map((hop) => hop.label).join(' → ') : null
  const facts: readonly { label: string; value: string; onPress?: () => void }[] = [
    ...(route ? [{ label: words.route, value: route }] : []),
    { label: words.issuerDeadline, value: deadlineExact(event.deadline, locale) },
    ...(convert.mode === 'swap' && into?.truth ? [{ label: words.whatYouGet, value: into.truth }] : []),
    ...(event.noticeUrl
      ? [
          {
            label: words.issuerNotice,
            value: `${event.noticeUrl.replace(/^https:\/\/(www\.)?/, '')} ↗`,
            onPress: () => openLink(event.noticeUrl!),
          },
        ]
      : []),
  ]
  return (
    <View className="gap-4 pb-2">
      <ReviewTable
        rows={rows.map((row) => ({
          key: row.key,
          label: words[ROW_LABEL[row.key]] as string,
          value: row.value,
          fee: row.fee,
          sub: row.sub,
          inlineSub: row.key === 'give',
        }))}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: details }}
        onPress={() => setDetails((open) => !open)}
        className="flex-row items-center justify-between rounded-sm border border-line bg-surface px-4 py-3 active:bg-hover"
      >
        <Txt variant="ui" tone="muted">
          {details ? words.hideDetails : words.details}
        </Txt>
        <Icon name={details ? 'chevron-up' : 'chevron-down'} size={16} color="fgMuted" />
      </Pressable>
      {details ? (
        <View className="gap-3 px-1">
          {facts.map((fact) => (
            <View key={fact.label} className="gap-0.5">
              <Txt variant="labelSm" tone="faint">
                {fact.label}
              </Txt>
              {fact.onPress ? (
                <Pressable accessibilityRole="link" accessibilityLabel={fact.label} onPress={fact.onPress} hitSlop={6}>
                  <Txt variant="ui" tone="fg">
                    {fact.value}
                  </Txt>
                </Pressable>
              ) : (
                <Txt variant="ui" tabular>
                  {fact.value}
                </Txt>
              )}
            </View>
          ))}
          <Txt variant="ui" tone="muted">
            {words.swapIsTrade}
          </Txt>
        </View>
      ) : null}
      {trade.failure ? (
        <Txt variant="ui" tone="danger" className="text-center">
          {words.failures[buyFailureKey(trade.failure.code)]}
        </Txt>
      ) : null}
      <Txt variant="ui" tone="faint" className="text-center" tabular>
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
 * What a settled swap or sale looks like on the sheet — «✓ Обміняно · 0,0664
 * SpaceX (SPCXx)» with «за 0,0845 SPACEX» under it, «✓ Продано · $9,88»; the
 * chain's own figures where the answer carries them, the Review's said as such.
 */
export function convertReceiptFace(
  input: Readonly<{
    outcome: BuyOutcome
    mode: ConvertMode
    context: TradeContext | null
    /** The token that left, as the issuer names it. */
    symbol: string
    multiplier: number | null
    intoMultiplier: number | null
    words: ConvertCopy
    buyWords: BuyCopy
    locale: Locale
  }>,
): ReceiptFace {
  const { outcome, mode, context, words, buyWords, locale } = input
  if (outcome.kind === 'filled') {
    const swap = mode === 'swap'
    // What arrived, in the unit the wallet shows: the listed token through its own multiplier, dollars as they are.
    const got = context
      ? unitsFromRaw(outcome.gotRaw, context.receiveDecimals, swap ? input.intoMultiplier : null)
      : null
    const gave = context ? unitsFromRaw(outcome.spentRaw, context.payDecimals, input.multiplier) : null
    const what =
      got === null || !context
        ? null
        : swap
          ? `${formatShareUnits(got, locale)} ${context.receive.name} (${context.receive.symbol})`
          : dollarsText(got, locale)
    return {
      icon: outcome.belowMinimum ? 'alert-circle' : 'checkmark-circle',
      color: outcome.belowMinimum ? 'warningInk' : 'successInk',
      headline: what ? `${words.done(mode)} · ${what}` : words.done(mode),
      detail:
        gave === null
          ? null
          : `${outcome.fromReview ? '≈ ' : ''}${words.receiptFor(`${formatShareUnits(gave, locale)} ${input.symbol}`)}`,
      note: outcome.belowMinimum ? buyWords.belowMinimum : outcome.fromReview ? buyWords.fromReview : null,
      noteTone: outcome.belowMinimum ? 'warning' : 'faint',
    }
  }
  if (outcome.kind === 'nothing')
    return {
      icon: 'remove-circle-outline',
      color: 'fgMuted',
      headline: words.nothingMoved,
      detail: null,
      note: null,
      noteTone: 'faint',
    }
  if (outcome.kind === 'not-filled')
    return {
      icon: 'close-circle',
      color: 'dangerInk',
      headline: words.rejected(mode),
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

function Receipt({
  convert,
  token,
  words,
  buyWords,
  onDone,
  onHistory,
}: {
  convert: ConvertController
  token: ConvertToken
  words: ConvertCopy
  buyWords: BuyCopy
  onDone: () => void
  onHistory: () => void
}) {
  const { trade, locale } = convert
  const settled = trade.settled!
  const context = settled.context
  const outcome = buyOutcome(settled.settlement, context)
  const own = isConvert(context, token.mint, convert.receive.mint)
  const signature = settled.settlement.signature
  const links = [
    { label: buyWords.history, onPress: onHistory },
    ...(signature && outcome.kind !== 'nothing'
      ? [{ label: `${buyWords.transaction} ↗`, onPress: () => openLink(explorerUrl(signature)) }]
      : []),
  ]

  if (!own) {
    // An earlier signature of this wallet, checked here before anything new: said in one line, then the swap again.
    const line =
      outcome.kind === 'filled'
        ? buyWords.earlierDone
        : outcome.kind === 'nothing'
          ? buyWords.earlierNothing
          : outcome.kind === 'not-filled'
            ? buyWords.earlierNotFilled
            : words.unknownTx
    return (
      <View className="gap-4 pb-2">
        <Txt variant="body">{line}</Txt>
        <Button title={buyWords.continue} size="lg" onPress={trade.reset} />
        <QuietLinks links={links} />
      </View>
    )
  }

  const face = convertReceiptFace({
    outcome,
    mode: convert.mode,
    context,
    symbol: token.symbol,
    multiplier: convert.multiplier,
    intoMultiplier: convert.intoMultiplier,
    words,
    buyWords,
    locale,
  })

  return (
    <View className="gap-4 pb-2">
      <BuyReceiptFace face={face} />
      {outcome.kind === 'filled' ? (
        <Button title={buyWords.done} size="lg" onPress={onDone} />
      ) : (
        <Button title={buyWords.tryAgain} size="lg" onPress={trade.reset} />
      )}
      <QuietLinks links={links} />
    </View>
  )
}
