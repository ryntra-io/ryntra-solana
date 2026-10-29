import { useQuery } from '@tanstack/react-query'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BackHandler, Modal, Pressable, ScrollView, View } from 'react-native'

import { Button } from '@/components/button'
import { Chip } from '@/components/chip'
import { COMPONENT_COPY } from '@/components/copy'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { Keypad } from '@/components/keypad'
import { Txt } from '@/components/txt'
import { isInstant, isRuleId, purchaseSumUsd } from '@/features/autoinvest/rule-model'
import { useRule, useRules, useRuleWrites } from '@/features/autoinvest/use-rules'
import { ruleWhenLine } from '@/features/autoinvest/words'
import { dollarsText, MIN_BUY_USD } from '@/features/invest/buy-model'
import { companyDisplayName } from '@/features/invest/shelf'
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
import { quoteFailureLine, TRADE_COPY } from '@/features/trade/copy'
import { DOLLAR_PLACES, pressKey, withMark, type PadKey } from '@/features/trade/keypad-model'
import { clockOf, SHEET_COPY } from '@/features/trade/sheet-copy'
import { useOpenPlace, usePlaceHold } from '@/features/shell/open-place'
import { PORTFOLIO_HISTORY_PATH, SWAP_PATH, TRADE_PATH } from '@/features/shell/shell'
import {
  approxFigure,
  failureTone,
  floorSolUsd,
  formatUnits,
  groupedField,
  legMarks,
  legWarning,
  payingAssetFor,
  priceLossPct,
  quoteNetworkFee,
  PAY_SHARES_PCT,
  QUOTE_ASSETS,
  reviewBelongsHere,
  reviewView,
  settledView,
  shareOfRaw,
  shortUnits,
  SOL_ASSET,
  swapNetworkFee,
  ticketLegs,
  ticketSpendableRaw,
  underOneDollar,
  unitsForField,
  usdAtPrice,
  USDC_ASSET,
  type LegMarks,
  type TradeAsset,
  type TradeLegs,
  type TradeMode,
} from '@/features/trade/trade-model'
import {
  quoteLiveShare,
  sharesPerTokenOf,
  stockLegUsd,
  ticketPoolWarning,
  type StockPoolFacts,
} from '@/features/trade/stock-pool'
import { useTrade } from '@/features/trade/use-trade'
import { poolWarningText } from '@/features/invest/pool-warning'
import { useStockAsset } from '@/hooks/use-market'
import { useStockUniverse } from '@/hooks/use-markets'
import {
  fetchMarketsByMints,
  isMint,
  SOL_MINT,
  USDC_MINT,
  USDT_MINT,
  type ExecutionPlanBinding,
  type RuleBinding,
} from '@/lib/api'
import { PLANS_COPY } from '@/features/plans/copy'
import { INVEST_COPY } from '@/features/invest/copy'
import { TopUpSheet } from '@/screens/home/top-up-sheet'
import { docFromSwap, type DocStatus } from '@/features/receipts/receipt-doc'
import { useCopy, useLocale } from '@/lib/i18n'
import { RuleReminderNotice } from '@/screens/autoinvest/rule-reminder-notice'
import { ShareReceiptButton } from '@/screens/receipts/share-receipt'
import { useNow } from '@/hooks/use-now'
import { StrategyBlock } from '@/screens/plans/strategy-block'
import { cn } from '@/utils/cn'
import { formatAge, formatClock, formatCount, formatUsd, shortAddress } from '@/utils/format'
import { useHoldings } from '@/features/portfolio/use-portfolio'

import { AssetPickerSheet, AssetPill, assetFromRow } from './asset-picker'
import { LimitPanel } from './limit-panel'
import { RecurringPanel } from './recurring-panel'
import { RuleChip, RuleReviewRow } from './rule-parts'
import {
  CheckRows,
  ChoiceList,
  DoneBody,
  OptionRow,
  PoolLine,
  SheetAction,
  SheetFrame,
  SolKeptHelp,
  ValidFor,
  WaitBody,
} from './sheet-parts'

/** The sheet's steps before «Перевірка». */
type Step = 'ticket' | 'type' | 'asset' | 'quote'

/** A purchase paid in a dollar: its sum is said in dollars, any sum from $1 (`MIN_BUY_USD`). */
const DOLLAR_MINTS: ReadonlySet<string> = new Set([USDC_MINT, USDT_MINT])

const NO_PARAMS: Readonly<Record<string, string | undefined>> = {}

/** The settled card's state as the receipt's: a recovered fill is a fill. */
const SETTLED_STATUS: Readonly<Record<'settled' | 'pending' | 'failed' | 'recovered', DocStatus>> = {
  settled: 'done',
  recovered: 'done',
  pending: 'pending',
  failed: 'failed',
}

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
  const read = holdings.data.data
  const row = read.holdings.find((holding) =>
    asset.mint === SOL_MINT ? holding.kind === 'NATIVE_SOL' : holding.mint === asset.mint,
  )
  /* No row is «none held» only where the read could see it: SOL with no lamports, a token on a read of both token
     programs. Otherwise the balance is unknown — no «Not enough», no shares — never a zero (ST-5). */
  const seenEmpty = asset.mint === SOL_MINT ? /^0+$/.test(read.lamports) : (read.tokenRead ?? 'COMPLETE') === 'COMPLETE'
  if (!row && !seenEmpty) return null
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
 * A stock token's facts for its pool's warning — the universe's row at once, the stock's full read for the reference,
 * the pool and the shares a token stands for; null for a token that is no stock. `pending` while that is not known yet.
 */
function useStockFacts(mint: string | null, heldMultiplier: number | null) {
  const universe = useStockUniverse(mint !== null)
  const row = mint ? (universe.data?.rows.find((candidate) => candidate.mint === mint) ?? null) : null
  const read = useStockAsset(row ? row.mint : null)
  const facts: StockPoolFacts | null = row
    ? {
        referencePerShare: read.data?.row.reference.perShare ?? row.reference,
        deviationPct: read.data ? read.data.row.deviationPct : row.deviation,
        liquidityUsd: read.data?.row.market.liquidityUsd ?? row.liquidity,
        sharesPerToken: sharesPerTokenOf(read.data, heldMultiplier),
      }
    : null
  const pending = mint !== null && (universe.isLoading || (row !== null && read.isLoading))
  return { facts, pending }
}

/**
 * Buy, Sell and Swap, in the new look (NEW-LOOK §3–5). The ticket is two legs
 * and an amount; the estimate is the server's live quote with its age; Review
 * is the server's exact order, judged before the wallet opens; the wallet
 * signs those bytes and the server submits once; «Готово» says what actually
 * happened; a signature the app closed on is found and checked, never
 * repeated. Nothing here moves value by itself; the routes, «Перевірка» and
 * the signature are the server's, as before.
 *
 * `sheet` — `/trade`, the one sheet of a purchase and a sale over the page it
 * was opened from: the sum → «Тип» → «Перевірка» → the wallet → «Готово», one
 * step at a time inside it. `swap` — the segment «Обмін» of «Торгівля».
 */
export function TradeScreen({ variant = 'sheet' }: { variant?: 'sheet' | 'swap' } = {}) {
  const router = useRouter()
  const openPlace = useOpenPlace()
  const locale = useLocale()
  const words = useCopy(TRADE_COPY)
  const routeParams = useLocalSearchParams<{
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
    /** `recurring` opens «Регулярно» — the token's rule — beside «Ринок»; `limit` the limit ticket. */
    order?: string
  }>()
  // «Обмін» in «Торгівля» is its own place: a link's asset or side belongs to the sheet, never to it.
  const params = variant === 'swap' ? NO_PARAMS : routeParams
  const arrivedMint = typeof params.mint === 'string' && isMint(params.mint) ? params.mint : null
  const arrivedSymbol = typeof params.symbol === 'string' && params.symbol.length > 0 ? params.symbol : null
  // A position arrives with the side it asks for — a Sell of what is held — everything else starts as a Buy.
  const arrivedSide: TradeMode = params.side === 'sell' ? 'sell' : 'buy'
  // «Обмін» from Home or «Меню» opens the same surface on a Swap; an asset that arrives decides the side instead.
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
    arrivedMint && isRuleId(params.rule)
      ? { ruleId: params.rule, dueAt: isInstant(params.due) ? params.due : null }
      : null
  const arrivedOrder: OrderType = arrivedRule ? 'market' : orderTypeOf(params.order)
  const arrival = arrivedMint
    ? `${arrivedMint}:${arrivedSide}:${arrivedPlan?.planId ?? ''}:${arrivedPlan?.version ?? ''}:${arrivedAmount}:${arrivedRule?.ruleId ?? ''}:${arrivedRule?.dueAt ?? ''}:${arrivedOrder}`
    : arrivedSwap
      ? 'swap'
      : null
  const planCopy = useCopy(PLANS_COPY)
  const toSwapPlace = variant === 'sheet' && arrivedSwap
  useEffect(() => {
    if (toSwapPlace) openPlace(SWAP_PATH)
  }, [toSwapPlace, openPlace])

  const ruleWords = useCopy(RULE_TICKET_COPY)
  const [pickedMode, setMode] = useState<TradeMode>(
    variant === 'swap' ? 'swap' : arrivedMint ? arrivedSide : arrivedSwap ? 'swap' : 'buy',
  )
  // The sheet's step before «Перевірка»: the ticket, «Тип», the asset to buy, or what it is paid with.
  const [step, setStep] = useState<Step>('ticket')
  const sheet = useCopy(SHEET_COPY)
  // The rule's reminder the ticket buys under — from a link, or from the token's own rule here; left with «×».
  const [ruleAsk, setRuleAsk] = useState(arrivedRule)
  // «Ринок · Ліміт · Регулярно»: the order now, at a price (C3), or the rule that reminds of it (1.31.0).
  const [orderType, setOrderType] = useState<OrderType>(arrivedOrder)
  // A purchase under a rule is a Buy, whatever was picked before it.
  const mode: TradeMode = ruleAsk ? 'buy' : pickedMode
  const [pickedAsset, setPickedAsset] = useState<TradeAsset | null>(null)
  const [pickedQuote, setPickedQuote] = useState<TradeAsset | null>(null)
  // A Swap starts where most do — SOL for USDC — until the person picks otherwise.
  const [swapPay, setSwapPay] = useState<TradeAsset | null>(SOL_ASSET)
  const [swapReceive, setSwapReceive] = useState<TradeAsset | null>(USDC_ASSET)
  const [amountText, setAmountText] = useState(arrivedField)
  // ST-3: a share chip puts the sum in whole — it is priced at once, with no typing to wait out.
  const [amountNow, setAmountNowState] = useState<string | null>(null)
  const setAmountNow = (text: string) => {
    setAmountNowState(text)
    setAmountText(text)
  }
  /* The field is always in the language's shape (ST-5 r8): a sum typed «0,00001» in Ukrainian reads «0.00001» once the
     language is English — the same amount, and the keypad's «.» is its mark again (state adjusted during render). */
  const fieldMark: ',' | '.' = locale === 'uk' ? ',' : '.'
  const [markSeen, setMarkSeen] = useState(fieldMark)
  if (markSeen !== fieldMark) {
    setMarkSeen(fieldMark)
    setAmountText((text) => withMark(text, fieldMark))
    setAmountNowState((text) => (text === null ? null : withMark(text, fieldMark)))
  }
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
    setStep('ticket')
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

  /* What a purchase is paid with before the person picks: what the wallet can spend — USDC from a dollar, else SOL
     (`payingAssetFor`). Settled once the wallet's read answers and before a sum is typed, so a typed sum never changes
     its unit under the person's finger; a sale and a rule's purchase keep their own. */
  const ownHoldings = useHoldings(account0.address)
  const [paySettled, setPaySettled] = useState<TradeAsset | null>(null)
  if (paySettled === null && ownHoldings.data && mode === 'buy' && !ruleAsk && !pickedQuote && amountText === '') {
    const rows = ownHoldings.data.data.holdings
    const spendable = (mint: string): string | null =>
      (mint === SOL_MINT
        ? rows.find((row) => row.kind === 'NATIVE_SOL')
        : rows.find((row) => row.kind !== 'NATIVE_SOL' && row.mint === mint)
      )?.spendableRaw ?? null
    setPaySettled(payingAssetFor(QUOTE_ASSETS, asset, spendable))
  }
  const quoteAsset = ruleAsk
    ? USDC_ASSET
    : pickedQuote && pickedQuote.mint !== asset?.mint
      ? pickedQuote
      : paySettled && paySettled.mint !== asset?.mint
        ? paySettled
        : payingAssetFor(QUOTE_ASSETS, asset, null)

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
  /* SOL's own price, for the $1 floor of a purchase paid in SOL — the market's figure, not a venue's estimate of the sum —
     and for a sale's dollars received in SOL where its estimate states none. */
  const solRow = useAssetRow(legs.pay?.mint === SOL_MINT || legs.receive?.mint === SOL_MINT ? SOL_MINT : null)
  const solUsd = solRow.data?.rows.find((row) => row.mint === SOL_MINT)?.price ?? null
  /* A swap's two legs read from their market rows (ST-5 r7): Jupiter's check and flag beside each token — whatever list
     it was picked from — and its price for a dollar line the estimate does not give. The same query as every row here. */
  const payRead = useAssetRow(mode === 'swap' ? (legs.pay?.mint ?? null) : null)
  const receiveRead = useAssetRow(mode === 'swap' ? (legs.receive?.mint ?? null) : null)
  const payMarket = payRead.data?.rows.find((row) => row.mint === legs.pay?.mint) ?? null
  const receiveMarket = receiveRead.data?.rows.find((row) => row.mint === legs.receive?.mint) ?? null
  const payMarks = mode === 'swap' ? legMarks(legs.pay, payMarket) : null
  const receiveMarks = mode === 'swap' ? legMarks(legs.receive, receiveMarket) : null
  // Under the rule the sum is the rule's own, typed as a person would — the server refuses any other (`RULE_MISMATCH`).
  const ticketAmount = ruleSum !== null ? ruleSumText(ruleSum, locale) : ruleAsk ? '' : amountText
  const trade = useTrade({
    mode,
    legs,
    amountText: ticketAmount,
    amountNow,
    plan: planBinding,
    rule: ruleBinding,
    // A kept Review comes back only on the surface it was made on (`reviewBelongsHere`).
    restore: (saved) =>
      reviewBelongsHere(saved.context, { mode, pay: legs.pay?.mint ?? null, receive: legs.receive?.mint ?? null }),
    // AG-2b: this sheet says «Оновлюємо ціну…» — its Review renews itself while it is read.
    renewWhileRead: true,
  })
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

  // A Sell has no «Регулярно»: a ticket turned to Sell on it is a market order again.
  const order: OrderType = mode !== 'buy' && orderType === 'recurring' ? 'market' : orderType
  // The order types stand beside a Buy or a Sell of one token, never under a plan's or a rule's purchase.
  const showOrderTypes = (mode === 'buy' || mode === 'sell') && !ruleAsk && !planBinding && asset !== null
  const recurring = showOrderTypes && order === 'recurring'
  const limit = showOrderTypes && order === 'limit'
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
    }
    setAmountText('')
  }

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
  const payDecimals = legs.pay ? (trade.quote?.decimals[legs.pay.mint] ?? legs.pay.decimals) : null
  // A sum above zero is typed: an estimate it has not got yet is a dash, never «0» (ST-5).
  const typedSome = trade.typedRaw !== null && !/^0*$/.test(String(trade.typedRaw))
  /* The estimate for the amount on screen (ST-5 r10): its figure, its dollars and its pool's judgement all read this one
     quote — never the figure of one and the warning of another. While the typing settles it is «Рахуємо ціну…». */
  const shownQuote = trade.quote && trade.quote.order.inAmountRaw === trade.typedRaw ? trade.quote : null
  const settling = typedSome && shownQuote === null && trade.typedRaw !== trade.amountRaw
  const pricing = trade.quoting || settling
  // An estimate's figure, short: a dollar to the cent, any other token to six significant digits (ST-5).
  const receiveFigure =
    shownQuote && legs.receive && receiveDecimals !== null
      ? shortUnits(shownQuote.order.outAmountRaw, receiveDecimals, legs.receive.mint, locale)
      : null
  /* The dollars of what is paid: the estimate's own figure; while it has none and SOL pays, the typed SOL at SOL's market
     price (ST-5) — «1 SOL» reads «≈ $…» under it, not a dash beside a known rate. Display only: nothing is decided on it.
     Only the estimate for the amount on screen says it (ST-5 r9): while the next is awaited — the typing's pause, a
     «too many requests» window — an older amount's dollars never stand under the new amount; the typed amount at the
     token's known price does, or «—». */
  const quotedInUsd = shownQuote?.order.inUsdValue ? Number(shownQuote.order.inUsdValue) : null
  // Any other token paid is priced the same way, by its own market row or the price its list said (ST-5 r7).
  const payPrice = legs.pay?.mint === SOL_MINT ? solUsd : (payMarket?.price ?? legs.pay?.price ?? null)
  const receivePrice = legs.receive?.mint === SOL_MINT ? solUsd : (receiveMarket?.price ?? legs.receive?.price ?? null)
  const marketInUsd =
    quotedInUsd !== null && Number.isFinite(quotedInUsd)
      ? quotedInUsd
      : usdAtPrice(trade.typedRaw, legs.pay?.decimals ?? null, payPrice)
  /* The dollars of what is received: the estimate's own figure; while it has none, the estimated amount at the token's
     market price — a known price is never a «—» (ST-5 r7). Display only: nothing is decided on it. */
  const quotedOutUsd = shownQuote?.order.outUsdValue ? Number(shownQuote.order.outUsdValue) : null
  const marketOutUsd =
    quotedOutUsd !== null && Number.isFinite(quotedOutUsd)
      ? quotedOutUsd
      : usdAtPrice(shownQuote?.order.outAmountRaw ?? null, receiveDecimals, receivePrice)

  /* ---- a stock token's pool (ST-5 r9–r10): said in the ticket and in «Обмін» as the asset page says it ----
     SGOVx: «Ринок $2 090,70» a token against a $100,59 share, $0,2 in its pool. The facts are the stock's own read (the
     universe's row at once, the full read for the shares a token stands for); a token that is no stock says nothing. */
  const heldRows = ownHoldings.data?.data.holdings ?? null
  const heldMultiplier = (mint: string | null): number | null =>
    mint ? (heldRows?.find((row) => row.kind !== 'NATIVE_SOL' && row.mint === mint)?.uiMultiplier ?? null) : null
  const stockAsset = mode !== 'swap' ? asset : null
  const ticketStock = useStockFacts(stockAsset?.mint ?? null, heldMultiplier(stockAsset?.mint ?? null))
  const payStock = useStockFacts(mode === 'swap' ? (legs.pay?.mint ?? null) : null, heldMultiplier(legs.pay?.mint ?? null))
  const receiveStock = useStockFacts(
    mode === 'swap' ? (legs.receive?.mint ?? null) : null,
    heldMultiplier(legs.receive?.mint ?? null),
  )
  const stockFacts = ticketStock.facts
  // Until it is known whether the token is a stock — and, for one, how many shares a token stands for — the limit
  // pre-fills no price.
  const stockPending = ticketStock.pending
  const quotedMs = trade.quotedAt ? Date.parse(trade.quotedAt) : null
  const legOf = (side: 'pay' | 'receive') =>
    side === 'pay'
      ? {
          mint: legs.pay?.mint ?? '',
          raw: shownQuote?.order.inAmountRaw ?? null,
          decimals: payDecimals,
          quotedUsd: shownQuote?.order.inUsdValue ?? null,
          price: payPrice,
        }
      : {
          mint: legs.receive?.mint ?? '',
          raw: shownQuote?.order.outAmountRaw ?? null,
          decimals: receiveDecimals,
          quotedUsd: shownQuote?.order.outUsdValue ?? null,
          price: receivePrice,
        }
  /* A stock leg's pool judged on the estimate for the sum on screen — the other leg's dollars over the shares the stock
     leg stands for, with the estimate's time (`quoteLiveShare`); with no such estimate, on the pool's listed figure. Two
     stocks against each other have no dollar leg to judge by: the listed figure. */
  const judgePool = (facts: StockPoolFacts | null, side: 'pay' | 'receive', otherIsStock: boolean) => {
    if (!facts) return null
    const stockLeg = legOf(side)
    const live =
      shownQuote && !otherIsStock
        ? quoteLiveShare({
            other: legOf(side === 'pay' ? 'receive' : 'pay'),
            stock: { raw: stockLeg.raw, decimals: stockLeg.decimals },
            sharesPerToken: facts.sharesPerToken,
            at: quotedMs,
          })
        : null
    return ticketPoolWarning(facts, live)
  }
  const investWords = useCopy(INVEST_COPY)
  // The Market ticket judges the pool on the very estimate its line shows (ST-5 r10: $10 of SGOVx is +47 670 %).
  const marketPool = judgePool(stockFacts, mode === 'sell' ? 'pay' : 'receive', false)
  const marketPoolLine = marketPool ? poolWarningText(marketPool, locale, investWords) : null
  // A limit waits on the pool's own price: judged on the pool's listed figure.
  const limitPool = ticketPoolWarning(stockFacts)
  const limitPoolLine = limitPool ? poolWarningText(limitPool, locale, investWords) : null
  /* «Обмін» (ST-5 r10: 1,5 SOL → 0,00020892 SGOVx read «≈ $0,44», the pool's $2 090 a token; ≈ $0,02 at the share): a
     stock leg whose pool stands far from the share is valued at the share — tokens × shares per token × the reference —
     or «—» without them, never at the pool's price; its warning is one line in the form. */
  const payPool = mode === 'swap' ? judgePool(payStock.facts, 'pay', receiveStock.facts !== null) : null
  const receivePool = mode === 'swap' ? judgePool(receiveStock.facts, 'receive', payStock.facts !== null) : null
  const payFar = payPool !== null && payPool.farPct !== null
  const receiveFar = receivePool !== null && receivePool.farPct !== null
  const inUsd = payFar ? stockLegUsd(trade.typedRaw, legs.pay?.decimals ?? null, payStock.facts) : marketInUsd
  const outUsd = receiveFar
    ? stockLegUsd(shownQuote?.order.outAmountRaw ?? null, receiveDecimals, receiveStock.facts)
    : marketOutUsd
  const swapPool = receiveFar ? receivePool : payFar ? payPool : (receivePool ?? payPool)
  const swapPoolLine = swapPool ? poolWarningText(swapPool, locale, investWords) : null
  /* What a swap loses on the price — the two dollar figures of the estimate for the amount on screen, both known, apart
     by more than 1 % (ST-5 r9): said quietly under the rate. Display only. */
  const priceLoss = shownQuote ? priceLossPct(inUsd, outUsd) : null
  const legsReady = legs.pay !== null && legs.receive !== null
  const payLabel = legs.pay ? words.amountIn(legs.pay.symbol) : words.amount

  /* What the wallet can spend, in quarters — 25 · 50 · 75 · 100 % — offered only once something can be spent, each
     rounded down. SOL's are of what a swap can sign (`ticketSpendableRaw`): less the rent its accounts need. */
  const ticketRaw = available && legs.pay ? ticketSpendableRaw(available.raw, legs.pay.mint) : '0'
  const shares =
    available && legs.pay && BigInt(ticketRaw) > 0n
      ? PAY_SHARES_PCT.map((pct) => {
          const share = shareOfRaw(ticketRaw, pct) ?? '0'
          // Dollars are shared to the cent, rounded down — «$310.12», never «$310.125».
          const cent = available.decimals > 2 ? 10n ** BigInt(available.decimals - 2) : 1n
          const raw = DOLLAR_MINTS.has(legs.pay!.mint) ? ((BigInt(share) / cent) * cent).toString() : share
          return {
            pct,
            field: unitsForField(raw, available.decimals, locale),
            text: `${formatUnits(raw, available.decimals, 6, locale)} ${legs.pay!.symbol}`,
          }
        }).filter((share) => /[1-9]/.test(share.field))
      : []

  // Against what a ticket can spend — SOL less its swap's reserve, so a sum the shares do not offer is not let through.
  const insufficient = available !== null && trade.typedRaw !== null && BigInt(trade.typedRaw) > BigInt(ticketRaw)
  /* A purchase is from $1: paid in
     dollars the typed sum itself, paid in SOL the sum at SOL's own price — the market's, or while it is not read the
     estimate's (`floorSolUsd`), never a venue's figure for a dollar (`underOneDollar`). A rule's purchase is the rule's sum. */
  const ticketSolUsd = legs.pay?.mint === SOL_MINT ? floorSolUsd(solUsd, trade.quote?.order ?? null) : null
  const belowMinimum =
    mode === 'buy' &&
    !ruleAsk &&
    legs.pay !== null &&
    underOneDollar({
      payMint: legs.pay.mint,
      payDecimals: legs.pay.decimals ?? 6,
      amountRaw: trade.typedRaw === null ? null : String(trade.typedRaw),
      solUsd: ticketSolUsd,
    })
  // A sum in SOL with no price said yet waits for SOL's to be read before it can be checked against the floor.
  const floorPending =
    mode === 'buy' &&
    !ruleAsk &&
    legs.pay?.mint === SOL_MINT &&
    ticketSolUsd === null &&
    solRow.isLoading &&
    trade.typedRaw !== null &&
    !/^0*$/.test(String(trade.typedRaw))
  // The network fee is paid in SOL whatever is swapped; a wallet without any cannot sign anything that lands.
  const needsSol = available !== null && /^0+$/.test(available.lamports) && legs.pay?.mint !== SOL_MINT
  // Said once a sum is typed, never as a red line over an empty ticket (M44.6); the action stays held either way.
  const needsSolShown = needsSol && typedSome
  /* No answer from Ryntra for the price: that is the one line said — a balance judged from a read that cannot be
     refreshed now does not add a second red line under it (ST-5). */
  const connectionLost = trade.quoteFailure?.key === 'offline' || trade.quoteFailure?.key === 'tooLong'
  const quoteFailureText = trade.quoteFailure ? quoteFailureLine(words, trade.quoteFailure.key) : null
  // Too little to pay with, or no SOL for the fee: the next step is to add funds, not a button that cannot be pressed.
  const [toppingUp, setToppingUp] = useState(false)

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
    variant?: 'primary' | 'secondary'
  }
  if (!account.address) {
    action = {
      title: words.connect,
      onPress: () => void account.connect(),
      loading: account.busy === 'connect',
    }
  } else if (!account.session) {
    action = {
      title: words.signIn,
      onPress: () => void account.signIn(),
      loading: account.signingIn,
    }
  } else if (trade.phase === 'settled') {
    action = { title: words.tradeAgain, onPress: again }
  } else if (trade.phase === 'recovery' || trade.phase === 'recovering') {
    action = {
      title: words.checkTx,
      onPress: () => void trade.recover(),
      loading: trade.phase === 'recovering',
    }
  } else if (trade.lockedReview) {
    action = {
      title: words.release,
      onPress: () => void trade.release(),
      loading: trade.busy,
      variant: 'secondary',
    }
  } else if (ruleAsk && !openRule) {
    // No plain order stands in for the rule's purchase: the chip above says why, «×» leaves the rule.
    action = {
      title: ruleState === null || ruleState.kind === 'reading' ? ruleWords.readingRule : ruleWords.notUnderRule,
      onPress: () => undefined,
      disabled: true,
    }
  } else {
    // «Перевірка» asks the server for its own fresh order: the estimate above need not be fresh, nor settled from the
    // typing — the first press is the one that works (the operator, 2026-10-10). A blocked asset is still refused here.
    const ready =
      legsReady &&
      !trade.quoteBlocked &&
      // An estimate that refused for good — for this very amount, not the one before it.
      !(trade.quoteFailure !== null && !trade.quoteFailure.retryable && trade.amountRaw === trade.typedRaw) &&
      !insufficient &&
      !belowMinimum &&
      !floorPending &&
      !needsSol &&
      trade.typedRaw !== null
    const fundsShort =
      trade.phase === 'idle' && !connectionLost && !ruleAsk && ((insufficient && mode !== 'sell') || needsSolShown)
    action = fundsShort
      ? { title: investWords.topUp, onPress: () => setToppingUp(true) }
      : {
          title: words.review,
          onPress: () => void trade.review(),
          disabled: !ready,
          loading: trade.phase === 'preparing',
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

  /* ---- the new look's sheet (NEW-LOOK §3–5): one step at a time, inside one sheet ---- */
  // The wallet is asked by the market ticket or by the limit inside it: the sheet holds still for either.
  const [limitLocked, setLimitLocked] = useState(false)
  // While it is prepared, signed, sent or checked, a note's tap or a quick action waits for it (`place-hold.ts`).
  usePlaceHold(trade.busy || limitLocked)
  const close = () => {
    if (trade.phase === 'review') trade.closeReview()
    if (router.canGoBack()) router.back()
    else router.replace(TRADE_PATH as never)
  }
  const reviewing = trade.phase === 'review' || trade.phase === 'signing'
  const signing = trade.phase === 'signing'
  // The steps a person walks through before «Перевірка», inside the sheet; the Review and the wallet come after them.
  const effectiveStep: Step = !asset && mode !== 'swap' ? 'asset' : step
  const stepBack = (): boolean => {
    if (signing || trade.phase === 'preparing' || limitLocked) return true
    if (reviewing) {
      trade.closeReview()
      return true
    }
    if (effectiveStep !== 'ticket' && !(effectiveStep === 'asset' && !asset)) {
      setStep('ticket')
      return true
    }
    return false
  }
  // The system back steps back inside the sheet first, and never leaves while the wallet is asked.
  const stepBackRef = useRef(stepBack)
  useEffect(() => {
    stepBackRef.current = stepBack
  })
  useFocusEffect(
    useCallback(() => {
      if (variant !== 'sheet') return undefined
      const sub = BackHandler.addEventListener('hardwareBackPress', () => stepBackRef.current())
      return () => sub.remove()
    }, [variant]),
  )

  const sheetWords = sheet
  const verbTitle = asset
    ? mode === 'sell'
      ? sheetWords.sellTitle(asset.symbol)
      : sheetWords.buyTitle(asset.symbol)
    : ''
  const dollarPay = legs.pay !== null && DOLLAR_MINTS.has(legs.pay.mint)
  const amountShown = (ruleAsk ? ticketAmount : amountText) || '0'
  // Drawn grouped as «Обмін» draws it (ST-5 r9): «$1 250», never «$1250»; the field itself stays as typed.
  const amountDrawn = groupedField(amountShown, locale)
  // The figure steps down as it grows, so a long sum stays on one line.
  const amountSize = amountDrawn.length > 9 ? 32 : amountDrawn.length > 6 ? 40 : 50
  const keyMark = fieldMark
  // A sum the sheet says in dollars takes cents only (ST-5 r9): «$5,22», never «$5,222».
  const keyPlaces =
    variant === 'sheet' && dollarPay
      ? Math.min(DOLLAR_PLACES, legs.pay?.decimals ?? DOLLAR_PLACES)
      : (legs.pay?.decimals ?? null)
  const press = (key: PadKey) => setAmountText((text) => pressKey(text, key, keyMark, keyPlaces))
  const editable = trade.phase === 'idle' && !trade.lockedReview && !ruleAsk
  // A no-break space holds the figure to its unit: a wrapped corner never leaves «SOL» alone on the next line.
  const availableText =
    available && legs.pay ? `${formatUnits(ticketRaw, available.decimals, 6, locale)}\u00a0${legs.pay.symbol}` : null
  /* Every ticket offers the shares of what it can spend — 25% · 50% · 75% · 100%; the sum itself stays free to type. A share of dollars under $1 is drawn, not
     offered: a purchase is from $1. */
  const amountChips: readonly Readonly<{ key: string; label: string; field: string | null }>[] = shares.map(
    (share) => ({
      key: String(share.pct),
      label: `${share.pct}%`,
      field: mode === 'buy' && dollarPay && Number(share.field.replace(',', '.')) < MIN_BUY_USD ? null : share.field,
    }),
  )
  const typeValues = ORDER_TYPES.filter((value) => value !== 'recurring' || mode === 'buy')
  const typeChoices = typeValues.map((value) => ({ value, label: sheetWords.types[value] }))
  // What each type does — one tap deep, behind «?» beside «Тип» (ST-4), never a line under an option.
  const typeHelp = typeValues.map(
    (value) =>
      `${sheetWords.types[value]} — ${
        mode === 'sell'
          ? sheetWords.typeLines.sell[value === 'recurring' ? 'market' : value]
          : sheetWords.typeLines.buy[value]
      }.`,
  )
  const typeRow = showOrderTypes ? (
    <View className="flex-row items-center gap-1">
      <View className="flex-1">
        <OptionRow
          label={sheetWords.type}
          value={sheetWords.types[order]}
          onPress={() => setStep('type')}
          disabled={trade.busy || Boolean(trade.lockedReview) || limitLocked}
        />
      </View>
      <HelpDot title={sheetWords.type} body={typeHelp} />
    </View>
  ) : null
  const what = mode === 'sell' ? (legs.pay?.name ?? '') : (legs.receive?.name ?? '')

  /* ---- what the sheet shows now ---- */
  let title = verbTitle
  let onBack: (() => void) | null = null
  let body: ReactNode
  let footer: ReactNode = null
  if (trade.phase === 'settled' && settledCard) {
    const tone = settledCard.status === 'failed' ? 'failed' : settledCard.status === 'pending' ? 'pending' : 'done'
    title = sheetWords.finish
    body = (
      <DoneBody
        tone={tone}
        title={tone === 'done' && !ruleAsk && settledContext ? sheetWords.done[settledContext.mode] : settledCard.title}
        big={settledCard.received}
        line={[settledCard.paid, trade.settled ? formatClock(trade.settled.at) : null].filter(Boolean).join(' · ')}
        note={settledCard.note ?? null}
        onReceipt={
          tone === 'failed'
            ? null
            : () => {
                // «Квитанцію збережено · Портфель → Історія» (NEW-LOOK §5): «Обмін» starts afresh behind it, and the
                // purchase's sheet closes with the screens over the bar.
                if (variant === 'swap') again()
                openPlace(PORTFOLIO_HISTORY_PATH)
              }
        }
      />
    )
    footer = (
      <View className="flex-row gap-2">
        {trade.settled && tone !== 'failed' ? (
          <View className="flex-1">
            <ShareReceiptButton
              variant="button"
              doc={docFromSwap(
                {
                  title: settledCard.title,
                  status: SETTLED_STATUS[settledCard.status],
                  settlement: trade.settled.settlement,
                  context: trade.settled.context,
                  at: trade.settled.at,
                  rule: settledCard !== settledPlain,
                },
                locale,
              )}
            />
          </View>
        ) : null}
        <View className="flex-1">
          <SheetAction
            title={sheetWords.finish}
            onPress={() => {
              again()
              if (variant === 'sheet') close()
            }}
          />
        </View>
      </View>
    )
  } else if (trade.phase === 'recovery' || trade.phase === 'recovering') {
    title = words.signedTx
    body = (
      <View className="gap-2 rounded-md border border-line bg-ground p-4">
        <View className="flex-row items-center justify-between">
          <Txt variant="ui">{words.signedTx}</Txt>
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
        {/* The transaction's own id is the receipt's, not a line here (ST-4): the card says when it was signed. */}
        {trade.attempt ? (
          <Txt variant="data" tone="faint">
            {formatAge(trade.attempt.recordedAt, undefined, locale)}
          </Txt>
        ) : null}
      </View>
    )
    footer = (
      <SheetAction title={action.title} onPress={action.onPress} loading={action.loading} disabled={action.disabled} />
    )
  } else if (reviewing && trade.prepared && legs.pay && legs.receive) {
    title = mode === 'swap' ? sheetWords.checkSwap : sheetWords.check
    onBack = signing ? null : trade.closeReview
    const view = reviewView(
      {
        order: trade.prepared.order.order,
        mode,
        pay: legs.pay,
        receive: legs.receive,
        decimals: trade.prepared.order.decimals,
        exact: true,
        findings: trade.prepared.order.policy.verdict.findings,
      },
      locale,
    )
    const planReview = trade.prepared.order.planReview ?? null
    // AG-2b: while the Review renews itself its clock never reads «out of date» — fresh bytes are on their way.
    const closed = !trade.keepsFresh && trade.reviewLeft !== null && trade.reviewLeft <= 0
    /* The $1 floor holds at the wallet too: a purchase whose own Review spends under a dollar (paid in SOL, the estimate
       may not have spoken in time) is said and not signed — SOL at the market's price, or the Review's own. A rule's
       purchase is the rule's sum. */
    const reviewBelowMinimum =
      mode === 'buy' &&
      !ruleAsk &&
      underOneDollar({
        payMint: legs.pay.mint,
        payDecimals: legs.pay.decimals ?? 6,
        amountRaw: trade.prepared.order.order.inAmountRaw,
        solUsd: legs.pay.mint === SOL_MINT ? floorSolUsd(solUsd, trade.prepared.order.order) : null,
      })
    const signable =
      !closed &&
      !trade.invalidated &&
      !reviewBelowMinimum &&
      trade.reviewLeft !== null &&
      (trade.keepsFresh || trade.reviewLeft >= 10)
    if (signing) {
      body = <WaitBody sending={trade.sending} onCancel={trade.cancelSigning} />
    } else {
      body = (
        <View className="gap-3">
          {planReview ? (
            <StrategyBlock review={planReview} symbol={mode === 'buy' ? legs.receive.symbol : legs.pay.symbol} />
          ) : null}
          {reviewRuleLine ? <RuleReviewRow label={ruleWords.yourRule} line={reviewRuleLine} /> : null}
          {view ? <CheckRows view={view} what={what} /> : null}
          {reviewBelowMinimum ? (
            <Txt variant="ui" tone="warning" accessibilityLiveRegion="polite">
              {sheetWords.fromOneDollar}
            </Txt>
          ) : null}
          {trade.failure ? (
            <Txt variant="ui" tone={failureTone(trade.failure.key)} accessibilityLiveRegion="polite">
              {ruleRefusal ? ruleWords[ruleRefusal] : words.failures[trade.failure.key]}
            </Txt>
          ) : null}
        </View>
      )
      footer = (
        <>
          {trade.reviewLeft !== null ? (
            <ValidFor
              text={
                trade.awaitingFresh
                  ? sheetWords.renewingThenWallet
                  : trade.renewing || (trade.keepsFresh && trade.reviewLeft <= 0)
                    ? sheetWords.renewing
                    : closed
                      ? sheetWords.stale
                      : sheetWords.validFor(clockOf(trade.reviewLeft))
              }
              stale={closed || trade.invalidated}
            />
          ) : null}
          {closed || trade.invalidated ? (
            <SheetAction
              title={sheetWords.refreshCheck}
              variant="secondary"
              onPress={() => {
                trade.closeReview()
                void trade.review()
              }}
            />
          ) : (
            <SheetAction
              title={trade.failure?.key === 'ledgerBlind' ? sheetWords.tryAgain : sheetWords.confirmInWallet}
              onPress={() => void trade.sign()}
              disabled={!signable}
              loading={trade.awaitingFresh}
            />
          )}
        </>
      )
    }
  } else if (effectiveStep === 'asset' || effectiveStep === 'quote') {
    // Which asset to buy, or what a purchase is paid with / a sale received in — a step inside the sheet.
    const quoteStep = effectiveStep === 'quote'
    title = quoteStep ? (mode === 'buy' ? sheetWords.payFrom : sheetWords.receiveIn) : sheetWords.pickTitle
    onBack = asset ? () => setStep('ticket') : null
    body = (
      <AssetPickerSheet
        inline
        visible
        title={title}
        kind={quoteStep ? 'quote' : 'market'}
        exclude={quoteStep ? (asset?.mint ?? null) : null}
        onClose={() => setStep('ticket')}
        onPick={(chosen) => {
          if (quoteStep) setPickedQuote(chosen)
          else setPickedAsset(chosen)
          setAmountText('')
          setStep('ticket')
        }}
      />
    )
  } else if (effectiveStep === 'type') {
    title = mode === 'sell' ? sheetWords.howTitle.sell : sheetWords.howTitle.buy
    onBack = () => setStep('ticket')
    body = (
      <ChoiceList
        choices={typeChoices}
        value={order}
        onChange={(next) => {
          setOrderType(next)
          setStep('ticket')
        }}
      />
    )
  } else if (limit && asset) {
    // C3's limit inside the one sheet: its own price, amount and «Перевірка», in this sheet's place.
    body = (
      <View className="gap-3">
        {typeRow}
        <LimitPanel
          asset={asset}
          side={mode === 'sell' ? 'sell' : 'buy'}
          inline
          onLocked={setLimitLocked}
          // The market ticket's sum goes with it where the units match (`carriedAmount`): «$75» stays $75.
          typed={legs.pay && amountText ? { mint: legs.pay.mint, text: amountText } : null}
          stock={
            stockFacts || stockPending
              ? {
                  warning: limitPoolLine,
                  pending: stockPending,
                  referencePerShare: stockFacts?.referencePerShare ?? null,
                  sharesPerToken: stockFacts?.sharesPerToken ?? null,
                }
              : null
          }
        />
      </View>
    )
  } else if (recurring && asset) {
    body = (
      <View className="gap-3">
        {typeRow}
        <RecurringPanel
          asset={asset}
          onBuyUnderRule={(binding) => {
            setOrderType('market')
            setRuleAsk(binding)
          }}
          onMarket={() => setOrderType('market')}
        />
      </View>
    )
  } else {
    /* ---- the market ticket: the sum large, its chips, «Тип», what it is paid with, the keypad ---- */
    // The estimate with its time (ST-5 r10): «≈ 0,00020509 SGOVx · о 12:04» — when the phone received it.
    const sub = receiveFigure
      ? `${approxFigure(receiveFigure)} ${legs.receive?.symbol ?? ''}${
          trade.quotedAt ? ` · ${sheetWords.quotedAt(formatClock(trade.quotedAt))}` : ''
        }`
      : pricing
        ? words.pricing
        : typedSome && legsReady
          ? `— ${legs.receive?.symbol ?? ''}`
          : ''
    body = (
      <View className="gap-3">
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
        {planBinding ? (
          <View className="flex-row flex-wrap items-center gap-1">
            <Chip
              label={planCopy.underPlan(asset?.symbol ?? arrivedSymbol ?? '', planBinding.version)}
              tone="brand"
              caps={false}
            />
            <HelpDot
              title={planCopy.underPlan(asset?.symbol ?? arrivedSymbol ?? '', planBinding.version)}
              body={planCopy.planContextNote}
            />
          </View>
        ) : null}
        <View className="items-center gap-1 py-1" accessibilityLiveRegion="polite">
          <View className="flex-row items-baseline" accessible accessibilityLabel={`${payLabel}: ${amountShown}`}>
            {dollarPay ? (
              <Txt variant="display" tone="muted" tabular style={{ fontSize: amountSize, lineHeight: amountSize + 6 }}>
                $
              </Txt>
            ) : null}
            <Txt
              variant="display"
              tabular
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{ fontSize: amountSize, lineHeight: amountSize + 6 }}
            >
              {dollarPay ? amountDrawn : `${amountDrawn} ${legs.pay?.symbol ?? ''}`}
            </Txt>
          </View>
          {/* A figure in Geist Mono; a hint in words. The line keeps its height before the first digit too (ST-5): the
              estimate arriving never moves what is under it. */}
          <Txt
            variant={receiveFigure ? 'data' : 'ui'}
            tone="muted"
            numberOfLines={1}
            adjustsFontSizeToFit
            className="min-h-[18px]"
            // A blank line holds the height only: nothing for a screen reader to stop on (ST-5 r7).
            accessibilityLabel={sub ? undefined : ''}
            importantForAccessibility={sub ? 'auto' : 'no'}
          >
            {sub || ' '}
          </Txt>
          {/* A sale says what it can sell — the same figure as «Обмін»'s and its shares' (ST-5). */}
          {mode === 'sell' && availableText ? (
            <View className="flex-row items-center gap-1">
              <Txt variant="data" tone="muted">
                {sheetWords.canUse(availableText)}
              </Txt>
              {legs.pay?.mint === SOL_MINT ? <SolKeptHelp /> : null}
            </View>
          ) : null}
          {connectionLost ? null : belowMinimum ? (
            <Txt variant="ui" tone="warning">
              {sheetWords.fromOneDollar}
            </Txt>
          ) : insufficient ? (
            <Txt variant="ui" tone="danger">
              {mode === 'sell' ? sheetWords.lessInPosition : sheetWords.notEnough(legs.pay!.symbol)}
            </Txt>
          ) : needsSolShown ? (
            <Txt variant="ui" tone="danger">
              {words.needSol}
            </Txt>
          ) : trade.quoteBlocked ? (
            <Txt variant="ui" tone="warning">
              {words.assetBlocked}
            </Txt>
          ) : null}
        </View>
        {amountChips.length > 0 && !ruleAsk ? (
          <View className="flex-row gap-2" accessibilityLabel={words.shares}>
            {amountChips.map((chip) => (
              <Pressable
                key={chip.key}
                accessibilityRole="button"
                accessibilityLabel={chip.label}
                accessibilityState={{
                  selected: chip.field !== null && chip.field === amountText,
                  disabled: !editable || chip.field === null,
                }}
                disabled={!editable || chip.field === null}
                onPress={() => chip.field !== null && setAmountNow(chip.field)}
                className={cn(
                  'h-12 flex-1 items-center justify-center rounded-pill border',
                  chip.field !== null && chip.field === amountText
                    ? 'border-brand-chip-line bg-brand-chip'
                    : 'border-line-strong',
                  !editable || chip.field === null ? 'opacity-50' : 'active:bg-hover',
                )}
              >
                <Txt variant="ui" tone={chip.field !== null && chip.field === amountText ? 'brand' : 'fg'}>
                  {chip.label}
                </Txt>
              </Pressable>
            ))}
          </View>
        ) : null}
        {typeRow}
        {legs.pay && legs.receive ? (
          <OptionRow
            label={mode === 'sell' ? sheetWords.receiveIn : sheetWords.payFrom}
            value={(mode === 'sell' ? legs.receive : legs.pay).symbol}
            // What it can spend, as a figure: «USDC 1 240» — never a sentence in the row.
            detail={mode === 'sell' || !available ? null : formatUnits(ticketRaw, available.decimals, 2, locale)}
            onPress={() => setStep('quote')}
            disabled={trade.phase !== 'idle' || ruleAsk !== null}
          />
        ) : null}
        {mode === 'buy' && account.session && !ruleAsk ? (
          <RuleReminderNotice
            session={account.session}
            mint={legs.receive?.mint ?? null}
            onBuy={(binding) => setRuleAsk(binding)}
          />
        ) : null}
        {ruleRefusal ? (
          <Txt variant="ui" tone="danger">
            {ruleWords[ruleRefusal]}
          </Txt>
        ) : null}
        {trade.quoteFailure ? (
          <QuoteFailureLine text={quoteFailureText} retry={trade.quoteFailure.retryable ? trade.refreshQuote : null} />
        ) : null}
        {trade.failure && !ruleRefusal && trade.failure.key !== trade.quoteFailure?.key ? (
          <View className="gap-2">
            <Txt variant="ui" tone={failureTone(trade.failure.key)}>
              {words.failures[trade.failure.key]}
            </Txt>
            {trade.failure.planReview ? (
              <StrategyBlock review={trade.failure.planReview} symbol={asset?.symbol ?? arrivedSymbol ?? ''} />
            ) : null}
          </View>
        ) : null}
        {/* The pool that cannot stand for the share, right over the keypad and the action (ST-5 r9). */}
        {marketPoolLine ? <PoolLine text={marketPoolLine} /> : null}
      </View>
    )
    // The keypad holds the sheet's bottom, over the action (ST-5): a line appearing above it — the estimate, a status —
    // never moves a key under the finger, even when the sheet is at its full height and scrolls.
    footer = (
      <View className="gap-3">
        <Keypad mark={keyMark} onKey={press} deleteLabel={sheetWords.keypadDelete} disabled={!editable} />
        <SheetAction
          title={action.title === words.review ? sheetWords.view : action.title}
          onPress={action.onPress}
          disabled={action.disabled}
          loading={action.loading}
          variant={action.variant}
        />
      </View>
    )
  }

  if (variant === 'swap') {
    return (
      <SwapPlace
        trade={trade}
        legs={legs}
        amountText={amountText}
        setAmountNow={setAmountNow}
        press={press}
        keyMark={keyMark}
        editable={editable}
        shares={shares}
        available={available}
        availableText={availableText}
        insufficient={insufficient}
        needsSol={needsSolShown}
        receiveFigure={receiveFigure}
        inUsd={inUsd}
        outUsd={outUsd}
        priceLoss={priceLoss}
        pricing={pricing}
        poolLine={swapPoolLine}
        payMarks={payMarks}
        receiveMarks={receiveMarks}
        estimate={estimate}
        action={action}
        onFlip={flip}
        onPick={(leg) => setPicking(leg)}
        picking={picking}
        onPicked={(leg, chosen) => pick(leg, chosen)}
        onClosePicker={() => setPicking(null)}
        sheetOpen={reviewing || trade.phase === 'settled' || trade.phase === 'recovery' || trade.phase === 'recovering'}
        sheetTitle={title}
        sheetBack={onBack}
        sheetBody={body}
        sheetFooter={footer}
        onCloseSheet={() => (signing ? undefined : trade.phase === 'settled' ? again() : trade.closeReview())}
        typedSome={typedSome}
        connectionLost={connectionLost}
        quoteFailureText={quoteFailureText}
        topUp={
          account.address ? (
            <TopUpSheet visible={toppingUp} address={account.address} onClose={() => setToppingUp(false)} />
          ) : null
        }
      />
    )
  }

  return (
    <SheetFrame
      title={title}
      onBack={onBack}
      onClose={close}
      scroll={!(effectiveStep === 'asset' || effectiveStep === 'quote') || reviewing || trade.phase !== 'idle'}
      locked={signing || trade.phase === 'preparing' || limitLocked}
      footer={footer}
    >
      {body}
      {account.address ? (
        <TopUpSheet visible={toppingUp} address={account.address} onClose={() => setToppingUp(false)} />
      ) : null}
    </SheetFrame>
  )
}

/**
 * «Обмін» — a segment of «Торгівля» (NEW-LOOK §3): «Віддаєш» and «Отримуєш», the button between them swapping
 * them, the rate, 25 · 50 · 75 % · МАКС, the keypad and «Перевірка обміну». Only a market swap of one token for
 * another; «Перевірка обміну», the wallet and «Готово» follow in one sheet.
 */
function SwapPlace({
  trade,
  legs,
  amountText,
  press,
  keyMark,
  editable,
  setAmountNow,
  shares,
  available,
  availableText,
  insufficient,
  needsSol,
  receiveFigure,
  inUsd,
  outUsd,
  priceLoss,
  pricing,
  poolLine,
  payMarks,
  receiveMarks,
  estimate,
  action,
  onFlip,
  onPick,
  picking,
  onPicked,
  onClosePicker,
  sheetOpen,
  sheetTitle,
  sheetBack,
  sheetBody,
  sheetFooter,
  onCloseSheet,
  typedSome,
  connectionLost,
  quoteFailureText,
  topUp,
}: {
  trade: ReturnType<typeof useTrade>
  legs: TradeLegs
  amountText: string
  /** A share chip's whole sum, priced at once (ST-3). */
  setAmountNow: (text: string) => void
  press: (key: PadKey) => void
  keyMark: ',' | '.'
  editable: boolean
  shares: readonly Readonly<{ pct: number; field: string; text: string }>[]
  available: ReturnType<typeof useAvailable>
  availableText: string | null
  insufficient: boolean
  needsSol: boolean
  receiveFigure: string | null
  inUsd: number | null
  outUsd: number | null
  /** The price lost between the two dollar figures, per cent, where it is more than 1 %; null otherwise (ST-5 r9). */
  priceLoss: number | null
  /** The estimate for the sum on screen is asked or the typing is settling: «Рахуємо ціну…» (ST-5 r10). */
  pricing: boolean
  /** A stock leg's pool that cannot stand for the share, in one line (ST-5 r10); null for none. */
  poolLine: string | null
  /** What each leg says of its token beside it — Jupiter's check, its flag, a stock's look-alike (ST-5 r7). */
  payMarks: LegMarks | null
  receiveMarks: LegMarks | null
  estimate: ReturnType<typeof reviewView>
  action: Readonly<{
    title: string
    onPress: () => void
    disabled?: boolean
    loading?: boolean
    variant?: 'primary' | 'secondary'
  }>
  onFlip: () => void
  onPick: (leg: 'pay' | 'receive') => void
  picking: Picking
  onPicked: (leg: 'pay' | 'receive', chosen: TradeAsset) => void
  onClosePicker: () => void
  sheetOpen: boolean
  sheetTitle: string
  sheetBack: (() => void) | null
  sheetBody: ReactNode
  sheetFooter: ReactNode
  onCloseSheet: () => void
  /** A sum above zero is typed: an estimate not had is «—», never «0». */
  typedSome: boolean
  /** Ryntra did not answer for the price: its line is the one status said. */
  connectionLost: boolean
  quoteFailureText: string | null
  topUp: ReactNode
}) {
  const locale = useLocale()
  const words = useCopy(TRADE_COPY)
  const sheet = useCopy(SHEET_COPY)
  const price = estimate?.rows.find((row) => row.key === 'price')?.value ?? null
  /* The pair's last stated fee, kept for a quote of the same pair that states none (ST-5 r8, `swapNetworkFee`): the fee
     does not grow with the sum, so a crumb's quote does not turn it to a dash. */
  const order = trade.quote?.order ?? null
  const [lastFee, setLastFee] = useState<typeof order>(null)
  if (order && order !== lastFee && quoteNetworkFee(order, locale) !== null) setLastFee(order)
  const networkFee = order ? swapNetworkFee(order, lastFee, locale) : null
  // The same shares as the purchase's: 25% · 50% · 75% · 100% of what can be given.
  const shareChips = shares.map((share) => ({ key: String(share.pct), label: `${share.pct}%`, field: share.field }))
  const reviewTitle = action.title === words.review ? sheet.viewSwap : action.title
  /* One line for the legs' marks, the strongest, in the asset page's own words (ST-5 r7): a token Jupiter has not
     checked never reads like any other once it is picked. */
  const assetWords = useCopy(INVEST_COPY)
  const warning = legWarning([payMarks, receiveMarks])
  const warningText =
    warning?.kind === 'lookalike'
      ? assetWords.notTheStock(companyDisplayName(warning.company))
      : warning?.kind === 'flagged'
        ? assetWords.flagged
        : warning
          ? assetWords.unverified
          : null
  return (
    <View className="flex-1">
      <ScrollView className="flex-1" contentContainerClassName="gap-3 px-4 pb-4" keyboardShouldPersistTaps="handled">
        <View className="gap-1.5">
          <SwapField
            label={sheet.give}
            corner={availableText ? sheet.canUse(availableText) : null}
            cornerTone={insufficient ? 'danger' : 'muted'}
            cornerHelp={availableText && legs.pay?.mint === SOL_MINT ? <SolKeptHelp /> : null}
            asset={legs.pay}
            marks={payMarks}
            figure={amountText ? groupedField(amountText, locale) : '0'}
            figureTone={amountText ? 'fg' : 'muted'}
            usd={inUsd !== null && Number.isFinite(inUsd) ? formatUsd(inUsd, locale) : null}
            typed={typedSome}
            onPick={() => onPick('pay')}
            pickDisabled={trade.phase !== 'idle'}
            placeholder={words.asset}
          />
          <View className="z-10 -my-5 items-center">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={words.flip}
              onPress={onFlip}
              disabled={trade.phase !== 'idle'}
              className="h-11 w-11 items-center justify-center rounded-md border border-line-strong bg-elevated active:bg-hover"
            >
              <Icon name="swap-vertical" size={20} color="fg" />
            </Pressable>
          </View>
          <SwapField
            label={sheet.get}
            corner={null}
            asset={legs.receive}
            marks={receiveMarks}
            figure={receiveFigure ? approxFigure(receiveFigure) : pricing ? words.pricing : typedSome ? '—' : '0'}
            figureTone={receiveFigure ? 'fg' : 'muted'}
            usd={outUsd !== null && Number.isFinite(outUsd) ? formatUsd(outUsd, locale) : null}
            typed={typedSome}
            onPick={() => onPick('receive')}
            pickDisabled={trade.phase !== 'idle'}
            placeholder={words.asset}
          />
        </View>
        {/* The rate and the network's fee are two fixed lines (ST-5), the same shape for every estimate — never one line
            for a short rate and two for a long one — and they keep their height before the first estimate too, so
            nothing under them moves while a sum is typed. Empty until an estimate answers — never a dash over an empty
            ticket. A line too long for the width shrinks to fit rather than cut its figure. */}
        <View className="min-h-[36px] justify-center gap-0.5">
          {estimate ? (
            <>
              {/* The rate with its time, quietly: when the phone received this estimate. None from a crumb whose
                  rounding would be the rate (ST-5 r7, `rateIsPrecise`); the fee's line stays. */}
              {price ? (
                <Txt variant="data" tone="muted" numberOfLines={1} adjustsFontSizeToFit>
                  {price}
                  {trade.quotedAt ? (
                    <Txt variant="data" tone="faint">
                      {` · ${formatClock(trade.quotedAt)}`}
                    </Txt>
                  ) : null}
                </Txt>
              ) : null}
              {/* The network's fee beside the rate (NEW-LOOK §3), the server's figure in SOL; unknown is a dash. */}
              <Txt variant="data" tone="muted" numberOfLines={1} adjustsFontSizeToFit>
                {networkFee ? `${words.rows.networkFee} ≈ ${networkFee}` : `${words.rows.networkFee} —`}
              </Txt>
              {priceLoss !== null ? (
                <Txt variant="data" tone="muted" numberOfLines={1} adjustsFontSizeToFit>
                  {words.priceLoss(`${formatCount(priceLoss, locale)}%`)}
                </Txt>
              ) : null}
            </>
          ) : null}
        </View>
        {/* One warning line (ST-5 r10): a look-alike or a flagged token first, then a stock's pool that cannot stand for
            the share, then a token Jupiter has not checked. */}
        {warningText && warning?.kind !== 'unverified' ? (
          <Txt variant="ui" tone="warning">
            {warningText}
          </Txt>
        ) : poolLine ? (
          <PoolLine text={poolLine} />
        ) : warningText ? (
          <Txt variant="ui" tone="warning">
            {warningText}
          </Txt>
        ) : null}
        {/* One status line at a time (ST-5): no connection first, then what the ticket itself lacks, then the price's
            refusal, then the last step's. */}
        {trade.quoteFailure && connectionLost ? (
          <QuoteFailureLine text={quoteFailureText} retry={trade.quoteFailure.retryable ? trade.refreshQuote : null} />
        ) : insufficient && legs.pay ? (
          <Txt variant="ui" tone="danger">
            {sheet.notEnough(legs.pay.symbol)}
          </Txt>
        ) : needsSol ? (
          <Txt variant="ui" tone="danger">
            {words.needSol}
          </Txt>
        ) : trade.quoteBlocked ? (
          <Txt variant="ui" tone="warning">
            {words.assetBlocked}
          </Txt>
        ) : trade.quoteFailure ? (
          <QuoteFailureLine text={quoteFailureText} retry={trade.quoteFailure.retryable ? trade.refreshQuote : null} />
        ) : trade.failure && !sheetOpen ? (
          <Txt variant="ui" tone={failureTone(trade.failure.key)}>
            {words.failures[trade.failure.key]}
          </Txt>
        ) : null}
      </ScrollView>
      {/* The shares and the keypad hold the bottom, over the action (ST-5): a line that appears above them — the rate,
          the fee, a status — never moves a key under the finger. */}
      <View className="gap-3 px-4 pb-3">
        {shareChips.length > 0 && available ? (
          <View className="flex-row gap-2" accessibilityLabel={words.shares}>
            {shareChips.map((chip) => (
              <Pressable
                key={chip.key}
                accessibilityRole="button"
                accessibilityLabel={chip.label}
                accessibilityState={{ selected: chip.field === amountText }}
                disabled={!editable}
                onPress={() => setAmountNow(chip.field)}
                className={cn(
                  'h-12 flex-1 items-center justify-center rounded-pill border',
                  chip.field === amountText ? 'border-brand-chip-line bg-brand-chip' : 'border-line-strong',
                  editable ? 'active:bg-hover' : 'opacity-50',
                )}
              >
                <Txt variant="ui" tone={chip.field === amountText ? 'brand' : 'fg'}>
                  {chip.label}
                </Txt>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Keypad mark={keyMark} onKey={press} deleteLabel={sheet.keypadDelete} disabled={!editable} />
      </View>
      <View className="border-t border-line px-4 pb-3 pt-3">
        <SheetAction
          title={reviewTitle}
          onPress={action.onPress}
          disabled={action.disabled}
          loading={action.loading}
          variant={action.variant}
        />
      </View>
      <AssetPickerSheet
        visible={picking !== null}
        title={picking === 'pay' ? sheet.give : sheet.get}
        kind="market"
        exclude={picking === 'pay' ? (legs.receive?.mint ?? null) : (legs.pay?.mint ?? null)}
        onClose={onClosePicker}
        onPick={(chosen) => picking && onPicked(picking, chosen)}
      />
      <Modal
        visible={sheetOpen}
        transparent
        animationType="fade"
        onRequestClose={onCloseSheet}
        statusBarTranslucent
        navigationBarTranslucent
      >
        <SheetFrame
          title={sheetTitle}
          onBack={sheetBack}
          onClose={onCloseSheet}
          locked={trade.phase === 'signing'}
          footer={sheetFooter}
        >
          {sheetBody}
        </SheetFrame>
      </Modal>
      {topUp}
    </View>
  )
}

/** The price's refusal in words, with «Спробувати ще» where asking again can help. */
function QuoteFailureLine({ text, retry }: { text: string | null; retry: (() => void) | null }) {
  const words = useCopy(TRADE_COPY)
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      <Txt variant="ui" tone="danger" className="flex-1">
        {text}
      </Txt>
      {retry ? <Button title={words.tryAgain} variant="secondary" size="sm" onPress={retry} /> : null}
    </View>
  )
}

/** One side of a swap: its word and what is available, the token, the figure and its dollars. */
function SwapField({
  label,
  corner,
  cornerTone = 'muted',
  cornerHelp = null,
  asset,
  marks = null,
  figure,
  figureTone,
  usd,
  typed,
  onPick,
  pickDisabled,
  placeholder,
}: {
  label: string
  corner: string | null
  cornerTone?: 'muted' | 'danger'
  /** «?» beside the corner's figure — why SOL's «Можна використати» is less than Portfolio's figure. */
  cornerHelp?: ReactNode
  asset: TradeAsset | null
  /** The token's marks, drawn under it as the list drew them (ST-5 r7). */
  marks?: LegMarks | null
  figure: string
  figureTone: 'fg' | 'muted'
  usd: string | null
  /** A sum above zero is typed: a dollar figure not had is then a dash, before it a blank line. */
  typed: boolean
  onPick: () => void
  pickDisabled: boolean
  placeholder: string
}) {
  const marksWords = useCopy(COMPONENT_COPY)
  const tradeWords = useCopy(TRADE_COPY)
  const dollars = usd ? approxFigure(usd) : typed && !(asset && DOLLAR_MINTS.has(asset.mint)) ? '—' : ''
  const marked = Boolean(marks && (marks.lookalikeOf || marks.flagged || marks.unverified))
  return (
    <View className="gap-1.5 rounded-lg border border-line bg-surface px-4 py-3">
      {/* The corner wraps to a second line rather than cut (ST-5): «Можна використати 0,042682 SOL» keeps its figure
          and its unit whole beside a long word or a large font. */}
      <View className="flex-row items-start justify-between gap-3">
        <Txt variant="ui" tone="muted">
          {label}
        </Txt>
        {corner ? (
          <View className="shrink flex-row items-center justify-end gap-0.5">
            {/* In its row label's face (ST-5 r7): «Можна використати 0 SOL» beside «Віддаєш», not a mono line beside a word. */}
            <Txt variant="ui" tone={cornerTone} className="shrink text-right">
              {corner}
            </Txt>
            {cornerHelp}
          </View>
        ) : null}
      </View>
      <View className="flex-row items-center gap-3">
        <AssetPill asset={asset} placeholder={placeholder} onPress={onPick} disabled={pickDisabled} />
        <Txt variant="dataLg" tone={figureTone} numberOfLines={1} adjustsFontSizeToFit className="flex-1 text-right">
          {figure}
        </Txt>
      </View>
      {/* The dollars' line keeps its height whether or not it has a figure yet (ST-5), so the card never grows under
          the finger. A dollar token is its own dollar figure and an empty ticket has none: blank, and silent to a screen
          reader; any other unknown one, once a sum is typed, is a dash. A bounded figure keeps its own qualifier —
          «<$0,01», never «≈ <$0,01» (ST-5 r7). The token's marks stand on its left, under the token. */}
      <View className="flex-row items-center gap-2">
        {marked && marks ? (
          <View className="shrink flex-row flex-wrap items-center gap-1">
            {marks.flagged ? <Chip label={marksWords.flagged} tone="warning" /> : null}
            {marks.lookalikeOf ? <Chip label={tradeWords.notTheStock} tone="warning" /> : null}
            {marks.unverified && !marks.lookalikeOf ? <Chip label={marksWords.unverified} /> : null}
          </View>
        ) : null}
        <Txt
          variant="data"
          tone="faint"
          className="flex-1 text-right"
          accessibilityLabel={dollars ? undefined : ''}
          importantForAccessibility={dollars ? 'auto' : 'no'}
        >
          {dollars || ' '}
        </Txt>
      </View>
    </View>
  )
}
