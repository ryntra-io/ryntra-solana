import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { DoorRow } from '@/components/door-row'
import { FactRow } from '@/components/fact-row'
import { HelpDot } from '@/components/help-dot'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { linkFailureOf, type PaperPosition, type PredictionAccount } from '@/features/predictions/account-model'
import { PREDICTIONS_COPY, type PredictionsCopy } from '@/features/predictions/predictions-copy'
import { chanceText, outcomeWord } from '@/features/predictions/predictions-model'
import { useLinkAccount, usePredictionAccount } from '@/features/predictions/use-predictions'
import { walletErrorKind } from '@/features/session/session-client'
import { useAccount } from '@/features/session/use-account'
import { PREDICTIONS_MONEY_PATH } from '@/features/shell/places'
import { useWallet } from '@/features/wallet/use-wallet'
import { ApiError, needsSignIn } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { formatAmount, formatClock, formatUsd, formatUsdSigned } from '@/utils/format'

/** How many positions the card shows before «Усі позиції»: the events stay in reach under it. */
const POSITIONS_SHOWN = 3

/** The link's failure in one line: AGG busy, no linking now, the wallet's own no, anything else. */
export function linkFailureLine(error: unknown, words: PredictionsCopy): string {
  const failure = linkFailureOf(error instanceof ApiError ? error.code : null, walletErrorKind(error) === 'cancelled')
  return {
    busy: words.linkBusy,
    unavailable: words.linkUnavailable,
    declined: words.linkDeclined,
    failed: words.linkFailed,
  }[failure]
}

/** One simulated position: its market and outcome, its shares; its value and result on the right. */
export function PaperPositionRow({
  position,
  words,
  locale,
  onPress,
  last,
}: {
  position: PaperPosition
  words: PredictionsCopy
  locale: Locale
  onPress?: () => void
  last?: boolean
}) {
  const label = outcomeWord(position.label, locale)
  const result =
    position.won === true ? words.won : position.won === false ? words.lost : formatUsdSigned(position.pnlUsd, locale)
  const tone = position.won === false || (position.won === null && (position.pnlUsd ?? 0) < 0) ? 'danger' : 'success'
  const shares = `${formatAmount(position.shares, 2, locale)} · ${chanceText(position.price, locale)}`
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${position.question}, ${label}, ${words.shares} ${shares}, ${formatUsd(position.valueUsd, locale)}, ${result}`}
      onPress={onPress}
      disabled={!onPress}
      className={`flex-row items-center justify-between gap-3 py-2.5 active:bg-hover ${last ? '' : 'border-b border-line'}`}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Txt variant="ui" numberOfLines={1}>
          {position.question}
        </Txt>
        <Txt variant="labelSm" tone="faint" numberOfLines={1}>
          {`${label} · ${shares}`}
        </Txt>
      </View>
      <View className="items-end gap-0.5">
        <Txt variant="data">{formatUsd(position.valueUsd, locale)}</Txt>
        <Txt variant="labelSm" tone={position.pnlUsd === null && position.won === null ? 'faint' : tone}>
          {result}
        </Txt>
      </View>
    </Pressable>
  )
}

function LinkedBody({
  account,
  words,
  locale,
  onOpen,
}: {
  account: PredictionAccount
  words: PredictionsCopy
  locale: Locale
  onOpen: (eventId: string) => void
}) {
  const [every, setEvery] = useState(false)
  const { balance, positions } = account
  const folded = positions.length > POSITIONS_SHOWN && !every
  const shown = folded ? positions.slice(0, POSITIONS_SHOWN) : positions
  const hasMore = positions.length > POSITIONS_SHOWN
  return (
    <View>
      {account.providerDown ? (
        <Txt variant="ui" tone="muted" className="pb-1">
          {words.providerDown}
        </Txt>
      ) : null}
      {account.locationBlocked ? (
        <Txt variant="ui" tone="warning" className="pb-1">
          {words.locationBlocked}
        </Txt>
      ) : null}
      <FactRow label={words.balance} value={formatUsd(balance?.cashUsd ?? null, locale)} />
      <FactRow label={words.inPositions} value={formatUsd(balance?.positionsUsd ?? null, locale)} />
      <FactRow
        label={words.result}
        value={formatUsdSigned(balance?.pnlUsd ?? null, locale)}
        tone={balance?.pnlUsd == null || balance.pnlUsd === 0 ? 'fg' : balance.pnlUsd > 0 ? 'success' : 'danger'}
        last
      />
      <Txt variant="label" tone="faint" className="pt-3">
        {words.positions}
      </Txt>
      {positions.length === 0 ? (
        <Txt variant="ui" tone="muted" className="py-2.5">
          {account.providerDown ? '—' : words.noPositions}
        </Txt>
      ) : (
        shown.map((position, index) => (
          <PaperPositionRow
            key={`${position.question}-${position.label}-${index}`}
            position={position}
            words={words}
            locale={locale}
            onPress={position.eventId ? () => onOpen(position.eventId!) : undefined}
            last={index === shown.length - 1 && !hasMore}
          />
        ))
      )}
      {hasMore ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setEvery(folded)}
          className="flex-row items-center justify-between py-2.5 active:bg-hover"
        >
          <Txt variant="ui" tone="brand">
            {folded ? words.everyPosition(positions.length) : words.fewerPositions}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  )
}

/**
 * The wallet's simulated account over the events: from no wallet to a linked account, one line and one action at each
 * step — connect, sign in, open the account (the wallet signs one message) — then the balance, the result so far and the
 * positions, each opening its event; «Гроші» under it, a tap away. Read on its own clock, its time beside its title.
 */
export function PredictionsAccountCard({ onOpen }: { onOpen: (eventId: string) => void }) {
  const router = useRouter()
  const words = useCopy(PREDICTIONS_COPY)
  const shared = useSharedCopy()
  const locale = useLocale()
  const account = useAccount()
  const wallet = useWallet()
  const read = usePredictionAccount(account.session)
  const link = useLinkAccount(account.session, wallet.signMessage)

  let body
  let linked = false
  if (!account.address) {
    body = (
      <View className="gap-3">
        <Txt variant="ui" tone="muted">
          {words.connectLine}
        </Txt>
        <Button
          title={shared.connectWallet}
          variant="secondary"
          onPress={() => void account.connect()}
          loading={account.busy === 'connect'}
        />
      </View>
    )
  } else if (!account.session || (read.isError && needsSignIn(read.error))) {
    body = (
      <View className="gap-3">
        <Txt variant="ui" tone="muted">
          {words.signInLine}
        </Txt>
        <Button
          title={shared.signIn}
          variant="secondary"
          onPress={() => void account.signIn()}
          loading={account.signingIn}
        />
      </View>
    )
  } else if (read.data) {
    const state = read.data.link.state
    if (state === 'active') {
      linked = true
      body = <LinkedBody account={read.data} words={words} locale={locale} onOpen={onOpen} />
    } else if (!read.data.link.available) {
      body = (
        <Txt variant="ui" tone="muted">
          {words.linkUnavailable}
        </Txt>
      )
    } else {
      body = (
        <View className="gap-3">
          <View className="flex-row items-start gap-2">
            <Txt variant="ui" tone="muted" className="flex-1">
              {state === 'expired' ? words.linkExpired : words.linkLine}
            </Txt>
            <HelpDot title={words.link} body={words.linkHelp} />
          </View>
          {link.isError ? (
            <Txt variant="ui" tone="danger">
              {linkFailureLine(link.error, words)}
            </Txt>
          ) : null}
          <Button
            title={link.isPending ? words.linking : words.link}
            variant="secondary"
            onPress={() => link.mutate()}
            loading={link.isPending}
          />
        </View>
      )
    }
  } else if (read.isPending) {
    body = <Skeleton className="h-24 w-full rounded-sm" />
  } else {
    body = (
      <View className="gap-2">
        <Txt variant="ui" tone="muted">
          {words.down}
        </Txt>
        <Button title={words.tryAgain} variant="ghost" size="sm" onPress={() => void read.refetch()} />
      </View>
    )
  }

  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between gap-3">
        <Txt variant="title">{words.account}</Txt>
        {read.data && account.session ? (
          <Txt variant="labelSm" tone="faint">
            {words.readAt(formatClock(new Date(read.data.readAt).toISOString()))}
          </Txt>
        ) : null}
      </View>
      {body}
      {linked ? (
        <View className="border-t border-line">
          <DoorRow
            icon="wallet-outline"
            label={words.money}
            line={words.moneyLine}
            onPress={() => router.push(PREDICTIONS_MONEY_PATH as never)}
            last
          />
        </View>
      ) : null}
    </Card>
  )
}
