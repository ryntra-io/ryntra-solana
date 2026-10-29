import { useRoute, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, RefreshControl, Share, ToastAndroid, View } from 'react-native'
import Animated, { LinearTransition } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/button'
import { Chip } from '@/components/chip'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { Skeleton } from '@/components/skeleton'
import { StatTile } from '@/components/stat-tile'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { ExplainMove, useOpenRyn } from '@/features/agent/ask-ryn'
import { AGENT_COPY } from '@/features/agent/copy'
import { AUTOINVEST_COPY } from '@/features/autoinvest/copy'
import {
  purchaseSumUsd,
  reminderOffer,
  ruleBuyRouteOf,
  ruleBuyState,
  ruleFace,
  ruleForMint,
  type RuleBuyState,
} from '@/features/autoinvest/rule-model'
import { isListedToken } from '@/features/autoinvest/floor'
import { useRule, useRules, useRuleWrites } from '@/features/autoinvest/use-rules'
import { ruleWhenLine, unbrokenParts } from '@/features/autoinvest/words'
import { BUY_COPY } from '@/features/invest/buy-copy'
import { DEFAULT_BUY_USD, dollarsText, exchangeState, issuerFeeOf, truthLine } from '@/features/invest/buy-model'
import { COMPANY_COPY } from '@/features/invest/company-copy'
import { companyHead, countShort, moneyShort, truthTopicOf, type CompanyHead } from '@/features/invest/company-facts'
import { companyPathView, otherPathToken } from '@/features/invest/company-path'
import { COMPANY_PATH_COPY } from '@/features/invest/company-path-copy'
import {
  eventLine,
  eventOfRow,
  listedPriceOf,
  SELL_FOR_USDC,
  swapActionWord,
  windowOpen,
  type ConvertMode,
} from '@/features/invest/conversion-watch'
import { INVEST_COPY } from '@/features/invest/copy'
import {
  fairFromOf,
  heardLive,
  liveAt,
  poolWarningOf,
  poolWarningText,
  quoteFar,
  type LiveShareQuote,
} from '@/features/invest/pool-warning'
import { SALE_COPY } from '@/features/invest/sale-copy'
import { heldUnitsText, positionUsd } from '@/features/invest/sale-model'
import { SOL_MINT } from '@/lib/api'
import { DETAILS_COPY } from '@/features/invest/details-copy'
import { coinName, companyDisplayName, premiumPhrase } from '@/features/invest/shelf'
import type { BuyCompany } from '@/features/invest/use-buy'
import type { ConvertInto, ConvertToken } from '@/features/invest/use-convert'
import { truthTopicText } from '@/features/invest/truth-topics'
import { useShelfEvents, useShelfNames } from '@/features/invest/use-shelf'
import { amountTextOf, shownRaw } from '@/features/portfolio/portfolio-model'
import { useHoldings } from '@/features/portfolio/use-portfolio'
import { offerAssetActions } from '@/features/pro-chart/asset-actions'
import { useAccount } from '@/features/session/use-account'
import { PLACES_COPY } from '@/features/shell/places'
import { useWatchlist } from '@/features/watchlist/watchlist'
import { useMarket, useStockAsset } from '@/hooks/use-market'
import { useStockUniverse } from '@/hooks/use-markets'
import { useNow } from '@/hooks/use-now'
import {
  isNetworkError,
  isNotFound,
  type AutoinvestRule,
  type MarketDetail,
  type PathToken,
  type RuleOccurrence,
  type StockAsset,
} from '@/lib/api'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'
import { stockLookalike } from '@/lib/search'
import { isSupportedIssuer } from '@/lib/stocks'
import { AutoinvestSheet, type AutoinvestCompany, type AutoinvestMode } from '@/screens/autoinvest/autoinvest-sheet'
import { BudgetSheet } from '@/screens/autoinvest/budget-sheet'
import { RuleCard } from '@/screens/autoinvest/rule-card'
import { BuySheet } from '@/screens/invest/buy-sheet'
import { ConvertSheet } from '@/screens/invest/convert-sheet'
import { KeyboardLiftScroll } from '@/screens/launch/keyboard-lift'
import { PositionCard, SellSheet } from '@/screens/invest/sell-sheet'
import { EventBanner } from '@/screens/invest/event-ui'
import { useTheme } from '@/theme'
import { DASH, formatClock, formatUsd } from '@/utils/format'

import { ChartCard } from './chart-card'
import { CompanyFacts } from './company-facts'
import { CompanyPathStrip } from './company-path'
import { QuoteCard } from './quote-card'
import { ResearchSheet } from './research-sheet'
import { QuietDoor, AssetHead, AssetHeadLoading, AssetHeadName, TruthBlock, type AssetWarning } from './asset-head'
import { StockBlock, StockBlockLoading, StockUnconfirmed } from './stock-block'

/**
 * The name a person knows the asset by: the company the shelf names, else the
 * issuer's company with its legal form taken off, else the coin's own name —
 * never the ticker.
 */
function displayName(detail: MarketDetail, stock: StockAsset | null, shelfName: string | null): string {
  if (shelfName) return shelfName
  if (stock) {
    const rep = stock.row.representation
    return companyDisplayName(rep.underlying.name ?? rep.name, rep.underlying.symbol)
  }
  return coinName(detail)
}

/** How long a company's page waits for the issuer's read before it stands on the market's read alone. */
const HEAD_GRACE_MS = 700
/** The page's blocks glide to their new place when the issuer's parts land above them, never jump. */
const SETTLE = LinearTransition.duration(220)

export type AssetScreenProps = {
  mint: string
  /** What the list knew, so the head has a name before the read answers. */
  symbol?: string
  category?: string
  /** Open the company's purchase at once — a signature to check, from Home's one line. */
  openBuy?: boolean
  /** An autoinvest reminder to buy under — from a note of the inbox, Home's rule or a link. */
  reminder?: Readonly<{ ruleId: string; dueAt: string | null }> | null
  /** Open the company's «Автоінвест» at once — Home's «Додати правило». */
  openAutoinvest?: boolean
  /** Open the swap before the issuer's deadline, or the sale — a note of the inbox, a Portfolio row, a link. */
  openConvert?: ConvertMode | null
}

/**
 * The asset — one page for everyone (M14, M15):
 * the company's name, one price in dollars with the day's
 * change and the local time, the line over a day, a week, a month or half a year,
 * the label of what the token is (its line in «Що ти купуєш») and whether the
 * exchange is open, «Купити» as the one orange action — the purchase in dollars, as a
 * sheet over the page — and «Спитати Ryntra» quiet under it. A coin's «Купити»
 * opens Trade. A private company's page adds its price against PreStocks'
 * valuation; a token of an issuer Ryntra no longer
 * supports says so in one line where a purchase would be.
 *
 * Everything «Профі» drew here is one tap deep, under «Деталі»: the ticker,
 * the name and the issuer, the price's time and state, the issuer's
 * reference, session, deviation and units, «Відкрити в Споті» (Trade — also
 * how a holder of a retired token sells it), «Створити план» where a plan can
 * stand, the watchlist's star, the facts behind the figures, the pool's own
 * chart by the interval with its source, the venue's figures and the quote
 * for an amount — each the venue's, the issuer's or the chain's figure with
 * its time.
 *
 * «Автоінвест» (M16 stands under «Купити»: a quiet door to a
 * new rule — «Регулярно», or «Якщо впаде» from the price this page read — or,
 * once the company has one, the rule itself, with what comes next. **While
 * its reminder is open** the rule's purchase is the
 * first action — «Час твоєї покупки · Щотижня · чт о 19:00» over «Купити $20
 * за правилом», the purchase sheet bound to the rule — and an ordinary
 * purchase is the second, quiet one, saying the reminder stays open: the rule
 * counts only a purchase by the rule. A reminder opened from the inbox or
 * Home lands here and is read afresh first; one the month's budget does not
 * cover offers «Змінити бюджет», the budget's sheet over it.
 *
 * **Нагляд за IPO й обміном** (M19: a private token whose
 * issuer opened a window to swap it says so between its name and its price —
 * «SpaceX вийшла на біржу. SPACEX треба обміняти до 12 березня 2027 — після
 * строку токен згорить.»; a wallet that holds it reads «Обміняй SPACEX до …»
 * and, right under it, «Обміняти на SpaceX (SPCXx)» — then the page's one
 * orange action, «Купити» stepping back to quiet — and «Продати за USDC»
 * beside it, quiet; each opens the swap's sheet, where «Перевірка» and the
 * wallet's signature decide. A purchase of the token says first that it must
 * be swapped by the deadline.
 *
 * **Сторінка компанії, повна** (M23, the web's: under
 * the name, who the company is — «NVDA · Nasdaq», «Приватна компанія»; over
 * «Купити», the label of what the token is, its line waiting in «Що ти купуєш»;
 * under the purchase, the facts at rest — «Ключові показники», «Про компанію»,
 * «Що ти купуєш», «Торги на Solana · 24 год» (`company-facts.tsx`) — and only
 * then «Деталі», as the web's page closes. The company's SEC figures, its
 * industry and what it does are the web's own files, asked of line A
 * (request 37); nothing stands in for them.
 *
 * **Шлях компанії** (M24, the web's: under the purchase
 * (M27 — the price and «Купити» hold the first screen; above them only on the
 * private token's own page, whose path carries the swap deadline),
 * where the contract gives a path, the strip Приватна · PreStocks → IPO → Біржа
 * → Solana (`company-path.tsx`) — this token «цей токен», the company's other
 * token a tap to its page, SPACEX and SPCXx leading to each other; under the
 * steps the private token's swap deadline with the issuer's minute, or the
 * issuer's rule while the company is private. On SPACEX's own page that line is
 * the issuer's event, a holder's swap and sale under it, so the event is said
 * once.
 */
export function AssetScreen({
  mint,
  symbol,
  category,
  openBuy = false,
  reminder = null,
  openAutoinvest = false,
  openConvert = null,
}: AssetScreenProps) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { colors } = useTheme()
  const now = useNow(15_000)
  const locale = useLocale()
  const words = useCopy(INVEST_COPY)
  const buyWords = useCopy(BUY_COPY)
  const ruleWords = useCopy(AUTOINVEST_COPY)
  const places = useCopy(PLACES_COPY)
  const detailWords = useCopy(DETAILS_COPY)
  const companyWords = useCopy(COMPANY_COPY)
  const pathWords = useCopy(COMPANY_PATH_COPY)
  const nameOf = useShelfNames()
  const shelfEvents = useShelfEvents()
  const watchlist = useWatchlist()
  const [research, setResearch] = useState(false)
  const [details, setDetails] = useState(false)
  /* The live prices for one share this page saw, each with its sum, time and engine — the purchase sheet's estimates and
     the quotes for an amount (ST-5 r8). The pool warning follows only the purchase's own engine at the sum about to be
     bought (ST-5 r9, r10: the quote card's fair $1 000 never softens the warning, nor says «from $1 000» beside it). */
  const [seen, setSeen] = useState<readonly LiveShareQuote[]>([])
  const hearLive = useCallback((next: LiveShareQuote) => setSeen((held) => heardLive(held, next)), [])
  /* The sum the person is about to buy: the purchase sheet's own, as it was last left — before the sheet opened, the
     sum it opens on. */
  const [buyUsd, setBuyUsd] = useState<number | null>(DEFAULT_BUY_USD)
  const hearAmount = useCallback((usd: number | null) => setBuyUsd(usd), [])
  // The spinner answers the person's pull only — never the price's own refresh every 20 seconds.
  const [pulling, setPulling] = useState(false)
  const [buying, setBuying] = useState(openBuy || reminder !== null)
  // The sale open now, with the company as the page named it when «Продати» was pressed: the sheet stays while it is open.
  const [selling, setSelling] = useState<Readonly<{ name: string; icon: string | null; ticker: string }> | null>(null)
  const saleWords = useCopy(SALE_COPY)

  /* ---- «Автоінвест»: the wallet's rules, and the reminder the purchase is made under ---- */
  const account = useAccount()
  const session = account.session
  // The reminder as the link named it — kept until its sheet closes, so a closed sheet never buys under it again.
  const [pending, setPending] = useState(reminder)
  const rules = useRules(session)
  const budget = rules.data?.budget ?? null
  const companyRule = rules.data ? ruleForMint(rules.data.rules, mint) : null
  // Its reminder the page offers first — open, and covered by the month's budget — and how it is said.
  const offer = reminderOffer(companyRule, budget, now)
  // The reminder's own sum (1.19.0): what a «З оплат» rule gathered; the rule's sum for the other kinds.
  const offerUsd = companyRule && offer ? purchaseSumUsd(companyRule, offer) : null
  const offerWords =
    companyRule && offerUsd !== null
      ? {
          when: unbrokenParts(`${ruleWords.timeToBuy} · ${ruleWhenLine(companyRule, locale)}`),
          buy: ruleWords.buyByRule(dollarsText(offerUsd, locale)),
        }
      : null
  const reminderRead = useRule(session, pending?.ruleId ?? null)
  const writes = useRuleWrites(session)
  const ruleState: RuleBuyState | null = pending
    ? ruleBuyState({ read: reminderRead.read, rule: reminderRead.rule, dueAt: pending.dueAt, budget, nowMs: now })
    : null
  // Stable across renders: the rules' reads are invalidated — the reminder's own read among them — never looped.
  const reread = useCallback(() => void writes.reread(), [writes])
  const [autoinvest, setAutoinvest] = useState<AutoinvestMode | null>(null)
  const [askedAutoinvest, setAskedAutoinvest] = useState(openAutoinvest)
  // «Змінити бюджет» — from a reminder's purchase the month does not cover, or from a rule it holds: over that sheet.
  const [budgetOpen, setBudgetOpen] = useState(false)
  const openBudget = useCallback(() => setBudgetOpen(true), [])
  const buyUnder = (rule: AutoinvestRule, occurrence: RuleOccurrence) => {
    setAutoinvest(null)
    // A token's purchase under its rule (1.31.0) is Trade's ticket as the rule's purchase; a company's, this page's sheet.
    if (isListedToken(rule.asset)) {
      router.push(ruleBuyRouteOf(rule, occurrence.dueAt) as never)
      return
    }
    setPending({ ruleId: rule.id, dueAt: occurrence.dueAt })
    setBuying(true)
  }
  const closeBuy = () => {
    setBuying(false)
    setPending(null)
  }
  const market = useMarket(mint)
  const detail: MarketDetail | null = market.data?.market ?? null
  // The confirmed stocks, to say when this token borrows a stock's ticker or name without being it (ST-5 r4) — read only
  // for a token no issuer stands behind as a stock.
  const universe = useStockUniverse(detail !== null && !(detail.category === 'stock' && detail.issuer !== null))
  // A company the list named, or the shelf this session read, is one from the first frame: its issuer's read runs beside
  // the market's rather than after it.
  const isStock = (detail?.category ?? category ?? (nameOf(mint) !== null ? 'stock' : undefined)) === 'stock'
  const stock = useStockAsset(isStock ? mint : null)
  // The issuer's first read is on its way. The page waits for it only a moment (HEAD_GRACE_MS) — a warm read lands
  // inside it and the page appears whole; a cold one (6–12 s for a private company) never holds the price and
  // «Купити» back: the head stands on the market's read and the issuer's parts fill in as they arrive.
  const issuerFirstRead = isStock && stock.isPending && stock.failureCount === 0
  // Until the issuer answers — its first try or its retry — its parts on the page are shapes that hold their place.
  const issuerReading = isStock && stock.isPending
  const [graceOver, setGraceOver] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setGraceOver(true), HEAD_GRACE_MS)
    return () => clearTimeout(timer)
  }, [])
  const starred = watchlist.has(mint)
  const agentCopy = useCopy(AGENT_COPY)
  const openRyn = useOpenRyn()
  const stockRep = stock.data?.row.representation ?? null
  /* A token of an issuer Ryntra no longer supports: not bought, planned or described by its
     issuer here — one line says so and where to sell it; a person who holds it reaches Trade under «Деталі». */
  const retired =
    (stockRep !== null && !isSupportedIssuer(stockRep.issuer.id)) ||
    (detail !== null && detail.issuer !== null && !isSupportedIssuer(detail.issuer.tag))
  /* A plan stands on a confirmed stock or (1.7.0) a verified crypto or meme token the venue lists with its
     decimals and does not flag — the server's own rule; the builder asks the server again before anything is saved. */
  const plannable =
    !retired &&
    (isStock ||
      (detail !== null &&
        detail.verified &&
        (detail.category === 'crypto' || detail.category === 'meme') &&
        !detail.audit.suspicious &&
        detail.decimals !== null))

  /* ---- the IPO and conversion watch: the issuer's window on this token, the wallet's own read, the target ---- */
  const holdings = useHoldings(account.address)
  // SOL's own row is the native balance, as Trade reads it — never a wrapped-SOL account under its name.
  const heldRow =
    holdings.data?.data.holdings.find((holding) =>
      mint === SOL_MINT ? holding.kind === 'NATIVE_SOL' : holding.mint === mint,
    ) ?? null
  const holds = heldRow !== null && /^\d+$/.test(heldRow.amountRaw) && BigInt(heldRow.amountRaw) > 0n
  const pageName = detail ? displayName(detail, stock.data ?? null, nameOf(mint)) : null
  // A private token is PreStocks' alone: the market's own read says so before the issuer's answers.
  const marketPrivate = detail?.issuer?.tag === 'prestocks'
  const pendingPrivate = issuerReading && marketPrivate
  // Until the issuer's read answers, the shelf's copy of its event: the swap deadline stands before the price at once.
  const event =
    stock.data && stockRep?.instrument?.class === 'pre-ipo' && !retired && pageName
      ? eventOfRow(stock.data.row, pageName)
      : pendingPrivate
        ? shelfEvents.eventOf(mint)
        : null
  // With no shelf ever read (a first open from a link), nothing can say before the issuer whether a swap deadline stands
  // over this private token's price: its head waits for the issuer rather than letting the deadline land above a price.
  const privateUnknown = pendingPrivate && !shelfEvents.known
  const eventOpen = event ? windowOpen(event, now) : false
  const holder = event !== null && holds
  // The listed token the swap lands in, read from the same routes: its price on the exchange and what it is.
  const target = useStockAsset(event?.into?.mint ?? null)
  const into: ConvertInto | null =
    event?.into && target.data
      ? {
          mint: event.into.mint,
          symbol: event.into.symbol,
          company: event.into.company,
          icon: target.data.row.market.icon,
          decimals:
            target.data.row.representation.decimals ??
            ('error' in target.data.onchain ? null : target.data.onchain.decimals),
          multiplier: target.data.chainMultiplier?.current ?? target.data.row.multiplier?.current ?? null,
          listed: listedPriceOf(target.data.row.reference.perShare, target.data.row.market.priceUsd, event.into.symbol),
          truth: truthLine(target.data.row.representation.issuer.id, event.into.company, locale),
        }
      : null
  const convertToken: ConvertToken | null =
    event && stock.data && detail
      ? {
          mint,
          symbol: event.symbol,
          name: pageName ?? event.company,
          icon: detail.icon,
          decimals: detail.decimals ?? ('error' in stock.data.onchain ? null : stock.data.onchain.decimals),
          multiplier: stock.data.chainMultiplier?.current ?? stock.data.row.multiplier?.current ?? null,
          issuerFee: issuerFeeOf(stock.data.row.transferFee),
        }
      : null
  // For a holder, while the window is open and its target is read, the swap is the page's one orange action.
  const swapFirst = holder && eventOpen && into !== null
  const [converting, setConverting] = useState<ConvertMode | null>(openConvert)
  // A link that asks again while this page is open — the router keeps one page per address and hands it the new
  // parameters — opens the sheet anew (state adjusted during render, as React prescribes).
  const [convertAsked, setConvertAsked] = useState(openConvert)
  if (openConvert !== convertAsked) {
    setConvertAsked(openConvert)
    if (openConvert) setConverting(openConvert)
  }
  // A swap asked for while its target is still being read waits for it, rather than opening as the sale.
  const convertMode: ConvertMode | null =
    converting === 'swap'
      ? into && eventOpen
        ? 'swap'
        : event?.into && eventOpen && target.isPending
          ? null
          : 'sell'
      : converting
  const buyerLine = event && eventOpen ? eventLine(event, 'buyer', locale, now) : null

  /* ---- «Шлях компанії»: the company's way, this token's step, the other token one tap away ---- */
  const companyPath = stock.data && !retired ? (stock.data.row.companyPath ?? null) : null
  // On the listed token's page the private token's own row says what it is: its issuer's fee, as the chain states it.
  const pathOther = companyPath?.at === 'solana' ? otherPathToken(companyPath) : null
  const counterpart = useStockAsset(pathOther?.mint ?? null)
  const privateFee = companyPath?.at === 'solana' ? counterpart.data?.row.transferFee : stock.data?.row.transferFee
  const pathView = companyPathView(
    companyPath,
    { mint, privateFeeBps: privateFee?.basisPoints ?? null, holder, nowMs: now },
    pathWords,
    locale,
  )
  // On the private token's own page the issuer's event is the path's own line, a holder's swap and sale under it.
  const pathCarriesEvent = event !== null && companyPath?.at === 'private' && pathView?.line?.kind === 'swap'
  const openPathToken = (token: PathToken) =>
    router.push({ pathname: '/asset/[mint]', params: { mint: token.mint, symbol: token.symbol, category: 'stock' } })

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))
  const star = () => {
    const result = watchlist.toggle(mint)
    if (result.refused) ToastAndroid.show(places.watchFull(watchlist.limit), ToastAndroid.SHORT)
  }
  const goTrade = () => router.push({ pathname: '/trade', params: { mint, symbol: detail?.symbol ?? symbol ?? '' } })
  // The purchase and the sale pinned at the foot of the page (NEW-LOOK §3) open the one sheet over it.
  const goBuy = () =>
    router.push({ pathname: '/trade', params: { mint, symbol: detail?.symbol ?? symbol ?? '', side: 'buy' } })
  /* An old link's reminder on a coin or a meme (1.31.0): its purchase is Trade's ticket as the rule's purchase — the page
     hands it on once it knows the token is no company. */
  const handOn = reminder !== null && detail !== null && !isStock
  const handRule = reminder?.ruleId ?? null
  const handDue = reminder?.dueAt ?? null
  const handedOn = useRef(false)
  useEffect(() => {
    if (!handOn || !handRule || handedOn.current) return
    handedOn.current = true
    router.replace({
      pathname: '/trade',
      params: { mint, side: 'buy', rule: handRule, ...(handDue ? { due: handDue } : {}) },
    })
  }, [handOn, handRule, handDue, mint, router])
  /* «Що купити» (Home's «Купити», NEW-LOOK §3) opens a coin's page with its purchase already open: the page hands the
     purchase's sheet on once it knows the token is no company — a company's own purchase opens through `buying`. */
  const openCoinBuy = openBuy && reminder === null && detail !== null && !isStock
  const coinSymbol = detail?.symbol ?? symbol ?? ''
  const coinBuyOpened = useRef(false)
  useEffect(() => {
    if (!openCoinBuy || coinBuyOpened.current) return
    coinBuyOpened.current = true
    router.push({ pathname: '/trade', params: { mint, symbol: coinSymbol, side: 'buy' } })
  }, [openCoinBuy, mint, coinSymbol, router])
  // The professional chart — the core's, the web's own — over the same market (CH-21).
  const goProChart = () =>
    router.push({ pathname: '/chart/[mint]', params: { mint, symbol: detail?.symbol ?? symbol ?? '' } })
  // A door only where a plan can stand: a stock, or a verified crypto or meme token (see `plannable`).
  const goPlan = () => router.push({ pathname: '/plans/new', params: { mint, symbol: detail?.symbol ?? symbol ?? '' } })
  // The ticker the page knows — the market's, else the list's — goes with the question; the conversation's header names
  // the asset as this page does (ST-5 r4), never by its address.
  const askSymbol = detail?.symbol || symbol || null
  const askRyn = () => openRyn({ kind: 'asset', mint, ...(askSymbol ? { symbol: askSymbol.slice(0, 32) } : {}) })

  const observedAt = market.data?.observedAt ?? null

  let body
  let company: BuyCompany | null = null
  /* «Продати» (only with a position) and «Купити», pinned at the foot (NEW-LOOK §3) — where the page's one purchase is
     plain; a rule's reminder, an issuer's swap first, or a company not offered keep their own words in the page. */
  let pinned: Readonly<{ buy: () => void; buying: boolean; sell: (() => void) | null }> | null = null
  // The page's own sale, pinned or not: the pro chart over this page offers «Продати» only where the page does (CH-21).
  let sale: (() => void) | null = null
  /* A look-alike's line — or a pool that cannot stand for the share (ST-5 r7) — said right over «Купити» docked at the
     foot (ST-5 r6), where one who scrolled past the head reads it before buying; then the head does not say it again
     (ST-5 r10: one place at a time). */
  let buyWarning: string | null = null
  let ruleCompany: AutoinvestCompany | null = null
  // Before the market answers: the shelf's name, else the ticker the list carried.
  const knownName = nameOf(mint) ?? (symbol && symbol.length > 0 ? symbol : null)
  if (market.isPending || (market.data && ((issuerFirstRead && !graceOver) || privateUnknown))) {
    body = <AssetHeadLoading name={knownName} />
  } else if (market.isError && !market.data) {
    // The name the list carried stays over the failure, as it stood over the loading (ST-5 r4).
    body = (
      <View className="gap-4">
        {knownName ? <AssetHeadName name={knownName} /> : null}
        <StateView
          icon={isNetworkError(market.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
          tone="danger"
          title={isNetworkError(market.error) ? words.noConnection : words.priceDown}
          action={{ title: words.tryAgain, onPress: () => void market.refetch(), loading: market.isFetching }}
        />
      </View>
    )
  } else if (!detail) {
    body = (
      <StateView icon="help-circle-outline" title={words.notListed} action={{ title: words.back, onPress: back }} />
    )
  } else {
    const stockNotConfirmed = isStock && stock.isError && isNotFound(stock.error)
    // A token that takes a stock's ticker or its company's name without being that stock: one line says so.
    // Judged by the token's own price: a copy far from the share's price is never taken for the share (ST-5 r6).
    const lookalike = universe.data ? stockLookalike(detail, universe.data.rows) : null
    if (lookalike) buyWarning = words.notTheStock(companyDisplayName(lookalike.name))
    /* A stock token whose pool price stands far from the issuer's reference for the share, or whose pool is nearly empty
       (ST-5 r7: SGOVx at $2 090 a token against a $100,59 share, $0,2 in its pool) — the head's price is the pool's, so
       the page says plainly that it is not the share's. With no reference, no distance is claimed. */
    const poolWarning =
      isStock && stock.data && !retired
        ? poolWarningOf({
            deviationPct: stock.data.row.deviationPct,
            referencePerShare: stock.data.row.reference.perShare,
            liquidityUsd: detail.liquidityUsd ?? stock.data.row.market.liquidityUsd,
            // Judged only by a live figure for the sum about to be bought (ST-5 r9); with none, the pool's own price.
            live: liveAt(seen, buyUsd, now),
            fairFrom: fairFromOf(seen, buyUsd, stock.data.row.reference.perShare, now),
          })
        : null
    const poolLine = poolWarning ? poolWarningText(poolWarning, locale, words, clockOfMs) : null
    if (poolLine && !buyWarning) buyWarning = poolLine
    /* The pool's own price far from the share (ST-5 r8: SGOVx «Капіталізація токена $110 млн» on $0,2 of liquidity): a
       figure built on that price — the token's cap, its FDV — says nothing true and is a dash. Judged on the pool's own
       price, which those figures are built on, whatever a live quote finds. */
    const poolPriceFar =
      isStock && stock.data && !retired
        ? quoteFar(stock.data.row.deviationPct, stock.data.row.reference.perShare)
        : false
    const retiredLine = (
      <View className="flex-row items-start gap-2 rounded-sm border border-line bg-surface px-4 py-3">
        <Icon name="information-circle-outline" size={18} color="muted" />
        <Txt variant="ui" tone="muted" className="flex-1">
          {buyWords.retired}
        </Txt>
      </View>
    )

    /* ---- the pieces, each the page's figure with its time ---- */
    // The retired line is said once, in the purchase's place — never again among the issuer's figures.
    const stockPart: ReactNode = isStock ? (
      retired ? null : stock.data ? (
        <StockBlock asset={stock.data} now={now} />
      ) : stockNotConfirmed ? (
        <StockUnconfirmed />
      ) : stock.isError ? (
        <View className="flex-row flex-wrap items-center gap-2 rounded-sm border border-line bg-surface px-4 py-3">
          <Chip label={detailWords.issuerDown} tone="warning" caps={false} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={detailWords.issuerRetry}
            onPress={() => void stock.refetch()}
          >
            <Txt variant="ui" tone="brand">
              {detailWords.tryAgain}
            </Txt>
          </Pressable>
        </View>
      ) : (
        <StockBlockLoading />
      )
    ) : null

    // The day's figures in the words «Торги на Solana» says them above (ST-5 r6: «$7,83 млн» there, «$7,8 млн» here).
    const statsPart = (
      <View className="gap-2">
        <View className="flex-row gap-2">
          <StatTile
            label={detailWords.volume24h}
            value={moneyShort(detail.volume24hUsd, locale) ?? DASH}
            at={observedAt}
            className="flex-1"
          />
          <StatTile
            label={detailWords.liquidity}
            value={moneyShort(detail.liquidityUsd, locale) ?? DASH}
            at={observedAt}
            className="flex-1"
          />
        </View>
        <View className="flex-row gap-2">
          <StatTile
            // A stock token's cap is the token's value on the chain, never the company's (ST-5 r7).
            label={isStock ? detailWords.tokenMarketCap : detailWords.marketCap}
            value={poolPriceFar ? DASH : (moneyShort(detail.marketCapUsd, locale) ?? DASH)}
            at={observedAt}
            className="flex-1"
          />
          <StatTile
            label={detailWords.holders}
            value={countShort(detail.holders, locale) ?? DASH}
            at={observedAt}
            className="flex-1"
          />
        </View>
      </View>
    )

    const quotePart = stock.data && !retired ? <QuoteCard asset={stock.data} now={now} onLive={hearLive} /> : null

    const researchSheet = (
      <ResearchSheet
        visible={research}
        onClose={() => setResearch(false)}
        market={detail}
        observedAt={observedAt ?? detail.updatedAt ?? ''}
        stock={retired ? null : (stock.data ?? null)}
        poolPriceFar={poolPriceFar}
      />
    )

    /* The company the purchase needs: confirmed by an issuer Ryntra supports, offered, trading and priced. */
    const rep = stockRep
    const privateCompany = rep?.instrument?.class === 'pre-ipo'
    const name = displayName(detail, stock.data ?? null, nameOf(mint))
    // The issuer's fee as the chain states it names itself in a private company's line (the web's own, M23).
    const feeBps = stock.data?.row.transferFee?.basisPoints ?? null
    const truth = rep ? truthLine(rep.issuer.id, name, locale, feeBps) : null
    /* Who the company is, under its name, and the label of what its token is — the web's head and purchase card. */
    const head: CompanyHead | null =
      stock.data && rep && !retired
        ? companyHead(
            {
              preIpo: privateCompany,
              symbol: rep.symbol,
              ticker: rep.underlying.symbol,
              exchange: rep.exchange,
              path: stock.data.row.companyPath ?? null,
            },
            companyWords,
            locale,
          )
        : null
    const topicId = rep && !retired && !privateCompany ? truthTopicOf(rep.issuer.id) : null
    const truthLabel = topicId ? truthTopicText(topicId, locale).title : null
    const halted = rep?.tradingHalted === true
    const offered = stock.data?.row.lifecycle?.tradable !== false
    if (stock.data && rep && !retired && !halted && offered && detail.price !== null) {
      const onchain = 'error' in stock.data.onchain ? null : stock.data.onchain
      company = {
        mint,
        ticker: detail.symbol,
        name,
        icon: detail.icon,
        decimals: detail.decimals ?? onchain?.decimals ?? null,
        multiplier: stock.data.chainMultiplier?.current ?? stock.data.row.multiplier?.current ?? null,
        unit: rep.instrument?.unitBasis === 'token' ? 'token' : 'share',
        preIpo: privateCompany,
        truth,
        eventLine: buyerLine,
        issuerFee: issuerFeeOf(stock.data.row.transferFee),
        pool: {
          referencePerShare: stock.data.row.reference.perShare,
          deviationPct: stock.data.row.deviationPct,
          liquidityUsd: detail.liquidityUsd ?? stock.data.row.market.liquidityUsd,
          seen,
        },
      }
    }
    // A fall's rule counts from the price now: only a price this page read fresh is offered as that point.
    const freshPrice = market.data?.stale || market.isError ? null : detail.price
    ruleCompany = {
      mint,
      // A token's rule is named by its symbol (1.31.0), as the server names it.
      name: isStock ? name : detail.symbol,
      icon: detail.icon,
      preIpo: privateCompany,
      truth,
      eventLine: buyerLine,
      priceUsd: freshPrice,
      token: !isStock,
    }

    /* The issuer's event, before any figure: a holder's line with the swap and the sale under it, everyone's line alone
       — in its own box, or, where «Шлях компанії» stands on the private token's page, as the path's line (M24). */
    // A holder's swap and sale only once their sheet can open — the token read (convertToken); until then the line alone.
    const holderActions =
      event && holder && convertToken
        ? {
            swap: swapFirst
              ? { title: swapActionWord(event, locale) ?? '', onPress: () => setConverting('swap') }
              : null,
            sell: { title: SELL_FOR_USDC[locale], onPress: () => setConverting('sell') },
          }
        : null
    // «Шлях компанії» stands above the price only for a holder of the private token, whose swap is the path's own line
    // and the page's one orange action; for everyone else it stands under the purchase, so the price and «Купити»
    // hold the first screen, and the issuer's event is said before any figure in its own two lines (M19, M27).
    const pathAbove = pathCarriesEvent && holder
    const eventBanner =
      event && !pathAbove ? (
        <EventBanner line={eventLine(event, holder ? 'holder' : 'everyone', locale, now)} actions={holderActions} />
      ) : null
    const pathStrip = pathView ? (
      <CompanyPathStrip
        // Where the banner above says the event, the path below does not say it again.
        view={pathCarriesEvent && !pathAbove ? { ...pathView, line: null } : pathView}
        words={pathWords}
        onOpenToken={openPathToken}
        actions={pathAbove ? holderActions : null}
      />
    ) : null

    const exchange = stock.data && !privateCompany ? exchangeState(stock.data.row.session) : null
    /* A private company's one number beside its price: against PreStocks' own valuation. */
    const markLine = privateCompany && !retired ? premiumPhrase(stock.data?.row.markPremiumPct, locale, words) : null
    const warnings = [
      // A look-alike's own line says more than «no issuer confirms»: one line, not two.
      stockNotConfirmed && !lookalike ? { key: 'unconfirmed', text: words.notConfirmed, tone: 'warning' } : null,
      lookalike
        ? { key: 'lookalike', text: words.notTheStock(companyDisplayName(lookalike.name)), tone: 'warning' }
        : null,
      poolLine ? { key: 'pool', text: poolLine, tone: 'warning' } : null,
      detail.verified ? null : { key: 'unverified', text: words.unverified, tone: 'warning' },
      detail.audit.suspicious ? { key: 'flagged', text: words.flagged, tone: 'warning' } : null,
    ].filter((warning): warning is AssetWarning => warning !== null)

    /* «Купити»: a company opens the purchase in dollars; a coin, or a token no issuer confirms, opens Trade. */
    let buyAction: ReactNode = null
    let pinBuy: Readonly<{ press: () => void; buying: boolean }> | null = null
    if ((!isStock || stockNotConfirmed) && companyRule && offer && offerWords) {
      /* A coin's or a meme's rule with its reminder open (1.31.0): the rule's purchase first — Trade's ticket on its sum —
         an ordinary purchase second and quiet; that the reminder stays open is its button's hint, never a line (ST-4). */
      buyAction = (
        <View className="gap-2">
          <View className="flex-row items-center justify-center gap-1.5 px-2">
            <Icon name="time-outline" size={14} color="brand" />
            <Txt variant="ui" tone="muted" tabular className="shrink text-center">
              {offerWords.when}
            </Txt>
            <View className="-my-2">
              <HelpDot title={ruleWords.reminderStaysOpen} body={ruleWords.plainHereLeavesOpen} size={16} />
            </View>
          </View>
          <Button title={offerWords.buy} size="lg" onPress={() => buyUnder(companyRule, offer)} />
          <Button
            title={ruleWords.plainPurchase}
            variant="secondary"
            size="lg"
            accessibilityHint={ruleWords.reminderStaysOpen}
            onPress={goTrade}
          />
        </View>
      )
    } else if (!isStock || stockNotConfirmed) {
      pinBuy = { press: goBuy, buying: false }
    } else if (company && companyRule && offer && offerWords) {
      /* The rule's reminder is open: its purchase first, on its sum; an ordinary purchase second and quiet — that the
         reminder stays open (the rule counts only a purchase by the rule) is its button's hint, never a line (ST-4). */
      buyAction = (
        <View className="gap-2">
          <View className="flex-row items-center justify-center gap-1.5 px-2">
            <Icon name="time-outline" size={14} color="brand" />
            <Txt variant="ui" tone="muted" tabular className="shrink text-center">
              {offerWords.when}
            </Txt>
            <View className="-my-2">
              <HelpDot title={ruleWords.reminderStaysOpen} body={ruleWords.plainHereLeavesOpen} size={16} />
            </View>
          </View>
          <Button
            title={offerWords.buy}
            variant={swapFirst ? 'secondary' : 'primary'}
            size="lg"
            onPress={() => buyUnder(companyRule, offer)}
          />
          <Button
            title={ruleWords.plainPurchase}
            variant="secondary"
            size="lg"
            accessibilityHint={ruleWords.reminderStaysOpen}
            onPress={() => setBuying(true)}
          />
        </View>
      )
    } else if (company && swapFirst) {
      // A holder's one orange action is the swap above: «Купити» steps back to quiet.
      buyAction = <Button title={words.buy} variant="secondary" size="lg" onPress={() => setBuying(true)} />
    } else if (company) {
      pinBuy = { press: () => setBuying(true), buying: false }
    } else if (retired) {
      buyAction = retiredLine
    } else if (stock.data) {
      // Confirmed but not buyable now: said in one line, no button that cannot work.
      buyAction = (
        <View className="flex-row items-start gap-2 rounded-sm border border-line bg-surface px-4 py-3">
          <Icon
            name={halted ? 'pause-circle-outline' : 'information-circle-outline'}
            size={18}
            color={halted ? 'warningInk' : 'muted'}
          />
          <Txt variant="ui" tone={halted ? 'warning' : 'muted'} className="flex-1">
            {halted ? buyWords.halted : buyWords.notOffered}
          </Txt>
        </View>
      )
    } else if (stock.isError) {
      // The issuer's read failed: the button reads it again.
      buyAction = <Button title={words.buy} size="lg" loading={stock.isFetching} onPress={() => void stock.refetch()} />
    } else {
      // The issuer's read is on its way: «Купити» stands at once; pressed, the purchase opens the moment the company
      // is read.
      pinBuy = { press: () => setBuying(true), buying }
    }

    /* «Твоя позиція»: what the wallet holds of the company and its worth, with «Продати» — the web's sale from a
       position. Not where the issuer's window offers its own sale above: a holder never sees two. */
    const saleHint = { name, icon: detail.icon, ticker: detail.symbol }
    /* What the wallet holds — the whole of it, as «Портфель» and the chain say it (ST-5). What a sale or a swap can
       spend of it (SOL less its fee reserve) is said by that sheet as «Доступно». */
    const heldRaw =
      holds && heldRow && /^\d+$/.test(heldRow.amountRaw) && BigInt(heldRow.amountRaw) > 0n
        ? BigInt(heldRow.amountRaw)
        : null
    // Counted as the sale counts it: the chain's multiplier first, the issuer's market price first.
    const heldMultiplier =
      stock.data?.chainMultiplier?.current ?? stock.data?.row.multiplier?.current ?? heldRow?.uiMultiplier ?? null
    const heldPrice = stock.data?.row.market.priceUsd ?? detail.price
    const heldUnits =
      heldRaw !== null && heldRow
        ? heldUnitsText(
            heldRaw,
            {
              decimals: heldRow.decimals,
              multiplier: heldMultiplier,
              unit: rep?.instrument?.unitBasis === 'token' ? 'token' : 'share',
              name,
            },
            locale,
          )
        : null
    const heldUsd = positionUsd(heldRaw, heldRow?.decimals ?? null, heldMultiplier, heldPrice)
    // Where the issuer's window offers its own sale, the position is said and that sale is the one offered.
    const canSell = !retired && !halted && heldUsd !== null && !event
    /* A coin's or a meme's position the same way (the operator, 2026-10-10: «акції мають зрівнятися з криптою, з мемами»):
       what the wallet can move and its worth at the page's price, «Продати» opening Trade on a Sell of this token. */
    const coinMultiplier = heldRow?.uiMultiplier ?? null
    // Written by Portfolio's own rule (the shown raw amount cut, never rounded, to six places), so the page, the
    // holding sheet and Portfolio always say one figure.
    const coinUnits =
      (!isStock || stockNotConfirmed) && !retired && heldRaw !== null && heldRow
        ? `${amountTextOf(shownRaw(heldRaw.toString(), heldRow.kind === 'NATIVE_SOL' ? null : coinMultiplier), heldRow.decimals, locale)} ${detail.symbol}`
        : null
    const coinUsd = coinUnits ? positionUsd(heldRaw, heldRow?.decimals ?? null, coinMultiplier, detail.price) : null
    const companySale =
      isStock && stock.data && rep && !retired && heldUnits && canSell ? () => setSelling(saleHint) : null
    const coinSale = coinUnits
      ? () => router.push({ pathname: '/trade', params: { mint, symbol: detail.symbol, side: 'sell' } })
      : null
    sale = companySale ?? coinSale
    if (pinBuy) pinned = { buy: pinBuy.press, buying: pinBuy.buying, sell: sale }
    const positionCard =
      isStock && stock.data && rep && !retired && heldUnits ? (
        <Animated.View layout={SETTLE}>
          <PositionCard
            label={saleWords.yourPosition}
            value={heldUsd === null ? heldUnits : worthText(heldUsd, locale)}
            detail={heldUsd === null ? null : heldUnits}
            sellLabel={canSell && !pinned ? saleWords.sell : null}
            onSell={() => setSelling(saleHint)}
          />
        </Animated.View>
      ) : coinUnits ? (
        <Animated.View layout={SETTLE}>
          <PositionCard
            label={saleWords.yourPosition}
            value={coinUsd === null ? coinUnits : worthText(coinUsd, locale)}
            detail={coinUsd === null ? null : coinUnits}
            sellLabel={pinned ? null : saleWords.sell}
            onSell={() => router.push({ pathname: '/trade', params: { mint, symbol: detail.symbol, side: 'sell' } })}
          />
        </Animated.View>
      ) : null

    body = (
      <View className="gap-4">
        <AssetHead
          name={name}
          // A coin's ticker under its name (NEW-LOOK §3: «тікер і назва»); a company keeps its own line.
          subline={
            head?.subline ??
            (!isStock && detail.symbol && detail.symbol.toLowerCase() !== name.toLowerCase() ? detail.symbol : null)
          }
          icon={detail.icon}
          price={detail.price}
          change={detail.change24hPct}
          observedAt={observedAt}
          stale={Boolean(market.data?.stale || market.isError)}
          // A private token's line of truth from the first frame: the issuer's own once it is read.
          privateLine={
            privateCompany
              ? (truth ?? words.privateLine)
              : marketPrivate && !stock.data
                ? // Being read, or its read failed: never a private token's price without its risk.
                  (truthLine('prestocks', name, locale) ?? words.privateLine)
                : null
          }
          markLine={markLine}
          markPending={pendingPrivate}
          path={pathAbove ? pathStrip : null}
          issuerPending={issuerReading}
          event={eventBanner}
          copy={words}
          locale={locale}
          // One place at a time (ST-5 r10): the line «Купити» docked at the foot says is not said again under the price.
          warnings={pinned && buyWarning ? warnings.filter((warning) => warning.text !== buyWarning) : warnings}
        />
        {/* The line at rest says no pool: the pool's own chart by the interval, with its source, is under «Деталі». */}
        <Animated.View layout={SETTLE}>
          <ChartCard
            mint={mint}
            glance
            source={false}
            dayChangePct={detail.change24hPct}
            pro={{ symbol: detail.symbol || name, open: goProChart }}
          />
          {/* The chart's question, as the web asks it beside the price: Ryntra opened on this asset, asked once. */}
          <ExplainMove mint={mint} symbol={askSymbol} />
        </Animated.View>
        {truthLabel || exchange ? (
          <Animated.View layout={SETTLE}>
            <TruthBlock label={truthLabel} exchange={exchange} words={buyWords} />
          </Animated.View>
        ) : issuerReading && !pendingPrivate ? (
          // The label and the exchange's state are the issuer's: their shapes hold the place, so «Купити» never moves down.
          <Animated.View layout={SETTLE} style={{ gap: 8 }} accessibilityElementsHidden>
            <Skeleton className="h-7 w-36 rounded-pill" />
            <Skeleton className="h-3.5 w-52" />
          </Animated.View>
        ) : null}
        {positionCard}
        <Animated.View layout={SETTLE} style={{ gap: 8 }}>
          {/* Over an in-page «Купити» only a line the head does not already say (ST-5 r10: one place at a time). */}
          {buyWarning && !pinned && !warnings.some((warning) => warning.text === buyWarning) ? (
            <BuyWarning text={buyWarning} />
          ) : null}
          {buyAction}
          {(company || !isStock) && offer ? null : companyRule ? (
            // While its reminder is open the rule speaks through its purchase above; otherwise its card opens it.
            <RuleCard
              rule={companyRule}
              budget={budget}
              now={now}
              onPress={() => {
                const face = ruleFace(companyRule, budget, now)
                if (face.kind === 'due') buyUnder(companyRule, face.occurrence)
                else setAutoinvest({ kind: 'manage', rule: companyRule })
              }}
            />
          ) : (company || (!isStock && !retired)) && (!session || rules.data || rules.isError) ? (
            /* A new rule on a company one can buy, or (1.31.0) on any coin or meme — beside «Купити»; the sheet reads the
               floor and the facts of risk before its button. A signed-in wallet's rules are read first, so a rule is never
               offered twice. */
            <QuietDoor
              icon="repeat-outline"
              label={ruleWords.autoinvest}
              // The pool's warning is said in one place — never again on this door (ST-5 r9, r10).
              onPress={() => setAutoinvest({ kind: 'compose', amountUsd: null })}
            />
          ) : null}
          <QuietDoor icon="sparkles-outline" label={agentCopy.askRyn} onPress={askRyn} />
        </Animated.View>
        {/* «Шлях компанії» under the purchase, so the price and «Купити» hold the first screen; above them only
            where the path carries the private token's own swap deadline — its warning before any figure. */}
        {pathAbove ? null : pathStrip}
        {/* The company's facts at rest, under its purchase — the web's company page. */}
        {stock.data && head ? (
          <CompanyFacts
            mint={mint}
            market={detail}
            observedAt={observedAt}
            stale={Boolean(market.data?.stale || market.isError)}
            asset={stock.data}
            head={head}
            name={name}
          />
        ) : null}
        {/* Everything technical one press deep, after the facts — as the web's «Деталі» closes its page. */}
        <QuietDoor
          icon="list-outline"
          label={details ? words.hideDetails : words.details}
          trailing={details ? 'chevron-up' : 'chevron-down'}
          expanded={details}
          onPress={() => setDetails((open) => !open)}
        />
        {details ? (
          <View className="gap-4">
            {/* The head above says the name and the one price; «Деталі» never says them again (ST-5). */}
            {stockPart}
            {/* What «Профі» drew on this page, a tap deeper for everyone. */}
            <View className="gap-2">
              <QuietDoor
                icon="swap-horizontal-outline"
                label={places.openInSpot}
                trailing="chevron-forward"
                onPress={goTrade}
              />
              {plannable ? (
                <QuietDoor
                  icon="git-branch-outline"
                  label={places.createPlan}
                  trailing="chevron-forward"
                  onPress={goPlan}
                />
              ) : null}
              <QuietDoor
                icon="document-text-outline"
                label={words.research}
                trailing="chevron-forward"
                onPress={() => setResearch(true)}
              />
            </View>
            {/* One chart on the page — the one under the price; the pool it reads is no figure a person acts on (ST-5). */}
            {statsPart}
            {quotePart}
          </View>
        ) : null}
        {researchSheet}
      </View>
    )
  }

  /* «Купити» pressed (or a link's purchase asked) while the issuer was being read: a company that turns out not to be
     buyable ends the wait rather than leaving the button spinning (state adjusted during render, as React prescribes). */
  if (buying && company === null && isStock && !market.isPending && !stock.isPending) {
    setBuying(false)
    setPending(null)
  }

  /* The pro chart opened over this page (CH-21) offers this page's own «Купити» and «Продати» — only where the page
     offers them, and running the page's own flow with its Review: never a purchase the page withholds (a retired issuer,
     a halted stock, one not offered), never a sale without a position. */
  const proBuy = pinned?.buy ?? null
  const proActions = useRef<Readonly<{ buy: (() => void) | null; sell: (() => void) | null }>>({
    buy: null,
    sell: null,
  })
  useEffect(() => {
    proActions.current = { buy: proBuy, sell: sale }
  })
  const canProBuy = proBuy !== null
  const canProSell = sale !== null
  // The line this page says over its docked «Купити» goes over the pro chart's too (ST-5 r6).
  const proWarning = canProBuy ? buyWarning : null
  // Each open page of the asset offers by its own route: the pro chart takes the page right under it.
  const routeKey = useRoute().key
  useEffect(
    () =>
      offerAssetActions(routeKey, {
        buy: canProBuy,
        sell: canProSell,
        warning: proWarning,
        run: (action) => proActions.current[action]?.(),
      }),
    [routeKey, canProBuy, canProSell, proWarning],
  )

  /* Home's «Додати правило»: the sheet opens once the company and the wallet's rules are read — on the rule the
     company has, or a new one on a company one can buy (state adjusted during render, as React prescribes). */
  const sheetReady =
    ruleCompany !== null && (!session || !rules.isPending) && (company !== null || companyRule !== null || !isStock)
  if (askedAutoinvest && sheetReady) {
    setAskedAutoinvest(false)
    setAutoinvest(companyRule ? { kind: 'manage', rule: companyRule } : { kind: 'compose', amountUsd: null })
  }

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-2 py-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={words.back}
          onPress={back}
          hitSlop={8}
          className="h-11 w-11 items-center justify-center rounded-btn active:bg-hover"
        >
          <Icon name="arrow-back" size={22} color="fg" />
        </Pressable>
        {/* «Обране» and «Поділитися» in the head (NEW-LOOK §3): a starred asset's star is orange, the one chosen state. */}
        <View className="flex-row">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={starred ? places.watchRemove : places.watchAdd}
            accessibilityState={{ selected: starred }}
            onPress={star}
            className="h-12 w-12 items-center justify-center rounded-pill active:bg-hover"
          >
            <Icon name={starred ? 'star' : 'star-outline'} size={22} color={starred ? 'brand' : 'fg'} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={words.share}
            onPress={() => void Share.share({ message: `https://ryntra.io/app/token/${mint}` }).catch(() => undefined)}
            className="h-12 w-12 items-center justify-center rounded-pill active:bg-hover"
          >
            <Icon name="share-social-outline" size={22} color="fg" />
          </Pressable>
        </View>
      </View>
      {/* The page keeps «Своя сума» and its «Quote» above the keyboard while the amount is typed (Android draws edge to
          edge, so the window is never resized for it) — the lift the launch page's trade uses. */}
      <KeyboardLiftScroll
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => {
              setPulling(true)
              void Promise.allSettled([market.refetch(), ...(isStock ? [stock.refetch()] : [])]).finally(() =>
                setPulling(false),
              )
            }}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        <View className="pb-2 pt-2">{body}</View>
      </KeyboardLiftScroll>
      {pinned ? (
        <View
          className="gap-3 border-t border-line bg-ground px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          {buyWarning ? <BuyWarning text={buyWarning} /> : null}
          <View className="flex-row gap-3">
            {pinned.sell ? (
              <Button title={saleWords.sell} variant="secondary" size="lg" className="flex-1" onPress={pinned.sell} />
            ) : null}
            <Button title={words.buy} size="lg" className="flex-1" loading={pinned.buying} onPress={pinned.buy} />
          </View>
        </View>
      ) : null}
      {company ? (
        <BuySheet
          company={company}
          visible={buying}
          onClose={closeBuy}
          rule={ruleState ? { state: ruleState, reread, changeBudget: openBudget } : null}
          openReminder={offerUsd !== null ? { amountUsd: offerUsd } : null}
          onLive={hearLive}
          onAmount={hearAmount}
          onBuyWeekly={
            session && rules.data && !companyRule
              ? (amountUsd) => {
                  setBuying(false)
                  setAutoinvest({ kind: 'compose', amountUsd })
                }
              : null
          }
        />
      ) : null}
      {ruleCompany && autoinvest ? (
        <AutoinvestSheet
          visible
          // The rule as the wallet's list holds it now: a pause, a gathered payment or «Мій рахунок» shows at once.
          mode={
            autoinvest.kind === 'manage'
              ? {
                  kind: 'manage',
                  rule: rules.data?.rules.find((row) => row.id === autoinvest.rule.id) ?? autoinvest.rule,
                }
              : autoinvest
          }
          company={ruleCompany}
          budget={budget}
          onClose={() => setAutoinvest(null)}
          onBuyNow={buyUnder}
          onChangeBudget={openBudget}
          onMarketBuy={
            ruleCompany.token
              ? () => {
                  setAutoinvest(null)
                  goTrade()
                }
              : undefined
          }
        />
      ) : null}
      <BudgetSheet visible={budgetOpen} onClose={() => setBudgetOpen(false)} />
      {selling ? <SellSheet visible mint={mint} hint={selling} onClose={() => setSelling(null)} /> : null}
      {event && convertToken ? (
        <ConvertSheet
          visible={convertMode !== null}
          mode={convertMode ?? 'sell'}
          token={convertToken}
          into={into}
          event={event}
          onClose={() => setConverting(null)}
        />
      ) : null}
    </View>
  )
}

/** The look-alike's or the pool's warning over the purchase: the line the head says, in a box one cannot read past. */
/** The line over a docked «Купити»: a look-alike, a pool far from the share (ST-5 r6); the pro chart's foot says it too. */
export function BuyWarning({ text }: { text: string }) {
  return (
    <View
      accessibilityRole="alert"
      className="flex-row items-start gap-2 rounded-sm border border-warning-soft bg-warning-soft px-4 py-3"
    >
      <Icon name="warning-outline" size={18} color="warningInk" style={{ marginTop: 1 }} />
      <Txt variant="ui" tone="warning" className="flex-1">
        {text}
      </Txt>
    </View>
  )
}

/** A seen quote's time on the phone's clock («11:56»), as every figure's time is said. */
function clockOfMs(ms: number): string {
  return formatClock(new Date(ms).toISOString())
}

/**
 * A position's worth in Portfolio's own figure — cents always («$5,01», never «$5»; ST-5 r6), under a cent «<$0,01»,
 * never a «$0» for something held.
 */
function worthText(usd: number, locale: Locale): string {
  return formatUsd(usd, locale)
}
