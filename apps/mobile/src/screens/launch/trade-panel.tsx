import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { Pressable, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { ChoiceChips } from '@/components/choice-chips'
import { Field } from '@/components/field'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import type { LaunchWord } from '@/features/launch/copy'
import { tradeApi } from '@/features/launch/launch-api'
import {
  lostAfterSend,
  tradeLaunch,
  type FlowStep,
  type LaunchFailure,
  type TradeOutcome,
} from '@/features/launch/launch-flow'
import {
  explorerUrl,
  formatBps,
  formatMoneyShort,
  formatMove,
  formatNumber,
  formatPercent,
  formatRaw,
  fromRaw,
  toRaw,
} from '@/features/launch/launch-format'
import { isPaused, sendTitleKey, tradeFailureKey } from '@/features/launch/launch-model'
import { useLaunchWallet, useTradeQuote } from '@/features/launch/use-launch'
import { useAccount } from '@/features/session/use-account'
import { useWallet } from '@/features/wallet/use-wallet'
import { ApiError } from '@/lib/api'
import type { LaunchMarketResponse, LaunchTradeSide } from '@/lib/api/v1/types'
import { feel } from '@/lib/haptics'
import type { Locale } from '@/lib/i18n'

import { ExplorerLink, PausedNote, Row, Steps } from './parts'

const SLIPPAGES = ['50', '100', '300', '500'] as const
type Phase = 'idle' | FlowStep | 'done' | 'error'

/**
 * Buy and sell a launch, as on the web: on its curve by Meteora's own swap,
 * after graduation in its pool. The side, the amount with its quick choices,
 * what the trade gets and costs — the fee and who receives it — and one
 * action; the wallet signs the bytes the server built, the server sends once.
 */
export function TradePanel({
  market,
  symbol,
  word,
  locale,
}: {
  market: LaunchMarketResponse
  symbol: string
  word: LaunchWord
  locale: Locale
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const account = useAccount()
  const wallet = useWallet()
  const [side, setSide] = useState<LaunchTradeSide>('buy')
  const [text, setText] = useState('')
  const [slippage, setSlippage] = useState<(typeof SLIPPAGES)[number]>('100')
  const [phase, setPhase] = useState<Phase>('idle')
  const [failure, setFailure] = useState<LaunchFailure | null>(null)
  const [result, setResult] = useState<Extract<TradeOutcome, { ok: true }> | null>(null)
  const [paused, setPaused] = useState(false)
  const [split, setSplit] = useState(false)
  const running = useRef(false)

  const pair = market.pair
  const decimals = side === 'buy' ? pair.decimals : market.tokenDecimals
  const unit = side === 'buy' ? pair.symbol : `$${symbol}`
  const amountRaw = toRaw(text, decimals)
  const address = account.address
  const held = useLaunchWallet(market.token, address)
  const spendable = held.data ? BigInt(side === 'buy' ? held.data.pairRaw : held.data.tokenRaw) : null
  const over = amountRaw !== null && spendable !== null && amountRaw > spendable
  const busy = phase === 'prepare' || phase === 'sign' || phase === 'send'
  const quote = useTradeQuote(market.token, side, amountRaw, Number(slippage))
  const shown =
    quote.data && amountRaw !== null && quote.data.side === side && quote.data.amountInRaw === amountRaw.toString()
      ? quote.data
      : null
  const quoteCode = quote.error instanceof ApiError ? quote.error.code : quote.error ? 'UNAVAILABLE' : null

  const places = Math.min(2, pair.decimals)
  const money = (raw: string) =>
    BigInt(raw) > 0n && BigInt(raw) < 10n ** BigInt(pair.decimals - places)
      ? `< ${formatNumber(10 ** -places, locale, places)} ${pair.symbol}`
      : `${formatRaw(raw, pair.decimals, locale, places)} ${pair.symbol}`
  const tokens = (raw: string) => formatRaw(raw, market.tokenDecimals, locale, 0)
  const sniper =
    market.curveFee &&
    market.curveFee.sniperUntil &&
    shown &&
    shown.venue === 'curve' &&
    shown.feeBps > market.curveFee.endBps + 5
      ? market.curveFee
      : null

  const choose = (value: string) => {
    if (side === 'buy') return setText(value)
    if (!held.data) return
    setText(fromRaw((BigInt(held.data.tokenRaw) * BigInt(value)) / 100n, market.tokenDecimals))
  }

  const trade = async () => {
    if (!address) {
      void account.connect()
      return
    }
    if (amountRaw === null || amountRaw <= 0n || over || running.current) return
    running.current = true
    setFailure(null)
    try {
      const outcome = await tradeLaunch({
        api: tradeApi(market.token),
        wallet: { signTransactions: wallet.signTransactions },
        address,
        side,
        amountRaw,
        slippageBps: Number(slippage),
        onStep: (step) => {
          if (step === 'sign') feel('review')
          if (step === 'send') feel('sent')
          setPhase(step)
        },
      })
      if (outcome.ok) {
        feel(outcome.submit.state === 'CONFIRMED' ? 'done' : 'sent')
        setResult(outcome)
        setPhase('done')
        setText('')
        void queryClient.invalidateQueries({ queryKey: ['launch', 'market', market.token] })
        void queryClient.invalidateQueries({ queryKey: ['launch', 'wallet', market.token] })
        return
      }
      if (isPaused(outcome.failure.code)) {
        setPaused(true)
        setPhase('idle')
        return
      }
      feel(outcome.failure.code === 'WALLET_REFUSED' ? 'declined' : 'failed')
      setFailure(outcome.failure)
      setPhase('error')
      // No answer at the send: the trade may have gone through — the balance and the market read again.
      if (lostAfterSend(outcome.failure)) {
        void queryClient.invalidateQueries({ queryKey: ['launch', 'market', market.token] })
        void queryClient.invalidateQueries({ queryKey: ['launch', 'wallet', market.token] })
      }
    } finally {
      running.current = false
    }
  }

  const jupiter = market.trading.jupiter ? (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(`/trade?mint=${market.token}&side=${side}` as never)}
      hitSlop={8}
      className="min-h-11 justify-center self-center"
    >
      <Txt variant="ui" tone="brand">
        {word('jupiter')}
      </Txt>
    </Pressable>
  ) : null

  if (paused) {
    return (
      <Card className="gap-3">
        <PausedNote word={word} onCheck={() => setPaused(false)} />
        {jupiter}
      </Card>
    )
  }

  if (phase === 'done' && result) {
    const bought = result.side === 'buy'
    const confirmed = result.submit.state === 'CONFIRMED'
    const filled = result.submit.filled
    return (
      <Card className="items-center gap-2 py-5" accessibilityLiveRegion="polite">
        <Icon
          name={confirmed ? 'checkmark-circle' : 'time-outline'}
          size={32}
          color={confirmed ? 'successInk' : 'muted'}
        />
        <Txt variant="title" className="text-center">
          {confirmed
            ? word(bought ? 'boughtTitle' : 'soldTitle', {
                tokens: filled
                  ? tokens(filled.tokensRaw)
                  : `≈ ${tokens(bought ? result.quote.amountOutRaw : result.quote.amountInRaw)}`,
                symbol,
              })
            : word('tradePendingTitle')}
        </Txt>
        {confirmed ? (
          <Txt variant="data" tone="muted">
            {filled
              ? `${bought ? '−' : '+'}${money(filled.pairRaw)}`
              : `≈ ${bought ? '−' : '+'}${money(bought ? result.quote.amountInRaw : result.quote.amountOutRaw)}`}
          </Txt>
        ) : null}
        <Txt variant="ui" tone="muted" className="text-center">
          {confirmed ? word('tradeDoneLine') : word('tradePendingLine')}
        </Txt>
        <ExplorerLink label={word('viewTx')} url={explorerUrl(market.network, 'tx', result.submit.signature)} />
        <Button title={word('tradeAgain')} variant="secondary" onPress={() => setPhase('idle')} />
      </Card>
    )
  }

  const quick = side === 'buy' ? (pair.dollar ? ['10', '50', '100'] : ['1000', '5000', '20000']) : ['25', '50', '100']
  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <ChoiceChips
          role="radiogroup"
          disabled={busy}
          choices={[
            { value: 'buy' as const, label: word('buy') },
            { value: 'sell' as const, label: word('sell') },
          ]}
          value={side}
          onChange={(next) => {
            setSide(next)
            setText('')
            setPhase('idle')
            setFailure(null)
          }}
        />
        <Txt variant="labelSm" tone="faint" caps>
          {market.venue === 'curve' ? word('tradeOnCurve') : word('tradeInPool')}
        </Txt>
      </View>
      <Field
        label={word('amount')}
        value={text}
        onChangeText={setText}
        placeholder="0"
        keyboardType="decimal-pad"
        editable={!busy}
        suffix={unit}
        error={over ? word('moreThanHeld') : amountRaw === null ? word('errAmount') : null}
        hint={
          held.data
            ? word('balance', {
                amount:
                  side === 'buy'
                    ? formatRaw(held.data.pairRaw, pair.decimals, locale, 2)
                    : formatRaw(held.data.tokenRaw, market.tokenDecimals, locale, 0),
                symbol: unit,
              })
            : null
        }
      />
      {/* Quick amounts are actions that fill the field, not a choice that stays: buttons, not radios. */}
      <View className="flex-row gap-2">
        {quick.map((value) => {
          const off = busy || (side === 'sell' && !held.data)
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ disabled: off }}
              disabled={off}
              onPress={() => choose(value)}
              className={`h-11 flex-1 items-center justify-center rounded-pill border border-line active:bg-hover ${off ? 'opacity-50' : ''}`}
            >
              <Txt variant="ui">
                {side === 'buy'
                  ? pair.dollar
                    ? `$${value}`
                    : formatNumber(Number(value), locale)
                  : value === '100'
                    ? word('max')
                    : formatPercent(Number(value), locale, 0)}
              </Txt>
            </Pressable>
          )
        })}
      </View>
      <View className="flex-row items-center justify-between gap-3">
        <Txt variant="ui" tone="muted">
          {word('slippage')}
        </Txt>
        <ChoiceChips
          disabled={busy}
          choices={SLIPPAGES.map((value) => ({ value, label: formatBps(Number(value), locale) }))}
          value={slippage}
          onChange={setSlippage}
        />
      </View>

      {amountRaw !== null && amountRaw > 0n ? (
        <View className="gap-1 rounded-sm border border-line bg-elevated px-3 py-3" accessibilityLiveRegion="polite">
          {shown ? (
            <>
              <Txt variant="labelSm" tone="faint" caps>
                {word('youGet')}
              </Txt>
              <Txt variant="dataLg">
                {side === 'buy' ? `≈ ${tokens(shown.amountOutRaw)} $${symbol}` : `≈ ${money(shown.amountOutRaw)}`}
              </Txt>
              <Txt variant="labelSm" tone="faint">
                {word('atLeast', {
                  amount: side === 'buy' ? `${tokens(shown.minimumOutRaw)} $${symbol}` : money(shown.minimumOutRaw),
                })}
              </Txt>
              {sniper ? (
                <View className="flex-row items-start gap-2 pt-1">
                  <Icon name="warning" size={15} color="warningInk" style={{ marginTop: 1 }} />
                  <Txt variant="ui" tone="warning" className="flex-1">
                    {word('feeSniper', {
                      fee: formatBps(shown.feeBps, locale),
                      end: formatBps(sniper.endBps, locale),
                      time: new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date(sniper.sniperUntil as string)),
                    })}
                  </Txt>
                </View>
              ) : null}
              {BigInt(shown.amountLeftRaw) > 0n ? (
                <View className="flex-row items-start gap-2 pt-1">
                  <Icon name="warning" size={15} color="warningInk" style={{ marginTop: 1 }} />
                  <Txt variant="ui" tone="warning" className="flex-1">
                    {word('partialFill', {
                      spent: formatRaw(shown.amountInRaw, pair.decimals, locale, 2),
                      amount: formatRaw(amountRaw, pair.decimals, locale, 2),
                      symbol: pair.symbol,
                    })}
                  </Txt>
                </View>
              ) : null}
              <View className="pt-1">
                <Row label={word('fee')} value={`${formatBps(shown.feeBps, locale)} · ${money(shown.fee.totalRaw)}`} />
                <Row label={word('feeRyntra')} value={money(shown.fee.ryntraRaw)} />
                <Row
                  label={word('capAfter')}
                  value={formatMoneyShort(
                    shown.marketCapAfter.usd ?? shown.marketCapAfter.pair,
                    locale,
                    shown.marketCapAfter.usd !== null,
                    pair.symbol,
                  )}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setSplit(!split)}
                hitSlop={8}
                className="min-h-11 justify-center self-start"
              >
                <Txt variant="labelSm" tone="faint">
                  {shown.priceMoveBps >= 0
                    ? word('priceUp', { pct: formatMove(shown.priceMoveBps, locale).replace(/^[+−]/, '') })
                    : word('priceDown', { pct: formatMove(shown.priceMoveBps, locale).replace(/^[+−]/, '') })}{' '}
                  {split ? '▴' : '▾'}
                </Txt>
              </Pressable>
              {split ? (
                <Txt variant="labelSm" tone="faint">
                  {shown.fee.creatorRaw !== null
                    ? word('feeSplitCurve', {
                        creator: money(shown.fee.creatorRaw),
                        ryntra: money(shown.fee.ryntraRaw),
                        meteora: money(shown.fee.meteoraRaw),
                      })
                    : word('feeSplitPool', {
                        liquidity: money(shown.fee.liquidityRaw ?? '0'),
                        ryntra: money(shown.fee.ryntraRaw),
                        meteora: money(shown.fee.meteoraRaw),
                      })}
                </Txt>
              ) : null}
            </>
          ) : quote.isFetching ? (
            <Txt variant="ui" tone="muted">
              {word('tradeCounting')}
            </Txt>
          ) : quoteCode ? (
            <Txt variant="ui" tone="danger">
              {quoteCode === 'LAUNCH_GRADUATING' ? word('errGraduating') : word('errQuote')}
            </Txt>
          ) : (
            <Txt variant="ui" tone="muted">
              {word('tradeCounting')}
            </Txt>
          )}
        </View>
      ) : null}

      {phase === 'error' && failure ? (
        failure.code === 'WALLET_REFUSED' ? (
          <Txt variant="ui" tone="muted" accessibilityLiveRegion="polite">
            {word('walletCancelled')}
          </Txt>
        ) : (
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            className={`gap-1.5 rounded-sm border border-line px-3 py-3 ${lostAfterSend(failure) ? 'bg-elevated' : 'bg-danger-soft'}`}
          >
            <View className="flex-row items-center gap-2">
              <Icon
                name={lostAfterSend(failure) ? 'time-outline' : 'alert-circle'}
                size={18}
                color={lostAfterSend(failure) ? 'muted' : 'dangerInk'}
              />
              <Txt variant="ui" tone={lostAfterSend(failure) ? 'fg' : 'danger'}>
                {word(sendTitleKey(failure, 'errTradeTitle'))}
              </Txt>
            </View>
            <Txt variant="ui">
              {word(tradeFailureKey(failure.code, failure.step === 'send'), { symbol: pair.symbol })}
            </Txt>
          </View>
        )
      ) : null}

      {busy ? (
        <Steps word={word} phase={phase as FlowStep} labels={{ prepare: 'stepPrepareTrade', send: 'stepSendTrade' }} />
      ) : null}

      <Button
        title={
          !address
            ? word('connectToTrade')
            : side === 'buy'
              ? word('buyAction', { symbol })
              : word('sellAction', { symbol })
        }
        size="lg"
        loading={busy || account.busy === 'connect'}
        disabled={busy || (address !== null && (amountRaw === null || amountRaw <= 0n || over || !shown))}
        onPress={() => void trade()}
      />
      {jupiter}
    </Card>
  )
}
