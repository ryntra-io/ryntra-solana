import { useRouter } from 'expo-router'
import { View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { FactRow } from '@/components/fact-row'
import { Txt } from '@/components/txt'
import { FUTURES_COPY } from '@/features/futures/futures-copy'
import type { PhoenixHolding } from '@/features/futures/phoenix-portfolio'
import { PORTFOLIO_COPY } from '@/features/portfolio/copy'
import { useOpenPlace } from '@/features/shell/open-place'
import { TRADE_PATH } from '@/features/shell/shell'
import { useCopy, useLocale } from '@/lib/i18n'
import { DASH, formatAmount, formatClock, formatUsd, formatUsdSigned } from '@/utils/format'

import { OrderRow, PositionRow } from '../futures/account-card'

/** The account's own time, as its card on «Perps» says it. */
const clockOf = (ms: number) => formatClock(new Date(ms).toISOString())

/**
 * «Perps на Phoenix» in Portfolio's «Активи» (C4f; the web's «На Phoenix», SOL-C6): the collateral, what is free for a
 * trade, every open position with its entry and its result at the mark — each opens its market, where it is cut,
 * protected or closed — and the account's time. The collateral is in Portfolio's value; the results are beside it.
 */
export function PhoenixSection({ holding, valueUsd }: { holding: PhoenixHolding; valueUsd: number | null }) {
  const router = useRouter()
  const openPlace = useOpenPlace()
  const copy = useCopy(PORTFOLIO_COPY)
  const words = useCopy(FUTURES_COPY)
  const locale = useLocale()
  const open = (symbol: string) => router.push({ pathname: '/futures/[symbol]', params: { symbol } } as never)
  const { positions } = holding
  return (
    <View>
      <View className="flex-row items-end justify-between px-1 pb-1 pt-4">
        <Txt variant="labelSm" tone="faint" caps>
          {copy.phoenixTitle} · {positions.length}
        </Txt>
        <Txt variant="data" tone="muted">
          {valueUsd === null ? DASH : formatUsd(valueUsd, locale)}
        </Txt>
      </View>
      <Card className="gap-1">
        <FactRow label={copy.phoenixCollateral} value={formatUsd(holding.collateralUsd, locale)} />
        {holding.collateralSol !== null && holding.collateralSol > 0 ? (
          <FactRow label={words.collateralSol} value={`${formatAmount(holding.collateralSol, 4, locale)} SOL`} />
        ) : null}
        <FactRow
          label={copy.phoenixFree}
          value={holding.freeUsd === null ? DASH : `${formatAmount(holding.freeUsd, 2, locale, 2)} USDC`}
        />
        {positions.length > 0 ? (
          <FactRow
            label={copy.phoenixResult}
            value={holding.resultUsd === null ? DASH : formatUsdSigned(holding.resultUsd, locale)}
            tone={
              holding.resultUsd === null || holding.resultUsd === 0
                ? 'muted'
                : holding.resultUsd > 0
                  ? 'success'
                  : 'danger'
            }
            last
          />
        ) : null}
        {positions.length === 0 ? (
          <Txt variant="ui" tone="muted" className="py-2.5">
            {copy.phoenixNoPositions}
          </Txt>
        ) : (
          <View className="pt-1">
            {positions.map((entry, index) => (
              <PositionRow
                key={`${entry.position.subaccount ?? 'x'}-${entry.position.symbol}-${entry.position.side}`}
                position={entry.position}
                words={words}
                locale={locale}
                result={entry.resultUsd}
                onPress={() => open(entry.position.symbol)}
                last={index === positions.length - 1}
              />
            ))}
          </View>
        )}
        <View className="flex-row items-center justify-between gap-3 pt-2">
          <Txt variant="labelSm" tone="faint">
            {copy.phoenixRead(clockOf(holding.observedAt))}
          </Txt>
          <Button
            title={copy.phoenixOpen}
            variant="secondary"
            size="sm"
            onPress={() => openPlace(`${TRADE_PATH}?seg=futures`)}
          />
        </View>
      </Card>
    </View>
  )
}

/**
 * «Ордери Phoenix» in Portfolio's «Ордери» (C4f): the account's resting orders beside the limits, each opening its
 * market, where it is cancelled. Nothing is drawn when the account holds none.
 */
export function PhoenixOrders({ holding }: { holding: PhoenixHolding | null }) {
  const router = useRouter()
  const copy = useCopy(PORTFOLIO_COPY)
  const words = useCopy(FUTURES_COPY)
  const locale = useLocale()
  if (!holding || holding.orders.length === 0) return null
  const open = (symbol: string) => router.push({ pathname: '/futures/[symbol]', params: { symbol } } as never)
  return (
    <View className="gap-1">
      <View className="flex-row items-end justify-between px-1 pb-1 pt-2">
        <Txt variant="labelSm" tone="faint" caps>
          {copy.phoenixOrders} · {holding.orders.length}
        </Txt>
        <Txt variant="labelSm" tone="faint">
          {copy.phoenixRead(clockOf(holding.observedAt))}
        </Txt>
      </View>
      <Card>
        {holding.orders.map((order, index) => (
          <OrderRow
            key={order.id}
            order={order}
            words={words}
            locale={locale}
            onPress={() => open(order.symbol)}
            last={index === holding.orders.length - 1}
          />
        ))}
      </Card>
    </View>
  )
}
