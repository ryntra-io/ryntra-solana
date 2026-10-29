"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ExecutionPlanBinding, PlanReview, RuleBinding } from "@/lib/api/v1/contract";
import type { SolanaActionOrigin } from "@/lib/solana/action-origin";
import { parseHumanAmount, scaleRawAmount } from "@/lib/solana/amounts";
import type { SolanaPolicyVerdict } from "@/lib/solana/contracts";
import { MAX_SIGNABLE_WINDOW_MS, mayOpenWallet, msUntilBytesDie, signableWindowClosed } from "@/lib/solana/blockhash-life";
import { SOLANA_MAINNET_USDC_MINT, WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";
import { storeBoundSolanaReceipt } from "@/lib/solana/send-receipt-vault.client";
import { assessSwapWalletAdoption } from "@/lib/solana/swap-adoption";
import {
  assessSwapClientReview,
  freshOrderNoWorse,
  swapQuoteMatches,
  parseSwapClientAttempt,
  readSwapClientSignature,
  shouldAutoRefreshQuote,
  transitionSwapClientAttempt,
  type SwapClientAttempt,
} from "@/lib/solana/swap-client-safety";
import { swapFailureCopy } from "@/lib/solana/swap-failure-copy";
import type { SwapPolicyVerdict } from "@/lib/solana/swap-policy";
import { inspectJupiterSwapTransaction } from "@/lib/solana/swap-transaction-check";
import { signTransaction } from "@/lib/solana/wallet.client";
import type { RyntraServiceFee } from "@/lib/swap/service-fee";
import type { SpotTradeContext } from "@/lib/spot/ticket-state";
import type { SwapCheck } from "@/lib/stocks/check";

import type { SolanaConnectionValue } from "../connection.tsx";

/**
 * The Spot order ticket's flow — Market Buy / Sell on the engine Swap runs.
 *
 * This is the same four calls the Swap card makes, in the same order, with the
 * same checks between them: `/quote` while the amount is typed, `/order` for
 * an exact signable Review, the wallet's signature inspected and compared to
 * the reviewed bytes, one `/execute`, and `/recover` for anything the network
 * left unknown. No second execution mechanism exists; what differs is only the
 * shape of the question — *buy 0.5 SOL with USDC* rather than *swap USDC for
 * SOL* — and the `origin` the order carries so History says which it was.
 *
 * The one client attempt record is shared with Swap under the same storage
 * key: a signature is a signature, and a person who signs here and opens Swap
 * must find the same *Check transaction* there, not a second order form.
 */

/* The two quote assets, with the icons the catalogue itself names for them. */
export const SPOT_QUOTE_ASSETS = [
  {
    mint: SOLANA_MAINNET_USDC_MINT,
    symbol: "USDC",
    decimals: 6,
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
  },
  {
    mint: WRAPPED_SOL_MINT,
    symbol: "SOL",
    decimals: 9,
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  },
] as const;

/**
 * The side a market is bought with or sold into: Spot's two quote assets, or
 * (the IPO and conversion watch) the token an issuer points a swap to — a
 * pre-IPO token sold straight into its listed token. The hook reads only the
 * mint, the symbol and the decimals.
 */
export type SpotQuoteAsset = Readonly<{ mint: string; symbol: string; decimals: number; icon?: string }>;

const QUOTE_DEBOUNCE_MS = 450;
const LOCAL_FAILURE_CODES: ReadonlySet<string> = new Set([
  /* The sentences this hook writes itself, already through `text()`. Every
     other code is named by the same translated family copy Swap uses. */
  "BLOCKHASH_STILL_VALID",
  "SIGNATURE_UNREADABLE",
  "SAME_MINT",
  "REVIEW_CLOSED_UNDER_WALLET",
]);
const ATTEMPT_STORAGE_KEY = "ryntra.solana.m2.swap-client-attempt.v1";
const RECOVERY_DEADLINE_MS = 150_000;
const RECOVERY_INTERVAL_MS = 3_000;

export type SpotSide = SolanaActionOrigin["side"];

export type SpotQuote = Readonly<{
  order: Readonly<{
    inputMint: string;
    outputMint: string;
    inAmountRaw: string;
    outAmountRaw: string;
    minReceivedRaw: string;
    slippageBps: number;
    priceImpactPct: string;
    router: string;
    platformFee: Readonly<{ basisPoints: number; mint: string }>;
    totalFeeBasisPoints: number;
    signatureFeeLamports: string;
    priorityFeeLamports: string;
    rentFeeLamports: string;
    requestId: string;
    reviewExpiresAt: string;
    swapUsdValue: string | null;
    inUsdValue: string | null;
    outUsdValue: string | null;
    route: readonly Readonly<{ label: string; basisPoints: number }>[];
    taker: string | null;
    ryntraFee?: RyntraServiceFee | null;
  }>;
  verdict: SolanaPolicyVerdict;
  decimals: Readonly<Record<string, number>>;
  expiresAt: string;
  /** 1.20.0: «Перевірка» on the quote as the server counts it; null unless a company is bought with USDC or sold into it. */
  check?: SwapCheck | null;
}>;

/** How long from arriving an order's bytes may still be signed; a server from before AG-1 sent no figure. */
function signableMsOfOrder(order: SpotOrder): number {
  return typeof order.signableMs === "number" && Number.isFinite(order.signableMs) ? order.signableMs : MAX_SIGNABLE_WINDOW_MS;
}

export type SpotOrder = Readonly<{
  order: SpotQuote["order"] & Readonly<{ transactionBase64: string; lastValidBlockHeight: string }>;
  simulation: Readonly<{ status: "OK" | "FAILED"; ownerEffects: Readonly<{ status: "VERIFIED"; outputAmountRaw: string; inputAmountRaw: string }> | null }>;
  policy: Readonly<{ verdict: SwapPolicyVerdict }>;
  decimals: Readonly<Record<string, number>>;
  bundle: unknown;
  proof: Readonly<{ status: "SIGNED" | "UNSIGNED"; digest?: string }>;
  preSign: Readonly<{ ready: boolean; code: string; reason: string }>;
  expiresAt: string;
  /** AG-1: how long from arriving these bytes may still be signed. */
  signableMs?: number;
  /** The Strategy block, when the order was made under a plan; null on a plain order. */
  planReview?: PlanReview | null;
  /** 1.20.0: «Перевірка» on this exact order, with the reserve the simulation proved; null unless a company is bought with USDC or sold into it. */
  check?: SwapCheck | null;
}>;

export type SpotSettlement = Readonly<{
  state: string;
  signature: string;
  observation: Readonly<{ actualInputRaw: string; actualOutputRaw: string }> | null;
  facts: Readonly<{
    reconciliation: Readonly<{ state: string; minimumMet?: boolean; deviations?: readonly string[] }>;
    fees?: Readonly<{ serviceFee?: RyntraServiceFee | null }>;
  }> | null;
  receipt: unknown;
  recovery?: string;
}>;

type RecoveryResponse = Readonly<{
  state: "PENDING" | "FAILED" | "EXPIRED_BEFORE_SUBMIT" | "EXPIRED_AFTER_SUBMIT" | "ALREADY_RECEIPTED" | "RECOVERED" | "UNKNOWN_TO_CHAIN" | "SEEN_WITHOUT_RECORD";
  signature: string;
  reason?: string;
  observation?: SpotSettlement["observation"];
  facts?: SpotSettlement["facts"];
  receipt?: unknown;
}>;

export type SpotFailure = Readonly<{
  code: string;
  message: string;
  submitBoundary?: "NOT_CROSSED";
  ownerLock?: Readonly<{ state: string; requestId: string; signature: string | null }> | null;
  /** On `PLAN_REVIEW_BLOCKED` and the plan refusals of `execute`: the Strategy block that refused. */
  planReview?: PlanReview | null;
}>;

export type SpotPhase = "IDLE" | "PREPARING" | "REVIEW" | "SIGNING" | "EXECUTING" | "RECOVERING" | "SETTLED" | "RECOVERY";

async function post<T>(url: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: true; value: T } | { ok: false; failure: SpotFailure }> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal });
  } catch {
    return { ok: false, failure: { code: "NETWORK", message: "The request did not complete." } };
  }
  const value = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok && response.status !== 202) {
    const error = (value.error ?? {}) as Partial<SpotFailure>;
    return {
      ok: false,
      failure: {
        code: error.code ?? `HTTP_${response.status}`,
        message: error.message ?? "The request failed.",
        submitBoundary: error.submitBoundary,
        ownerLock: error.ownerLock ?? null,
        planReview: error.planReview ?? null,
      },
    };
  }
  return { ok: true, value: value as T };
}

export function plainAmount(rawAmount: string, decimals: number): string {
  return scaleRawAmount(rawAmount, decimals).replace(/,/g, "");
}

export type SpotTicketInput = Readonly<{
  connection: SolanaConnectionValue["connection"];
  side: SpotSide;
  /** The market being bought or sold. */
  baseMint: string | null;
  baseDecimals: number | null;
  baseSymbol: string;
  quote: SpotQuoteAsset;
  /** Human amount of the input asset: the quote for a buy, the base for a sell. */
  amount: string;
  /** The Trading Plan this order is made under, or null: sent as `origin.plan`, judged by the server, never a proof of anything. */
  planBinding?: ExecutionPlanBinding | null;
  /** The autoinvest reminder this purchase is made under, or null: sent as `origin.rule` (1.12.0); the server refuses a reminder that is not open, and the wallet's signature is still the only authorization. */
  ruleBinding?: RuleBinding | null;
  text: (english: string) => string;
  /** Called once a fill settles, so balances and fills re-read. */
  onSettled?: () => void;
  onRefresh?: () => void;
  /** Called once the wallet's signature is recorded and before the bytes are sent: what was signed, never a way to change it. */
  onSigned?: (signed: Readonly<{ signature: string; requestId: string; inputMint: string; inAmountRaw: string }>) => void;
}>;

export function useSpotTicket(input: SpotTicketInput) {
  const { connection, side, baseMint, baseDecimals, baseSymbol, quote, amount, planBinding = null, ruleBinding = null, text, onSettled, onRefresh, onSigned } = input;
  const inputMint = side === "BUY" ? quote.mint : baseMint;
  const outputMint = side === "BUY" ? baseMint : quote.mint;
  const [knownDecimals, setKnownDecimals] = useState<Readonly<Record<string, number>>>({});
  const inputDecimals = (inputMint ? knownDecimals[inputMint] : null) ?? (side === "BUY" ? quote.decimals : baseDecimals);
  const outputDecimals = (outputMint ? knownDecimals[outputMint] : null) ?? (side === "BUY" ? baseDecimals : quote.decimals);

  const [quotedRead, setQuoted] = useState<SpotQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteFailure, setQuoteFailure] = useState<SpotFailure | null>(null);
  const [phase, setPhase] = useState<SpotPhase>("IDLE");
  const [actionFailure, setActionFailure] = useState<SpotFailure | null>(null);
  const [preparedRead, setPrepared] = useState<SpotOrder | null>(null);
  const [preparedContext, setPreparedContext] = useState<SpotTradeContext | null>(null);
  const [reviewInvalidated, setReviewInvalidated] = useState(false);
  const parsedInput = inputDecimals === null ? null : parseHumanAmount(amount, inputDecimals);
  const currentInput = { inputMint: inputMint ?? "", outputMint: outputMint ?? "", amountRaw: parsedInput?.ok ? parsedInput.raw : null };
  const quoted = swapQuoteMatches(quotedRead?.order, currentInput) ? quotedRead : null;
  const prepared = preparedRead?.order.taker === connection?.address && swapQuoteMatches(preparedRead?.order, currentInput) ? preparedRead : null;
  const [attempt, setAttempt] = useState<SwapClientAttempt | null>(null);
  const [lockedReview, setLockedReview] = useState<Readonly<{ owner: string; requestId: string }> | null>(null);
  const [bytesChanged, setBytesChanged] = useState(false);
  const [settledRead, setSettled] = useState<SpotSettlement | null>(null);
  const [settledOwner, setSettledOwner] = useState<string | null>(null);
  const [settledContext, setSettledContext] = useState<SpotTradeContext | null>(null);
  const settled = connection?.address === settledOwner ? settledRead : null;
  const attemptContext = useRef<{ requestId: string; context: SpotTradeContext | null } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [reviewSecondsLeft, setReviewSecondsLeft] = useState<number | null>(null);
  const [refreshTicket, setRefreshTicket] = useState(0);
  const quoteTicket = useRef(0);
  const actionTicket = useRef(0);
  /* When the Review on screen arrived, and the order request that built it: the bytes' signable window counts from
     here, and fresh bytes at the moment of signing are asked with the same request (AG-1). */
  const preparedAt = useRef(0);
  const orderRequest = useRef<unknown>(null);
  const chasedQuotes = useRef(0);

  useEffect(() => {
    setAttempt(parseSwapClientAttempt(window.sessionStorage.getItem(ATTEMPT_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    if (!settled?.receipt) return;
    storeBoundSolanaReceipt(window.localStorage, settledOwner, settledOwner, settled.receipt);
  }, [settled?.receipt, settledOwner]);

  useEffect(() => {
    if (!connection?.address || settledOwner === null || settledOwner === connection.address) return;
    setSettled(null);
    setSettledOwner(null);
    setSettledContext(null);
    setPhase((current) => current === "SETTLED" ? "IDLE" : current);
  }, [connection?.address, settledOwner]);

  const rememberAttempt = useCallback((record: SwapClientAttempt) => {
    window.sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(record));
    setAttempt(record);
  }, []);
  const forgetAttempt = useCallback(() => {
    window.sessionStorage.removeItem(ATTEMPT_STORAGE_KEY);
    setAttempt(null);
  }, []);

  /* The live quote, on every settled keystroke. */
  useEffect(() => {
    const my = ++quoteTicket.current;
    setQuoted(null);
    setQuoteFailure(null);
    setQuoting(false);
    if (!inputMint || !outputMint || inputDecimals === null || outputDecimals === null) {
      setQuoted(null);
      setQuoteFailure(null);
      return;
    }
    if (inputMint === outputMint) {
      setQuoted(null);
      setQuoteFailure({ code: "SAME_MINT", message: text("The two sides are the same asset.") });
      return;
    }
    const parsed = parseHumanAmount(amount, inputDecimals);
    if (!parsed.ok) {
      setQuoted(null);
      setQuoteFailure(null);
      return;
    }
    const controller = new AbortController();
    setQuoting(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        const response = await post<SpotQuote>("/api/solana/swap/quote", {
          inputMint,
          outputMint,
          amountRaw: parsed.raw,
          access: "production",
        }, controller.signal);
        if (controller.signal.aborted || quoteTicket.current !== my) return;
        setQuoting(false);
        if (!response.ok) {
          setQuoted(null);
          setQuoteFailure(response.failure);
          return;
        }
        setQuoteFailure(null);
        setKnownDecimals((current) => ({ ...current, ...response.value.decimals }));
        setQuoted(response.value);
      })();
    }, QUOTE_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [amount, inputMint, outputMint, inputDecimals, outputDecimals, refreshTicket, text]);

  /* Any change to what is being bought, sold or spent — or to the plan it is made under — invalidates an open Review. */
  useEffect(() => {
    actionTicket.current += 1;
    setPrepared(null);
    setPreparedContext(null);
    setReviewInvalidated(false);
    setActionFailure(null);
    setReviewSecondsLeft(null);
    setBytesChanged(false);
    setPhase((current) => (current === "REVIEW" || current === "PREPARING" ? "IDLE" : current));
  }, [amount, inputMint, outputMint, connection?.address, planBinding?.planId, planBinding?.version, ruleBinding?.ruleId, ruleBinding?.dueAt]);

  useEffect(() => {
    if (!quoted) {
      setSecondsLeft(null);
      return;
    }
    const update = () => setSecondsLeft(Math.max(0, Math.floor((Date.parse(quoted.expiresAt) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [quoted]);

  useEffect(() => {
    if (!prepared) {
      setReviewSecondsLeft(null);
      return;
    }
    const update = () => setReviewSecondsLeft(Math.max(0, Math.floor((Date.parse(prepared.expiresAt) - Date.now()) / 1_000)));
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [prepared]);

  useEffect(() => {
    if (secondsLeft !== null && secondsLeft > 0) chasedQuotes.current = 0;
    const refresh = shouldAutoRefreshQuote({
      hasQuote: quoted !== null,
      secondsLeft,
      reviewOpen: prepared !== null,
      attemptOpen: attempt !== null,
      phase,
      documentVisible: typeof document === "undefined" || document.visibilityState === "visible",
      quoting,
      chased: chasedQuotes.current,
    });
    if (!refresh) return;
    chasedQuotes.current += 1;
    setRefreshTicket((ticket) => ticket + 1);
  }, [attempt, phase, prepared, quoted, quoting, secondsLeft]);

  const recordSettlement = useCallback((result: SpotSettlement, owner: string, context: SpotTradeContext | null) => {
    setSettledOwner(owner);
    setSettled(result);
    setSettledContext(context);
  }, []);

  const review = useCallback(async () => {
    if (!connection || attempt || !baseMint || !inputMint || !outputMint || inputDecimals === null || outputDecimals === null) return;
    const my = ++actionTicket.current;
    setActionFailure(null);
    setPrepared(null);
    setPhase("PREPARING");
    const parsed = parseHumanAmount(amount, inputDecimals);
    if (!parsed.ok) {
      setActionFailure({ code: "AMOUNT_INVALID", message: parsed.reason });
      setPhase("IDLE");
      return;
    }
    const requested = {
      input: { inputMint, outputMint, amountRaw: parsed.raw, taker: connection.address },
      origin: {
        surface: "SPOT",
        side,
        ...(planBinding ? { plan: { planId: planBinding.planId, version: planBinding.version } } : {}),
        ...(ruleBinding ? { rule: { ruleId: ruleBinding.ruleId, dueAt: ruleBinding.dueAt } } : {}),
      },
    };
    const ordered = await post<SpotOrder>("/api/solana/swap/order", requested);
    if (actionTicket.current !== my) return;
    if (!ordered.ok) {
      setActionFailure(ordered.failure);
      if (ordered.failure.ownerLock?.signature) {
        rememberAttempt({
          schema: "ryntra.solana.swap-client-attempt",
          schemaVersion: "1.0.0",
          requestId: ordered.failure.ownerLock.requestId,
          signature: ordered.failure.ownerLock.signature,
          taker: connection.address,
          state: "SUBMITTED_UNKNOWN",
          recordedAt: new Date().toISOString(),
        });
        setPhase("RECOVERY");
      } else if (ordered.failure.ownerLock?.state === "REVIEW_ISSUED") {
        setLockedReview({ owner: connection.address, requestId: ordered.failure.ownerLock.requestId });
        setPhase("REVIEW");
      } else {
        setPhase("IDLE");
      }
      return;
    }
    const assessment = assessSwapClientReview({
      verdict: ordered.value.policy.verdict,
      proofStatus: ordered.value.proof.status,
      simulationStatus: ordered.value.simulation.status,
      ownerEffectsStatus: ordered.value.simulation.ownerEffects?.status ?? "MISSING",
      expiresAt: ordered.value.expiresAt,
    });
    if (!ordered.value.preSign.ready || !assessment.ready) {
      setActionFailure({ code: assessment.code, message: assessment.reason });
      setPhase("IDLE");
      return;
    }
    preparedAt.current = Date.now();
    orderRequest.current = requested;
    setPrepared(ordered.value);
    setReviewInvalidated(false);
    setPreparedContext({
      side, baseMint, baseSymbol,
      baseDecimals: ordered.value.decimals[baseMint] ?? (side === "BUY" ? outputDecimals : inputDecimals),
      quoteMint: quote.mint, quoteSymbol: quote.symbol,
      quoteDecimals: ordered.value.decimals[quote.mint] ?? quote.decimals,
    });
    setLockedReview(null);
    setPhase("REVIEW");
  }, [amount, attempt, baseMint, baseSymbol, connection, inputDecimals, inputMint, outputDecimals, outputMint, planBinding, quote, rememberAttempt, ruleBinding, side]);

  /**
   * AG-1 — fresh bytes at the moment of signing, as the swap card does (`swap-card.tsx`, `refreshReviewedBytes`): the
   * issued Review is released once the chain says its blockhash is gone, the same order is asked again, and the wallet
   * opens on it only when the minimum and every fee are no worse; otherwise — and when the wallet answered late — the
   * fresh Review is shown instead of the network's refusal.
   */
  const refreshReviewedBytes = useCallback(async (reviewed: SpotOrder, then: "sign" | "review"): Promise<SpotOrder | null> => {
    if (!connection || attempt || !orderRequest.current) return null;
    const my = ++actionTicket.current;
    setActionFailure(null);
    setPhase("PREPARING");
    /*
     * The old bytes may still land until their blockhash dies — about when their signable window plus its margin is
     * over. Waiting for that first keeps the release to one or two asks of the chain (the action budget is 12 a
     * minute and the order and the execute need it too); "dead" is still the chain's word, never this clock.
     */
    await new Promise((resolve) => window.setTimeout(resolve, msUntilBytesDie({ receivedAtMs: preparedAt.current, signableMs: signableMsOfOrder(reviewed) }) + 1_500));
    if (actionTicket.current !== my) return null;
    for (let asked = 1; ; asked += 1) {
      const cancelled = await post<{ state: "EXPIRED_BEFORE_SUBMIT" }>(
        "/api/solana/swap/cancel-review",
        { owner: connection.address, requestId: reviewed.order.requestId },
      );
      if (actionTicket.current !== my) return null;
      if (cancelled.ok) break;
      if (cancelled.failure.code === "BLOCKHASH_STILL_VALID" && asked < 4) {
        await new Promise((resolve) => window.setTimeout(resolve, 3_000));
        if (actionTicket.current !== my) return null;
        continue;
      }
      setActionFailure(cancelled.failure);
      setPhase("REVIEW");
      return null;
    }
    const ordered = await post<SpotOrder>("/api/solana/swap/order", orderRequest.current);
    if (actionTicket.current !== my) return null;
    setBytesChanged(false);
    setReviewInvalidated(false);
    setLockedReview(null);
    if (!ordered.ok) {
      setPrepared(null);
      setActionFailure(ordered.failure);
      /* The same lock answers the first order gets: a signature already out is recovered by it, an issued Review is held. */
      if (ordered.failure.ownerLock?.signature) {
        rememberAttempt({
          schema: "ryntra.solana.swap-client-attempt",
          schemaVersion: "1.0.0",
          requestId: ordered.failure.ownerLock.requestId,
          signature: ordered.failure.ownerLock.signature,
          taker: connection.address,
          state: "SUBMITTED_UNKNOWN",
          recordedAt: new Date().toISOString(),
        });
        setPhase("RECOVERY");
      } else if (ordered.failure.ownerLock?.state === "REVIEW_ISSUED") {
        setLockedReview({ owner: connection.address, requestId: ordered.failure.ownerLock.requestId });
        setPhase("REVIEW");
      } else {
        setPhase("IDLE");
      }
      return null;
    }
    const assessment = assessSwapClientReview({
      verdict: ordered.value.policy.verdict,
      proofStatus: ordered.value.proof.status,
      simulationStatus: ordered.value.simulation.status,
      ownerEffectsStatus: ordered.value.simulation.ownerEffects?.status ?? "MISSING",
      expiresAt: ordered.value.expiresAt,
    });
    if (!ordered.value.preSign.ready || !assessment.ready) {
      setPrepared(null);
      setActionFailure({ code: assessment.code, message: assessment.reason });
      setPhase("IDLE");
      return null;
    }
    preparedAt.current = Date.now();
    setPrepared(ordered.value);
    if (then === "sign" && freshOrderNoWorse(reviewed.order, ordered.value.order)) return ordered.value;
    setActionFailure({
      code: "REVIEW_REFRESHED",
      message: then === "review"
        ? text("Your wallet answered after these bytes stopped living (about 30 seconds). Nothing was sent. Here is a fresh Review — check it and sign.")
        : text("The bytes were built again at the moment of signing, and a figure changed. Check the fresh Review and sign."),
    });
    setPhase("REVIEW");
    return null;
  }, [attempt, connection, rememberAttempt, text]);

  const signOrder = useCallback(async (prepared: SpotOrder, fresh: boolean) => {
    if (!connection || attempt) return;
    const readiness = assessSwapClientReview({
      invalidated: !fresh && (reviewInvalidated || bytesChanged),
      verdict: prepared.policy.verdict,
      proofStatus: prepared.proof.status,
      simulationStatus: prepared.simulation.status,
      ownerEffectsStatus: prepared.simulation.ownerEffects?.status ?? "MISSING",
      expiresAt: prepared.expiresAt,
    });
    if (!readiness.ready) {
      setActionFailure({ code: readiness.code, message: readiness.reason });
      return;
    }
    const my = ++actionTicket.current;
    setActionFailure(null);
    setPhase("SIGNING");
    const signedContext = preparedContext;
    attemptContext.current = { requestId: prepared.order.requestId, context: signedContext };
    /* AG-1: the bytes' own signable window, never longer than the Review's. */
    const bytesSignableMs = signableMsOfOrder(prepared);
    const signingDeadlineMs = Math.max(0, Math.min(Date.parse(prepared.expiresAt), preparedAt.current + bytesSignableMs) - Date.now()) + 5_000;
    let walletTimedOut = false;
    const signed = await Promise.race([
      signTransaction({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: prepared.order.transactionBase64, chain: "solana:mainnet" }),
      new Promise<Awaited<ReturnType<typeof signTransaction>>>((resolve) =>
        window.setTimeout(
          () => { walletTimedOut = true; resolve({ ok: false, reason: text("Your wallet did not answer before this Review's window closed. Nothing was signed or sent; ask for a fresh order.") }); },
          signingDeadlineMs,
        ),
      ),
    ]);
    if (actionTicket.current !== my) {
      setPhase((current) => current === "SIGNING" ? "IDLE" : current);
      return;
    }
    if (!signed.ok) {
      /* The wallet outlived the bytes: a fresh Review, not a refusal. */
      if (walletTimedOut) {
        await refreshReviewedBytes(prepared, "review");
        return;
      }
      setActionFailure({ code: "WALLET_REFUSED", message: signed.reason });
      setPhase("REVIEW");
      return;
    }
    const returned = await inspectJupiterSwapTransaction({ wireBase64: signed.signedWireBase64, expectedTaker: connection.address });
    if (actionTicket.current !== my) {
      setPhase((current) => current === "SIGNING" ? "IDLE" : current);
      return;
    }
    const adoption = assessSwapWalletAdoption({ reviewedWireBase64: prepared.order.transactionBase64, signedWireBase64: signed.signedWireBase64 });
    if (!adoption.ok) {
      setActionFailure({ code: adoption.code, message: adoption.reason });
      setBytesChanged(true);
      setPhase("REVIEW");
      return;
    }
    if (!returned.ok) {
      setActionFailure({ code: `SIGNED_${returned.code}`, message: returned.reason });
      setBytesChanged(true);
      setPhase("REVIEW");
      return;
    }
    const signature = readSwapClientSignature({ signedWireBase64: signed.signedWireBase64, expectedTaker: connection.address });
    if (!signature) {
      setActionFailure({ code: "SIGNATURE_UNREADABLE", message: text("The wallet signature could not be recorded. Nothing was submitted.") });
      setPhase("REVIEW");
      return;
    }
    /* AG-1: the bytes aged out while the wallet was open — never sent; the person reads a fresh Review instead. */
    if (signableWindowClosed({ receivedAtMs: preparedAt.current, signableMs: bytesSignableMs })) {
      await refreshReviewedBytes(prepared, "review");
      return;
    }
    const stillFresh = assessSwapClientReview({
      verdict: prepared.policy.verdict,
      proofStatus: prepared.proof.status,
      simulationStatus: prepared.simulation.status,
      ownerEffectsStatus: prepared.simulation.ownerEffects?.status ?? "MISSING",
      expiresAt: prepared.expiresAt,
    });
    if (!stillFresh.ready) {
      setActionFailure({
        code: "REVIEW_CLOSED_UNDER_WALLET",
        message: text("The Review window closed while your wallet was open. That signature was never sent and cannot be — ask for a fresh order and sign that one."),
      });
      setBytesChanged(false);
      setPhase("REVIEW");
      return;
    }
    const pending: SwapClientAttempt = {
      schema: "ryntra.solana.swap-client-attempt",
      schemaVersion: "1.0.0",
      requestId: prepared.order.requestId,
      signature,
      taker: connection.address,
      state: "SIGNED_NOT_SENT",
      recordedAt: new Date().toISOString(),
    };
    rememberAttempt(pending);
    try {
      onSigned?.({ signature, requestId: prepared.order.requestId, inputMint: prepared.order.inputMint, inAmountRaw: prepared.order.inAmountRaw });
    } catch {
      /* A listener never stops a signed order from being sent. */
    }
    setPhase("EXECUTING");
    const executed = await post<SpotSettlement>("/api/solana/swap/execute", {
      bundle: prepared.bundle,
      proof: prepared.proof,
      signedTransactionBase64: signed.signedWireBase64,
      reviewedTransactionBase64: prepared.order.transactionBase64,
    });
    if (!executed.ok) {
      if (executed.failure.submitBoundary === "NOT_CROSSED") {
        forgetAttempt();
        setReviewInvalidated(true);
        onRefresh?.();
        setActionFailure(executed.failure);
        setPhase("REVIEW");
        return;
      }
      /* Landed and failed is an outcome, not an unknown: only the fee moved
         and the server has released the wallet (the swap card reads it the
         same way). */
      if (executed.failure.code === "LANDED_FAILED") {
        forgetAttempt();
        setPrepared(null);
        recordSettlement({ state: "FAILED", signature, observation: null, facts: null, receipt: null }, connection.address, signedContext);
        onRefresh?.();
        setPhase("SETTLED");
        onSettled?.();
        return;
      }
      const unknown = transitionSwapClientAttempt(pending, { kind: "FAILURE" });
      rememberAttempt(unknown);
      /* SOL-R2: a signed order whose execute answer is lost is unknown, not refused — the failure's own sentence
         («Nothing was sent — try again») would say the opposite of the truth beside «Sent · Checking». The recovery
         line below is the one thing said, as on the Swap card. */
      setActionFailure(null);
      recordSettlement(
        { state: "SUBMITTED_UNKNOWN", signature, observation: null, facts: null, receipt: null, recovery: text("The execute answer is unknown. Recover only by this signature; never request or sign another order.") },
        connection.address,
        signedContext,
      );
      setPhase("RECOVERY");
      return;
    }
    const recorded = transitionSwapClientAttempt(pending, { kind: "SUCCESS", serverState: executed.value.state });
    if (recorded.state === "SETTLED") forgetAttempt();
    else rememberAttempt(recorded);
    setPrepared(null);
    recordSettlement(executed.value, connection.address, signedContext);
    setPhase(recorded.state === "SUBMITTED_UNKNOWN" ? "RECOVERY" : "SETTLED");
    if (recorded.state === "SETTLED") onSettled?.();
  }, [attempt, bytesChanged, connection, forgetAttempt, onRefresh, onSettled, onSigned, preparedContext, recordSettlement, refreshReviewedBytes, rememberAttempt, reviewInvalidated, text]);

  /** Sign pressed: bytes about to die are fetched fresh first (AG-1); the rest go to the wallet as they are. */
  const sign = useCallback(async () => {
    if (!connection || !prepared || attempt) return;
    if (!(reviewInvalidated || bytesChanged) && !mayOpenWallet({ receivedAtMs: preparedAt.current, signableMs: signableMsOfOrder(prepared) })) {
      const fresh = await refreshReviewedBytes(prepared, "sign");
      if (fresh) await signOrder(fresh, true);
      return;
    }
    await signOrder(prepared, false);
  }, [attempt, bytesChanged, connection, prepared, refreshReviewedBytes, reviewInvalidated, signOrder]);

  const recover = useCallback(async () => {
    if (!attempt || attempt.state === "SETTLED") return;
    const recoveryContext = attemptContext.current?.requestId === attempt.requestId ? attemptContext.current.context : null;
    const my = ++actionTicket.current;
    setActionFailure(null);
    setPhase("RECOVERING");
    const deadline = Date.now() + RECOVERY_DEADLINE_MS;
    for (;;) {
      const recovered = await post<RecoveryResponse>("/api/solana/swap/recover", { signature: attempt.signature, owner: attempt.taker, requestId: attempt.requestId });
      if (actionTicket.current !== my) return;
      if (!recovered.ok) {
        setActionFailure(recovered.failure);
        setPhase("RECOVERY");
        return;
      }
      if (recovered.value.state === "UNKNOWN_TO_CHAIN") {
        /* Nothing was ever submitted under this signature and nothing can be:
           the wallet is free, and the ticket says so in the settled block's
           own words rather than as an error over an empty form. */
        forgetAttempt();
        setPrepared(null);
        recordSettlement({ state: recovered.value.state, signature: recovered.value.signature, observation: null, facts: null, receipt: null }, attempt.taker, recoveryContext);
        setPhase("SETTLED");
        return;
      }
      if (recovered.value.state === "SEEN_WITHOUT_RECORD") {
        recordSettlement({ state: recovered.value.state, signature: recovered.value.signature, observation: null, facts: null, receipt: null, recovery: text("The network has seen this transaction, but its receipt is unavailable. Check the explorer.") }, attempt.taker, recoveryContext);
        setPhase("RECOVERY");
        return;
      }
      if (recovered.value.state === "PENDING") {
        recordSettlement(
          { state: "RECOVERY_PENDING", signature: attempt.signature, observation: null, facts: null, receipt: null, recovery: text("The outcome is not yet known. Keep checking this transaction; do not send another.") },
          attempt.taker,
          recoveryContext,
        );
        if (Date.now() >= deadline) {
          setPhase("RECOVERY");
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, RECOVERY_INTERVAL_MS));
        if (actionTicket.current !== my) return;
        continue;
      }
      const resolvedAttempt = transitionSwapClientAttempt(attempt, { kind: "SUCCESS", serverState: recovered.value.state });
      if (resolvedAttempt.state === "SETTLED") forgetAttempt();
      else rememberAttempt(resolvedAttempt);
      setPrepared(null);
      recordSettlement(
        {
          state: recovered.value.state,
          signature: recovered.value.signature,
          observation: recovered.value.observation ?? null,
          facts: recovered.value.facts ?? null,
          receipt: recovered.value.receipt ?? null,
          recovery: recovered.value.reason,
        },
        attempt.taker,
        recoveryContext,
      );
      setPhase("SETTLED");
      if (resolvedAttempt.state === "SETTLED") onSettled?.();
      return;
    }
  }, [attempt, forgetAttempt, onSettled, recordSettlement, rememberAttempt, text]);

  const cancelReview = useCallback(async (prepareAgain = false) => {
    const owner = lockedReview?.owner ?? connection?.address ?? null;
    const requestId = lockedReview?.requestId ?? prepared?.order.requestId ?? null;
    if (!owner || !requestId || attempt) return;
    const my = ++actionTicket.current;
    setActionFailure(null);
    setPhase("PREPARING");
    const cancelled = await post<{ state: "EXPIRED_BEFORE_SUBMIT" }>("/api/solana/swap/cancel-review", { owner, requestId });
    if (actionTicket.current !== my) return;
    if (!cancelled.ok) {
      if (cancelled.failure.code === "BLOCKHASH_STILL_VALID") {
        setActionFailure({
          code: cancelled.failure.code,
          message: swapFailureCopy(cancelled.failure.code, text).message,
        });
      } else setActionFailure(cancelled.failure);
      setPhase("REVIEW");
      return;
    }
    setBytesChanged(false);
    setReviewInvalidated(false);
    setPrepared(null);
    setLockedReview(null);
    setPhase("IDLE");
    if (prepareAgain) await review();
  }, [attempt, connection?.address, lockedReview, prepared, review, text]);

  /** After a settled fill: back to an empty ticket for the next one. */
  const reset = useCallback(() => {
    if (attempt) return;
    setSettled(null);
    setSettledOwner(null);
    setSettledContext(null);
    setActionFailure(null);
    setPhase("IDLE");
  }, [attempt]);

  const preparedReadiness = prepared ? assessSwapClientReview({
    invalidated: reviewInvalidated || bytesChanged,
    verdict: prepared.policy.verdict, proofStatus: prepared.proof.status,
    simulationStatus: prepared.simulation.status,
    ownerEffectsStatus: prepared.simulation.ownerEffects?.status ?? "MISSING",
    expiresAt: prepared.expiresAt,
  }) : null;

  /* Most failures are named by their code, through the same copy Swap uses.
     The few this hook writes itself — a wallet that refused, a Review that
     closed under an open wallet, a cancel the blockhash forbids — carry a
     sentence that says more than the code's family would. */
  const failureMessage = (failure: SpotFailure | null): string | null => {
    if (!failure) return null;
    if (LOCAL_FAILURE_CODES.has(failure.code) && failure.message) return failure.message;
    return swapFailureCopy(failure.code, text).message;
  };

  return {
    inputMint,
    outputMint,
    inputDecimals,
    outputDecimals,
    quoted,
    quoting,
    quoteFailure,
    quoteFailureMessage: failureMessage(quoteFailure),
    phase,
    actionFailure,
    actionFailureMessage: failureMessage(actionFailure),
    prepared,
    preparedReadiness,
    attempt,
    lockedReview,
    bytesChanged,
    settled,
    settledContext,
    secondsLeft,
    reviewSecondsLeft,
    review,
    sign,
    recover,
    cancelReview,
    reset,
    refreshQuote: () => setRefreshTicket((ticket) => ticket + 1),
  };
}
