import { useState } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { FactRow } from '@/components/fact-row'
import { Field } from '@/components/field'
import { Txt } from '@/components/txt'
import { MONEY_COPY } from '@/features/money/copy'
import { explorerUrl, linkAmount, linkAmountInput, linkTone } from '@/features/money/money-model'
import { PAY_UNCONFIRMED_HOLD_MS, usePayLink, usePayLinkPayment } from '@/features/money/use-pay-links'
import { useAccount } from '@/features/session/use-account'
import { useNow } from '@/hooks/use-now'
import type { PayLink } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { formatAt } from '@/utils/format'
import { openLink } from '@/lib/open-link'

/**
 * A Ryntra payment link pasted or scanned into «Кому»: what it asks for, to
 * whom, until when — and «Оплатити», which pays it on its own routes so its
 * reference goes with the money and the link turns «Оплачено». A plain
 * transfer to the same address would leave the link unpaid. The payer is the
 * signed-in wallet; an open link takes the amount here. A payment with no
 * answer is «не підтверджено» and the link's own state decides; «Оплатити»
 * returns only after the server's window for that transaction has closed.
 */
export function PayLinkPanel({ link: initial }: { link: PayLink }) {
  const words = useCopy(MONEY_COPY)
  const locale = useLocale()
  const now = useNow(5_000)
  const account = useAccount()
  const read = usePayLink(initial)
  const link = read.data ?? initial
  const payment = usePayLinkPayment(account.session, link)
  const [amountText, setAmountText] = useState('')
  const asked = linkAmount(link, locale)
  const typed = linkAmountInput(amountText)
  const paid = link.status === 'PAID'
  // A payment sent, or sent without an answer, holds «Оплатити» back for the server's window; then the link's own state decides.
  const holding =
    (payment.phase === 'sent' || payment.phase === 'unconfirmed') &&
    payment.heldAt !== null &&
    now - payment.heldAt < PAY_UNCONFIRMED_HOLD_MS
  const payable = link.status === 'AWAITING' && !holding
  const working = payment.phase === 'preparing' || payment.phase === 'signing' || payment.phase === 'sending'
  const needsSignIn = !account.session || payment.failure?.key === 'signIn'
  const failureWords =
    payment.failure === null || holding
      ? null
      : payment.failure.key === 'signIn'
        ? words.signInToPay
        : payment.failure.key === 'network'
          ? words.failures.network
          : words[payment.failure.key]
  const chip =
    holding && !paid ? (payment.phase === 'sent' ? words.pending : words.notConfirmed) : words.status[link.status]
  const statusLine =
    link.status === 'CHECKING' || link.status === 'UNKNOWN'
      ? words.linkChecking
      : link.status === 'EXPIRED'
        ? words.recipientProblems.LINK_EXPIRED
        : null

  return (
    <View className="gap-3">
      <Card className="gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <Txt variant="labelSm" tone="faint" caps>
            {words.payRequest}
          </Txt>
          <Chip label={chip} tone={holding && !paid ? 'warning' : linkTone(link)} caps={false} />
        </View>
        <Txt variant="dataLg">{asked ?? words.anyAmount}</Txt>
        {link.description ? (
          <Txt variant="ui" tone="muted">
            {link.description}
          </Txt>
        ) : null}
        <View className="border-t border-line pt-1">
          <FactRow label={words.payTo} value={link.recipient.abbreviated} />
          <FactRow label={words.validUntil} value={formatAt(link.expiresAt, now, locale)} mono={false} last />
        </View>
      </Card>

      {paid ? (
        link.paid ? (
          <Button
            title={words.explorer}
            variant="secondary"
            size="lg"
            onPress={() => openLink(explorerUrl(link.paid!.signature))}
          />
        ) : null
      ) : holding ? (
        <View className="gap-2">
          <Txt variant="ui" tone={payment.phase === 'sent' ? 'muted' : 'warning'}>
            {payment.phase === 'sent' ? `${words.paySent} ${words.payAgainHint}` : words.payUnconfirmed}
          </Txt>
          {payment.createsAccount ? (
            <Txt variant="ui" tone="faint">
              {words.createsAccountNote}
            </Txt>
          ) : null}
        </View>
      ) : payable ? (
        <View className="gap-3">
          {asked ? null : (
            <Field
              label={words.amount}
              value={amountText}
              onChangeText={(text) => setAmountText(text.replace(/[^\d.,]/g, ''))}
              keyboardType="decimal-pad"
              editable={!working}
              placeholder={locale === 'uk' ? '0,00' : '0.00'}
              suffix={link.token.symbol}
              error={typed === 'invalid' ? words.amountFormat : null}
            />
          )}
          <Txt variant="ui" tone="faint">
            {words.feeNote}
          </Txt>
          {working && payment.createsAccount ? (
            <Txt variant="ui" tone="faint">
              {words.createsAccountNote}
            </Txt>
          ) : null}
          {failureWords ? (
            <Txt variant="ui" tone="danger">
              {failureWords}
            </Txt>
          ) : null}
          {needsSignIn ? (
            <>
              {payment.failure ? null : (
                <Txt variant="ui" tone="muted">
                  {words.signInToPay}
                </Txt>
              )}
              <Button
                title={account.signingIn ? words.checkWallet : words.signIn}
                size="lg"
                loading={account.signingIn}
                onPress={() => void account.signIn().then((ok) => ok && payment.clearFailure())}
              />
            </>
          ) : (
            <Button
              title={
                payment.phase === 'preparing'
                  ? words.payPreparing
                  : payment.phase === 'signing'
                    ? words.waitingWallet
                    : payment.phase === 'sending'
                      ? words.sending
                      : words.pay
              }
              size="lg"
              loading={working}
              disabled={!asked && (typed === null || typed === 'invalid')}
              onPress={() => void payment.pay(asked ? null : typed === null || typed === 'invalid' ? null : typed)}
            />
          )}
        </View>
      ) : statusLine ? (
        <Txt variant="ui" tone="muted">
          {statusLine}
        </Txt>
      ) : null}
    </View>
  )
}
