import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
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
  feeShareBps,
  formatBps,
  formatFeeRaw,
  formatMoneyShort,
  formatMoveSize,
  formatNumber,
  formatPercent,
  formatRaw,
  toRaw,
  typedAmount,
} from '@/features/launch/launch-format'
import { isPaused, sendTitleKey, tradeFailureKey } from '@/features/launch/launch-model'
import { useLaunchWallet, useTradeQuote } from '@/features/launch/use-launch'
import { RECEIPTS_COPY } from '@/features/receipts/copy'
import { docFromLaunchTrade } from '@/features/receipts/receipt-doc'
import { useAccount } from '@/features/session/use-account'
import { usePlaceHold } from '@/features/shell/open-place'
import { useWallet } from '@/features/wallet/use-wallet'
import { ApiError, SOL_MINT } from '@/lib/api'
import type { LaunchMarketResponse, LaunchTradeSide } from '@/lib/api/v1/types'
import { feel } from '@/lib/haptics'
import { useCopy, type Locale } from '@/lib/i18n'
import { ShareReceiptButton } from '@/screens/receipts/share-receipt'

import { useKeyboardLift } from './keyboard-lift'
import { ExplorerLink, PausedNote, Row, Steps } from './parts'

const SLIPPAGES = ['50', '100', '300', '500'] as const
/** Lamports a SOL buy keeps for the network fee and the new token account's rent. */
const SOL_BUY_RESERVE = 3_000_000n

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
  // When the trade came back — the receipt's time; the answer carries none.
  const [doneAt, setDoneAt] = useState<string | null>(null)
  const receiptWords = useCopy(RECEIPTS_COPY)
  const [paused, setPaused] = useState(false)
  const [split, setSplit] = useState(false)
  const running = useRef(false)
  // While the amount is typed, the fee and the button stay above the keyboard (Android draws edge to edge): the page
  // follows them for as long as the field is focused — again when the keyboard grows a suggestion strip or the quote grows.
  const lift = useKeyboardLift()
  const [typing, setTyping] = useState(false)
  const fieldBox = useRef<View>(null)
  const actionBox = useRef<View>(null)
  const lifted = Boolean(lift?.open) && typing
  const follow = lift?.follow
  const relayout = lift?.relayout
  useEffect(() => {
    if (!typing || !follow) return
    follow({ top: fieldBox, bottom: actionBox })
    return () => follow(null)
  }, [typing, follow])

  const pair = market.pair
  const decimals = side === 'buy' ? pair.decimals : market.tokenDecimals
  const unit = side === 'buy' ? pair.symbol : `$${symbol}`
  const amountRaw = toRaw(text, decimals)
  const address = account.address
  const held = useLaunchWallet(market.token, address)
  const spendable = held.data ? BigInt(side === 'buy' ? held.data.pairRaw : held.data.tokenRaw) : null
  const over = amountRaw !== null && spendable !== null && amountRaw > spendable
  const busy = phase === 'prepare' || phase === 'sign' || phase === 'send'
  // While it is prepared, signed or sent, a note's tap or a quick action waits for it (`place-hold.ts`).
  usePlaceHold(busy)
  const { quote, askedRaw } = useTradeQuote(market.token, side, amountRaw, Number(slippage))
  // The quote in view is the typed amount's when it was asked for it — told by the request, not by the answer's amount:
  // near the threshold the curve answers for less than was asked (`amountLeftRaw`), and that answer is still this one.
  const typedRaw = amountRaw !== null && amountRaw > 0n ? amountRaw.toString() : null
  const current = typedRaw !== null && askedRaw === typedRaw
  const shown = current && quote.data && quote.data.side === side ? quote.data : null
  const quoteCode = !current
    ? null
    : quote.error instanceof ApiError
      ? quote.error.code
      : quote.error
        ? 'UNAVAILABLE'
        : null
  // «Counting» only while the typing settles or a request is in flight; an answer that never came is said as one.
  const counting = shown === null && quoteCode === null && (!current || quote.isFetching)
  // A buy larger than the curve takes before its threshold: the most it takes now, to be set with one press.
  const curveMaxRaw =
    shown && side === 'buy' && BigInt(shown.amountLeftRaw) > 0n && BigInt(shown.amountInRaw) > 0n
      ? shown.amountInRaw
      : null

  const places = Math.min(2, pair.decimals)
  // The price moves with the side — a buy lifts it, a sale lowers it; a move that rounds to nothing is said as such.
  const moveSize = shown ? formatMoveSize(shown.priceMoveBps, locale) : null
  const money = (raw: string) =>
    BigInt(raw) > 0n && BigInt(raw) < 10n ** BigInt(pair.decimals - places)
      ? `< ${formatNumber(10 ** -places, locale, places)} ${pair.symbol}`
      : `${formatRaw(raw, pair.decimals, locale, places)} ${pair.symbol}`
  /* An estimate of a sum: «≈ 1,24 USDC», but a crumb keeps its own bound alone — «< 0,01 USDC», never «≈ < 0,01 USDC»
     (ST-5). The sign of a crumb steps aside too: the title above already says which way it went. */
  const approxMoney = (raw: string, sign = '') => {
    const text = money(raw)
    return text.startsWith('<') ? text : `≈ ${sign}${text}`
  }
  // A fee is never shown smaller than it is: its digits down to three significant ones, the last rounded up.
  const fee = (raw: string) => `${formatFeeRaw(raw, pair.decimals, locale)} ${pair.symbol}`
  const tokens = (raw: string) => formatRaw(raw, market.tokenDecimals, locale, 0)
  // The fee's share from the same figures as its amount — a buy's amount in, a sale's proceeds before the fee — rounded
  // up, so the percent and the amount beside it agree (the answer's `feeBps` is rounded down).
  const feeShown = shown
    ? feeShareBps(
        shown.fee.totalRaw,
        side === 'buy' ? shown.amountInRaw : BigInt(shown.amountOutRaw) + BigInt(shown.fee.totalRaw),
      )
    : null
  // The price moves further than the max price move chosen under the field.
  const steep = shown !== null && Math.abs(shown.priceMoveBps) > Number(slippage)
  const sniper =
    market.curveFee &&
    market.curveFee.sniperUntil &&
    shown &&
    shown.venue === 'curve' &&
    shown.feeBps > market.curveFee.endBps + 5
      ? market.curveFee
      : null

  // A share of what the wallet holds on this side — the pair currency to buy, the token to sell — rounded down.
  // Buying with SOL keeps the network fee and a new token account's rent (≈0.002 SOL, kept as 0.003) out of the share.
  const solBuy = side === 'buy' && pair.mint === SOL_MINT
  const shareBase =
    spendable === null ? null : solBuy ? (spendable > SOL_BUY_RESERVE ? spendable - SOL_BUY_RESERVE : 0n) : spendable
  const choose = (value: string) => {
    if (shareBase === null || shareBase === 0n) return
    setText(typedAmount((shareBase * BigInt(value)) / 100n, decimals, locale))
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
        setDoneAt(new Date().toISOString())
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
    const title = confirmed
      ? word(bought ? 'boughtTitle' : 'soldTitle', {
          tokens: filled
            ? tokens(filled.tokensRaw)
            : `≈ ${tokens(bought ? result.quote.amountOutRaw : result.quote.amountInRaw)}`,
          symbol,
        })
      : word('tradePendingTitle')
    return (
      <Card className="items-center gap-2 py-5" accessibilityLiveRegion="polite">
        <Icon
          name={confirmed ? 'checkmark-circle' : 'time-outline'}
          size={32}
          color={confirmed ? 'successInk' : 'muted'}
        />
        <Txt variant="title" className="text-center">
          {title}
        </Txt>
        {confirmed ? (
          <Txt variant="data" tone="muted">
            {filled
              ? `${bought ? '−' : '+'}${money(filled.pairRaw)}`
              : approxMoney(bought ? result.quote.amountInRaw : result.quote.amountOutRaw, bought ? '−' : '+')}
          </Txt>
        ) : null}
        <Txt variant="ui" tone="muted" className="text-center">
          {confirmed ? word('tradeDoneLine') : word('tradePendingLine')}
        </Txt>
        <ExplorerLink label={word('viewTx')} url={explorerUrl(market.network, 'tx', result.submit.signature)} />
        <ShareReceiptButton
          variant="button"
          doc={docFromLaunchTrade(
            {
              token: market.token,
              symbol,
              tokenDecimals: market.tokenDecimals,
              pair,
              quote: result.quote,
              submit: result.submit,
              title: confirmed ? receiptWords[bought ? 'launchBought' : 'launchSold'](symbol) : title,
              at: doneAt ?? result.quote.observedAt,
            },
            locale,
          )}
        />
        <Button title={word('tradeAgain')} variant="secondary" onPress={() => setPhase('idle')} />
      </Card>
    )
  }

  // 25 · 50 · 75 · 100 % on both sides, as on every purchase; all of a SOL pair is never offered — the network's fee is paid in it.
  const quick = solBuy ? ['25', '50', '75'] : ['25', '50', '75', '100']
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
      <View ref={fieldBox} collapsable={false} onLayout={() => relayout?.()}>
        <Field
          label={word('amount')}
          value={text}
          onChangeText={setText}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
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
      </View>
      {/* Quick shares are actions that fill the field, not a choice that stays: buttons, not radios. Without a wallet — none.
          While the amount is typed they step aside with the max price move below — what is typed, what it gets and the
          button must fit above the keyboard — and are back as it closes. */}
      {address && !lifted ? (
        <View className="flex-row gap-2">
          {quick.map((value) => {
            const off = busy || shareBase === null || shareBase === 0n
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ disabled: off }}
                disabled={off}
                onPress={() => choose(value)}
                className={`h-11 flex-1 items-center justify-center rounded-pill border border-line active:bg-hover ${off ? 'opacity-50' : ''}`}
              >
                <Txt variant="ui">{formatPercent(Number(value), locale, 0)}</Txt>
              </Pressable>
            )
          })}
        </View>
      ) : null}
      {/* The label above its chips: side by side the last chip ran past the card's edge, the longer Ukrainian label more so.
          While the amount is typed it steps aside — on a phone with a tall keyboard it pushed the button under the keys;
          it is back, with the quote's «at least», as the keyboard closes. */}
      {lifted ? null : (
        <View className="gap-1.5">
          <Txt variant="ui" tone="muted">
            {word('slippage')}
          </Txt>
          <ChoiceChips
            fill
            disabled={busy}
            choices={SLIPPAGES.map((value) => ({ value, label: formatBps(Number(value), locale) }))}
            value={slippage}
            onChange={setSlippage}
          />
        </View>
      )}

      {amountRaw !== null && amountRaw > 0n ? (
        <View className="gap-1 rounded-sm border border-line bg-elevated px-3 py-3" accessibilityLiveRegion="polite">
          {shown ? (
            <>
              <Txt variant="labelSm" tone="faint" caps>
                {word('youGet')}
              </Txt>
              <Txt variant="dataLg">
                {side === 'buy' ? `≈ ${tokens(shown.amountOutRaw)} $${symbol}` : approxMoney(shown.amountOutRaw)}
              </Txt>
              {/* While the amount is typed the quote keeps what decides the press — what it gets, the fee, a buy above the
                  curve's room — and the rest steps aside so the button stays above the keyboard; all of it is back as it closes. */}
              {lifted ? null : (
                <Txt variant="labelSm" tone="faint">
                  {word('atLeast', {
                    amount: side === 'buy' ? `${tokens(shown.minimumOutRaw)} $${symbol}` : money(shown.minimumOutRaw),
                  })}
                </Txt>
              )}
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
              {curveMaxRaw ? (
                <View className="gap-2 pt-1">
                  <View className="flex-row items-start gap-2">
                    <Icon name="warning" size={15} color="warningInk" style={{ marginTop: 1 }} />
                    <Txt variant="ui" tone="warning" className="flex-1">
                      {word('curveTakesUpTo', {
                        amount: formatRaw(curveMaxRaw, pair.decimals, locale, 2),
                        symbol: pair.symbol,
                      })}
                    </Txt>
                  </View>
                  {/* An action that fills the field with the most the curve takes now — the trade itself is unchanged. */}
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    // The chip's own figure, cut down to cents (never above the room), as the field takes it back.
                    onPress={() => setText(typedAmount(curveMaxRaw, pair.decimals, locale, places))}
                    className="h-11 items-center justify-center self-start rounded-pill border border-line px-4 active:bg-hover"
                  >
                    <Txt variant="ui">
                      {word('curveSetMax', {
                        amount: formatRaw(curveMaxRaw, pair.decimals, locale, 2),
                        symbol: pair.symbol,
                      })}
                    </Txt>
                  </Pressable>
                </View>
              ) : null}
              <View className="pt-1">
                <Row
                  label={word('fee')}
                  value={`${formatBps(feeShown ?? shown.feeBps, locale)} · ${fee(shown.fee.totalRaw)}`}
                />
                {lifted ? null : (
                  <>
                    <Row label={word('feeRyntra')} value={fee(shown.fee.ryntraRaw)} />
                    <Row
                      label={word('capAfter')}
                      value={formatMoneyShort(
                        shown.marketCapAfter.usd ?? shown.marketCapAfter.pair,
                        locale,
                        shown.marketCapAfter.usd !== null,
                        pair.symbol,
                      )}
                    />
                  </>
                )}
              </View>
              {lifted ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: split }}
                  onPress={() => setSplit(!split)}
                  hitSlop={8}
                  className="min-h-11 flex-row items-start gap-2 self-start py-2"
                >
                  {/* A move larger than the chosen max price move is a risk said in the warning's tone, never faint. */}
                  {steep ? <Icon name="warning" size={15} color="warningInk" style={{ marginTop: 1 }} /> : null}
                  <View className="shrink gap-0.5">
                    <Txt variant={steep ? 'ui' : 'labelSm'} tone={steep ? 'warning' : 'faint'}>
                      {moveSize === null
                        ? word('priceFlat')
                        : word(side === 'buy' ? 'priceUp' : 'priceDown', { pct: moveSize })}{' '}
                      {split ? '▴' : '▾'}
                    </Txt>
                    {steep ? (
                      <Txt variant="labelSm" tone="warning">
                        {word('priceMoveOver', { max: formatBps(Number(slippage), locale) })}
                      </Txt>
                    ) : null}
                  </View>
                </Pressable>
              )}
              {split && !lifted ? (
                <Txt variant="labelSm" tone="faint">
                  {shown.fee.creatorRaw !== null
                    ? word('feeSplitCurve', {
                        creator: fee(shown.fee.creatorRaw),
                        ryntra: fee(shown.fee.ryntraRaw),
                        meteora: fee(shown.fee.meteoraRaw),
                      })
                    : word('feeSplitPool', {
                        liquidity: shown.fee.liquidityRaw === null ? '—' : fee(shown.fee.liquidityRaw),
                        ryntra: fee(shown.fee.ryntraRaw),
                        meteora: fee(shown.fee.meteoraRaw),
                      })}
                </Txt>
              ) : null}
            </>
          ) : counting ? (
            <Txt variant="ui" tone="muted">
              {word('tradeCounting')}
            </Txt>
          ) : (
            <Txt variant="ui" tone="danger">
              {quoteCode === 'LAUNCH_GRADUATING' ? word('errGraduating') : word('errQuote')}
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

      {/* What must stay above the keyboard while the amount is typed: the quote and its fee end here, the button with them. */}
      <View
        ref={actionBox}
        collapsable={false}
        className="gap-3"
        // The quote grew or shrank under the field: the button is kept in sight again.
        onLayout={() => relayout?.()}
      >
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
      </View>
      {jupiter}
    </Card>
  )
}
