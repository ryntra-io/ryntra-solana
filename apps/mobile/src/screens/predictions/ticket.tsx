import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/button'
import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { Field } from '@/components/field'
import { HelpDot } from '@/components/help-dot'
import { ReviewBlock, type ReviewRow } from '@/components/review-block'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import {
  orderSettled,
  spendOf,
  SPEND_MAX_USD,
  SPEND_MIN_USD,
  type PaperOrder,
  type PaperReview,
} from '@/features/predictions/account-model'
import { PREDICTIONS_COPY } from '@/features/predictions/predictions-copy'
import {
  chanceText,
  outcomeWord,
  payoutOf,
  type PredictionEvent,
  type PredictionMarket,
  type PredictionOutcome,
} from '@/features/predictions/predictions-model'
import { askReview, followOrder, placeOrder, usePredictionAccount } from '@/features/predictions/use-predictions'
import { PRIVATE_QUERY_KEY, useAccount } from '@/features/session/use-account'
import { useNow } from '@/hooks/use-now'
import { ApiError } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { formatAmount, formatClock, formatUsd, formatUsdSigned } from '@/utils/format'

import { PredictionsAccountCard } from './account-card'

/** The sums one tap puts in the field — the web ticket's own $10 among them. */
const PRESETS = ['5', '10', '25', '50'] as const

type Step =
  | Readonly<{ at: 'amount' }>
  | Readonly<{ at: 'review'; review: PaperReview }>
  | Readonly<{ at: 'placing'; review: PaperReview }>
  | Readonly<{ at: 'done'; order: PaperOrder }>

/**
 * The simulated order on one outcome (M12): the sum and what it returns at the market's price; the Review the server
 * prices and checks (`POST /api/predictions/quote`); the order placed and followed until it settles. Before the account
 * is open, the sheet holds the account card's own steps — connect, sign in, open — and nothing else. No money moves:
 * AGG holds the simulated balance and fills the order; the phone signs nothing here.
 */
export function TicketSheet({
  event,
  market,
  outcome,
  onClose,
}: {
  event: PredictionEvent
  market: PredictionMarket
  outcome: PredictionOutcome
  onClose: () => void
}) {
  const words = useCopy(PREDICTIONS_COPY)
  const locale = useLocale()
  const queryClient = useQueryClient()
  const account = useAccount()
  const read = usePredictionAccount(account.session)
  const [amount, setAmount] = useState('10')
  const [step, setStep] = useState<Step>({ at: 'amount' })
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const now = useNow(1_000)
  const label = outcomeWord(outcome.label, locale)
  const linked = read.data?.link.state === 'active'
  const spend = spendOf(amount)
  const min = SPEND_MIN_USD
  const inRange = spend !== null && spend >= min && spend <= SPEND_MAX_USD
  const payout = spend !== null ? payoutOf(spend, outcome.probability) : null
  const refreshAccount = () => queryClient.invalidateQueries({ queryKey: [PRIVATE_QUERY_KEY, 'predictions-account'] })

  const failed = (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.code === 'NOT_LINKED') {
        void refreshAccount()
        return words.linkExpired
      }
      if (error.code === 'QUOTE_EXPIRED') return words.quoteExpired
      if (error.code === 'ORDER_REFUSED' || error.code === 'QUOTE_UNAVAILABLE') return words.cannotPlace
    }
    return words.failed
  }

  const review = async () => {
    if (!account.session || spend === null) return
    setBusy(true)
    setFailure(null)
    try {
      const answer = await askReview(account.session, {
        eventId: event.id,
        marketId: market.id,
        outcomeId: outcome.id,
        spendUsd: spend,
        locale,
      })
      if (answer) setStep({ at: 'review', review: answer })
      else setFailure(words.failed)
    } catch (error) {
      setFailure(failed(error))
    } finally {
      setBusy(false)
    }
  }

  const place = async (reviewed: PaperReview) => {
    if (!account.session) return
    const session = account.session
    setStep({ at: 'placing', review: reviewed })
    setFailure(null)
    try {
      const placed = await placeOrder(session, reviewed.quoteId)
      if (!placed) throw new Error('No order in the answer.')
      // Placed: what follows only reads its state again — a failed read shows it on its way, never as failed.
      const settled = orderSettled(placed.state) ? placed : await followOrder(session, placed).catch(() => placed)
      setStep({ at: 'done', order: settled })
    } catch (error) {
      // The order may stand on the server whatever the phone heard: the account is read again before anything else.
      setStep({ at: 'review', review: reviewed })
      setFailure(failed(error))
    } finally {
      void refreshAccount()
    }
  }

  const close = () => {
    if (step.at === 'placing') return
    onClose()
  }

  const presets: readonly Choice<string>[] = PRESETS.map((value) => ({ value, label: `$${value}` }))

  let body
  if (!account.session || !linked) {
    body = (
      <View className="pb-2">
        <PredictionsAccountCard onOpen={() => undefined} />
      </View>
    )
  } else if (step.at === 'done') {
    const order = step.order
    body = (
      <View className="gap-3 pb-2">
        <Txt
          variant="title"
          tone={order.state === 'filled' ? 'success' : order.state === 'submitted' ? 'fg' : 'warning'}
        >
          {words.placedTitle[order.state]}
        </Txt>
        <Txt variant="ui" tone="muted">
          {words.placedLine[order.state]}
        </Txt>
        <Button title={words.done} onPress={onClose} />
      </View>
    )
  } else if (step.at === 'review' || step.at === 'placing') {
    const reviewed = step.review
    const rows: ReviewRow[] = [
      { label: words.chanceOf(outcomeWord(reviewed.label, locale)), value: chanceText(reviewed.probability, locale) },
      { label: words.shares, value: formatAmount(reviewed.shares, 2, locale) },
      { label: words.fees, value: formatUsd(reviewed.feesUsd, locale) },
      { label: words.total, value: formatUsd(reviewed.totalUsd, locale) },
      { label: words.payout, value: formatUsd(reviewed.payoutUsd, locale), emphasis: true },
      {
        label: words.profit,
        value: formatUsdSigned(reviewed.profitUsd, locale),
        tone: (reviewed.profitUsd ?? 0) >= 0 ? 'success' : 'danger',
      },
      { label: words.maxLoss, value: formatUsd(reviewed.maxLossUsd, locale), tone: 'danger' },
    ]
    const expired = reviewed.expiresAt !== null && Date.parse(reviewed.expiresAt) <= now
    body = (
      <View className="gap-3 pb-2">
        <ReviewBlock
          rows={rows}
          warnings={[
            ...new Set(
              reviewed.checks.map((check) =>
                check.routeCode === null
                  ? check.detail
                  : check.routeCode === 'low_liquidity'
                    ? words.routeThin
                    : check.routeCode === 'region'
                      ? words.routeRegion
                      : check.routeCode === 'account'
                        ? words.routeAccount
                        : words.routeOther,
              ),
            ),
          ]}
        />
        <View className="flex-row items-start gap-2">
          <Txt variant="labelSm" tone="faint" className="flex-1">
            {`${words.holder}: ${words.holderPaper}`}
          </Txt>
          <HelpDot title={words.custodyTitle} body={words.custody} />
        </View>
        {failure && !(expired && failure === words.quoteExpired) ? (
          <Txt variant="ui" tone="danger">
            {failure}
          </Txt>
        ) : null}
        {expired ? (
          <Txt variant="ui" tone="warning">
            {words.quoteExpired}
          </Txt>
        ) : reviewed.expiresAt ? (
          <Txt variant="labelSm" tone="faint">
            {words.validUntil(formatClock(reviewed.expiresAt))}
          </Txt>
        ) : null}
        {expired ? (
          <Button title={words.review} variant="secondary" onPress={() => void review()} loading={busy} />
        ) : (
          <Button
            title={step.at === 'placing' ? words.placing : words.place}
            onPress={() => void place(reviewed)}
            loading={step.at === 'placing'}
            disabled={!reviewed.canPlace || step.at === 'placing'}
          />
        )}
        {!reviewed.canPlace && !expired ? (
          <Txt variant="labelSm" tone="faint">
            {words.cannotPlace}
          </Txt>
        ) : null}
      </View>
    )
  } else {
    body = (
      <View className="gap-3 pb-2">
        <Field
          label={words.amount}
          value={amount}
          onChangeText={(text) => {
            setAmount(text)
            setFailure(null)
          }}
          keyboardType="decimal-pad"
          hint={words.amountHint(formatUsd(min, locale), formatUsd(SPEND_MAX_USD, locale))}
          error={
            amount.trim().length > 0 && !inRange
              ? words.amountHint(formatUsd(min, locale), formatUsd(SPEND_MAX_USD, locale))
              : null
          }
        />
        <ChoiceChips choices={presets} value={amount} onChange={setAmount} size="sm" fill />
        <View className="gap-1">
          <Txt variant="ui">{words.ifWins(label, payout !== null ? formatUsd(payout, locale) : '—')}</Txt>
          <Txt variant="labelSm" tone="danger">
            {words.ifLoses(spend !== null ? formatUsd(spend, locale) : '—')}
          </Txt>
        </View>
        {failure ? (
          <Txt variant="ui" tone="danger">
            {failure}
          </Txt>
        ) : null}
        <Button
          title={busy ? words.reviewing : words.review}
          onPress={() => void review()}
          loading={busy}
          disabled={!inRange || busy}
        />
      </View>
    )
  }

  return (
    <Sheet
      visible
      title={`${step.at === 'review' || step.at === 'placing' ? words.reviewTitle : words.ticketTitle} · ${label}`}
      subtitle={market.question}
      onClose={close}
      scroll
    >
      {body}
    </Sheet>
  )
}
