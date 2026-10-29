import { View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip, type ChipTone } from '@/components/chip'
import { Icon } from '@/components/icon'
import { ReviewBlock } from '@/components/review-block'
import { Txt } from '@/components/txt'
import { HISTORY_COPY } from '@/features/history/copy'
import { MONEY_COPY } from '@/features/money/copy'
import {
  addressGroups,
  checkNotes,
  checkRows,
  decimalText,
  explorerUrl,
  shortAddress,
  strongGroups,
  type PendingSend,
  type ResumeShow,
} from '@/features/money/money-model'
import type { SendFailure } from '@/features/money/send-flow'
import type { SendDone, SendPhase } from '@/features/money/use-send'
import { docFromSend } from '@/features/receipts/receipt-doc'
import { useSkrName } from '@/features/seeker/use-seeker'
import { useNow } from '@/hooks/use-now'
import type { TransferCheck } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { formatAt } from '@/utils/format'
import { openLink } from '@/lib/open-link'
import { SHEET_COPY } from '@/features/trade/sheet-copy'
import { ShareReceiptButton } from '@/screens/receipts/share-receipt'
import { WaitBody } from '@/screens/trade/sheet-parts'

/**
 * «Перевірка» of a transfer: the server's rows, what to read before
 * confirming (a reason it cannot happen in red, a risk to weigh in amber), why
 * it is not ready, and the one action — the wallet opens only for a Review the
 * server calls signable.
 */
export function SendReview({
  check,
  symbol,
  phase,
  failure,
  blocked,
  onConfirm,
  onCancel,
  onCancelWait = null,
  lookalikeOf = null,
  name = null,
}: {
  /** The `.skr` name of the whole address — said above it, only when read again to exactly that address (M41.2). */
  name?: string | null
  /** «Скасувати» while the wallet is asked (M45). */
  onCancelWait?: (() => void) | null
  /** A recent address this one imitates: its differing groups are drawn strongest, never its matching edges. */
  lookalikeOf?: string | null
  check: TransferCheck
  symbol: string
  phase: SendPhase
  failure: SendFailure | null
  blocked: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const words = useCopy(MONEY_COPY)
  const sheet = useCopy(SHEET_COPY)
  const locale = useLocale()
  const notes = checkNotes(check, locale)
  const rows = checkRows(check, symbol, locale)
  const strong = strongGroups(check.to.address, lookalikeOf)
  const working = phase === 'preparing' || phase === 'signing' || phase === 'sending'
  return (
    <View className="gap-3 pb-2">
      <View
        className="gap-1"
        accessible
        accessibilityLabel={name ? `${words.to}: ${name}, ${check.to.address}` : `${words.to}: ${check.to.address}`}
      >
        <Txt variant="labelSm" tone="faint" caps>
          {words.to}
        </Txt>
        {/* The name never stands for the address: the whole address follows it, every character. */}
        {name ? <Txt variant="ui">{name}</Txt> : null}
        {/* The whole address, in fours: its first and last groups drawn strongest — or, for a look-alike of a recent
            address, the groups where it differs, since its edges already match. */}
        <Txt variant="data">
          {addressGroups(check.to.address).map((group, index, all) => (
            <Txt key={index} variant="data" tone={strong[index] ? 'fg' : 'muted'}>
              {group}
              {index < all.length - 1 ? ' ' : ''}
            </Txt>
          ))}
        </Txt>
      </View>
      <ReviewBlock rows={rows} />
      {check.to.opensAccount && check.setup ? (
        <Txt variant="ui" tone="muted">
          {words.opensAccount}
        </Txt>
      ) : null}
      {notes.warnings.length > 0 ? (
        <View className="gap-2">
          {notes.warnings.map((warning) => (
            <View key={warning.line} className="flex-row items-start gap-2">
              <Icon
                name={warning.stops ? 'close-circle' : 'alert-circle-outline'}
                size={16}
                color={warning.stops ? 'dangerInk' : 'warningInk'}
                style={{ marginTop: 2 }}
              />
              <Txt variant="ui" tone={warning.stops ? 'danger' : 'muted'} className="flex-1">
                {warning.line}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}
      {notes.blocked ? (
        <Txt variant="ui" tone="danger">
          {notes.blocked}
        </Txt>
      ) : null}
      {failure ? (
        <Txt variant="ui" tone="danger">
          {words.failures[failure.key]}
        </Txt>
      ) : null}
      {/* The wallet's wait, the same as every operation's (NEW-LOOK §4): the Ledger line and «Скасувати». */}
      {phase === 'signing' || phase === 'sending' ? (
        <WaitBody sending={phase === 'sending'} onCancel={onCancelWait} />
      ) : check.signable ? (
        <>
          <Button
            title={
              phase === 'preparing'
                ? words.preparing
                : failure?.key === 'ledgerBlind'
                  ? sheet.tryAgain
                  : words.confirmInWallet
            }
            size="lg"
            loading={working}
            disabled={blocked}
            onPress={onConfirm}
          />
          <Button title={words.cancel} variant="ghost" onPress={onCancel} disabled={working} />
        </>
      ) : (
        <Button title={words.cancel} variant="secondary" size="lg" onPress={onCancel} />
      )}
    </View>
  )
}

const OUTCOME_TONE: Readonly<Record<SendDone['outcome'], ChipTone>> = {
  sent: 'success',
  'not-sent': 'danger',
  open: 'warning',
}

/** What happened: «Надіслано», «Не надіслано» or «Не підтверджено», the sum, to whom, when — and the transaction one tap away. */
export function SendDoneCard({ done, onAgain }: { done: SendDone; onAgain: () => void }) {
  const words = useCopy(MONEY_COPY)
  const historyWords = useCopy(HISTORY_COPY)
  const locale = useLocale()
  const now = useNow(30_000)
  // The name it was sent to; for a plain address, that wallet's own primary name.
  const ownName = useSkrName(done.toName ? null : done.to)
  const toName = done.toName ?? ownName
  const label = done.outcome === 'sent' ? words.sent : done.outcome === 'not-sent' ? words.notSent : words.notConfirmed
  const line =
    done.outcome === 'sent'
      ? null
      : done.result?.state === 'EXPIRED'
        ? words.neverReached
        : done.outcome === 'not-sent'
          ? words.rejected
          : words.notConfirmedYet
  // Sent or not sent, the next thing is a new transfer; an open outcome keeps it quiet and below.
  const again = (
    <Button
      title={words.sendAgain}
      variant={done.outcome === 'open' ? 'ghost' : 'primary'}
      size="lg"
      onPress={onAgain}
    />
  )
  return (
    <View className="gap-3">
      <Card className="gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <Txt variant="labelSm" tone="faint" caps>
            {words.transfer}
          </Txt>
          <Chip label={label} tone={OUTCOME_TONE[done.outcome]} caps={false} />
        </View>
        <Txt variant="dataLg">
          {decimalText(done.amount, locale)} {done.symbol}
        </Txt>
        <View className="flex-row items-center justify-between gap-3">
          <Txt variant="ui" tone="muted" className="flex-1" numberOfLines={1}>
            {words.to} {toName ? `${toName} · ${shortAddress(done.to)}` : shortAddress(done.to)}
          </Txt>
          <Txt variant="ui" tone="faint">
            {formatAt(done.at, now, locale)}
          </Txt>
        </View>
        {line ? (
          <Txt variant="ui" tone={done.outcome === 'open' ? 'warning' : 'muted'}>
            {line}
          </Txt>
        ) : null}
      </Card>
      {done.outcome === 'open' ? null : again}
      {done.signature ? (
        <Button
          title={words.explorer}
          variant={done.outcome === 'open' ? 'secondary' : 'ghost'}
          size="lg"
          onPress={() => openLink(explorerUrl(done.signature!))}
        />
      ) : null}
      {done.outcome === 'open' ? again : null}
      <ShareReceiptButton
        variant="button"
        doc={docFromSend(
          {
            ...done,
            title: done.outcome === 'sent' ? historyWords.words.sent(done.symbol) : `${label} · ${done.symbol}`,
          },
          locale,
        )}
      />
    </View>
  )
}

/** A transfer this phone signed and never saw the end of — older money and the more urgent question. */
export function SendPendingCard({
  pending,
  show,
  signedIn,
  signingIn,
  onSignIn,
  onRecheck = null,
}: {
  pending: PendingSend
  show: ResumeShow
  signedIn: boolean
  signingIn: boolean
  onSignIn: () => void
  /** After the reading's own deadline, ask the network again — never a new signature. */
  onRecheck?: (() => void) | null
}) {
  const words = useCopy(MONEY_COPY)
  const locale = useLocale()
  const toName = useSkrName(pending.summary?.to ?? null)
  const tone: ChipTone = show === 'LANDED' ? 'success' : show === 'FAILED' ? 'danger' : 'warning'
  const label = show === 'LANDED' ? words.sent : show === 'FAILED' ? words.notSent : words.notConfirmed
  const line =
    show === 'CHECKING'
      ? words.checkingEarlier
      : show === 'FAILED'
        ? words.rejected
        : show === 'UNKNOWN'
          ? words.earlierOpen
          : null
  const open = show === 'CHECKING' || show === 'UNKNOWN'
  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between gap-3">
        <Txt variant="labelSm" tone="faint" caps>
          {words.transfer}
        </Txt>
        <Chip label={label} tone={tone} caps={false} />
      </View>
      {pending.summary ? (
        <Txt variant="data">
          {decimalText(pending.summary.amount, locale)} {pending.summary.symbol} →{' '}
          {toName ? `${toName} · ${shortAddress(pending.summary.to)}` : shortAddress(pending.summary.to)}
        </Txt>
      ) : null}
      {line ? (
        <Txt variant="ui" tone="muted">
          {line}
        </Txt>
      ) : null}
      {open && !signedIn ? (
        <Button
          title={signingIn ? words.checkWallet : words.signIn}
          size="sm"
          variant="secondary"
          loading={signingIn}
          onPress={onSignIn}
        />
      ) : null}
      {onRecheck ? <Button title={words.recheck} size="sm" variant="secondary" onPress={onRecheck} /> : null}
      <Button
        title={words.explorer}
        size="sm"
        variant="ghost"
        onPress={() => openLink(explorerUrl(pending.signature))}
      />
    </Card>
  )
}
