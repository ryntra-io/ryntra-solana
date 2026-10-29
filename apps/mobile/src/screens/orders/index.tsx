import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip, type ChipTone } from '@/components/chip'
import { Icon } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { explorerUrl } from '@/features/history/history-model'
import { LIMIT_COPY, type LimitCopy } from '@/features/limits/copy'
import {
  amountOf,
  orderPrice,
  orderSignature,
  sortOrders,
  STATE_TONE,
  symbolOf,
  VENUE_NAME,
  type LimitOrder,
  type LimitToken,
  type StateTone,
} from '@/features/limits/limit-model'
import { quotePrice } from '@/features/limits/limit-words'
import type { LimitOutcome } from '@/features/limits/limits-flow'
import { useLimitActions, useLimitOrders } from '@/features/limits/use-limits'
import { useAccount } from '@/features/session/use-account'
import { SessionGate } from '@/features/wallet/wallet-gate'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { openLink } from '@/lib/open-link'
import { useNow } from '@/hooks/use-now'
import { useTheme } from '@/theme'
import { cn } from '@/utils/cn'
import { formatAmount, formatMoment } from '@/utils/format'

type Notice = Readonly<{ text: string; tone: 'success' | 'muted' | 'danger' }>

/**
 * What a cancellation came to, in the words that are true of it: taken back or cancelled only when the chain
 * confirmed it, sent while it waits; the chain's «no» says the order still waits; a lost answer is neither.
 */
function noticeOf(outcome: LimitOutcome, claim: boolean, words: LimitCopy): Notice {
  if (outcome.kind === 'refused')
    return { text: words.failures[outcome.reason === 'general' ? 'notCancelled' : outcome.reason], tone: 'danger' }
  if (outcome.kind === 'failed') return { text: words.cancelFailed, tone: 'danger' }
  if (outcome.kind === 'unknown') return { text: `${words.unknownTitle} ${words.unknownLine}`, tone: 'muted' }
  if (!outcome.settled) return { text: words.cancelSent, tone: 'muted' }
  return { text: claim ? words.takenBack : words.cancelled, tone: 'success' }
}

const TONE_CHIP: Readonly<Record<StateTone, ChipTone>> = {
  live: 'brand',
  done: 'success',
  quiet: 'neutral',
  bad: 'danger',
}

/** At most this many rows, as the web's table: the waiting ones always among them. */
const ROWS = 30

/**
 * «Мої ордери» (C3) — the wallet's limit orders at Jupiter and on DLMM, the
 * same list the web's Spot workspace shows from the same read: an order placed
 * on the phone is on the web and the other way round. The waiting ones first
 * with «Скасувати», a converted DLMM order with «Забрати», then what filled,
 * was cancelled or expired, each with its transaction one tap deep. A note
 * «Ордер виконано» or «Квитанція готова» opens here on its order.
 */
export function OrdersScreen({
  embedded = false,
  order: askedOrder = null,
  above = null,
  onRefresh,
}: {
  embedded?: boolean
  order?: string | null
  /** Inside «Портфель · Ордери»: what stands over the limits, read without a sign-in — Phoenix's orders (C4f). */
  above?: ReactNode
  /** Told on the pull, beside the limits' own read: the place reads what stands above them. */
  onRefresh?: () => void
} = {}) {
  const router = useRouter()
  const routeParams = useLocalSearchParams<{ order?: string }>()
  // Inside «Портфель · Ордери» the order a note named comes from the place, not this route.
  const params = embedded ? { order: askedOrder ?? undefined } : routeParams
  const locale = useLocale()
  const words = useCopy(LIMIT_COPY)
  const shared = useSharedCopy()
  const { colors } = useTheme()
  const account = useAccount()
  const session = account.session
  const orders = useLimitOrders(session)
  const actions = useLimitActions(session)
  const [notice, setNotice] = useState<Notice | null>(null)
  const focus = typeof params.order === 'string' ? params.order : null

  const rows = useMemo(() => {
    const sorted = sortOrders(orders.data?.orders ?? [])
    // The order a note named stands first, where the screen opens — even past the first rows.
    const named = focus ? sorted.find((order) => order.order === focus) : undefined
    return named ? [named, ...sorted.filter((order) => order !== named).slice(0, ROWS - 1)] : sorted.slice(0, ROWS)
  }, [orders.data, focus])

  async function act(order: LimitOrder) {
    setNotice(null)
    const outcome = await actions.cancel(order)
    if (outcome === null) return
    setNotice(noticeOf(outcome, order.canClaim, words))
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))

  const body = orders.isPending ? (
    <View className="gap-3">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-20 w-full rounded-sm" />
      ))}
    </View>
  ) : orders.isError && !orders.data ? (
    <StateView
      icon="cloud-offline-outline"
      title={words.readFailed}
      tone="danger"
      action={{ title: shared.tryAgain, onPress: () => void orders.refetch(), loading: orders.isRefetching }}
    />
  ) : rows.length === 0 ? (
    // Inside «Портфель · Ордери» an empty list is one quiet line, as «Активи» (NEW-LOOK §3).
    embedded ? (
      <Txt variant="ui" tone="muted" className="py-2 text-center">
        {above ? words.noLimitsLine : words.noOrdersLine}
      </Txt>
    ) : (
      <StateView icon="list-outline" title={words.noOrdersTitle} />
    )
  ) : (
    <View className="gap-3">
      {rows.map((order) => (
        <OrderRow
          key={order.key}
          order={order}
          tokens={orders.data?.tokens ?? {}}
          locale={locale}
          focused={order.order === focus}
          acting={actions.acting === order.key}
          disabled={actions.acting !== null}
          onAct={() => void act(order)}
        />
      ))}
      {orders.data && !orders.data.complete ? (
        <Txt variant="ui" tone="muted">
          {words.incomplete}
        </Txt>
      ) : null}
    </View>
  )

  const content = (
    <SessionGate what={words.myOrders}>
      {notice ? (
        <Txt variant="ui" tone={notice.tone} accessibilityLiveRegion="polite">
          {notice.text}
        </Txt>
      ) : null}
      {body}
    </SessionGate>
  )
  if (embedded) {
    return (
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3 px-4 pb-8"
        refreshControl={
          session || onRefresh ? (
            <RefreshControl
              refreshing={orders.isRefetching}
              onRefresh={() => {
                if (session) void orders.refetch()
                onRefresh?.()
              }}
              tintColor={colors.brand}
              colors={[colors.brand]}
            />
          ) : undefined
        }
      >
        {above}
        {content}
      </ScrollView>
    )
  }
  return (
    <Screen
      title={words.myOrders}
      onBack={back}
      refreshControl={
        session ? (
          <RefreshControl
            refreshing={orders.isRefetching}
            onRefresh={() => void orders.refetch()}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        ) : undefined
      }
    >
      {content}
    </Screen>
  )
}

export function OrderRow({
  order,
  tokens,
  locale,
  focused,
  acting,
  disabled,
  onAct,
}: {
  order: LimitOrder
  tokens: Readonly<Record<string, LimitToken>>
  locale: Locale
  focused: boolean
  acting: boolean
  disabled: boolean
  onAct: () => void
}) {
  const words = useCopy(LIMIT_COPY)
  const now = useNow(60_000)
  const base = symbolOf(tokens, order.baseMint)
  const quote = symbolOf(tokens, order.quoteMint)
  const price = orderPrice(order, tokens)
  const amount = (raw: string, mint: string) => {
    const value = amountOf(raw, mint, tokens)
    return value === null ? '—' : `${formatAmount(value, 6, locale)} ${symbolOf(tokens, mint)}`
  }
  const filled = order.filledOutputRaw !== '0'
  const signature = orderSignature(order)
  return (
    <Card className={cn('gap-3', focused ? 'border-brand' : '')}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="shrink gap-1">
          <Txt variant="title" tone={order.side === 'buy' ? 'success' : 'danger'}>
            {`${order.side === 'buy' ? words.buy : words.sell} ${base}`}
          </Txt>
          <Txt variant="ui" tone="muted">
            {`${VENUE_NAME[order.venue]} · ${formatMoment(order.updatedAt || order.createdAt, now, locale)}`}
          </Txt>
        </View>
        <Chip label={words.states[order.state]} tone={TONE_CHIP[STATE_TONE[order.state]]} caps={false} />
      </View>
      <View className="flex-row justify-between gap-3">
        <View className="gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {words.fillsAt}
          </Txt>
          <Txt variant="data">{price === null ? '—' : `${quotePrice(price, locale)} ${quote}`}</Txt>
        </View>
        <View className="items-end gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {words.youPay}
          </Txt>
          <Txt variant="data">{amount(order.makingRaw, order.inputMint)}</Txt>
          {filled ? (
            <Txt variant="data" tone="success">
              {`→ ${amount(order.filledOutputRaw, order.outputMint)}`}
            </Txt>
          ) : null}
        </View>
      </View>
      {order.canCancel || order.canClaim ? (
        <Button
          title={order.canClaim ? words.takeBack : words.cancel}
          variant={order.canClaim ? 'primary' : 'secondary'}
          loading={acting}
          disabled={disabled}
          onPress={onAct}
        />
      ) : signature ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={order.state === 'FILLED' ? words.receipt : words.explorer}
          onPress={() => openLink(explorerUrl(signature))}
          className="min-h-12 flex-row items-center justify-between border-t border-line pt-3 active:opacity-70"
        >
          <Txt variant="ui" tone="muted">
            {order.state === 'FILLED' ? words.receipt : words.explorer}
          </Txt>
          {/* The link says what it opens, never the transaction's id (ST-4). */}
          <Icon name="open-outline" size={16} color="fgMuted" />
        </Pressable>
      ) : null}
    </Card>
  )
}
