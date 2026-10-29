import { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { FactRow } from '@/components/fact-row'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import type { CreditsCopy } from '@/features/assistant/credits-copy'
import { creditsText } from '@/features/assistant/credits-model'
import {
  ORDER_PAY_HOLD_MS,
  refusalCode,
  useCreditOrder,
  useCreditOrders,
  useOpenCreditOrder,
  useOrderPayment,
} from '@/features/assistant/credits-orders'
import {
  minutesLeft,
  orderPayable,
  orderRefusalOf,
  orderStatusLine,
  orderTitle,
  orderTone,
  packageLabel,
  payHeld,
  paymentLine,
  paymentTime,
} from '@/features/assistant/credits-panel-model'
import { explorerUrl } from '@/features/money/money-model'
import { useAccount } from '@/features/session/use-account'
import { usePlaceHold } from '@/features/shell/open-place'
import { useNow } from '@/hooks/use-now'
import type { AssistantCreditOrder, AssistantCreditPurchase, Session } from '@/lib/api'
import { canCopy, copyText } from '@/lib/clipboard'
import { useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { openLink } from '@/lib/open-link'
import { DASH, formatAt, formatCount, localizeFigures } from '@/utils/format'

/**
 * Buying credits for USDC in the phone (AI-12): four packages; a chosen one opens an order that is paid with the
 * wallet's own signature through MWA — the «pay a Ryntra link» flow as it is — never a QR. The order is read every few
 * seconds until the chain says it is paid; the credits are added by the server once and the receipt stays under it.
 */

/** «Поповнити» → the packages, each with its credits and bonus; one tap opens an order for it. */
export function CreditsPackagesSheet({
  visible,
  onClose,
  session,
  purchase,
  copy,
  onOpened,
}: {
  visible: boolean
  onClose: () => void
  session: Session
  purchase: AssistantCreditPurchase
  copy: CreditsCopy
  onOpened: (orderId: string) => void
}) {
  const locale = useLocale()
  const open = useOpenCreditOrder(session, locale)
  const [chosen, setChosen] = useState<string | null>(null)
  const refusal = open.isError ? copy[orderRefusalOf(refusalCode(open.error))] : null
  const close = () => {
    open.reset()
    onClose()
  }
  return (
    <Sheet visible={visible} title={copy.buyTitle} subtitle={copy.rate} onClose={close} scroll>
      <View className="gap-3 pb-3">
        <View className="flex-row flex-wrap gap-2">
          {purchase.packages.map((pkg) => {
            const label = packageLabel(pkg, locale)
            const busy = open.isPending && chosen === pkg.id
            return (
              <Pressable
                key={pkg.id}
                accessibilityRole="button"
                accessibilityLabel={[label.price, label.credits, label.bonus].filter(Boolean).join(', ')}
                accessibilityState={{ disabled: open.isPending, busy }}
                disabled={open.isPending}
                onPress={() => {
                  setChosen(pkg.id)
                  open.mutate(pkg.id, {
                    onSuccess: (response) => {
                      onOpened(response.order.id)
                      onClose()
                    },
                  })
                }}
                className="min-h-24 grow basis-[45%] justify-between gap-2 rounded-sm border border-line bg-surface p-3 active:bg-hover"
                style={{ opacity: open.isPending && !busy ? 0.5 : 1 }}
              >
                <View className="flex-row items-center justify-between gap-2">
                  <Txt variant="dataLg">{label.price}</Txt>
                  {label.bonus ? <Chip label={label.bonus} tone="brand" caps={false} mono /> : null}
                </View>
                <Txt variant="ui" tone="muted">
                  {busy ? copy.preparing : label.credits}
                </Txt>
              </Pressable>
            )
          })}
        </View>
        {refusal ? (
          <Txt variant="ui" tone="danger">
            {refusal}
          </Txt>
        ) : null}
        <Txt variant="labelSm" tone="faint">
          {copy.buyNote(purchase.treasury?.abbreviated ?? DASH)}
        </Txt>
      </View>
    </Sheet>
  )
}

/** A signature abbreviated, with «Копіювати» and the explorer one tap away. */
function SignatureRow({ payment, copy, now, locale, last }: { payment: AssistantCreditOrder['payments'][number]; copy: CreditsCopy; now: number; locale: Locale; last?: boolean }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1_500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <FactRow
      label={copy.receiptTx}
      value={paymentLine(payment, locale)}
      detail={copied ? copy.copied : paymentTime(payment, now, locale)}
      last={last}
      right={
        <View className="flex-row items-center gap-1">
          <Txt variant="data" selectable>
            {paymentLine(payment, locale)}
          </Txt>
          {canCopy ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.copy}
              hitSlop={8}
              onPress={() => setCopied(copyText(payment.signature))}
              className="h-8 w-8 items-center justify-center rounded-btn active:bg-hover"
            >
              <Icon name={copied ? 'checkmark' : 'copy-outline'} size={16} color="fgMuted" />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={copy.explorer}
            hitSlop={8}
            onPress={() => openLink(explorerUrl(payment.signature))}
            className="h-8 w-8 items-center justify-center rounded-btn active:bg-hover"
          >
            <Icon name="open-outline" size={16} color="fgMuted" />
          </Pressable>
        </View>
      }
    />
  )
}

/** The receipt of an order: what arrived, what was credited, to whom, the order and each payment. */
export function CreditReceipt({ order, copy, now, locale }: { order: AssistantCreditOrder; copy: CreditsCopy; now: number; locale: Locale }) {
  return (
    <View>
      <FactRow label={copy.receiptPaid} value={`${localizeFigures(order.received.display, locale)} USDC`} />
      <FactRow label={copy.receiptCredits} value={`+${formatCount(order.credited, locale)}`} />
      <FactRow label={copy.to} value={order.treasury.abbreviated} detail={copy.treasury} />
      <FactRow label={copy.receiptOrder} value={order.id} detail={formatAt(order.createdAt, now, locale)} last={order.payments.length === 0} />
      {order.payments.map((payment, index) => (
        <SignatureRow
          key={payment.signature}
          payment={payment}
          copy={copy}
          now={now}
          locale={locale}
          last={index === order.payments.length - 1}
        />
      ))}
    </View>
  )
}

/**
 * The order on screen: what will be paid and to whom, how long it waits, «Підписати в гаманці», then its state as the
 * server reads the chain — «Зараховано N кредитів», a shortfall or the end of its window said plainly.
 */
export function CreditOrderCard({ session, orderId, copy }: { session: Session; orderId: string; copy: CreditsCopy }) {
  const locale = useLocale()
  const now = useNow(5_000)
  const account = useAccount()
  const shared = useSharedCopy()
  const read = useCreditOrder(session, orderId)
  const payment = useOrderPayment(session, orderId)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const order = read.data?.order ?? null
  const status = order?.status
  const wasPaid = useRef(status === 'paid')
  useEffect(() => {
    // The receipt opens itself once, the moment the order turns paid.
    if (status === 'paid' && !wasPaid.current) setReceiptOpen(true)
    wasPaid.current = status === 'paid'
  }, [status])
  const working = payment.phase === 'preparing' || payment.phase === 'signing' || payment.phase === 'sending'
  usePlaceHold(working)

  if (!order) {
    if (read.isError) {
      return (
        <Card className="gap-2">
          <Txt variant="ui" tone="danger">
            {copy.ordersFailed}
          </Txt>
          <Button title={shared.tryAgain} variant="secondary" size="sm" loading={read.isFetching} onPress={() => void read.refetch()} />
        </Card>
      )
    }
    return <Skeleton className="h-40 rounded-sm" />
  }

  const paid = order.status === 'paid'
  const holding = !paid && payHeld(payment.heldAt, now, ORDER_PAY_HOLD_MS)
  const payable = orderPayable(order, now, holding) || working
  const left = minutesLeft(order, now)
  const needsSignIn = payment.failure?.key === 'signIn'
  const failureWords = payment.failure && !holding ? copy.failures[payment.failure.key] : null
  const chip = holding ? (payment.phase === 'sent' ? copy.status.checking : copy.notConfirmed) : copy.status[order.status]
  const chipTone = holding ? 'warning' : orderTone(order)

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <Txt variant="labelSm" tone="faint" caps>
          {copy.buyTitle}
        </Txt>
        <Chip label={chip} tone={chipTone} caps={false} />
      </View>
      <Txt variant="title">{orderTitle(order, copy, locale)}</Txt>

      {payable ? (
        <View className="border-t border-line pt-1">
          <FactRow label={copy.amount} value={`${localizeFigures(order.amount.display, locale)} USDC`} />
          <FactRow label={copy.to} value={order.treasury.abbreviated} detail={copy.treasury} />
          <FactRow
            label={copy.timeLeft}
            value={left === null ? DASH : copy.minutes(left)}
            detail={formatAt(order.expiresAt, now, locale)}
            last
          />
        </View>
      ) : (
        <Txt variant="ui" tone={holding && payment.phase !== 'sent' ? 'warning' : order.status === 'paid' ? 'success' : 'muted'}>
          {holding ? (payment.phase === 'sent' ? copy.sent : copy.unconfirmed) : orderStatusLine(order, copy, locale)}
        </Txt>
      )}

      {order.wrongToken ? (
        <Txt variant="ui" tone="danger">
          {copy.wrongToken}
        </Txt>
      ) : null}
      {failureWords ? (
        <Txt variant="ui" tone="danger">
          {failureWords}
        </Txt>
      ) : null}

      {payable ? (
        needsSignIn ? (
          <Button
            title={copy.signIn}
            size="lg"
            loading={account.signingIn}
            onPress={() => void account.signIn().then((ok) => ok && payment.clearFailure())}
          />
        ) : (
          <Button
            title={
              payment.phase === 'preparing'
                ? copy.preparing
                : payment.phase === 'signing'
                  ? copy.waitingWallet
                  : payment.phase === 'sending'
                    ? copy.sending
                    : copy.sign
            }
            size="lg"
            loading={working}
            onPress={() => void payment.pay()}
          />
        )
      ) : null}

      {order.payments.length > 0 ? (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: receiptOpen }}
            onPress={() => setReceiptOpen((value) => !value)}
            className="flex-row items-center justify-between py-2 active:opacity-80"
          >
            <Txt variant="ui" tone="muted">
              {copy.receipt}
            </Txt>
            <Icon name={receiptOpen ? 'chevron-up' : 'chevron-down'} size={16} color="fgMuted" />
          </Pressable>
          {receiptOpen ? <CreditReceipt order={order} copy={copy} now={now} locale={locale} /> : null}
        </View>
      ) : null}
    </Card>
  )
}

/** «Покупки»: every order with its state and receipt; one still open can be brought back to the tab to be paid. */
export function CreditOrdersSheet({
  visible,
  onClose,
  session,
  copy,
  onPick,
}: {
  visible: boolean
  onClose: () => void
  session: Session
  copy: CreditsCopy
  onPick: (orderId: string) => void
}) {
  const locale = useLocale()
  const shared = useSharedCopy()
  const now = useNow(30_000)
  const orders = useCreditOrders(session, visible)
  const list = orders.data?.orders ?? []
  return (
    <Sheet visible={visible} title={copy.purchases} onClose={onClose} scroll>
      <View className="gap-3 pb-3">
        {orders.isPending ? (
          <>
            <Skeleton className="h-24 rounded-sm" />
            <Skeleton className="h-24 rounded-sm" />
          </>
        ) : orders.isError && !orders.data ? (
          <View className="gap-2">
            <Txt variant="ui" tone="danger">
              {copy.ordersFailed}
            </Txt>
            <Button title={shared.tryAgain} variant="secondary" size="sm" loading={orders.isFetching} onPress={() => void orders.refetch()} />
          </View>
        ) : list.length === 0 ? (
          <Txt variant="ui" tone="muted">
            {copy.noPurchases}
          </Txt>
        ) : (
          list.map((order) => (
            <Card key={order.id} level="elevated" className="gap-2">
              <View className="flex-row items-center justify-between gap-3">
                <Txt variant="ui" className="flex-1">
                  {orderTitle(order, copy, locale)}
                </Txt>
                <Chip label={copy.status[order.status]} tone={orderTone(order)} caps={false} />
              </View>
              <Txt variant="labelSm" tone="faint">
                {[formatAt(order.createdAt, now, locale), order.credited > 0 ? `+${creditsText(order.credited, locale)}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Txt>
              {order.payments.length > 0 ? <CreditReceipt order={order} copy={copy} now={now} locale={locale} /> : null}
              {order.status === 'awaiting' || order.status === 'checking' ? (
                <Button
                  title={copy.openOrder}
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    onPick(order.id)
                    onClose()
                  }}
                />
              ) : null}
            </Card>
          ))
        )}
        <Txt variant="labelSm" tone="faint">
          {copy.buyRules}
        </Txt>
      </View>
    </Sheet>
  )
}
