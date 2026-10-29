"use client";

import { Button, Skeleton, TradeTicket, formatPrice as formatTicketPrice, impactBps, legFromEntry, newDraft, parsePrice, priceText, ticketModel, type TicketDraft, type TicketInput, type TicketMarket, type TicketResult, type TicketReviewed, type TicketUnit } from "@ryntra/core/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { occurrenceAt, purchaseSumUsd, reminderOpenNow, ruleForMint } from "@/app/app/invest/autoinvest-model";
import { BudgetSheet } from "@/app/app/invest/budget-sheet";
import { RuleReminderNotice } from "@/app/app/invest/rule-reminder-notice";
import { useAutoinvestRules } from "@/app/app/invest/use-rules";
import { AutoinvestPanel } from "@/app/app/stocks/[ticker]/autoinvest-sheet";
import type { AutoinvestRule, ExecutionPlanBinding, RuleBinding, RuleOccurrence, TradingPlan } from "@/lib/api/v1/contract";
import { rulePurchaseHref } from "@/lib/autoinvest/links";
import { ruleWhenLine, usdWord } from "@/lib/autoinvest/words";
import { companyFromTokenName } from "@/lib/stocks/shelf";
import { isScaledMultiplier, multiplierRatio } from "@/lib/stocks/units";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { classifySpotFill } from "@/lib/solana/fill-outcome";
import { mayOpenWallet } from "@/lib/solana/blockhash-life";
import type { LimitVenue } from "@/lib/solana/limits/model";
import { WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";
import { downloadReceipt } from "@/lib/solana/send-receipt-vault.client";
import { swapFailureCopy } from "@/lib/solana/swap-failure-copy";
import { tradingAvailability, type SpotMarket } from "@/lib/spot/markets";
import { claimLeg, claimedElsewhere, levelPastNow, markLegSent, settleLeg, unsendLeg, type LegAnswer } from "@/lib/spot/meme-exits";

import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { ShareTrade } from "../rewards/share-trade.tsx";
import { ConnectWalletButton } from "../wallet-gate.tsx";
import { reachAfter, useWalletReach } from "../wallet-reach.ts";
import {
  LIMIT_VENUE_NAMES,
  SOL_TOKEN,
  decimalText,
  fromView,
  impactOf,
  marketResult,
  pricesOf,
  receiptOfFill,
  referencePrice,
  reviewedFromLimit,
  reviewedFromOrder,
  ticketBalances,
  ticketMarketOf,
  ticketQuoteOf,
  toView,
  type EngineServiceFee,
  type Scale,
  type TicketToken,
} from "./core-ticket.ts";
import { FastTrade, TAB_ID, changePlans, readPlansNow, replacePlan, useTokenExitPlan, type ExitSaleRequest } from "./exit-plan.tsx";
import { limitFailureText, readLimitMarket, reviewLimit, signAndPlace, signableMsOfReview, type LimitMarket, type LimitReview } from "./limit-api.ts";
import { PlanChip, PlanReviewBlock, planRefusalSentence } from "./plan-review-block.tsx";
import { useQuickBuySums } from "./quick-buy.tsx";
import { QuoteAssetSwitch } from "./quote-asset-switch.tsx";
import { takeSideRequest } from "./side-request.ts";
import { StockReviewBlock, useStockAsset } from "./stock-context.tsx";
import { RiskLine } from "./risk-line.tsx";
import { SwapDeadline } from "./swap-deadline.tsx";
import { knownOutcome } from "./ticket-outcome.ts";
import { formatAmount, formatPrice, formatUsdPrice, rawToNumber } from "./spot-format.ts";
import { useSpotMarket, type HoldingsState, type SpotHolding } from "./use-spot-data.ts";
import { SPOT_QUOTE_ASSETS, plainAmount, useSpotTicket, type SpotQuoteAsset, type SpotSide } from "./use-spot-ticket.ts";

import limitStyles from "./limit-ticket.module.css";
import styles from "./spot.module.css";

/* Quotes a dollar is one of: the ticket's price in them is the strip's dollar price, so the ticket's head prints none of
   its own (UX-254); in SOL it is a price of its own unit and stays. */
const USD_QUOTES: ReadonlySet<string> = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);

function holdingOf(holdings: HoldingsState, mint: string): SpotHolding | null {
  if (!holdings.value) return null;
  if (mint === WRAPPED_SOL_MINT) return holdings.value.find((row) => row.kind === "NATIVE_SOL") ?? null;
  return holdings.value.find((row) => row.mint === mint) ?? null;
}

/** «Щотижня · ср о 19:00» → «щотижня · ср о 19:00»: only the first letter, so «Wed» keeps its own. */
function lowerFirst(text: string): string {
  return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

/** A clock for the ticket: the quote's freshness and the Review's seconds are read against it. */
function useNow(stepMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(timer);
  }, [stepMs]);
  return now;
}

/** The frame's density (its «Налаштувати»): compact sets the core's ticket tight and shows its keys — one face, two densities. */
function useShellDensity(): "regular" | "compact" {
  const [density, setDensity] = useState<"regular" | "compact">("regular");
  useEffect(() => {
    const shell = document.querySelector(".ryntra-shell");
    if (!shell) return undefined;
    const read = () => setDensity(shell.getAttribute("data-density") === "compact" ? "compact" : "regular");
    read();
    const observer = new MutationObserver(read);
    observer.observe(shell, { attributes: true, attributeFilter: ["data-density"] });
    return () => observer.disconnect();
  }, []);
  return density;
}

function engineServiceFee(order: object | null | undefined): EngineServiceFee | null {
  const fee = order ? (order as { ryntraFee?: unknown }).ryntraFee : null;
  if (!fee || typeof fee !== "object") return null;
  const candidate = fee as Partial<EngineServiceFee>;
  if (typeof candidate.basisPoints !== "number" || typeof candidate.mechanism !== "string") return null;
  return { mechanism: candidate.mechanism, basisPoints: candidate.basisPoints, asset: candidate.asset ?? null, decimals: candidate.decimals ?? null, amountRaw: candidate.amountRaw ?? null };
}

type LimitPhase =
  | Readonly<{ kind: "EDIT" }>
  | Readonly<{ kind: "REVIEWING" }>
  | Readonly<{ kind: "REVIEW"; review: LimitReview; at: number; reviewed: TicketReviewed }>
  | Readonly<{ kind: "SIGNING"; review: LimitReview; at: number; reviewed: TicketReviewed }>
  | Readonly<{ kind: "PLACED"; review: LimitReview; signature: string; settled: boolean; reviewed: TicketReviewed; at: number }>;

/**
 * Spot's ticket — «Купити / Продати» of the core (B16 on SOL-T1): the one ticket of Ryntra, market and limit, the
 * amount in the token or in dollars, the person's quick sums, the share of what is available, the price, the impact,
 * every cost and the least that arrives before the signature, then the core's Review and receipt.
 *
 * The money flow underneath is the one Spot already had and is not changed here: a market order is the
 * engine's swap — the live quote, the exact order the Review shows and the wallet signs, the signature's checks, one
 * execute, recovery by the signature (`use-spot-ticket.ts`); a limit order is the limits route's Review and relay
 * (`limit-api.ts`) on Jupiter or a Meteora DLMM bin. Only the face is the core's.
 *
 * Around the ticket stays what is Spot's own: the plan the order is made under and its judgement, an autoinvest rule's
 * purchase and «Регулярно», the wallet's position here with its «Продати», a tokenized stock's units and «Перевірка»,
 * the issuer's terms, and a token Ryntra no longer supports.
 */
export function SpotTicket({
  market,
  fallback,
  holdings,
  onSettled,
  onRefresh,
  planBinding = null,
  proven = false,
  proving = false,
  onProve,
  onLeavePlan,
  initialSide = null,
  initialAmount = null,
  initialQuick = null,
  ruleBinding = null,
  onRuleBuy,
  onLeaveRule,
  sideRequest = null,
  priceObservedAt = null,
  priceStale = false,
  onBeforeConnect,
  history = null,
  orders = null,
}: {
  market: SpotMarket | null;
  fallback: Readonly<{ mint: string; symbol: string; decimals: number | null; icon: string | null; category: SpotMarket["category"] }> | null;
  holdings: HoldingsState;
  onSettled: () => void;
  onRefresh: () => void;
  /** The Trading Plan the address named (`?plan=&v=`), or null: a plain Spot ticket. */
  planBinding?: ExecutionPlanBinding | null;
  proven?: boolean;
  proving?: boolean;
  onProve?: () => void;
  onLeavePlan?: () => void;
  /** The side and the sum an asset page carried in, the ticket's opening state only. */
  initialSide?: SpotSide | null;
  initialAmount?: string | null;
  /** A quick sum tapped on a Pulse card, with the token it was tapped for: tapped here once, on that token only. */
  initialQuick?: Readonly<{ usd: number; mint: string }> | null;
  /** 1.31.0: the rule's reminder the address named (`?rule=&due=`), or null: the ticket is the rule's purchase while it is open. */
  ruleBinding?: RuleBinding | null;
  onRuleBuy?: (binding: RuleBinding) => void;
  onLeaveRule?: () => void;
  /** B16: the phone's pinned «Купити | Продати» opens the ticket on that side — the side's own press, by its rules. */
  sideRequest?: Readonly<{ side: SpotSide; at: number }> | null;
  /** B14: the phone's sheet closes before the header's wallet panel opens, so the panel is not hidden under it. */
  onBeforeConnect?: () => void;
  /** When the page last read the market's price (its read, not the provider's stamp): the reference's age. */
  priceObservedAt?: string | null;
  /** The server says the price it answered with is stale: an exit plan does not move on it. */
  priceStale?: boolean;
  /** The wallet's history of swaps and its limit orders, as the page read them: what they say of a signature the
      ticket could not call final (UX-256, `knownOutcome`). */
  history?: readonly Readonly<{ signature?: string | null; outcome: string }>[] | null;
  orders?: readonly Readonly<{ placeSignature: string | null; state: string }>[] | null;
}) {
  const { text, locale } = useSolanaI18n();
  const lang = locale === "uk" ? "uk" : "en";
  const { connection } = useSolanaConnection();
  const { openInWallet, reach } = useWalletReach();
  const now = useNow(1_000);
  const density = useShellDensity();
  const [draft, setDraft] = useState<TicketDraft>(() => newDraft({ side: initialSide === "SELL" ? "sell" : "buy", amount: initialAmount ?? "" }));
  const side: SpotSide = draft.side === "sell" ? "SELL" : "BUY";
  /* A carried sum survives the first market's arrival (the market reads after the ticket mounts); every later change of market is a new ticket. */
  const carriedAmount = useRef(initialAmount !== null);
  const [quoteMint, setQuoteMint] = useState<string>(SPOT_QUOTE_ASSETS[0].mint);
  /* «Регулярно» (1.31.0): the rule that reminds of the purchase, in the ticket's place while it is open. */
  const [recurring, setRecurring] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [ruleBusy, setRuleBusy] = useState(false);
  const rulesRead = useAutoinvestRules(proven);
  const [clockMs, setClockMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  /* The plan, read behind the wallet's proof — the same read My strategies makes. A plan is BUY in USDC by
     construction, so the ticket is set to that, the version's sized spend fills an empty amount once, and the binding
     goes with the order. What the server decides is on the Review. */
  const [planRead, setPlanRead] = useState<{ status: "idle" | "loading" | "ready" | "notFound" | "failed"; plan: TradingPlan | null }>({ status: "idle", plan: null });
  useEffect(() => {
    if (!planBinding || !proven) {
      setPlanRead({ status: "idle", plan: null });
      return;
    }
    let cancelled = false;
    setPlanRead({ status: "loading", plan: null });
    void (async () => {
      try {
        const response = await fetch(`/api/v1/plans/${encodeURIComponent(planBinding.planId)}`, { headers: { accept: "application/json", "X-Ryntra-API": "1" } });
        if (cancelled) return;
        if (response.status === 404) {
          setPlanRead({ status: "notFound", plan: null });
          return;
        }
        if (!response.ok) {
          setPlanRead({ status: "failed", plan: null });
          return;
        }
        const body = (await response.json()) as { plan: TradingPlan };
        if (cancelled) return;
        setPlanRead({ status: "ready", plan: body.plan });
        setQuoteMint(SPOT_QUOTE_ASSETS[0].mint);
        setDraft((current) => ({ ...current, side: "buy", type: "market", unit: current.amount.trim() === "" ? "token" : current.unit, amount: current.amount.trim() === "" ? body.plan.current.sizing.notionalUsd.toFixed(2) : current.amount }));
      } catch {
        if (!cancelled) setPlanRead({ status: "failed", plan: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planBinding, proven]);
  const plan = planRead.plan;
  const planState: "loading" | "ready" | "unproven" | "notFound" | "wrongMarket" | "inactive" | null = !planBinding
    ? null
    : !proven
      ? "unproven"
      : planRead.status === "notFound" || planRead.status === "failed"
        ? "notFound"
        : !plan
          ? "loading"
          : plan.asset.mint !== (market?.mint ?? fallback?.mint ?? null)
            ? "wrongMarket"
            : plan.status !== "active" || plan.version !== planBinding.version
              ? "inactive"
              : "ready";
  const underPlan = planState === "ready";

  /* Every market trades. A tokenized stock or RWA carries its issuer in one line under the action, because whose terms
     apply is the one fact about it the chain does not say. */
  const availability = tradingAvailability({ category: market?.category ?? fallback?.category ?? null, mint: market?.mint ?? fallback?.mint ?? undefined, issuer: market?.issuer ?? null });
  const issuerLine = availability.allowed && availability.notice === "ISSUER_TERMS" ? (market?.issuer?.label ?? null) : null;
  const baseMint = market?.mint ?? fallback?.mint ?? null;
  const baseSymbol = market?.symbol ?? fallback?.symbol ?? "";

  /* The reminder the address named: the rule must be the wallet's, its token this market, and the reminder open now —
     then the ticket is its purchase. Anything else is said in one line, and the ticket offers no plain order in its
     place until the person leaves the rule. */
  const boundRule: AutoinvestRule | null = ruleBinding ? (rulesRead.state.rules.find((rule) => rule.id === ruleBinding.ruleId) ?? null) : null;
  const boundOccurrence: RuleOccurrence | null = boundRule && ruleBinding ? occurrenceAt(boundRule, ruleBinding.dueAt) : null;
  const ruleState: "unproven" | "loading" | "ready" | "gone" | "wrongMarket" | "bought" | "pending" | "deferred" | "closed" | null = !ruleBinding
    ? null
    : !proven
      ? "unproven"
      : rulesRead.state.status === "idle" || rulesRead.state.status === "loading"
        ? "loading"
        : !boundRule
          ? "gone"
          : boundRule.asset.mint !== baseMint
            ? "wrongMarket"
            : boundOccurrence && reminderOpenNow(boundRule, clockMs)?.dueAt === boundOccurrence.dueAt
              ? "ready"
              : boundOccurrence?.state === "bought"
                ? "bought"
                : boundOccurrence?.state === "pending"
                  ? "pending"
                  : boundOccurrence?.state === "deferred"
                    ? "deferred"
                    : "closed";
  const underRule = ruleState === "ready";
  const bound = underPlan || underRule;
  /* A plan or a rule binds the ticket to its market purchase: a limit or «Регулярно» left open under one goes back. */
  useEffect(() => {
    if (bound && draft.type === "limit") setDraft((current) => ({ ...current, type: "market" }));
    if (underRule) setRecurring(false);
  }, [bound, underRule, draft.type]);
  const ruleSumUsd = underRule && boundRule ? purchaseSumUsd(boundRule, boundOccurrence) : null;
  const tokenRule = baseMint && rulesRead.state.status === "ready" ? ruleForMint(rulesRead.state.rules, baseMint) : null;
  const baseIcon = market?.icon ?? fallback?.icon ?? null;
  const baseHolding = baseMint ? holdingOf(holdings, baseMint) : null;
  const baseDecimals = baseHolding?.decimals ?? market?.decimals ?? fallback?.decimals ?? null;

  /* A tokenized stock with the Scaled UI Amount extension: the wallet, the venue's price and every figure on the Stocks
     page count the scaled unit (one base token stands for `multiplier` of them). A market order is drawn in that unit
     and the routes are handed the raw amount behind it; a limit order speaks the base token's own unit, as its route
     does. */
  const isStockMarket = market?.category === "stock";
  const stockAsset = useStockAsset(isStockMarket ? baseMint : null);
  const unitMultiplier = stockAsset?.chainMultiplier?.current ?? stockAsset?.row.multiplier?.current ?? null;
  const stockScale: Scale = useMemo(() => (isScaledMultiplier(unitMultiplier) ? multiplierRatio(unitMultiplier) : null), [unitMultiplier]);
  const limit = draft.type === "limit";
  const scale: Scale = limit ? null : stockScale;

  /* The market cannot be its own quote: a person looking at USDC pays in SOL. */
  const quote = useMemo<SpotQuoteAsset>(() => {
    const chosen = SPOT_QUOTE_ASSETS.find((asset) => asset.mint === quoteMint) ?? SPOT_QUOTE_ASSETS[0];
    if (chosen.mint !== baseMint) return chosen;
    return SPOT_QUOTE_ASSETS.find((asset) => asset.mint !== baseMint) ?? SPOT_QUOTE_ASSETS[0];
  }, [baseMint, quoteMint]);

  /* A new market is a new ticket. */
  useEffect(() => {
    if (carriedAmount.current) {
      if (baseMint === null) return;
      carriedAmount.current = false;
      return;
    }
    setDraft((current) => ({ ...current, amount: "", price: "", tp: "", sl: "" }));
    setRecurring(false);
  }, [baseMint]);

  /* The rule's purchase is a purchase of its sum in USDC: the side, the asset paid with and the sum are set and held —
     after the new market's reset above, which runs in the same commit. */
  useEffect(() => {
    if (ruleSumUsd === null) return;
    setQuoteMint(SPOT_QUOTE_ASSETS[0].mint);
    /* The sum as typed by hand: «5», «5.50» — never «5.00». */
    setDraft((current) => ({ ...current, side: "buy", type: "market", unit: "token", amount: Number.isInteger(ruleSumUsd) ? String(ruleSumUsd) : ruleSumUsd.toFixed(2) }));
  }, [ruleSumUsd, baseMint]);

  /* ----------------------------------------------------------------- what the core's ticket reads */

  const baseToken: TicketToken | null = baseMint && baseDecimals !== null ? { mint: baseMint, symbol: baseSymbol || "?", decimals: baseDecimals } : null;
  const quoteToken: TicketToken = { mint: quote.mint, symbol: quote.symbol, decimals: quote.decimals };
  const payToken = side === "BUY" ? quoteToken : baseToken;
  const getToken = side === "BUY" ? baseToken : quoteToken;

  /* Dollars per unit: the wallet's catalogue first, the market's own figure for the base, else a read of the quote's
     and SOL's market — a guest's dollar amounts and every cost in dollars need them too. */
  const catalogUsd = (mint: string): number | null => {
    const price = holdingOf(holdings, mint)?.catalog?.usdPrice;
    const value = price ? Number(price) : Number.NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  const baseUsd = market?.price ?? (baseMint ? catalogUsd(baseMint) : null);
  const knownSol = catalogUsd(WRAPPED_SOL_MINT) ?? (baseMint === WRAPPED_SOL_MINT ? baseUsd : null);
  const knownQuote = quote.mint === WRAPPED_SOL_MINT ? knownSol : (catalogUsd(quote.mint) ?? (baseMint === quote.mint ? baseUsd : null));
  const solRead = useSpotMarket(knownSol === null ? WRAPPED_SOL_MINT : null);
  const quoteRead = useSpotMarket(knownQuote === null && quote.mint !== WRAPPED_SOL_MINT ? quote.mint : null);
  const solUsd = knownSol ?? (solRead.value?.mint === WRAPPED_SOL_MINT ? solRead.value.price : null);
  const quoteUsd = quote.mint === WRAPPED_SOL_MINT ? solUsd : (knownQuote ?? (quoteRead.value?.mint === quote.mint ? quoteRead.value.price : null));
  const priceAt = (priceObservedAt ? Date.parse(priceObservedAt) : Number.NaN) || (market?.updatedAt ? Date.parse(market.updatedAt) : Number.NaN) || now;
  /* A stock's dollars are per the unit the ticket counts in: a base token's price over its multiplier. */
  const baseViewUsd = baseUsd !== null && scale ? (baseUsd * Number(scale.den)) / Number(scale.num) : baseUsd;
  const prices = useMemo(
    () =>
      pricesOf(
        [
          { mint: baseMint ?? "", usd: baseViewUsd },
          { mint: quote.mint, usd: quoteUsd },
          { mint: WRAPPED_SOL_MINT, usd: solUsd },
        ].filter((entry) => entry.mint !== ""),
        "Jupiter",
        priceAt,
      ),
    [baseMint, baseViewUsd, quote.mint, quoteUsd, solUsd, priceAt],
  );
  const reference = referencePrice(baseViewUsd, quoteUsd);

  /* The market's price step, from the first price this pair was read at: every price of one market lines up. */
  const firstPrice = useRef<{ key: string; price: number | null }>({ key: "", price: null });
  const pairKey = `${baseMint ?? ""}/${quote.mint}/${scale ? "s" : ""}`;
  if (firstPrice.current.key !== pairKey || (firstPrice.current.price === null && reference !== null)) firstPrice.current = { key: pairKey, price: reference === null ? null : Number(reference) };
  const ticketMarket = useMemo(() => (baseToken ? ticketMarketOf(baseToken, quoteToken, firstPrice.current.price) : null), [baseToken?.mint, baseToken?.symbol, baseToken?.decimals, quoteToken.mint, pairKey, firstPrice.current.price]); // eslint-disable-line react-hooks/exhaustive-deps

  const balances = useMemo(() => {
    if (!connection || !holdings.value) return connection ? {} : null;
    return ticketBalances(
      holdings.value.map((row) => ({ mint: row.kind === "NATIVE_SOL" ? WRAPPED_SOL_MINT : (row.mint ?? ""), spendableRaw: row.spendableRaw, decimals: row.decimals })).filter((row) => row.mint !== ""),
      (mint) => (mint === baseMint ? scale : null),
    );
  }, [connection, holdings.value, baseMint, scale]);

  /* One signature's network fee of SOL is kept back: a wallet with no SOL hears «add SOL for the network fee» on the
     ticket, as before, rather than from the order route. */
  const paysInSol = (side === "BUY" ? quote.mint : baseMint) === WRAPPED_SOL_MINT;
  const gas = useMemo(() => ({ token: { asset: SOL_TOKEN.mint, symbol: SOL_TOKEN.symbol, decimals: SOL_TOKEN.decimals }, reserve: { units: paysInSol ? "0" : "5000", asset: SOL_TOKEN.mint, decimals: SOL_TOKEN.decimals } }), [paysInSol]);

  /* The form's own figures first, without a quote: what is paid, in the pay token, for the engine to be asked about. */
  const baseInput: Omit<TicketInput, "quote" | "quoteFailed" | "swap" | "limit"> | null = ticketMarket
    ? { market: ticketMarket, draft, balances: balances ?? null, prices, reference: reference ? { price: reference, source: "Jupiter", at: priceAt } : null, gas, fees: [], venue: limit ? LIMIT_VENUE_NAMES.trigger : "Jupiter", venueId: limit ? undefined : "jupiter", maxLegs: 1, now }
    : null;
  const on = { status: "on" } as const;
  const pre = baseInput ? ticketModel({ ...baseInput, swap: on, limit: on }, lang) : null;
  const paidView = pre?.paid ? BigInt(pre.paid.units) : null;
  const paidRaw = paidView === null ? null : side === "SELL" ? fromView(paidView, scale) : paidView;
  const liveAmount = !limit && paidRaw !== null && paidRaw > 0n && payToken ? plainAmount(paidRaw.toString(), payToken.decimals) : "";
  /* The amount the exact order is asked for is held from the press of «Переглянути» until the ticket is back on its
     form: a sum in dollars counts in tokens by a price read every few seconds, and a new price must never change — and
     so drop — a Review or a signature on its way. */
  const [heldAmount, setHeldAmount] = useState<string | null>(null);
  const hookAmount = heldAmount ?? liveAmount;

  /* The level whose sale the ticket holds: kept while the ticket's sale is exactly the level's amount — through a
     Review asked again after a refusal — and let go when the order changes. Every signature of that sale is tied to the
     level while it is ready; a sale that is not the level's is never named as the level's. */
  const [exitIntent, setExitIntent] = useState<Readonly<{ planId: string; legId: string; amount: string; raw: string; owner: string; label: string }> | null>(null);
  /* The signature this tab last tied to a level, with the failure the ticket showed at that moment: only a new refusal
     after it, saying the bytes never crossed the submit boundary, makes that level ready again. */
  const exitLinked = useRef<Readonly<{ signature: string; failure: unknown }> | null>(null);
  /* Signatures whose answer this tab has settled: never tied to a level again. */
  const exitSettled = useRef(new Set<string>());

  const ticket = useSpotTicket({
    connection,
    side,
    baseMint,
    baseDecimals,
    baseSymbol,
    quote,
    amount: hookAmount,
    planBinding: underPlan ? planBinding : null,
    ruleBinding: underRule ? ruleBinding : null,
    text,
    onSettled: () => {
      onSettled();
      void rulesRead.reload();
    },
    onRefresh,
    /* SOL-R2: a level's sale, signed — the level waits for the chain's answer before the bytes are sent, so no tab offers
       it again meanwhile. Only a sale of exactly the level's raw units is tied to it. */
    onSigned: (signed) => {
      const intent = exitIntent;
      if (!intent || connection?.address !== intent.owner || signed.inputMint !== baseMint || signed.inAmountRaw !== intent.raw || exitSettled.current.has(signed.signature)) return;
      exitLinked.current = { signature: signed.signature, failure: null };
      changePlans((current) => {
        const plan = current.find((entry) => entry.id === intent.planId && entry.owner === intent.owner);
        return plan ? replacePlan(current, markLegSent(plan, intent.legId, { signature: signed.signature, requestId: signed.requestId, sentRaw: BigInt(intent.raw), tab: TAB_ID, now: Date.now() })) : current;
      });
    },
  });
  const { quoted, phase, prepared, settled, attempt } = ticket;

  /* The engine sets the price tolerance of each quote (its route decides it); the ticket shows the one it was given. */
  useEffect(() => {
    const bps = quoted?.order.slippageBps;
    if (typeof bps === "number" && bps !== draft.slippageBps) setDraft((current) => ({ ...current, slippageBps: bps }));
  }, [quoted?.order.slippageBps, draft.slippageBps]);
  /* When each quote arrived, by its request: the quote's age in Review reads from it. */
  const arrivals = useRef(new Map<string, number>());
  const arrivalOf = (requestId: string): number => {
    const known = arrivals.current.get(requestId);
    if (known !== undefined) return known;
    const at = Date.now();
    arrivals.current.set(requestId, at);
    return at;
  };

  const blockedPair = useRef<string | null>(null);
  if (quoted) blockedPair.current = quoted.verdict.verdict === "BLOCKED" ? `${quoted.order.inputMint}:${quoted.order.outputMint}:${quoted.order.inAmountRaw}` : null;
  const blocked = quoted ? quoted.verdict.verdict === "BLOCKED" : blockedPair.current === `${ticket.inputMint}:${ticket.outputMint}:${paidRaw?.toString() ?? ""}`;
  const quoteFailureRetryable = ticket.quoteFailure ? swapFailureCopy(ticket.quoteFailure.code, text).retryable : null;

  const ticketQuote =
    !limit && quoted && ticketMarket && payToken && getToken
      ? ticketQuoteOf({
          order: quoted.order,
          serviceFee: engineServiceFee(quoted.order),
          side: draft.side,
          market: ticketMarket,
          pay: payToken,
          get: getToken,
          scale,
          paidView,
          expiresAt: Date.parse(quoted.expiresAt),
          at: arrivalOf(quoted.order.requestId),
          slippageBps: quoted.order.slippageBps,
        })
      : null;

  /* ----------------------------------------------------------------- the limit order */

  const [limitVenue, setLimitVenue] = useState<LimitVenue>("trigger");
  const [limitMarket, setLimitMarket] = useState<LimitMarket | null>(null);
  const [limitPhase, setLimitPhase] = useState<LimitPhase>({ kind: "EDIT" });
  const [limitFailure, setLimitFailure] = useState<string | null>(null);
  /* The pair's price now and whether a Meteora pool takes limits — read again on a new pair, only while a limit is open. */
  useEffect(() => {
    if (!limit || !baseMint) return undefined;
    let cancelled = false;
    setLimitMarket(null);
    setLimitPhase({ kind: "EDIT" });
    void readLimitMarket({ owner: connection?.address ?? null, baseMint, quoteMint: quote.mint }).then((answer) => {
      if (cancelled || !answer.ok) return;
      setLimitMarket(answer.value);
      if (!answer.value.dlmm.available) setLimitVenue("trigger");
    });
    return () => {
      cancelled = true;
    };
  }, [limit, baseMint, quote.mint, connection?.address]);
  const dlmmAvailable = limitMarket?.dlmm.available === true;
  const limitBusy = limitPhase.kind === "REVIEWING" || limitPhase.kind === "SIGNING";

  const reviewLimitOrder = useCallback(
    async (refreshed = false) => {
      if (!connection || !baseMint || !pre?.paid || !pre.limitPrice || !ticketMarket || !payToken || !getToken) return;
      /* At or through the market — judged against the same price the ticket shows and measures its distance from. */
      if (pre.crosses) {
        setLimitFailure(text("This price is already the market: use a market order."));
        return;
      }
      setLimitFailure(null);
      setLimitPhase({ kind: "REVIEWING" });
      const answer = await reviewLimit({
        owner: connection.address,
        venue: limitVenue,
        side: draft.side,
        baseMint,
        quoteMint: quote.mint,
        amount: plainAmount(pre.paid.units, payToken.decimals),
        price: priceText(pre.limitPrice),
        quoteUsd: limitMarket?.quoteUsd ?? null,
      });
      if (!answer.ok) {
        setLimitFailure(limitFailureText(answer, text, text("The order could not be prepared. Nothing was sent.")));
        setLimitPhase({ kind: "EDIT" });
        return;
      }
      const review = answer.value.review;
      const reviewed = reviewedFromLimit({ review, market: ticketMarket, pay: payToken, get: getToken, scale: null, prices, price: parsePriceOr(review.price, pre.limitPrice) });
      setLimitPhase({ kind: "REVIEW", review, at: Date.now(), reviewed });
      if (refreshed) setLimitFailure(text("The Review was built again — its bytes live about 30 seconds. Check it and sign."));
    },
    [baseMint, connection, draft.side, getToken, limitMarket, limitVenue, payToken, pre?.crosses, pre?.limitPrice, pre?.paid, prices, quote.mint, text, ticketMarket],
  );

  const signLimitOrder = useCallback(
    async (review: LimitReview, at: number, reviewed: TicketReviewed) => {
      if (!connection) return;
      /* AG-1: the Review has no clock of its own, but its bytes live ~30 s (`lib/solana/blockhash-life.ts`). Read for
         longer, it is built again here and the person signs the fresh one — never bytes the network would refuse. */
      if (!mayOpenWallet({ receivedAtMs: at, signableMs: signableMsOfReview(review) })) {
        await reviewLimitOrder(true);
        return;
      }
      setLimitFailure(null);
      setLimitPhase({ kind: "SIGNING", review, at, reviewed });
      const placed = await signAndPlace({ wallet: connection.wallet, address: connection.address }, review, at);
      if (!placed.ok && placed.code === "REVIEW_AGED") {
        await reviewLimitOrder(true);
        return;
      }
      if (!placed.ok) {
        setLimitFailure(limitFailureText(placed, text, text("The order was not placed.")));
        setLimitPhase({ kind: "REVIEW", review, at, reviewed });
        return;
      }
      setLimitPhase({ kind: "PLACED", review, signature: placed.value.signature, settled: placed.value.settled, reviewed, at: Date.now() });
      onSettled();
      onRefresh();
    },
    [connection, onRefresh, onSettled, reviewLimitOrder, text],
  );

  /* ----------------------------------------------------------------- the stage and its facts */

  const busy = phase === "PREPARING" || phase === "SIGNING" || phase === "EXECUTING" || phase === "RECOVERING";
  const recovering = attempt !== null || phase === "EXECUTING" || phase === "RECOVERING" || phase === "RECOVERY" || phase === "SETTLED";
  const reviewing = !limit && prepared !== null && (phase === "REVIEW" || phase === "SIGNING" || phase === "PREPARING");
  const lockedOnly = !limit && phase === "REVIEW" && prepared === null && ticket.lockedReview !== null;

  /* What the person agreed to on the exact order: held from the Review through the result, never the live form. */
  const [heldReview, setHeldReview] = useState<TicketReviewed | null>(null);
  const preparedReviewed = useMemo(() => {
    if (!prepared || !ticketMarket || !payToken || !getToken) return null;
    const ready = ticket.preparedReadiness?.ready === true;
    const reviewedOrder = reviewedFromOrder({
      order: prepared.order,
      serviceFee: engineServiceFee(prepared.order),
      side: draft.side,
      market: ticketMarket,
      pay: payToken,
      get: getToken,
      scale,
      prices,
      impact: null,
      /* A Review that cannot be signed any more (its window, bytes the wallet changed) reads as stale: no signature, a new quote. */
      expiresAt: ready ? Date.parse(prepared.expiresAt) : 0,
      at: arrivalOf(prepared.order.requestId),
    });
    /* The impact the form showed, on the exact order: the same arithmetic of the core against the same reference. */
    const ref = reference ? parsePrice(reference) : null;
    const computed = typeof ref === "bigint" ? impactBps(draft.side, reviewedOrder.paid, reviewedOrder.expected, reviewedOrder.fees, ref, ticketMarket) : null;
    return { ...reviewedOrder, impact: computed ?? impactOf(prepared.order.priceImpactPct) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, ticketMarket, payToken?.mint, getToken?.mint, scale, prices, reference, draft.side, ticket.preparedReadiness?.ready]);
  /* The market and unit that Review was drawn in: the result names the trade that was signed, not the market now open. */
  const [heldMarket, setHeldMarket] = useState<Readonly<{ market: TicketMarket; scale: Scale }> | null>(null);
  useEffect(() => {
    if (!preparedReviewed || !ticketMarket) return;
    setHeldReview(preparedReviewed);
    setHeldMarket({ market: ticketMarket, scale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparedReviewed]);
  useEffect(() => {
    if (recovering || reviewing) return;
    setHeldReview(null);
    setHeldMarket(null);
  }, [recovering, reviewing]);
  /* A new market after a finished trade is a new ticket; a trade still being read keeps its answer (and its market). */
  const settledPhase = useRef(phase);
  settledPhase.current = phase;
  const resetTicket = ticket.reset;
  useEffect(() => {
    if (settledPhase.current === "SETTLED") resetTicket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseMint]);

  const outcome = settled ? classifySpotFill(settled) : null;
  const settledSentence = (() => {
    if (!outcome) return settled?.recovery ?? null;
    switch (outcome.kind) {
      case "FILLED":
        if (outcome.note === "BELOW_MINIMUM") return text("Less arrived than the reviewed minimum. The receipt keeps the reviewed and the settled figures side by side.");
        if (outcome.note === "NOT_AS_REVIEWED") return text("The chain's figures differ from the Review. The receipt keeps both.");
        return null;
      case "NOTHING_HAPPENED":
        return outcome.state === "EXPIRED_BEFORE_SUBMIT" || outcome.state === "UNKNOWN_TO_CHAIN"
          ? text("The transaction was never sent and the block it needed has passed. Nothing moved. You can trade again.")
          : text("The transaction was sent but never reached the chain, and the block it needed has passed. Nothing moved, and nothing can now. You can trade again.");
      case "NOT_FILLED":
        return text("The network rejected the transaction. Only the network fee was spent; what you were spending did not move.");
      default:
        return settled?.recovery ?? null;
    }
  })();
  const resultTime = new Date(now).toLocaleTimeString(locale === "uk" ? "uk-UA" : "en-US", { hour: "2-digit", minute: "2-digit" });
  const signature = settled?.signature ?? attempt?.signature ?? null;
  const marketReceipt = settled && outcome?.kind === "FILLED" && heldReview && connection ? receiptOfFill({ settled, reviewed: heldReview, scale: heldMarket?.scale ?? scale, signer: connection.address, at: now, chainFee: settledServiceFee(settled) }) : undefined;
  const marketOutcome: TicketResult | null = !limit && recovering
    ? marketResult({
        phase: phase === "IDLE" || phase === "REVIEW" || phase === "PREPARING" ? "RECOVERY" : phase,
        kind: outcome?.kind ?? null,
        signature,
        time: resultTime,
        receipt: marketReceipt,
        reason: settledSentence ?? (phase === "RECOVERY" || attempt ? (settled?.recovery ?? text("The outcome is not yet known. Keep checking this transaction; do not send another.")) : undefined),
      })
    : null;

  let stage: "form" | "review" | "result" = "form";
  let reviewed: TicketReviewed | undefined;
  let result: TicketResult | undefined;
  if (limit) {
    if (limitPhase.kind === "REVIEW" || limitPhase.kind === "SIGNING") {
      stage = "review";
      reviewed = limitPhase.reviewed;
    } else if (limitPhase.kind === "PLACED") {
      stage = "result";
      reviewed = limitPhase.reviewed;
      result = { state: limitPhase.settled ? "resting" : "sent", tx: limitPhase.signature, time: new Date(limitPhase.at).toLocaleTimeString(locale === "uk" ? "uk-UA" : "en-US", { hour: "2-digit", minute: "2-digit" }), signed: true };
    }
  } else if (marketOutcome) {
    stage = "result";
    reviewed = heldReview ?? undefined;
    result = marketOutcome;
  } else if (reviewing || lockedOnly) {
    stage = "review";
    reviewed = reviewing ? (preparedReviewed ?? heldReview ?? undefined) : undefined;
  }

  /* ----------------------------------------------------------------- the person's acts */

  /* The draft as the person changes it: under a plan the order stays a purchase at the market; under a rule's reminder
     nothing is typed over (the ticket is read-only below). */
  const referenceE18 = useMemo(() => {
    const parsed = reference ? parsePrice(reference) : null;
    return typeof parsed === "bigint" ? parsed : null;
  }, [reference]);
  /* A limit at the market is a market order: until the person sets the price, it stands one per cent from the market on
     their side — a new limit, a change of side, a market that moved. Set by hand (typed, stepped, a chip), it stays. */
  const [limitPriceSet, setLimitPriceSet] = useState(false);
  const stepFromMarket = useCallback(
    (side: TicketDraft["side"]) => (referenceE18 !== null && ticketMarket ? legFromEntry(referenceE18, side === "buy" ? -1 : 1, ticketMarket, lang) : null),
    [referenceE18, ticketMarket, lang],
  );
  const changeDraft = useCallback(
    (next: TicketDraft) => {
      if (underPlan && (next.side === "sell" || next.type === "limit")) return;
      setLimitFailure(null);
      if (next.type === "limit") {
        const entering = draft.type !== "limit";
        const byHand = !entering && next.price !== draft.price;
        if (entering) setLimitPriceSet(false);
        if (byHand) setLimitPriceSet(true);
        if (entering || (!byHand && !limitPriceSet && next.side !== draft.side)) {
          const price = stepFromMarket(next.side);
          setDraft(price === null ? next : { ...next, price });
          return;
        }
      }
      setDraft(next);
    },
    [underPlan, draft.type, draft.price, draft.side, limitPriceSet, stepFromMarket],
  );
  useEffect(() => {
    if (!limit || limitPriceSet) return;
    const price = stepFromMarket(draft.side);
    if (price !== null && price !== draft.price) setDraft((current) => ({ ...current, price }));
  }, [limit, limitPriceSet, stepFromMarket, draft.side, draft.price]);
  useEffect(() => {
    setLimitPriceSet(false);
  }, [baseMint, quote.mint]);
  /* How far the limit stands from the market, and a step to 1, 2 or 5 % on the person's side of it. */
  const limitDistance = limit && pre?.limitPrice && reference ? (Number(priceText(pre.limitPrice)) / Number(reference) - 1) * 100 : null;
  const setLimitOffset = (percent: number) => {
    if (referenceE18 === null || !ticketMarket) return;
    setLimitFailure(null);
    setLimitPriceSet(true);
    setDraft((current) => ({ ...current, price: legFromEntry(referenceE18, percent, ticketMarket, lang) }));
  };

  const askReview = ticket.review;
  const openReview = useCallback(() => {
    setHeldAmount(liveAmount);
    void askReview();
  }, [askReview, liveAmount]);
  /* Back on the form, nothing on its way: the amount follows the field again. */
  useEffect(() => {
    if (phase === "IDLE" && attempt === null && heldAmount !== null) setHeldAmount(null);
  }, [phase, attempt, heldAmount]);
  const onReview = () => {
    if (limit) {
      void reviewLimitOrder();
      return;
    }
    if (busy || attempt) return;
    if (ticket.quoteFailure) ticket.refreshQuote();
    openReview();
  };

  /* A press of the phone's pinned «Купити | Продати», taken once: the market order on that side — never while an order
     is on its way or on its Review, never a sale under a plan or a rule's reminder. */
  const handledSideRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!sideRequest || handledSideRequest.current === sideRequest.at) return;
    handledSideRequest.current = sideRequest.at;
    const taken = takeSideRequest(sideRequest.side, { side, busy: busy || limitBusy, review: stage === "review", bound });
    if (taken === "ignore") return;
    setRecurring(false);
    setDraft((current) => ({ ...current, type: "market", ...(taken === "switch" ? { side: sideRequest.side === "SELL" ? "sell" : "buy", amount: "", tp: "", sl: "" } : {}) }));
  }, [sideRequest, busy, limitBusy, stage, bound, side]);

  /* A Pulse card's quick sum is this ticket's own tap, once: the sum goes in as dollars and the exact Review opens on it
     as soon as the ticket can judge it — the wallet read, the amount valid, the balance enough. The tap never signs; a
     ticket that could not judge it within ten seconds leaves the sum in the field and the Review to the person. */
  /* SOL-R2: the same one tap from «Швидка торгівля» beside the ticket — a quick sum, a share of the position, or the
     sale of an exit plan's level — sets the market order and opens its exact Review the same way. A tap is never a
     signature, and the Review is for exactly the amount the tap set: anything that changes it lets the tap go. */
  const carriedQuick = useRef(initialQuick);
  const [quickReview, setQuickReview] = useState<Readonly<{ side: TicketDraft["side"]; unit: TicketUnit; amount: string }> | null>(null);
  useEffect(() => {
    const carried = carriedQuick.current;
    if (carried === null || !baseMint) return;
    carriedQuick.current = null;
    if (baseMint !== carried.mint || side !== "BUY") return;
    const value = String(carried.usd);
    setDraft((current) => ({ ...current, type: "market", unit: "usd", amount: value }));
    setQuickReview({ side: "buy", unit: "usd", amount: value });
  }, [baseMint, side]);
  useEffect(() => {
    if (quickReview === null) return undefined;
    const timer = window.setTimeout(() => setQuickReview(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [quickReview]);
  useEffect(() => {
    if (quickReview === null) return;
    if (draft.amount !== quickReview.amount || draft.unit !== quickReview.unit || draft.side !== quickReview.side || draft.type !== "market" || attempt !== null || phase !== "IDLE") {
      setQuickReview(null);
      return;
    }
    if (!connection || holdings.status !== "ready" || !pre || pre.paid === null || liveAmount === "") return;
    setQuickReview(null);
    if (pre.fieldError || blocked) return;
    openReview();
  }, [quickReview, draft.amount, draft.unit, draft.side, draft.type, attempt, phase, connection, holdings.status, pre, liveAmount, blocked, openReview]);

  /* «Твоя позиція», as on a company's page: what the wallet holds of this market, what it is worth, and «Продати» —
     quiet; the ticket's own action stays the one orange press. The press turns the ticket to the sale and puts the
     cursor in its amount: the same Review, signature and receipt as every sale here. */
  const position = useMemo(() => {
    if (!connection || !baseHolding || !/^\d+$/.test(baseHolding.amountRaw) || BigInt(baseHolding.amountRaw) <= 0n) return null;
    const view = toView(BigInt(baseHolding.amountRaw), stockScale);
    const units = rawToNumber(view.toString(), baseHolding.decimals);
    if (units === null || !Number.isFinite(units) || units <= 0) return null;
    const price = market?.price ?? null;
    const perUnit = price !== null && stockScale ? (price * Number(stockScale.den)) / Number(stockScale.num) : price;
    return { units, usd: perUnit !== null && Number.isFinite(perUnit) ? units * perUnit : null };
  }, [connection, baseHolding, market?.price, stockScale]);
  const hostRef = useRef<HTMLElement>(null);
  const openSale = useCallback(() => {
    setRecurring(false);
    setDraft((current) => ({ ...current, side: "sell", type: "market", amount: "", tp: "", sl: "" }));
    window.requestAnimationFrame(() => {
      const field = hostRef.current?.querySelector<HTMLInputElement>("[data-ticket-field='amount']");
      if (!field) return;
      field.focus({ preventScroll: true });
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      field.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    });
  }, []);

  /* The block before the signature stands in view when a Review opens: the core moves the focus to its Review, and
     this runs after it. */
  useEffect(() => {
    if (stage !== "review") return;
    const block = hostRef.current?.querySelector<HTMLElement>("[data-before-sign]");
    block?.scrollIntoView({ block: "nearest" });
  }, [stage, limitPhase.kind]);

  const unsettledTx =
    stage !== "result"
      ? null
      : limit
        ? limitPhase.kind === "PLACED" && !limitPhase.settled ? limitPhase.signature : null
        : phase === "SETTLED" && result?.state === "unknown" ? (signature ?? null) : null;

  /* SOL-C12, UX-256 (the core's rule C-07): while the outcome is unknown nothing invites a second order — the
     transaction and a read again stand there; «Trade again» once the wallet's history or orders name the signature. The
     page reads them again on its own every fifteen seconds until then. */
  const unsettledKnown = knownOutcome({ signature: unsettledTx, limit, history, orders });
  useEffect(() => {
    if (!unsettledTx || unsettledKnown) return;
    /* Twenty reads (five minutes) while the page is in view; after that the person's own «Прочитати ще раз». */
    let reads = 0;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      reads += 1;
      if (reads > 20) window.clearInterval(timer);
      else onRefresh();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [unsettledTx, unsettledKnown, onRefresh]);

  const startOver = () => {
    if (limit) {
      setLimitPhase({ kind: "EDIT" });
      setDraft((current) => ({ ...current, amount: "" }));
      return;
    }
    ticket.reset();
    setDraft((current) => ({ ...current, amount: "", tp: "", sl: "" }));
    onRefresh();
    if (ruleBinding) onLeaveRule?.();
  };

  const [quickSums] = useQuickBuySums();

  /* ----------------------------------------------------------------- «Швидка торгівля» and the exit plan (SOL-R2) */

  /* On a token — not SOL itself (its sale keeps the network fee back), not a company's stock, not under a plan or a
     rule's reminder: quick sums, quick shares and the exit plan, each one tap to this ticket's exact Review. The plan
     watches the page's reads as they arrive, with the server's own word on their age (`useTokenExitPlan`). */
  const fastTrade = !isStockMarket && baseMint !== null && baseMint !== WRAPPED_SOL_MINT && !bound && availability.allowed;
  const exitServerAt = priceObservedAt ? Date.parse(priceObservedAt) : Number.NaN;
  const exitPlan = useTokenExitPlan(connection?.address ?? null, fastTrade ? baseMint : null, market?.price ?? null, Number.isFinite(exitServerAt) ? exitServerAt : null, priceStale, now);
  const updatePlans = exitPlan.update;
  const baseSpendable = baseHolding && /^\d+$/.test(baseHolding.spendableRaw) ? BigInt(baseHolding.spendableRaw) : null;
  const tapBusy = busy || limitBusy || stage !== "form" || attempt !== null;
  const tapSale = (raw: bigint): string | null => {
    if (raw <= 0n || baseDecimals === null) return null;
    const amount = plainAmount(raw.toString(), baseDecimals);
    setRecurring(false);
    setDraft((current) => ({ ...current, side: "sell", type: "market", unit: "token", amount, tp: "", sl: "" }));
    setQuickReview({ side: "sell", unit: "token", amount });
    return amount;
  };
  const [exitNote, setExitNote] = useState<string | null>(null);
  const [exitRefusal, setExitRefusal] = useState<string | null>(null);
  const onQuickBuy = (usd: number) => {
    if (tapBusy) return;
    setExitIntent(null);
    setExitNote(null);
    /* Paid in USDC the sum is typed as it is (25 is 25 USDC); paid in SOL it is dollars, counted at SOL's price. */
    const unit: TicketUnit = quote.mint === WRAPPED_SOL_MINT ? "usd" : "token";
    const amount = String(usd);
    setRecurring(false);
    setDraft((current) => ({ ...current, side: "buy", type: "market", unit, amount, tp: "", sl: "" }));
    setQuickReview({ side: "buy", unit, amount });
  };
  const onQuickSell = (raw: bigint) => {
    if (tapBusy) return;
    setExitIntent(null);
    setExitNote(null);
    tapSale(raw);
  };
  const onExitSale = (request: ExitSaleRequest) => {
    if (tapBusy || !connection) return;
    const owner = connection.address;
    /* The level is this tab's while its Review is open: another tab neither offers it nor ties a signature to it. */
    updatePlans((current) => {
      const plan = current.find((entry) => entry.id === request.planId && entry.owner === owner);
      return plan ? replacePlan(current, claimLeg(plan, request.legId, TAB_ID, Date.now())) : current;
    });
    const held = readPlansNow().find((entry) => entry.id === request.planId)?.legs.find((leg) => leg.id === request.legId);
    if (!held || held.state !== "ready" || held.claim?.tab !== TAB_ID) {
      setExitNote(held?.state === "ready" ? text("This level's sale is open in another tab.") : text("This level's sale is already on its way or sold — see the exit plan."));
      return;
    }
    setExitNote(null);
    const amount = tapSale(request.sale.raw);
    setExitIntent(amount === null ? null : { planId: request.planId, legId: request.legId, amount, raw: request.sale.raw.toString(), owner, label: request.label });
  };
  /* The order is no longer the level's sale: the intent goes. */
  useEffect(() => {
    if (!exitIntent || attempt !== null || quickReview !== null || phase !== "IDLE") return;
    if (draft.side !== "sell" || draft.type !== "market" || draft.amount !== exitIntent.amount || connection?.address !== exitIntent.owner) setExitIntent(null);
  }, [exitIntent, attempt, quickReview, phase, draft.side, draft.type, draft.amount, connection?.address]);
  useEffect(() => {
    if (phase !== "REVIEW") setExitRefusal(null);
  }, [phase]);
  /* The server refused the signed bytes before the submit boundary: nothing was sent, the level is ready again — and
     still the ticket's intent, so the Review asked again ties its new signature to it. */
  useEffect(() => {
    const linked = exitLinked.current;
    const failure = ticket.actionFailure;
    if (!linked || attempt !== null || !failure || failure === linked.failure || failure.submitBoundary !== "NOT_CROSSED") return;
    if (settled?.signature === linked.signature) return;
    exitLinked.current = null;
    updatePlans((current) => {
      let next = current;
      for (const plan of current) next = replacePlan(next, unsendLeg(plan, linked.signature));
      return next;
    });
  }, [ticket.actionFailure, attempt, settled?.signature, updatePlans]);
  /* The chain's settled answer moves the level that sent it: filled — sold (with the amount the chain names, else the
     amount signed); rejected or never landed — not sold. Any other answer leaves it sent: never sold, never nothing sent. */
  const settledSignature = settled?.signature ?? null;
  const settledInput = settled?.observation?.actualInputRaw ?? null;
  useEffect(() => {
    if (!settledSignature || !outcome) return;
    if (exitLinked.current?.signature === settledSignature) exitLinked.current = null;
    exitSettled.current.add(settledSignature);
    const answer: LegAnswer | null =
      outcome.kind === "FILLED"
        ? { kind: "sold", soldRaw: settledInput !== null && /^\d+$/.test(settledInput) ? BigInt(settledInput) : null }
        : outcome.kind === "NOT_FILLED" || outcome.kind === "NOTHING_HAPPENED"
          ? { kind: "notSold" }
          : null;
    if (!answer) return;
    updatePlans((current) => {
      let next = current;
      for (const plan of current) next = replacePlan(next, settleLeg(plan, settledSignature, answer));
      return next;
    });
  }, [settledSignature, outcome?.kind, settledInput, updatePlans]); // eslint-disable-line react-hooks/exhaustive-deps
  /* The level the Review is for, as storage holds it now: named in the Review only while it is still this tab's ready level. */
  const exitLeg = exitIntent ? (exitPlan.open?.id === exitIntent.planId ? exitPlan.open.legs.find((leg) => leg.id === exitIntent.legId) ?? null : null) : null;
  /* The exact order is the level's sale: the same token, exactly the level's raw units. */
  const exitMatches = exitIntent !== null && side === "SELL" && prepared !== null && prepared.order.inputMint === baseMint && prepared.order.inAmountRaw === exitIntent.raw;
  const exitOnReview = exitIntent !== null && exitLeg !== null && exitLeg.state === "ready" && !claimedElsewhere(exitLeg, TAB_ID, now) && exitMatches;
  /* A level stays ready once reached: a price back on the other side of it is said in its place, never «take profit». */
  const exitBack = exitOnReview && exitLeg && exitPlan.open ? levelPastNow(exitPlan.open, exitLeg, exitPlan.entry?.price ?? null, exitPlan.entry?.at ?? null, now) === false : false;
  /* Sign pressed on a level's sale: the level is read again from storage first — if another tab sold it or holds it, this
     Review is let go and nothing is signed. */
  const signReviewed = () => {
    if (exitIntent) {
      /* An order that is not exactly the level's sale is never signed while the level waits on it. */
      if (!exitMatches) {
        setExitRefusal(text("This order is not the exit plan's sale any more — nothing was signed. Ask for the level's sale again."));
        return;
      }
      /* Held again for this signature, then read back: a hold that ran out or went to another tab meanwhile stops here. */
      const intent = exitIntent;
      updatePlans((current) => {
        const plan = current.find((entry) => entry.id === intent.planId && entry.owner === intent.owner);
        return plan ? replacePlan(current, claimLeg(plan, intent.legId, TAB_ID, Date.now())) : current;
      });
      const leg = readPlansNow().find((entry) => entry.id === intent.planId)?.legs.find((entry) => entry.id === intent.legId);
      if (!leg || leg.state !== "ready" || leg.claim?.tab !== TAB_ID) {
        setExitIntent(null);
        setExitNote(text("This level's sale is already on its way or sold — see the exit plan."));
        void ticket.cancelReview();
        return;
      }
    }
    void ticket.sign();
  };

  /* ----------------------------------------------------------------- the words around the ticket */

  const ruleRefusal = (() => {
    const code = ticket.actionFailure?.code ?? null;
    if (code === "RULE_LIQUIDITY_LOW") return text("The token's pool is under the floor for a recurring buy now — the rule's purchase waits.");
    if (code === "RULE_PRICE_CONDITION") return text("The rule's price condition is not met right now — its purchase waits.");
    if (code === "RULE_BUDGET_EXHAUSTED") return text("What is left of this month's budget does not cover the rule's purchase.");
    if (code === "RULE_NOT_DUE" || code === "RULE_NOT_FOUND" || code === "RULE_MISMATCH") return text("This reminder can no longer be bought — read the rule again.");
    /* Under a rule these two are the rule's own: a token's figures unread, or a token flagged since the rule was written. */
    if (ruleBinding && code === "UNAVAILABLE") return text("The token's liquidity or price cannot be read right now — try again in a moment.");
    if (ruleBinding && code === "ASSET_NOT_OFFERED") return text("Jupiter's audit flags this token, or Ryntra no longer supports it — the rule does not buy it.");
    return null;
  })();
  const ruleLine = (() => {
    if (!ruleState) return null;
    if (ruleState === "ready" && boundRule && ruleSumUsd !== null) return `${usdWord(ruleSumUsd, lang)} · ${ruleWhenLine(boundRule, lang)}`;
    if (ruleState === "unproven") return text("Confirm your wallet to buy by your rule.");
    if (ruleState === "loading") return text("Reading the rule…");
    if (ruleState === "gone") return text("This rule is no longer in your wallet.");
    if (ruleState === "wrongMarket") return text("This market is not the rule's token.");
    if (ruleState === "bought") return text("This reminder's purchase is already bought.");
    if (ruleState === "pending") return text("A purchase under this reminder is already on its way.");
    if (ruleState === "deferred") return text("The rule's purchase waits — its rule says why.");
    return text("This reminder has closed. The next one comes on the rule's day.");
  })();
  const planReview = prepared?.planReview ?? ticket.actionFailure?.planReview ?? null;
  const planMaxPerShare = underPlan && plan ? plan.current.rules.entry.maxPricePerShare : null;
  const engineOrder = prepared?.order ?? quoted?.order ?? null;
  const reviewWarnings = prepared ? prepared.policy.verdict.findings.filter((finding) => finding.outcome === "REVIEW") : [];
  const rentSol = stage === "review" && prepared && BigInt(prepared.order.rentFeeLamports) > 0n ? Number(BigInt(prepared.order.rentFeeLamports)) / 1e9 : null;

  /* A ticket under a plan or a rule that cannot be judged offers no plain order in its place: the wallet proves itself,
     the plan's or the rule's own market opens, or the person leaves it on purpose. */
  const boundWait = !recovering && ((planState && planState !== "ready") || (ruleState && ruleState !== "ready"))
    ? (planState === "unproven" || ruleState === "unproven"
        ? "prove"
        : planState === "loading" || ruleState === "loading"
          ? "loading"
          : "outside")
    : null;

  /* A token Ryntra no longer supports: no side of it trades here — the ticket says where it can be sold, and nothing else.
     A settled or recovering trade still shows its answer. */
  if (!availability.allowed && !recovering) {
    return (
      <section className={`${styles.panel} ${styles.ticket}`} aria-label={text("Order ticket")} data-retired data-terminal-ticket>
        <p className={styles.retiredNotice} role="status">
          <b>{text("No longer supported in Ryntra")}</b>
          <span>{text("You can sell it in your own wallet")}</span>
        </p>
      </section>
    );
  }

  /* The person's quick sums: in the dollar token itself when it pays in USDC (25 means 25 USDC), in dollars for SOL. */
  const quick = !underRule && !fastTrade && draft.side === "buy" ? { unit: quote.mint === WRAPPED_SOL_MINT ? ("usd" as const) : ("token" as const), values: quickSums.map((sum) => String(sum)) } : undefined;
  /* A quote that leaves the tolerance to the exact order (none stated, its minimum the expected amount): before Review the
     ticket names neither a minimum nor a tolerance it does not have; the Review states both. */
  const toleranceByReview = !limit && quoted !== null && quoted.order.slippageBps === 0 && quoted.order.minReceivedRaw === quoted.order.outAmountRaw;
  /* An asset that did not pass the checks has no market order here, grey with its reason — nor a plan or a rule's
     reminder that cannot be judged yet, whose line under the ticket says why; a quote that failed says so in the ticket,
     with «Повторити» only where another ask can answer. */
  const swapFlag = blocked || boundWait ? ({ status: "off" } as const) : on;
  const limitFlag = bound ? ({ status: "off" } as const) : on;
  const onDraftChangeAllowed = !(underRule || busy || limitBusy);
  /* «1 %» in Ukrainian, «1%» in English — as the core writes a share. */
  const percentSign = lang === "uk" ? " %" : "%";
  /* A price in the quote on the ticket's own step, the way the core's ticket and Review print the limit's. */
  const ticketPriceText = (value: number): string => {
    const text = decimalText(value, 18);
    const parsed = text === null ? null : parsePrice(text);
    return typeof parsed === "bigint" && ticketMarket ? formatTicketPrice(parsed, lang, ticketMarket.tick) : formatPrice(value, locale);
  };
  const signer = connection ? <span translate="no">{`${connection.address.slice(0, 4)}…${connection.address.slice(-4)}`}</span> : undefined;

  return (
    <section ref={hostRef} className={`${styles.panel} ${styles.ticket}`} aria-label={text("Order ticket")} data-terminal-ticket data-ticket-type={draft.type} data-ticket-stage={stage}>
      {planBinding && planState ? <PlanChip plan={plan} state={planState} onLeave={() => onLeavePlan?.()} /> : null}
      {ruleBinding && ruleState ? (
        <div className={styles.planChip} data-state={ruleState === "ready" ? "ready" : ruleState === "loading" || ruleState === "unproven" ? ruleState : "notFound"} data-rule-chip>
          <div className={styles.planChipText}>
            <b>
              {text("By your rule")}
              {boundRule ? (
                <>
                  {" · "}
                  <Link href="/app/bots" prefetch={false} translate="no">
                    {boundRule.name}
                  </Link>
                </>
              ) : null}
            </b>
            <span translate="no">{ruleLine}</span>
          </div>
          <button type="button" className={styles.planChipLeave} onClick={() => onLeaveRule?.()} aria-label={text("Trade without the rule")} title={text("Trade without the rule")} disabled={busy}>
            ×
          </button>
        </div>
      ) : null}

      {/* The token's risk in one line by «Купити» (UX-156): the facts, no verdict; not on a result. */}
      {stage !== "result" ? <RiskLine market={market} lang={lang} /> : null}

      {position && stage === "form" && !recurring ? (
        <div className={styles.position} data-position data-dense>
          <div className={styles.positionText}>
            <span className={styles.positionLabel}>{text("Your position")}</span>
            <b className={styles.positionValue} translate="no">{position.usd === null ? "—" : formatUsdPrice(position.usd, locale)}</b>
            <span className={styles.positionUnits} translate="no">{`${formatAmount(position.units, locale)} ${baseSymbol}`}</span>
          </div>
          {draft.side === "sell" && !limit ? null : (
            <Button variant="secondary" lang={lang} data-position-sell disabled={busy || bound} onClick={openSale}>
              {text("Sell")}
            </Button>
          )}
        </div>
      ) : null}

      {fastTrade && baseMint && stage === "form" && !recurring ? (
        <FastTrade
          locale={lang}
          owner={connection?.address ?? null}
          mint={baseMint}
          symbol={baseSymbol}
          decimals={baseDecimals}
          spendableRaw={connection && holdings.status === "ready" ? baseSpendable : null}
          priceSource="Jupiter"
          now={now}
          busy={tapBusy}
          canBuy={!blocked}
          buyNote={blocked ? text("This asset did not pass Ryntra's checks, so no order is offered for it.") : null}
          onQuickBuy={onQuickBuy}
          onQuickSell={onQuickSell}
          onExitSale={onExitSale}
          plan={exitPlan}
        />
      ) : null}
      {fastTrade && exitNote && stage === "form" ? (
        <p className={styles.note} role="status" data-exit-note>
          {exitNote}
        </p>
      ) : null}

      {recurring && baseMint ? (
        /* «Регулярно»: the rule that reminds of the purchase, on every token — written here, managed here. */
        <div className={styles.recurringPanel} data-recurring>
          {!connection ? (
            /* The guest's one button first, the line about the rule small under it (B14). */
            <div className={styles.recurringGuest}>
              <ConnectWalletButton block before={onBeforeConnect} />
              <p>{text("A rule reminds you on its day — you sign every purchase. Your money stays in your wallet.")}</p>
            </div>
          ) : !proven ? (
            <div className={styles.recurringGuest}>
              <p>{text("Confirm your wallet to set or see a rule on this token.")}</p>
              <Button variant="primary" lang={lang} loading={proving} disabled={!onProve} onClick={onProve}>
                {text("Confirm wallet")}
              </Button>
            </div>
          ) : rulesRead.state.status !== "ready" ? (
            <p className={styles.note}>{rulesRead.state.status === "failed" ? text("Your rules could not be read right now.") : text("Reading the rule…")}</p>
          ) : (
            <AutoinvestPanel
              key={`${baseMint}:${tokenRule?.id ?? "new"}`}
              mode={tokenRule ? { kind: "manage", rule: tokenRule } : { kind: "compose", amountUsd: null }}
              mint={baseMint}
              name={isStockMarket ? companyFromTokenName(market?.name ?? baseSymbol) || baseSymbol : baseSymbol}
              icon={baseIcon}
              preIpo={false}
              truth=""
              priceUsd={market?.price ?? null}
              token={!isStockMarket}
              budget={rulesRead.state.budget}
              locale={locale}
              onBusy={setRuleBusy}
              onClose={() => setRecurring(false)}
              onConnect={() => undefined}
              onCreate={rulesRead.create}
              onSetStatus={rulesRead.setStatus}
              onRemove={rulesRead.remove}
              onEditBudget={() => setBudgetOpen(true)}
              onMarkOwn={rulesRead.markOwn}
              onBuyNow={(rule, occurrence) => {
                /* A token's reminder is bought here; a company's on its own page, where its Review is. */
                setRecurring(false);
                if (!isStockMarket && onRuleBuy) onRuleBuy({ ruleId: rule.id, dueAt: occurrence.dueAt });
                else window.location.assign(rulePurchaseHref(rule, occurrence.dueAt));
              }}
            />
          )}
          <Button variant="ghost" lang={lang} disabled={ruleBusy} onClick={() => setRecurring(false)} data-recurring-back>
            {text("Back to the order")}
          </Button>
        </div>
      ) : null}
      <BudgetSheet open={budgetOpen} budget={rulesRead.state.budget} locale={locale} onClose={() => setBudgetOpen(false)} onSave={rulesRead.setBudget} onClear={rulesRead.clearBudget} />

      {!recurring ? (
        <>
          {/* What a purchase is paid in and a sale is received in: USDC or SOL, the market never its own quote. */}
          {stage === "form" ? (
            <div className={styles.ticketRow} data-pay-with>
              <span>{draft.side === "buy" ? text("Pay with") : text("Receive in")}</span>
              <QuoteAssetSwitch
                label={draft.side === "buy" ? text("Pay with") : text("Receive in")}
                value={quote.mint}
                options={SPOT_QUOTE_ASSETS.filter((asset) => asset.mint !== baseMint)}
                disabled={busy || limitBusy || underRule || underPlan}
                onChange={(mint) => {
                  setQuoteMint(mint);
                  setDraft((current) => ({ ...current, amount: current.unit === "usd" ? current.amount : "", price: "" }));
                }}
              />
            </div>
          ) : null}

          {/* A rule's reminder open for this token: a purchase here leaves it open — said before the action. */}
          {connection && draft.side === "buy" && !ruleBinding && stage === "form" ? <RuleReminderNotice mint={baseMint} proven={proven} locale={locale} className={styles.ruleReminder} onBuy={!isStockMarket ? onRuleBuy : undefined} /> : null}
          {/* Before the signature, beside the core's Review: what else leaves the wallet — the rent of a new token
              account, a limit order's account and bins — and a limit's price as the venue fills it. */}
          {stage === "review" && (rentSol !== null || (limit && (limitPhase.kind === "REVIEW" || limitPhase.kind === "SIGNING"))) ? (
            <section className={styles.beforeSign} data-before-sign aria-label={text("Before you sign")}>
              <dl>
                {rentSol !== null ? (
                  <div>
                    <dt>{text("Account reserve")}</dt>
                    <dd translate="no">{`${formatAmount(rentSol, locale, 6)} SOL`}</dd>
                  </div>
                ) : null}
                {limit && (limitPhase.kind === "REVIEW" || limitPhase.kind === "SIGNING") ? (
                  <>
                    {limitPhase.review.depositLamports !== null && limitPhase.review.depositLamports > 0 ? (
                      <div>
                        <dt>{limitPhase.review.venue === "dlmm" ? text("Order account and pool bins, rent") : text("Order account, rent returned on close")}</dt>
                        <dd translate="no">{`${formatAmount(limitPhase.review.depositLamports / 1e9, locale, 6)} SOL`}</dd>
                      </div>
                    ) : null}
                    {/* The price the venue fills at — on Jupiter the typed price moved by the fee, on DLMM the bin's — and
                        the market now, both on the ticket's own price step, so they line up with the limit's price. */}
                    <div>
                      <dt>{limitPhase.review.venue === "dlmm" ? text("Bin price") : text("Fills at, after fees")}</dt>
                      <dd translate="no">{`${ticketPriceText(limitPhase.review.fillPrice)} ${quote.symbol}`}</dd>
                    </div>
                    {limitMarket?.price ? (
                      <div>
                        <dt>{text("Market now")}</dt>
                        <dd translate="no">{`${ticketPriceText(limitMarket.price)} ${quote.symbol}`}</dd>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </dl>
              {limit && (limitPhase.kind === "REVIEW" || limitPhase.kind === "SIGNING") ? (
                <>
                  <p>
                    {limitPhase.review.venue === "trigger"
                      ? text("The amount waits in Jupiter's order account until the market pays this price; Jupiter's keeper then swaps it into your wallet. Cancel at any time.")
                      : text("The amount sits in one price bin of the Meteora pool; when the market crosses it, the pool converts it at that price. Take it back at any time.")}
                  </p>
                  <details>
                    <summary>{text("Details")}</summary>
                    <dl>
                      <div><dt>{text("Venue")}</dt><dd>{LIMIT_VENUE_NAMES[limitPhase.review.venue]}</dd></div>
                      <div><dt>{text("Order account")}</dt><dd translate="no">{limitPhase.review.order}</dd></div>
                      {limitPhase.review.pool ? <div><dt>{text("Pool")}</dt><dd translate="no">{limitPhase.review.pool}</dd></div> : null}
                      {limitPhase.review.fee.account ? <div><dt>{text("Ryntra fee account")}</dt><dd translate="no">{limitPhase.review.fee.account}</dd></div> : null}
                      {limitPhase.review.fee.reason === "NO_FEE_ACCOUNT" ? <div><dt>{text("Ryntra fee")}</dt><dd>{text("not charged on this order")}</dd></div> : null}
                    </dl>
                  </details>
                </>
              ) : null}
            </section>
          ) : null}

          {/* A limit's own choices, together above the ticket: where it waits — Jupiter's order account, or one price bin of
              a Meteora pool when the pair has one (its fee depends on it) — and how far from the market. */}
          {limit && stage === "form" ? (
            <div className={limitStyles.venues} role="radiogroup" aria-label={text("Where the order waits")} data-limit-venues>
              {(["trigger", "dlmm"] as const).map((entry) => {
                const unavailable = entry === "dlmm" && !dlmmAvailable;
                return (
                  <button key={entry} type="button" role="radio" aria-checked={limitVenue === entry} className={limitStyles.venue} disabled={limitBusy || unavailable} onClick={() => setLimitVenue(entry)} data-venue={entry}>
                    <b>{LIMIT_VENUE_NAMES[entry]}</b>
                    <span>
                      {entry === "trigger"
                        ? text("Any pair · Ryntra fee by the pair")
                        : unavailable
                          ? limitMarket === null
                            ? text("Checking pools…")
                            : text("No pool of this pair takes limits")
                          : text("On-chain bin · no fee, earns pool fees")}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {limit && stage === "form" && referenceE18 !== null ? (
            <div className={limitStyles.offsets} data-limit-offsets>
              <span className={limitStyles.distance} data-tone={pre?.crosses ? "warn" : "plain"}>
                {limitDistance !== null && Number.isFinite(limitDistance)
                  ? `${limitDistance > 0 ? "+" : limitDistance < 0 ? "−" : ""}${Math.abs(limitDistance).toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: 2 })}${percentSign} ${text("from the market")}`
                  : "—"}
              </span>
              <div className={limitStyles.offsetChips} role="group" aria-label={text("Distance from the market")}>
                {[1, 2, 5].map((step) => {
                  const offset = draft.side === "buy" ? -step : step;
                  const active = limitDistance !== null && Math.abs(limitDistance - offset) < 0.05;
                  return (
                    <button key={step} type="button" className={limitStyles.offsetChip} aria-pressed={active} disabled={limitBusy || !onDraftChangeAllowed} onClick={() => setLimitOffset(offset)}>
                      {`${offset > 0 ? "+" : "−"}${step}${percentSign}`}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* A token its issuer set a swap deadline for: the date in red right over «Купити | Продати», before any sum (UX-504). */}
          <SwapDeadline mint={baseMint} lang={lang} />

          {ticketMarket ? (
            <div className={styles.ticketHost} data-quote-usd={USD_QUOTES.has(quote.mint) ? "true" : undefined} data-tolerance={toleranceByReview ? "by-review" : undefined} data-amount-ready={pre?.paid ? "true" : undefined}>
              <TradeTicket
                market={stage === "result" && !limit && heldMarket ? heldMarket.market : ticketMarket}
                draft={draft}
                balances={balances}
                prices={prices}
                reference={baseInput?.reference ?? null}
                gas={gas}
                quote={ticketQuote ?? undefined}
                quoteFailed={!limit && ticket.quoteFailure !== null && !blocked}
                fees={[]}
                venue={limit ? LIMIT_VENUE_NAMES[limitVenue] : "Jupiter"}
                venueId={limit ? undefined : "jupiter"}
                maxLegs={1}
                swap={swapFlag}
                limit={limitFlag}
                now={now}
                network="Solana"
                quick={quick}
                stage={stage}
                reviewed={reviewed}
                signer={signer}
                signing={limit ? limitPhase.kind === "SIGNING" : phase === "SIGNING" || (phase === "PREPARING" && prepared !== null)}
                cancelWhileSigning={false}
                result={result}
                onDraftChange={onDraftChangeAllowed ? changeDraft : undefined}
                onRetryQuote={quoteFailureRetryable === false ? undefined : ticket.refreshQuote}
                onConnect={() => reachAfter(onBeforeConnect, reach)}
                /* A phone with no wallet: the ticket's action is «Відкрити в Phantom», the one way on there (B14). */
                action={!connection && openInWallet && stage === "form" ? <ConnectWalletButton block before={onBeforeConnect} /> : undefined}
                onReview={boundWait ? undefined : onReview}
                onCancel={limit ? () => setLimitPhase({ kind: "EDIT" }) : () => void ticket.cancelReview()}
                onConfirm={
                  limit
                    ? limitPhase.kind === "REVIEW"
                      ? () => void signLimitOrder(limitPhase.review, limitPhase.at, limitPhase.reviewed)
                      : undefined
                    : phase === "REVIEW" && prepared && ticket.preparedReadiness?.ready
                      ? signReviewed
                      : undefined
                }
                onVerify={signature || (limit && limitPhase.kind === "PLACED") ? () => window.open(explorerTxUrl("mainnet", limit && limitPhase.kind === "PLACED" ? limitPhase.signature : (signature ?? "")), "_blank", "noopener,noreferrer") : undefined}
                onAgain={startOver}
                quietLegs={fastTrade}
                reviewRows={stage === "review" && !limit && exitOnReview && exitIntent ? [{ label: text("Exit plan"), value: exitBack ? (exitLeg?.kind === "tp" ? text("Price is back below this level now.") : text("Price is back above this level now.")) : exitIntent.label }] : undefined}
                density={density}
                titleAs="h3"
                lang={lang}
              />
            </div>
          ) : (
            <Skeleton lines={6} label={text("Loading market…")} />
          )}

          {/* The preparation of the exact Review: one press, then this line until it stands. */}
          {!limit && phase === "PREPARING" && !prepared ? <p className={styles.note} role="status">{text("Preparing Review…")}</p> : null}
          {limit && limitPhase.kind === "REVIEWING" ? <p className={styles.note} role="status">{text("Preparing…")}</p> : null}

          {boundWait === "prove" ? (
            <Button variant="primary" lang={lang} loading={proving} disabled={!onProve} onClick={onProve} block>
              {text("Confirm wallet")}
            </Button>
          ) : boundWait === "loading" ? (
            <p className={styles.note} role="status">{planState === "loading" ? text("Reading the plan…") : text("Reading the rule…")}</p>
          ) : boundWait === "outside" ? (
            <p className={styles.note} role="status">{planState && planState !== "ready" ? text("Not under this plan") : text("Not under this rule")}</p>
          ) : null}

          {/* An order the network left unknown is followed by its signature alone — never a second order. */}
          {!limit && attempt && phase !== "RECOVERING" && phase !== "EXECUTING" ? (
            <Button variant="primary" lang={lang} block onClick={() => void ticket.recover()} data-recover>
              {text("Check transaction")}
            </Button>
          ) : null}
          {/* A Review the server still holds, or one that can no longer be signed: a fresh one, never the old bytes. */}
          {!limit && (lockedOnly || (phase === "REVIEW" && prepared && ticket.preparedReadiness && !ticket.preparedReadiness.ready)) ? (
            <Button variant="secondary" lang={lang} block disabled={busy} onClick={() => void ticket.cancelReview(true)} data-refresh-review>
              {text("Get a new quote")}
            </Button>
          ) : null}

          {/* A tokenized stock's Review carries its Market and Asset block: the amount in underlying units, the
              executable per-share price against the issuer's reference, the session and the units. */}
          {isStockMarket && engineOrder && baseMint && stage !== "result" && !limit ? (
            <StockReviewBlock mint={baseMint} side={side} order={engineOrder} tokenDecimals={market?.decimals ?? null} variant="full" planMaxPerShare={planMaxPerShare} />
          ) : null}
          {/* The Strategy block: the server's judgement of the plan on this exact order — on the Review it may sign, and on the refusal it may not. */}
          {planReview && (stage === "review" || ticket.actionFailure?.planReview) ? (
            <PlanReviewBlock review={planReview} plan={plan} onUseFit={(usd) => setDraft((current) => ({ ...current, unit: "token", amount: usd.toFixed(2) }))} />
          ) : null}
          {stage === "review" && underRule && boundRule && ruleSumUsd !== null ? (
            <p className={styles.note} data-verdict="rule">
              {text("Your rule")}: <span translate="no">{`${usdWord(ruleSumUsd, lang)} · ${boundRule.name} · ${lowerFirst(ruleWhenLine(boundRule, lang))}`}</span>
            </p>
          ) : stage === "review" && planReview ? (
            <p className={styles.note} data-verdict={planReview.verdict}>
              {text("Your plan")}: {planReview.verdict === "ready" ? text("Within the plan") : planReview.verdict === "attention" ? text("Within the plan · your call") : `${text("Outside the plan")}${planRefusalSentence(planReview, text) ? ` — ${planRefusalSentence(planReview, text)}` : ""}`}
            </p>
          ) : null}
          {reviewWarnings.length > 0 && stage === "review" ? <p className={styles.warning}>{text("Review this order carefully.")}</p> : null}
          {blocked && !limit ? <p className={styles.error}>{text("This asset did not pass Ryntra's checks, so no order is offered for it.")}</p> : null}
          {!limit && ticket.quoteFailureMessage && quoteFailureRetryable === false && !blocked ? <p className={styles.error}>{ticket.quoteFailureMessage}</p> : null}
          {ruleRefusal ? <p className={styles.error} role="alert">{ruleRefusal}</p> : !limit && ticket.actionFailureMessage ? <p className={styles.error} role="alert">{ticket.actionFailureMessage}</p> : null}
          {limit && limitFailure ? <p className={styles.error} role="alert">{limitFailure}</p> : null}
          {!limit && exitRefusal && stage === "review" ? <p className={styles.error} role="alert" data-exit-refusal>{exitRefusal}</p> : null}
          {connection && (holdings.status === "unavailable" || holdings.partial) && stage === "form" ? (
            <p className={styles.note}>
              {text("Some balances could not be read.")}{" "}
              <Button variant="ghost" lang={lang} onClick={onRefresh} disabled={busy}>
                {text("Read again")}
              </Button>
            </p>
          ) : null}

          {/* After a fill: the ledger's own receipt, the plan's watch, and the card of this trade. */}
          {stage === "result" && !limit && settled ? (
            <div className={styles.settledLinks}>
              {settled.receipt ? (
                <Button variant="ghost" lang={lang} onClick={() => downloadReceipt(settled.receipt)}>
                  {text("Receipt")}
                </Button>
              ) : null}
              <Link className={styles.ghost} href="/app/activity">
                {text("History")}
              </Link>
            </div>
          ) : null}
          {/* An answer the core cannot call final (a limit the chain has not confirmed, a settled trade it could not
              classify) leaves its own ticket without «again»: the transaction and a read again stand here, and a new
              start only once the wallet's history or its orders say what happened (UX-256). */}
          {unsettledTx ? (
            <div data-ticket-unsettled data-known={unsettledKnown ?? undefined}>
              <p className={styles.note} role="status">
                {unsettledKnown === "done"
                  ? text("Your history shows this trade as done.")
                  : unsettledKnown === "failed"
                    ? limit
                      ? text("The order was not placed.")
                      : text("Your history shows this trade as failed.")
                    : unsettledKnown === "placed"
                      ? text("The order is in «Orders».")
                      : limit
                        ? text("The chain has not confirmed this order yet. Look for it in «Orders» before you place another.")
                        : text("The outcome is not known. Check the transaction before you trade again.")}
              </p>
              <div className={styles.settledLinks}>
                <Button variant="ghost" lang={lang} onClick={() => window.open(explorerTxUrl("mainnet", unsettledTx), "_blank", "noopener,noreferrer")}>
                  {text("Check transaction")}
                </Button>
                {unsettledKnown ? (
                  <Button variant="ghost" lang={lang} onClick={startOver}>
                    {limit ? text("New limit order") : text("Trade again")}
                  </Button>
                ) : (
                  <Button variant="ghost" lang={lang} onClick={onRefresh} data-read-again>
                    {text("Read again")}
                  </Button>
                )}
              </div>
            </div>
          ) : null}
          {stage === "result" && outcome?.kind === "FILLED" && side === "BUY" && underPlan && plan ? (
            <p className={styles.settledWatch}>
              <span>
                {text("Ryntra watches your loss limit")} <b>{formatUsdPrice(plan.current.rules.risk.invalidationPerShare, locale)}</b>
              </span>
              <Link href={`/app/strategies/plans/${encodeURIComponent(plan.id)}`} prefetch={false}>
                {text("Open the plan")}
              </Link>
            </p>
          ) : null}
          {stage === "result" && outcome?.kind === "FILLED" && baseMint && settled ? <ShareTrade key={settled.signature} mint={baseMint} /> : null}

          {availability.allowed && availability.notice === "ISSUER_TERMS" ? (
            <p className={styles.issuerLine}>
              {issuerLine ? <>{text("Tokenized by")} {issuerLine} · </> : null}
              {text("the issuer's terms apply")}
            </p>
          ) : null}

          {/* «Регулярно» on every token: the rule that reminds of this purchase, beside the order now and at a price. */}
          {stage === "form" && baseMint && !bound ? (
            <Button variant="ghost" lang={lang} icon="clock" disabled={busy || limitBusy} onClick={() => setRecurring(true)} data-recurring-open>
              {text("Recurring buy")}
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** Ryntra's fee as the chain showed it after the fill (the engine's settlement), when it states an amount. */
function settledServiceFee(settled: { facts: { fees?: { serviceFee?: unknown } | null } | null } | null): Readonly<{ amountRaw: string; asset: string; decimals: number }> | null {
  const fee = settled?.facts?.fees?.serviceFee as
    | { settlement?: { userPaidRaw?: string | null; asset?: string | null; decimals?: number | null } | null; amountRaw?: string | null; asset?: string | null; decimals?: number | null }
    | null
    | undefined;
  if (!fee) return null;
  const paid = fee.settlement?.userPaidRaw ?? null;
  const asset = fee.settlement?.asset ?? fee.asset ?? null;
  const decimals = fee.settlement?.decimals ?? fee.decimals ?? null;
  const amountRaw = paid ?? fee.amountRaw ?? null;
  if (amountRaw === null || asset === null || decimals === null || !/^\d+$/.test(amountRaw)) return null;
  return { amountRaw, asset, decimals };
}

/** The route's price as the ticket's 1e-18, else the price typed. */
function parsePriceOr(text: string, fallback: bigint): bigint {
  const parsed = parsePrice(text);
  return typeof parsed === "bigint" ? parsed : fallback;
}
