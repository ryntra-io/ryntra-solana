"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsDownUp, ArrowUpRight, CaretDown, Info } from "@phosphor-icons/react";
import type { PlanCardRiskItem } from "@/app/components/plan-card";
import type { CbCopy } from "@/app/app/copy";
import { watchResolvedTheme } from "@/app/app/theme";
import { ProChart } from "@/app/components/chart/ProChart";
import { fromSpotCandle, tfToSeconds, type NormalizedCandle } from "@/lib/chart/types";
import { FLAGS } from "@/app/config/features";
import {
  USDG_ADDRESS, USDG_DECIMALS, formatUnits, parseUnits,
  type SpotQuote, type SpotQuoteResponse, type SpotToken,
} from "@/lib/arcus/spot";
import {
  readRialtoDirectRoutePin,
  readRialtoExecutionTokenMetadata,
  readSpotQuoteFee,
  SPOT_MIN_NOTIONAL_USDG,
} from "@/lib/arcus/spot-exec-policy";
import {
  approvePermit2, getEth, needsPermit2Approval, prepareSpotSwap, readBalance, readTokenDecimals,
  SpotApprovalRequiredError, SpotApprovalRevertedError, SpotApprovalUnknownError,
  SpotIntentExpiredError, SpotSubmissionRejectedError, SpotSubmissionRevertedError, SpotSubmissionUnknownError,
  readTransactionOutcome, submitPreparedSpotSwap,
  type Eth, type ExecStep, type PreparedSpotSwap,
} from "@/lib/arcus/spot-exec";
import { usMarketOpen } from "@/lib/market-hours";
import { classifyRwaRisk, computePremiumPct, HIGH_PREMIUM_PCT, type RwaRiskLevel, type RwaAssetType } from "@/lib/rwa/risk";
import type { ArcusMarket } from "@/lib/arcus/public";
import { LINKS } from "@/lib/beta/types";
import { MarketPicker } from "./market-picker";
import { corporateActionStatus, readOracleReading, readStockTokenOnchain, readUiMultiplier, stockTokenIntel, type StockTokenOnchain } from "@/lib/rwa/stock-token";
import { sharesFromTokenAmount, UI_MULTIPLIER_ONE } from "@/lib/token/ui-multiplier";
import { classifyCompliance, isSpotComplianceReady, type ArcusCompliance, type ComplianceVerdict } from "@/lib/compliance/gate";
import { classifyOracleFresh, type OracleFeed } from "@/lib/rwa/oracle-feeds";
import { quoteUniswapV3, type UniswapV3QuoteResult } from "@/lib/venues/uniswap/quote";
import { computePortfolioHeat, type HeatHolding } from "@/lib/domain/portfolio-heat";
import { ROUTES } from "@/lib/domain/ids";
import { routeCapability, claimFor } from "@/lib/domain/registry";
import { rankQuotes, compareAmounts, type RouteQuote } from "@/lib/domain/routes";
import { freshnessOf, orderbookAllowed } from "@/lib/domain/capability";
import { evaluateReadiness, SPOT_SWAP_POLICY } from "@/lib/domain/readiness";
import { newIdempotencyKey } from "@/lib/domain/execution-safety";

type OverviewItem = { ticker: string; name: string; contractAddress: string; logoUrl?: string | null; category?: string; quote?: { price?: number; changePercent24h?: number; volume24h?: number } | null; financials?: { marketCap?: number } | null };
type SpotCandle = { openTime: number; open: string; high: string; low: string; close: string; volume?: string };
const TFS = ["5m", "15m", "1h", "4h", "1d"] as const;
const MIN_NOTIONAL_USDG = SPOT_MIN_NOTIONAL_USDG;
/** Re-read the on-chain ERC-8056 snapshot (corporate-action schedule + oracle-pause) on this
    cadence so a newly-scheduled action, or an on-chain self-heal after a processing window,
    is observed without the user re-selecting the token. Corporate actions move on the order of
    hours (RHJ effective windows), so a minute is plenty — 4 eth_calls/min is cheap. */
const STI_POLL_MS = 60_000;
const fmtPrice = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Swaps executed through Ryntra, kept on this device — the Arcus indexer can lag
   well behind on-chain settlement. Native balances update at settlement; a long-tail fill can
   deliver a WRAPPED token instead (wTSLA-style), which settles to the real token on the maker's
   cadence — Holdings reads both so a wrapped fill is never invisible. */
/** Pick the venue quote we can actually execute. Arcus's own "arcus" venue (usually `all[0]` /
    recommended) is a GASLESS submit whose /v1/submit needs a server-held takerIntentId — not
    integrable by a third party (verified live 2026-07-10). The executable venues carry a
    self-contained `tx.data` (Permit2-splice path, e.g. rialto → Arcus settlement router). We must
    pick one of those; if only gasless venues exist, there is no executable quote. */
function pickRialtoWalletQuote(all: SpotQuote[] | undefined): SpotQuote | null {
  if (!all) return null;
  return all.find((q) =>
    q.venue.toLowerCase() === "rialto"
    && typeof q.tx?.data === "string"
    && q.tx.data.includes("ab".repeat(65))
  ) ?? null;
}

function hasAuditedRialtoExecution(sellToken: SpotToken | null, buyToken: SpotToken | null): boolean {
  if (!sellToken || !buyToken) return false;
  const sellMetadata = readRialtoExecutionTokenMetadata(sellToken.address);
  const buyMetadata = readRialtoExecutionTokenMetadata(buyToken.address);
  if (
    !sellMetadata || !buyMetadata
    || sellToken.symbol !== sellMetadata.symbol || sellToken.decimals !== sellMetadata.decimals
    || buyToken.symbol !== buyMetadata.symbol || buyToken.decimals !== buyMetadata.decimals
  ) return false;
  try {
    return readRialtoDirectRoutePin(sellToken.address, buyToken.address) !== null;
  } catch {
    return false;
  }
}

type LocalSwap = { hash: string; at: number; sellSym: string; sellAmt: string; buySym: string; buyAmt: string };
type PendingSpotSwap = {
  intent: PreparedSpotSwap;
  contextKey: string;
  sellSym: string;
  sellAmt: string;
  buySym: string;
  buyAmt: string;
};
type Permit2ApprovalState = "idle" | "checking" | "required" | "sufficient" | "unavailable";
type SubmissionAttempt = {
  v: 1;
  kind: "approval" | "swap";
  address: string;
  startedAt: number;
  hash: string | null;
  quoteId: string | null;
  swap: Omit<LocalSwap, "hash" | "at"> | null;
};
const submissionAttemptKey = (addr: string) => `ryntra-spot-attempt:${addr.toLowerCase()}`;
const swapsKey = (addr: string) => `ryntra-spot-swaps:${addr.toLowerCase()}`;
function loadLocalSwaps(addr: string): LocalSwap[] {
  try {
    const j = JSON.parse(window.localStorage.getItem(swapsKey(addr)) ?? "null") as { v?: number; swaps?: LocalSwap[] } | null;
    return j?.v === 1 && Array.isArray(j.swaps) ? j.swaps : [];
  } catch { return []; }
}
function saveLocalSwaps(addr: string, swaps: LocalSwap[]): void {
  try { window.localStorage.setItem(swapsKey(addr), JSON.stringify({ v: 1, swaps: swaps.slice(0, 50) })); } catch { /* quota */ }
}
const fmtSwapTime = (ms: number) =>
  ms > 0 ? new Date(ms).toLocaleString("en-GB", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";

/** Robinhood Chain explorer (robinhood-chain-truth) — every history row links to the real tx. */
const EXPLORER_TX = "https://robinhoodchain.blockscout.com/tx/";

/* Unified swap-history row (local + indexer), so the money surface shows readable columns —
   never a raw JSON dump — and never double-counts a swap once the indexer catches up. */
type HistRow = { at: number; summary: string; hash: string; src: "local" | "indexed"; valueUsd: number | null };
function loadSubmissionAttempt(addr: string): SubmissionAttempt | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(submissionAttemptKey(addr)) ?? "null") as SubmissionAttempt | null;
    if (
      value?.v !== 1
      || (value.kind !== "approval" && value.kind !== "swap")
      || value.address.toLowerCase() !== addr.toLowerCase()
      || !Number.isFinite(value.startedAt)
      || (value.hash !== null && !/^0x[0-9a-fA-F]{64}$/.test(value.hash))
      || (value.kind === "swap" && (!value.quoteId || !value.swap))
    ) return null;
    return value;
  } catch { return null; }
}
function saveSubmissionAttempt(addr: string, attempt: SubmissionAttempt): boolean {
  try {
    const encoded = JSON.stringify(attempt);
    window.localStorage.setItem(submissionAttemptKey(addr), encoded);
    return window.localStorage.getItem(submissionAttemptKey(addr)) === encoded;
  } catch {
    return false;
  }
}
function clearSubmissionAttempt(addr: string): boolean {
  try {
    window.localStorage.removeItem(submissionAttemptKey(addr));
    return window.localStorage.getItem(submissionAttemptKey(addr)) === null;
  } catch {
    return false;
  }
}

/** first non-empty string field among candidate keys (the indexer shape is loose/undocumented). */
function firstStr(t: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) { const v = t[k]; if (v != null && v !== "") return String(v); }
  return null;
}
/** parse an indexer timestamp (unix seconds, unix ms, or ISO) into ms; 0 when unknown. */
function parseTradeTime(v: string | null): number {
  if (!v) return 0;
  if (/^\d+$/.test(v)) { const n = Number(v); return v.length <= 10 ? n * 1000 : n; }
  const p = Date.parse(v);
  return Number.isNaN(p) ? 0 : p;
}
/** best-effort human summary of an indexed trade (side · amount · pair) — never a raw JSON dump. */
function tradeSummary(t: Record<string, unknown>): string {
  const side = firstStr(t, ["side", "direction", "type"]);
  const pair = firstStr(t, ["market", "pair", "symbol"]);
  const amount = firstStr(t, ["amount", "size", "baseAmount", "fillAmount", "sellAmount"]);
  const s = [side, amount, pair].filter(Boolean).join(" ").trim();
  return s || "Swap";
}

/* ---- Stock Token Risk cockpit ----
   Honest baseline: what we measure today (US-hours estimate, 24h volume) is shown as
   data; oracle / multiplier / corporate-action checks are shown as `Next` (muted) until the
   Chainlink/on-chain adapters ship — never faked. Verdict comes from lib/rwa/risk.
   The default surface is intentionally compact; methodology stays available on demand. */
const RISK_LABEL: Record<RwaRiskLevel, string> = { ok: "OK", caution: "Caution", avoid: "Avoid", unknown: "Partial data" };



export type MarketState = { open: boolean | null; source: "venue" | "est" };

/** Shared inputs for the risk verdict — computed once, reused by the header pill and the cockpit.
    `oraclePaused` comes from the live on-chain ERC-8056 read (null until read / on failure — the
    engine treats null as "partial data", never as all-clear). */
function riskSnapshotFor(stock: string, assetType: RwaAssetType, market: MarketState, oraclePaused: boolean | null, oracleFresh: boolean | null, premiumPct: number | null, corporateAction: CorporateActionState) {
  const crypto = assetType === "crypto";
  return classifyRwaRisk({
    symbol: stock,
    assetType,
    marketOpen: crypto ? null : market.open,
    marketOpenSource: market.source,
    offHours: crypto ? false : market.open === false,
    oracleFresh: crypto ? null : oracleFresh,
    oraclePaused: crypto ? null : oraclePaused,
    sequencerUp: null,
    spreadBps: null,
    premiumPct: crypto ? null : premiumPct,
    bookOneSided: null, // spot is RFQ-priced — there is no order book to be one-sided
    fundingRateHourly: null,
    initialMarginFraction: null,
    offHoursInitialMarginFraction: null,
    corporateAction: crypto ? "none" : corporateAction,
  });
}

/** Market tile value — venue fact drops the "(est.)" hedge; crypto tokens have no US session. */
function marketTile(assetType: RwaAssetType, market: MarketState): PlanCardRiskItem {
  if (assetType === "crypto") return { label: "Market", value: "24/7 crypto", tone: "neutral", mono: false };
  const est = market.source !== "venue";
  const value = market.open == null ? "—" : market.open ? (est ? "Open (est.)" : "Open") : (est ? "Closed (est.)" : "Closed");
  return { label: "Market", value, tone: market.open == null ? "neutral" : market.open ? "ok" : "warning", mono: false };
}

const fmtAge = (s: number): string => (s < 90 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`);

/** Oracle-health clear state — one shared literal so every reset writes the same shape.
    `sym` keys the reading to the token it was read FOR: consumers must ignore a reading whose
    sym ≠ the selected token, or a token switch briefly compares the new token's spot price
    against the previous token's feed (a large, wrong % on the risk surface). */
const ORACLE_CLEAR: { sym: string | null; fresh: boolean | null; ageSec: number | null; price: number | null } = { sym: null, fresh: null, ageSec: null, price: null };

/** Signed premium/discount label: "+1.3% (est.)". Callers pass a non-null pct. */
const fmtPremium = (pct: number): string => `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}% (est.)`;

/** Vs-oracle tile (#14) — spot last vs the token's Chainlink feed, honest "(est.)", warning at
    the same threshold the risk engine cautions on. Muted "—" while either price is missing —
    never fake 0%. Green is reserved for a CONFIRMED fact: an in-band premium against a flat
    off-hours (or unknown-freshness) print is labeled "vs last print" and stays neutral — a
    1–2-day-old basis must never read as "tracking the live underlying". */
function premiumTile(crypto: boolean, premiumPct: number | null, oracleFresh: boolean | null): PlanCardRiskItem {
  if (crypto) return { label: "Vs oracle", value: "n/a · crypto", tone: "neutral", mono: false, muted: true };
  if (premiumPct == null) return { label: "Vs oracle", value: "—", tone: "neutral", mono: false, muted: true };
  const live = oracleFresh === true;
  const value = `${premiumPct >= 0 ? "+" : "−"}${Math.abs(premiumPct).toFixed(1)}%${live ? "" : " vs last print"} (est.)`;
  if (Math.abs(premiumPct) >= HIGH_PREMIUM_PCT) return { label: "Vs oracle", value, tone: "warning" };
  return { label: "Vs oracle", value, tone: live ? "ok" : "neutral" };
}

export type CorporateActionState = "none" | "pending" | "paused" | "unknown";

const fmtEffDate = (unixSec: number): string =>
  new Date(unixSec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Corporate-action tile (#13) — live from the token contract's newUIMultiplier()/effectiveAt().
    "unknown" = we could not determine the schedule; while the first read is in flight that is an
    honest "Checking…", but after a failed read nothing is running, so it reads "Unavailable"
    (the slow poll still retries). Never a fake "None scheduled" over an unread schedule. */
function corporateActionTile(crypto: boolean, status: CorporateActionState, effectiveAt: number | null, loading: boolean): PlanCardRiskItem {
  if (crypto) return { label: "Corporate action", value: "n/a · crypto", tone: "neutral", mono: false, muted: true };
  if (status === "none") return { label: "Corporate action", value: "None scheduled", tone: "neutral", mono: false };
  if (status === "pending")
    return { label: "Corporate action", value: effectiveAt != null ? `Scheduled · ${fmtEffDate(effectiveAt)}` : "Scheduled", tone: "warning", mono: false };
  if (status === "paused") return { label: "Corporate action", value: "Processing", tone: "warning", mono: false };
  return { label: "Corporate action", value: loading ? "Checking…" : "Unavailable", tone: "neutral", mono: false, muted: true };
}

/** Oracle tile — live Oracle Health for Stock Tokens: on-chain pause flag (ERC-8056) + Chainlink
    feed freshness (latestRoundData age vs heartbeat). Precedence: paused > stale > fresh > pause-only.
    null = read pending/failed → "Checking…" (muted), never a fake healthy "Active". */
function oracleTile(crypto: boolean, oraclePaused: boolean | null, oracleFresh: boolean | null, ageSec: number | null, offHours: boolean): PlanCardRiskItem {
  if (crypto) return { label: "Oracle", value: "24/7 feed", tone: "neutral", mono: false, muted: true };
  if (oraclePaused === true) return { label: "Oracle", value: "Paused", tone: "warning", mono: false };
  if (oracleFresh === false)
    // a flat feed while the US market is closed is EXPECTED (24/5) — not "stale/broken"
    return offHours
      ? { label: "Oracle", value: "Flat · off-hours", tone: "neutral", mono: false, muted: true }
      : { label: "Oracle", value: "Stale", tone: "warning", mono: false };
  if (oracleFresh === true) return { label: "Oracle", value: ageSec != null ? `Fresh · ${fmtAge(ageSec)}` : "Fresh", tone: "ok", mono: false };
  // freshness unknown (no Chainlink feed for this token, or read pending)
  if (oraclePaused === false) return { label: "Oracle", value: "Not paused", tone: "ok", mono: false };
  return { label: "Oracle", value: "Checking…", tone: "neutral", mono: false, muted: true };
}

function SpotRwaRiskPanel({ stock, assetType, level, reasons, market, volume24h, oraclePaused, oracleFresh, oracleAgeSec, premiumPct, corporateAction, corporateEffectiveAt, corporateLoading }: {
  stock: string; assetType: RwaAssetType; level: RwaRiskLevel; reasons: string[]; market: MarketState; volume24h: number | null; oraclePaused: boolean | null; oracleFresh: boolean | null; oracleAgeSec: number | null; premiumPct: number | null; corporateAction: CorporateActionState; corporateEffectiveAt: number | null; corporateLoading: boolean;
}) {
  const crypto = assetType === "crypto";
  const riskItems: PlanCardRiskItem[] = [
    marketTile(assetType, market),
    { label: "Liquidity", value: volume24h != null && volume24h > 0 ? `24h $${(volume24h / 1e6).toFixed(1)}M` : "Unknown", tone: "neutral" },
    oracleTile(crypto, oraclePaused, oracleFresh, oracleAgeSec, market.open === false),
    premiumTile(crypto, premiumPct, oracleFresh),
    corporateActionTile(crypto, corporateAction, corporateEffectiveAt, corporateLoading),
  ];
  const closingNote = crypto
    ? "Market-hours and corporate-action checks don't apply to 24/7 crypto assets."
    : `${market.source === "venue" ? "Market status uses Arcus's venue calendar." : "Market status is a local estimate."} Stock Tokens trade 24/7, while the underlying US market may be closed. Oracle comparison is Ryntra's estimate from the token's Chainlink feed. Corporate-action data comes from the token contract. Robinhood Chain sequencer uptime is not independently monitored.`;

  return (
    <section className={`spot-riskbar spot-riskbar-${level}`} aria-label={`${stock} risk snapshot`}>
      <div className="spot-riskbar-head">
        <div className="spot-riskbar-title">
          <span>Risk snapshot</span>
          <strong>{crypto ? "Token" : "Stock Token"} · {stock}</strong>
        </div>
        <span className={`spot-riskpill spot-risk-${level}`}>{RISK_LABEL[level]}</span>
      </div>

      <div className="spot-riskmetrics">
        {riskItems.map((item) => (
          <div className={`spot-riskmetric risk-tone-${item.tone ?? "neutral"}${item.muted ? " is-muted" : ""}`} key={item.label}>
            <span>{item.label}</span>
            <strong className={item.mono === false ? "" : "is-mono"}>{item.value}</strong>
          </div>
        ))}
      </div>

      <details className="spot-riskdetails">
        <summary>
          <span><Info size={14} weight="bold" /> Methodology &amp; coverage</span>
          <CaretDown className="spot-detail-caret" size={14} weight="bold" />
        </summary>
        <div className="spot-riskdetails-body">
          <div className="spot-riskmeta">
            <span><i>Route</i><b>Arcus RFQ · 24/7</b></span>
            <span><i>Asset</i><b>{crypto ? "ERC-20 token" : "ERC-20 Stock Token"}</b></span>
            <span><i>Sequencer</i><b>Not monitored</b></span>
          </div>
          {reasons.length ? <p>{reasons.join(" ")}</p> : null}
          <p>{closingNote}</p>
        </div>
      </details>
    </section>
  );
}

export function SwapTerminal({ c }: { c: CbCopy["swap"] }) {
  const [tokens, setTokens] = useState<SpotToken[]>([]);
  const [ov, setOv] = useState<Record<string, OverviewItem>>({});
  const [favs, setFavs] = useState<Set<string>>(new Set());
  useEffect(() => {
    try { const r = localStorage.getItem("ryntra-spot-favs"); if (r) setFavs(new Set(JSON.parse(r) as string[])); } catch { /* no favs yet */ }
  }, []);
  const toggleFav = useCallback((ticker: string) => {
    setFavs((cur) => {
      const next = new Set(cur);
      if (next.has(ticker)) next.delete(ticker); else next.add(ticker);
      try { localStorage.setItem("ryntra-spot-favs", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const [stock, setStock] = useState("TSLA");
  const [tf, setTf] = useState<(typeof TFS)[number]>("1h");
  const [address, setAddress] = useState<string | null>(null);
  const [walletMissing, setWalletMissing] = useState(false);
  const [dir, setDir] = useState<"buy" | "sell">("buy");
  const [amountIn, setAmountIn] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [quote, setQuote] = useState<SpotQuote | null>(null);
  const [quoteRefreshKey, setQuoteRefreshKey] = useState(0);
  /** The exact base-units sell amount the live quote was requested for — Arcus quotes carry no
      top-level sellAmount, and pairing the live `amountIn` input with a previous quote would
      briefly price the quote against an amount it was never quoted for. Set/cleared strictly
      together with `quote` (same handler → same React batch). */
  const [quoteSellRaw, setQuoteSellRaw] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  /** When the displayed Arcus quote was received (ms) — a >30s-old RFQ leg reads stale and can
      never carry the "best" tag (execution re-quotes anyway; the DISPLAY must not overclaim). */
  const [quoteAt, setQuoteAt] = useState<number | null>(null);
  /** Uniswap v3 quote for the SAME pair/size — the second route on the chain (read-only quote
      comparison; capability truth in lib/domain/registry.ts). Never executed from here. */
  const [uniQuote, setUniQuote] = useState<UniswapV3QuoteResult | null>(null);
  const uniSeq = useRef(0);
  /** Last SUCCESSFUL overview refresh (ms) — heat valuations degrade to stale past this. */
  const [ovAt, setOvAt] = useState(0);
  /** 10s tick so a >30s-old AMM quote visibly turns stale (and loses the "best" tag) without
      user input — mirrors lib/domain/routes: a non-fresh quote never ranks. */
  const [, setRoutesTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setRoutesTick((t) => t + 1), 10_000); return () => clearInterval(i); }, []);
  /** stock balances keyed by lowercased token address — shows the whole portfolio, not just the
      currently selected token (so holdings don't "disappear" when you switch instrument). */
  const [bal, setBal] = useState<{ usdg: bigint; stock: Record<string, bigint> } | null>(null);
  const [trades, setTrades] = useState<Record<string, unknown>[]>([]);
  const [tab, setTab] = useState<"holdings" | "history">("holdings");
  const [step, setStep] = useState<ExecStep | null>(null);
  const [txMsg, setTxMsg] = useState<string | null>(null);
  const [execErr, setExecErr] = useState<string | null>(null);
  const [submissionUncertain, setSubmissionUncertain] = useState(false);
  const [submissionAttempt, setSubmissionAttempt] = useState<SubmissionAttempt | null>(null);
  const releaseSubmissionAttempt = useCallback((owner: string): boolean => {
    if (!clearSubmissionAttempt(owner)) {
      setSubmissionUncertain(true);
      setExecErr(c.recoveryStorageFailed);
      return false;
    }
    setSubmissionAttempt(null);
    setSubmissionUncertain(false);
    return true;
  }, [c.recoveryStorageFailed]);
  const seq = useRef(0);
  const [candles, setCandles] = useState<NormalizedCandle[]>([]);
  const [chartTheme, setChartTheme] = useState<"dark" | "light">("dark");
  const [markets, setMarkets] = useState<ArcusMarket[]>([]);
  /** null until mounted → no SSR/hydration mismatch on the market-hours estimate */
  const [now, setNow] = useState<number | null>(null);
  const [localSwaps, setLocalSwaps] = useState<LocalSwap[]>([]);
  const [pendingSwap, setPendingSwap] = useState<PendingSpotSwap | null>(null);
  // React may not paint a disabled CTA before a rapid second click; serialize wallet prompts here.
  const walletActionInFlightRef = useRef(false);
  const complianceGateRef = useRef<() => boolean>(() => false);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const signedReviewRef = useRef<HTMLDivElement>(null);
  const statusMessageRef = useRef<HTMLParagraphElement>(null);

  /** critical bootstrap (token universe) failed → the picker/swap can't work; show a retry banner
      instead of a silent empty state. reloadKey bump re-runs the data effects. */
  const [bootErr, setBootErr] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { setLocalSwaps(address ? loadLocalSwaps(address) : []); }, [address]);

  useEffect(() => {
    const saved = address ? loadSubmissionAttempt(address) : null;
    setSubmissionAttempt(saved);
    setSubmissionUncertain(saved !== null);
  }, [address]);
  /* mount-time clock for the local market-hours estimate (fallback when the venue fact is absent) */
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const stockToken = useMemo(() => tokens.find((t) => t.symbol === stock) ?? null, [tokens, stock]);
  const usdgToken = useMemo(() => tokens.find((t) => t.symbol === "USDG") ?? null, [tokens]);
  const info = ov[stock];
  const sellToken = dir === "buy" ? usdgToken : stockToken;
  const buyToken = dir === "buy" ? stockToken : usdgToken;
  const executionRouteSupported = useMemo(
    () => hasAuditedRialtoExecution(sellToken, buyToken),
    [sellToken, buyToken]
  );
  const sellDecimals = sellToken?.decimals ?? (dir === "buy" ? USDG_DECIMALS : 18);
  const buyDecimals = buyToken?.decimals ?? (dir === "buy" ? 18 : USDG_DECIMALS);
  const executionContextKey = [address ?? "", stock, dir, amountIn, slippageBps, sellToken?.address ?? "", buyToken?.address ?? ""].join("|");
  const executionContextRef = useRef(executionContextKey);
  executionContextRef.current = executionContextKey;

  /* asset class from the spot category; only EQUITIES/COMMODITIES/INDICES carry the RWA
     market-hours regime. Before the overview loads, default to stock-token (the default view is
     an equity) so TSLA doesn't flash "Token Risk / 24-7 crypto" for a frame. */
  const assetType: RwaAssetType = useMemo(() => {
    if (!info) return "stock-token";
    const cat = (info.category ?? "").toUpperCase();
    return cat === "EQUITIES" || cat === "COMMODITIES" || cat === "INDICES" ? "stock-token" : "crypto";
  }, [info]);
  /* market open/closed: prefer the venue's isOutsideRth fact (matched by baseAsset), local NYSE est. as fallback */
  const marketState: MarketState = useMemo(() => {
    const m = markets.find((x) => x.baseAsset === stock && (x.category ?? "").toUpperCase() !== "CRYPTO");
    if (m && typeof m.isOutsideRth === "boolean") return { open: !m.isOutsideRth, source: "venue" };
    return { open: now == null ? null : usMarketOpen(new Date(now)), source: "est" };
  }, [markets, stock, now]);

  /* token universe rarely changes — fetch once (re-run on manual retry) */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const tk = await fetch("/api/arcus?kind=spot-tokens").then((r) => r.json());
        if (!alive) return;
        const list = (tk.tokens ?? []) as SpotToken[];
        setTokens(list);
        setBootErr(list.length === 0); // empty universe is as broken as a fetch failure
      } catch {
        if (alive) setBootErr(true);
      }
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  /* live market data: overview (price/24h/logo) + perp markets (isOutsideRth fact), polled so the
     header price, ticker and market-hours pill stay current — otherwise "Live price" would be a lie.
     Server caches these ~30s, so this cadence mostly hits cache. */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [o, mk] = await Promise.all([
          fetch("/api/arcus?kind=spot-overview").then((r) => r.json()),
          fetch("/api/arcus?kind=markets").then((r) => r.json()),
        ]);
        if (!alive) return;
        const map: Record<string, OverviewItem> = {};
        for (const it of (o.overview ?? []) as OverviewItem[]) map[it.ticker] = it;
        setOv(map);
        setOvAt(Date.now()); // last SUCCESSFUL refresh — retained prices go stale, never "fresh forever"
        setMarkets((mk.markets ?? []) as ArcusMarket[]);
      } catch { /* keep last; market-hours fall back to local estimate. transient poll failures
                   don't show an error once we already have prices — only the token-universe
                   failure (bootErr) is surfaced, since that's what actually breaks the terminal. */ }
    };
    void load();
    const id = window.setInterval(load, 30_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [reloadKey]);

  /* the cabinet resolves theme onto <html data-theme>; the chart follows it live */
  useEffect(() => watchResolvedTheme(setChartTheme), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/arcus?kind=spot-candles&market=${stock}&tf=${tf}`);
        const j = (await r.json()) as { candles?: SpotCandle[] };
        if (cancelled || !j.candles) return;
        setCandles(j.candles.map(fromSpotCandle));
      } catch { /* chart stays empty */ }
    })();
    return () => { cancelled = true; };
  }, [stock, tf]);

  /* candidate Stock Tokens to price: the selected one + any the user has swapped on this device
     (from local history) — bounded, so we never fan out balance reads over all ~100 tokens. */
  const holdingTokens = useMemo(() => {
    const map = new Map<string, SpotToken>(); // lowercased native addr → token
    if (stockToken) map.set(stockToken.address.toLowerCase(), stockToken);
    const syms = new Set<string>();
    for (const s of localSwaps) { if (s.sellSym !== "USDG") syms.add(s.sellSym); if (s.buySym !== "USDG") syms.add(s.buySym); }
    for (const t of tokens) if (syms.has(t.symbol)) map.set(t.address.toLowerCase(), t);
    return [...map.values()];
  }, [stockToken, localSwaps, tokens]);

  /* balance addresses = native + wrapped (wTSLA-style): a long-tail RFQ fill can deliver the
     wrapped placeholder instead of the native token — it must never be invisible in Holdings. */
  const holdingAddrs = useMemo(() => {
    const set = new Map<string, string>(); // lowercased → original address
    for (const t of holdingTokens) {
      set.set(t.address.toLowerCase(), t.address);
      if (t.wrappedTokenAddress) set.set(t.wrappedTokenAddress.toLowerCase(), t.wrappedTokenAddress);
    }
    return [...set.values()];
  }, [holdingTokens]);

  /* wrapped decimals are read on-chain (once per address) rather than assumed equal to the native
     token's — a mismatch would misdisplay balances by orders of magnitude. Fallback = native's. */
  const [wrappedDec, setWrappedDec] = useState<Record<string, number>>({});
  const wrappedDecRequested = useRef(new Set<string>());
  useEffect(() => {
    for (const t of holdingTokens) {
      const wAddr = t.wrappedTokenAddress?.toLowerCase();
      if (!wAddr || wrappedDecRequested.current.has(wAddr)) continue;
      wrappedDecRequested.current.add(wAddr);
      readTokenDecimals(t.wrappedTokenAddress as string)
        .then((n) => setWrappedDec((prev) => ({ ...prev, [wAddr]: n })))
        .catch(() => { /* fall back to the native token's decimals */ });
    }
  }, [holdingTokens]);

  /* Per-symbol uiMultiplier for the Holdings share-equivalent (raw × mult ÷ 1e18 = shares).
     Read once per held token (a split is rare — no poll here); the ACTIVE token is kept fresh by
     syncing stiSnap (which IS polled) below, so a split self-heals for the row in view. At launch
     every multiplier is 1.0, so share-equivalent == token balance and nothing extra renders. */
  const [multBySym, setMultBySym] = useState<Record<string, bigint>>({});
  const multRequested = useRef(new Set<string>());
  useEffect(() => {
    for (const t of holdingTokens) {
      if (multRequested.current.has(t.symbol)) continue;
      multRequested.current.add(t.symbol);
      readUiMultiplier(t.address)
        .then((m) => { if (m != null) setMultBySym((prev) => ({ ...prev, [t.symbol]: m })); })
        .catch(() => { /* leave unset → row falls back to raw token units */ });
    }
  }, [holdingTokens]);

  const balSeq = useRef(0);
  const refreshBalances = useCallback(async () => {
    if (!address) return;
    const mine = ++balSeq.current;
    const addrs = holdingAddrs;
    // per-call .catch so one failed token read can't blank the whole portfolio
    const [usdg, ...stocks] = await Promise.all([
      readBalance(USDG_ADDRESS, address).catch(() => null),
      ...addrs.map((a) => readBalance(a, address).catch(() => null)),
    ]);
    if (mine !== balSeq.current) return; // a newer refresh started — drop this stale result
    if (usdg == null) return; // couldn't read the base balance — keep last rather than blanking
    const stock: Record<string, bigint> = {};
    addrs.forEach((a, i) => { const v = stocks[i]; if (v != null) stock[a.toLowerCase()] = v; });
    setBal({ usdg, stock });
  }, [address, holdingAddrs]);
  useEffect(() => { void refreshBalances(); }, [refreshBalances]);

  const refreshTrades = useCallback(async () => {
    if (!address) return;
    try {
      const r = await fetch(`/api/arcus?kind=spot-trades&address=${address}`);
      const j = (await r.json()) as { trades?: Record<string, unknown>[] };
      setTrades(j.trades ?? []);
    } catch { /* keep last */ }
  }, [address]);
  useEffect(() => { void refreshTrades(); }, [refreshTrades]);

  /* live RFQ quote (debounced) */
  useEffect(() => {
    // Invalidate ANY in-flight quote FIRST — even when the new input is invalid/cleared, an older
    // fetch landing later must not repopulate a panel the user already emptied. The invalidated
    // request's guarded `finally` will SKIP its setQuoting(false), so the spinner is reset here.
    const mine = ++seq.current;
    setQuote(null); setQuoteSellRaw(null); setQuoteAt(null); setQuoteErr(null); setQuoting(false);
    if (!address || !sellToken || !buyToken) return;
    const raw = parseUnits(amountIn, sellDecimals);
    if (raw == null || raw <= 0n) return;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const u = `/api/arcus?kind=spot-quote&sellToken=${sellToken.address}&buyToken=${buyToken.address}&sellAmount=${raw}&taker=${address}&slippageBps=${slippageBps}`;
        const r = await fetch(u);
        const j = (await r.json()) as SpotQuoteResponse & { error?: string };
        if (mine !== seq.current) return;
        const best = pickRialtoWalletQuote(j.all);
        if (!r.ok || !best) { setQuoteErr(j.error ?? c.noQuote); setQuote(null); setQuoteSellRaw(null); setQuoteAt(null); }
        else { setQuote(best); setQuoteSellRaw(raw); setQuoteAt(Date.now()); setQuoteErr(null); }
      } catch { if (mine === seq.current) setQuoteErr(c.noQuote); }
      finally { if (mine === seq.current) setQuoting(false); }
    }, 450);
    return () => clearTimeout(t);
  }, [address, sellToken, buyToken, amountIn, sellDecimals, slippageBps, c.noQuote, quoteRefreshKey]);

  /* Uniswap v3 quote on the same debounce as the Arcus RFQ quote, so the two routes always price
     the same pair/size. All-tier reverts render as an honest "no AMM liquidity" (checked live);
     transport failure as "could not check" — the two are never conflated. quoteUniswapV3 never
     throws (every failure is classified). */
  useEffect(() => {
    const mine = ++uniSeq.current; // invalidate in-flight BEFORE the early returns (same as Arcus)
    setUniQuote(null);
    if (!address || !sellToken || !buyToken) return;
    const raw = parseUnits(amountIn, sellDecimals);
    if (raw == null || raw <= 0n) return;
    const t = setTimeout(async () => {
      const r = await quoteUniswapV3(sellToken.address, buyToken.address, raw);
      if (mine === uniSeq.current) setUniQuote(r);
    }, 450);
    return () => clearTimeout(t);
  }, [address, sellToken, buyToken, amountIn, sellDecimals]);

  const connect = useCallback(async () => {
    const eth = getEth();
    if (!eth) { setWalletMissing(true); return; }
    try {
      const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (accs?.[0]) setAddress(accs[0]);
    } catch { /* rejected */ }
  }, []);

  /* Every wallet prompt gets its own deliberate click. Browser extensions control their popup and
     commonly leave a second chained request behind the toolbar badge once user activation lapses. */
  const [approvalState, setApprovalState] = useState<Permit2ApprovalState>("idle");
  const [approvalRefreshKey, setApprovalRefreshKey] = useState(0);
  const needsApprove = executionRouteSupported && approvalState === "required";
  useEffect(() => {
    let alive = true;
    const need = parseUnits(amountIn, sellDecimals);
    if (!address || !sellToken || !buyToken || !executionRouteSupported || need == null || need <= 0n) { setApprovalState("idle"); return; }
    setApprovalState("checking");
    void needsPermit2Approval(sellToken.address, address, need).then((needed) => {
      if (!alive) return;
      setApprovalState(needed == null ? "unavailable" : needed ? "required" : "sufficient");
    });
    return () => { alive = false; };
  }, [address, sellToken, buyToken, executionRouteSupported, amountIn, sellDecimals, approvalRefreshKey]);

  // A signed RFQ is bound to these exact ticket inputs. Any edit discards it before submission.
  useEffect(() => { setPendingSwap(null); }, [executionContextKey]);
  useEffect(() => {
    if (!pendingSwap) return;
    const safeUntil = pendingSwap.intent.expiresAtMs - 10_000;
    const delay = Math.max(0, safeUntil - Date.now());
    const id = window.setTimeout(() => {
      const restoreFocus = signedReviewRef.current?.contains(document.activeElement) ?? false;
      setPendingSwap(null);
      setExecErr(c.intentExpired);
      if (restoreFocus) window.requestAnimationFrame(() => primaryActionRef.current?.focus());
    }, delay);
    return () => window.clearTimeout(id);
  }, [pendingSwap, c.intentExpired]);


  const doApprove = useCallback(async () => {
    const eth = getEth() as Eth | null;
    if (!eth || !address || !sellToken || submissionUncertain) return;
    if (!buyToken || !hasAuditedRialtoExecution(sellToken, buyToken)) { setExecErr(c.executionUnsupported); return; }
    if (walletActionInFlightRef.current) return;
    if (!complianceGateRef.current()) { setExecErr(c.complianceRetry); return; }
    walletActionInFlightRef.current = true;
    const attempt: SubmissionAttempt = {
      v: 1, kind: "approval", address, startedAt: Date.now(), hash: null, quoteId: null, swap: null,
    };
    const persist = (next: SubmissionAttempt) => {
      if (!saveSubmissionAttempt(address, next)) throw new Error(c.recoveryStorageFailed);
      setSubmissionAttempt(next);
      setSubmissionUncertain(true);
    };
    setPendingSwap(null); setExecErr(null); setTxMsg(null); setStep("approve");
    try {
      await approvePermit2(
        eth,
        address,
        sellToken.address,
        (s) => setStep(s),
        (hash) => persist({ ...attempt, hash }),
        () => persist(attempt),
      );
      if (!releaseSubmissionAttempt(address)) return;
      setApprovalState("checking");
      setApprovalRefreshKey((n) => n + 1);
      setQuoteRefreshKey((n) => n + 1);
    } catch (e) {
      if ((e as { code?: number })?.code === 4001) {
        if (releaseSubmissionAttempt(address)) setExecErr(c.approvalCancelled);
      } else if (e instanceof SpotApprovalRevertedError) {
        if (releaseSubmissionAttempt(address)) setExecErr(e.message);
      } else if (e instanceof SpotApprovalUnknownError) {
        setSubmissionUncertain(true);
        setExecErr(c.approvalUnknown);
      } else {
        setExecErr(e instanceof Error ? e.message : "approval failed");
      }
    } finally { walletActionInFlightRef.current = false; setStep(null); }
  }, [address, sellToken, buyToken, submissionUncertain, c.approvalCancelled, c.approvalUnknown, c.complianceRetry, c.executionUnsupported, c.recoveryStorageFailed, releaseSubmissionAttempt]);

  const doSignSwap = useCallback(async () => {
    const eth = getEth() as Eth | null;
    if (!eth || !address || !quote || !sellToken || !buyToken || submissionUncertain) return;
    if (!hasAuditedRialtoExecution(sellToken, buyToken)) { setExecErr(c.executionUnsupported); return; }
    const sellAmountRaw = parseUnits(amountIn, sellDecimals);
    if (sellAmountRaw == null || sellAmountRaw <= 0n) return;
    if (walletActionInFlightRef.current) return;
    if (!complianceGateRef.current()) { setExecErr(c.complianceRetry); return; }
    walletActionInFlightRef.current = true;
    setPendingSwap(null); setExecErr(null); setTxMsg(null);
    setStep("switch");
    try {
      const freshQuote = async (): Promise<SpotQuote | null> => {
        const u = `/api/arcus?kind=spot-quote&sellToken=${sellToken.address}&buyToken=${buyToken.address}&sellAmount=${sellAmountRaw}&taker=${address}&slippageBps=${slippageBps}`;
        const rq = await fetch(u);
        const jq = (await rq.json()) as SpotQuoteResponse;
        const fresh = rq.ok ? pickRialtoWalletQuote(jq.all) : null;
        if (fresh) {
          setQuote(fresh); setQuoteSellRaw(sellAmountRaw); setQuoteAt(Date.now()); setQuoteErr(null);
        }
        return fresh;
      };
      const intent = await prepareSpotSwap(
        eth, address, sellToken.address, buyToken.address, sellAmountRaw, (s) => setStep(s), freshQuote
      );
      if (executionContextRef.current !== executionContextKey) throw new Error(c.tradeChanged);
      setPendingSwap({
        intent,
        contextKey: executionContextKey,
        sellSym: dir === "buy" ? "USDG" : stock,
        sellAmt: amountIn,
        buySym: dir === "buy" ? stock : "USDG",
        buyAmt: formatUnits(intent.buyAmount, buyDecimals, 6),
      });
    } catch (e) {
      if (e instanceof SpotApprovalRequiredError) {
        setApprovalState("required");
      } else {
        const m = e instanceof Error ? e.message : "swap signing failed";
        const rejected = (e as { code?: number })?.code === 4001;
        setExecErr(rejected ? c.cancelledFresh : m);
      }
    } finally { walletActionInFlightRef.current = false; setStep(null); }
  }, [address, quote, sellToken, buyToken, amountIn, sellDecimals, slippageBps, dir, stock, buyDecimals, executionContextKey, submissionUncertain, c.tradeChanged, c.cancelledFresh, c.complianceRetry, c.executionUnsupported]);

  const doSubmitSwap = useCallback(async () => {
    const eth = getEth() as Eth | null;
    if (!eth || !pendingSwap || submissionUncertain) return;
    if (pendingSwap.contextKey !== executionContextKey) {
      setPendingSwap(null); setExecErr(c.tradeChanged); return;
    }
    if (walletActionInFlightRef.current) return;
    if (!complianceGateRef.current()) { setExecErr(c.complianceRetry); return; }
    walletActionInFlightRef.current = true;
    const owner = pendingSwap.intent.from;
    const attempt: SubmissionAttempt = {
      v: 1,
      kind: "swap",
      address: owner,
      startedAt: Date.now(),
      hash: null,
      quoteId: pendingSwap.intent.quoteId,
      swap: {
        sellSym: pendingSwap.sellSym,
        sellAmt: pendingSwap.sellAmt,
        buySym: pendingSwap.buySym,
        buyAmt: pendingSwap.buyAmt,
      },
    };
    const persist = (next: SubmissionAttempt) => {
      if (!saveSubmissionAttempt(owner, next)) throw new Error(c.recoveryStorageFailed);
      setSubmissionAttempt(next);
      setSubmissionUncertain(true);
    };
    setExecErr(null); setTxMsg(null); setStep("submit");
    try {
      const r = await submitPreparedSpotSwap(
        eth,
        pendingSwap.intent,
        (s) => setStep(s),
        (hash) => {
          persist({ ...attempt, hash });
          setTxMsg(`${c.done} · ${hash.slice(0, 10)}…${hash.slice(-8)}`);
        },
        () => {
          persist(attempt);
          setPendingSwap(null);
        },
      );
      const rec: LocalSwap = {
        hash: r.hash,
        at: Date.now(),
        ...(attempt.swap as Omit<LocalSwap, "hash" | "at">),
      };
      setLocalSwaps((cur) => { const next = [rec, ...cur].slice(0, 50); saveLocalSwaps(owner, next); return next; });
      if (!releaseSubmissionAttempt(owner)) return;
      setAmountIn(""); setQuote(null); setQuoteSellRaw(null); void refreshBalances(); void refreshTrades();
    } catch (e) {
      setTxMsg(null);
      if (e instanceof SpotIntentExpiredError) {
        setPendingSwap(null);
        setExecErr(c.intentExpired);
      } else if (e instanceof SpotSubmissionRejectedError) {
        if (releaseSubmissionAttempt(owner)) setExecErr(c.cancelledFresh);
      } else if (e instanceof SpotSubmissionRevertedError) {
        if (releaseSubmissionAttempt(owner)) setExecErr(e.message);
      } else if (e instanceof SpotSubmissionUnknownError) {
        setSubmissionUncertain(true);
        setExecErr(c.submissionUnknown);
      } else {
        setExecErr(e instanceof Error ? e.message : "swap failed");
      }
    } finally { walletActionInFlightRef.current = false; setStep(null); }
  }, [pendingSwap, executionContextKey, submissionUncertain, c.done, c.intentExpired, c.tradeChanged, c.cancelledFresh, c.submissionUnknown, c.complianceRetry, c.recoveryStorageFailed, releaseSubmissionAttempt, refreshBalances, refreshTrades]);
  /* Arcus compliance is fetched client-side so geo reflects the user's IP. State-changing wallet
     actions fail closed unless BOTH geo and the connected address have a fresh explicit allow.
     Read-only market data remains available while the check is pending or unavailable. */
  const [complianceState, setComplianceState] = useState<{ addr: string; v: ComplianceVerdict; checkedAt: number } | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceFailed, setComplianceFailed] = useState(false);
  const [complianceRefreshKey, setComplianceRefreshKey] = useState(0);
  const [complianceTick, setComplianceTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setComplianceTick((n) => n + 1), 45_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (!address) { setComplianceState(null); setComplianceLoading(false); setComplianceFailed(false); return; }
    let alive = true;
    setComplianceLoading(true); setComplianceFailed(false);
    const url = `https://api.arcus.xyz/v1/compliance?address=${encodeURIComponent(address)}`;
    fetch(url, { signal: AbortSignal.timeout(8000) })
      .then((r) => { if (!r.ok) throw new Error(`compliance HTTP ${r.status}`); return r.json(); })
      .then((j: ArcusCompliance) => {
        if (alive) setComplianceState({ addr: address, v: classifyCompliance(j, address), checkedAt: Date.now() });
      })
      .catch(() => { if (alive) setComplianceFailed(true); })
      .finally(() => { if (alive) setComplianceLoading(false); });
    return () => { alive = false; };
  }, [address, complianceRefreshKey, complianceTick]);
  const compliance: ComplianceVerdict | null = useMemo(() => {
    if (!complianceState) return null;
    const v = complianceState.v;
    if (complianceState.addr === address) return v;
    return { ...v, walletAllowed: null, spotBlockReason: v.venueSpotAllowed === false ? "geo" : null };
  }, [complianceState, address]);
  const complianceCheckedAt = complianceState?.addr === address ? complianceState.checkedAt : null;
  const nowMs = Date.now(); // recomputed by the existing 10s route tick
  const complianceReady = isSpotComplianceReady(compliance, complianceCheckedAt, nowMs);
  complianceGateRef.current = () =>
    isSpotComplianceReady(compliance, complianceCheckedAt, Date.now());
  const complianceBlocked = compliance?.spotBlockReason != null;

  // A broadcast attempt survives reload/power loss. Reconcile a known hash once on restore and
  // clear the lock only for an explicit success or revert; pending/unknown remains fail-closed.
  useEffect(() => {
    if (!address || !submissionAttempt?.hash || walletActionInFlightRef.current) return;
    let alive = true;
    const attempt = submissionAttempt;
    const hash = attempt.hash as string;
    void readTransactionOutcome(hash).then((outcome) => {
      if (!alive || (outcome !== "success" && outcome !== "reverted")) return;
      if (!releaseSubmissionAttempt(address)) return;
      if (outcome === "reverted") {
        setExecErr(c.attemptReverted);
        return;
      }
      setExecErr(null);
      if (attempt.kind === "approval") {
        setTxMsg(c.approvalRecovered);
        setApprovalState("checking");
        setApprovalRefreshKey((n) => n + 1);
        setQuoteRefreshKey((n) => n + 1);
      } else if (attempt.swap) {
        const rec: LocalSwap = { hash, at: Date.now(), ...attempt.swap };
        setLocalSwaps((cur) => {
          if (cur.some((item) => item.hash.toLowerCase() === rec.hash.toLowerCase())) return cur;
          const next = [rec, ...cur].slice(0, 50);
          saveLocalSwaps(address, next);
          return next;
        });
        setTxMsg(`${c.done} · ${hash.slice(0, 10)}…${hash.slice(-8)}`);
        void refreshBalances();
        void refreshTrades();
      }
    });
    return () => { alive = false; };
  }, [address, submissionAttempt, c.approvalRecovered, c.attemptReverted, c.done, releaseSubmissionAttempt, refreshBalances, refreshTrades]);

  const rawIn = parseUnits(amountIn, sellDecimals);
  const currentStockBal = stockToken && bal ? (bal.stock[stockToken.address.toLowerCase()] ?? 0n) : undefined;
  const sellBal = dir === "buy" ? bal?.usdg : currentStockBal;
  const overBalance = rawIn != null && sellBal != null && rawIn > sellBal;
  // Paying with USDG but the balance can't cover Arcus's $10 minimum → nudge to fund.
  const needsFunding =
    dir === "buy" && sellBal != null && sellBal < BigInt(MIN_NOTIONAL_USDG) * 10n ** BigInt(USDG_DECIMALS);
  const reviewBuyAmount = pendingSwap ? formatUnits(pendingSwap.intent.buyAmount, buyDecimals, 6) : quote ? formatUnits(quote.buyAmount, buyDecimals, 6) : "";
  const quoteFee = useMemo(() => quote ? readSpotQuoteFee(quote) : null, [quote]);
  const buyAmount = reviewBuyAmount;
  // A signed RFQ replaces every earlier indicative/display quote in the confirmation review.
  const minReceivedRaw = pendingSwap ? formatUnits(pendingSwap.intent.minBuyAmount, buyDecimals, 6) : quote ? formatUnits(quote.minBuyAmount, buyDecimals, 6) : "";
  const minReceived = minReceivedRaw && Number(minReceivedRaw) > 0 ? minReceivedRaw : "";
  const reviewSellAmount = pendingSwap ? formatUnits(pendingSwap.intent.sellAmount, sellDecimals, sellDecimals) : amountIn;
  const signedExpiresLabel = pendingSwap ? new Date(pendingSwap.intent.expiresAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
  // Arcus enforces a $10 minimum. USDG notional = the USDG side of the trade.
  const usdgNotional = dir === "buy"
    ? Number(amountIn || 0)
    : (quote ? Number(formatUnits(quote.buyAmount, USDG_DECIMALS, 8)) : Number(amountIn || 0) * (info?.quote?.price ?? 0));
  const belowMin = amountIn !== "" && usdgNotional > 0 && usdgNotional < MIN_NOTIONAL_USDG;
  const busy = step !== null;
  const ticketLocked = busy || pendingSwap !== null;
  // canSwap is finalized below, after the readiness evaluation it depends on.
  const stepLabel = step === "switch" ? c.stepSwitch : step === "approve" ? c.stepApprove.replace("{sym}", dir === "buy" ? "USDG" : stock) : step === "requote" ? c.stepRequote : step === "sign" ? c.stepSwap : step === "submit" ? c.stepSubmit : step === "confirm" ? c.stepConfirm : "";
  const sellSym = dir === "buy" ? "USDG" : stock;
  const buySym = dir === "buy" ? stock : "USDG";

  /* Route comparison THROUGH the domain layer (lib/domain/routes + capability + registry) —
     the terminal consumes rankQuotes/freshnessOf/compareAmounts instead of re-implementing them:
     non-fresh or unquotable legs are excluded from ranking, an exact tie carries NO badge, and
     the "better quote" tag needs BOTH legs ranked (one quote alone is not a comparison). */
  const QUOTE_STALE_MS = 30_000;
  const cmpInstrument = useMemo(
    () => ({
      chain: "robinhood-chain" as const,
      kind: assetType === "crypto" ? ("spot-crypto" as const) : ("spot-tokenized-equity" as const),
      base: stock,
      quote: "USDG",
    }),
    [assetType, stock]
  );
  const cmpSide = dir === "buy" ? ("buy" as const) : ("sell" as const);
  const arcusLeg: RouteQuote | null = quote
    ? {
        route: "arcus-spot-rfq",
        instrument: cmpInstrument,
        side: cmpSide,
        size: amountIn,
        expectedOut: BigInt(quote.buyAmount) > 0n ? quote.buyAmount : null,
        price: null,
        feeBps: quoteFee?.totalBps ?? null,
        feeNote: c.routes.arcusFee,
        priceImpactPct: null,
        freshness: freshnessOf(quoteAt, nowMs, QUOTE_STALE_MS),
        observedAt: quoteAt,
        warnings: [],
        executionMode: "wallet-signed",
      }
    : null;
  const uniQuoted = uniQuote?.status === "quoted" ? uniQuote.quote : null;
  const uniLeg: RouteQuote | null = uniQuoted
    ? {
        route: "uniswap-rhchain-amm",
        instrument: cmpInstrument,
        side: cmpSide,
        size: amountIn,
        expectedOut: uniQuoted.amountOut.toString(),
        price: null,
        feeBps: uniQuoted.feeTierBps,
        feeNote: c.routes.uniFee,
        priceImpactPct: null,
        freshness: freshnessOf(uniQuoted.observedAt, nowMs, QUOTE_STALE_MS),
        observedAt: uniQuoted.observedAt,
        warnings: [],
        executionMode: "wallet-signed",
      }
    : null;
  const rankedIn = rankQuotes([arcusLeg, uniLeg].filter((q): q is RouteQuote => q != null)).filter((r) => r.rank != null);
  const arcusStale = arcusLeg != null && arcusLeg.freshness !== "fresh";
  const uniStale = uniLeg != null && uniLeg.freshness !== "fresh";
  const uniOut = uniQuoted ? formatUnits(uniQuoted.amountOut, buyDecimals, 6) : "";
  const routeTie =
    rankedIn.length === 2 && compareAmounts(arcusLeg!.expectedOut as string, uniLeg!.expectedOut as string) === 0;
  const betterQuoteRoute = rankedIn.length === 2 && !routeTie ? rankedIn.find((r) => r.rank === 1)!.quote.route : null;
  const uniBest = betterQuoteRoute === "uniswap-rhchain-amm";
  const arcusBest = betterQuoteRoute === "arcus-spot-rfq";
  /* Route metadata + capability truth from the SHARED registries — not hardcoded JSX. */
  const arcusRoute = ROUTES["arcus-spot-rfq"];
  const uniRoute = ROUTES["uniswap-rhchain-amm"];
  const arcusCap = routeCapability("arcus-spot-rfq");
  const uniCap = routeCapability("uniswap-rhchain-amm");

  /* Spot-swap readiness through the SAME deterministic engine that gates planned trades —
     with the SPOT_SWAP_POLICY (a plain conversion needs no thesis/stop; capability truth,
     compliance and route binding still gate). Blocks the CTA on not-ready. */
  const [swapIdemKey] = useState(() => newIdempotencyKey());
  const swapReadiness = useMemo(() => {
    const complianceDecision = complianceBlocked
      ? { status: "blocked" as const, source: "arcus-compliance-api" as const, checkedAt: complianceCheckedAt }
      : complianceReady
        ? { status: "allowed" as const, source: "arcus-compliance-api" as const, checkedAt: complianceCheckedAt }
        : { status: "unknown" as const, source: "unverified" as const, checkedAt: complianceCheckedAt };
    return evaluateReadiness(
      {
        capability: claimFor("arcus-spot-rfq"),
        signals: [],
        plan: { thesis: "", entry: null, stop: null, invalidation: null, targets: [], riskPct: null },
        compliance: complianceDecision,
        intent: {
          kind: "spot-swap",
          route: "arcus-spot-rfq",
          instrument: cmpInstrument,
          side: cmpSide,
          size: amountIn || "0",
          limitPrice: null,
          executionMode: "wallet-signed",
          idempotencyKey: swapIdemKey,
          createdAt: 0,
        },
      },
      SPOT_SWAP_POLICY
    );
  }, [complianceBlocked, complianceReady, complianceCheckedAt, cmpInstrument, cmpSide, amountIn, swapIdemKey]);

  const canApprove =
    executionRouteSupported && !submissionUncertain && approvalState === "required" && !overBalance && !belowMin && rawIn != null && rawIn > 0n && !ticketLocked &&
    complianceReady && swapReadiness.level !== "not-ready";
  const canSwap =
    executionRouteSupported && !submissionUncertain && approvalState === "sufficient" && !!quote && quoteFee !== null && !overBalance && !belowMin && rawIn != null && rawIn > 0n &&
    !ticketLocked && !quoting && complianceReady && swapReadiness.level !== "not-ready";
  const canRetryApproval =
    executionRouteSupported && !submissionUncertain && approvalState === "unavailable" && rawIn != null && rawIn > 0n && !overBalance && !belowMin && !busy;
  const canSubmit =
    executionRouteSupported && !submissionUncertain && pendingSwap !== null && pendingSwap.contextKey === executionContextKey && !busy && complianceReady;
  const canPrimaryAction = pendingSwap ? canSubmit : needsApprove ? canApprove : approvalState === "unavailable" ? canRetryApproval : canSwap;

  /* Stock Token Intelligence: read the on-chain ERC-8056 snapshot (uiMultiplier + corporate-action
     schedule + oracle-pause) for the selected token. Sym-keyed so a not-yet-cleared previous-token
     snapshot never flashes under the new symbol; slow-polled so a corporate action that appears —
     or a processing window that closes on-chain (newUIMultiplier == uiMultiplier again) — is
     observed instead of the state sticking on Avoid until the user re-selects the token. */
  const [stiState, setStiState] = useState<{ sym: string; snap: StockTokenOnchain } | null>(null);
  const [stiLoading, setStiLoading] = useState(false);
  const [stiTick, setStiTick] = useState(0);
  const stiSymRef = useRef<string | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setStiTick((t) => t + 1), STI_POLL_MS);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const addr = stockToken?.address;
    if (assetType !== "stock-token" || !addr) { setStiState(null); stiSymRef.current = null; setStiLoading(false); return; }
    let alive = true;
    // Clear + show "loading" ONLY when the token changed — a same-token poll keeps the last
    // snapshot on screen (no per-poll flash), the fresh read overwrites it below.
    const switching = stiSymRef.current !== stock;
    if (switching) { setStiState(null); setStiLoading(true); }
    readStockTokenOnchain(addr)
      .then((s) => { if (alive) { setStiState({ sym: stock, snap: s }); stiSymRef.current = stock; } })
      .catch(() => { if (alive && switching) setStiState(null); }) // poll failure keeps last good; switch failure → unavailable
      .finally(() => { if (alive) setStiLoading(false); });
    return () => { alive = false; };
  }, [assetType, stockToken?.address, stock, stiTick]);
  /* The snapshot as seen by THIS token — a stale snapshot for another token reads as "no snapshot". */
  const stiSnap = stiState?.sym === stock ? stiState.snap : null;
  // Keep the selected token's Holdings multiplier fresh from the polled snapshot (self-heal after
  // a split for the row in view; other rows use their one-shot read, refreshed on re-select).
  useEffect(() => {
    const m = stiSnap?.uiMultiplier;
    if (m != null) setMultBySym((prev) => (prev[stock] === m ? prev : { ...prev, [stock]: m }));
  }, [stiSnap, stock]);
  const sti = useMemo(
    () =>
      stiSnap
        ? stockTokenIntel({
            uiMultiplier: stiSnap.uiMultiplier,
            newUiMultiplier: stiSnap.newUiMultiplier,
            effectiveAt: stiSnap.effectiveAt,
            oraclePaused: stiSnap.oraclePaused,
            tokenFeedPrice: info?.quote?.price ?? null,
          })
        : null,
    [stiSnap, info?.quote?.price]
  );

  /* Oracle Health: Chainlink feed registry (server-cached) + live latestRoundData freshness.
     Feed map fetched once; per-symbol reading refreshed with the price polling cadence. */
  const [feedMap, setFeedMap] = useState<Record<string, OracleFeed> | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/arcus?kind=oracle-feeds").then((r) => r.json()).then((j) => { if (alive) setFeedMap((j.feeds ?? {}) as Record<string, OracleFeed>); }).catch(() => { if (alive) setFeedMap({}); });
    return () => { alive = false; };
  }, []);
  const [oracle, setOracle] = useState<typeof ORACLE_CLEAR>(ORACLE_CLEAR);
  useEffect(() => {
    if (assetType !== "stock-token" || !feedMap) { setOracle(ORACLE_CLEAR); return; }
    const feed = feedMap[stock];
    if (!feed) { setOracle(ORACLE_CLEAR); return; } // no Chainlink feed for this token
    let alive = true;
    // Token switch → clear the previous token's reading while this one loads. A same-token
    // refresh (30s ov-poll cadence) keeps the last reading on screen instead of blinking to
    // "—" for the duration of the eth_call — the fresh read overwrites it below.
    setOracle((cur) => (cur.sym === stock ? cur : ORACLE_CLEAR));
    readOracleReading(feed.proxy, feed.decimals)
      .then((r) => {
        if (!alive) return;
        const now = Math.floor(Date.now() / 1000);
        setOracle({
          sym: stock,
          fresh: classifyOracleFresh(r, feed.heartbeat, now),
          ageSec: r.updatedAt != null ? Math.max(0, now - r.updatedAt) : null,
          price: r.price != null && r.price > 0 ? r.price : null,
        });
      })
      .catch(() => { if (alive) setOracle(ORACLE_CLEAR); }); // read failure → honest unknown, never a kept stale "healthy"
    return () => { alive = false; };
  }, [assetType, stock, feedMap, ov]);
  /* The reading as seen by THIS token — a not-yet-flushed reading for the previous token is
     treated as "no reading" (unknown), never crossed with the new token's spot price. */
  const oracleForStock = oracle.sym === stock ? oracle : ORACLE_CLEAR;

  /* Premium/discount vs the token's Chainlink feed (#14): Arcus spot last vs feed price. The
     feed prices the token (multiplier baked in), so this is a direct comparison — an estimate,
     never RHJ's official deviation methodology. */
  const premiumPct = useMemo(
    () => (assetType === "stock-token" ? computePremiumPct(info?.quote?.price ?? null, oracleForStock.price) : null),
    [assetType, info?.quote?.price, oracleForStock.price]
  );

  /* Corporate action (#13): live from the token contract's newUIMultiplier()/effectiveAt().
     A failed/not-yet-landed read is "unknown" (honest caution), never "none scheduled".
     `now` ticks every 60s, so a schedule crossing its effective time flips pending→paused live. */
  const corpAction: CorporateActionState = useMemo(() => {
    if (assetType !== "stock-token") return "none";
    if (!stiSnap) return "unknown";
    return corporateActionStatus(stiSnap, Math.floor((now ?? Date.now()) / 1000));
  }, [assetType, stiSnap, now]);

  const risk = useMemo(
    () => riskSnapshotFor(stock, assetType, marketState, stiSnap?.oraclePaused ?? null, oracleForStock.fresh, premiumPct, corpAction),
    [stock, assetType, marketState, stiSnap, oracleForStock.fresh, premiumPct, corpAction]
  );

  /* RFQ quote vs oracle (#15 spot): this quote's price vs the token's Chainlink feed. The sell
     amount comes from `quoteSellRaw` (the amount the quote was requested for), never the live
     input — editing the amount must not re-price a quote it doesn't belong to. USDG is treated
     as $1 (same convention as the holdings table). */
  const quoteVsOraclePct = useMemo(() => {
    if (assetType !== "stock-token" || !quote || quoteSellRaw == null || oracleForStock.price == null) return null;
    const amt = Number(formatUnits(quoteSellRaw, sellDecimals, 10));
    const out = Number(formatUnits(quote.buyAmount, buyDecimals, 10));
    if (!Number.isFinite(amt) || amt <= 0 || !Number.isFinite(out) || out <= 0) return null;
    // buy: pay USDG for tokens → token price = USDG in / tokens out; sell: USDG out / tokens in
    const effPrice = dir === "buy" ? amt / out : out / amt;
    return computePremiumPct(effPrice, oracleForStock.price);
  }, [assetType, quote, quoteSellRaw, oracleForStock.price, dir, sellDecimals, buyDecimals]);

  /* Holdings: every Stock Token with a non-zero balance (not just the selected one), including
     wrapped placeholders (behave like the stock, non-transferable until the maker settles them). */
  type HoldingRow = { sym: string; raw: bigint; decimals: number; price: number | null; wrapped: boolean; shares: bigint | null };
  const holdingRows = useMemo(() => {
    if (!bal) return [] as HoldingRow[];
    const rows: HoldingRow[] = [];
    // Share-equivalent = raw × uiMultiplier ÷ 1e18. Surfaced once the multiplier drifts off 1.0 in
    // EITHER direction (dividend/forward or reverse split) — at launch tokens == shares exactly, so
    // `shares` stays null and the Balance column is unchanged. Wrapped tracks the same underlying.
    const sharesFor = (raw: bigint, sym: string): bigint | null => {
      const m = multBySym[sym];
      return m != null && m !== UI_MULTIPLIER_ONE ? sharesFromTokenAmount(raw, m) : null;
    };
    for (const t of holdingTokens) {
      const price = ov[t.symbol]?.quote?.price ?? null;
      const native = bal.stock[t.address.toLowerCase()];
      if (native != null && native > 0n) rows.push({ sym: t.symbol, raw: native, decimals: t.decimals, price, wrapped: false, shares: sharesFor(native, t.symbol) });
      const wAddr = t.wrappedTokenAddress?.toLowerCase();
      const wrapped = wAddr ? bal.stock[wAddr] : undefined;
      // priced at the underlying's feed (the wrapped token is a claim on it)
      if (wAddr && wrapped != null && wrapped > 0n)
        rows.push({ sym: t.symbol, raw: wrapped, decimals: wrappedDec[wAddr] ?? t.decimals, price, wrapped: true, shares: sharesFor(wrapped, t.symbol) });
    }
    return rows.sort((a, b) => a.sym.localeCompare(b.sym) || Number(a.wrapped) - Number(b.wrapped));
  }, [bal, holdingTokens, ov, wrappedDec, multBySym]);
  const hasWrapped = holdingRows.some((h) => h.wrapped);

  /* Portfolio Heat (lib/domain/portfolio-heat): exposure/concentration over the wallet's Stock
     Token holdings. USDG cash is the quote asset, not risk exposure — excluded by design. A
     holding whose price is unreadable is NEVER counted as zero: it flags the whole panel as
     partial and degrades its data state (unknown ≠ safe). */
  const heat = useMemo(() => {
    if (!bal || holdingRows.length === 0) return null;
    // The overview poll KEEPS the last prices on failure — so a retained price is only "fresh"
    // while the last successful refresh is recent (poll is 30s; 120s = several missed polls).
    const pricesFresh = ovAt > 0 && Date.now() - ovAt <= 120_000;
    const holdings: HeatHolding[] = holdingRows.map((h) => {
      const crypto = (ov[h.sym]?.category ?? "").toUpperCase() === "CRYPTO";
      const amount = Number(formatUnits(h.raw, h.decimals, 8));
      return {
        instrument: {
          chain: "robinhood-chain" as const,
          kind: crypto ? ("spot-crypto" as const) : ("spot-tokenized-equity" as const),
          base: h.sym,
          quote: "USDG",
        },
        notionalUsd: h.price != null && Number.isFinite(amount) ? amount * h.price : null,
        valueState: h.price == null ? ("unknown" as const) : pricesFresh ? ("fresh" as const) : ("stale" as const),
      };
    });
    return computePortfolioHeat(holdings);
  }, [bal, holdingRows, ov, ovAt]);

  /* Swap history: local (this device, clean data) + Arcus indexer, deduped by tx hash so a swap
     the indexer has caught up on is not counted twice. Local wins (it has the readable summary). */
  const history = useMemo<HistRow[]>(() => {
    const byHash = new Map<string, HistRow>();
    for (const t of trades) {
      const hash = firstStr(t, ["txHash", "transactionHash", "hash", "tx"]);
      if (!hash) continue;
      byHash.set(hash.toLowerCase(), { at: parseTradeTime(firstStr(t, ["createdAt", "timestamp", "time", "blockTimestamp", "blockTime"])), summary: tradeSummary(t), hash, src: "indexed", valueUsd: null });
    }
    for (const s of localSwaps) {
      // USD value = the USDG side of the swap (USDG is the quote token, $1 ≈ 1 USDG)
      const usdgSide = s.sellSym === "USDG" ? s.sellAmt : s.buySym === "USDG" ? s.buyAmt : null;
      const valueUsd = usdgSide != null && Number.isFinite(Number(usdgSide)) ? Number(usdgSide) : null;
      byHash.set(s.hash.toLowerCase(), { at: s.at, summary: `${s.sellAmt} ${s.sellSym} → ${s.buyAmt} ${s.buySym}`, hash: s.hash, src: "local", valueUsd });
    }
    return [...byHash.values()].sort((a, b) => b.at - a.at).slice(0, 40);
  }, [trades, localSwaps]);

  return (
    <div className="dm-root dm-embedded spot-root" translate="no">
      {bootErr ? (
        <div className="spot-booterr" role="alert">
          <span>Couldn&rsquo;t load Arcus markets. Check your connection and try again.</span>
          <button className="btn btn-ghost btn-sm" onClick={() => { setBootErr(false); setReloadKey((k) => k + 1); }}>Retry</button>
        </div>
      ) : null}
      {/* instrument header — calm market context, strong left hierarchy */}
      <header className="spot-head">
        <div className="spot-inst">
          <MarketPicker items={Object.values(ov)} value={stock} onSelect={setStock} favorites={favs} onToggleFav={toggleFav} />
          {info?.quote?.price != null ? (
            <div className="spot-quote">
              <span className="spot-price">{fmtPrice(info.quote.price)} <i>USDG</i></span>
              <span className={`spot-chg ${(info.quote.changePercent24h ?? 0) >= 0 ? "dm-long" : "dm-short"}`}>{(info.quote.changePercent24h ?? 0) >= 0 ? "+" : ""}{(info.quote.changePercent24h ?? 0).toFixed(2)}%</span>
              {info.quote.volume24h ? <span className="spot-metric"><i>24h vol</i> ${(info.quote.volume24h / 1e6).toFixed(1)}M</span> : null}
            </div>
          ) : <span className="spot-price spot-price-wait">—</span>}
        </div>
        <div className="spot-head-tags">
          <span className="spot-live"><i className="live-dot" aria-hidden /> {c.live}</span>
          {assetType !== "crypto" && marketState.open != null ? (
            <span
              className={`spot-mkt ${marketState.open ? "spot-mkt-open" : "spot-mkt-closed"}`}
              title={marketState.source === "venue"
                ? "Market status from Arcus (venue calendar incl. holidays/half-days)."
                : "Estimated from NYSE regular hours — Arcus applies its own calendar (holidays/half-days)."}
            >
              US market · {marketState.open ? "Open" : "Closed"}{marketState.source === "venue" ? "" : " (est.)"}
            </span>
          ) : null}
        </div>
      </header>

      <main className="spot-grid">
        <div className="spot-riskcol">
          <SpotRwaRiskPanel stock={stock} assetType={assetType} level={risk.level} reasons={risk.reasons} market={marketState} volume24h={info?.quote?.volume24h ?? null} oraclePaused={stiSnap?.oraclePaused ?? null} oracleFresh={oracleForStock.fresh} oracleAgeSec={oracleForStock.ageSec} premiumPct={premiumPct} corporateAction={corpAction} corporateEffectiveAt={sti?.pending?.effectiveAt ?? null} corporateLoading={stiLoading} />
          {assetType === "stock-token" ? (
            <details className="spot-assetdetails">
              <summary>
                <span className="spot-assetdetails-label">Token terms</span>
                <strong>
                  Reg S debt · {sti
                    ? `1 ${stock} = ${sti.multiplierX.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ${sti.multiplierX === 1 ? "share" : "shares"}`
                    : stiLoading ? "reading on-chain terms…" : "on-chain terms unavailable"}
                </strong>
                <CaretDown className="spot-detail-caret" size={14} weight="bold" />
              </summary>
              <div className="spot-assetdetails-body">
                {sti ? (
                  <div className="spot-assetmetrics">
                    {info?.quote?.price != null ? <span><i>Token price</i><b>$${fmtPrice(info.quote.price)}</b></span> : null}
                    {sti.perSharePrice != null ? <span><i>Per share (equiv.)</i><b>$${fmtPrice(sti.perSharePrice)}</b></span> : null}
                  </div>
                ) : null}
                <p>
                  Stock Tokens are Reg S tokenized <b>debt securities</b> issued by Robinhood Assets (Jersey).
                  They provide economic exposure to the underlying, not share ownership.
                </p>
                <p>
                  The issuer applies its own jurisdiction and investor-eligibility rules beyond Arcus&rsquo;s venue check;
                  Ryntra does not verify that list. Confirm eligibility under the issuer&rsquo;s terms before trading.
                </p>
                {sti?.hasDrift ? (
                  <p>Dividend reinvestment increases the on-chain multiplier, so token price and headline share price can differ without representing a market premium.</p>
                ) : null}
                {sti?.pending ? (
                  <p className="spot-asset-alert">
                    Corporate action {corpAction === "paused" ? "is processing" : "is scheduled"}; trading may pause and open orders may be canceled around the effective time.
                  </p>
                ) : null}
                {sti?.oraclePaused ? <p className="spot-asset-alert is-danger">Oracle paused. Avoid new trades until the feed resumes.</p> : null}
              </div>
            </details>
          ) : null}
        </div>

        {/* chart shell — a premium header integrates it into Ryntra, honest about RFQ (no order book) */}
        <section className="spot-chart-wrap">
          <div className="spot-chart-head">
            <div className="spot-chart-titles">
              <h2 className="spot-chart-title">{stock}/USDG <span>· Arcus spot</span></h2>
              {/* No order-book visuals off a CLOB: the guard (lib/domain/capability) drives the
                  disclaimer — an RFQ/AMM route gets the honest subtitle, never a fake DOM. */}
              {!orderbookAllowed(ROUTES["arcus-spot-rfq"].structure) ? (
                <p className="spot-chart-sub">RFQ reference chart · not an exchange order book</p>
              ) : null}
            </div>
          </div>
          <ProChart
            candles={candles}
            symbolLabel={`${stock}/USDG`}
            tfSeconds={tfToSeconds(tf)}
            theme={chartTheme}
            timeframes={TFS}
            tf={tf}
            onTfChange={(x) => setTf(x as (typeof TFS)[number])}
            storageNamespace="swap"
            drawingScope={`spot:${stock}`}
            chartClassName="spot-chart"
            features={{ drawings: FLAGS.terminal.chartDrawings, indicators: FLAGS.terminal.chartIndicators }}
          />
        </section>

        {/* RFQ execution ticket — institutional order ticket, not a generic crypto swap widget */}
        <aside className="spot-ticket">
          <div className="tkt-head">
            <div className="tkt-head-main">
              <span className="tkt-eyebrow">{c.title}</span>
              <h2 className="tkt-order">Market order</h2>
            </div>
            <span className="tkt-rfq" title="Priced by Arcus request-for-quote">RFQ</span>
          </div>

          {!address ? (
            walletMissing ? <p className="dm-warnline">{c.noWallet}</p>
              : (
                <div className="tkt-connect">
                  <p className="tkt-connect-copy">Connect a wallet to price and sign swaps. Non-custodial — Ryntra never holds your funds or keys.</p>
                  <button className="tkt-cta" onClick={() => void connect()}>{c.connectWallet}</button>
                </div>
              )
          ) : (
            <div className="tkt-body">
              <div className="tkt-leg">
                <div className="tkt-leg-top">
                  <span>{c.youPay}</span>
                  {sellBal != null ? <button className="swap-max" onClick={() => setAmountIn(formatUnits(sellBal, sellDecimals, sellDecimals))} disabled={ticketLocked}>{c.balance}: {formatUnits(sellBal, sellDecimals, 4)} {sellSym} · {c.max}</button> : null}
                </div>
                <div className="tkt-leg-body">
                  <input aria-label={c.youPay + ": " + sellSym} inputMode="decimal" placeholder="0.0" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} disabled={ticketLocked} />
                  <span className="swap-token swap-token-fixed">{sellSym}</span>
                </div>
              </div>

              {needsFunding ? (
                <p className="cb-hint swap-fund-hint">
                  Balance below the ${MIN_NOTIONAL_USDG} Arcus minimum —{" "}
                  <a href={LINKS.arcus} target="_blank" rel="noreferrer">fund your wallet on Arcus</a>.{" "}
                  <span className="dm-fine">This link may carry Arcus registration attribution. The recipient, economics, and control of any provider-supplied spot referral code are unverified; the current route supports no Ryntra-controlled code.</span>
                </p>
              ) : null}

              <div className="tkt-flip"><button onClick={() => { setDir(dir === "buy" ? "sell" : "buy"); setAmountIn(""); setQuote(null); setQuoteSellRaw(null); }} disabled={ticketLocked} aria-label="Swap direction"><ArrowsDownUp size={15} weight="bold" /></button></div>

              <div className="tkt-leg tkt-leg-out">
                <div className="tkt-leg-top"><span>{c.youReceive}</span></div>
                <div className="tkt-leg-body"><input readOnly value={quoting ? "…" : buyAmount} placeholder="0.0" tabIndex={-1} /><span className="swap-token swap-token-fixed">{buySym}</span></div>
              </div>

              {/* Quote comparison, NOT a route selector: plain informational rows driven by the
                  SHARED registries (ROUTES + ROUTE_CAPABILITIES). Execution in Ryntra runs through
                  Arcus only; the Uniswap leg is a live read-only quote — "no liquidity" is a
                  checked fact, "could not check" is a transport failure, never conflated. */}
              <details className="tkt-routes" aria-label={c.routes.title}>
                <summary className="tkt-routes-summary">
                  <span>{c.routes.title}</span>
                  <strong>{arcusRoute.shortLabel} · {quoteFee ? `${quoteFee.totalBps} bps` : "—"}</strong>
                  <CaretDown className="spot-detail-caret" size={14} weight="bold" />
                </summary>
                <div className="tkt-routes-panel">
                  <div className="tkt-route">
                    <div className="tkt-route-main">
                      <span className="tkt-route-name">{arcusRoute.shortLabel}{arcusBest ? <em className="tkt-route-best">{c.routes.best}</em> : null}</span>
                      <span className={`tkt-route-out${quote && !arcusStale ? "" : " muted"}`}>{quote ? `${buyAmount} ${buySym}${arcusStale ? ` · ${c.routes.stale}` : ""}` : quoting ? c.routes.checking : "—"}</span>
                    </div>
                    <div className="tkt-route-sub">
                      <span>{sellToken && buyToken
                        ? arcusCap.ryntra === "live" && executionRouteSupported ? c.routes.executable : c.routes.unsupported
                        : c.routes.quoteOnly}</span>
                      <span title={c.routes.arcusFee}>{c.routes.feeLabel} {quoteFee ? `${quoteFee.totalBps} bps` : "—"}</span>
                    </div>
                  </div>
                  <div className="tkt-route">
                    <div className="tkt-route-main">
                      <span className="tkt-route-name">{uniRoute.shortLabel}{uniBest ? <em className="tkt-route-best">{c.routes.best}</em> : null}</span>
                      <span className={`tkt-route-out${uniQuoted && !uniStale ? "" : " muted"}`}>
                        {uniQuoted ? `${uniOut} ${buySym}${uniStale ? ` · ${c.routes.stale}` : ""}`
                          : uniQuote?.status === "no-liquidity" ? c.routes.noLiquidity
                          : uniQuote?.status === "error" ? c.routes.unavailable
                          : rawIn != null && rawIn > 0n ? c.routes.checking : "—"}
                      </span>
                    </div>
                    <div className="tkt-route-sub">
                      <span>{uniCap.ryntra === "live" ? c.routes.executable : c.routes.quoteOnly}</span>
                      <span title={c.routes.uniFee}>{c.routes.feeLabel} {uniQuoted ? `${uniQuoted.feeTierBps} bps` : "—"}</span>
                    </div>
                  </div>
                  <p className="tkt-routes-note">{c.routes.choose}</p>
                </div>              </details>

              <div className="tkt-rows">
                <div className="tkt-row">
                  <span>{c.minReceived}</span>
                  <b className={quote && minReceived ? "" : "tkt-muted"}>{quote ? (minReceived ? `${minReceived} ${buySym}` : "—") : quoting ? c.quoting : "Enter an amount"}</b>
                </div>
                {/* slot always rendered for tokens with a feed — the row appearing with the quote
                    would shift the CTA at the exact moment it becomes clickable */}
                {assetType === "stock-token" && oracleForStock.price != null ? (
                  <div className="tkt-row" title="This quote's price vs the token's Chainlink feed — indicative, Ryntra's own estimate. The executed price comes from the fresh quote fetched when you sign.">
                    <span>Quote vs oracle</span>
                    <b className={quoteVsOraclePct == null ? "tkt-muted" : Math.abs(quoteVsOraclePct) >= HIGH_PREMIUM_PCT ? "tkt-warn" : ""}>
                      {quoteVsOraclePct != null ? fmtPremium(quoteVsOraclePct) : "—"}
                    </b>
                  </div>
                ) : null}
                <div className="tkt-row">
                  <span>{c.slippage}</span>
                  <span className="swap-slip">{[10, 50, 100].map((b) => <button key={b} className={slippageBps === b ? "on" : ""} aria-pressed={slippageBps === b} onClick={() => setSlippageBps(b)} disabled={ticketLocked}>{b / 100}%</button>)}</span>
                </div>
              </div>

              {pendingSwap ? (
                <div ref={signedReviewRef} className="tkt-signed-review" data-testid="signed-intent-review" role="status">
                  <p className="tkt-confirm-hint">{c.confirmHint}</p>
                  <div className="tkt-rows">
                    <div className="tkt-row"><span>{c.youPay}</span><b>{reviewSellAmount} {pendingSwap.sellSym}</b></div>
                    <div className="tkt-row"><span>{c.youReceive}</span><b>{reviewBuyAmount} {pendingSwap.buySym}</b></div>
                    <div className="tkt-row"><span>{c.minReceived}</span><b>{minReceived} {pendingSwap.buySym}</b></div>
                    <div className="tkt-row"><span>{c.routes.title}</span><b>{pendingSwap.intent.venue} · Arcus settlement</b></div>
                    <div className="tkt-row"><span>{c.platformFee}</span><b>{pendingSwap.intent.feeBps} bps · {pendingSwap.intent.feeAmountDecimal} {pendingSwap.intent.feeSymbol} · {pendingSwap.intent.feeSide === "source" ? c.feeFromPay : c.feeFromReceive}</b></div>
                    <div className="tkt-row"><span>{c.signedRouterFee}</span><b>{pendingSwap.intent.feeSignedBps} bps</b></div>
                    <div className="tkt-row"><span>{c.networkGas}</span><b>{c.networkGasWallet}</b></div>
                    <div className="tkt-row"><span>{c.expiresAt}</span><b>{signedExpiresLabel}</b></div>
                    <div className="tkt-row"><span>RFQ ID</span><b>{pendingSwap.intent.quoteId}</b></div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm tkt-discard"
                    data-testid="discard-signed-quote"
                    onClick={() => {
                      const restoreFocus = signedReviewRef.current?.contains(document.activeElement) ?? false;
                      setPendingSwap(null);
                      setExecErr(null);
                      setTxMsg(c.signedQuoteDiscarded);
                      if (restoreFocus) window.requestAnimationFrame(() => primaryActionRef.current?.focus());
                    }}
                  >
                    {c.discardSignedQuote}
                  </button>
                </div>
              ) : null}

              {/* Venue/wallet compliance from Arcus's own live signal — honest, never suggests a VPN.
                  Read-only stays; only signing is gated (mirrors the venue's own 403 GEO_RESTRICTED). */}
              {compliance?.spotBlockReason === "geo" ? (
                <p className="dm-warnline" role="alert">Arcus reports spot trading isn&rsquo;t available from your region{compliance.country ? ` (${compliance.country})` : ""}. You can view prices; signing is disabled here.</p>
              ) : compliance?.spotBlockReason === "wallet" ? (
                <p className="dm-warnline" role="alert">Arcus flagged this wallet as restricted. Signing is disabled — an eligible wallet is required.</p>
              ) : null}
              {compliance?.bypassed ? (
                <p className="cb-hint" role="alert">Arcus detected a VPN or proxy on this connection. Circumventing region restrictions violates the Arcus Terms.</p>
              ) : null}
              {!complianceReady && !complianceBlocked ? (
                <p className="dm-warnline" role="status">
                  {complianceLoading && !complianceFailed ? c.complianceChecking : c.complianceRetry}
                  {!complianceLoading ? (
                    <> · <button type="button" className="btn btn-ghost btn-sm" onClick={() => setComplianceRefreshKey((n) => n + 1)}>{c.complianceRetry}</button></>
                  ) : null}
                </p>
              ) : null}

              {sellToken && buyToken && !executionRouteSupported ? <p className="dm-warnline" role="alert">{c.executionUnsupported}</p> : null}
              {quoteErr && approvalState !== "required" ? <p className="dm-warnline">{quoteErr}</p> : null}
              {quote && !quoteFee ? <p className="dm-warnline" role="alert">{c.feeUnavailable}</p> : null}
              {busy ? <p className="cb-hint" role="status" aria-live="polite">{stepLabel}</p> : null}
              {execErr ? <p className="dm-err" role="alert">{execErr}</p> : null}
              {submissionUncertain ? (
                <div className="dm-offguard" role="alert" data-testid="wallet-attempt-recovery">
                  <p className="dm-warnline">
                    {submissionAttempt?.kind === "approval" ? c.approvalUnknown : c.submissionUnknown}
                  </p>
                  <p id="wallet-recovery-check" className="cb-hint">
                    {c.recoveryWalletCheck}
                  </p>
                  {submissionAttempt?.hash ? (
                    <a
                      className="btn btn-ghost btn-sm tkt-recovery-action"
                      href={`${EXPLORER_TX}${submissionAttempt.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-describedby="wallet-recovery-check"
                    >
                      {c.recoveryViewTransaction}
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm tkt-recovery-action"
                    aria-describedby="wallet-recovery-check"
                    onClick={() => {
                      if (!address) return;
                      if (!releaseSubmissionAttempt(address)) return;
                      setPendingSwap(null);
                      setExecErr(null);
                      setTxMsg(c.recoveryCleared);
                      setApprovalState("checking");
                      setApprovalRefreshKey((n) => n + 1);
                      setQuoteRefreshKey((n) => n + 1);
                      window.requestAnimationFrame(() => statusMessageRef.current?.focus());
                    }}
                  >
                    {c.recoveryClear}
                  </button>
                </div>
              ) : null}

              {txMsg && !busy ? <p ref={statusMessageRef} tabIndex={-1} className="cb-ok" role="status" aria-live="polite">{txMsg}</p> : null}

              <button ref={primaryActionRef} className="tkt-cta" disabled={!canPrimaryAction} onClick={() => {
                if (pendingSwap) void doSubmitSwap();
                else if (needsApprove) void doApprove();
                else if (approvalState === "unavailable") { setApprovalState("checking"); setApprovalRefreshKey((n) => n + 1); }
                else void doSignSwap();
              }}>
                {busy ? (stepLabel || c.swapping)
                  : submissionUncertain ? c.submissionLocked
                  : pendingSwap ? c.confirmTransaction
                  : complianceBlocked ? (compliance?.spotBlockReason === "wallet" ? "Wallet restricted" : "Unavailable in your region")
                  : overBalance ? c.insufficient
                  : !amountIn ? c.enterAmount
                  : belowMin ? `${c.minOrder} $${MIN_NOTIONAL_USDG}`
                  : sellToken && buyToken && !executionRouteSupported ? c.executionUnsupportedCta
                  : approvalState === "unavailable" ? c.allowanceRetry
                  : approvalState === "checking" ? c.allowanceChecking
                  : !complianceReady ? c.complianceChecking
                  : quoting ? c.quoting
                  : needsApprove ? c.approveOneTime.replace("{sym}", sellSym)
                  : c.signIntent.replace("{asset}", dir === "buy" ? stock : "USDG")}
              </button>
              {needsApprove && executionRouteSupported && !busy && complianceReady ? <p className="cb-hint" style={{ marginTop: 6 }}>{c.approveHint.replace("{sym}", sellSym)}</p> : null}

              <p className="tkt-foot" title={c.trust}>{c.trustShort}</p>
            </div>
          )}
        </aside>

        {/* positions / orders / activity */}
        <section className="spot-bottom">
          <div className="spot-bottom-head">
            <div className="dm-tabs">
              <button className={tab === "holdings" ? "on" : ""} onClick={() => setTab("holdings")}>Holdings</button>
              <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>Swap history {history.length ? `(${history.length})` : ""}</button>
            </div>
            <span className="spot-src">Read-only · public account data</span>
          </div>
          {tab === "holdings" ? (
            !address ? <p className="dm-empty">Connect your wallet to see Stock Token balances. Ryntra reads public account data only — no keys, no custody.</p> : (
              <div className="dm-table-wrap">
                {/* Portfolio heat — exposure/concentration over holdings; cash (USDG) excluded.
                    partialData/dataState come from the engine: an unreadable value degrades the
                    strip visibly instead of silently shrinking the portfolio. */}
                {heat && heat.exposures.length > 0 ? (
                  <div className={`spot-heat${heat.dataState !== "fresh" ? " spot-heat-degraded" : ""}`} role="group" aria-label={c.heat.title}>
                    <span className="spot-heat-title">{c.heat.title}</span>
                    <span className="spot-heat-item">
                      {heat.exposures[0].instrument.base} {heat.exposures[0].pct.toFixed(0)}% · {c.heat.largest}
                    </span>
                    <span className="spot-heat-item">
                      {heat.groups.map((g) => `${g.family === "equities" ? c.heat.equities : c.heat.crypto} ${g.pct.toFixed(0)}%`).join(" / ")}
                    </span>
                    {heat.warnings.some((w) => w.startsWith("concentration:")) ? <span className="spot-heat-warn">{c.heat.concentrated}</span> : null}
                    {heat.warnings.some((w) => w.startsWith("correlated:")) ? <span className="spot-heat-warn">{c.heat.correlated}</span> : null}
                    {heat.partialData ? <span className="spot-heat-warn">{c.heat.partial}</span> : null}
                  </div>
                ) : null}
                <table className="dm-table">
                  <thead><tr><th>Asset</th><th>Balance</th><th>Price</th><th>Value</th></tr></thead>
                  <tbody>
                    <tr><td>USDG</td><td>{bal ? formatUnits(bal.usdg, USDG_DECIMALS, 4) : "—"}</td><td>$1.00</td><td>${bal ? formatUnits(bal.usdg, USDG_DECIMALS, 2) : "—"}</td></tr>
                    {holdingRows.map((h) => (
                      <tr key={`${h.sym}${h.wrapped ? ":w" : ""}`}>
                        <td>{h.wrapped ? <>w{h.sym} <span className="dm-fine">· awaiting settlement</span></> : h.sym}</td>
                        <td>
                          {formatUnits(h.raw, h.decimals, 6)}
                          {h.shares != null ? <span className="dm-fine" title="Underlying share-equivalent after this token's corporate actions (balance × on-chain uiMultiplier)."> · ≈{formatUnits(h.shares, h.decimals, 4)} sh</span> : null}
                        </td>
                        <td>{h.price != null ? `${h.wrapped ? "≈" : ""}$${fmtPrice(h.price)}` : "—"}</td>
                        <td>{h.price != null ? `${h.wrapped ? "≈" : ""}$${(Number(formatUnits(h.raw, h.decimals, 8)) * h.price).toFixed(2)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {hasWrapped ? <p className="cb-hint">{c.wrappedNote}</p> : null}
                {bal && holdingRows.length === 0 ? <p className="dm-empty">No Stock Token holdings yet. Complete a swap in the ticket to see balances here.</p> : null}
              </div>
            )
          ) : (
            history.length === 0 ? (
              <p className="dm-empty">No swaps yet on this address. Once you swap, it appears here immediately — the Arcus indexer may take longer to confirm it independently.</p>
            ) : (
              <div className="dm-table-wrap">
                <table className="dm-table">
                  <thead><tr><th>Time</th><th>Swap</th><th>Value</th><th>Source</th><th>Tx</th></tr></thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.hash}>
                        <td className="mono">{fmtSwapTime(h.at)}</td>
                        <td className="mono">{h.summary}</td>
                        <td className="mono">{h.valueUsd != null ? `$${h.valueUsd.toFixed(2)}` : "—"}</td>
                        <td>{h.src === "local" ? "This device" : "Arcus indexer"}</td>
                        <td className="mono" title={h.hash}>
                          <a className="spot-txlink" href={`${EXPLORER_TX}${h.hash}`} target="_blank" rel="noreferrer">{h.hash.slice(0, 10)}…{h.hash.slice(-6)} <ArrowUpRight size={11} weight="bold" /></a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="cb-hint">On-chain settlement is immediate; the Arcus indexer can lag, so rows from this device may appear before the indexer confirms them.</p>
              </div>
            )
          )}
        </section>
      </main>
    </div>
  );
}
