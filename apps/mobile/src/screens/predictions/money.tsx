import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { RefreshControl, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { FactRow } from '@/components/fact-row'
import { Field } from '@/components/field'
import { HelpDot } from '@/components/help-dot'
import { QrCode } from '@/components/qr-code'
import { Screen } from '@/components/screen'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import {
  depositRequest,
  newRequestId,
  previewForWallet,
  rawOfTyped,
  receiveFloorRaw,
  usdOfRaw,
  withdrawalCheckable,
  withdrawalFigure,
  withdrawHold,
  withdrawalMoving,
  withdrawalNote,
  type PredictionFunding,
  type Withdrawal,
  type WithdrawalNote,
  type WithdrawPreview,
} from '@/features/predictions/account-model'
import { PREDICTIONS_COPY, type PredictionsCopy } from '@/features/predictions/predictions-copy'
import {
  checkWithdrawal,
  previewWithdrawal,
  sendWithdrawal,
  usePredictionFunding,
  useRefreshFunding,
} from '@/features/predictions/use-predictions'
import { useAccount } from '@/features/session/use-account'
import { PREDICTIONS_PATH } from '@/features/shell/places'
import { useNow } from '@/hooks/use-now'
import { canCopy, copyText } from '@/lib/clipboard'
import { ApiError, isNetworkError, needsSignIn, type Session } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { formatAmount, formatClock, formatMoment, formatUsd } from '@/utils/format'

import { PredictionsAccountCard } from './account-card'

const clockOf = (at: number) => formatClock(new Date(at).toISOString())

/** An address as its first and last few signs — enough to know one's own wallet at a glance. */
const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`

const NOTE_WORD: Readonly<Record<WithdrawalNote, keyof PredictionsCopy>> = {
  mismatch: 'mismatchText',
  aged: 'agedText',
  unknown: 'unknownText',
  unknownOff: 'unknownOffText',
  failed: 'failedText',
  refused: 'refusedText',
}

function WithdrawalRow({
  withdrawal,
  live,
  words,
  locale,
  now,
  onCheck,
  checking,
  last,
}: {
  withdrawal: Withdrawal
  live: boolean
  words: PredictionsCopy
  locale: Locale
  now: number
  onCheck: () => void
  checking: boolean
  last: boolean
}) {
  const noteKey = withdrawalNote(withdrawal, live)
  const note = noteKey ? (words[NOTE_WORD[noteKey]] as string) : null
  const figure = withdrawalFigure(withdrawal)
  const shown = `${figure.approx ? '≈ ' : ''}${formatUsd(figure.usd, locale)}`
  const tone =
    withdrawal.phase === 'completed'
      ? 'success'
      : withdrawal.phase === 'failed' || withdrawal.phase === 'refused'
        ? 'danger'
        : withdrawal.phase === 'partial' || withdrawal.phase === 'unknown'
          ? 'warning'
          : 'fg'
  return (
    <View className={`gap-1 py-2.5 ${last ? '' : 'border-b border-line'}`}>
      <View className="flex-row items-center justify-between gap-3">
        <Txt variant="ui" tone={tone}>
          {withdrawal.aged ? words.phases.unknown : words.phases[withdrawal.phase]}
        </Txt>
        <Txt variant="data">{shown}</Txt>
      </View>
      <Txt variant="labelSm" tone="faint">
        {[
          formatMoment(withdrawal.at, now, locale),
          figure.arrived ? `${words.withdrawSum} ${formatUsd(withdrawal.amountUsd, locale)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Txt>
      {note ? (
        <Txt variant="ui" tone="muted">
          {note}
        </Txt>
      ) : null}
      {withdrawalCheckable(withdrawal, live) ? (
        <Button title={words.check} variant="ghost" size="sm" onPress={onCheck} loading={checking} />
      ) : null}
    </View>
  )
}

type Flow =
  | Readonly<{ stage: 'idle' }>
  | Readonly<{ stage: 'pricing' }>
  | Readonly<{ stage: 'review'; preview: WithdrawPreview; requestId: string; repriced: boolean }>
  | Readonly<{ stage: 'sending'; preview: WithdrawPreview; requestId: string }>

/** Withdraw: an amount, its Review priced by AGG now, and the send under the Review's own request id. */
function WithdrawCard({
  funding,
  session,
  words,
  locale,
  onChanged,
}: {
  funding: PredictionFunding
  session: Session
  words: PredictionsCopy
  locale: Locale
  onChanged: () => Promise<unknown>
}) {
  const [amount, setAmount] = useState('')
  const [flow, setFlow] = useState<Flow>({ stage: 'idle' })
  const [failure, setFailure] = useState<string | null>(null)
  const now = useNow(1_000)
  const raw = rawOfTyped(amount)
  const held = withdrawHold(funding.withdrawals)

  const price = async (body: Readonly<{ amountRaw: string }> | Readonly<{ max: true }>) => {
    setFlow({ stage: 'pricing' })
    setFailure(null)
    try {
      const answer = await previewWithdrawal(session, body)
      // The Review names where the server will send it: a preview for any other wallet than this account's is not reviewed.
      if (!answer || !previewForWallet(answer, funding.destination)) {
        setFlow({ stage: 'idle' })
        setFailure(words.failed)
        return
      }
      // «Усе» puts the sum it priced in the field — none when there is nothing to withdraw.
      const all = usdOfRaw(answer.preview.amountRaw)
      if ('max' in body && all !== null && all > 0) setAmount(String(all))
      setFlow({ stage: 'review', preview: answer.preview, requestId: newRequestId(), repriced: false })
    } catch {
      setFlow({ stage: 'idle' })
      setFailure(words.failed)
    }
  }

  const confirm = async (preview: WithdrawPreview, requestId: string) => {
    if (preview.status !== 'quoted' || !preview.receiveRaw) return
    setFlow({ stage: 'sending', preview, requestId })
    try {
      const outcome = await sendWithdrawal(session, requestId, preview)
      if (outcome?.outcome === 'repriced') {
        setFlow({ stage: 'review', preview: outcome.preview, requestId: newRequestId(), repriced: true })
        return
      }
      setFlow({ stage: 'idle' })
      setAmount('')
    } catch (error) {
      // Whatever the answer, the server may hold a record of this confirmation: the list is read again first.
      setFlow({ stage: 'idle' })
      if (!isNetworkError(error))
        setFailure(
          error instanceof ApiError && error.code === 'WITHDRAWAL_OPEN' ? words.withdrawOpen : words.withdrawCheckBelow,
        )
    } finally {
      await onChanged()
    }
  }

  const review = flow.stage === 'review' || flow.stage === 'sending' ? flow : null
  const preview = review?.preview ?? null
  const quoted = preview?.status === 'quoted'
  const expired = preview?.expiresAt ? Date.parse(preview.expiresAt) <= now : false
  const floor = quoted ? usdOfRaw(receiveFloorRaw(preview!.receiveRaw)) : null
  const maxUsd = usdOfRaw(preview?.maxRaw ?? null)

  return (
    <Card className="gap-3">
      <View className="gap-0.5">
        <Txt variant="title">{words.withdraw}</Txt>
        <Txt variant="labelSm" tone="faint" numberOfLines={1}>
          {`${words.withdrawTo} · ${shortAddress(funding.destination)}`}
        </Txt>
      </View>
      {held ? (
        <Txt variant="ui" tone={held === 'mismatch' ? 'warning' : 'muted'}>
          {held === 'mismatch' ? words.withdrawClosed : words.withdrawOpen}
        </Txt>
      ) : (
        <>
          <Field
            label={words.withdrawAmount}
            value={amount}
            onChangeText={(text) => {
              setAmount(text)
              setFailure(null)
            }}
            keyboardType="decimal-pad"
            hint={words.withdrawLimits(
              formatUsd(funding.withdrawMinUsd, locale),
              formatUsd(funding.crossChainMinUsd, locale),
              formatUsd(funding.feeUsd, locale),
            )}
            error={amount.length > 0 && raw === null ? words.withdrawBadAmount : null}
          />
          {failure ? (
            <Txt variant="ui" tone="danger">
              {failure}
            </Txt>
          ) : null}
          <View className="flex-row gap-2">
            <Button
              title={words.withdrawAll}
              variant="secondary"
              onPress={() => void price({ max: true })}
              disabled={flow.stage === 'pricing'}
            />
            <View className="flex-1">
              <Button
                title={flow.stage === 'pricing' ? words.withdrawPricing : words.withdrawPreview}
                onPress={() => raw && void price({ amountRaw: raw })}
                loading={flow.stage === 'pricing'}
                disabled={raw === null || flow.stage === 'pricing'}
              />
            </View>
          </View>
        </>
      )}
      <Sheet
        visible={review !== null}
        title={words.withdrawTitle}
        subtitle={`${words.withdrawTo} · ${shortAddress(funding.destination)}`}
        onClose={() => flow.stage !== 'sending' && setFlow({ stage: 'idle' })}
        scroll
      >
        {review && preview ? (
          <View className="gap-3 pb-2">
            {flow.stage === 'review' && flow.repriced ? (
              <Txt variant="ui" tone="warning">
                {words.withdrawRepriced}
              </Txt>
            ) : null}
            <View>
              <FactRow label={words.withdrawSum} value={formatUsd(usdOfRaw(preview.amountRaw), locale)} />
              {quoted ? (
                <>
                  <FactRow label={words.withdrawFee} value={formatUsd(usdOfRaw(preview.feeRaw), locale)} />
                  <FactRow
                    label={words.withdrawReceive}
                    value={`≈ ${formatUsd(usdOfRaw(preview.receiveRaw), locale)}`}
                    tone="success"
                    last
                  />
                </>
              ) : null}
            </View>
            {quoted ? (
              <>
                {floor !== null ? (
                  <Txt variant="ui" tone="muted">
                    {words.withdrawFloor(formatUsd(floor, locale))}
                  </Txt>
                ) : null}
                <Txt variant="labelSm" tone="faint">
                  {words.withdrawReprice}
                </Txt>
              </>
            ) : (
              <Txt variant="ui" tone="danger">
                {preview.reason === 'below_minimum'
                  ? words.belowMinimum(
                      formatUsd(funding.withdrawMinUsd, locale),
                      formatUsd(funding.crossChainMinUsd, locale),
                    )
                  : `${words.reasons[preview.reason ?? 'other']}${preview.reason === 'above_max' && maxUsd !== null ? ` ${words.atMost(formatUsd(maxUsd, locale))}` : ''}`}
              </Txt>
            )}
            {expired ? (
              <Txt variant="ui" tone="warning">
                {words.quoteExpired}
              </Txt>
            ) : preview.expiresAt ? (
              <Txt variant="labelSm" tone="faint">
                {words.validUntil(formatClock(preview.expiresAt))}
              </Txt>
            ) : null}
            {expired ? (
              <Button
                title={words.withdrawPreview}
                variant="secondary"
                onPress={() => void price({ amountRaw: preview.amountRaw })}
              />
            ) : (
              <Button
                title={flow.stage === 'sending' ? words.withdrawSending : words.withdrawConfirm}
                onPress={() => void confirm(preview, review.requestId)}
                loading={flow.stage === 'sending'}
                disabled={!quoted || flow.stage === 'sending'}
              />
            )}
          </View>
        ) : null}
      </Sheet>
    </Card>
  )
}

function DepositCard({ funding, words }: { funding: PredictionFunding; words: PredictionsCopy }) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const deposit = funding.deposit
  if (deposit.state !== 'ready') {
    const line =
      deposit.state === 'preparing'
        ? words.depositPreparing
        : deposit.state === 'unsupported'
          ? words.depositUnsupported
          : words.depositFailed
    return (
      <Card className="gap-2">
        <Txt variant="title">{words.depositAddress}</Txt>
        <Txt variant="ui" tone="muted">
          {line}
        </Txt>
      </Card>
    )
  }
  return (
    <Card className="gap-3">
      <Txt variant="title">{words.depositAddress}</Txt>
      <View className="items-center">
        <QrCode value={deposit.address} size={184} label={words.depositAddress} />
      </View>
      <Txt variant="data" selectable className="text-center">
        {deposit.address}
      </Txt>
      <Txt variant="ui" tone="warning">
        {words.depositOnly}
      </Txt>
      <View className="flex-row gap-2">
        {canCopy ? (
          <Button
            title={copied ? words.copied : words.copy}
            variant="secondary"
            onPress={() => setCopied(copyText(deposit.address))}
          />
        ) : null}
        <View className="flex-1">
          <Button
            title={words.sendFromWallet}
            onPress={() => router.push({ pathname: '/money/send', params: { to: depositRequest(deposit) } } as never)}
          />
        </View>
      </View>
    </Card>
  )
}

/**
 * «Прогнози → Гроші» (M12, PM-S1 on the web): the live money of the account — USDC on Solana that AGG holds in a
 * managed wallet (Portal). While live money is off, one line says so and nothing else is drawn; on, the balance, the
 * Solana deposit address (sent from the person's own wallet through «Надіслати»), deposits, a withdrawal into the
 * proven Solana wallet only — priced, reviewed and sent under one request id — and the withdrawals' states.
 */
export function PredictionsMoneyScreen() {
  const router = useRouter()
  const words = useCopy(PREDICTIONS_COPY)
  const shared = useSharedCopy()
  const locale = useLocale()
  const { colors } = useTheme()
  const now = useNow(30_000)
  const account = useAccount()
  const session = account.session
  const peek = usePredictionFunding(session)
  // One read of the money; a second observer of the same read asks it sooner while a withdrawal moves.
  const moving = peek.data?.withdrawals.some((w) => withdrawalMoving(w, peek.data?.enabled ?? false)) ?? false
  const read = usePredictionFunding(session, moving)
  const refresh = useRefreshFunding(session)
  const [checking, setChecking] = useState<string | null>(null)
  const [pulled, setPulled] = useState(false)
  const back = () => (router.canGoBack() ? router.back() : router.replace(PREDICTIONS_PATH as never))

  const check = async (requestId: string) => {
    if (!session) return
    setChecking(requestId)
    try {
      await checkWithdrawal(session, requestId)
    } catch {
      // The list below is read again either way; it says where the withdrawal stands.
    } finally {
      setChecking(null)
      await refresh()
    }
  }

  // A withdrawal whose end is not known is asked about once on its own, a few seconds after it shows.
  const asked = useRef<string | null>(null)
  const live = read.data?.enabled ?? false
  const unknown = read.data?.withdrawals.find((w) => withdrawalCheckable(w, live))
  useEffect(() => {
    if (!unknown || asked.current === unknown.requestId) return undefined
    const id = unknown.requestId
    const timer = setTimeout(() => {
      asked.current = id
      void check(id)
    }, 5_000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asked once per request id, not on every read
  }, [unknown?.requestId])

  const pull = () => {
    setPulled(true)
    void read.refetch().finally(() => setPulled(false))
  }

  // The money needs the simulation's account open: without it, the account card's own step.
  const unlinked = read.isError && read.error instanceof ApiError && read.error.code === 'NOT_LINKED'

  let body
  if (unlinked) {
    body = (
      <PredictionsAccountCard
        onOpen={(eventId) => router.push({ pathname: '/predictions/[eventId]', params: { eventId } } as never)}
      />
    )
  } else if (!session || (read.isError && needsSignIn(read.error))) {
    body = (
      <StateView
        icon="wallet-outline"
        title={words.signInLine}
        action={
          account.address
            ? { title: shared.signIn, onPress: () => void account.signIn(), loading: account.signingIn }
            : {
                title: shared.connectWallet,
                onPress: () => void account.connect(),
                loading: account.busy === 'connect',
              }
        }
      />
    )
  } else if (read.data) {
    const funding = read.data
    body = (
      <>
        <Card className="gap-2">
          <View className="flex-row items-center justify-between gap-3">
            <Txt variant="title">{words.balance}</Txt>
            <Txt variant="labelSm" tone="faint">
              {words.readAt(clockOf(funding.readAt))}
            </Txt>
          </View>
          {funding.enabled ? (
            <>
              <Txt variant="dataLg">{formatUsd(funding.cashUsd, locale)}</Txt>
              <Txt variant="labelSm" tone="faint">
                {`${formatUsd(funding.availableUsd, locale)} ${words.available} · ${words.moneyLine}`}
              </Txt>
              {funding.providerDown ? (
                <Txt variant="ui" tone="muted">
                  {words.providerDown}
                </Txt>
              ) : null}
            </>
          ) : (
            <Txt variant="ui" tone="muted">
              {words.moneyOff}
            </Txt>
          )}
        </Card>
        {funding.enabled ? <DepositCard funding={funding} words={words} /> : null}
        {funding.enabled && funding.deposits.length > 0 ? (
          <Card className="gap-1">
            <Txt variant="title">{words.deposits}</Txt>
            {funding.deposits.map((row, index) => (
              <FactRow
                key={row.id}
                label={`${formatMoment(row.at, now, locale)} · ${words.depositStates[row.state]}`}
                value={row.amount !== null ? `${formatAmount(row.amount, 2, locale, 2)} ${row.symbol}` : '—'}
                tone={row.state === 'credited' ? 'success' : 'fg'}
                last={index === funding.deposits.length - 1}
              />
            ))}
          </Card>
        ) : null}
        {funding.enabled ? (
          <WithdrawCard funding={funding} session={session} words={words} locale={locale} onChanged={refresh} />
        ) : null}
        {funding.withdrawals.length > 0 ? (
          <Card className="gap-1">
            <Txt variant="title">{words.withdrawals}</Txt>
            {funding.withdrawals.map((withdrawal, index) => (
              <WithdrawalRow
                key={withdrawal.requestId}
                withdrawal={withdrawal}
                live={funding.enabled}
                words={words}
                locale={locale}
                now={now}
                onCheck={() => void check(withdrawal.requestId)}
                checking={checking === withdrawal.requestId}
                last={index === funding.withdrawals.length - 1}
              />
            ))}
          </Card>
        ) : null}
      </>
    )
  } else if (read.isPending) {
    body = <Skeleton className="h-40 w-full rounded-sm" />
  } else {
    const offline = isNetworkError(read.error)
    body = (
      <StateView
        icon={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={offline ? words.noConnection : words.down}
        action={{ title: words.tryAgain, onPress: () => void read.refetch(), loading: read.isFetching }}
      />
    )
  }

  return (
    <Screen
      title={words.money}
      onBack={back}
      backLabel={shared.back}
      right={<HelpDot title={words.custodyTitle} body={words.custody} />}
      refreshControl={
        session ? (
          <RefreshControl
            refreshing={pulled}
            onRefresh={pull}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        ) : undefined
      }
    >
      {body}
    </Screen>
  )
}
