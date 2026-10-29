"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_SIGNABLE_WINDOW_MS, mayOpenWallet, signableWindowClosed } from "@/lib/solana/blockhash-life";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { crossSwapReceiptSummary, receiptBinding } from "@/lib/solana/receipt-view";
import { downloadReceipt, storeBoundSolanaReceipt } from "@/lib/solana/send-receipt-vault.client";
import { signTransaction } from "@/lib/solana/wallet.client";
import { catalogAssets, displayRawAmount, EVM_EXPLORER_TX, parseHumanAmount, type SwapNetwork } from "@/lib/swap/catalog";
import type { SwapRouteClassification } from "@/lib/swap/classify";
import type { CrossSwapQuote } from "@/lib/swap/cross-swap-quote";
import { reconcileNativeCost } from "@/lib/swap/gas-reserve";
import { serviceFeeText } from "@/lib/swap/service-fee";
import { bridgeContextKey, bridgeQuoteMatches, bridgeReviewCurrent, bridgeSubmitNeedsRecovery } from "@/lib/swap/bridge-client-state";
import { Button } from "@ryntra/core/ui";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { MoneyAction } from "../money/money-page.tsx";
import { ConnectWalletButton } from "../wallet-gate.tsx";
import styles from "./bridge-surface.module.css";

/**
 * The cross-chain swap engine of the unified Swap surface — Mayan or Relay,
 * whichever the approved tuple names, for the four approved pairs of Unified
 * Swap V1.
 *
 * Quote → Review → one wallet signature → status, read back until the money
 * has landed or come back. The surface above owns FROM, TO and the amount; this
 * engine owns the destination address, the Review, the boundary and the trail.
 * It never chooses another provider, never retries a submit, and never shows a
 * provider's raw words at rest: what a person sees is amounts, a fee, a time and
 * where the money is.
 */

type CrossRoute = Extract<SwapRouteClassification, { kind: "CROSS_SWAP" }>;

/*
 * One wallet — Solana (SOL-W1, decision 58): on a Solana page every operation
 * here starts on Solana and is signed by the Solana wallet; the address it pays
 * on another network is text the person types. Money coming *in* from another
 * network is an address to send to («З іншої мережі»), not a second wallet, so
 * the EVM-origin signing this engine once had is gone from the Solana build —
 * a plan that is not a Solana one is refused rather than signed.
 */

/* `buildable` is what this surface gates on. `lane` is carried for the words
   shown at rest; reading it as a two-state switch is how CANARY — a lane that
   is open for exactly one operation — got rendered as a closed one. */
type QuoteResponse = Readonly<{ quote: CrossSwapQuote; lane: "OPEN" | "CANARY" | "PAUSED"; buildable: boolean; observedAt: string }>;

type PlanResponse = Readonly<{
  intentDigest: string;
  quote: CrossSwapQuote;
  plan:
    | Readonly<{ origin: "solana"; unsignedWireBase64: string; lastValidBlockHeight: number; programIds: readonly string[]; walletPrompts: number; simulation: { succeeded: boolean } }>
    | Readonly<{
        origin: "evm";
        /* Never Arc: it is an arrival network here (`ARRIVAL_ONLY_NETWORKS`). */
        chain: Exclude<SwapNetwork, "solana" | "arc">;
        chainId: number;
        calls: readonly Readonly<{ purpose: "APPROVE" | "SWAP"; to: string; data: string; value: string; maximumCostWei: string | null }>[];
        walletPrompts: number;
        totalMaximumCostWei: string | null;
      }>;
  builtAt: string;
  reviewExpiresAt: string;
  /** AG-1: how long from arriving the Solana bytes may still be signed. */
  signableMs?: number;
}>;

type OrderView = Readonly<{
  intentDigest: string;
  state: string;
  from: { network: SwapNetwork; symbol: string; decimals: number; amountRaw: string };
  to: { network: SwapNetwork; symbol: string; decimals: number; expectedRaw: string; minimumRaw: string };
  sourceTxHash: string | null;
  destinationTxHash: string | null;
  refundTxHash: string | null;
  receivedAmount: string | null;
  refund: { tokenSymbol: string | null; amount: string | null } | null;
  recovery: { mayPlanAgain: boolean; inMotion: boolean; terminal: boolean; needsReading: boolean };
  shouldPollAgain: boolean;
}>;

type StatusResponse = Readonly<{ order: OrderView }>;

type Failure = Readonly<{ code: string; message: string; extra?: Record<string, unknown> }>;

type Phase = "IDLE" | "PLANNING" | "REVIEW" | "APPROVING" | "SIGNING" | "SUBMITTING" | "TRACKING" | "DONE" | "REFUNDED" | "FAILED" | "RECOVERY";

const RUN_KEY = "ryntra.solana.cross-swap-run.v1";
/*
 * The quote budget, and why these numbers.
 *
 * Relay meters `/quote` at **50 requests per minute for the whole API key** —
 * read off the Dashboard for the production key on 2026-09-10, not assumed. That
 * is one shared ceiling across every person using Ryntra at once, so a cost this
 * surface pays casually is a cost it charges to everybody else's Bridge.
 *
 * Four rules follow, and each is implemented rather than intended:
 *
 * 1. **A keystroke is not a question.** The debounce is long enough that typing
 *    an amount asks once, when the person stops.
 * 2. **The same question is asked once.** Every request carries a signature of
 *    what it is asking; an identical one against a fresh answer is skipped
 *    entirely rather than sent and discarded, and one user action can never
 *    produce two in flight.
 * 3. **Refresh is driven by expiry, not by a clock.** Relay's quote is good for
 *    60 seconds, so it is renewed at 45 — and only while the tab is both visible
 *    and focused, because a quote nobody is looking at is a quote nobody needs.
 * 4. **A refusal is not retried into the ground.** A 429 backs off in bounded
 *    steps and says so plainly, and it never touches anything but this surface.
 */
const QUOTE_DEBOUNCE_MS = 700;
/** Relay quotes are valid 60 s; renewing at 45 keeps Review off a stale one. */
const QUOTE_REFRESH_AT_SECONDS = 45;
/**
 * Past this the figures on screen are history, not an offer.
 *
 * Relay states 60 seconds and this is that number, not a margin of our own. At
 * it the amounts **stay** — blanking them turns a short wait into an apparent
 * outage, and a person mid-decision loses the context they were reading — but
 * they are dimmed, marked, and the button stops offering to act on them. Review
 * is never built from a quote this old; the plan route re-quotes server-side and
 * would refuse it anyway, and being refused after pressing is a worse
 * experience than not being offered the press.
 */
const QUOTE_EXPIRES_AT_SECONDS = 60;
/** Bounded, and it ends: three steps and then the person asks, not the code. */
const QUOTE_BACKOFF_MS = [5_000, 15_000, 45_000] as const;
const STATUS_POLL_MS = 4_000;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

async function post<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; failure: Failure; status: number }>> {
  try {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    const json = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } & Record<string, unknown> } | null;
    if (!response.ok) {
      const error = json?.error ?? {};
      const { code, message, ...extra } = error;
      return { ok: false, status: response.status, failure: { code: code ?? "HTTP_ERROR", message: message ?? `HTTP ${response.status}`, extra } };
    }
    return { ok: true, value: json as T };
  } catch (cause) {
    /* A cancelled request is not a failure to report: it was superseded on
       purpose, and the caller that superseded it owns what happens next. */
    if (cause instanceof DOMException && cause.name === "AbortError") return { ok: false, status: -1, failure: { code: "ABORTED", message: "superseded" } };
    return { ok: false, status: 0, failure: { code: "NETWORK", message: cause instanceof Error ? cause.message : String(cause) } };
  }
}

function readRun(): Readonly<{ intentDigest: string; tupleId: string }> | null {
  try {
    const raw = window.localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { intentDigest?: string; tupleId?: string; savedAt?: string };
    if (!parsed.intentDigest || !/^0x[0-9a-f]{64}$/.test(parsed.intentDigest) || !parsed.tupleId) return null;
    // An unresolved operation does not stop existing after seven days.
    return { intentDigest: parsed.intentDigest, tupleId: parsed.tupleId };
  } catch {
    return null;
  }
}

function saveRun(intentDigest: string, tupleId: string) {
  try {
    window.localStorage.setItem(RUN_KEY, JSON.stringify({ intentDigest, tupleId, savedAt: new Date().toISOString() }));
    window.dispatchEvent(new Event("ryntra:bridge-run"));
  } catch {
    /* A browser that refuses storage still gets the swap; it loses only the reload path. */
  }
}

function clearRun() {
  try {
    window.localStorage.removeItem(RUN_KEY);
    window.dispatchEvent(new Event("ryntra:bridge-run"));
  } catch {
    /* nothing to clear */
  }
}

function evmExplorer(network: Exclude<SwapNetwork, "solana">, hash: string): string {
  return `${EVM_EXPLORER_TX[network]}${hash}`;
}

function txLink(network: SwapNetwork, hash: string): string {
  return network === "solana" ? explorerTxUrl("mainnet", hash) : evmExplorer(network, hash);
}


function short(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 6)}…${hash.slice(-6)}` : hash;
}

export function CrossSwapEngine({
  route,
  amount,
  pro,
  solana,
  onQuote,
  offerableRaw,
  gasBalanceRaw,
  onAmountCorrected,
  onLocked,
  onSettled,
  onReset,
}: {
  route: CrossRoute;
  amount: string;
  pro: boolean;
  solana: Readonly<{ wallet: string; address: string }> | null;
  /** The surface shows the expected amount in its own TO leg; this is the engine's number, nothing new. */
  /* `expired` travels with the figures rather than replacing them: the surface
     above keeps showing the amount for context and stops presenting it as an
     offer. */
  onQuote?: (facts: Readonly<{ expectedRaw: string; decimals: number; rentRaw: string | null; expired: boolean }> | null) => void;
  /** The largest amount this pair can actually sign, reserves already withheld; null while no balance is known. */
  offerableRaw?: string | null;
  /** The coin an EVM origin pays gas with. Zero here is a dead end, and saying so early is cheaper than a failed approval. */
  gasBalanceRaw?: string | null;
  /**
   * How the surface is told the amount had to come down.
   *
   * The engine cannot lower it itself — the surface owns the field — and it must
   * not be the person's job either: the largest allowed amount is recalculated
   * once, and the person is told so plainly. Raw units, because the surface
   * knows the decimals and this side knows the arithmetic.
   */
  onAmountCorrected?: (amountRaw: string) => void;
  onLocked?: (locked: boolean) => void;
  onSettled?: () => void;
  onReset?: () => void;
}) {
  const { text, locale } = useSolanaI18n();
  const fromDecimals = route.from.decimals ?? 0;
  const toDecimals = route.to.decimals ?? 0;
  /* Zero is not an amount. Without this the quote route is asked for a swap of
     nothing, refuses the schema, and the surface shows a provider failure for
     what is really an empty field — MAX on a balance under the reserve lands
     here exactly. */
  const typedRaw = amount.trim() === "" || route.from.decimals === null || route.to.decimals === null ? null : parseHumanAmount(amount, fromDecimals);
  const amountRaw = typedRaw === null || BigInt(typedRaw) === 0n ? null : typedRaw;
  const fromSolana = route.from.network === "solana";
  const sourceAddress = fromSolana ? (solana?.address ?? null) : null;
  const defaultDestination = route.to.network === "solana" ? (solana?.address ?? "") : "";

  const [quoteSnapshot, setQuoteSnapshot] = useState<{ key: string; value: QuoteResponse } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteFailure, setQuoteFailure] = useState<Failure | null>(null);
  const [destination, setDestination] = useState("");
  const [destinationTouched, setDestinationTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>("IDLE");
  const [planSnapshot, setPlanSnapshot] = useState<{ key: string; value: PlanResponse } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [order, setOrder] = useState<OrderView | null>(null);
  const [reviewSecondsLeft, setReviewSecondsLeft] = useState<number | null>(null);
  const [quoteAgeSeconds, setQuoteAgeSeconds] = useState<number>(0);
  const [impactAcknowledged, setImpactAcknowledged] = useState<number | null>(null);
  /**
   * The receipt for this operation, once it has one.
   *
   * Asked for exactly once per finished order — `receiptAsked` holds the digest
   * already requested — because minting is idempotent on the server but a poll
   * every few seconds would still be a request every few seconds for a document
   * that cannot change.
   */
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const receiptAsked = useRef<string | null>(null);
  const quoteTicket = useRef(0);
  /** The signature of the question already asked, so it is not asked twice. */
  const lastAsked = useRef<string | null>(null);
  /** The request still in the air, so a superseded one stops costing budget. */
  const inFlight = useRef<AbortController | null>(null);
  /** Set by a 429 and honoured by everything except the pre-sign read. */
  const backoffUntil = useRef(0);
  const backoffStep = useRef(0);
  const submitting = useRef(false);
  const planning = useRef(false);
  const alive = useRef(true);
  /* When the Review on screen arrived: its Solana bytes' signable window counts from here (AG-1). */
  const planAt = useRef(0);
  const statusReading = useRef(false);
  const settledDigest = useRef<string | null>(null);

  /* An amount the wallet cannot cover is named here, before Review, rather than
     by a wallet refusal or a failed order. `offerableRaw` already has the fee
     reserve and the provider's order rent withheld by the surface. */
  const overBalance = amountRaw !== null && offerableRaw != null && BigInt(amountRaw) > BigInt(offerableRaw);
  const noGas = !fromSolana && gasBalanceRaw != null && BigInt(gasBalanceRaw) === 0n;
  const destinationValue = destinationTouched ? destination : defaultDestination;
  const destinationValid = route.to.network === "solana" ? SOLANA_ADDRESS.test(destinationValue) : EVM_ADDRESS.test(destinationValue);
  const context = { from: route.from, to: route.to, amountRaw, source: sourceAddress, destination: destinationValue };
  const contextKey = bridgeContextKey(context);
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  const quote = quoteSnapshot?.key === contextKey && bridgeQuoteMatches(quoteSnapshot.value.quote, context) ? quoteSnapshot.value : null;
  const plan = planSnapshot?.key === contextKey ? planSnapshot.value : null;
  const setQuote = useCallback((value: QuoteResponse | null) => setQuoteSnapshot(value ? { key: contextKey, value } : null), [contextKey]);
  const setPlan = useCallback((value: PlanResponse | null) => setPlanSnapshot(value ? { key: contextKey, value } : null), [contextKey]);
  const busy = phase === "PLANNING" || phase === "SIGNING" || phase === "SUBMITTING" || phase === "APPROVING";
  const tracking = phase === "TRACKING";
  /** What the issued receipt says the fee was — never what the quote asked for. */
  const settledFee = receipt ? (crossSwapReceiptSummary(receipt)?.fee ?? null) : null;
  useEffect(() => { onLocked?.(busy || tracking || phase === "RECOVERY"); }, [busy, tracking, phase, onLocked]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; inFlight.current?.abort(); };
  }, []);

  /* ── Quote: read-only, wallet-free, and rationed. See the budget note above. ── */

  /**
   * What this request is asking, as one string.
   *
   * Two requests with the same signature would get the same answer, so the
   * second one is not sent. This is what makes "one user action, one `/quote`"
   * true rather than aspirational: an effect that re-runs because an unrelated
   * dependency changed identity produces the same signature and stops here.
   */
  const quoteSignature = amountRaw
    ? [route.from.network, route.from.asset, route.to.network, route.to.asset, amountRaw, destinationValid ? destinationValue : "", sourceAddress ?? ""].join("|")
    : null;

  const fetchQuote = useCallback(async (force = false) => {
    if (!force && quoteSignature === lastAsked.current && inFlight.current !== null && !inFlight.current.signal.aborted) return;
    inFlight.current?.abort();
    const my = ++quoteTicket.current;
    if (!amountRaw) {
      setQuoteSnapshot(null);
      setQuoting(false);
      setQuoteFailure(null);
      lastAsked.current = null;
      return;
    }
    /* Backing off after a refusal. `force` is the pre-sign read, which is about
       what somebody is about to sign and is never skipped. */
    if (!force && (backoffStep.current >= QUOTE_BACKOFF_MS.length || backoffUntil.current > Date.now())) { setQuoting(false); return; }

    lastAsked.current = quoteSignature;
    /* Whatever was in the air is now answering a question nobody is asking. */
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setQuoting(true);
    const result = await post<QuoteResponse>("/api/solana/cross-swap/quote", {
      from: { network: route.from.network, asset: route.from.asset },
      to: { network: route.to.network, asset: route.to.asset },
      amountRaw,
      /* Both wallets, whenever they are known. The old condition sent the
         destination only for a Solana one, because Mayan used it as an
         optional check that the token account existed. Relay does not treat
         either address as optional: it prices the transaction it would build,
         and refuses to quote without them. Sending nothing is why every
         Robinhood Chain pair answered 400 and the card showed no figures. */
      ...(destinationValid ? { destinationAddress: destinationValue } : {}),
      ...(sourceAddress ? { sourceAddress } : {}),
    }, controller.signal);
    if (inFlight.current === controller) inFlight.current = null;
    if (!alive.current || controller.signal.aborted || quoteTicket.current !== my || currentContext.current !== contextKey) return;
    /* An aborted call left no answer and asked no question: the state it was
       superseded by is the current one and must not be disturbed. */
    if (!result.ok && result.status === -1) return;
    setQuoting(false);
    if (!result.ok) {
      if (result.status === 429) {
        /* Relay is refusing on volume. Step the wait, keep the quote already on
           screen — it is the last true answer and hiding it helps nobody — and
           stop after the third step rather than retrying forever. */
        const step = Math.min(backoffStep.current, QUOTE_BACKOFF_MS.length - 1);
        backoffUntil.current = Date.now() + QUOTE_BACKOFF_MS[step];
        backoffStep.current = Math.min(backoffStep.current + 1, QUOTE_BACKOFF_MS.length);
        setQuoteFailure({ code: "QUOTE_RATE_LIMITED", message: result.failure.message });
        return;
      }
      backoffStep.current = 0;
      setQuoteSnapshot(null);
      setQuoteFailure(result.failure);
      return;
    }
    backoffStep.current = 0;
    backoffUntil.current = 0;
    if (!result.value?.quote || !bridgeQuoteMatches(result.value.quote, { from: { network: route.from.network, asset: route.from.asset }, to: { network: route.to.network, asset: route.to.asset }, amountRaw, source: sourceAddress, destination: destinationValue })) {
      setQuoteSnapshot(null); setQuoteFailure({ code: "QUOTE_UNREADABLE", message: "" }); return;
    }
    setQuoteFailure(null);
    setQuoteSnapshot({ key: contextKey, value: result.value });
    setQuoteAgeSeconds(0);
  }, [amountRaw, contextKey, quoteSignature, route.from.network, route.from.asset, route.to.network, route.to.asset, destinationValid, destinationValue, sourceAddress]);

  /* A meaningful change — pair, amount or either address — asks once, after the
     person stops changing it. */
  useEffect(() => {
    if (phase !== "IDLE") return;
    const timer = window.setTimeout(() => void fetchQuote(), QUOTE_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); inFlight.current?.abort(); inFlight.current = null; };
  }, [fetchQuote, phase]);

  /* Renewal is driven by the quote's own expiry rather than by a clock of our
     own, and only for a tab somebody is actually looking at. A background tab,
     a covered window and an untouched second monitor all cost nothing. */
  useEffect(() => {
    if (phase !== "IDLE" || !quote) return;
    if (quoteAgeSeconds < QUOTE_REFRESH_AT_SECONDS) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (typeof document !== "undefined" && !document.hasFocus()) return;
    void fetchQuote();
  }, [fetchQuote, phase, quote, quoteAgeSeconds]);

  /* Nothing is left in the air when this surface goes away. */
  useEffect(() => () => inFlight.current?.abort(), []);

  useEffect(() => {
    if (!quote) return;
    const tick = () => setQuoteAgeSeconds(Math.max(0, Math.floor((Date.now() - Date.parse(quote.quote.observedAt)) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [quote]);

  /* One derived truth, read by the button, the figures and the surface above, so
     none of the three can disagree about whether what is shown is still live. */
  const quoteExpired = quote !== null && quoteAgeSeconds >= QUOTE_EXPIRES_AT_SECONDS;
  const impactBps = quote?.quote.priceImpactBps ?? null;
  const severeImpact = impactBps !== null && impactBps <= -1000;
  useEffect(() => { setImpactAcknowledged(null); }, [contextKey, impactBps]);

  const expectedRaw = quote?.quote.to.expectedRaw ?? null;
  const rentRaw = quote?.quote.fees.rentLamports ?? null;
  useEffect(() => {
    if (!onQuote) return;
    onQuote(expectedRaw && toDecimals !== null ? { expectedRaw, decimals: toDecimals, rentRaw, expired: quoteExpired } : null);
  }, [onQuote, expectedRaw, toDecimals, rentRaw, quoteExpired]);

  /* A material change to the pair or the amount spends any open Review. */
  useEffect(() => {
    setPlanSnapshot(null);
    setFailure(null);
    setQuoteFailure(null);
    setPhase((current) => (current === "REVIEW" || current === "PLANNING" ? "IDLE" : current));
  }, [contextKey]);

  /* ── Review countdown ────────────────────────────────────────────────── */
  useEffect(() => {
    if (phase !== "REVIEW" || !plan) {
      setReviewSecondsLeft(null);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((Date.parse(plan.reviewExpiresAt) - Date.now()) / 1000));
      setReviewSecondsLeft(left);
      if (left === 0) {
        setPlanSnapshot(null);
        setPhase("IDLE");
        setFailure({ code: "REVIEW_EXPIRED", message: "" });
      }
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [phase, plan]);

  /**
   * The receipt for a finished operation, asked for once and kept.
   *
   * The server mints it from the order and the provider's report of the fill,
   * so this is a request for a document rather than a submission of one: there
   * is nothing here a person signs, and a failure costs the copy in this
   * browser and nothing else. The operation is already finished and its row is
   * already in Activity, where the same receipt can be opened later.
   *
   * It is stored against the wallet the *receipt itself* names, checked against
   * the connected one, so a receipt can never be filed under whichever wallet
   * happened to be connected when this rendered.
   */
  const askForReceipt = useCallback(async (intentDigest: string) => {
    if (receiptAsked.current === intentDigest) return;
    receiptAsked.current = intentDigest;
    const result = await post<{ data: { receipt: Record<string, unknown> } }>("/api/solana/cross-swap/receipt", { intentDigest });
    if (!alive.current || receiptAsked.current !== intentDigest) return;
    if (!result.ok) {
      /* Nothing is said to the person here. A receipt that could not be issued
         this second is not a failed swap, and the money has already arrived. */
      receiptAsked.current = null;
      return;
    }
    const issued = result.value?.data?.receipt;
    if (!issued) { receiptAsked.current = null; return; }
    setReceipt(issued);
    const bound = receiptBinding(issued);
    if (typeof window !== "undefined") {
      storeBoundSolanaReceipt(window.localStorage, bound?.wallet ?? null, solana?.address ?? null, issued);
    }
  }, [solana?.address]);

  /* ── Reload: an order in the browser is asked about, never rebuilt. ────── */
  const pollStatus = useCallback(async (intentDigest: string) => {
    if (statusReading.current) return;
    statusReading.current = true;
    const result = await post<StatusResponse>("/api/solana/cross-swap/status", { intentDigest });
    statusReading.current = false;
    if (!alive.current || readRun()?.intentDigest !== intentDigest) return;
    if (!result.ok) {
      setPhase("RECOVERY");
      setFailure({ code: "STATUS_UNAVAILABLE", message: "" });
      return;
    }
    const next = result.value?.order;
    if (!next || next.intentDigest !== intentDigest) { setPhase("RECOVERY"); setFailure({ code: "STATUS_UNAVAILABLE", message: "" }); return; }
    setFailure(null);
    setOrder(next);
    if (["COMPLETED", "REFUNDED", "SOURCE_FAILED", "EXPIRED_BEFORE_SUBMIT"].includes(next.state) && settledDigest.current !== intentDigest) {
      settledDigest.current = intentDigest;
      onSettled?.();
    }
    if (next.state === "COMPLETED") {
      setPhase("DONE");
      clearRun();
      void askForReceipt(next.intentDigest);
    } else if (next.state === "REFUNDED") {
      setPhase("REFUNDED");
      clearRun();
      void askForReceipt(next.intentDigest);
    } else if (next.state === "SOURCE_FAILED" || next.state === "EXPIRED_BEFORE_SUBMIT") {
      setPhase("FAILED");
      clearRun();
      /* A receipt is issued for an operation that did not happen too. "Nothing
         left your wallet" is a statement worth being able to keep and check. */
      void askForReceipt(next.intentDigest);
    } else if (next.state === "RECOVERY_REQUIRED") {
      setPhase("RECOVERY");
    } else if (next.state === "RESERVED") {
      // A submit request may still be reaching the server. Expiry is closed
      // atomically by the status endpoint, not inferred from this snapshot.
      setPhase("TRACKING");
    } else {
      setPhase("TRACKING");
    }
  }, [askForReceipt, onSettled]);

  useEffect(() => {
    const run = readRun();
    if (!run) return;
    setPhase("TRACKING");
    void pollStatus(run.intentDigest);
  }, [pollStatus]);

  useEffect(() => {
    if (!tracking && phase !== "RECOVERY") return;
    const digest = order?.intentDigest ?? readRun()?.intentDigest;
    if (!digest) return;
    const timer = window.setInterval(() => void pollStatus(digest), STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [tracking, phase, order?.intentDigest, pollStatus]);

  /* ── Review: exact bytes for the wallet, built on the quote just shown. ── */
  const review = async (note: "BYTES_REFRESHED" | null = null) => {
    if (!quote || !amountRaw || !sourceAddress || !destinationValid || busy || planning.current || readRun()
      || quote.quote.deadlineUnix * 1000 <= Date.now() || overBalance || noGas || !quote.buildable
      || (severeImpact && impactAcknowledged !== impactBps)) return;
    const requestedKey = contextKey;
    planning.current = true;
    setFailure(null);
    setPhase("PLANNING");
    const result = await post<PlanResponse>("/api/solana/cross-swap/plan", {
      from: { network: route.from.network, asset: route.from.asset },
      to: { network: route.to.network, asset: route.to.asset },
      amountRaw,
      owner: sourceAddress,
      destination: destinationValue,
      reviewed: { route: quote.quote.route, amountRaw: quote.quote.from.amountRaw, minimumRaw: quote.quote.to.minimumRaw },
      ...(impactAcknowledged !== null && impactAcknowledged === impactBps ? { acknowledgeImpactBps: impactAcknowledged } : {}),
    });
    planning.current = false;
    if (!alive.current || currentContext.current !== requestedKey) return;
    if (!result.ok) {
      setPhase("IDLE");
      setFailure(result.failure);
      const fresh = result.failure.extra?.quote as CrossSwapQuote | undefined;
      if ((result.failure.code === "QUOTE_CHANGED" || result.failure.code === "IMPACT_NOT_ACKNOWLEDGED") && fresh) { setQuote({ ...quote, quote: fresh }); setImpactAcknowledged(null); }
      return;
    }
    /*
     * The built transaction's own cost, against what the wallet actually holds.
     *
     * This is the second half of the gas-reserve model and the half that ends the
     * guessing game. The pre-flight reserve MAX used is a conservative guess made
     * before any transaction existed; **this** is the real maximum cost of this
     * execution, whatever fee model the chain uses — legacy price, EIP-1559 base
     * plus priority, or a rollup's execution plus its L1 data fee. Nothing here
     * reconstructs it, because a reconstruction is a second fee model that can
     * disagree with the real one.
     *
     * Three outcomes, and only one of them reaches a signature.
     */
    const plan = result.value;
    if (!plan?.plan || !bridgeQuoteMatches(plan.quote, context)) { setPhase("IDLE"); setFailure({ code: "BUILD_FAILED", message: "" }); return; }
    const nativeSpend = route.from.catalog?.kind === "NATIVE" ? BigInt(amountRaw) : 0n;
    const executionMaxCostRaw =
      plan.plan.origin === "evm" && plan.plan.totalMaximumCostWei !== null ? BigInt(plan.plan.totalMaximumCostWei) : null;
    const verdict = reconcileNativeCost({
      nativeBalanceRaw: gasBalanceRaw !== null && gasBalanceRaw !== undefined ? BigInt(gasBalanceRaw) : nativeSpend + (executionMaxCostRaw ?? 0n),
      intendedNativeSpendRaw: nativeSpend,
      executionMaxCostRaw,
    });

    if (!verdict.ok) {
      /* The wallet cannot cover the fee at all. No amount fixes it, so nothing is
         sent and the sentence names the coin rather than the transaction. */
      setPhase("IDLE");
      setFailure({
        code: "NATIVE_FEE_SHORT",
        message: "insufficient native balance for the network fee",
        extra: { requiredRaw: verdict.requiredRaw.toString(), shortfallRaw: verdict.shortfallRaw.toString() },
      });
      return;
    }

    if (verdict.state === "ADJUSTED") {
      /* Corrected once, and said out loud. The person never presses Review, gets
         refused, lowers the amount and tries again — which is the loop this
         exists to remove. */
      setPhase("IDLE");
      setFailure({
        code: "MAXIMUM_UPDATED",
        message: "the amount was lowered to cover the network fee",
        extra: { reserveRaw: verdict.reserveRaw.toString(), decimals: fromDecimals },
      });
      onAmountCorrected?.(verdict.maximumRaw.toString());
      return;
    }

    planAt.current = Date.now();
    setPlan(plan);
    setQuote({ ...quote, quote: plan.quote });
    setPhase("REVIEW");
    if (note) setFailure({ code: note, message: "" });
  };

  /* ── The boundary, crossed once. ─────────────────────────────────────── */
  const confirm = async () => {
    if (!plan || phase !== "REVIEW" || submitting.current || readRun()
      || !bridgeReviewCurrent({ key: planSnapshot!.key, expiresAt: plan.reviewExpiresAt }, contextKey, Date.now())) return;
    const signedContext = contextKey;
    const stillCurrent = () => alive.current && currentContext.current === signedContext
      && bridgeReviewCurrent({ key: signedContext, expiresAt: plan.reviewExpiresAt }, currentContext.current, Date.now());
    submitting.current = true;
    setFailure(null);
    try {
      if (plan.plan.origin === "solana") {
        if (!solana) return;
        /*
         * AG-1: the Review is readable for 45 s, its Solana bytes live ~30 s. Read for longer than they live, the plan
         * is built again here — the person reads the fresh Review instead of the network's refusal.
         */
        const signableMs = typeof plan.signableMs === "number" ? plan.signableMs : MAX_SIGNABLE_WINDOW_MS;
        if (!mayOpenWallet({ receivedAtMs: planAt.current, signableMs })) {
          setPlan(null);
          setPhase("IDLE");
          submitting.current = false;
          /* A quote past its own deadline cannot be planned again: the person is sent back to the figures instead. */
          if (!quote || quote.quote.deadlineUnix * 1000 <= Date.now()) {
            setFailure({ code: "REVIEW_EXPIRED", message: "" });
            return;
          }
          setFailure({ code: "BYTES_REFRESHED", message: "" });
          await review("BYTES_REFRESHED");
          return;
        }
        setPhase("SIGNING");
        const signed = await signTransaction({ wallet: solana.wallet, address: solana.address, unsignedWireBase64: plan.plan.unsignedWireBase64, chain: "solana:mainnet" });
        if (!signed.ok) {
          setPhase("REVIEW");
          setFailure({ code: "WALLET_DECLINED", message: signed.reason });
          return;
        }
        /* The bytes aged out while the wallet was open: never sent — planned again instead. */
        if (signableWindowClosed({ receivedAtMs: planAt.current, signableMs })) {
          setPlan(null);
          setPhase("IDLE");
          submitting.current = false;
          /* A quote past its own deadline cannot be planned again: the person is sent back to the figures instead. */
          if (!quote || quote.quote.deadlineUnix * 1000 <= Date.now()) {
            setFailure({ code: "REVIEW_EXPIRED", message: "" });
            return;
          }
          setFailure({ code: "BYTES_REFRESHED", message: "" });
          await review("BYTES_REFRESHED");
          return;
        }
        if (!stillCurrent()) {
          setPlan(null);
          setPhase("IDLE");
          setFailure({ code: "REVIEW_EXPIRED", message: "" });
          return;
        }
        setPhase("SUBMITTING");
        saveRun(plan.intentDigest, route.tuple.id);
        const result = await post<{ signature: string; state: string }>("/api/solana/cross-swap/submit", {
          phase: "SOLANA",
          intentDigest: plan.intentDigest,
          reviewedTransactionBase64: plan.plan.unsignedWireBase64,
          signedTransactionBase64: signed.signedWireBase64,
        });
        if (!result.ok) {
          const crossed = bridgeSubmitNeedsRecovery(result.failure);
          setFailure(result.failure);
          if (crossed) {
            saveRun(plan.intentDigest, route.tuple.id);
            setPhase("RECOVERY");
            void pollStatus(plan.intentDigest);
          } else {
            clearRun();
            setPlan(null);
            setPhase("IDLE");
          }
          return;
        }
        saveRun(plan.intentDigest, route.tuple.id);
        setPhase("TRACKING");
        void pollStatus(plan.intentDigest);
        return;
      }

      /* Not a Solana plan: nothing on a Solana page signs it (SOL-W1). */
      setPlan(null);
      setPhase("IDLE");
    } catch {
      setFailure({ code: readRun() ? "SUBMIT_UNKNOWN" : "NETWORK", message: "" });
      setPhase(readRun() ? "RECOVERY" : "IDLE");
    } finally {
      submitting.current = false;
    }
  };

  const reset = () => {
    clearRun();
    setOrder(null);
    setPlan(null);
    setFailure(null);
    setReceipt(null);
    receiptAsked.current = null;
    setQuote(null);
    onReset?.();
    setPhase("IDLE");
  };

  /* ── Words ─────────────────────────────────────────────────────────── */
  /* Keyed by network rather than chained on `base`, so a network added to the
     catalogue cannot quietly wear Ethereum's name: the compiler names it here
     or the file does not build. Robinhood Chain arrived wearing it. */
  const networkLabel: Record<SwapNetwork, string> = {
    solana: text("Solana"),
    base: text("Base"),
    ethereum: text("Ethereum"),
    arbitrum: text("Arbitrum"),
    optimism: text("Optimism"),
    polygon: text("Polygon"),
    bnb: text("BNB Chain"),
    robinhood: text("Robinhood Chain"),
    arc: text("Arc"),
  };
  const destinationLegLabel: Record<SwapNetwork, string> = {
    solana: text("To your Solana address"),
    base: text("To your Base address"),
    ethereum: text("To your Ethereum address"),
    arbitrum: text("To your Arbitrum address"),
    optimism: text("To your Optimism address"),
    polygon: text("To your Polygon address"),
    bnb: text("To your BNB Chain address"),
    robinhood: text("To your Robinhood Chain address"),
    arc: text("To your Arc address"),
  };
  const destinationPlaceholder: Record<SwapNetwork, string> = {
    solana: text("Solana address"),
    base: text("Base address"),
    ethereum: text("Ethereum address"),
    arbitrum: text("Arbitrum address"),
    optimism: text("Optimism address"),
    polygon: text("Polygon address"),
    bnb: text("BNB Chain address"),
    robinhood: text("Robinhood Chain address"),
    arc: text("Arc address"),
  };
  const networkName = (network: SwapNetwork) => networkLabel[network];
  const eta = (seconds: number) => (seconds < 60 ? `~${seconds} ${text("s")}` : `~${Math.round(seconds / 60)} ${text("min")}`);
  const q = quote?.quote ?? null;
  /* The provider's cost, without double-counting. `relayerUsd` is the **parent**
     of `relayerGas + protocolUsd` — `lib/swap/cross-swap-quote.ts` says so, and
     adding the parent to one of its children was overstating this row on every
     Relay quote. When the provider states no relayer figure the service fee is
     the only number there is, so it stands alone. */
  const feesUsd = q ? (q.fees.relayerUsd ?? q.fees.protocolUsd) : null;
  /* Ryntra's own charge, never inside the row above. A route with no mechanism
     for one — the direct Circle CCTP lane has none — still prints a row, because
     one that disappears reads as no fee on a day there is one. */
  const feeLine = (fee: Parameters<typeof serviceFeeText>[0]) => serviceFeeText(fee, text("None"));
  const usd = (value: number | null) => value === null ? "—" : (value <= 0 ? text("None") : value < 0.005 ? "< $0.01" : `≈ $${value.toFixed(2)}`);
  const laneOpen = quote?.buildable === true;
  const fromSymbol = route.from.symbol ?? route.from.asset;
  /* The coin the fee is paid in, which on an ERC-20 or SPL origin is **not** the
     coin being sent — and naming the wrong one is how "not enough ETH" gets read
     as "not enough USDC" by somebody holding plenty of USDC. */
  const gasSymbol = catalogAssets(route.from.network).find(asset => asset.kind === "NATIVE")?.symbol ?? "—";

  /**
   * One button that says why it cannot be pressed.
   *
   * A grey "Review" can mean five different things here — no amount, an amount
   * the wallet cannot cover, a missing or malformed destination, a quote that
   * has not arrived, or a paused lane — and a person cannot read their way out
   * of a button that looks the same in all five. Send has named its reason on
   * the button since it shipped; this is the same rule.
   */
  const cta: Readonly<{ label: string; disabled: boolean }> = (() => {
    if (phase === "PLANNING") return { label: text("Preparing…"), disabled: true };
    if (phase === "SIGNING") return { label: text("Waiting for the wallet…"), disabled: true };
    if (phase === "SUBMITTING") return { label: text("Sending…"), disabled: true };
    if (phase === "APPROVING") return { label: text("Approving…"), disabled: true };
    if (!amountRaw) return { label: text("Enter an amount"), disabled: true };
    if (!q) return { label: quoting ? text("Quoting…") : text("Review"), disabled: true };
    /* An expired quote is not a reason to hide the figures and is not a reason to
       let somebody act on them either. If a refresh is already running the button
       says so; otherwise it says the honest thing, which is that this will right
       itself shortly rather than that the person did anything wrong. */
    if (quoteExpired) return { label: quoting ? text("Refreshing…") : text("Try again shortly"), disabled: true };
    /* A paused lane comes before every other reason: when it is closed nothing a
       person types will help, and asking them for an address first would be a lie. */
    if (!laneOpen) return { label: text("Not open yet"), disabled: true };
    if (overBalance) return { label: `${text("Not enough")} ${fromSymbol}`, disabled: true };
    if (noGas) return { label: text("Not enough for the network fee"), disabled: true };
    if (severeImpact && impactAcknowledged !== impactBps) return { label: text("Review the price impact"), disabled: true };
    if (!destinationValid) {
      return { label: destinationValue.trim() === "" ? text("Add the destination address") : text("Check the destination address"), disabled: true };
    }
    return { label: text("Review"), disabled: busy || quoting };
  })();

  /**
   * What a failure means, said in the words of the step it happened on.
   *
   * `stage` is not decoration. The same code list is rendered for a quote that
   * never left the browser and for an action that may have reached a chain, and
   * the honest sentence differs between them: at `QUOTE` nothing was sent and
   * saying so is a relief; at `ACTION` claiming it would be a lie on the one
   * occasion it matters. The default carried exactly that lie — *Nothing was
   * sent twice*, printed under a quote that had never been priced — which is
   * what a person read on production on 2026-09-10.
   */
  const failureCopy = (entry: Failure, stage: "QUOTE" | "ACTION"): string => {
    const code = entry.code;
    const change = entry.extra?.walletChange;
    switch (code) {
      case "QUOTE_CHANGED":
      case "IMPACT_NOT_ACKNOWLEDGED":
        return text("The market moved. Look at the new figures before continuing.");
      case "MAXIMUM_UPDATED": {
        const reserve = typeof entry.extra?.reserveRaw === "string" ? entry.extra.reserveRaw : null;
        const shown = reserve === null ? null : displayRawAmount(reserve, fromDecimals);
        /* The figure is the point of this sentence. Without it the person is told
           their amount changed and not by how much or why. */
        return shown === null
          ? text("The amount was lowered so the network fee is covered. Press Review again.")
          : `${text("Maximum updated to leave")} ${shown} ${fromSymbol} ${text("for network fees.")}`;
      }
      case "NATIVE_FEE_SHORT": {
        const required = typeof entry.extra?.requiredRaw === "string" ? entry.extra.requiredRaw : null;
        const shown = required === null ? null : displayRawAmount(required, fromSolana ? 9 : 18);
        return shown === null
          ? `${text("There is not enough")} ${gasSymbol} ${text("in this wallet to pay the network fee. Nothing was sent.")}`
          : `${text("This needs about")} ${shown} ${gasSymbol} ${text("for the network fee, and the wallet has less. Nothing was sent.")}`;
      }
      case "QUOTE_RATE_LIMITED":
        /* Ryntra's own ceiling at the provider, reached — nothing to do with
           this person's money and nothing they did wrong. The figures already on
           screen stay: they are the last true answer, and blanking them would
           turn a short wait into an apparent outage. */
        return text("Prices are being refreshed too often right now. The figures above stand — a new one follows in a moment.");
      case "QUOTE_NO_QUOTES":
      case "QUOTE_NO_ROUTE":
      case "QUOTE_NO_ADMISSIBLE_ROUTE":
      case "PAIR_NOT_SUPPORTED":
        /* `QUOTE_NO_ROUTE` is what Relay answers, and it was the one missing
           from this list — which is how the whole Robinhood Chain lane came to
           print the default sentence instead. It means what its neighbours
           mean: nobody will fill this pair at this size right now. */
        return text("No route for this pair right now. Nothing was sent — try another amount, or another asset.");
      case "QUOTE_APPROVAL_MISMATCH":
        /* Only reachable now when the provider wants MORE wallet prompts than
           the route stated. Fewer is ordinary — it means the allowance already
           stands — and used to refuse every quote after somebody's first
           approval, surfacing as "the price could not be read". A code that can
           reach a person must never fall to that default again. */
        return text("This route now asks for more wallet approvals than it stated, so nothing was sent.");
      case "QUOTE_ADDRESS_SHAPE":
        return text("One of those addresses does not belong to its network.");
      case "QUOTE_UNAUTHORIZED":
      case "QUOTE_HTTP_ERROR":
      case "QUOTE_TRANSPORT":
      case "QUOTE_UNREADABLE":
        return text("The provider could not be reached. Nothing was sent.");
      case "QUOTE_RATE_LIMITED":
        return text("The provider is busy. Try again in a moment.");
      case "CROSS_SWAP_PAUSED":
        return text("Cross-chain swaps are not open yet.");
      case "REVIEW_EXPIRED":
        return text("The Review expired. Nothing left your wallet; look at the figures again.");
      case "BYTES_REFRESHED":
        return text("The transaction was built again — its bytes live about 30 seconds. Nothing left your wallet; check the fresh Review and sign.");
      case "EXPIRED_BEFORE_SUBMIT":
        return text("The Review expired before sending. Nothing left your wallet.");
      case "WALLET_DECLINED":
        return text("The wallet did not sign. Nothing left your wallet.");
      case "APPROVAL_FAILED":
        return text("The approval did not go through. Nothing left your wallet.");
      case "APPROVED_REVIEW_AGAIN":
        return text("Approval sent. Once it lands, press Review again to see the final figures.");
      case "APPROVAL_SLOW":
        return text("The approval is still confirming. Nothing else was sent; press Review when it lands.");
      case "SIMULATION_FAILED":
        return text("This order would fail on chain as built, so it was not offered.");
      case "WALLET_MODIFIED_BYTES":
        /* Which change, not just that there was one. "A different
           transaction" is true and useless: it leaves a person with nothing
           to do and no idea whether their wallet is broken, the route is
           broken, or somebody is trying to rob them. These are the changes
           the comparison can name, in the words they mean. */
        switch (change) {
          case "VERSION_CHANGED":
            return text("The wallet rebuilt the transaction in a different format than the one reviewed, so it was not sent.");
          case "LOOKUP_TABLES_CHANGED":
            return text("The wallet changed which address tables the transfer reads, so it was not sent.");
          case "SIGNERS_CHANGED":
            return text("The wallet changed who has to sign, so it was not sent.");
          case "ACCOUNT_ROLE_CHANGED":
            return text("The wallet changed what one of the accounts is allowed to do, so it was not sent.");
          case "PROGRAM_ADDED":
            return text("The wallet added a program that was not in the Review, so it was not sent.");
          case "COMPUTE_BUDGET_INVALID":
            return text("The wallet asked for a priority fee this product could not read, so nothing was sent.");
          case "WALLET_GUARD_INVALID":
            return text("The wallet added a safety check this product could not verify, so nothing was sent.");
          case "INSTRUCTION_CHANGED":
            return text("The wallet changed what the transaction does, so it was not sent.");
          default:
            return text("The wallet returned a different transaction than the one reviewed, so it was not sent.");
        }
      case "WALLET_REPLACED_BLOCKHASH":
        return text("Nothing about the swap changed — the wallet refreshed the transaction while it waited. Press Review and confirm without pausing.");
      case "SUBMIT_UNKNOWN":
      case "STATUS_UNAVAILABLE":
        return text("The network did not confirm whether the order was sent. Nothing is sent again; the status below is read from the chain.");
      case "STORE_NOT_DURABLE":
      case "SIMULATION_UNAVAILABLE":
      case "BUILD_FAILED":
        return text("The order could not be prepared right now. Nothing left your wallet.");
      case "ROUTE_NEEDS_PROVIDER_KEY":
        return text("This route is not offered from Solana right now.");
      case "NETWORK":
        return stage === "QUOTE" || !readRun() ? text("Ryntra could not be reached. Nothing left your wallet.") : text("The outcome is not yet known. Keep checking this transaction; do not send another.");
      case "QUOTE_ADDRESSES_REQUIRED": {
        /* Not a failure: nothing was attempted. This route is priced for the
           wallets it will use, and one of them has not been given yet — and
           `needs` says which. It always said *destination*, so a person who had
           typed a perfectly good destination and connected no wallet was sent
           back to the one field they had already got right. */
        const needs = Array.isArray(entry.extra?.needs) ? (entry.extra.needs as readonly unknown[]) : [];
        const wantsSource = needs.includes("sourceAddress");
        const wantsDestination = needs.includes("destinationAddress");
        if (wantsSource && !wantsDestination) {
          return text("Connect the wallet you are sending from — this route is priced for the wallet that signs it.");
        }
        if (wantsDestination && !wantsSource) {
          return text("Add the address the money goes to — then you will see how much arrives.");
        }
        return text("Connect the sending wallet and add the destination address — this route is priced for both.");
      }
      default:
        /* An unmapped code says which step stopped and nothing about the money.
           It cannot say more: at `QUOTE` it is certain nothing was sent, and at
           `ACTION` it is certain of nothing at all — which is precisely when a
           reassuring sentence does the most damage. The code itself is shown
           beside this line in Pro, where somebody can act on it. */
        return stage === "QUOTE"
          ? text("The price could not be read right now. Nothing was sent.")
          : text("This did not complete. Whatever was sent, if anything, is read from the chain below — nothing is ever sent twice.");
    }
  };

  const stateWord = (state: string): string => {
    switch (state) {
      case "SUBMITTED_UNKNOWN":
        return text("Being read from the chain");
      case "SUBMITTED":
        return text("Sent from your wallet");
      case "IN_PROGRESS":
        return text("Provider is filling the order");
      case "COMPLETED":
        return text("Arrived");
      case "REFUNDED":
        return text("Refunded on the source network");
      case "SOURCE_FAILED":
        return text("Did not happen");
      case "EXPIRED_BEFORE_SUBMIT":
        return text("Not sent");
      case "RECOVERY_REQUIRED":
        return text("Being read from the chain");
      default:
        return text("Preparing");
    }
  };

  const progressStep = order ? (order.state === "COMPLETED" || order.state === "REFUNDED" ? 2 : order.state === "IN_PROGRESS" ? 1 : 0) : 0;

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className={styles.card}>
      {q && !tracking && phase !== "FAILED" && phase !== "DONE" && phase !== "REFUNDED" && phase !== "RECOVERY" ? (
        <dl className={styles.facts} aria-label={text("What you receive")}>
          <div>
            <dt>{text("You receive")}</dt>
            <dd translate="no">≈ {displayRawAmount(q.to.expectedRaw, toDecimals)} {q.to.symbol}</dd>
          </div>
          <div>
            <dt>{text("At least")}</dt>
            <dd translate="no">{displayRawAmount(q.to.minimumRaw, toDecimals)} {q.to.symbol}</dd>
          </div>
          <div>
            <dt>{text("Provider fees")}</dt>
            <dd translate="no">{usd(feesUsd)}</dd>
          </div>
          <div>
            <dt>{text("Ryntra service fee")}</dt>
            <dd translate="no">{feeLine(q.serviceFee)}</dd>
          </div>
          <div>
            <dt>{text("Time")}</dt>
            <dd translate="no">{eta(q.etaSeconds)}</dd>
          </div>
          {pro ? (
            <>
              <div>
                <dt>{text("Route")}</dt>
                <dd>{q.routeLabel}</dd>
              </div>
              <div>
                <dt>{text("Quote age")}</dt>
                <dd translate="no">{quoteAgeSeconds} {text("s")}</dd>
              </div>
              <div>
                <dt>{text("Approvals")}</dt>
                <dd translate="no">{q.approvals}</dd>
              </div>
              <div>
                <dt>{text("Price impact")}</dt>
                <dd translate="no">{q.priceImpactBps === null ? "—" : `${(q.priceImpactBps / 100).toFixed(2)}%`}</dd>
              </div>
              <div>
                <dt>{text("Slippage")}</dt>
                <dd translate="no">{(q.slippageBps / 100).toFixed(2)}%</dd>
              </div>
              {q.fees.rentLamports ? (
                <div>
                  <dt>{text("Account rent on Solana")}</dt>
                  <dd translate="no">{(Number(q.fees.rentLamports) / 1e9).toFixed(4)} SOL</dd>
                </div>
              ) : null}
            </>
          ) : null}
        </dl>
      ) : null}

      {q && (phase === "IDLE" || phase === "REVIEW") ? <p className={styles.note}>{text("Provider fees and the Ryntra fee are already included in the quote. Source network fees are paid separately.")}</p> : null}
      {q && phase === "IDLE" ? <p className={styles.note}>{text("Slippage")}: {(q.slippageBps / 100).toFixed(2)}%{impactBps !== null && impactBps <= -200 ? ` · ${text("Price impact")}: ${(impactBps / 100).toFixed(2)}%` : ""}</p> : null}
      {severeImpact && phase === "IDLE" ? <label className={styles.error}><input type="checkbox" checked={impactAcknowledged === impactBps} onChange={event => setImpactAcknowledged(event.target.checked ? impactBps : null)} /> {text("I understand the value lost in this quote.")}</label> : null}
      {(quoteExpired || (quoteFailure && quoteFailure.code !== "QUOTE_ADDRESSES_REQUIRED")) && phase === "IDLE" ? <button className={styles.secondary} type="button" disabled={quoting} onClick={() => void fetchQuote(true)}>{text("Refresh quote")}</button> : null}
      {(phase === "TRACKING" || phase === "RECOVERY") && !order ? <p className={styles.note} role="status">{text("The outcome is not yet known. Keep checking this transaction; do not send another.")}</p> : null}

      {/* «Котирування…» is said once, on the button (B18). A missing address is not a failure: it is said quietly,
          under the field it asks for. */}
      {quoteFailure && !tracking && quoteFailure.code !== "QUOTE_ADDRESSES_REQUIRED" ? (
        <p className={styles.error}>
          {failureCopy(quoteFailure, "QUOTE")}
        </p>
      ) : null}
      {overBalance && offerableRaw != null && phase === "IDLE" ? (
        <p className={styles.error}>
          <b translate="no">{displayRawAmount(offerableRaw, fromDecimals)} {fromSymbol}</b>{" "}
          {fromSolana
            ? text("is the most this wallet can swap — the rest stays for the network fee and the order account the provider opens on Solana.")
            : route.from.network === "ethereum" && route.from.economicAsset === "ETH"
              ? text("is the most this wallet can swap — the rest stays for gas.")
              : text("is the most this wallet can swap.")}
        </p>
      ) : null}
      {noGas && phase === "IDLE" ? (
        <p className={styles.error}>
          {text("Not enough for the network fee")}: {gasSymbol} · {networkName(route.from.network)}.
        </p>
      ) : null}
      {q && !laneOpen && phase === "IDLE" ? <p className={styles.note}>{text("Cross-chain swaps are not open yet. The figures are live; the button is not.")}</p> : null}

      {!tracking && phase !== "FAILED" && phase !== "DONE" && phase !== "REFUNDED" && phase !== "RECOVERY" ? (
        <div className={styles.leg}>
          <span className={styles.legLabel}>
            {destinationLegLabel[route.to.network]}
          </span>
          <input
            className={styles.address}
            value={destinationValue}
            onChange={(event) => {
              setDestinationTouched(true);
              setDestination(event.target.value);
            }}
            placeholder={destinationPlaceholder[route.to.network]}
            spellCheck={false}
            autoComplete="off"
            disabled={busy || phase === "REVIEW"}
            aria-invalid={destinationValue.length > 0 && !destinationValid ? true : undefined}
          />
          {destinationValue.length > 0 && !destinationValid ? (
            <small className={styles.error}>
              {route.to.network === "solana" ? text("That is not a Solana address.") : text("That is not an Ethereum-style address.")}
            </small>
          ) : null}
        </div>
      ) : null}
      {quoteFailure && !tracking && quoteFailure.code === "QUOTE_ADDRESSES_REQUIRED" ? (
        <p className={styles.note}>{failureCopy(quoteFailure, "QUOTE")}</p>
      ) : null}

      {phase === "REVIEW" && plan ? (
        <section className={styles.review} aria-label={text("Ready to sign")}>
          <div className={styles.reviewHead}>
            <span className={styles.legLabel}>{text("Ready to sign")}</span>
            {reviewSecondsLeft !== null ? <span className={styles.note} translate="no">{reviewSecondsLeft} {text("s")}</span> : null}
          </div>
          <div className={styles.reviewGrid}>
            <span>
              {text("You pay")}
              <b translate="no">{displayRawAmount(plan.quote.from.amountRaw, fromDecimals)} {plan.quote.from.symbol} · {networkName(route.from.network)}</b>
            </span>
            <span>
              {text("You receive at least")}
              <b translate="no">{displayRawAmount(plan.quote.to.minimumRaw, toDecimals)} {plan.quote.to.symbol} · {networkName(route.to.network)}</b>
            </span>
            <span>
              {text("Provider costs")}
              <b translate="no">{usd(plan.quote.fees.relayerUsd ?? plan.quote.fees.protocolUsd)}</b>
            </span>
            <span>
              {text("Ryntra service fee")}
              <b translate="no">{feeLine(plan.quote.serviceFee)}</b>
            </span>
            {/* The network fee the person's own wallet pays, on top of the amount.
                An EVM origin states a ceiling in its own coin, which is the more
                useful number; every other origin states the provider's USD figure.
                Neither is derived here — a fee this surface worked out itself is a
                fee nobody can check. Absent means unknown, and renders no line. */}
            {plan.plan.origin === "evm" && plan.plan.totalMaximumCostWei ? (
              <span>
                {text("Network fee, at most")}
                <b translate="no">{displayRawAmount(plan.plan.totalMaximumCostWei, 18)} {gasSymbol}</b>
              </span>
            ) : plan.quote.fees.sourceGasUsd !== null ? (
              <span>
                {text("Network fee")}
                <b translate="no">{usd(plan.quote.fees.sourceGasUsd)}</b>
              </span>
            ) : null}
            <span>
              {text("Wallet prompts")}
              <b translate="no">{plan.plan.walletPrompts}</b>
            </span>
            <span>
              {text("Expected time")}
              <b translate="no">{eta(plan.quote.etaSeconds)}</b>
            </span>
            <span>
              {text("Provider")}
              <b>{plan.quote.routeLabel}</b>
            </span>
            <span>
              {text("Destination")}
              <b translate="no">{short(destinationValue)}</b>
            </span>
          </div>
          <ul className={styles.limits}>
            <li>{text("Once sent, this cannot be undone from Ryntra.")}</li>
            <li>
              {plan.quote.route === "SWIFT"
                ? text("If nobody fills the order by its deadline, the money returns on the source network — possibly as USDC or ETH rather than the asset you sent.")
                : plan.quote.route === "RELAY_DEPOSIT"
                  ? /* Relay orders carry no deadline, so no deadline is promised.
                       What is true is that an unfilled deposit is refunded on the
                       source chain, and that this is not instant. */
                    text("If nobody fills the order, the deposit is refunded on the source network. There is no fixed deadline for that.")
                  : text("The USDC leg moves through Circle; the swap into the destination asset happens on arrival.")}
            </li>
          </ul>
        </section>
      ) : null}

      {failure && failure.code !== "REVIEW_EXPIRED" && failure.code !== "BYTES_REFRESHED" && failure.code !== "APPROVED_REVIEW_AGAIN" && failure.code !== "APPROVAL_SLOW" ? (
        <p className={styles.error}>
          {failureCopy(failure, "ACTION")}
        </p>
      ) : null}
      {failure && (failure.code === "REVIEW_EXPIRED" || failure.code === "BYTES_REFRESHED" || failure.code === "APPROVED_REVIEW_AGAIN" || failure.code === "APPROVAL_SLOW") ? <p className={styles.note}>{failureCopy(failure, "ACTION")}</p> : null}

      {(tracking || phase === "DONE" || phase === "REFUNDED" || phase === "RECOVERY" || phase === "FAILED") && order ? (
        <section className={styles.review} aria-label={text("Where this swap is")}>
          <ol className={styles.progress}>
            <li data-state={progressStep > 0 ? "done" : "now"}>{text("Sent")}</li>
            <li data-state={progressStep > 1 ? "done" : progressStep === 1 ? "now" : "next"}>{text("Filling")}</li>
            <li data-state={progressStep === 2 ? "done" : "next"}>{order.state === "REFUNDED" ? text("Refunded") : text("Arrived")}</li>
          </ol>
          <div className={styles.reviewGrid}>
            <span>
              {text("Status")}
              <b>{stateWord(order.state)}</b>
            </span>
            <span>
              {text("You sent")}
              <b translate="no">{displayRawAmount(order.from.amountRaw, order.from.decimals)} {order.from.symbol}</b>
            </span>
            {order.receivedAmount ? (
              <span>
                {text("You received")}
                <b translate="no">{order.receivedAmount} {order.to.symbol}</b>
              </span>
            ) : (
              <span>
                {text("You receive at least")}
                <b translate="no">{displayRawAmount(order.to.minimumRaw, order.to.decimals)} {order.to.symbol}</b>
              </span>
            )}
            {order.refund ? (
              <span>
                {text("Refund")}
                <b translate="no">{order.refund.amount ?? ""} {order.refund.tokenSymbol ?? ""}</b>
              </span>
            ) : null}
            {/* What it cost, from the receipt's own signed facts.

                Read from the provider's report of this fill rather than from
                the quote, and shown only where the provider confirmed taking
                it. A quoted fee rendered here would tell somebody they paid
                something they did not — Relay documents an operation shape that
                collects nothing and reports no error. */}
            {settledFee && settledFee.collected && settledFee.paidAmountRaw && settledFee.decimals !== null ? (
              <span>
                {text("Ryntra fee")}
                <b translate="no">
                  {displayRawAmount(settledFee.paidAmountRaw, settledFee.decimals)} {settledFee.symbol ?? order.from.symbol}
                </b>
              </span>
            ) : null}
          </div>
          <div className={styles.actions}>
            {order.sourceTxHash ? (
              <a className={styles.secondary} href={txLink(order.from.network, order.sourceTxHash)} target="_blank" rel="noreferrer">
                {text("Source transaction")}
              </a>
            ) : null}
            {order.destinationTxHash ? (
              <a className={styles.secondary} href={txLink(order.to.network, order.destinationTxHash)} target="_blank" rel="noreferrer">
                {text("Destination transaction")}
              </a>
            ) : null}
            {order.refundTxHash ? (
              <a className={styles.secondary} href={txLink(order.from.network, order.refundTxHash)} target="_blank" rel="noreferrer">
                {text("Refund transaction")}
              </a>
            ) : null}
            {/* The receipt, the moment there is one to keep.

                Two ways out on purpose: the file is the copy that outlives this
                browser, and Receipts is where it can be opened, verified and
                found again from another device — because the document lives on
                the operation, not in local storage. */}
            {receipt ? (
              <>
                <button className={styles.secondary} type="button" onClick={() => downloadReceipt(receipt)}>
                  {text("Download receipt")}
                </button>
                <a className={styles.secondary} href={`/app/receipts?action=${encodeURIComponent(order.intentDigest)}`}>
                  {text("Receipt")}
                </a>
              </>
            ) : null}
            {order.recovery.terminal || order.state === "SOURCE_FAILED" || order.state === "EXPIRED_BEFORE_SUBMIT" ? (
              <button className={styles.secondary} type="button" onClick={reset}>
                {text("New swap")}
              </button>
            ) : null}
          </div>
          {phase === "RECOVERY" ? <p className={styles.note}>{text("The order is read from the chain every few seconds. Nothing is sent again.")}</p> : null}
          {pro && order.sourceTxHash ? <p className={styles.note} translate="no">{short(order.sourceTxHash)}</p> : null}
        </section>
      ) : null}

      {/* The form's one action, pinned above the bottom bar on a phone (B18). What each press does is unchanged. */}
      {!tracking && phase !== "FAILED" && phase !== "DONE" && phase !== "REFUNDED" && phase !== "RECOVERY" ? (
        <MoneyAction>
        {fromSolana && !solana ? (
          /* The guest's one button, as on every page (B14): it opens the header's wallet panel. */
          <ConnectWalletButton block />
        ) : phase === "REVIEW" && plan ? (
          <div className={styles.actions}>
            <Button variant="primary" block onClick={() => {
              if (bridgeReviewCurrent({ key: planSnapshot!.key, expiresAt: plan.reviewExpiresAt }, contextKey, Date.now())) void confirm();
              else { setPlan(null); setPhase("IDLE"); void fetchQuote(true); }
            }} disabled={busy} lang={locale === "uk" ? "uk" : "en"}>
              {!bridgeReviewCurrent({ key: planSnapshot!.key, expiresAt: plan.reviewExpiresAt }, contextKey, Date.now()) ? text("Refresh quote") :
              plan.plan.origin === "evm" && plan.plan.calls.some((call) => call.purpose === "APPROVE")
                ? text("Approve in wallet")
                : text("Confirm in wallet")}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setPlan(null);
                setPhase("IDLE");
              }}
              lang={locale === "uk" ? "uk" : "en"}
            >
              {text("Back")}
            </Button>
          </div>
        ) : (
          <Button variant="primary" block onClick={() => void review()} disabled={cta.disabled} lang={locale === "uk" ? "uk" : "en"}>
            {cta.label}
          </Button>
        )}
        </MoneyAction>
      ) : null}
    </div>
  );
}
