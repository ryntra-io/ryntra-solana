import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'

import { BOTTOM_ACTION_INSET, BottomAction } from '@/components/bottom-action'
import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { Icon } from '@/components/icon'
import { ReceiptCard } from '@/components/receipt-card'
import { ReviewBlock } from '@/components/review-block'
import { Screen } from '@/components/screen'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import { AskRyn } from '@/features/agent/ask-ryn'
import { isInstant, isRuleId, purchaseSumUsd } from '@/features/autoinvest/rule-model'
import { useRule, useRules, useRuleWrites } from '@/features/autoinvest/use-rules'
import { ruleWhenLine } from '@/features/autoinvest/words'
import { dollarsText } from '@/features/invest/buy-model'
import { useAccount } from '@/features/session/use-account'
import {
  lowerFirst,
  ORDER_TYPES,
  orderTypeOf,
  RULE_TICKET_COPY,
  ruleSumText,
  ticketRuleLine,
  ticketRuleRefusal,
  ticketRuleState,
  type OrderType,
} from '@/features/trade/rule-ticket'
import { TRADE_COPY } from '@/features/trade/copy'
import {
  formatUnits,
  QUOTE_ASSETS,
  reviewView,
  settledView,
  SOL_ASSET,
  ticketLegs,
  unitsForField,
  USDC_ASSET,
  type TradeAsset,
  type TradeLegs,
  type TradeMode,
} from '@/features/trade/trade-model'
import { defaultQuoteAsset, useTrade } from '@/features/trade/use-trade'
import {
  fetchMarketsByMints,
  isMint,
  SOL_MINT,
  USDC_MINT,
  type ExecutionPlanBinding,
  type RuleBinding,
} from '@/lib/api'
import { PLANS_COPY } from '@/features/plans/copy'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { RuleReminderNotice } from '@/screens/autoinvest/rule-reminder-notice'
import { useNow } from '@/hooks/use-now'
import { StrategyBlock } from '@/screens/plans/strategy-block'
import { type, useTheme } from '@/theme'
import { formatAge, formatClock, formatUsdCompact, shortAddress } from '@/utils/format'
import { useHoldings } from '@/features/portfolio/use-portfolio'

import { AssetPickerSheet, AssetPill, assetFromRow } from './asset-picker'
import { RecurringPanel } from './recurring-panel'
import { RuleChip, RuleReviewRow } from './rule-parts'

const MODE_KEYS: readonly TradeMode[] = ['buy', 'sell', 'swap']

type Picking = null | 'pay' | 'receive'

/** The market row for one mint — the ticket's name, icon and decimals for an asset that arrived as an address. */
function useAssetRow(mint: string | null) {
  return useQuery({
    queryKey: ['trade', 'asset', mint ?? ''],
    queryFn: ({ signal }) => fetchMarketsByMints([mint!], signal),
    enabled: mint !== null,
    staleTime: 60_000,
    retry: 1,
  })
}

/** What the wallet holds of the paid asset, by address — for the Available line and MAX. */
function useAvailable(address: string | null, asset: TradeAsset | null) {
  // The one holdings query every screen shares — the same function, so its reads carry the same facts.
  const holdings = useHoldings(address)
  if (!asset || !holdings.data) return null
  const row = holdings.data.data.holdings.find((holding) =>
    asset.mint === SOL_MINT ? holding.kind === 'NATIVE_SOL' : holding.mint === asset.mint,
  )
  const decimals = row?.decimals ?? asset.decimals
  if (decimals === null) return null
  return {
    raw: row?.spendableRaw ?? '0',
    decimals,
    lamports: holdings.data.data.lamports,
    at: holdings.data.data.observedAt,
  }
}

/**
 * Buy, Sell and Swap from one surface. The ticket is two legs and an
 * amount; the estimate is the server's live quote with its age; Review is
 * the server's exact order, judged before the wallet opens; the wallet
 * signs those bytes and the server submits once; the receipt says what
 * actually happened; a signature the app closed on is found and checked,
 * never repeated. Nothing on this screen moves value by itself. Every word
 * and figure is in the person's language — the web's Spot words.
 */
export function TradeScreen() {
  const { colors } = useTheme()
  const router = useRouter()
  const shared = useSharedCopy()
  const locale = useLocale()
  const words = useCopy(TRADE_COPY)
  // A stack screen now: back returns to the asset, the plan or the tab it was opened from; Home when there is nothing behind.
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))
  const params = useLocalSearchParams<{
    mint?: string
    symbol?: string
    side?: string
    plan?: string
    v?: string
    amount?: string
    mode?: string
    /** 1.31.0: a token's rule reminder — the ticket is the rule's purchase (the web's `/app/spot?mint=&rule=&due=`). */
    rule?: string
    due?: string
    /** `recurring` opens «Регулярно» — the token's rule — beside «Ринок». */
    order?: string
  }>()
  const arrivedMint = typeof params.mint === 'string' && isMint(params.mint) ? params.mint : null
  const arrivedSymbol = typeof params.symbol === 'string' && params.symbol.length > 0 ? params.symbol : null
  // A position arrives with the side it asks for — a Sell of what is held — everything else starts as a Buy.
  const arrivedSide: TradeMode = params.side === 'sell' ? 'sell' : 'buy'
  // «Обмін» in «Ще» opens the same surface on a Swap; an asset that arrives decides the side instead.
  const arrivedSwap = !arrivedMint && params.mode === 'swap'
  /* A plan arrives as the binding the person read — the id and the version — and the amount its size plans;
     the plan is context the Review judges on a fresh quote, never a permission (contract §3b). */
  const arrivedPlan: ExecutionPlanBinding | null =
    arrivedMint && arrivedSide === 'buy' && typeof params.plan === 'string' && /^\d+$/.test(params.v ?? '')
      ? { planId: params.plan, version: Number(params.v) }
      : null
  /* A sum arrives with a Buy only — a plan's planned spend, or the sum a person named to Ryntra — paid in USDC,
     the Buy's default leg; never for USDC itself (the leg would be SOL), never for a Sell (the asset's own units). */
  const arrivedAmount =
    arrivedSide === 'buy' &&
    arrivedMint !== USDC_MINT &&
    typeof params.amount === 'string' &&
    /^\d+([.,]\d+)?$/.test(params.amount)
      ? params.amount
      : ''
  // The link carries the sum machine-readable; the field shows it in the person's own shape («5,50» in Ukrainian).
  // Every digit the link carried stays; only the decimal mark is the language's.
  const arrivedField = locale === 'uk' ? arrivedAmount.replace('.', ',') : arrivedAmount.replace(',', '.')
  /* A token's reminder arrives as the rule and its occurrence — read afresh before anything is offered: a link is never
     permission to buy (contract §3j, 1.31.0 §3z). */
  const arrivedRule: Readonly<{ ruleId: string; dueAt: string | null }> | null =
    arrivedMint && isRuleId(params.rule) ? { ruleId: params.rule, dueAt: isInstant(params.due) ? params.due : null } : null
  const arrivedOrder: OrderType = arrivedRule ? 'market' : orderTypeOf(params.order)
  const arrival = arrivedMint
    ? `${arrivedMint}:${arrivedSide}:${arrivedPlan?.planId ?? ''}:${arrivedPlan?.version ?? ''}:${arrivedAmount}:${arrivedRule?.ruleId ?? ''}:${arrivedRule?.dueAt ?? ''}:${arrivedOrder}`
    : arrivedSwap
      ? 'swap'
      : null
  const planCopy = useCopy(PLANS_COPY)

  const ruleWords = useCopy(RULE_TICKET_COPY)
  const [pickedMode, setMode] = useState<TradeMode>(arrivedMint ? arrivedSide : arrivedSwap ? 'swap' : 'buy')
  // The rule's reminder the ticket buys under — from a link, or from the token's own rule here; left with «×».
  const [ruleAsk, setRuleAsk] = useState(arrivedRule)
  // «Ринок · Регулярно» (1.31.0): the order now, or the rule that reminds of it.
  const [orderType, setOrderType] = useState<OrderType>(arrivedOrder)
  // A purchase under a rule is a Buy, whatever was picked before it.
  const mode: TradeMode = ruleAsk ? 'buy' : pickedMode
  const [pickedAsset, setPickedAsset] = useState<TradeAsset | null>(null)
  const [pickedQuote, setPickedQuote] = useState<TradeAsset | null>(null)
  // A Swap starts where most do — SOL for USDC — until the person picks otherwise.
  const [swapPay, setSwapPay] = useState<TradeAsset | null>(SOL_ASSET)
  const [swapReceive, setSwapReceive] = useState<TradeAsset | null>(USDC_ASSET)
  const [amountText, setAmountText] = useState(arrivedField)
  // The plan a Buy trades under; dropped when the person leaves the asset the plan names.
  const [plan, setPlan] = useState<ExecutionPlanBinding | null>(arrivedPlan)
  const [picking, setPicking] = useState<Picking>(null)

  // The asset the person came from: named at once, filled in from its market row when it answers.
  const arrived = useAssetRow(arrivedMint)
  const arrivedAsset = useMemo((): TradeAsset | null => {
    if (!arrivedMint) return null
    const row = arrived.data?.rows.find((candidate) => candidate.mint === arrivedMint)
    return row
      ? assetFromRow(row)
      : {
          mint: arrivedMint,
          symbol: arrivedSymbol ?? shortAddress(arrivedMint),
          name: arrivedSymbol ?? arrivedMint,
          icon: null,
          decimals: null,
        }
  }, [arrivedMint, arrivedSymbol, arrived.data])
  // A new arrival starts a Buy of that asset — or the Sell it asked for; what was picked before it is let go (state adjusted during render, as React prescribes).
  const [seenArrival, setSeenArrival] = useState(arrival)
  if (seenArrival !== arrival) {
    setSeenArrival(arrival)
    setPickedAsset(null)
    setPickedQuote(null)
    setPlan(arrivedPlan)
    setRuleAsk(arrivedRule)
    setOrderType(arrivedOrder)
    if (arrivedMint) setMode(arrivedSide)
    else if (arrivedSwap) setMode('swap')
    if (arrivedField) setAmountText(arrivedField)
  }
  const asset = pickedAsset ?? arrivedAsset
  // The binding holds only while the ticket is the plan's own Buy of the plan's own asset — never beside a rule's.
  const planBinding = plan && !ruleAsk && mode === 'buy' && asset?.mint === arrivedMint ? plan : null

  /* ---- the rule's purchase (1.31.0): the wallet's rule read afresh; open, its sum in USDC and nothing else ---- */
  const account0 = useAccount()
  const session = account0.session
  const now = useNow(15_000)
  const rules = useRules(session)
  const ruleRead = useRule(session, ruleAsk?.ruleId ?? null)
  const ruleWrites = useRuleWrites(session)
  const ruleState =
    ruleAsk && session
      ? ticketRuleState({
          read: ruleRead.read,
          rule: ruleRead.rule,
          dueAt: ruleAsk.dueAt,
          budget: rules.data?.budget ?? null,
          nowMs: now,
          mint: asset?.mint ?? null,
        })
      : null
  const openRule = ruleState?.kind === 'open' ? ruleState : null
  const ruleBinding: RuleBinding | null = openRule
    ? { ruleId: openRule.rule.id, dueAt: openRule.occurrence.dueAt }
    : null
  const ruleSum = openRule ? purchaseSumUsd(openRule.rule, openRule.occurrence) : null
  const ruleName = ruleRead.rule?.name ?? null
  const leaveRule = () => {
    setRuleAsk(null)
    setAmountText('')
  }

  const quoteAsset = ruleAsk
    ? USDC_ASSET
    : pickedQuote && pickedQuote.mint !== asset?.mint
      ? pickedQuote
      : defaultQuoteAsset(QUOTE_ASSETS, asset)

  const chosen = useMemo(
    () => ticketLegs(mode, { asset, quote: quoteAsset, pay: swapPay, receive: swapReceive }),
    [mode, asset, quoteAsset, swapPay, swapReceive],
  )
  // A leg picked without its decimals learns them from its market row before an amount can be priced.
  const unknownLeg =
    chosen.pay?.decimals === null ? chosen.pay : chosen.receive?.decimals === null ? chosen.receive : null
  const learned = useAssetRow(unknownLeg?.mint ?? null)
  const legs = useMemo((): TradeLegs => {
    const fill = (leg: TradeAsset | null): TradeAsset | null => {
      if (!leg || leg.decimals !== null) return leg
      const row = learned.data?.rows.find((candidate) => candidate.mint === leg.mint)
      return row ? { ...leg, decimals: row.decimals, icon: leg.icon ?? row.icon } : leg
    }
    return { pay: fill(chosen.pay), receive: fill(chosen.receive) }
  }, [chosen, learned.data])
  // Under the rule the sum is the rule's own, typed as a person would — the server refuses any other (`RULE_MISMATCH`).
  const ticketAmount = ruleSum !== null ? ruleSumText(ruleSum, locale) : ruleAsk ? '' : amountText
  const trade = useTrade({ mode, legs, amountText: ticketAmount, plan: planBinding, rule: ruleBinding })
  const { account } = trade
  const available = useAvailable(account.address, legs.pay)

  // After a purchase under the rule, or the server's refusal of one, the rule and the inbox are read again.
  const ruleRefusalCode = ruleAsk && trade.failure?.code ? trade.failure.code : null
  const settledUnderRule = ruleAsk !== null && trade.phase === 'settled'
  const reread = ruleWrites.reread
  useEffect(() => {
    if (settledUnderRule || (ruleRefusalCode && ticketRuleRefusal(ruleRefusalCode))) void reread()
  }, [settledUnderRule, ruleRefusalCode, reread])
  const ruleRefusal = ruleAsk ? ticketRuleRefusal(trade.failure?.code) : null

  const modes: readonly Choice<TradeMode>[] = MODE_KEYS.map((value) => ({ value, label: words.modes[value] }))
  const orderTypes: readonly Choice<OrderType>[] = ORDER_TYPES.map((value) => ({
    value,
    label: value === 'market' ? ruleWords.market : ruleWords.recurring,
    disabled: value === 'recurring' && (!asset || trade.busy || Boolean(trade.lockedReview)),
  }))
  // «Регулярно» stands beside a Buy of one token, never under a plan's or a rule's purchase.
  const showOrderTypes = mode === 'buy' && !ruleAsk && !planBinding && asset !== null
  const recurring = showOrderTypes && orderType === 'recurring'
  const ruleChipLine = !ruleAsk
    ? null
    : !session
      ? ruleWords.signInForRule
      : openRule && ruleSum !== null
        ? `${dollarsText(ruleSum, locale)} · ${ruleWhenLine(openRule.rule, locale)}`
        : ruleState
          ? ticketRuleLine(ruleState, ruleWords)
          : ruleWords.readingRule
  const reviewRuleLine =
    openRule && ruleSum !== null
      ? `${dollarsText(ruleSum, locale)} · ${openRule.rule.name} · ${lowerFirst(ruleWhenLine(openRule.rule, locale))}`
      : null

  const pick = (leg: 'pay' | 'receive', chosen: TradeAsset) => {
    setPicking(null)
    if (mode === 'swap') {
      if (leg === 'pay') setSwapPay(chosen)
      else setSwapReceive(chosen)
      return
    }
    const marketLeg = mode === 'buy' ? 'receive' : 'pay'
    if (leg === marketLeg) setPickedAsset(chosen)
    else setPickedQuote(chosen)
  }

  const flip = () => {
    if (mode === 'swap') {
      setSwapPay(swapReceive)
      setSwapReceive(swapPay)
    } else {
      setMode(mode === 'buy' ? 'sell' : 'buy')
    }
    setAmountText('')
  }

  const pickerKind = (leg: 'pay' | 'receive'): 'quote' | 'market' =>
    mode === 'swap' ? 'market' : leg === (mode === 'buy' ? 'pay' : 'receive') ? 'quote' : 'market'

  const estimate =
    trade.quote && legs.pay && legs.receive
      ? reviewView(
          {
            order: trade.quote.order,
            mode,
            pay: legs.pay,
            receive: legs.receive,
            decimals: trade.quote.decimals,
            exact: false,
          },
          locale,
        )
      : null
  const receiveDecimals = legs.receive ? (trade.quote?.decimals[legs.receive.mint] ?? legs.receive.decimals) : null
  const receiveFigure =
    trade.quote && legs.receive && receiveDecimals !== null
      ? formatUnits(trade.quote.order.outAmountRaw, receiveDecimals, 6, locale)
      : null
  const inUsd = trade.quote?.order.inUsdValue ? Number(trade.quote.order.inUsdValue) : null
  const outUsd = trade.quote?.order.outUsdValue ? Number(trade.quote.order.outUsdValue) : null
  const legsReady = legs.pay !== null && legs.receive !== null
  const payLabel = legs.pay ? words.amountIn(legs.pay.symbol) : words.amount

  const insufficient =
    available !== null &&
    trade.typedRaw !== null &&
    /^\d+$/.test(available.raw) &&
    BigInt(trade.typedRaw) > BigInt(available.raw)
  // The network fee is paid in SOL whatever is swapped; a wallet without any cannot sign anything that lands.
  const needsSol = available !== null && /^0+$/.test(available.lamports) && legs.pay?.mint !== SOL_MINT

  const subtitle =
    trade.phase === 'settled'
      ? words.settledLine
      : trade.quote
        ? words.quoteLine(
            formatClock(trade.quote.order.observedAt),
            trade.quoteLeft && trade.quoteLeft > 0 ? words.seconds(trade.quoteLeft) : words.expired,
          )
        : trade.quoting
          ? words.pricing
          : legsReady
            ? words.reviewedFirst
            : words.pickAssets

  // Another trade after a purchase under the rule starts a plain ticket: the rule's reminder is bought.
  const again = () => {
    trade.reset()
    if (ruleAsk) leaveRule()
  }

  /* ---- the resting surface's one action ---- */
  let action: {
    title: string
    onPress: () => void
    disabled?: boolean
    loading?: boolean
    hint?: string
    variant?: 'primary' | 'secondary'
  }
  if (!account.address) {
    action = {
      title: words.connect,
      onPress: () => void account.connect(),
      loading: account.busy === 'connect',
      hint: words.connectHint,
    }
  } else if (!account.session) {
    action = {
      title: words.signIn,
      onPress: () => void account.signIn(),
      loading: account.signingIn,
      hint: words.signInHint,
    }
  } else if (trade.phase === 'settled') {
    action = { title: words.tradeAgain, onPress: again, hint: words.tradeAgainHint }
  } else if (trade.phase === 'recovery' || trade.phase === 'recovering') {
    action = {
      title: words.checkTx,
      onPress: () => void trade.recover(),
      loading: trade.phase === 'recovering',
      hint: words.checkTxHint,
    }
  } else if (trade.lockedReview) {
    action = {
      title: words.release,
      onPress: () => void trade.release(),
      loading: trade.busy,
      hint: words.releaseHint,
      variant: 'secondary',
    }
  } else if (ruleAsk && !openRule) {
    // No plain order stands in for the rule's purchase: the chip above says why, «×» leaves the rule.
    action = {
      title: ruleState === null || ruleState.kind === 'reading' ? ruleWords.readingRule : ruleWords.notUnderRule,
      onPress: () => undefined,
      disabled: true,
      hint: ruleWords.tradeWithoutRule,
    }
  } else {
    const ready =
      legsReady && trade.quoteFresh && !trade.quoteBlocked && !insufficient && !needsSol && trade.typedRaw !== null
    action = {
      title: words.review,
      onPress: () => void trade.review(),
      disabled: !ready,
      loading: trade.phase === 'preparing',
      hint: insufficient
        ? words.moreThanHeld(formatUnits(available!.raw, available!.decimals, 6, locale), legs.pay!.symbol)
        : needsSol
          ? words.needSol
          : trade.quoteBlocked
            ? words.assetBlocked
            : words.reviewHint,
    }
  }

  const settledPlain = trade.settled ? settledView(trade.settled.settlement, trade.settled.context, locale) : null
  // A fill under the rule is the rule's purchase: «Куплено за правилом · SOL», as the web's receipt says it.
  const settledContext = trade.settled?.context ?? null
  const settledCard =
    settledPlain &&
    ruleAsk &&
    settledContext?.mode === 'buy' &&
    settledPlain.status !== 'failed' &&
    settledPlain.status !== 'pending'
      ? { ...settledPlain, title: `${ruleWords.boughtByRule} · ${settledContext.receive.symbol}` }
      : settledPlain
  const attemptCard = trade.attempt?.context ?? null

  return (
    <View className="flex-1 bg-ground">
      <View className="flex-1">
        <Screen
          title={words.title}
          subtitle={subtitle}
          onBack={back}
          backLabel={shared.back}
          right={
            <AskRyn
              context={{ kind: 'page', page: mode === 'swap' ? 'swap' : 'spot' }}
              className="h-9 w-9 border border-line bg-surface"
            />
          }
          bottomInset={recurring ? undefined : BOTTOM_ACTION_INSET}
          contentClassName="gap-3"
        >
          {trade.phase === 'settled' && settledCard ? (
            <View className="gap-3">
              <ReceiptCard
                status={settledCard.status}
                title={settledCard.title}
                paid={settledCard.paid}
                received={settledCard.received}
                at={trade.settled?.at ?? null}
                signature={settledCard.signature}
              />
              {settledCard.note ? (
                <Txt variant="ui" tone="muted">
                  {settledCard.note}
                </Txt>
              ) : null}
              <Button title={words.tradeAgain} variant="secondary" onPress={again} />
            </View>
          ) : null}

          {trade.phase === 'recovery' || trade.phase === 'recovering' ? (
            <Card className="gap-2">
              <View className="flex-row items-center justify-between">
                <Txt variant="labelSm" tone="faint" caps>
                  {words.signedTx}
                </Txt>
                <Chip label={trade.phase === 'recovering' ? words.checking : words.unresolved} tone="warning" />
              </View>
              {attemptCard ? (
                <Txt variant="ui">
                  {words.modeNouns[attemptCard.mode]} ·{' '}
                  {formatUnits(attemptCard.inAmountRaw, attemptCard.payDecimals, 6, locale)} {attemptCard.pay.symbol} →{' '}
                  {attemptCard.receive.symbol}
                </Txt>
              ) : null}
              <Txt variant="ui" tone="muted">
                {settledCard?.note ?? (attemptCard ? words.attemptUnknown : words.earlierUnresolved)}
              </Txt>
              {trade.attempt ? (
                <Txt variant="data" tone="faint">
                  {shortAddress(trade.attempt.signature, 8)} · {formatAge(trade.attempt.recordedAt, undefined, locale)}
                </Txt>
              ) : null}
            </Card>
          ) : null}

          {trade.phase !== 'settled' ? (
            <>
              <ChoiceChips
                choices={modes}
                value={mode}
                onChange={setMode}
                role="radiogroup"
                disabled={ruleAsk !== null}
              />
              {/* The rule's purchase: what it buys and when, or why the ticket is not it now — and «×» to leave the rule. */}
              {ruleAsk ? (
                <RuleChip
                  title={ruleName ? `${ruleWords.byYourRule} · ${ruleName}` : ruleWords.byYourRule}
                  line={ruleChipLine}
                  open={openRule !== null}
                  leaveLabel={ruleWords.tradeWithoutRule}
                  onLeave={leaveRule}
                  disabled={trade.busy}
                />
              ) : null}
              {showOrderTypes ? (
                <ChoiceChips choices={orderTypes} value={orderType} onChange={setOrderType} role="tablist" quiet />
              ) : null}
              {planBinding ? (
                <View className="flex-row flex-wrap items-center gap-2">
                  <Chip
                    label={planCopy.underPlan(asset?.symbol ?? arrivedSymbol ?? '', planBinding.version)}
                    tone="brand"
                    caps={false}
                  />
                  <Txt variant="labelSm" tone="faint" className="flex-1">
                    {planCopy.planContextNote}
                  </Txt>
                </View>
              ) : null}

              {recurring && asset ? (
                <RecurringPanel
                  asset={asset}
                  onBuyUnderRule={(binding) => {
                    setOrderType('market')
                    setRuleAsk(binding)
                  }}
                  onMarket={() => setOrderType('market')}
                />
              ) : (
              <>
              <Card className="gap-2">
                <View className="flex-row items-center justify-between gap-3">
                  <Txt variant="labelSm" tone="faint" caps numberOfLines={1} className="shrink-0">
                    {words.youPay}
                  </Txt>
                  {available ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={words.useAll}
                      onPress={() => setAmountText(unitsForField(available.raw, available.decimals, locale))}
                      // Under a rule the sum is the rule's own: nothing here changes it.
                      disabled={ruleAsk !== null}
                      hitSlop={6}
                    >
                      <Txt variant="labelSm" tone={insufficient ? 'danger' : 'muted'}>
                        {words.available(formatUnits(available.raw, available.decimals, 6, locale))}
                      </Txt>
                    </Pressable>
                  ) : null}
                </View>
                <View className="flex-row items-center gap-3">
                  <TextInput
                    // Under a rule the field shows the sum the ticket quotes and signs — the rule's, never what was typed before.
                    value={ruleAsk ? ticketAmount : amountText}
                    onChangeText={(text) => setAmountText(text.replace(/[^\d.,]/g, ''))}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={colors.fgMuted}
                    selectionColor={colors.brand}
                    cursorColor={colors.brand}
                    accessibilityLabel={payLabel}
                    editable={trade.phase === 'idle' && !trade.lockedReview && !ruleAsk}
                    className="flex-1 text-fg"
                    style={[type.dataLg, { paddingVertical: 0 }]}
                  />
                  <AssetPill
                    asset={legs.pay}
                    placeholder={words.asset}
                    onPress={() => setPicking('pay')}
                    disabled={trade.phase !== 'idle' || ruleAsk !== null}
                  />
                </View>
                {inUsd !== null && Number.isFinite(inUsd) ? (
                  <Txt variant="ui" tone="faint">
                    ≈ {formatUsdCompact(inUsd, locale)}
                  </Txt>
                ) : null}
              </Card>

              <View className="z-10 -my-5 items-center">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={words.flip}
                  onPress={flip}
                  disabled={trade.phase !== 'idle' || ruleAsk !== null}
                  hitSlop={8}
                  className="h-10 w-10 items-center justify-center rounded-pill border border-line bg-elevated active:bg-hover"
                >
                  <Icon name="swap-vertical" size={20} color="fg" />
                </Pressable>
              </View>

              <Card className="gap-2">
                <Txt variant="labelSm" tone="faint" caps>
                  {words.youReceiveEstimate}
                </Txt>
                <View className="flex-row items-center gap-3">
                  <Txt variant="dataLg" tone={receiveFigure ? 'fg' : 'muted'} className="flex-1" numberOfLines={1}>
                    {receiveFigure ?? (trade.quoting ? words.pricing : '—')}
                  </Txt>
                  <AssetPill
                    asset={legs.receive}
                    placeholder={words.asset}
                    onPress={() => setPicking('receive')}
                    disabled={trade.phase !== 'idle' || ruleAsk !== null}
                  />
                </View>
                {outUsd !== null && Number.isFinite(outUsd) ? (
                  <Txt variant="ui" tone="faint">
                    ≈ {formatUsdCompact(outUsd, locale)}
                  </Txt>
                ) : null}
              </Card>

              {/* A Buy of a company whose rule's reminder is open: a purchase here leaves it open. */}
              {mode === 'buy' && account.session && !ruleAsk ? (
                <RuleReminderNotice
                  session={account.session}
                  mint={legs.receive?.mint ?? null}
                  onBuy={(binding) => setRuleAsk(binding)}
                />
              ) : null}

              {estimate ? (
                <ReviewBlock
                  rows={estimate.rows.slice(1)}
                  quotedAt={trade.quote?.order.observedAt ?? null}
                  quoteTtlSeconds={Math.max(
                    1,
                    Math.round((Date.parse(trade.quote!.expiresAt) - Date.parse(trade.quote!.order.observedAt)) / 1000),
                  )}
                  warnings={trade.quoteBlocked ? [words.assetBlocked] : estimate.warnings}
                />
              ) : null}

              {ruleRefusal ? (
                <Txt variant="ui" tone="danger">
                  {ruleWords[ruleRefusal]}
                </Txt>
              ) : null}

              {trade.quoteFailure ? (
                <View className="flex-row flex-wrap items-center gap-2">
                  <Txt variant="ui" tone="danger" className="flex-1">
                    {words.failures[trade.quoteFailure.key]}
                  </Txt>
                  {trade.quoteFailure.retryable ? (
                    <Button title={words.tryAgain} variant="secondary" size="sm" onPress={trade.refreshQuote} />
                  ) : null}
                </View>
              ) : null}

              {trade.failure &&
              !ruleRefusal &&
              trade.phase !== 'review' &&
              trade.phase !== 'signing' &&
              trade.failure.key !== trade.quoteFailure?.key ? (
                <View className="gap-2">
                  <Txt variant="ui" tone="danger">
                    {words.failures[trade.failure.key]}
                  </Txt>
                  {trade.failure.planReview ? (
                    <StrategyBlock review={trade.failure.planReview} symbol={asset?.symbol ?? arrivedSymbol ?? ''} />
                  ) : null}
                </View>
              ) : null}
              </>
              )}
            </>
          ) : null}
        </Screen>
      </View>
      {/* In «Регулярно» the rule's own button is the screen's one action. */}
      {recurring ? null : (
        <BottomAction
          title={action.title}
          onPress={action.onPress}
          disabled={action.disabled}
          loading={action.loading}
          hint={action.hint}
          variant={action.variant}
        />
      )}

      <AssetPickerSheet
        visible={picking !== null}
        title={picking === 'pay' ? words.youPay : words.youReceive}
        kind={picking ? pickerKind(picking) : 'market'}
        exclude={picking === 'pay' ? (legs.receive?.mint ?? null) : (legs.pay?.mint ?? null)}
        onClose={() => setPicking(null)}
        onPick={(chosen) => picking && pick(picking, chosen)}
      />

      <Sheet
        visible={trade.phase === 'review' || trade.phase === 'signing'}
        title={words.reviewTitle}
        subtitle={
          trade.reviewLeft !== null
            ? trade.reviewLeft > 0
              ? words.closesIn(trade.reviewLeft)
              : words.closedNewQuote
            : undefined
        }
        onClose={trade.phase === 'signing' ? () => undefined : trade.closeReview}
        scroll
      >
        {trade.prepared && legs.pay && legs.receive ? (
          <ReviewSheetBody
            trade={trade}
            mode={mode}
            pay={legs.pay}
            receive={legs.receive}
            locale={locale}
            ruleLine={reviewRuleLine}
            ruleLabel={ruleWords.yourRule}
            ruleRefusal={ruleRefusal ? ruleWords[ruleRefusal] : null}
          />
        ) : null}
      </Sheet>
    </View>
  )
}

function ReviewSheetBody({
  trade,
  mode,
  pay,
  receive,
  locale,
  ruleLine,
  ruleLabel,
  ruleRefusal,
}: {
  trade: ReturnType<typeof useTrade>
  mode: TradeMode
  pay: TradeAsset
  receive: TradeAsset
  locale: Locale
  /** «$5 · SOL · щотижня · ср о 19:00» — the rule this purchase is made under (1.31.0); null for a plain order. */
  ruleLine: string | null
  ruleLabel: string
  /** A refusal under the rule, in the rule's words. */
  ruleRefusal: string | null
}) {
  const words = TRADE_COPY[locale]
  const prepared = trade.prepared!
  const planReview = prepared.order.planReview ?? null
  const view = reviewView(
    {
      order: prepared.order.order,
      mode,
      pay,
      receive,
      decimals: prepared.order.decimals,
      exact: true,
      findings: prepared.order.policy.verdict.findings,
    },
    locale,
  )
  const closed = trade.reviewLeft !== null && trade.reviewLeft <= 0
  const signable = !closed && !trade.invalidated && trade.reviewLeft !== null && trade.reviewLeft >= 10
  return (
    <View className="gap-3 pb-2">
      <View className="flex-row gap-3">
        <View className="flex-1 gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {words.youPay}
          </Txt>
          <Txt variant="data">{view?.pay ?? '—'}</Txt>
        </View>
        <View className="flex-1 gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {words.youReceive}
          </Txt>
          <Txt variant="data">{view?.receive ?? '—'}</Txt>
        </View>
      </View>
      {planReview ? <StrategyBlock review={planReview} symbol={mode === 'buy' ? receive.symbol : pay.symbol} /> : null}
      {ruleLine ? <RuleReviewRow label={ruleLabel} line={ruleLine} /> : null}
      {view ? (
        <ReviewBlock
          rows={view.rows.slice(1)}
          quotedAt={prepared.order.order.observedAt}
          quoteTtlSeconds={Math.max(
            1,
            Math.round((Date.parse(prepared.order.expiresAt) - Date.parse(prepared.order.order.observedAt)) / 1000),
          )}
          warnings={view.warnings}
        />
      ) : null}
      {trade.failure ? (
        <Txt variant="ui" tone="danger">
          {ruleRefusal ?? words.failures[trade.failure.key]}
        </Txt>
      ) : null}
      {closed || trade.invalidated ? (
        <Button title={words.newQuote} onPress={trade.closeReview} />
      ) : (
        <Button
          title={trade.phase === 'signing' ? words.waitingWallet : words.signInWallet}
          onPress={() => void trade.sign()}
          loading={trade.phase === 'signing'}
          disabled={!signable}
        />
      )}
      <Button title={words.cancel} variant="ghost" onPress={trade.closeReview} disabled={trade.phase === 'signing'} />
    </View>
  )
}
