"use client";

import { ArrowUpRight, CheckCircle, Warning, XCircle } from "@phosphor-icons/react";
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
import { displayAmount, parseHumanAmount } from "@/lib/solana/amounts";
import { isScaledMultiplier, rawFromScaledRaw, scaledAmountString } from "@/lib/stocks/units";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { classifySpotFill } from "@/lib/solana/fill-outcome";
import { WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";
import { downloadReceipt } from "@/lib/solana/send-receipt-vault.client";
import { swapFailureCopy } from "@/lib/solana/swap-failure-copy";
import { additionalJupiterFeeBps, serviceFeeReviewText, serviceFeeText, type RyntraServiceFee } from "@/lib/swap/service-fee";
import { spotFillAmounts, spotTicketAction } from "@/lib/spot/ticket-state";
import { tradingAvailability, type SpotMarket } from "@/lib/spot/markets";
import { QUICK_SELL_SHARES_PCT, quickBuyAmount } from "@/lib/spot/quick-trade";

import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { ShareTrade } from "../rewards/share-trade.tsx";
import { WalletConnectRow } from "../wallet-connect.tsx";
import { MarketIcon } from "./market-list.tsx";
import { PlanChip, PlanReviewBlock, planRefusalSentence } from "./plan-review-block.tsx";
import { QuickBuy, QuickSell } from "./quick-buy.tsx";
import { QuoteAssetSwitch } from "./quote-asset-switch.tsx";
import { StockReviewBlock, useStockAsset } from "./stock-context.tsx";
import { formatAmount, formatPrice, formatUsdPrice, rawToNumber } from "./spot-format.ts";
import type { HoldingsState, SpotHolding } from "./use-spot-data.ts";
import { SPOT_QUOTE_ASSETS, plainAmount, useSpotTicket, type SpotQuoteAsset, type SpotSide } from "./use-spot-ticket.ts";

import styles from "./spot.module.css";

function ryntraServiceFee(order: object): RyntraServiceFee | null {
  const fee = (order as { ryntraFee?: unknown }).ryntraFee;
  if (!fee || typeof fee !== "object") return null;
  const candidate = fee as RyntraServiceFee;
  return typeof candidate.basisPoints === "number" && typeof candidate.mechanism === "string" ? candidate : null;
}

/** «Щотижня · ср о 19:00» → «щотижня · ср о 19:00»: only the first letter, so «Wed» keeps its own. */
function lowerFirst(text: string): string {
  return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

function holdingOf(holdings: HoldingsState, mint: string): SpotHolding | null {
  if (!holdings.value) return null;
  if (mint === WRAPPED_SOL_MINT) return holdings.value.find((row) => row.kind === "NATIVE_SOL") ?? null;
  return holdings.value.find((row) => row.mint === mint) ?? null;
}

/**
 * The order ticket — Buy / Sell, one amount, the exact costs, Review, sign.
 *
 * The question is put the way a trader puts it: *buy SOL, spending USDC* or
 * *sell SOL, receiving USDC*. Underneath it is the one Jupiter engine Swap
 * runs on, with the same live quote, the same exact Review and the same
 * signature checks; the ticket adds nothing but the shape of the question.
 * Every figure a person decides on — what they get, the impact, the network
 * fee, Ryntra's own fee — is on the screen where they decide.
 *
 * Simple and Pro show the same order and the same rules; they differ in what
 * is open. Simple keeps the money on the screen — the price of this order,
 * the minimum, the network fee and the reserve, Ryntra's fee, the slippage —
 * and folds the provider, the route, a small impact and the stock's secondary
 * facts under *Details*. Pro opens them. A price impact worth a caution is
 * never folded. Under a plan, a stock order whose per-share price is above
 * the plan's bound is said so beside the action before the Review runs; the
 * Review still decides. While an autoinvest rule's reminder is open for the
 * token, a purchase here is said to leave it open, with the way to the rule's
 * own purchase.
 *
 * **«Ринок · Регулярно»** (1.31.0): beside the market order stands the
 * recurring buy on every token — a company, a coin, a meme or a new token —
 * the rule's own flow inside the ticket: written there, managed there, its
 * floor and its facts of risk before the button. **Under a rule's reminder**
 * (`?rule=&due=`, a token's reminder lands here) the ticket is the rule's
 * purchase: buy, in USDC, the rule's sum and nothing else, `origin.rule` on
 * the order — the server judges the reminder, the budget, the price
 * condition and the floor again — and the person's signature on a fresh
 * Review, as every purchase.
 */
export function OrderTicket({
  market,
  fallback,
  holdings,
  onSettled,
  onRefresh,
  pro,
  planBinding = null,
  proven = false,
  proving = false,
  onProve,
  onLeavePlan,
  initialSide = null,
  initialAmount = null,
  ruleBinding = null,
  onRuleBuy,
  onLeaveRule,
}: {
  market: SpotMarket | null;
  fallback: Readonly<{ mint: string; symbol: string; decimals: number | null; icon: string | null; category: SpotMarket["category"] }> | null;
  holdings: HoldingsState;
  onSettled: () => void;
  onRefresh: () => void;
  pro: boolean;
  /** The Trading Plan the address named (`?plan=&v=`), or null: a plain Spot ticket. */
  planBinding?: ExecutionPlanBinding | null;
  proven?: boolean;
  proving?: boolean;
  onProve?: () => void;
  onLeavePlan?: () => void;
  /** The side and the sum an asset page carried in, the ticket's opening state only. */
  initialSide?: SpotSide | null;
  initialAmount?: string | null;
  /** 1.31.0: the rule's reminder the address named (`?rule=&due=`), or null: the ticket is the rule's purchase while it is open. */
  ruleBinding?: RuleBinding | null;
  /** A reminder bought from the rule's own panel here: the ticket turns into its purchase. */
  onRuleBuy?: (binding: RuleBinding) => void;
  onLeaveRule?: () => void;
}) {
  const { text, locale } = useSolanaI18n();
  const { connection } = useSolanaConnection();
  const [side, setSide] = useState<SpotSide>(initialSide ?? "BUY");
  const [amount, setAmount] = useState(initialAmount ?? "");
  /* A carried sum survives the first market's arrival (the market reads after the ticket mounts); every later change of market is a new ticket. */
  const carriedAmount = useRef(initialAmount !== null);
  const [quoteMint, setQuoteMint] = useState<string>(SPOT_QUOTE_ASSETS[0].mint);
  /* «Ринок · Регулярно» (1.31.0): the order now, or the rule that reminds of it. */
  const [orderType, setOrderType] = useState<"market" | "recurring">("market");
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [ruleBusy, setRuleBusy] = useState(false);
  /* The wallet's rules, read behind its proof — the token's own rule, and the reminder the address named. */
  const rulesRead = useAutoinvestRules(proven);
  const [clockMs, setClockMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  /* The plan, read behind the wallet's proof — the same read My strategies
     makes. A plan is BUY in USDC by construction, so the ticket is set to
     that, the version's sized spend fills an empty amount once, and the
     binding goes with the order. What the server decides is on the Review. */
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
        setSide("BUY");
        setQuoteMint(SPOT_QUOTE_ASSETS[0].mint);
        setAmount((current) => (current.trim() === "" ? body.plan.current.sizing.notionalUsd.toFixed(2) : current));
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

  /* Every market trades. A tokenized stock or RWA carries its issuer in one
     line under the action, because whose terms apply is the one fact about it
     the chain does not say. */
  const availability = tradingAvailability({ category: market?.category ?? fallback?.category ?? null, mint: market?.mint ?? fallback?.mint ?? undefined, issuer: market?.issuer ?? null });
  const issuerLine = availability.allowed && availability.notice === "ISSUER_TERMS" ? (market?.issuer?.label ?? null) : null;
  const baseMint = market?.mint ?? fallback?.mint ?? null;
  const baseSymbol = market?.symbol ?? fallback?.symbol ?? "";

  /*
   * The reminder the address named: the rule must be the wallet's, its token
   * this market, and the reminder open now — then the ticket is its purchase.
   * Anything else is said in one line, and the ticket offers no plain order in
   * its place until the person leaves the rule.
   */
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
  const ruleSumUsd = underRule && boundRule ? purchaseSumUsd(boundRule, boundOccurrence) : null;
  /* The token's own rule, for «Регулярно»: managed where it stands, written where there is none. */
  const tokenRule = baseMint && rulesRead.state.status === "ready" ? ruleForMint(rulesRead.state.rules, baseMint) : null;
  const baseIcon = market?.icon ?? fallback?.icon ?? null;
  const baseHolding = baseMint ? holdingOf(holdings, baseMint) : null;
  const baseDecimals = baseHolding?.decimals ?? market?.decimals ?? fallback?.decimals ?? null;
  /* A tokenized stock with the Scaled UI Amount extension: the wallet, the
     venue's price and every figure on the Stocks page count the scaled unit
     (one base token stands for `multiplier` of them). The ticket says the base
     leg in that unit — what a person gets, holds, is guaranteed and types —
     and hands the venue the raw amount behind it (without this, NFLXx at ×10
     read "you get 0.13" for a wallet that would show 1.3). */
  const isStockMarket = market?.category === "stock";
  const stockAsset = useStockAsset(isStockMarket ? baseMint : null);
  const unitMultiplier = stockAsset?.chainMultiplier?.current ?? stockAsset?.row.multiplier?.current ?? null;
  const scaledBase = isScaledMultiplier(unitMultiplier) ? unitMultiplier : null;
  /** A raw base amount as the person reads it: in the wallet's unit for a scaled mint, else as it is. */
  const baseHuman = (raw: string, decimals: number): string => (scaledBase !== null ? scaledAmountString(BigInt(raw), decimals, scaledBase, 6) : displayAmount(raw, decimals));
  /** A number for the same. */
  const baseNumber = (raw: string, decimals: number): number | null => (scaledBase !== null ? Number(scaledAmountString(BigInt(raw), decimals, scaledBase, 9)) : rawToNumber(raw, decimals));

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
    setAmount("");
  }, [baseMint]);

  /* The rule's purchase is a purchase of its sum in USDC: the side, the asset paid with and the sum are set and held — after the new market's reset above, which runs in the same commit. */
  useEffect(() => {
    if (ruleSumUsd === null) return;
    setOrderType("market");
    setSide("BUY");
    setQuoteMint(SPOT_QUOTE_ASSETS[0].mint);
    /* The sum as typed by hand: «5», «5.50» — never «5.00». */
    setAmount(Number.isInteger(ruleSumUsd) ? String(ruleSumUsd) : ruleSumUsd.toFixed(2));
  }, [ruleSumUsd, baseMint]);

  /* A sale typed in scaled units travels to the hook as the base amount behind it; the hook and the routes keep speaking raw. */
  const hookAmount = useMemo(() => {
    if (side !== "SELL" || scaledBase === null || baseDecimals === null) return amount;
    const parsed = parseHumanAmount(amount, baseDecimals);
    if (!parsed.ok) return amount;
    return plainAmount(rawFromScaledRaw(BigInt(parsed.raw), scaledBase).toString(), baseDecimals);
  }, [amount, side, scaledBase, baseDecimals]);
  const ticket = useSpotTicket({ connection, side, baseMint, baseDecimals, baseSymbol, quote, amount: hookAmount, planBinding: underPlan ? planBinding : null, ruleBinding: underRule ? ruleBinding : null, text, onSettled: () => { onSettled(); void rulesRead.reload(); }, onRefresh });
  const { inputMint, outputMint, inputDecimals, outputDecimals, quoted, quoting, phase, prepared, settled, attempt } = ticket;
  /* A Review longer than a laptop's ticket opens at its own head — the countdown, then the four answers, just above
     «Підписати» — never half a row of the lines before it; a phone's ticket does not scroll on its own and is left
     where the person is. */
  const ticketRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = ticketRef.current;
    if (phase !== "REVIEW" || !prepared || !node || node.scrollHeight <= node.clientHeight + 1) return;
    const head = node.querySelector<HTMLElement>("[data-review-head]");
    const top = head ? head.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop - parseFloat(getComputedStyle(node).paddingTop) : node.scrollHeight;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
  }, [phase, prepared]);

  const inputHolding = inputMint ? holdingOf(holdings, inputMint) : null;
  const inputSymbol = side === "BUY" ? quote.symbol : baseSymbol;
  const outputSymbol = side === "BUY" ? baseSymbol : quote.symbol;
  const spendable = inputHolding ? (side === "SELL" ? baseNumber(inputHolding.spendableRaw, inputHolding.decimals) : rawToNumber(inputHolding.spendableRaw, inputHolding.decimals)) : null;

  /* A quick sale: a share of what the wallet holds, in the field as the wallet shows it. */
  const fillShare = useCallback(
    (numerator: bigint, denominator: bigint): string | null => {
      if (!inputHolding || holdings.status !== "ready") return null;
      const raw = BigInt(inputHolding.spendableRaw);
      if (raw <= 0n) return null;
      const share = denominator === 1n ? raw : (raw * numerator) / denominator;
      /* The field shows the wallet's unit; a scaled sale is typed in it and converted back on the way to the hook. */
      const value = side === "SELL" && scaledBase !== null ? scaledAmountString(share, inputHolding.decimals, scaledBase, Math.min(6, inputHolding.decimals)).replace(/\.?0+$/, "") : plainAmount(share.toString(), inputHolding.decimals);
      setAmount(value);
      return value;
    },
    [holdings.status, inputHolding, side, scaledBase],
  );

  /*
   * One tap: a quick sum or a quick share goes into the field, and the exact
   * Review opens on it as soon as the ticket can judge it — the wallet read,
   * the amount valid, the balance enough. The Review and the signature are the
   * same as every order's; the tap never signs. Anything typed afterwards, or
   * a balance that does not cover it, leaves the field filled and the Review
   * to the person's own press.
   */
  const [quickReview, setQuickReview] = useState<string | null>(null);
  const solUsd = (() => {
    const native = holdingOf(holdings, WRAPPED_SOL_MINT);
    const price = native?.catalog?.usdPrice ? Number(native.catalog.usdPrice) : null;
    return price !== null && Number.isFinite(price) && price > 0 ? price : null;
  })();
  const quickPayment = { symbol: quote.symbol, decimals: quote.decimals, dollar: quote.mint !== WRAPPED_SOL_MINT };
  const pickQuickBuy = (usd: number) => {
    const value = quickBuyAmount(usd, quickPayment, solUsd);
    if (value === null) return;
    setAmount(value);
    setQuickReview(value);
  };
  const pickQuickShare = (pct: number) => {
    const value = fillShare(BigInt(pct), 100n);
    if (value !== null) setQuickReview(value);
  };

  /* Both legs known, so «Перевірка» never offers a press its hook would ignore while the market is still read. */
  const amountOk = inputDecimals !== null && outputDecimals !== null && baseMint !== null && parseHumanAmount(hookAmount, inputDecimals).ok;
  const parsedAmount = inputDecimals === null ? null : parseHumanAmount(hookAmount, inputDecimals);
  const balanceKnown = holdings.status === "ready" && (inputHolding !== null || !holdings.partial);
  const insufficientBalance = balanceKnown && parsedAmount?.ok === true && BigInt(parsedAmount.raw) > BigInt(inputHolding?.spendableRaw ?? "0");
  const nativeHolding = holdingOf(holdings, WRAPPED_SOL_MINT);
  const cannotPayFee = holdings.status === "ready" && inputMint !== WRAPPED_SOL_MINT && nativeHolding !== null && BigInt(nativeHolding.spendableRaw) === 0n;
  const busy = phase === "PREPARING" || phase === "SIGNING" || phase === "EXECUTING" || phase === "RECOVERING";
  const order = prepared?.order ?? quoted?.order ?? null;
  const estimatedOut = order && outputDecimals !== null ? (side === "BUY" ? baseNumber(order.outAmountRaw, outputDecimals) : rawToNumber(order.outAmountRaw, outputDecimals)) : null;
  const rate = order && inputDecimals !== null && outputDecimals !== null ? (() => {
    /* The base leg in the wallet's unit on both sides, so the price is the price of what a person holds. */
    const inAmount = side === "SELL" ? baseNumber(order.inAmountRaw, inputDecimals) : rawToNumber(order.inAmountRaw, inputDecimals);
    const outAmount = side === "BUY" ? baseNumber(order.outAmountRaw, outputDecimals) : rawToNumber(order.outAmountRaw, outputDecimals);
    if (inAmount === null || outAmount === null || inAmount === 0 || outAmount === 0) return null;
    /* The market's price in the quote asset, whichever way the order runs. */
    return side === "BUY" ? inAmount / outAmount : outAmount / inAmount;
  })() : null;
  /* Jupiter states impact as a signed fraction of a percent; a favourable
     −0.0001 is not a warning and must not print as `-0.00%`. */
  const impactRaw = order ? Number(order.priceImpactPct) : null;
  const impact = impactRaw !== null && Number.isFinite(impactRaw) ? Math.max(0, Math.round(impactRaw * 100) / 100) : null;
  const impactTone = impact !== null ? (impact >= 3 ? "risk" : impact >= 1 ? "caution" : undefined) : undefined;
  const serviceFee = order ? ryntraServiceFee(order) : null;
  const additionalFee = order ? additionalJupiterFeeBps(order.totalFeeBasisPoints, serviceFee) : null;
  /* «Комісія Ryntra» with its amount: exact where `/build` takes it from what was typed, else ≈ a share of its side; the settled ticket states the chain's. */
  const serviceFeeLine = (none: string, joiner: "dot" | "parentheses" = "dot"): string =>
    order && serviceFee
      ? serviceFeeReviewText(
          serviceFee,
          { inputMint: order.inputMint, outputMint: order.outputMint, inputRaw: order.inAmountRaw, quotedOutputRaw: order.outAmountRaw },
          { [order.inputMint]: { decimals: inputDecimals, code: inputSymbol || null }, [order.outputMint]: { decimals: outputDecimals, code: outputSymbol || null } },
          { none, joiner, usd: { input: Number(order.inUsdValue) || null, output: Number(order.outUsdValue) || null } },
        )
      : none;
  const networkFeeSol = prepared
    ? (Number(BigInt(prepared.order.signatureFeeLamports) + BigInt(prepared.order.priorityFeeLamports)) / 1e9).toFixed(6)
    : null;
  const accountReserveSol = prepared && BigInt(prepared.order.rentFeeLamports) > 0n ? (Number(BigInt(prepared.order.rentFeeLamports)) / 1e9).toFixed(6) : null;
  const inputUsd = order?.inUsdValue ? Number(order.inUsdValue) : null;
  /* The wallet's position in this market, as the wallet shows it, priced at the market's live figure; nothing without a holding. */
  const position = useMemo(() => {
    if (!connection || !baseHolding || baseDecimals === null || !/^\d+$/.test(baseHolding.amountRaw) || BigInt(baseHolding.amountRaw) <= 0n) return null;
    const units = baseNumber(baseHolding.amountRaw, baseHolding.decimals);
    if (units === null || !Number.isFinite(units) || units <= 0) return null;
    const price = market?.price ?? null;
    return { units, usd: price !== null && Number.isFinite(price) ? units * price : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, baseHolding, baseDecimals, market?.price, scaledBase]);
  const amountRef = useRef<HTMLInputElement>(null);
  const openSale = useCallback(() => {
    setOrderType("market");
    setSide("SELL");
    setAmount("");
    /* The amount field is where the sale starts; on a phone it is under the chart, so it is brought into view. */
    window.requestAnimationFrame(() => {
      const field = amountRef.current;
      if (!field) return;
      field.focus({ preventScroll: true });
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      field.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    });
  }, []);
  const outputUsd = order?.outUsdValue ? Number(order.outUsdValue) : null;
  /* The asset's verdict outlives the estimate's own refresh — no «Review» flickers in for a blocked pair while the next estimate for the same amount is asked; another amount is judged afresh. */
  const [blockedPair, setBlockedPair] = useState<string | null>(null);
  useEffect(() => {
    if (quoted) setBlockedPair(quoted.verdict.verdict === "BLOCKED" ? `${quoted.order.inputMint}:${quoted.order.outputMint}:${quoted.order.inAmountRaw}` : null);
  }, [quoted]);
  const blocked = quoted ? quoted.verdict.verdict === "BLOCKED" : blockedPair === `${inputMint}:${outputMint}:${parsedAmount?.ok ? parsedAmount.raw : null}`;
  const reviewWarnings = prepared ? prepared.policy.verdict.findings.filter((finding) => finding.outcome === "REVIEW") : [];

  /* The quick tap's Review, once — and never over another Review, a signature in flight or an attempt to check. */
  const { review: openReview } = ticket;
  /* The tap's Review is brought into view once it opens — on a phone «Підписати» is under the fold — to the middle of the screen, never to its edge behind the bottom menu. */
  const quickOpened = useRef(false);
  useEffect(() => {
    if (quickReview === null) return;
    if (amount !== quickReview || !connection || attempt !== null || phase !== "IDLE") {
      setQuickReview(null);
      return;
    }
    if (!amountOk || holdings.status !== "ready") return;
    setQuickReview(null);
    if (insufficientBalance || cannotPayFee || blocked) return;
    quickOpened.current = true;
    void openReview();
  }, [quickReview, amount, connection, attempt, phase, amountOk, holdings.status, insufficientBalance, cannotPayFee, blocked, openReview]);
  /* A tap the ticket could not judge within ten seconds (the wallet still read) leaves the sum in the field and the Review to the person — never a Review that opens on its own minutes later. */
  useEffect(() => {
    if (quickReview === null) return undefined;
    const timer = window.setTimeout(() => setQuickReview(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [quickReview]);
  useEffect(() => {
    if (!quickOpened.current || phase === "PREPARING") return;
    quickOpened.current = false;
    if (phase !== "REVIEW" || !prepared) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.requestAnimationFrame(() => ticketRef.current?.querySelector<HTMLElement>("[data-terminal-cta]")?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" }));
  }, [phase, prepared]);
  const verb = side === "BUY" ? text("Buy") : text("Sell");

  /* The primary action, one at a time. */
  let cta: { label: string; disabled: boolean; onClick?: () => void } = { label: `${verb} ${baseSymbol}`.trim(), disabled: true };
  const action = spotTicketAction({
    phase, hasAttempt: attempt !== null, lockedReview: ticket.lockedReview !== null,
    hasPrepared: prepared !== null, reviewReady: prepared?.preSign.ready === true && ticket.preparedReadiness?.ready === true,
    amountValid: amountOk,
    insufficientBalance, cannotPayFee, blocked,
    quoteFailureRetryable: ticket.quoteFailure ? swapFailureCopy(ticket.quoteFailure.code, text).retryable : null,
    actionFailureRetryable: ticket.actionFailure ? swapFailureCopy(ticket.actionFailure.code, text).retryable : null,
  });
  switch (action) {
    case "RECOVER": cta = { label: text("Check transaction"), disabled: false, onClick: () => void ticket.recover() }; break;
    case "REFRESH_REVIEW": cta = { label: text("Get a new quote"), disabled: false, onClick: () => void ticket.cancelReview(true) }; break;
    case "SIGN": cta = { label: `${text("Sign")} · ${verb} ${baseSymbol}`, disabled: false, onClick: () => void ticket.sign() }; break;
    /* «Перевірка» waits for no estimate; one that failed is asked again beside it, once per press. */
    case "REVIEW": cta = { label: text("Review"), disabled: false, onClick: () => { if (ticket.quoteFailure) ticket.refreshQuote(); void ticket.review(); } }; break;
    case "INSUFFICIENT_BALANCE": cta = { label: text("Insufficient balance"), disabled: true }; break;
    case "NETWORK_FEE": cta = { label: text("Add SOL for the network fee"), disabled: true }; break;
    case "UNAVAILABLE": cta = { label: text("Not available right now"), disabled: true }; break;
    case "WAIT": cta = { label: phase === "PREPARING" ? text("Preparing Review…") : phase === "SIGNING" ? text("Waiting for wallet…") : phase === "EXECUTING" ? text("Sending…") : phase === "RECOVERING" ? text("Checking transaction…") : text("Pricing…"), disabled: true }; break;
  }
  /* A ticket under a plan that cannot be judged offers no plain order in its
     place: the wallet proves itself, the plan's own market opens, or the
     person leaves the plan on purpose. */
  if (planState && planState !== "ready" && action !== "RECOVER" && phase !== "SETTLED") {
    if (planState === "unproven") cta = { label: proving ? text("Confirming…") : text("Confirm wallet"), disabled: proving || !onProve, onClick: onProve };
    else if (planState === "loading") cta = { label: text("Reading the plan…"), disabled: true };
    else cta = { label: text("Not under this plan"), disabled: true };
  }
  /* The same for a rule's reminder: no plain order stands in for the rule's purchase. */
  if (ruleState && ruleState !== "ready" && action !== "RECOVER" && phase !== "SETTLED") {
    if (ruleState === "unproven") cta = { label: proving ? text("Confirming…") : text("Confirm wallet"), disabled: proving || !onProve, onClick: onProve };
    else if (ruleState === "loading") cta = { label: text("Reading the rule…"), disabled: true };
    else cta = { label: text("Not under this rule"), disabled: true };
  }
  /* What the server says of a rule's purchase, in the person's words. */
  const ruleRefusal = (() => {
    const code = ticket.actionFailure?.code ?? null;
    if (code === "RULE_LIQUIDITY_LOW") return text("The token's pool is under the floor for a recurring buy now — the rule's purchase waits.");
    if (code === "RULE_PRICE_CONDITION") return text("The rule's price condition is not met right now — its purchase waits.");
    if (code === "RULE_BUDGET_EXHAUSTED") return text("What is left of this month's budget does not cover the rule's purchase.");
    if (code === "RULE_NOT_DUE" || code === "RULE_NOT_FOUND" || code === "RULE_MISMATCH") return text("This reminder can no longer be bought — read the rule again.");
    /* Under a rule these two are the rule's own: a token's figures unread, or a token flagged since the rule was written — never a plan's or an issuer's words. */
    if (ruleBinding && code === "UNAVAILABLE") return text("The token's liquidity or price cannot be read right now — try again in a moment.");
    if (ruleBinding && code === "ASSET_NOT_OFFERED") return text("Jupiter's audit flags this token, or Ryntra no longer supports it — the rule does not buy it.");
    return null;
  })();
  const ruleLine = (() => {
    if (!ruleState) return null;
    if (ruleState === "ready" && boundRule && ruleSumUsd !== null) return `${usdWord(ruleSumUsd, locale === "uk" ? "uk" : "en")} · ${ruleWhenLine(boundRule, locale === "uk" ? "uk" : "en")}`;
    if (ruleState === "unproven") return text("Confirm your wallet to buy by your rule.");
    if (ruleState === "loading") return text("Reading the rule…");
    if (ruleState === "gone") return text("This rule is no longer in your wallet.");
    if (ruleState === "wrongMarket") return text("This market is not the rule's token.");
    if (ruleState === "bought") return text("This reminder's purchase is already bought.");
    if (ruleState === "pending") return text("A purchase under this reminder is already on its way.");
    if (ruleState === "deferred") return text("The rule's purchase waits — its rule says why.");
    return text("This reminder has closed. The next one comes on the rule's day.");
  })();
  const planReview = prepared?.planReview ?? (ticket.actionFailure?.planReview ?? null);
  /* The plan's price bound, for the stock block to say plainly when this order's per-share price is above it. */
  const planMaxPerShare = underPlan && plan ? plan.current.rules.entry.maxPricePerShare : null;
  const isStock = isStockMarket;
  /* What Simple folds: the provider and the route, an impact too small to warn about, the stock's secondary facts. */
  const foldImpact = !pro && impact !== null && impactTone === undefined;
  const hasDetails = !pro && order !== null;

  /* The settled answer, in the person's words. The ledger's states stay in the
     Receipt; `classifySpotFill` says whether this was a fill, nothing, or a
     landing the chain rejected, and the block below is shaped by that. */
  const settledReceipt = settled?.receipt ?? null;
  const outcome = settled ? classifySpotFill(settled) : null;
  const fillContext = ticket.settledContext;
  const { base: filledBase, quote: filledQuote, price: filledPrice } = spotFillAmounts(settled?.observation ?? null, fillContext);
  const filledSide = fillContext?.side ?? null;
  const filledBaseSymbol = fillContext?.baseSymbol ?? "";
  const filledQuoteSymbol = fillContext?.quoteSymbol ?? "";
  const settledFee = settled?.facts?.fees?.serviceFee ?? null;
  const settledTone = outcome === null ? "caution" : outcome.kind === "FILLED" && outcome.note === null ? "matched" : outcome.kind === "NOT_FILLED" ? "risk" : outcome.kind === "NOTHING_HAPPENED" ? "quiet" : "caution";
  const settledHeadline = (() => {
    if (!outcome) return text("Finished with a note");
    switch (outcome.kind) {
      case "FILLED":
        return outcome.note === null ? (filledSide === null ? text("Swapped") : filledSide === "BUY" ? text("Bought") : text("Sold")) : text("Filled, with a note");
      case "NOTHING_HAPPENED":
        return text("Nothing happened");
      case "NOT_FILLED":
        return text("Not filled");
      default:
        return text("Finished with a note");
    }
  })();
  const settledSentence = (() => {
    if (!outcome) return settled?.recovery ?? null;
    switch (outcome.kind) {
      case "FILLED":
        if (outcome.note === "BELOW_MINIMUM") return text("Less arrived than the reviewed minimum. The receipt keeps the reviewed and the settled figures side by side.");
        if (outcome.note === "NOT_AS_REVIEWED") return text("The chain's figures differ from the Review. The receipt keeps both.");
        if (filledBase === null) return text("Landed and receipted earlier. The receipt holds the amounts.");
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

  /* A token Ryntra no longer supports: no side of it trades here — the ticket says where it can be sold, and nothing else. A settled or recovering trade still shows its answer. */
  if (!availability.allowed && phase !== "SETTLED" && action !== "RECOVER") {
    return (
      <section className={`${styles.panel} ${styles.ticket}`} aria-label={text("Order ticket")} data-retired data-terminal-ticket>
        <p className={styles.retiredNotice} role="status">
          <b>{text("No longer supported in Ryntra")}</b>
          <span>{text("You can sell it in your own wallet")}</span>
        </p>
      </section>
    );
  }

  return (
    <section ref={ticketRef} className={`${styles.panel} ${styles.ticket}`} aria-label={text("Order ticket")} data-terminal-ticket>
      {phase === "SETTLED" && settled && outcome ? (
        <div className={styles.settled} data-settled data-kind={outcome.kind} data-tone={settledTone} role="status">
          <div className={styles.settledMark} data-tone={settledTone} aria-hidden="true">
            {settledTone === "matched" ? <CheckCircle size={26} weight="fill" /> : settledTone === "risk" ? <XCircle size={26} weight="fill" /> : <Warning size={26} weight="fill" />}
          </div>
          <div className={styles.settledHead} data-tone={settledTone}>
            <span className={styles.settledKicker}>{ruleBinding && filledSide === "BUY" ? text("Bought by your rule") : filledSide === null ? text("Swap") : filledSide === "BUY" ? text("Market buy") : text("Market sell")}{filledBaseSymbol ? ` · ${filledBaseSymbol}` : ""}</span>
            <b>{settledHeadline}</b>
          </div>
          {outcome.kind === "FILLED" && filledBase !== null ? (
            <div className={styles.fill}>
              <div className={styles.fillAmount} data-side={filledSide}>
                {filledSide === "BUY" ? "+" : "−"}{formatAmount(filledBase, locale)} <span>{filledBaseSymbol}</span>
              </div>
              {filledQuote !== null ? (
                <div className={styles.fillFor}>
                  {filledSide === "BUY" ? text("for") : text("received")} <b>{formatAmount(filledQuote, locale)} {filledQuoteSymbol}</b>
                </div>
              ) : null}
              <dl className={styles.fillFacts}>
                {filledPrice !== null ? (
                  <div>
                    <dt>{text("Price")}</dt>
                    <dd>1 {filledBaseSymbol} ≈ {formatPrice(filledPrice, locale)} {filledQuoteSymbol}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{text("Ryntra fee")}</dt>
                  <dd>{settledFee ? serviceFeeText(settledFee, text("None")) : text("None")}</dd>
                </div>
              </dl>
            </div>
          ) : null}
          {settledSentence ? <p className={styles.settledSentence}>{settledSentence}</p> : null}
          {/* The loop's last step: a purchase made under a plan is watched from here on for its loss limit. */}
          {outcome.kind === "FILLED" && filledSide === "BUY" && underPlan && plan ? (
            <p className={styles.settledWatch}>
              <span>
                {text("Ryntra watches your loss limit")} <b>{formatUsdPrice(plan.current.rules.risk.invalidationPerShare, locale)}</b>
              </span>
              <Link href={`/app/strategies/plans/${encodeURIComponent(plan.id)}`} prefetch={false}>
                {text("Open the plan")}
              </Link>
            </p>
          ) : null}
          {outcome.kind !== "NOTHING_HAPPENED" ? (
            <div className={styles.settledLinks}>
              <a className={styles.ghost} href={explorerTxUrl("mainnet", settled.signature)} target="_blank" rel="noreferrer noopener">
                {text("Explorer")} <ArrowUpRight size={12} aria-hidden="true" />
              </a>
              {settledReceipt ? (
                <button type="button" className={styles.ghost} onClick={() => downloadReceipt(settledReceipt)}>{text("Receipt")}</button>
              ) : null}
              <Link className={styles.ghost} href="/app/activity">{text("History")}</Link>
            </div>
          ) : null}
          {/* The card of this trade, with the person's invitation link — read afresh for the trade just settled; nothing until the wallet has proved itself and the trade is measured. */}
          {outcome.kind === "FILLED" && baseMint ? <ShareTrade key={settled.signature} mint={baseMint} /> : null}
          <button type="button" className={outcome.kind === "FILLED" ? styles.secondary : styles.cta} onClick={() => { ticket.reset(); setAmount(""); onRefresh(); if (ruleBinding) onLeaveRule?.(); }}>
            {outcome.kind === "NOTHING_HAPPENED" ? text("Trade again") : text("New order")}
          </button>
        </div>
      ) : null}

      {phase !== "SETTLED" || !settled ? (
        <>
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
          {/* «Твоя позиція», as on a company's page: what the wallet holds of this market and what it is worth, and
              «Продати» — quiet, the ticket's own action stays the one orange press. The press turns this ticket to the
              sale and puts the cursor in its amount: the same Review, signature and receipt as every sale here. */}
          {position ? (
            <div className={styles.position} data-position data-dense>
              <div className={styles.positionText}>
                <span className={styles.positionLabel}>{text("Your position")}</span>
                <b className={styles.positionValue} translate="no">{position.usd === null ? "—" : formatUsdPrice(position.usd, locale)}</b>
                <span className={styles.positionUnits} translate="no">{`${formatAmount(position.units, locale)} ${baseSymbol}`}</span>
              </div>
              {side === "SELL" && orderType === "market" ? null : (
                <button type="button" className={styles.positionSell} data-position-sell disabled={busy || phase === "REVIEW" || underPlan || underRule} onClick={openSale}>
                  {text("Sell")}
                </button>
              )}
            </div>
          ) : null}
          {/* «Ринок · Регулярно»: the order now, or the rule that reminds of it — on every token. */}
          <div className={styles.ticketRow}>
            <div
              className={styles.orderTypes}
              data-dense
              role="tablist"
              aria-label={text("Order type")}
              onKeyDown={(event) => {
                /* The arrows move between the two order types, as a tab list does. */
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                const next = orderType === "market" ? "recurring" : "market";
                if (next === "recurring" && (!baseMint || underRule || busy || phase === "REVIEW")) return;
                if (next === "market" && ruleBusy) return;
                event.preventDefault();
                setOrderType(next);
                event.currentTarget.querySelector<HTMLButtonElement>(`[data-order-type="${next}"]`)?.focus();
              }}
            >
              <button type="button" role="tab" id="spot-order-market" tabIndex={orderType === "market" ? 0 : -1} className={styles.orderTypeTab} aria-selected={orderType === "market"} onClick={() => setOrderType("market")} disabled={ruleBusy} data-order-type="market">
                {text("Market")}
              </button>
              <button
                type="button"
                role="tab"
                id="spot-order-recurring"
                aria-controls="spot-order-panel"
                tabIndex={orderType === "recurring" ? 0 : -1}
                className={styles.orderTypeTab}
                aria-selected={orderType === "recurring"}
                onClick={() => setOrderType("recurring")}
                disabled={!baseMint || underRule || busy || phase === "REVIEW"}
                data-order-type="recurring"
              >
                {text("Recurring")}
              </button>
            </div>
          </div>
          {orderType === "recurring" && baseMint ? (
            !connection ? (
              <div className={styles.recurringGuest} role="tabpanel">
                <p>{text("A rule reminds you on its day — you sign every purchase. Your money stays in your wallet.")}</p>
                <WalletConnectRow />
              </div>
            ) : !proven ? (
              <div className={styles.recurringGuest} role="tabpanel">
                <p>{text("Confirm your wallet to set or see a rule on this token.")}</p>
                <button type="button" className={styles.cta} disabled={proving || !onProve} onClick={onProve}>
                  {proving ? text("Confirming…") : text("Confirm wallet")}
                </button>
              </div>
            ) : rulesRead.state.status !== "ready" ? (
              <p className={styles.note} role="tabpanel">{rulesRead.state.status === "failed" ? text("Your rules could not be read right now.") : text("Reading the rule…")}</p>
            ) : (
              <div role="tabpanel" id="spot-order-panel" aria-labelledby="spot-order-recurring" className={styles.recurringPanel}>
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
                  onClose={() => setOrderType("market")}
                  onConnect={() => undefined}
                  onCreate={rulesRead.create}
                  onSetStatus={rulesRead.setStatus}
                  onRemove={rulesRead.remove}
                  onEditBudget={() => setBudgetOpen(true)}
                  onMarkOwn={rulesRead.markOwn}
                  onBuyNow={(rule, occurrence) => {
                    /* A token's reminder is bought here; a company's on its own page, where its Review is. */
                    if (!isStockMarket && onRuleBuy) onRuleBuy({ ruleId: rule.id, dueAt: occurrence.dueAt });
                    else window.location.assign(rulePurchaseHref(rule, occurrence.dueAt));
                  }}
                />
              </div>
            )
          ) : null}
          <BudgetSheet open={budgetOpen} budget={rulesRead.state.budget} locale={locale} onClose={() => setBudgetOpen(false)} onSave={rulesRead.setBudget} onClear={rulesRead.clearBudget} />
          {orderType === "market" ? (
          <>
          <div className={styles.sides} data-dense role="group" aria-label={text("Side")}>
            {(["BUY", "SELL"] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                className={styles.side}
                data-side={entry}
                aria-pressed={side === entry}
                disabled={busy || phase === "REVIEW" || ((underPlan || underRule) && entry === "SELL")}
                onClick={() => {
                  setSide(entry);
                  setAmount("");
                }}
              >
                {entry === "BUY" ? text("Buy") : text("Sell")}
              </button>
            ))}
          </div>

          <div className={styles.amountBox}>
            <div className={styles.amountHead}>
              <span>{side === "BUY" ? text("Spend") : text("Amount")}</span>
              {connection && !inputHolding && holdings.partial ? (
                /* One token program answered and the other did not; the hook
                   is reading again. A missing row is not a zero balance. */
                <span>{text("Some balances could not be read.")}</span>
              ) : connection ? (
                <span>
                  {text("Available")}{" "}
                  {holdings.status === "unavailable" && !inputHolding ? "—" : spendable === null ? (holdings.status === "loading" ? "…" : "0") : formatAmount(spendable, locale)}
                  {spendable !== null || inputHolding ? ` ${inputSymbol}` : ""}
                </span>
              ) : null}
            </div>
            <div className={styles.amountLine}>
              <input
                ref={amountRef}
                className={styles.amountInput}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                placeholder="0.0"
                value={amount}
                disabled={busy || !baseMint || underRule}
                aria-label={side === "BUY" ? `${text("Spend")}, ${inputSymbol}` : `${text("Amount")}, ${inputSymbol}`}
                onChange={(event) => setAmount(event.target.value.replace(/,/g, "."))}
              />
              {side === "BUY" ? (
                <QuoteAssetSwitch
                  label={text("Pay with")}
                  value={quote.mint}
                  options={SPOT_QUOTE_ASSETS.filter((asset) => asset.mint !== baseMint)}
                  disabled={busy || phase === "REVIEW" || underRule}
                  onChange={(mint) => { setQuoteMint(mint); setAmount(""); }}
                />
              ) : (
                <span className={styles.assetPill}>
                  {baseMint ? <MarketIcon mint={baseMint} icon={baseIcon} symbol={baseSymbol || "?"} size={22} /> : null}
                  {baseSymbol}
                </span>
              )}
            </div>
            {/* The dollar value of what is typed, wherever it is not a dollar already. */}
            {inputUsd !== null && (side === "SELL" || quote.symbol !== "USDC") ? <span className={styles.usdLine}>≈ {formatUsdPrice(inputUsd, locale)}</span> : null}
            {/* «Швидка купівля» — the person's dollar sums — and «Швидкий продаж» — shares of the position: one tap
                puts it in the field and opens the Review. A Review fixes the amount: the chips leave it, and its answers
                stand closer to «Підписати». */}
            {!underRule && phase !== "REVIEW" ? (
              side === "BUY" ? (
                <QuickBuy
                  locale={locale === "uk" ? "uk" : "en"}
                  onPick={pickQuickBuy}
                  disabled={busy || !baseMint || (!quickPayment.dollar && solUsd === null)}
                  note={!quickPayment.dollar && solUsd === null ? (connection ? text("SOL's price is not read yet: pay in USDC or type the amount.") : text("Connect a wallet to buy in SOL by the dollar, or pay in USDC.")) : null}
                />
              ) : connection ? (
                <QuickSell locale={locale === "uk" ? "uk" : "en"} shares={QUICK_SELL_SHARES_PCT} onPick={pickQuickShare} disabled={!inputHolding || holdings.status !== "ready" || busy} />
              ) : null
            ) : null}
          </div>

          <div className={styles.receiveLine} data-state={estimatedOut === null ? "pending" : "ready"}>
            <span>{side === "BUY" ? text("You get") : text("You receive")}{prepared ? "" : ` · ${text("estimate")}`}</span>
            <b>{estimatedOut === null ? (quoting ? text("Pricing…") : "—") : `${formatAmount(estimatedOut, locale)} ${outputSymbol}`}</b>
            {estimatedOut !== null && outputUsd !== null && Number.isFinite(outputUsd) ? <span className={styles.receiveUsd}>≈ {formatUsdPrice(outputUsd, locale)}</span> : null}
          </div>

          {side === "SELL" ? (
            <div className={styles.ticketRow}>
              <span>{text("Receive in")}</span>
              <QuoteAssetSwitch
                label={text("Receive in")}
                value={quote.mint}
                options={SPOT_QUOTE_ASSETS.filter((asset) => asset.mint !== baseMint)}
                disabled={busy || phase === "REVIEW"}
                onChange={setQuoteMint}
              />
            </div>
          ) : null}

          {order ? (
            <dl className={styles.costs}>
              <div>
                <dt>{text("Price")}</dt>
                <dd>{rate === null ? "—" : `1 ${baseSymbol} ≈ ${formatPrice(rate, locale)} ${quote.symbol}`}</dd>
              </div>
              {!foldImpact ? (
                <div>
                  <dt>{text("Price impact")}</dt>
                  <dd data-tone={impactTone}>{impact === null ? "—" : `${impact.toFixed(2)}%`}</dd>
                </div>
              ) : null}
              {prepared ? (
                <div>
                  <dt>{text("Minimum received")}</dt>
                  <dd>{outputDecimals !== null ? `${side === "BUY" ? baseHuman(prepared.order.minReceivedRaw, outputDecimals) : displayAmount(prepared.order.minReceivedRaw, outputDecimals)} ${outputSymbol}` : "—"}</dd>
                </div>
              ) : null}
              {networkFeeSol !== null ? (
                <div>
                  <dt>{text("Network fee")}</dt>
                  <dd>{networkFeeSol} SOL</dd>
                </div>
              ) : null}
              {accountReserveSol !== null ? (
                <div>
                  <dt>{text("Account reserve")}</dt>
                  <dd>{accountReserveSol} SOL</dd>
                </div>
              ) : null}
              <div>
                <dt>{text("Ryntra fee")}</dt>
                <dd translate="no">{serviceFee ? serviceFeeLine(text("None")) : "—"}</dd>
              </div>
              {additionalFee !== null && additionalFee > 0 ? (
                <div><dt>{text("Additional Jupiter fee")}</dt><dd>{(additionalFee / 100).toFixed(2)}%</dd></div>
              ) : null}
              {pro ? <div><dt>{text("Provider")}</dt><dd>Jupiter</dd></div> : null}
              {pro && order.route.length > 0 ? (
                <div>
                  <dt>{text("Route")}</dt>
                  <dd>{order.route.map((hop) => hop.label).join(" → ")}</dd>
                </div>
              ) : null}
              {prepared ? (
                <div>
                  <dt>{text("Slippage")}</dt>
                  <dd>{(prepared.order.slippageBps / 100).toFixed(2)}%</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {serviceFee?.mechanism === "JUPITER_REFERRAL" && serviceFee.basisPoints > 0 ? (
            <p className={styles.note}>{text("Includes Jupiter's share. Already included in the quote.")}</p>
          ) : null}
          {/* A tokenized stock's Review carries a Market and an Asset block:
              the reviewed amount in underlying units, the executable per-share
              price against the issuer's reference, the session and the units.
              They never replace the quote, the minimum received or the fees
              above. */}
          {isStock && order && baseMint ? (
            <StockReviewBlock mint={baseMint} side={side} order={order} tokenDecimals={market.decimals} variant={pro ? "full" : "essential"} planMaxPerShare={planMaxPerShare} />
          ) : null}
          {hasDetails && order ? (
            <details className={styles.ticketDetails}>
              <summary>{text("Details")}</summary>
              <dl className={styles.costs}>
                {foldImpact ? (
                  <div>
                    <dt>{text("Price impact")}</dt>
                    <dd>{`${impact.toFixed(2)}%`}</dd>
                  </div>
                ) : null}
                <div><dt>{text("Provider")}</dt><dd>Jupiter</dd></div>
                {order.route.length > 0 ? (
                  <div>
                    <dt>{text("Route")}</dt>
                    <dd>{order.route.map((hop) => hop.label).join(" → ")}</dd>
                  </div>
                ) : null}
              </dl>
              {isStock && baseMint ? <StockReviewBlock mint={baseMint} side={side} order={order} tokenDecimals={market.decimals} variant="details" planMaxPerShare={null} /> : null}
            </details>
          ) : null}
          {/* The Strategy block: the server's judgement of the plan on this exact
              order — on the Review it may sign, and on the refusal it may not. */}
          {planReview && (phase === "REVIEW" || ticket.actionFailure?.planReview) ? (
            <PlanReviewBlock review={planReview} plan={plan} onUseFit={(usd) => setAmount(usd.toFixed(2))} />
          ) : null}

          {phase === "REVIEW" && prepared ? (
            <div className={styles.reviewHead} data-review-head>
              <b>{ticket.preparedReadiness?.ready ? text("Exact Review") : text("Review needs refreshing")}</b>
              <span>{ticket.reviewSecondsLeft === null ? "…" : ticket.reviewSecondsLeft > 0 ? `${ticket.reviewSecondsLeft}s` : text("expired")}</span>
            </div>
          ) : null}
          {/* The four answers of the Review at its first level: what leaves the
              wallet, what arrives at least, what it all costs, and whether the
              order fits the plan — before any provider, route or check row. The
              figures are the exact Review's own; the rows above and the folds
              below keep every detail. */}
          {phase === "REVIEW" && prepared && order && inputDecimals !== null && outputDecimals !== null ? (
            <dl className={styles.reviewAnswers} aria-label={text("Review in four answers")}>
              <div>
                <dt>{text("Leaves your wallet")}</dt>
                <dd translate="no">{`${side === "SELL" ? (baseHuman(order.inAmountRaw, inputDecimals) ?? displayAmount(order.inAmountRaw, inputDecimals)) : displayAmount(order.inAmountRaw, inputDecimals)} ${inputSymbol}`}{inputUsd !== null && (side === "SELL" || quote.symbol !== "USDC") ? ` ≈ ${formatUsdPrice(inputUsd, locale)}` : ""}</dd>
              </div>
              <div>
                <dt>{text("Arrives, at least")}</dt>
                <dd translate="no">{`${side === "BUY" ? baseHuman(prepared.order.minReceivedRaw, outputDecimals) : displayAmount(prepared.order.minReceivedRaw, outputDecimals)} ${outputSymbol}`}{estimatedOut !== null ? ` · ${text("expected")} ${formatAmount(estimatedOut, locale)}` : ""}</dd>
              </div>
              <div>
                <dt>{text("All costs")}</dt>
                <dd translate="no">{[
                  networkFeeSol !== null ? `${text("network")} ${networkFeeSol} SOL` : null,
                  accountReserveSol !== null ? `${text("account reserve")} ${accountReserveSol} SOL` : null,
                  serviceFee ? `Ryntra ${serviceFeeLine(text("None"), "parentheses")}` : null,
                  additionalFee !== null && additionalFee > 0 ? `Jupiter ${(additionalFee / 100).toFixed(2)}%` : null,
                  impact !== null && impact > 0 ? `${text("impact")} ${impact.toFixed(2)}%` : null,
                  `${text("slippage up to")} ${(prepared.order.slippageBps / 100).toFixed(2)}%`,
                ].filter(Boolean).join(" · ")}</dd>
              </div>
              {underRule && boundRule && ruleSumUsd !== null ? (
                <div data-verdict="rule">
                  <dt>{text("Your rule")}</dt>
                  <dd translate="no">{`${usdWord(ruleSumUsd, locale === "uk" ? "uk" : "en")} · ${boundRule.name} · ${lowerFirst(ruleWhenLine(boundRule, locale === "uk" ? "uk" : "en"))}`}</dd>
                </div>
              ) : (
                <div data-verdict={planReview ? planReview.verdict : underPlan ? "loading" : "none"}>
                  <dt>{text("Your plan")}</dt>
                  <dd>{planReview ? (planReview.verdict === "ready" ? text("Within the plan") : planReview.verdict === "attention" ? text("Within the plan · your call") : `${text("Outside the plan")}${planRefusalSentence(planReview, text) ? ` — ${planRefusalSentence(planReview, text)}` : ""}`) : planBinding ? text("Reading the plan…") : text("No plan — a plain order")}</dd>
                </div>
              )}
            </dl>
          ) : null}
          {reviewWarnings.length > 0 ? <p className={styles.warning}>{text("Review this order carefully.")}</p> : null}
          {blocked ? <p className={styles.error}>{text("This asset did not pass Ryntra's checks, so no order is offered for it.")}</p> : null}
          {ticket.quoteFailureMessage && amountOk && !blocked && ((!prepared && !ticket.actionFailure && phase === "IDLE") || (ticket.quoteFailure !== null && !swapFailureCopy(ticket.quoteFailure.code, text).retryable)) ? <p className={styles.error}>{ticket.quoteFailureMessage}</p> : null}
          {ruleRefusal ? <p className={styles.error}>{ruleRefusal}</p> : ticket.actionFailureMessage ? <p className={styles.error}>{ticket.actionFailureMessage}</p> : null}
          {connection && (holdings.status === "unavailable" || holdings.partial) ? (
            <p className={styles.note}>{text("Some balances could not be read.")} <button className={styles.ghost} type="button" onClick={onRefresh} disabled={busy}>{text("Read again")}</button></p>
          ) : null}
          {phase === "RECOVERY" && settled?.recovery ? <p className={styles.warning}>{settled.recovery}</p> : null}
          {/* A rule's reminder open for this token: a purchase here leaves it open — said before the action, with the way to the rule's own purchase. */}
          {connection && side === "BUY" && !ruleBinding ? <RuleReminderNotice mint={baseMint} proven={proven} locale={locale} className={styles.ruleReminder} onBuy={!isStockMarket ? onRuleBuy : undefined} /> : null}

          {/* The order's actions: on a desk they stay at the foot of the ticket while a long Review scrolls under them. */}
          <div className={styles.ticketActions}>
            {!connection && !attempt ? (
              <WalletConnectRow />
            ) : (
              <button type="button" className={styles.cta} data-terminal-cta data-dense disabled={cta.disabled} onClick={cta.onClick}>
                {cta.label}
              </button>
            )}
            {connection && phase === "REVIEW" && prepared && !ticket.bytesChanged ? (
              <button type="button" className={styles.secondary} data-dense onClick={() => void ticket.cancelReview()} disabled={busy}>
                {text("Cancel")}
              </button>
            ) : null}
          </div>
          {availability.allowed && availability.notice === "ISSUER_TERMS" ? (
            <p className={styles.issuerLine}>
              {issuerLine ? <>{text("Tokenized by")} {issuerLine} · </> : null}{text("the issuer's terms apply")}
            </p>
          ) : null}
          {connection && phase === "IDLE" && quoted && ticket.secondsLeft !== null && ticket.secondsLeft <= 0 ? (
            <p className={styles.note}>{text("The quote expired; a fresh one is on its way.")}</p>
          ) : null}
          </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
