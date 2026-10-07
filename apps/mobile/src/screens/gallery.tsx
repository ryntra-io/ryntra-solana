import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { AssetRow } from '@/components/asset-row'
import { BottomAction } from '@/components/bottom-action'
import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { DeviationChip } from '@/components/deviation-chip'
import { FilterSheet } from '@/components/filter-sheet'
import { Icon } from '@/components/icon'
import { ReceiptCard } from '@/components/receipt-card'
import { ReviewBlock } from '@/components/review-block'
import { Screen } from '@/components/screen'
import { SessionChip } from '@/components/session-chip'
import { Skeleton } from '@/components/skeleton'
import { StatTile } from '@/components/stat-tile'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { AUTOINVEST_COPY } from '@/features/autoinvest/copy'
import { conditionReviewLine } from '@/features/autoinvest/price-condition'
import { dueWords, ruleWhenLine, wholeParts } from '@/features/autoinvest/words'
import { HOME_COPY } from '@/features/home/copy'
import { BUY_COPY } from '@/features/invest/buy-copy'
import {
  approxUsd,
  buyCheckRows,
  dollarsText,
  NO_FEE_CAP_RAW,
  reserveFirstOf,
  ryntraFeeFigures,
  type BuyOutcome,
} from '@/features/invest/buy-model'
import {
  convertReviewRows,
  eventLine,
  listedPriceOf,
  SELL_FOR_USDC,
  swapActionWord,
  type ConvertMode,
  type IssuerEvent,
} from '@/features/invest/conversion-watch'
import { companyPathView } from '@/features/invest/company-path'
import { COMPANY_PATH_COPY } from '@/features/invest/company-path-copy'
import { CONVERT_COPY } from '@/features/invest/convert-copy'
import { clearJourneys, useJourneys } from '@/features/journeys/journey-store'
import { journeyLine, summarizeJourneys } from '@/features/journeys/journeys'
import { postLocalNote } from '@/features/notifications/push'
import { useMonitoring } from '@/features/plans/use-plans'
import { PORTFOLIO_COPY } from '@/features/portfolio/copy'
import { portfolioRow } from '@/features/portfolio/portfolio-model'
import { useAccount } from '@/features/session/use-account'
import { USDC_ASSET, type TradeContext } from '@/features/trade/trade-model'
import type { AutoinvestRule, CompanyPath, RuleBudget, RuleConditionCheck, RuleOccurrence } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { CompanyPathStrip } from '@/screens/asset/company-path'
import { AttentionRow } from '@/screens/home/blocks'
import { LaunchDoneSamples, LaunchMineSamples, LaunchTokenSamples } from '@/screens/launch/launch-samples'
import { MoneySamples } from '@/screens/money/money-samples'
import { PaymentEvents } from '@/screens/autoinvest/autoinvest-sheet'
import { RuleCard } from '@/screens/autoinvest/rule-card'
import { SAMPLE_BUY_CHECKS, SAMPLE_BUY_FEES } from '@/screens/invest/buy-samples'
import { BudgetRow } from '@/screens/autoinvest/budget-row'
import { HomeRuleCard } from '@/screens/autoinvest/rules-block'
import {
  BuyReceiptFace,
  BuyReviewTable,
  receiptFace,
  ReserveFirstLine,
  ReviewTable,
  RuleMarkLine,
} from '@/screens/invest/buy-sheet'
import { convertReceiptFace } from '@/screens/invest/convert-sheet'
import { EventBanner } from '@/screens/invest/event-ui'
import { SaleSamples } from '@/screens/invest/sale-samples'
import { HoldingRow } from '@/screens/portfolio/holding-row'
import { WidgetSamples } from '@/screens/widget-samples'
import { type } from '@/theme'
import { formatClock } from '@/utils/format'

/* Every figure on this screen is synthetic and says so. The gallery exists in development builds only. */
const SAMPLE_AT = '2026-09-14T20:55:14.587Z'
const SAMPLE_QUOTE_AT = new Date(Date.now() - 12_000).toISOString()
const SAMPLE_NOW = Date.parse(SAMPLE_QUOTE_AT) + 12_000
const SAMPLE_CONTEXT: TradeContext = {
  mode: 'buy',
  pay: USDC_ASSET,
  receive: {
    mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
    symbol: 'AAPLx',
    name: 'Apple',
    icon: null,
    decimals: 8,
  },
  payDecimals: 6,
  receiveDecimals: 8,
  inAmountRaw: '20000000',
  outAmountRaw: '7870000',
  minReceivedRaw: '7830000',
}
const SAMPLE_OUTCOMES: readonly BuyOutcome[] = [
  { kind: 'filled', spentRaw: '20000000', gotRaw: '7868000', fromReview: false, belowMinimum: false },
  { kind: 'filled', spentRaw: '20000000', gotRaw: '7800000', fromReview: false, belowMinimum: true },
  { kind: 'nothing' },
  { kind: 'not-filled' },
]

/* The IPO and conversion watch (M19): SpaceX went public, its PreStocks token SPACEX (×5) to be swapped into xStocks'
   SPCXx by 23:59 UTC on 12 March 2027 — about $10 of it swapped, and the same sold for USDC, as a route would quote it. */
const SAMPLE_SPACEX = 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh'
const SAMPLE_SPCXX = 'Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8'
const SAMPLE_EVENT: IssuerEvent = {
  mint: SAMPLE_SPACEX,
  symbol: 'SPACEX',
  company: 'SpaceX',
  cause: 'ipo',
  into: { mint: SAMPLE_SPCXX, symbol: 'SPCXx', company: 'SpaceX' },
  deadline: '2027-03-12T23:59:00.000Z',
  open: true,
  noticeUrl: 'https://www.prestocks.com/spacex',
}
/* «Шлях компанії» (M24): SpaceX's path as production states it on SPACEX's row (at `private`, the swap open) and SPCXx's
   (at `solana`), and OpenAI's while it is private — the web's registry of 2026-09-25. */
const pathStep = (step: string, state: string, fields: Partial<CompanyPath['steps'][number]> = {}) => ({
  step,
  state,
  date: null,
  priceUsd: null,
  exchange: null,
  ticker: null,
  token: null,
  ...fields,
})
const SAMPLE_SPACEX_PATH: CompanyPath = {
  at: 'private',
  steps: [
    pathStep('private', 'passed', { date: '2025-09-16', token: { mint: SAMPLE_SPACEX, symbol: 'SPACEX' } }),
    pathStep('ipo', 'passed', { date: '2026-06-12', priceUsd: 135 }),
    pathStep('exchange', 'passed', { date: '2026-06-12', exchange: 'Nasdaq', ticker: 'SPCX' }),
    pathStep('solana', 'current', { date: '2026-06-12', token: { mint: SAMPLE_SPCXX, symbol: 'SPCXx' } }),
  ],
  swap: {
    from: { mint: SAMPLE_SPACEX, symbol: 'SPACEX' },
    into: { mint: SAMPLE_SPCXX, symbol: 'SPCXx' },
    deadline: '2027-03-12T23:59:00.000Z',
    open: true,
  },
  swapMonths: null,
  sources: [
    { label: 'PreStocks · SpaceX', url: 'https://www.prestocks.com/spacex', publishedAt: null, readAt: '2026-09-25' },
  ],
}
const SAMPLE_OPENAI = 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF'
const SAMPLE_OPENAI_PATH: CompanyPath = {
  at: 'private',
  steps: [
    pathStep('private', 'current', { date: '2025-09-16', token: { mint: SAMPLE_OPENAI, symbol: 'OPENAI' } }),
    pathStep('ipo', 'unannounced'),
    pathStep('exchange', 'unannounced'),
    pathStep('solana', 'unannounced'),
  ],
  swap: null,
  swapMonths: 9,
  sources: [
    { label: 'PreStocks · FAQ', url: 'https://www.prestocks.com/faq', publishedAt: null, readAt: '2026-09-25' },
  ],
}
const SAMPLE_SWAP_ORDER = {
  inAmountRaw: '16906000',
  outAmountRaw: '6640000',
  minReceivedRaw: '6574000',
  inUsdValue: '9.89',
  outUsdValue: '9.80',
  totalFeeBasisPoints: 10,
  priceImpactPct: '0.001',
  signatureFeeLamports: '5000',
  priorityFeeLamports: '40075',
  rentFeeLamports: '2039280',
}
const SAMPLE_SALE_ORDER = {
  ...SAMPLE_SWAP_ORDER,
  outAmountRaw: '9880000',
  minReceivedRaw: '9830000',
  outUsdValue: '9.88',
  rentFeeLamports: '0',
}
const sampleConvertContext = (mode: ConvertMode): TradeContext => ({
  mode: 'sell',
  pay: { mint: SAMPLE_SPACEX, symbol: 'SPACEX', name: 'SpaceX', icon: null, decimals: 9 },
  receive:
    mode === 'swap' ? { mint: SAMPLE_SPCXX, symbol: 'SPCXx', name: 'SpaceX', icon: null, decimals: 8 } : USDC_ASSET,
  payDecimals: 9,
  receiveDecimals: mode === 'swap' ? 8 : 6,
  inAmountRaw: '16906000',
  outAmountRaw: mode === 'swap' ? '6640000' : '9880000',
  minReceivedRaw: mode === 'swap' ? '6574000' : '9830000',
})
const SAMPLE_SPACEX_HOLDING = {
  kind: 'TOKEN',
  mint: SAMPLE_SPACEX,
  amountRaw: '16906000',
  spendableRaw: '16906000',
  decimals: 9,
  symbol: 'SPACEX',
  name: 'SpaceX PreStocks',
  uiMultiplier: 5,
  catalog: {
    mint: SAMPLE_SPACEX,
    symbol: 'SPACEX',
    name: 'SpaceX PreStocks',
    usdPrice: '117.0',
    isVerified: true,
    icon: null,
    category: 'stock',
    dayChangePct: -0.4,
  },
}

/* «Автоінвест» (M16): one rule of Apple — $20 every Thursday at 19:00 in Kyiv — in each of the states its card says. */
const SAMPLE_RULE_NOW = Date.parse('2026-09-24T16:05:00.000Z')
const sampleOccurrence = (
  dueAt: string,
  state: RuleOccurrence['state'],
  condition: RuleConditionCheck | null = null,
): RuleOccurrence => ({
  dueAt,
  openUntil: new Date(Date.parse(dueAt) + 86_400_000).toISOString(),
  state,
  remindedAt: state === 'missed' || state === 'held' || state === 'deferred' ? null : dueAt,
  signature: null,
  spentUsd: state === 'bought' ? 20 : null,
  boughtAt: null,
  trigger: null,
  condition,
  amountUsd: null,
  events: null,
})
/* «Умова ціни» (M25, 1.18.0): the rule's judgements as the server keeps them — OpenAI 30 % above PreStocks' valuation
   (the web's own example), its data gone old, and Apple within its limit as a Review states it. */
const SAMPLE_CONDITION_ABOVE: RuleConditionCheck = {
  verdict: 'above',
  reference: 'prestocks',
  limitPct: 5,
  priceUsd: 1300,
  referenceUsd: 1000,
  deviationPct: 30,
  dataAt: '2026-09-24T15:57:00.000Z',
  checkedAt: '2026-09-24T16:02:00.000Z',
}
const SAMPLE_CONDITION_STALE: RuleConditionCheck = {
  ...SAMPLE_CONDITION_ABOVE,
  verdict: 'stale',
  priceUsd: 1010,
  deviationPct: 1,
  dataAt: '2026-09-24T12:00:00.000Z',
}
const SAMPLE_CONDITION_MET: RuleConditionCheck = {
  verdict: 'met',
  reference: 'issuer',
  limitPct: 5,
  priceUsd: 200.8,
  referenceUsd: 200,
  deviationPct: 0.4,
  dataAt: '2026-09-24T16:04:00.000Z',
  checkedAt: '2026-09-24T16:05:00.000Z',
}
const SAMPLE_RULE: AutoinvestRule = {
  id: 'rule_00000000000000000000000000000000',
  owner: 'sample',
  network: 'solana:mainnet',
  kind: 'schedule',
  asset: {
    network: 'solana:mainnet',
    mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
    symbol: 'AAPLx',
    issuer: { id: 'xstocks', label: 'xStocks' },
    underlying: { symbol: 'AAPL', name: 'Apple Inc.' },
    decimals: 8,
    unitBasis: 'share',
  },
  name: 'Apple',
  amountUsd: 20,
  schedule: { cadence: 'weekly', weekday: 4, monthDay: null, time: '19:00', timeZone: 'Europe/Kyiv' },
  dip: null,
  payments: null,
  priceCondition: null,
  status: 'active',
  nextDueAt: '2026-10-01T16:00:00.000Z',
  occurrences: [sampleOccurrence('2026-09-17T16:00:00.000Z', 'bought')],
  createdAt: SAMPLE_AT,
  updatedAt: SAMPLE_AT,
}
/* «З кожної оплати» (M26, 1.19.0): the contract's own example — every payment rounded up to $1 into Apple; a $3,40
   payment with its Solana Pay label waits with $0,60, then a $2,30 one makes $1,30 and one reminder on exactly it. */
const SAMPLE_PAYMENT_OUT = {
  signature: 'sample-payment-1',
  direction: 'out',
  amountUsd: 3.4,
  addUsd: 0.6,
  at: '2026-09-24T11:05:00.000Z',
  label: 'Order 4821',
  dueAt: null,
} as const
const SAMPLE_PAYMENTS: NonNullable<AutoinvestRule['payments']> = {
  mode: 'roundup',
  roundToUsd: 1,
  fixedUsd: null,
  percent: null,
  timeZone: 'Europe/Kyiv',
  since: '2026-09-24T07:00:00.000Z',
  gatheredUsd: 0.6,
  gatheredCount: 1,
  events: [SAMPLE_PAYMENT_OUT],
  read: { at: '2026-09-24T16:00:00.000Z', state: 'ok' },
}
const SAMPLE_PAYMENTS_RULE: AutoinvestRule = {
  ...SAMPLE_RULE,
  id: 'rule_00000000000000000000000000000002',
  kind: 'payments',
  amountUsd: 1,
  schedule: null,
  nextDueAt: null,
  payments: SAMPLE_PAYMENTS,
  occurrences: [],
}
const SAMPLE_PAYMENTS_DUE: AutoinvestRule = {
  ...SAMPLE_PAYMENTS_RULE,
  payments: {
    ...SAMPLE_PAYMENTS,
    gatheredUsd: 0,
    gatheredCount: 0,
    events: [
      {
        ...SAMPLE_PAYMENT_OUT,
        signature: 'sample-payment-2',
        amountUsd: 2.3,
        addUsd: 0.7,
        at: '2026-09-24T15:30:00.000Z',
        label: null,
        dueAt: '2026-09-24T15:35:00.000Z',
      },
      { ...SAMPLE_PAYMENT_OUT, dueAt: '2026-09-24T15:35:00.000Z' },
    ],
  },
  occurrences: [{ ...sampleOccurrence('2026-09-24T15:35:00.000Z', 'due'), amountUsd: 1.3, events: 2 }],
}
const SAMPLE_OPENAI_RULE: AutoinvestRule = {
  ...SAMPLE_RULE,
  id: 'rule_00000000000000000000000000000001',
  asset: {
    network: 'solana:mainnet',
    mint: 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF',
    symbol: 'OPENAI',
    issuer: { id: 'prestocks', label: 'PreStocks' },
    underlying: { symbol: 'OPENAI', name: 'OpenAI' },
    decimals: 9,
    unitBasis: 'token',
  },
  name: 'OpenAI',
  amountUsd: 10,
  priceCondition: { limitPct: 5 },
  occurrences: [sampleOccurrence('2026-09-24T16:00:00.000Z', 'deferred', SAMPLE_CONDITION_ABOVE)],
}
const SAMPLE_BUDGET_SPENT: RuleBudget = {
  capUsd: 50,
  timeZone: 'Europe/Kyiv',
  monthStartsAt: '2026-08-31T21:00:00.000Z',
  monthEndsAt: '2026-09-30T21:00:00.000Z',
  spentUsd: 45,
  unknownUsd: 0,
  remainingUsd: 5,
  exhausted: true,
  updatedAt: SAMPLE_AT,
}
/* «Бюджет місяця» (1.13.0): the month as Home's bar says it — half spent, spent, and without a ceiling. */
const SAMPLE_MONTHS: readonly Readonly<{ key: string; budget: RuleBudget }>[] = [
  { key: 'half', budget: { ...SAMPLE_BUDGET_SPENT, capUsd: 100, spentUsd: 45, remainingUsd: 55, exhausted: false } },
  { key: 'spent', budget: { ...SAMPLE_BUDGET_SPENT, capUsd: 100, spentUsd: 100, remainingUsd: 0, exhausted: true } },
  { key: 'open', budget: { ...SAMPLE_BUDGET_SPENT, capUsd: null, spentUsd: 20, remainingUsd: null, exhausted: false } },
]
const SAMPLE_RULES: readonly Readonly<{ key: string; rule: AutoinvestRule; budget: RuleBudget | null }>[] = [
  {
    key: 'due',
    rule: {
      ...SAMPLE_RULE,
      occurrences: [sampleOccurrence('2026-09-24T16:00:00.000Z', 'due'), ...SAMPLE_RULE.occurrences],
    },
    budget: null,
  },
  { key: 'next', rule: SAMPLE_RULE, budget: null },
  {
    key: 'missed',
    rule: { ...SAMPLE_RULE, occurrences: [sampleOccurrence('2026-09-17T16:00:00.000Z', 'missed')] },
    budget: null,
  },
  { key: 'paused', rule: { ...SAMPLE_RULE, status: 'paused', nextDueAt: null }, budget: null },
  { key: 'held', rule: SAMPLE_RULE, budget: SAMPLE_BUDGET_SPENT },
  { key: 'deferred', rule: SAMPLE_OPENAI_RULE, budget: null },
  {
    key: 'deferred-stale',
    rule: {
      ...SAMPLE_OPENAI_RULE,
      occurrences: [sampleOccurrence('2026-09-24T16:00:00.000Z', 'deferred', SAMPLE_CONDITION_STALE)],
    },
    budget: null,
  },
  {
    key: 'dip',
    rule: {
      ...SAMPLE_RULE,
      kind: 'dip',
      schedule: null,
      nextDueAt: null,
      occurrences: [],
      dip: {
        dropPct: 5,
        timeZone: 'Europe/Kyiv',
        anchorUsd: 254.3,
        anchorAt: '2026-09-24T10:00:00.000Z',
        anchorFrom: 'enabled',
        triggerUsd: 241.59,
        armed: true,
        heldAt: null,
      },
    },
    budget: null,
  },
  {
    key: 'dip-missed',
    rule: {
      ...SAMPLE_RULE,
      kind: 'dip',
      schedule: null,
      nextDueAt: null,
      occurrences: [
        {
          ...sampleOccurrence('2026-09-22T11:35:00.000Z', 'missed'),
          trigger: { priceUsd: 240.1, anchorUsd: 254.3 },
        },
      ],
      dip: {
        dropPct: 5,
        timeZone: 'Europe/Kyiv',
        anchorUsd: 254.3,
        anchorAt: '2026-09-20T10:00:00.000Z',
        anchorFrom: 'enabled',
        triggerUsd: 241.59,
        armed: false,
        heldAt: null,
      },
    },
    budget: null,
  },
  { key: 'payments', rule: SAMPLE_PAYMENTS_RULE, budget: null },
  { key: 'payments-due', rule: SAMPLE_PAYMENTS_DUE, budget: null },
]

/** A «З кожної оплати» rule's list as its sheet draws it — «Мій рахунок» asks once more here too, and writes nothing. */
function SamplePaymentEvents({ payments = SAMPLE_PAYMENTS }: { payments?: AutoinvestRule['payments'] }) {
  const ruleCopy = useCopy(AUTOINVEST_COPY)
  const locale = useLocale()
  const [asking, setAsking] = useState<string | null>(null)
  if (!payments) return null
  return (
    <PaymentEvents
      payments={payments}
      zone="Europe/Kyiv"
      copy={ruleCopy}
      locale={locale}
      asking={asking}
      busy={false}
      marking={false}
      onAsk={setAsking}
      onConfirm={() => setAsking(null)}
    />
  )
}

function Section({ title, children, sample = true }: { title: string; children: React.ReactNode; sample?: boolean }) {
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2 px-1 pt-3">
        <Txt variant="labelSm" tone="faint" caps>
          {title}
        </Txt>
        {sample ? <Chip label="Sample" tone="evidence" /> : <Chip label="This phone" />}
      </View>
      {children}
    </View>
  )
}

/** The base components of the design system, rendered with labelled sample data, in both themes. */
export function GalleryScreen() {
  const router = useRouter()
  const [sheet, setSheet] = useState(false)
  const [sort, setSort] = useState<'volume' | 'name'>('volume')
  // A sample note aimed at the wallet's own latest note when there is one, so the tap walks the real resolver.
  const account = useAccount()
  const monitoring = useMonitoring(account.session, useLocale())
  const latest = monitoring.data?.recent[0] ?? null
  const sampleLink = `https://ryntra.io/app/alerts/open?n=${latest?.id ?? 'inb_0123456789abcdef01234567'}`
  // The device's own journeys: where Home led, how a note came back — words and times, no identities.
  const journeys = useJourneys()
  const homeCopy = useCopy(HOME_COPY)
  const buyCopy = useCopy(BUY_COPY)
  const ruleCopy = useCopy(AUTOINVEST_COPY)
  const locale = useLocale()
  const reserveFirst = reserveFirstOf(SAMPLE_BUY_CHECKS.reserveFirst)
  const checkRows = (key: keyof typeof SAMPLE_BUY_CHECKS) => {
    const check = SAMPLE_BUY_CHECKS[key]
    const ryntraFee = ryntraFeeFigures(SAMPLE_BUY_FEES[key], locale)
    return buyCheckRows(check, {
      unit: check.company.unit,
      company: check.company.name,
      locale,
      words: buyCopy,
      ryntraFee,
    })
  }
  const convertCopy = useCopy(CONVERT_COPY)
  const pathCopy = useCopy(COMPANY_PATH_COPY)
  const portfolioCopy = useCopy(PORTFOLIO_COPY)
  const eventNow = Date.parse('2026-09-26T09:00:00.000Z')
  const convertRows = (mode: ConvertMode) =>
    convertReviewRows({
      mode,
      order: mode === 'swap' ? SAMPLE_SWAP_ORDER : SAMPLE_SALE_ORDER,
      token: { symbol: 'SPACEX', multiplier: 5 },
      giveDecimals: 9,
      getDecimals: mode === 'swap' ? 8 : 6,
      target: mode === 'swap' ? { mint: SAMPLE_SPCXX, symbol: 'SPCXx', company: 'SpaceX', multiplier: 1 } : null,
      listed: listedPriceOf(null, 148.57, 'SPCXx'),
      company: 'SpaceX',
      issuerFee: { basisPoints: 100, maximumFeeRaw: NO_FEE_CAP_RAW },
      solUsd: 200,
      locale,
      words: buyCopy,
    }).map((row) => ({
      key: row.key,
      label: convertCopy[({ give: 'rowGive', get: 'rowGet', costs: 'rowCosts', rate: 'rowRate' } as const)[row.key]],
      value: row.value,
      fee: row.fee,
      sub: row.sub,
      inlineSub: row.key === 'give',
    }))
  const holderActions = {
    swap: { title: swapActionWord(SAMPLE_EVENT, locale) ?? '', onPress: () => {} },
    sell: { title: SELL_FOR_USDC[locale], onPress: () => {} },
  }
  /* SPACEX's own page to a holder (the event is the path's line, the swap and the sale under it), SPCXx's page, OpenAI
     while private, and SPACEX's page once the phone's clock passes the cut-off (the sale alone). */
  const afterCutoff = Date.parse('2027-03-13T00:00:00.000Z')
  const pathSamples = [
    {
      key: 'spacex',
      view: companyPathView(
        SAMPLE_SPACEX_PATH,
        { mint: SAMPLE_SPACEX, privateFeeBps: 100, holder: true, nowMs: eventNow },
        pathCopy,
        locale,
      ),
      actions: holderActions,
    },
    {
      key: 'spcxx',
      view: companyPathView(
        { ...SAMPLE_SPACEX_PATH, at: 'solana' },
        { mint: SAMPLE_SPCXX, privateFeeBps: 100, holder: false, nowMs: eventNow },
        pathCopy,
        locale,
      ),
      actions: null,
    },
    {
      key: 'openai',
      view: companyPathView(
        SAMPLE_OPENAI_PATH,
        { mint: SAMPLE_OPENAI, privateFeeBps: 300, holder: false, nowMs: eventNow },
        pathCopy,
        locale,
      ),
      actions: null,
    },
    {
      key: 'closed',
      view: companyPathView(
        SAMPLE_SPACEX_PATH,
        { mint: SAMPLE_SPACEX, privateFeeBps: 100, holder: true, nowMs: afterCutoff },
        pathCopy,
        locale,
      ),
      actions: { swap: null, sell: holderActions.sell },
    },
  ]
  const journeySummary = summarizeJourneys(journeys)
  const recentJourneys = journeys.slice(-12).reverse()
  return (
    <View className="flex-1 bg-ground">
      <View className="flex-1">
        <Screen
          title="Design gallery"
          subtitle="Sample data · development build"
          bottomInset={96}
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => router.back()}
              className="h-9 w-9 items-center justify-center rounded-btn border border-line bg-surface active:bg-hover"
            >
              <Icon name="close" size={20} color="muted" />
            </Pressable>
          }
        >
          <Section title="Launch · a token's page">
            <LaunchTokenSamples />
          </Section>
          <Section title="Launch · My launches and a claim">
            <LaunchMineSamples />
          </Section>
          <Section title="Launch · the launch's end">
            <LaunchDoneSamples />
          </Section>
          <Section title="Note on the phone">
            <Card className="gap-2">
              <Txt variant="ui" tone="muted">
                Posts a note shaped as the push the server sends; a tap walks the deep-link mapper and the resolver.
              </Txt>
              <Txt variant="data" tone="faint" numberOfLines={1}>
                {latest ? `${latest.context} · ${latest.id}` : 'no note of this wallet · a sample id'}
              </Txt>
              <Button
                title="Post a sample note"
                variant="secondary"
                onPress={() =>
                  void postLocalNote({
                    title: 'Ryntra',
                    body: latest ? `${latest.context} — ${latest.title}` : 'NVDAx — NVDAx is above your price bound',
                    link: sampleLink,
                  })
                }
              />
            </Card>
          </Section>
          <Section title="Home · the unfinished operation">
            <AttentionRow
              item={{
                kind: 'recovery',
                attempt: {
                  schema: 'ryntra.mobile.trade-attempt',
                  schemaVersion: '1.0.0',
                  requestId: 'sample',
                  signature: 'sample',
                  taker: 'sample',
                  state: 'SUBMITTED_UNKNOWN',
                  recordedAt: SAMPLE_QUOTE_AT,
                  context: {
                    mode: 'buy',
                    pay: {
                      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                      symbol: 'USDC',
                      name: 'USD Coin',
                      icon: null,
                      decimals: 6,
                    },
                    receive: {
                      mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
                      symbol: 'NVDAx',
                      name: 'NVIDIA xStock',
                      icon: null,
                      decimals: 8,
                    },
                    payDecimals: 6,
                    receiveDecimals: 8,
                    inAmountRaw: '25000000',
                    outAmountRaw: '10950000',
                    minReceivedRaw: '10900000',
                  },
                },
              }}
              copy={homeCopy}
              locale={locale}
              now={SAMPLE_NOW}
              onPress={() => undefined}
            />
          </Section>
          <Section title="Purchase · the four rows and the receipt">
            <BuyReviewTable rows={checkRows('apple')} words={buyCopy} />
            <BuyReviewTable rows={checkRows('openai')} words={buyCopy} />
            <BuyReviewTable rows={checkRows('dollar')} words={buyCopy} />
            {reserveFirst ? (
              <ReserveFirstLine
                line={buyCopy.reserveFirst(
                  approxUsd(reserveFirst.reserveUsd, locale),
                  dollarsText(reserveFirst.spendUsd, locale),
                )}
              />
            ) : null}
            <BuyReviewTable rows={checkRows('reserveFirst')} words={buyCopy} />
            {/* No route for $1 (M21): the company's own minimum read from the quote, and the one action that puts it in —
                what the sheet says when the venue answers «no route» below $5, as no company does today. */}
            <Card className="gap-3">
              <Txt variant="ui" tone="muted" className="text-center">
                {buyCopy.routeMinimum(dollarsText(1, locale), 'S&P 500', dollarsText(5, locale))}
              </Txt>
              <Button title={buyCopy.setMinimum(dollarsText(5, locale))} size="lg" />
            </Card>
            {SAMPLE_OUTCOMES.map((outcome) => (
              <Card key={outcome.kind === 'filled' ? `filled-${outcome.belowMinimum}` : outcome.kind}>
                <BuyReceiptFace
                  face={receiptFace(
                    outcome,
                    SAMPLE_CONTEXT,
                    { name: 'Apple', unit: 'share', multiplier: 1 },
                    buyCopy,
                    locale,
                  )}
                />
              </Card>
            ))}
          </Section>
          <Section title="Money · Send, the Review and a payment link">
            <MoneySamples />
          </Section>
          <Section title="Home-screen widget · Portfolio">
            <WidgetSamples />
          </Section>
          <Section title="Sale from a position · Apple and OpenAI">
            <SaleSamples />
          </Section>
          <Section title="IPO and swap watch · SpaceX">
            {/* Everyone reads the event before any figure; a holder reads the ask, with the swap and the quiet sale. */}
            <EventBanner line={eventLine(SAMPLE_EVENT, 'everyone', locale, eventNow)} />
            <EventBanner line={eventLine(SAMPLE_EVENT, 'holder', locale, eventNow)} actions={holderActions} />
            <ReviewTable rows={convertRows('swap')} />
            <ReviewTable rows={convertRows('sell')} />
            {(['swap', 'sell'] as const).map((mode) => (
              <Card key={mode}>
                <BuyReceiptFace
                  face={convertReceiptFace({
                    outcome: {
                      kind: 'filled',
                      spentRaw: '16906000',
                      gotRaw: mode === 'swap' ? '6640000' : '9880000',
                      fromReview: false,
                      belowMinimum: false,
                    },
                    mode,
                    context: sampleConvertContext(mode),
                    symbol: 'SPACEX',
                    multiplier: 5,
                    intoMultiplier: 1,
                    words: convertCopy,
                    buyWords: buyCopy,
                    locale,
                  })}
                />
              </Card>
            ))}
            <Card padded={false} className="px-4">
              <HoldingRow
                row={portfolioRow(SAMPLE_SPACEX_HOLDING)}
                copy={portfolioCopy}
                onPress={() => {}}
                last
                event={{ line: eventLine(SAMPLE_EVENT, 'holder', locale, eventNow), actions: holderActions }}
              />
            </Card>
          </Section>
          <Section title="The company's path · SpaceX and OpenAI">
            {pathSamples.map((sample) =>
              sample.view ? (
                <CompanyPathStrip
                  key={sample.key}
                  view={sample.view}
                  words={pathCopy}
                  onOpenToken={() => {}}
                  actions={sample.actions}
                />
              ) : null,
            )}
          </Section>
          <Section title="Autoinvest · the budget's own line and the rules">
            {SAMPLE_MONTHS.map((sample) => (
              <BudgetRow
                key={sample.key}
                budget={sample.budget}
                copy={ruleCopy}
                locale={locale}
                onEdit={() => undefined}
              />
            ))}
            {SAMPLE_RULES.map((sample) => (
              <HomeRuleCard
                key={sample.key}
                rule={sample.rule}
                budget={sample.budget}
                icon={null}
                copy={ruleCopy}
                locale={locale}
                now={SAMPLE_RULE_NOW}
                switching={false}
                onPress={() => undefined}
                onToggle={() => undefined}
              />
            ))}
          </Section>
          <Section title="Autoinvest · the rule, its reminder and its receipt">
            {SAMPLE_RULES.map((sample) => (
              <RuleCard
                key={sample.key}
                rule={sample.rule}
                budget={sample.budget}
                now={SAMPLE_RULE_NOW}
                onPress={() => undefined}
              />
            ))}
            <BuyReviewTable rows={checkRows('apple')} words={buyCopy} />
            <RuleMarkLine
              line={`${ruleCopy.byRule} · ${ruleWhenLine(SAMPLE_RULE, locale)}`}
              next={wholeParts(
                `${ruleCopy.priceCondition} · ${conditionReviewLine(SAMPLE_CONDITION_MET, SAMPLE_RULE_NOW, 'Europe/Kyiv', locale)}`,
              )}
            />
            {/* «З кожної оплати» (M26): the rule's newest payments as its sheet lists them, then the reminder's receipt. */}
            <SamplePaymentEvents />
            <SamplePaymentEvents payments={SAMPLE_PAYMENTS_DUE.payments} />
            <RuleMarkLine line={`${ruleCopy.byRule} · ${ruleWhenLine(SAMPLE_PAYMENTS_RULE, locale)}`} next={null} />
            <Card className="gap-3">
              <BuyReceiptFace
                face={receiptFace(
                  SAMPLE_OUTCOMES[0]!,
                  SAMPLE_CONTEXT,
                  { name: 'Apple', unit: 'share', multiplier: 1 },
                  buyCopy,
                  locale,
                )}
              />
              <RuleMarkLine
                line={`${ruleCopy.byRule} · ${ruleWhenLine(SAMPLE_RULE, locale)}`}
                next={`${ruleCopy.nextPurchase}: ${dueWords(Date.parse(SAMPLE_RULE.nextDueAt!), 'Europe/Kyiv', locale)}`}
              />
            </Card>
            <Card className="gap-3">
              <BuyReceiptFace
                face={receiptFace(
                  SAMPLE_OUTCOMES[0]!,
                  SAMPLE_CONTEXT,
                  { name: 'Apple', unit: 'share', multiplier: 1 },
                  buyCopy,
                  locale,
                )}
              />
              <Button title={buyCopy.done} size="lg" />
              <Button title={ruleCopy.buyWeekly} variant="secondary" size="lg" />
            </Card>
          </Section>
          <Section title="Journeys on this phone" sample={false}>
            <Card className="gap-2">
              <Txt variant="ui" tone="muted">
                {journeySummary.count} steps · Home led to{' '}
                {Object.entries(journeySummary.homeGoTo)
                  .map(([door, count]) => `${door} ×${count}`)
                  .join(', ') || 'nothing yet'}
              </Txt>
              {recentJourneys.map((entry, index) => (
                <Txt key={`${entry.at}-${index}`} variant="data" tone="faint" numberOfLines={1}>
                  {formatClock(entry.at)} {journeyLine(entry)}
                </Txt>
              ))}
              <Button title="Clear journeys" variant="secondary" onPress={clearJourneys} />
            </Card>
          </Section>
          <Section title="Type ramp">
            <Card className="gap-2">
              {(Object.keys(type) as (keyof typeof type)[]).map((variant) => (
                <Txt key={variant} variant={variant}>
                  {variant === 'data' || variant === 'dataLg' ? '1,234.56 SOL' : `${variant} — Trade with a plan`}
                </Txt>
              ))}
            </Card>
          </Section>

          <Section title="Chips">
            <View className="flex-row flex-wrap gap-2">
              <Chip label="Neutral" />
              <Chip label="Brand" tone="brand" />
              <Chip label="Settled" tone="success" />
              <Chip label="Failed" tone="danger" />
              <Chip label="Stale" tone="warning" />
              <Chip label="Evidence" tone="evidence" />
              <Chip label="+0.27%" tone="success" mono />
            </View>
          </Section>

          <Section title="Buttons">
            <View className="gap-2">
              <Button title="Primary" />
              <Button title="Secondary" variant="secondary" />
              <Button title="Ghost" variant="ghost" />
              <View className="flex-row gap-2">
                <Button title="Loading" loading className="flex-1" />
                <Button title="Disabled" disabled className="flex-1" />
              </View>
            </View>
          </Section>

          <Section title="AssetRow">
            <Card padded={false} className="px-4">
              <AssetRow
                asset={{
                  symbol: 'SPYx',
                  name: 'SP500 xStock',
                  icon: null,
                  price: 763.03,
                  change24hPct: 0.27,
                  issuer: { label: 'xStocks · Backed Finance' },
                  verified: true,
                }}
                onPress={() => undefined}
              />
              <AssetRow
                asset={{ symbol: 'SOL', name: 'Solana', icon: null, price: 214.42, change24hPct: -1.2 }}
                onPress={() => undefined}
              />
              <AssetRow
                asset={{
                  symbol: 'WIF',
                  name: 'dogwifhat',
                  icon: null,
                  price: 0.00042,
                  change24hPct: null,
                  suspicious: true,
                }}
                last
              />
            </Card>
          </Section>

          <Section title="SessionChip · DeviationChip">
            <View className="flex-row flex-wrap gap-2">
              <SessionChip period="market" nextChangeAt={SAMPLE_AT} />
              <SessionChip period="extended" nextChangeAt={SAMPLE_AT} />
              <SessionChip period="overnight" />
              <SessionChip period="closed" />
              <SessionChip period="unknown" />
              <DeviationChip deviationPct={0.18} reference="NYSE" />
              <DeviationChip deviationPct={1.4} reference="NYSE" />
              <DeviationChip deviationPct={-3.2} reference="NYSE" />
              <DeviationChip deviationPct={null} reference="NAV" />
            </View>
          </Section>

          <Section title="StatTile">
            <View className="flex-row gap-2">
              <StatTile label="Portfolio" value="$12,480.20" at={SAMPLE_AT} size="lg" className="flex-1" />
              <StatTile label="Unpriced" value="2 of 9" at={SAMPLE_AT} stale className="flex-1" />
            </View>
            <View className="flex-row gap-2">
              <StatTile label="24h" value="+$212.40" tone="success" at={SAMPLE_AT} className="flex-1" />
              <StatTile label="Reference" value="—" className="flex-1" />
            </View>
          </Section>

          <Section title="ReviewBlock">
            <ReviewBlock
              rows={[
                { label: 'You pay', value: '100.00 USDC' },
                { label: 'Expected', value: '0.4662 SOL' },
                { label: 'Minimum received', value: '0.4639 SOL', emphasis: true },
                { label: 'Price impact', value: '0.04%' },
                { label: 'Network fee', value: '0.000005 SOL' },
                { label: 'Ryntra fee', value: '0.10 USDC' },
              ]}
              quotedAt={SAMPLE_QUOTE_AT}
              warnings={['Token-2022 mint: the receiving account costs rent once.']}
            />
            <ReviewBlock
              rows={[{ label: 'Minimum received', value: '0.4639 SOL', emphasis: true }]}
              quotedAt={SAMPLE_AT}
            />
          </Section>

          <Section title="ReceiptCard">
            <ReceiptCard
              status="settled"
              title="Buy SPYx"
              paid="100.00 USDC"
              received="0.1309 SPYx"
              at={SAMPLE_AT}
              signature="sample-receipt-3"
            />
            <ReceiptCard status="pending" title="Swap SOL to USDC" paid="0.5 SOL" received="—" at={SAMPLE_AT} />
            <ReceiptCard
              status="failed"
              title="Sell NVDAx"
              paid="—"
              received="—"
              at={SAMPLE_AT}
              signature="sample-receipt-4"
            />
          </Section>

          <Section title="Skeleton">
            <View className="flex-row items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-pill" />
              <View className="flex-1 gap-2">
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-3 w-40" />
              </View>
            </View>
          </Section>

          <Section title="States">
            <Card padded={false}>
              <StateView
                icon="list-outline"
                title="Nothing here yet"
                detail="One line that ends the empty state."
                action={{ title: 'Refresh', onPress: () => undefined }}
              />
            </Card>
            <Card padded={false}>
              <StateView
                icon="cloud-offline-outline"
                tone="danger"
                title="No connection"
                detail="The list needs the network."
                action={{ title: 'Try again', onPress: () => undefined }}
              />
            </Card>
          </Section>

          <Section title="FilterSheet">
            <Button title="Open sheet" variant="secondary" onPress={() => setSheet(true)} />
          </Section>
        </Screen>
      </View>
      <BottomAction
        title="Sign in your wallet"
        hint="Sample · BottomAction docked above the system bar"
        onPress={() => undefined}
      />
      <FilterSheet
        visible={sheet}
        title="Sort by"
        options={[
          { value: 'volume', label: 'Most traded', detail: '24h volume, highest first' },
          { value: 'name', label: 'Name', detail: 'A to Z' },
        ]}
        value={sort}
        onSelect={setSort}
        onClose={() => setSheet(false)}
      />
    </View>
  )
}
