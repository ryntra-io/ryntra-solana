"use client";

import { ArrowUpRight, CheckCircle, Warning, XCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usdValue, walletRowsForOwner } from "@/app/app/wallet-view-model";
import { Panel } from "@/app/shell/panel";
import { StatusChip } from "@/app/shell/status-chip";
import { displayAmount, parseHumanAmount, scaleRawAmount } from "@/lib/solana/amounts";
import { swapFailureCopy } from "@/lib/solana/swap-failure-copy";
import type { SolanaPolicyVerdict } from "@/lib/solana/contracts";
import type { SwapPolicyFinding, SwapPolicyVerdict } from "@/lib/solana/swap-policy";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { achievedPrice, classifySpotFill } from "@/lib/solana/fill-outcome";
import { HOLDINGS_AFTER_FILL_DELAYS_MS, readWalletHoldingsUntilComplete, type HoldingsTokenRead } from "@/lib/solana/holdings.client";
import { SOLANA_MAINNET_USDC_MINT, TOKEN_2022_PROGRAM_ID, WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";
import { downloadReceipt, storeBoundSolanaReceipt } from "@/lib/solana/send-receipt-vault.client";
import {
  assessSwapClientReview,
  swapQuoteMatches,
  shouldAutoRefreshQuote,
  parseSwapClientAttempt,
  readSwapClientSignature,
  transitionSwapClientAttempt,
  type SwapClientAttempt,
} from "@/lib/solana/swap-client-safety";
import { assessSwapWalletAdoption } from "@/lib/solana/swap-adoption";
import { inspectJupiterSwapTransaction } from "@/lib/solana/swap-transaction-check";
import { signTransaction } from "@/lib/solana/wallet.client";
import { serviceFeeReviewText, serviceFeeText, type RyntraServiceFee } from "@/lib/swap/service-fee";
import { FEATURED_MINTS } from "../assets/featured.ts";
import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { WalletConnectRow } from "../wallet-connect.tsx";
import { MarketIcon } from "../spot/market-list.tsx";
import { buildSwapAssetRows, type SwapHolding, type SwapTokenRow } from "./swap-assets.ts";
import { SwapContext, type SwapFacts, type SwapSide } from "./swap-context.tsx";

import styles from "./swap-card.module.css";

/**
 * One swap, one card.
 *
 * The Trade surface used to answer as a document: a mint-address form, then
 * six panels of provider evidence, then a separate console to actually sign.
 * A person who wanted to swap had to read a report first. This card is the
 * product instead — sell leg, buy leg, one action — and the evidence that
 * makes Ryntra worth using stays exactly as complete, one disclosure deep.
 *
 * Nothing about the honesty changed: the quote is server-built from the keyed
 * Jupiter contract, the risk line is the same tested review policy over the
 * output mint, and execution still runs the full path — taker order,
 * exact-bytes firewall, simulation with proven owner deltas, swap policy, the
 * signer's own visible wallet confirmation, one execute, an independent chain
 * read and a signed Receipt.
 *
 * Any pair, any amount. The card used to refuse everything outside USDC ↔ SOL
 * at 2–5 USDC because the owner canary governed the signature; the swap has
 * its own policy now, and the asset list is Jupiter's whole catalogue rather
 * than six mints.
 */

const NETWORK = "mainnet";
const QUOTE_DEBOUNCE_MS = 450;
const SEARCH_DEBOUNCE_MS = 250;
const ATTEMPT_STORAGE_KEY = "ryntra.solana.m2.swap-client-attempt.v1";
const MINT_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/* A blockhash lives about a minute and a half. Reading past that adds nothing
   the chain has not already decided, so the wait is bounded rather than
   endless — and what it waits for is an answer, not a button press. */
const RECOVERY_DEADLINE_MS = 150_000;
const RECOVERY_INTERVAL_MS = 3_000;

type QuoteResponse = Readonly<{
  order: Readonly<{
    inputMint: string;
    outputMint: string;
    inAmountRaw: string;
    outAmountRaw: string;
    minReceivedRaw: string;
    slippageBps: number;
    priceImpactPct: string;
    router: string;
    mode: string;
    swapType: string;
    swapMode: string;
    totalFeeBasisPoints: number;
    totalFeeMint: string;
    platformFee: Readonly<{ basisPoints: number; mint: string }>;
    signatureFeeLamports: string;
    signatureFeePayer: string | null;
    priorityFeeLamports: string;
    priorityFeePayer: string | null;
    rentFeeLamports: string;
    rentFeePayer: string | null;
    routeAffectingOptions: readonly string[];
    requestId: string;
    reviewExpiresAt: string;
    latencyMs: number;
    swapUsdValue: string | null;
    inUsdValue: string | null;
    outUsdValue: string | null;
    route: readonly Readonly<{ label: string; basisPoints: number; ammKey: string }>[];
    source: Readonly<{ label: string }>;
    /* Null on a discovery quote. The venue answers slippage, the minimum and
       every fee with a zero it cannot yet know, so this is what tells those
       zeros apart from real ones. */
    taker: string | null;
  }>;
  review: Readonly<{ quoteDigest: string }>;
  verdict: SolanaPolicyVerdict;
  decimals: Readonly<Record<string, number>>;
  outputFee: Readonly<{ basisPoints: number; feeRaw: string; capApplied: boolean }>;
  expiresAt: string;
}>;

type OrderResponse = Readonly<{
  order: QuoteResponse["order"] & Readonly<{ transactionBase64: string; lastValidBlockHeight: string }>;
  review: Readonly<{ quoteDigest: string }>;
  inspection: Readonly<{ messageHashHex: string; programs: readonly string[]; instructionCount: number }>;
  simulation: Readonly<{
    status: "OK" | "FAILED";
    unitsConsumed: string | null;
    ownerEffects: Readonly<{
      status: "VERIFIED";
      inputAmountRaw: string;
      outputAmountRaw: string;
      takerLamportDelta: string;
      ownerTokenDeltas: readonly Readonly<{ mint: string; rawDelta: string }>[];
      programs: readonly string[];
    }> | null;
  }>;
  policy: Readonly<{ verdict: SwapPolicyVerdict }>;
  decimals: Readonly<Record<string, number>>;
  bundle: unknown;
  proof: Readonly<{ status: "SIGNED" | "UNSIGNED"; digest?: string }>;
  preSign: Readonly<{ ready: boolean; code: string; reason: string }>;
  expiresAt: string;
}>;

/** One asset as Jupiter's catalogue describes it, plus what a swap needs. */
type TokenRow = SwapTokenRow;

type ExecuteResponse = Readonly<{
  state: string;
  signature: string;
  observation: Readonly<{ actualInputRaw: string; actualOutputRaw: string }> | null;
  facts: Readonly<{
    reconciliation: Readonly<{ state: string; outputDeltaRaw: string; deviations: readonly string[]; minimumMet?: boolean }>;
    fees?: Readonly<{ serviceFee?: RyntraServiceFee | null }>;
  }> | null;
  factsRefusal: string | null;
  receipt: unknown;
  recovery?: string;
}>;

type RecoveryResponse = Readonly<{
  state:
    | "PENDING"
    | "FAILED"
    | "EXPIRED_BEFORE_SUBMIT"
    /* Broadcast, never seen by the full ledger, and now past the block that
       could have carried it. Nothing moved, and nothing can. */
    | "EXPIRED_AFTER_SUBMIT"
    | "ALREADY_RECEIPTED"
    | "RECOVERED"
    /* This server never recorded the signature and no operator has seen it. */
    | "UNKNOWN_TO_CHAIN"
    | "SEEN_WITHOUT_RECORD";
  signature: string;
  reason?: string;
  observation?: ExecuteResponse["observation"];
  facts?: ExecuteResponse["facts"];
  receipt?: unknown;
  receiptHash?: string;
}>;

type Holding = SwapHolding;

type Failure = Readonly<{
  code: string;
  message: string;
  /* "NOT_CROSSED" is the server saying it refused before it claimed the
     signature — proof the network never saw those bytes, and the only thing
     that lets this card release an attempt it had already written down. */
  submitBoundary?: "NOT_CROSSED";
  ownerLock?: Readonly<{
    state: string;
    requestId: string;
    signature: string | null;
  }> | null;
}>;

type Phase = "IDLE" | "PREPARING" | "REVIEW" | "SIGNING" | "EXECUTING" | "RECOVERING" | "SETTLED" | "RECOVERY";

/** The two outcomes where the answer is simply that nothing happened. */
const NOTHING_HAPPENED: ReadonlySet<string> = new Set(["EXPIRED_BEFORE_SUBMIT", "EXPIRED_AFTER_SUBMIT"]);

/**
 * Say it in the words a person would use.
 *
 * "EXPIRED_AFTER_SUBMIT" is the ledger's name for this and belongs in the
 * Receipt. On the card the useful facts are shorter: nothing moved, and the
 * wallet is free again.
 */
function nothingHappenedCopy(state: string, text: (source: string) => string): string | undefined {
  if (state === "EXPIRED_AFTER_SUBMIT") {
    return text("The transaction was sent but never reached the chain, and the block it needed has passed. Nothing moved, and nothing can now. You can trade again.");
  }
  if (state === "EXPIRED_BEFORE_SUBMIT") {
    return text("The transaction was never sent and the block it needed has passed. Nothing moved. You can trade again.");
  }
  return undefined;
}

const TOKENS = FEATURED_MINTS;

/**
 * What to call a mint on screen.
 *
 * The starting list still names the six mints this repository decodes from
 * captured bytes; everything else is named by Jupiter's catalogue, and an
 * asset nobody has named yet is shown as its own truncated address rather
 * than as a guess.
 */
/**
 * The name of an asset, and separately the case against it.
 *
 * `FEATURED_MINTS` writes a factual note for the Passport surface — what the
 * mint carries, which authorities exist, what a holder is exposed to. That
 * belongs on a page about the asset. In a chooser it made every row two lines
 * of clause truncated mid-word, so picking a coin read like reviewing one, and
 * the list of six looked like a lab bench rather than a wallet. Every note is
 * written as "Name — the facts"; the chooser takes the name and leaves the
 * facts to the Passport it already links.
 */
function nameOf(note: string): string {
  const [name] = note.split(" — ");
  return name.trim();
}

function describeToken(mint: string, known: Readonly<Record<string, TokenRow>>) {
  const featured = TOKENS.find((entry) => entry.mint === mint);
  const row = known[mint];
  return {
    mint,
    code: featured?.code ?? row?.symbol ?? `${mint.slice(0, 4)}…`,
    name: mint === WRAPPED_SOL_MINT ? "Solana" : row?.name ?? (featured ? nameOf(featured.note) : ""),
    icon: row?.icon ?? null,
    program: (row?.tokenProgram === TOKEN_2022_PROGRAM_ID ? "Token-2022" : featured?.program ?? "SPL Token") as
      | "SPL Token"
      | "Token-2022",
  };
}

async function post<T>(url: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: true; value: T } | { ok: false; failure: Failure }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch {
    return { ok: false, failure: { code: "NETWORK", message: "The request did not complete." } };
  }
  const value = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok && response.status !== 202) {
    const error = (value.error ?? {}) as Partial<Failure>;
    return {
      ok: false,
      failure: {
        code: error.code ?? `HTTP_${response.status}`,
        message: error.message ?? "The request failed.",
        submitBoundary: error.submitBoundary,
        ownerLock: error.ownerLock ?? null,
      },
    };
  }
  return { ok: true, value: value as T };
}

/**
 * The same amount, ungrouped.
 *
 * `scaleRawAmount` groups thousands for the eye, which is right on a label and
 * wrong everywhere else: `parseHumanAmount` refuses a comma by design, and
 * `Number("3,844.44")` is `NaN`. Flip, MAX and the rate line all read a scaled
 * amount back, so they read it through here. The rate said `NaN BERN` and the
 * flip silently stopped quoting the moment a leg crossed a thousand.
 */
function plainAmount(rawAmount: string, decimals: number): string {
  return scaleRawAmount(rawAmount, decimals).replace(/,/g, "");
}

function short(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function failureCopy(code: string, text: (english: string) => string): string {
  return swapFailureCopy(code, text).message;
}

/**
 * What Ryntra takes of a swap, read off the order rather than asserted.
 *
 * It is a real 0.50% (`RYNTRA_SERVICE_FEE_POLICY.JUPITER_REFERRAL`) wherever
 * Jupiter applied the referral account, and a stated zero wherever it did not —
 * which is a case that exists: the order still executes and the fee is simply
 * not taken.
 *
 * Defensive rather than typed straight through because both order shapes reach
 * this file as plain objects, and a Review that threw on a provider adding a
 * field would be worse than one that shows the rate it can read.
 */
function ryntraServiceFee(order: object): RyntraServiceFee | null {
  const fee = (order as { ryntraFee?: unknown }).ryntraFee;
  if (!fee || typeof fee !== "object") return null;
  const candidate = fee as RyntraServiceFee;
  return typeof candidate.basisPoints === "number" && typeof candidate.mechanism === "string" ? candidate : null;
}

function reviewWarningCopies(
  finding: SwapPolicyFinding,
  order: Readonly<{ outAmountRaw: string; minReceivedRaw: string; slippageBps: number }>,
  text: (english: string) => string,
): readonly string[] {
  if (finding.rule === "OUTPUT_ASSET_REVIEWED") return [text("This asset needs extra review.")];
  if (finding.rule === "SLIPPAGE_BOUNDED") {
    const quoted = BigInt(order.outAmountRaw);
    const minimum = BigInt(order.minReceivedRaw);
    const impliedSlippageBps = quoted > 0n ? Number(((quoted - minimum) * 10_000n) / quoted) : 0;
    const effectiveSlippageBps = Math.max(order.slippageBps, impliedSlippageBps);
    const warnings: string[] = [];
    if (Math.abs(impliedSlippageBps - order.slippageBps) > 1) {
      warnings.push(text("The quote and minimum received use different slippage."));
    }
    if (effectiveSlippageBps > 300) warnings.push(text("The price may move by more than 3%."));
    return warnings.length > 0 ? warnings : [text("Review this swap carefully.")];
  }
  if (finding.rule === "PRICE_IMPACT_DISCLOSED") return [text("This swap may move the market price.")];
  if (finding.rule === "VALUE_DISCLOSED") return [text("USD value is unavailable.")];
  return [text("Review this swap carefully.")];
}

/**
 * The unified Swap surface (Unified Swap V1) owns FROM, TO and the
 * amount for every class of action and hands this engine the Solana pair it
 * resolved. In that mode the card keeps everything that makes it the accepted
 * same-chain path — quote, Review, sign, execute, recovery, receipt — and drops
 * only what the surface already shows: its own pickers, amount field and panel
 * frame. The engine is otherwise untouched.
 */
export type SwapCardEmbedded = Readonly<{ sellMint: string; buyMint: string; amount: string }>;

/** What the surface needs to state in Simple for this class; the engine's own facts, no new numbers. */
export type SwapCardFacts = Readonly<{
  expectedOutRaw: string | null;
  minReceivedRaw: string | null;
  buyDecimals: number;
  sellDecimals: number;
  networkFeeSol: string | null;
  platformFeeBasisPoints: number | null;
  priceImpactPct: string | null;
  secondsLeft: number | null;
  quoting: boolean;
  provider: string | null;
  route: readonly string[];
  reviewing: boolean;
}>;

export function SwapCard({ initialSell, initialBuy, initialAmount, embedded, onFacts }: {
  initialSell?: string;
  initialBuy?: string;
  initialAmount?: string;
  embedded?: SwapCardEmbedded;
  onFacts?: (facts: SwapCardFacts) => void;
}) {
  const { text } = useSolanaI18n();
  const { wallets, connection, connecting, connect } = useSolanaConnection();

  const [sellMint, setSellMint] = useState(initialSell && MINT_ADDRESS.test(initialSell) ? initialSell : WRAPPED_SOL_MINT);
  const [buyMint, setBuyMint] = useState(initialBuy && MINT_ADDRESS.test(initialBuy) ? initialBuy : SOLANA_MAINNET_USDC_MINT);
  /* Empty, not one. A seeded `1` was indistinguishable from a typed `1`: the
     field read as an amount the person had chosen, the address bar then said
     `amount=1` as though they had asked for it, and the only way to swap a
     different figure was to clear a number nobody entered. The pair still
     defaults, because a pair is a starting point and an amount is a decision. */
  const [amount, setAmount] = useState(initialAmount ?? "");
  /* Embedded under the unified surface, the pair and amount are the surface's
     decisions; this card follows them and never argues back. */
  const embeddedSell = embedded?.sellMint;
  const embeddedBuy = embedded?.buyMint;
  const embeddedAmount = embedded?.amount;
  useEffect(() => {
    if (embeddedSell === undefined || embeddedBuy === undefined || embeddedAmount === undefined) return;
    setSellMint((current) => (MINT_ADDRESS.test(embeddedSell) && current !== embeddedSell ? embeddedSell : current));
    setBuyMint((current) => (MINT_ADDRESS.test(embeddedBuy) && current !== embeddedBuy ? embeddedBuy : current));
    setAmount((current) => (current !== embeddedAmount ? embeddedAmount : current));
  }, [embeddedSell, embeddedBuy, embeddedAmount]);
  const [quoteRead, setQuote] = useState<QuoteResponse | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteFailure, setQuoteFailure] = useState<Failure | null>(null);
  const [holdingsRead, setHoldingsRead] = useState<{ owner: string; rows: readonly Holding[]; tokenRead: HoldingsTokenRead } | null>(null);
  const [holdingsFailed, setHoldingsFailed] = useState(false);
  const holdings = walletRowsForOwner(holdingsRead, connection?.address ?? null);
  /* Whether the balances on screen are the whole wallet. A partial read is
     shown as partial and offered again; it is never shown as the wallet. */
  const holdingsPartial = holdingsRead !== null && holdingsRead.owner === connection?.address && holdingsRead.tokenRead !== "COMPLETE";
  /* Bumped to read the balances again: after a fill, and by hand. */
  const [holdingsGeneration, setHoldingsGeneration] = useState(0);
  const refreshHoldings = useCallback(() => setHoldingsGeneration((current) => current + 1), []);
  const [picker, setPicker] = useState<"sell" | "buy" | null>(null);
  /* What the catalogue has said about a mint so far. Decimals live here: a
     typed amount cannot become raw units without them, and guessing six would
     quote a completely different trade on any asset that does not use six. */
  const [known, setKnown] = useState<Readonly<Record<string, TokenRow>>>({});
  const candidateRows = useMemo(() => buildSwapAssetRows(holdings, known, TOKENS), [holdings, known]);
  const assetCatalog = useMemo(() => Object.fromEntries(candidateRows.map(row => [row.mint, row])), [candidateRows]);
  const currentDecimals = quoteRead?.decimals?.[sellMint] ?? assetCatalog[sellMint]?.decimals;
  const currentAmount = currentDecimals == null ? null : parseHumanAmount(amount, currentDecimals);
  const currentInput = { inputMint: sellMint, outputMint: buyMint, amountRaw: currentAmount?.ok ? currentAmount.raw : null };
  // Reject mismatched data during render, before effects can run after an edit.
  const quote = swapQuoteMatches(quoteRead?.order, currentInput) ? quoteRead : null;
  const [search, setSearch] = useState("");
  const [searchRows, setSearchRows] = useState<readonly TokenRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [phase, setPhase] = useState<Phase>("IDLE");
  const [actionFailure, setActionFailure] = useState<Failure | null>(null);
  const [preparedRead, setPrepared] = useState<OrderResponse | null>(null);
  const prepared = preparedRead?.order.taker === connection?.address && swapQuoteMatches(preparedRead?.order, currentInput) ? preparedRead : null;
  const [reviewInvalidated, setReviewInvalidated] = useState(false);
  const [attempt, setAttempt] = useState<SwapClientAttempt | null>(null);
  const [lockedReview, setLockedReview] = useState<Readonly<{ owner: string; requestId: string }> | null>(null);
  /* Set when a wallet handed back a transaction that is not the reviewed one.
     The Review is spent from that moment: the same bytes fail the same way
     forever, so the card must offer a fresh order rather than the same button. */
  const [bytesChanged, setBytesChanged] = useState(false);
  const [settled, setSettled] = useState<ExecuteResponse | null>(null);
  const [settledOwner, setSettledOwner] = useState<string | null>(null);
  /* The pair as it was when the signature landed. The settled card used to
     read the *current* legs, so a flip after a swap relabelled a finished
     trade with the other pair's symbols and decimals. */
  const [settledPair, setSettledPair] = useState<Readonly<{ sell: { code: string; decimals: number }; buy: { code: string; decimals: number } }> | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [reviewSecondsLeft, setReviewSecondsLeft] = useState<number | null>(null);
  const [refreshTicket, setRefreshTicket] = useState(0);
  const quoteTicket = useRef(0);
  const searchTicket = useRef(0);
  /** Mints this card has already asked the catalogue about. See the effect below. */
  const attemptedMints = useRef<Set<string>>(new Set());
  /* Consecutive automatic refreshes that produced another dead quote. */
  const chasedQuotes = useRef(0);
  const actionTicket = useRef(0);
  const sellButtonRef = useRef<HTMLButtonElement>(null);
  const buyButtonRef = useRef<HTMLButtonElement>(null);
  const pickerDialogRef = useRef<HTMLDivElement>(null);

  const sell = describeToken(sellMint, assetCatalog);
  const buy = describeToken(buyMint, assetCatalog);
  /* Read at settle time, not at render time — see `settledPair`. */
  const pairRef = useRef({ sellCode: sell.code, buyCode: buy.code, sellDecimals: 0, buyDecimals: 0 });

  const recordSettlement = useCallback((result: ExecuteResponse, owner: string) => {
    setSettledOwner(owner);
    setSettled(result);
    setSettledPair({
      sell: { code: pairRef.current.sellCode, decimals: pairRef.current.sellDecimals },
      buy: { code: pairRef.current.buyCode, decimals: pairRef.current.buyDecimals },
    });
    /* Money moved: the balances on screen are now the old ones. Read them
       again a moment later and once more for a public RPC that lags. */
    if (result.observation) {
      for (const delay of HOLDINGS_AFTER_FILL_DELAYS_MS) {
        window.setTimeout(() => setHoldingsGeneration((current) => current + 1), delay);
      }
    }
  }, []);

  const holdingFor = useCallback(
    (mint: string): Holding | null => {
      if (mint === WRAPPED_SOL_MINT) {
        return holdings.find((entry) => entry.kind === "NATIVE_SOL") ?? holdings.find((entry) => entry.mint === mint) ?? null;
      }
      return holdings.find((entry) => entry.mint === mint) ?? null;
    },
    [holdings],
  );
  const sellHolding = holdingFor(sellMint);
  const balanceKnown = sellHolding !== null || (holdingsRead?.owner === connection?.address && holdingsRead?.tokenRead === "COMPLETE");
  const insufficientBalance = balanceKnown && currentInput.amountRaw !== null &&
    BigInt(currentInput.amountRaw) > BigInt(sellHolding?.spendableRaw ?? "0");

  /*
   * A wallet that cannot pay for the trade it is about to ask for.
   *
   * Every Solana transaction is paid for in SOL, whatever it trades. Selling
   * a token with no lamports left therefore fails — correctly — but it failed
   * *late*, as the provider's generic `This wallet does not hold enough for
   * this swap.` on a screen showing a perfectly sufficient token balance. The
   * person is told they are short of the thing they have plenty of.
   *
   * Selling SOL itself needs no separate check: `spendableRaw` already
   * withholds the reserve, so the amount field cannot exceed what is
   * signable. This is only the other case, and it is named before Review
   * rather than after a refusal.
   */
  const nativeHolding = holdingFor(WRAPPED_SOL_MINT);
  const cannotPayNetworkFee =
    sellMint !== WRAPPED_SOL_MINT &&
    nativeHolding !== null &&
    BigInt(nativeHolding.spendableRaw) === 0n;

  /* Decimals, from the most authoritative source that has answered: the
     server-built quote, then the catalogue, then this wallet's own holding.
     `null` means nobody has answered yet, and nothing is quoted until they do. */
  const decimalsOf = useCallback(
    (mint: string): number | null =>
      quote?.decimals?.[mint] ?? assetCatalog[mint]?.decimals ?? holdingFor(mint)?.decimals ?? null,
    [holdingFor, assetCatalog, quote],
  );
  const sellDecimalsKnown = decimalsOf(sellMint);
  const buyDecimalsKnown = decimalsOf(buyMint);
  const sellDecimals = sellDecimalsKnown ?? 0;
  const buyDecimals = buyDecimalsKnown ?? 0;
  const legsResolved = sellDecimalsKnown !== null && buyDecimalsKnown !== null;
  pairRef.current = { sellCode: sell.code, buyCode: buy.code, sellDecimals, buyDecimals };

  useEffect(() => {
    setAttempt(parseSwapClientAttempt(window.sessionStorage.getItem(ATTEMPT_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    if (!settled?.receipt) return;
    storeBoundSolanaReceipt(
      window.localStorage,
      settledOwner,
      settledOwner,
      settled.receipt,
    );
  }, [settled?.receipt, settledOwner]);

  useEffect(() => {
    if (!connection?.address || settledOwner === null || settledOwner === connection.address) return;
    setSettled(null);
    setSettledOwner(null);
  }, [connection?.address, settledOwner]);

  const rememberAttempt = useCallback((record: SwapClientAttempt) => {
    window.sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(record));
    setAttempt(record);
  }, []);

  /**
   * Let go of an attempt the server has already resolved.
   *
   * This record is the reason a signed swap can never be silently repeated,
   * and it was written and never removed — so the first swap of a browser tab
   * was the last one. A completed, receipted swap left the only button reading
   * "Signed attempt recorded" and disabled, and `sessionStorage` survives a
   * reload, so the only way out was closing the tab.
   *
   * Only a RESOLVED attempt is forgotten. `SIGNED_NOT_SENT` and
   * `SUBMITTED_UNKNOWN` are exactly the states where money may have moved
   * without an answer, and they stay until an independent read resolves them.
   * The settled Receipt panel is separate state and stays on screen.
   */
  const forgetAttempt = useCallback(() => {
    window.sessionStorage.removeItem(ATTEMPT_STORAGE_KEY);
    setAttempt(null);
  }, []);

  /* Clear obsolete balances before reading; a failed read must never leave
     another wallet's spendable amount or MAX available. Re-read on demand —
     after a fill, or by hand — through `holdingsGeneration`, and read again
     on its own while the answer is partial. Until 2026-09-12 this read once
     per connection and kept whatever came back: a swap left the old balance
     on screen, MAX filled an amount the wallet no longer had, and Review
     answered "would not build"; a partial answer left USDC off the card. */
  useEffect(() => {
    setHoldingsFailed(false);
    if (!connection) {
      setHoldingsRead(null);
      return;
    }
    const controller = new AbortController();
    const owner = connection.address;
    /* A refresh keeps the last rows on screen while the new ones arrive; a
       new wallet starts from nothing. */
    setHoldingsRead((current) => (current?.owner === owner ? current : null));
    void readWalletHoldingsUntilComplete<Holding>({
      owner,
      network: NETWORK,
      signal: controller.signal,
      onRead: (read) => {
        if (controller.signal.aborted) return;
        if (!read.ok) {
          setHoldingsFailed(true);
          setHoldingsRead(null);
          return;
        }
        setHoldingsRead({ owner, rows: read.rows, tokenRead: read.tokenRead });
      },
    });
    return () => controller.abort();
  }, [connection, holdingsGeneration]);

  /* Both legs must be named before either can be quoted. A mint arriving from
     a shared link has no decimals on this page yet, and a quote built on
     guessed decimals is a different trade wearing the right numbers. */
  useEffect(() => {
    /**
     * Ask once per mint, never again.
     *
     * The catalogue can answer with a row whose `decimals` is null — it does
     * not know them either — and that answer used to feed a loop: the row went
     * into `known`, `known` is a dependency, the effect re-ran, the mint was
     * still missing its decimals, and it asked again. Forever, at a request
     * apiece, until the shared rate limiter ran out and the *quote* started
     * returning 429. A person watching that saw a swap card that would not
     * price anything and blamed the venue.
     *
     * The ref is the fix rather than dropping the `known` dependency, because
     * the effect genuinely does need to re-run when a leg changes — it is
     * asking again that must stop, not noticing.
     */
    const missing = [sellMint, buyMint].filter(
      (mint) =>
        (known[mint]?.decimals === undefined || known[mint]?.decimals === null) &&
        !attemptedMints.current.has(mint),
    );
    if (missing.length === 0) return;
    const attempted = attemptedMints.current;
    for (const mint of missing) attempted.add(mint);
    let live = true;
    let completed = false;
    const controller = new AbortController();
    void (async () => {
      const found: Record<string, TokenRow> = {};
      for (const mint of missing) {
        const response = await post<{ tokens?: readonly TokenRow[] }>("/api/solana/tokens/search", { query: mint, limit: 5 }, controller.signal);
        if (!live) return;
        if (!response.ok) continue;
        for (const row of response.value.tokens ?? []) found[row.mint] = row;
      }

      /* The catalogue is allowed not to know: its `decimals` is nullable, and
         when it came back null this leg had nowhere else to ask. The mint was
         already marked attempted so it would not loop, and the pair then sat on
         "Reading both assets…" forever — a real token with a real route, never
         quoted, because a third-party list had a gap.

         The chain has no gap. `decimals` is a byte in the mint account and the
         owning program is the account's owner. Asked only for what the
         catalogue could not answer, so an ordinary pair still costs one call. */
      for (const mint of missing) {
        const catalogued = found[mint]?.decimals;
        if (catalogued !== undefined && catalogued !== null) continue;
        const onchain = await post<{ mint: string; decimals: number; tokenProgram: string }>(
          "/api/solana/tokens/mint",
          { mint, network: "mainnet" },
          controller.signal,
        );
        if (!live) return;
        if (!onchain.ok) continue;
        const catalogRow = found[mint] ?? null;
        found[mint] = {
          mint,
          symbol: catalogRow?.symbol ?? null,
          name: catalogRow?.name ?? null,
          decimals: onchain.value.decimals,
          tokenProgram: onchain.value.tokenProgram,
          isVerified: catalogRow?.isVerified ?? null,
          isSuspicious: catalogRow?.isSuspicious ?? false,
          usdPrice: catalogRow?.usdPrice ?? null,
        };
      }
      if (!live) return;
      completed = true;
      if (Object.keys(found).length === 0) return;
      /* A fresher answer wins over a cached one that lacked decimals — the old
         order kept the useless row and discarded the useful one. */
      setKnown((current) => {
        const next = { ...current };
        for (const [mint, row] of Object.entries(found)) {
          if (next[mint]?.decimals === undefined || next[mint]?.decimals === null) next[mint] = row;
        }
        return next;
      });
    })();
    return () => {
      live = false;
      controller.abort();
      // An interrupted lookup is not a completed attempt (pair changes / Strict Mode).
      if (!completed) for (const mint of missing) attempted.delete(mint);
    };
  }, [buyMint, known, sellMint]);

  /* The picker's own search. Debounced for the same reason the quote is. */
  useEffect(() => {
    const my = ++searchTicket.current;
    if (!picker) {
      setSearching(false);
      return;
    }
    const query = search.trim();
    if (query.length === 0) {
      setSearchRows(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchRows(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        const response = await post<{ tokens?: readonly TokenRow[] }>("/api/solana/tokens/search", { query, limit: 24 });
        if (searchTicket.current !== my) return;
        setSearching(false);
        setSearchRows(response.ok ? response.value.tokens ?? [] : []);
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [picker, search]);

  useEffect(() => {
    if (!picker) return;
    const trigger = picker === "sell" ? sellButtonRef.current : buyButtonRef.current;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPicker(null);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = pickerDialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus();
      });
    };
  }, [picker]);

  /* One quote per settled amount. A swap that re-quotes on every keystroke
     burns the venue's rate limit and shows numbers nobody asked for. */
  useEffect(() => {
    const my = ++quoteTicket.current;
    setQuoting(false);
    setQuote(null);
    setQuoteFailure(null);
    if (sellMint === buyMint) {
      setQuote(null);
      setQuoteFailure({ code: "SAME_MINT", message: text("The two sides are the same asset.") });
      return;
    }
    if (!legsResolved) {
      setQuote(null);
      setQuoteFailure(null);
      return;
    }
    const parsed = parseHumanAmount(amount, sellDecimals);
    if (!parsed.ok) {
      setQuote(null);
      setQuoteFailure(null);
      return;
    }
    const controller = new AbortController();
    setQuoting(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        const response = await post<QuoteResponse>("/api/solana/swap/quote", {
          inputMint: sellMint,
          outputMint: buyMint,
          amountRaw: parsed.raw,
          access: "production",
        }, controller.signal);
        if (controller.signal.aborted || quoteTicket.current !== my) return;
        setQuoting(false);
        if (!response.ok) {
          setQuote(null);
          setQuoteFailure(response.failure);
          return;
        }
        setQuoteFailure(null);
        setQuote(response.value);
      })();
    }, QUOTE_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [amount, buyMint, legsResolved, refreshTicket, sellDecimals, sellMint, text]);

  /* A prepared order is exact to this wallet, pair and amount. Editing any of
     them cancels the in-flight request and removes the Review before a wallet
     can see stale bytes. */
  useEffect(() => {
    actionTicket.current += 1;
    setPrepared(null);
    setActionFailure(null);
    setReviewInvalidated(false);
    setReviewSecondsLeft(null);
    setBytesChanged(false);
    setPhase((current) => (current === "REVIEW" || current === "PREPARING" ? "IDLE" : current));
  }, [amount, buyMint, connection?.address, sellMint]);

  /* The address bar is the artifact: the pair and amount on screen are the
     pair and amount in the URL, so a copied link asks the same question and
     gets its own fresh quote. `replaceState` rather than a navigation - this
     is the same page, not a new one. */
  useEffect(() => {
    /* The unified surface writes its own address bar. */
    if (embedded) return;
    const url = new URL(window.location.href);
    url.searchParams.set("in", sellMint);
    url.searchParams.set("out", buyMint);
    /* An empty field is not the amount zero and must not become `amount=`.
       A copied link then asks the same question the screen is asking. */
    if (amount) url.searchParams.set("amount", amount);
    else url.searchParams.delete("amount");
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
  }, [amount, buyMint, sellMint, embedded]);

  useEffect(() => {
    if (!quote) {
      setSecondsLeft(null);
      return;
    }
    const update = () => setSecondsLeft(Math.max(0, Math.floor((Date.parse(quote.expiresAt) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [quote]);

  useEffect(() => {
    if (!prepared) {
      setReviewSecondsLeft(null);
      return;
    }
    const update = () => setReviewSecondsLeft(
      Math.max(0, Math.floor((Date.parse(prepared.expiresAt) - Date.now()) / 1_000)),
    );
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [prepared]);

  /**
   * A price that has expired is refreshed rather than left on screen.
   *
   * The card used to hold the dead number and put *Get a new quote* under it,
   * so the one thing a person could read was the one thing that was no longer
   * true, and the only way out was to notice and press. A quote is a read, it
   * sits on the read budget rather than the action one, and nothing here can
   * move money — so asking again is simply what the screen should do.
   *
   * Four conditions, and each is a way this could go wrong. A Review in
   * progress is not refreshed, because a person reading exact bytes must not
   * have them replaced underneath. A hidden tab is not refreshed, because a
   * background card burning sixty reads a minute is how a budget meant to
   * protect the action path gets spent by nobody. And it stops chasing: if
   * three refreshes in a row come back already expired, the venue is answering
   * slower than its own window and pressing on would be a loop, so it hands the
   * decision back to the person and the manual control stays exactly where it
   * was.
   */
  useEffect(() => {
    /* A fresh price resets the chase: the venue answered inside its own window,
       so the next expiry starts from zero again. */
    if (secondsLeft !== null && secondsLeft > 0) chasedQuotes.current = 0;
    const refresh = shouldAutoRefreshQuote({
      hasQuote: quote !== null,
      secondsLeft,
      reviewOpen: prepared !== null,
      attemptOpen: attempt !== null,
      /* `phase` rather than the `busy` alias, which is derived further down the
         file than this effect can see. */
      phase,
      documentVisible: typeof document === "undefined" || document.visibilityState === "visible",
      quoting,
      chased: chasedQuotes.current,
    });
    if (!refresh) return;
    chasedQuotes.current += 1;
    setRefreshTicket((ticket) => ticket + 1);
  }, [attempt, phase, prepared, quote, quoting, secondsLeft]);

  const verdict = quote?.verdict ?? null;
  /* The asset's verdict outlives the estimate's own refresh: a blocked pair
     stays «Unavailable for this asset» while the next estimate for the same
     amount is asked, never flickering to «Review swap» in between; another
     amount is judged afresh. */
  const [blockedPair, setBlockedPair] = useState<string | null>(null);
  useEffect(() => {
    if (quote) setBlockedPair(quote.verdict?.verdict === "BLOCKED" ? `${quote.order.inputMint}:${quote.order.outputMint}:${quote.order.inAmountRaw}` : null);
  }, [quote]);
  const blocked = quote ? verdict?.verdict === "BLOCKED" : blockedPair === `${sellMint}:${buyMint}:${currentInput.amountRaw}`;

  const flip = useCallback(() => {
    setSellMint(buyMint);
    setBuyMint(sellMint);
    setAmount(quote ? plainAmount(quote.order.outAmountRaw, buyDecimals) : "");
  }, [buyDecimals, buyMint, quote, sellMint]);

  /**
   * Fill the sell leg from the spendable balance.
   *
   * The share is taken on the raw integer, never on the displayed decimal, so
   * no rounding is introduced before the quote sees the amount. MAX passes the
   * spendable figure through untouched — the route already withholds rent and
   * the fee buffer, so the largest offered amount stays the largest signable
   * one.
   */
  const fillShare = useCallback(
    (numerator: bigint, denominator: bigint) => {
      if (!sellHolding) return;
      const spendable = BigInt(sellHolding.spendableRaw);
      const share = denominator === 1n ? spendable : (spendable * numerator) / denominator;
      setAmount(plainAmount(share.toString(), sellHolding.decimals));
    },
    [sellHolding],
  );

  const fillMax = useCallback(() => fillShare(1n, 1n), [fillShare]);

  const choose = useCallback(
    (row: TokenRow) => {
      setKnown((current) => ({
        ...current,
        [row.mint]: { ...row, decimals: row.decimals ?? current[row.mint]?.decimals ?? null },
      }));
      if (picker === "sell") setSellMint(row.mint);
      else setBuyMint(row.mint);
      if (picker === "sell" && row.mint !== sellMint) setAmount("");
      setPicker(null);
    },
    [picker, sellMint],
  );

  const pickerRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return candidateRows;
    const found = { ...known, ...Object.fromEntries((searchRows ?? []).map(row => [row.mint, row])) };
    const remoteMints = new Set((searchRows ?? []).map(row => row.mint));
    return buildSwapAssetRows(holdings, found, TOKENS).filter(row => remoteMints.has(row.mint) ||
      [row.mint, row.symbol, row.name].some(value => value?.toLowerCase().includes(query)));
  }, [candidateRows, holdings, known, search, searchRows]);

  useEffect(() => {
    if (picker) return;
    setSearch("");
    setSearchRows(null);
    setSearching(false);
  }, [picker]);

  /* «Перевірка» asks the order route for its own fresh order on the amount in
     the field now — the estimate above need not be fresh, nor settled from the
     typing (2026-10-11: the first press is the one that works). */
  const requestExactReview = useCallback(async () => {
    if (!connection || attempt) return;
    const my = ++actionTicket.current;
    setActionFailure(null);
    setPrepared(null);
    setPhase("PREPARING");

    const parsed = parseHumanAmount(amount, sellDecimals);
    if (!parsed.ok) {
      setActionFailure({ code: "AMOUNT_INVALID", message: parsed.reason });
      setPhase("IDLE");
      return;
    }

    /* Quote A is discovery only. This asks for executable order B and stops in
       REVIEW; no wallet is opened by the same user action. */
    const ordered = await post<OrderResponse>("/api/solana/swap/order", {
      input: { inputMint: sellMint, outputMint: buyMint, amountRaw: parsed.raw, taker: connection.address },
    });
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
    setPrepared(ordered.value);
    setReviewInvalidated(false);
    setLockedReview(null);
    setPhase("REVIEW");
  }, [amount, attempt, buyMint, connection, rememberAttempt, sellDecimals, sellMint]);

  const signReviewedOrder = useCallback(async () => {
    if (!connection || !prepared || attempt) return;
    const readiness = assessSwapClientReview({
      invalidated: reviewInvalidated || bytesChanged,
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
    /*
     * A wallet that never answers used to freeze the card: nothing bounded the
     * prompt, so the button stayed "Waiting for the wallet…" until the tab was
     * closed. The bound is not an arbitrary timeout — it is the Review's own
     * window, because a signature that arrives after it cannot be executed
     * anyway. A short grace is added so a wallet answering on the last second
     * still wins the race rather than being thrown away.
     */
    const signingDeadlineMs = Math.max(0, Date.parse(prepared.expiresAt) - Date.now()) + 5_000;
    const signed = await Promise.race([
      signTransaction({
        wallet: connection.wallet,
        address: connection.address,
        unsignedWireBase64: prepared.order.transactionBase64,
        chain: "solana:mainnet",
      }),
      new Promise<Awaited<ReturnType<typeof signTransaction>>>((resolve) =>
        window.setTimeout(
          () =>
            resolve({
              ok: false,
              reason: text(
                "Your wallet did not answer before this Review's window closed. Nothing was signed or sent; ask for a fresh order.",
              ),
            }),
          signingDeadlineMs,
        ),
      ),
    ]);
    if (actionTicket.current !== my) return;
    if (!signed.ok) {
      setActionFailure({ code: "WALLET_REFUSED", message: signed.reason });
      setPhase("REVIEW");
      return;
    }

    const returned = await inspectJupiterSwapTransaction({
      wireBase64: signed.signedWireBase64,
      expectedTaker: connection.address,
    });
    if (actionTicket.current !== my) return;
    /*
     * A wallet is allowed to be a wallet.
     *
     * Wallet Standard models browser signers as transaction-MODIFYING, and the
     * one this product is used with re-prices the compute budget and attaches
     * its own guard assertions before signing. Demanding byte equality made
     * every swap fail after the approval. The same comparator the Send path
     * has used since M1B decides: every business instruction, account role,
     * signer, blockhash and lookup table identical, and only a bounded compute
     * budget and canonical guards added. Anything else is still refused.
     */
    const adoption = assessSwapWalletAdoption({
      reviewedWireBase64: prepared.order.transactionBase64,
      signedWireBase64: signed.signedWireBase64,
    });
    if (!adoption.ok) {
      setActionFailure({ code: adoption.code, message: adoption.reason });
      setBytesChanged(true);
      setPhase("REVIEW");
      return;
    }

    if (!returned.ok) {
      /* The adopted bytes must still decode and pass the same pre-sign
         firewall the reviewed ones did; the server re-runs it too. */
      setActionFailure({ code: `SIGNED_${returned.code}`, message: returned.reason });
      setBytesChanged(true);
      setPhase("REVIEW");
      return;
    }

    const signature = readSwapClientSignature({
      signedWireBase64: signed.signedWireBase64,
      expectedTaker: connection.address,
    });
    if (!signature) {
      setActionFailure({
        code: "SIGNATURE_UNREADABLE",
        message: text("The wallet signature could not be recorded. Nothing was submitted."),
      });
      setPhase("REVIEW");
      return;
    }

    /*
     * A wallet takes as long as the person does, and the Review window runs
     * the whole time. If it closed while the wallet was open, `../execute`
     * refuses with ORDER_EXPIRED *before* it claims the signature — so the
     * server never learns this signature exists, and recovering by it can
     * only ever answer OWNER_SWAP_LOCK_MISMATCH. Persisting an attempt here
     * would trade a clean "too slow, try again" for a permanent dead end.
     * Check the window against the same predicate the server will use.
     */
    const stillFresh = assessSwapClientReview({
      verdict: prepared.policy.verdict,
      proofStatus: prepared.proof.status,
      simulationStatus: prepared.simulation.status,
      ownerEffectsStatus: prepared.simulation.ownerEffects?.status ?? "MISSING",
      expiresAt: prepared.expiresAt,
    });
    if (!stillFresh.ready) {
      setActionFailure({
        code: stillFresh.code,
        message: text(
          "The Review window closed while your wallet was open. That signature was never sent and cannot be — ask for a fresh order and sign that one.",
        ),
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
    /* Persist before fetch: after this line every missing or malformed answer
       is SUBMITTED_UNKNOWN for this signature, never a new order. */
    rememberAttempt(pending);
    setPhase("EXECUTING");
    const executed = await post<ExecuteResponse>("/api/solana/swap/execute", {
      bundle: prepared.bundle,
      proof: prepared.proof,
      signedTransactionBase64: signed.signedWireBase64,
      /* So the server can compare against the same reviewed bytes rather than
         take the browser's word for what changed. It checks their hash against
         the issuer-signed bundle before using them. */
      reviewedTransactionBase64: prepared.order.transactionBase64,
    });
    if (!executed.ok) {
      /* The server refused before it claimed the signature, so the network
         never saw these bytes. Keeping the attempt would lock this wallet
         behind a recovery that can only ever answer "I never heard of it". */
      if (executed.failure.submitBoundary === "NOT_CROSSED") {
        forgetAttempt();
        setReviewInvalidated(true);
        refreshHoldings();
        setActionFailure(executed.failure);
        setPhase("REVIEW");
        return;
      }
      /* The chain answered: the bytes landed and failed, only the network fee
         moved, and the server has released the wallet. That is an outcome,
         not an unknown — reading it as one told the person never to trade
         again. Should the server's release not have stuck, the next order
         hands this signature back and the recovery read settles it. */
      if (executed.failure.code === "LANDED_FAILED") {
        forgetAttempt();
        setPrepared(null);
        recordSettlement({
          state: "FAILED",
          signature,
          observation: null,
          facts: null,
          factsRefusal: null,
          receipt: null,
        }, connection.address);
        refreshHoldings();
        setPhase("SETTLED");
        return;
      }
      const unknown = transitionSwapClientAttempt(pending, { kind: "FAILURE" });
      rememberAttempt(unknown);
      setActionFailure(executed.failure);
      recordSettlement({
        state: "SUBMITTED_UNKNOWN",
        signature,
        observation: null,
        facts: null,
        factsRefusal: null,
        receipt: null,
        recovery: text("The execute answer is unknown. Recover only by this signature; never request or sign another order."),
      }, connection.address);
      setPhase("RECOVERY");
      return;
    }
    const recorded = transitionSwapClientAttempt(pending, {
      kind: "SUCCESS",
      serverState: executed.value.state,
    });
    /* The server resolved it. The Receipt below is the record now, and holding
       the attempt lock past that point is what made one swap per tab the
       ceiling. An unresolved attempt is kept, because that is the case the
       lock exists for. */
    if (recorded.state === "SETTLED") forgetAttempt();
    else rememberAttempt(recorded);
    setPrepared(null);
    recordSettlement(executed.value, connection.address);
    if (recorded.state !== "SUBMITTED_UNKNOWN") setAmount("");
    setPhase(
      recorded.state === "SUBMITTED_UNKNOWN" ? "RECOVERY" : "SETTLED",
    );
  }, [attempt, bytesChanged, connection, forgetAttempt, prepared, recordSettlement, refreshHoldings, rememberAttempt, reviewInvalidated, text]);

  /**
   * Read one recorded signature until the chain gives a real answer.
   *
   * A signature whose blockhash is still alive is genuinely unresolved, and
   * the honest reply is "not yet". Making a person press a button to hear it
   * again — over and over, for the minute or so a blockhash lives — is not
   * caution, it is the product refusing to wait on their behalf. This waits,
   * bounded, and stops the moment the answer is real.
   *
   * SIGNED_NOT_SENT is included, because that is exactly the state where the
   * browser died between the signature and the answer. `/recover` submits
   * nothing; it reads.
   */
  const recoverAttempt = useCallback(async () => {
    if (!attempt || attempt.state === "SETTLED") return;
    const my = ++actionTicket.current;
    setActionFailure(null);
    setPhase("RECOVERING");
    const deadline = Date.now() + RECOVERY_DEADLINE_MS;

    for (;;) {
      const recovered = await post<RecoveryResponse>("/api/solana/swap/recover", {
        signature: attempt.signature,
        owner: attempt.taker,
        requestId: attempt.requestId,
      });
      if (actionTicket.current !== my) return;
      if (!recovered.ok) {
        setActionFailure(recovered.failure);
        setPhase("RECOVERY");
        return;
      }

      if (recovered.value.state === "UNKNOWN_TO_CHAIN") {
        /* Nothing was ever submitted under it. Let it go and let the person
           trade again — holding it would be caution about a fact, not a risk. */
        forgetAttempt();
        setActionFailure({ code: recovered.value.state, message: recovered.value.reason ?? "" });
        setPhase("IDLE");
        return;
      }
      if (recovered.value.state === "SEEN_WITHOUT_RECORD") {
        recordSettlement({
          state: recovered.value.state,
          signature: recovered.value.signature,
          observation: null,
          facts: null,
          factsRefusal: null,
          receipt: null,
          recovery: text("The network has seen this transaction, but its receipt is unavailable. Check the explorer."),
        }, attempt.taker);
        setPhase("RECOVERY");
        return;
      }
      if (recovered.value.state === "PENDING") {
        recordSettlement({
          state: "RECOVERY_PENDING",
          signature: attempt.signature,
          observation: null,
          facts: null,
          factsRefusal: null,
          receipt: null,
          recovery: text("The outcome is not yet known. Keep checking this transaction; do not send another."),
        }, attempt.taker);
        if (Date.now() >= deadline) {
          setPhase("RECOVERY");
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, RECOVERY_INTERVAL_MS));
        if (actionTicket.current !== my) return;
        continue;
      }

      const resolvedAttempt = transitionSwapClientAttempt(attempt, {
        kind: "SUCCESS",
        serverState: recovered.value.state,
      });
      /* An independent read answered. Whatever it said — receipted, failed, or
         expired before submit — the signature is no longer unresolved, so the
         lock it held is released and the card can be used again. */
      if (resolvedAttempt.state === "SETTLED") forgetAttempt();
      else rememberAttempt(resolvedAttempt);
      setPrepared(null);
      recordSettlement({
        state: recovered.value.state,
        signature: recovered.value.signature,
        observation: recovered.value.observation ?? null,
        facts: recovered.value.facts ?? null,
        factsRefusal:
          recovered.value.state === "ALREADY_RECEIPTED"
            ? text("The durable ledger already records this Receipt hash; no transaction was submitted again.")
            : null,
        receipt: recovered.value.receipt ?? null,
        recovery: recovered.value.reason ?? nothingHappenedCopy(recovered.value.state, text),
      }, attempt.taker);
      setAmount("");
      setPhase("SETTLED");
      return;
    }
  }, [attempt, forgetAttempt, recordSettlement, rememberAttempt, text]);

  /**
   * Start over after a wallet returned bytes that are not the reviewed ones.
   *
   * The signed transaction exists — the person really did approve something —
   * so a second Review cannot be handed out while the first one's blockhash
   * could still carry it. That is the rule `cancel-review` enforces against an
   * independent operator, and the honest answer when it says the blockhash is
   * still live is a wait with a reason, not a refusal. The wait is bounded by
   * the blockhash itself, so this retries rather than stranding.
   */
  const startOverAfterBytesChanged = useCallback(async () => {
    if (!connection || !prepared || attempt) return;
    const my = ++actionTicket.current;
    setActionFailure(null);
    setPhase("PREPARING");
    const cancelled = await post<{ state: "EXPIRED_BEFORE_SUBMIT" }>(
      "/api/solana/swap/cancel-review",
      { owner: connection.address, requestId: prepared.order.requestId },
    );
    if (actionTicket.current !== my) return;
    if (!cancelled.ok) {
      if (cancelled.failure.code === "BLOCKHASH_STILL_VALID") {
        setActionFailure({
          code: cancelled.failure.code,
          message: text(
            "The transaction you approved can still reach the chain, so a second one cannot be prepared yet. This clears itself when the blockhash expires — try again in a moment.",
          ),
        });
      } else {
        setActionFailure(cancelled.failure);
      }
      setPhase("REVIEW");
      return;
    }
    setBytesChanged(false);
    setPrepared(null);
    setLockedReview(null);
    setPhase("IDLE");
    await requestExactReview();
  }, [attempt, connection, prepared, requestExactReview, text]);

  const cancelIssuedReview = useCallback(async () => {
    const owner = lockedReview?.owner ?? connection?.address ?? null;
    const requestId = lockedReview?.requestId ?? prepared?.order.requestId ?? null;
    if (!owner || !requestId || attempt) return;
    setActionFailure(null);
    setPhase("PREPARING");
    const cancelled = await post<{ state: "EXPIRED_BEFORE_SUBMIT" }>(
      "/api/solana/swap/cancel-review",
      { owner, requestId },
    );
    if (!cancelled.ok) {
      setActionFailure(cancelled.failure);
      setPhase("REVIEW");
      return;
    }
    setPrepared(null);
    setLockedReview(null);
    setBytesChanged(false);
    setPhase("IDLE");
    /* Clearing a spent Review is never the thing the person wanted; it is the
       step in front of it. Whether the lock came from this card or another
       tab, the next thing they need is an order they can sign. */
    await requestExactReview();
  }, [attempt, connection?.address, lockedReview, prepared, requestExactReview]);

  const busy = phase === "PREPARING" || phase === "SIGNING" || phase === "EXECUTING" || phase === "RECOVERING";
  const amountParsed = parseHumanAmount(amount, sellDecimals).ok;

  /** After a settled swap: the same pair, an empty amount, fresh balances. */
  const newSwap = useCallback(() => {
    setSettled(null);
    setSettledOwner(null);
    setSettledPair(null);
    setActionFailure(null);
    setQuote(null);
    setAmount("");
    setPhase("IDLE");
    refreshHoldings();
  }, [refreshHoldings]);

  /* The settled answer in the person's words; the ledger's state stays in the
     Receipt. Same classifier Spot uses. */
  const settledOutcome = settled ? classifySpotFill(settled) : null;
  const settledSell = settledPair?.sell ?? { code: sell.code, decimals: sellDecimals };
  const settledBuy = settledPair?.buy ?? { code: buy.code, decimals: buyDecimals };
  const settledIn = settled?.observation ? Number(plainAmount(settled.observation.actualInputRaw, settledSell.decimals)) : null;
  const settledOut = settled?.observation ? Number(plainAmount(settled.observation.actualOutputRaw, settledBuy.decimals)) : null;
  const settledRate = achievedPrice(settledIn, settledOut);
  const settledFee = settled?.facts?.fees?.serviceFee ?? null;
  const settledTone = settledOutcome === null ? "caution" : settledOutcome.kind === "FILLED" && settledOutcome.note === null ? "matched" : settledOutcome.kind === "NOT_FILLED" ? "risk" : settledOutcome.kind === "NOTHING_HAPPENED" ? "quiet" : "caution";
  const settledHeadline = (() => {
    if (!settledOutcome) return text("Finished with a note");
    switch (settledOutcome.kind) {
      case "FILLED":
        return settledOutcome.note === null ? text("Swapped") : text("Filled, with a note");
      case "NOTHING_HAPPENED":
        return text("Nothing happened");
      case "NOT_FILLED":
        return text("Not filled");
      default:
        return text("Finished with a note");
    }
  })();
  const settledSentence = (() => {
    if (!settledOutcome || !settled) return null;
    switch (settledOutcome.kind) {
      case "FILLED":
        if (settledOutcome.note === "BELOW_MINIMUM") return text("Less arrived than the reviewed minimum. The receipt keeps the reviewed and the settled figures side by side.");
        if (settledOutcome.note === "NOT_AS_REVIEWED") return text("The chain's figures differ from the Review. The receipt keeps both.");
        if (settledIn === null) return text("Landed and receipted earlier. The receipt holds the amounts.");
        return null;
      case "NOTHING_HAPPENED":
        return nothingHappenedCopy(settledOutcome.state, text) ?? settled.recovery ?? null;
      case "NOT_FILLED":
        return text("The network rejected the transaction. Only the network fee was spent; what you were spending did not move.");
      default:
        return settled.recovery ?? null;
    }
  })();
  const preparedReadiness = prepared
    ? assessSwapClientReview({
        invalidated: reviewInvalidated || bytesChanged,
        verdict: prepared.policy.verdict,
        proofStatus: prepared.proof.status,
        simulationStatus: prepared.simulation.status,
        ownerEffectsStatus: prepared.simulation.ownerEffects?.status ?? "MISSING",
        expiresAt: prepared.expiresAt,
      })
    : null;

  const estimatedNetworkFeeSol = prepared
    ? (
        Number(
          BigInt(prepared.order.signatureFeeLamports) +
            BigInt(prepared.order.priorityFeeLamports),
        ) / 1e9
      ).toFixed(6)
    : "0";
  const accountReserveSol = prepared
    ? (Number(BigInt(prepared.order.rentFeeLamports)) / 1e9).toFixed(6)
    : "0";
  /* The rate and the amount: exact where the fee is known before the swap
     (`/build` takes it from what the person typed), else `≈` a share of the
     side it is taken from — the settled card then states the chain's figure.
     A route with no fee reads `0.00%`, not a blank. */
  const reviewServiceFee = prepared ? ryntraServiceFee(prepared.order) : null;
  const reviewServiceFeeText =
    prepared && reviewServiceFee
      ? serviceFeeReviewText(
          reviewServiceFee,
          { inputMint: prepared.order.inputMint, outputMint: prepared.order.outputMint, inputRaw: prepared.order.inAmountRaw, quotedOutputRaw: prepared.order.outAmountRaw },
          { [sellMint]: { decimals: sellDecimalsKnown, code: sell.code }, [buyMint]: { decimals: buyDecimalsKnown, code: buy.code } },
          { none: "0.00%", usd: { input: Number(prepared.order.inUsdValue) || null, output: Number(prepared.order.outUsdValue) || null } },
        )
      : "0.00%";
  const reviewHeading = preparedReadiness?.ready ? text("Ready to sign") : text("Review needs refreshing");
  const reviewWarnings = prepared
    ? prepared.policy.verdict.findings.filter((finding) => finding.outcome === "REVIEW")
    : [];

  let ctaLabel = text("Swap");
  let ctaDisabled = true;
  if (attempt) {
    if (phase === "RECOVERING") {
      ctaLabel = text("Checking transaction…");
    } else {
      ctaLabel = text("Check transaction");
      ctaDisabled = false;
    }
  } else if (lockedReview) {
    ctaLabel = phase === "PREPARING" ? text("Refreshing…") : text("Get a new quote");
    ctaDisabled = phase === "PREPARING";
  } else if (!connection) {
    /* With several wallets the tiles above are the action and this button is
       not rendered at all. It used to say "Choose a wallet above" and sit
       disabled — a control whose only job is to point at another control. */
    ctaLabel = text("Connect wallet");
    ctaDisabled = connecting;
  } else if (busy) {
    ctaLabel =
      phase === "PREPARING"
        ? text("Preparing swap…")
        : phase === "SIGNING"
          ? text("Waiting for the wallet…")
          : text("Swapping…");
  } else if (bytesChanged) {
    ctaLabel = text("Get a new quote");
    ctaDisabled = false;
  } else if (prepared) {
    if (!preparedReadiness?.ready || reviewSecondsLeft === null || reviewSecondsLeft <= 0) {
      ctaLabel = text("Get a new quote");
      ctaDisabled = false;
    } else {
      ctaLabel = text("Confirm in wallet");
      ctaDisabled = false;
    }
  } else if (!legsResolved) {
    ctaLabel = text("Reading both assets…");
  } else if (!amountParsed) {
    ctaLabel = text("Enter an amount");
  } else if (cannotPayNetworkFee) {
    /* Before the quote, before Review, and in the person's own terms: the
       shortfall is SOL, not the token they are selling. */
    ctaLabel = text("Add SOL for the network fee");
  } else if (insufficientBalance) {
    ctaLabel = text("Insufficient balance");
  } else if (blocked) {
    ctaLabel = text("Unavailable for this asset");
  } else if (quoteFailure && !swapFailureCopy(quoteFailure.code, text).retryable) {
    /* The estimate for this very amount refused for a reason no press changes
       — the same asset on both sides, a refused passport: a Review would be
       refused the same way. */
    ctaLabel = text("Try another pair");
  } else if (actionFailure && !swapFailureCopy(actionFailure.code, text).retryable) {
    /* The last attempt failed for a reason no amount of pressing will change —
       the lane is closed, or this deployment cannot sign. Say so on the button
       instead of offering "Review swap" to somebody it will refuse again. */
    ctaLabel = text("Not available right now");
  } else {
    ctaLabel = text("Review swap");
    ctaDisabled = false;
  }

  const onCta = () => {
    if (attempt) {
      void recoverAttempt();
      return;
    }
    if (bytesChanged) {
      void startOverAfterBytesChanged();
      return;
    }
    if (
      lockedReview ||
      (prepared && (!preparedReadiness?.ready || reviewSecondsLeft === null || reviewSecondsLeft <= 0))
    ) {
      void cancelIssuedReview();
      return;
    }
    if (!connection) {
      void connect(wallets[0]?.name);
      return;
    }
    if (prepared) {
      void signReviewedOrder();
      return;
    }
    /* No estimate is waited for first: the Review is the venue's own fresh
       order, and its window — not the estimate's — binds the signature. An
       estimate that failed is asked again beside it, once per press. */
    if (quoteFailure) setRefreshTicket((ticket) => ticket + 1);
    void requestExactReview();
  };

  const displayedOrder = prepared?.order ?? quote?.order ?? null;
  const outDisplay = displayedOrder ? displayAmount(displayedOrder.outAmountRaw, buyDecimals) : "0.0";
  const outState = displayedOrder ? "ready" : quoting ? "pending" : "empty";
  const rate = displayedOrder
    ? Number(plainAmount(displayedOrder.outAmountRaw, buyDecimals)) /
      Number(plainAmount(displayedOrder.inAmountRaw, sellDecimals))
    : null;

  /* ---------------------------------------------------------------- context */

  /* The ticket used to be the whole page: one 720px card centred in 2236x1156
     of empty canvas. The panels beside it read from the same order this card
     would sign — the newest one available, so a Review shows the exact numbers
     under the signature rather than the discovery quote behind it. */
  const contextOrder = prepared?.order ?? quote?.order ?? null;
  /* A discovery quote has no taker, so the venue answers slippage, the minimum
     and every fee with a zero it cannot yet know. Those zeros are not facts and
     they do not render as any. */
  const priced = contextOrder !== null && contextOrder.taker !== null;
  const tall = Boolean(prepared || settled);

  const side = (mint: string, described: ReturnType<typeof describeToken>): SwapSide => {
    const held = holdingFor(mint);
    return {
      mint,
      code: described.code,
      program: described.program,
      listedUsd: assetCatalog[mint]?.usdPrice ?? null,
      listedVerified: assetCatalog[mint]?.isVerified ?? null,
      listedSuspicious: assetCatalog[mint]?.isSuspicious ?? false,
      balance: held ? displayAmount(held.spendableRaw, held.decimals) : null,
    };
  };

  const contextFacts: SwapFacts = {
    rate,
    priceImpactPct: contextOrder?.priceImpactPct ?? null,
    slippageBps: priced ? contextOrder.slippageBps : null,
    minReceivedRaw: priced ? contextOrder.minReceivedRaw : null,
    tradeUsdValue: contextOrder?.swapUsdValue ?? null,
    platformFeeBasisPoints: priced ? contextOrder.totalFeeBasisPoints : null,
    /* Read from the order where it carries the field, and zero where it does
       not: this adapter sends no referral or integrator parameter on either
       path (`lib/solana/quotes.ts`), so an absent field is a zero rather
       than an unknown. The day that stops being true, the field arrives and
       this row changes with it. */
    ryntraFee: priced ? ryntraServiceFee(contextOrder) : null,
    feeQuote: priced
      ? {
          inputMint: contextOrder.inputMint,
          outputMint: contextOrder.outputMint,
          inputRaw: contextOrder.inAmountRaw,
          quotedOutputRaw: contextOrder.outAmountRaw,
          sides: { [sellMint]: { decimals: sellDecimalsKnown, code: sell.code }, [buyMint]: { decimals: buyDecimalsKnown, code: buy.code } },
          usd: { input: Number(contextOrder.inUsdValue) || null, output: Number(contextOrder.outUsdValue) || null },
        }
      : null,
    networkFeeSol: priced
      ? (
          Number(
            BigInt(contextOrder.signatureFeeLamports) + BigInt(contextOrder.priorityFeeLamports),
          ) / 1e9
        ).toFixed(6)
      : null,
    accountReserveSol: priced
      ? (Number(BigInt(contextOrder.rentFeeLamports)) / 1e9).toFixed(6)
      : null,
    provider: contextOrder?.source?.label ?? null,
    route: contextOrder?.route ?? [],
    secondsLeft,
    quoting,
  };

  /* The surface above this card states the Simple facts for every class in
     one place. Keyed by value, so a parent that stores them does not re-render
     this card into calling it again with the same numbers. */
  const surfaceFacts: SwapCardFacts = {
    expectedOutRaw: quote?.order.outAmountRaw ?? null,
    minReceivedRaw: contextFacts.minReceivedRaw,
    buyDecimals,
    sellDecimals,
    networkFeeSol: contextFacts.networkFeeSol,
    platformFeeBasisPoints: contextFacts.platformFeeBasisPoints,
    priceImpactPct: contextFacts.priceImpactPct,
    secondsLeft,
    quoting,
    provider: contextFacts.provider,
    route: contextFacts.route.map((hop) => hop.label),
    reviewing: Boolean(prepared),
  };
  const surfaceFactsKey = JSON.stringify(surfaceFacts);
  useEffect(() => {
    if (!onFacts) return;
    onFacts(JSON.parse(surfaceFactsKey) as SwapCardFacts);
  }, [surfaceFactsKey, onFacts]);

  return (
    <>
      <Panel
        bare={Boolean(embedded)}
        id="trade-swap"
        title={text("Swap")}
        w={4}
        h={tall ? 8 : 6}
        essential
        badge={text("Solana mainnet")}
        tone={settledOutcome?.kind === "FILLED" ? "verified" : "evidence"}
      >
        <div className={styles.card}>
          {phase === "SETTLED" && settled && settledOutcome ? (
            <div className={styles.settled} data-kind={settledOutcome.kind} data-tone={settledTone} role="status">
              <div className={styles.settledMark} data-tone={settledTone} aria-hidden="true">
                {settledTone === "matched" ? <CheckCircle size={26} weight="fill" /> : settledTone === "risk" ? <XCircle size={26} weight="fill" /> : <Warning size={26} weight="fill" />}
              </div>
              <div className={styles.settledHead} data-tone={settledTone}>
                <span className={styles.settledKicker} translate="no">{settledSell.code} → {settledBuy.code}</span>
                <b>{settledHeadline}</b>
              </div>
              {settledOutcome.kind === "FILLED" && settled.observation ? (
                <div className={styles.fill}>
                  <div className={styles.fillAmount} translate="no">
                    +{displayAmount(settled.observation.actualOutputRaw, settledBuy.decimals)} <span>{settledBuy.code}</span>
                  </div>
                  <div className={styles.fillFor}>
                    {text("for")} <b translate="no">{displayAmount(settled.observation.actualInputRaw, settledSell.decimals)} {settledSell.code}</b>
                  </div>
                  <dl className={styles.fillFacts}>
                    {settledRate !== null && Number.isFinite(settledRate) ? (
                      <div>
                        <dt>{text("Price")}</dt>
                        <dd translate="no">1 {settledSell.code} ≈ {settledRate.toLocaleString("en-US", { maximumSignificantDigits: 6 })} {settledBuy.code}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>{text("Ryntra fee")}</dt>
                      <dd translate="no">{settledFee ? serviceFeeText(settledFee, text("None")) : text("None")}</dd>
                    </div>
                  </dl>
                </div>
              ) : null}
              {settledSentence ? <p className={styles.settledSentence}>{settledSentence}</p> : null}
              {settledOutcome.kind !== "NOTHING_HAPPENED" ? (
                <div className={styles.settledLinks}>
                  <a className="rw-btn" href={explorerTxUrl(NETWORK, settled.signature)} target="_blank" rel="noreferrer">
                    {text("Explorer")} <ArrowUpRight size={12} aria-hidden="true" />
                  </a>
                  {settled.receipt ? (
                    <button className="rw-btn" type="button" onClick={() => downloadReceipt(settled.receipt)}>
                      {text("Receipt")}
                    </button>
                  ) : null}
                  <Link className="rw-btn" href="/app/activity">
                    {text("History")}
                  </Link>
                </div>
              ) : null}
              <button className={settledOutcome.kind === "FILLED" ? styles.settledAgain : styles.cta} type="button" onClick={newSwap}>
                {settledOutcome.kind === "NOTHING_HAPPENED" ? text("Trade again") : text("New swap")}
              </button>
            </div>
          ) : (
          <>
          {embedded ? null : (
          <div className={styles.legs}>
            <div className={styles.leg}>
              <div className={styles.legHead}>
                <span className={styles.legLabel}>{text("You pay")}</span>
                {!sellHolding && (holdingsPartial || holdingsFailed) && connection ? (
                  /* The balance this leg needs did not come back in a partial
                     read. Say so where the figure would be, and offer the read
                     again — never an empty corner that reads as "no balance". */
                  <span className={styles.balance}>
                    <span className={styles.balanceLabel}>{holdingsFailed ? text("Balances could not be loaded just now. Try again in a moment.") : text("Some balances could not be read.")}</span>
                    <button className={styles.shareButton} type="button" onClick={refreshHoldings} disabled={busy}>
                      {text("Read again")}
                    </button>
                  </span>
                ) : null}
                {sellHolding ? (
                  <span className={styles.balance}>
                {/* `Available`, not `Balance`. The figure beneath this word is
                    `spendableRaw` — the balance with the network-fee reserve
                    already withheld — so a wallet holding 0.06046201 SOL read
                    `Balance 0.05996201 SOL` here and matched nothing the person
                    could see in their own wallet. A swap shows the
                    *available* balance, which is exactly what this is. */}
                    <span className={styles.balanceLabel}>{text("Available")}</span>
                    <button
                      className={styles.balanceValue}
                      type="button"
                      onClick={fillMax}
                      disabled={busy}
                      title={text("Use the full spendable balance")}
                      translate="no"
                    >
                      {displayAmount(sellHolding.spendableRaw, sellHolding.decimals)} {sell.code}
                    </button>
                    <span className={styles.shareGroup}>
                      <button className={styles.shareButton} type="button" onClick={() => fillShare(1n, 4n)} disabled={busy}>
                        25%
                      </button>
                      <button className={styles.shareButton} type="button" onClick={() => fillShare(1n, 2n)} disabled={busy}>
                        50%
                      </button>
                      <button className={styles.shareButton} type="button" onClick={() => fillShare(3n, 4n)} disabled={busy}>
                        75%
                      </button>
                      <button className={styles.shareButton} type="button" onClick={fillMax} disabled={busy}>
                        {text("MAX")}
                      </button>
                    </span>
                  </span>
                ) : null}
              </div>
              <div className={styles.legBody}>
                <input
                  className={styles.amountInput}
                  value={amount}
                  inputMode="decimal"
                  aria-label={text("Amount to sell")}
                  placeholder="0.0"
                  disabled={busy}
                  onChange={(event) => setAmount(event.target.value)}
                />
                <button
                  ref={sellButtonRef}
                  className={styles.tokenPill}
                  type="button"
                  aria-label={`${text("You pay")}: ${sell.code}. ${text("Choose an asset")}`}
                  onClick={() => {
                    setSearch("");
                    setSearchRows(null);
                    setPicker("sell");
                  }}
                  disabled={busy}
                >
                    <MarketIcon mint={sellMint} icon={sell.icon} symbol={sell.code} size={24} />
                  <span translate="no">{sell.code}</span>
                  <span className={styles.tokenCaret} aria-hidden>▾</span>
                </button>
              </div>
              <span className={styles.usdLine} translate="no">
                {displayedOrder?.inUsdValue ? `$${Number(displayedOrder.inUsdValue).toFixed(2)}` : ""}
              </span>
            </div>

            <div className={styles.flipRow}>
              <button className={styles.flipButton} type="button" onClick={flip} disabled={busy} aria-label={text("Flip the pair")}>
                ⇅
              </button>
            </div>

            <div className={styles.leg}>
              <div className={styles.legHead}>
                <span className={styles.legLabel}>{text("You receive")}</span>
              </div>
              <div className={styles.legBody}>
                <span className={styles.amountOut} data-state={outState} translate="no">
                  {outDisplay}
                </span>
                <button
                  ref={buyButtonRef}
                  className={styles.tokenPill}
                  type="button"
                  aria-label={`${text("You receive")}: ${buy.code}. ${text("Choose an asset")}`}
                  onClick={() => {
                    setSearch("");
                    setSearchRows(null);
                    setPicker("buy");
                  }}
                  disabled={busy}
                >
                    <MarketIcon mint={buyMint} icon={buy.icon} symbol={buy.code} size={24} />
                  <span translate="no">{buy.code}</span>
                  <span className={styles.tokenCaret} aria-hidden>▾</span>
                </button>
              </div>
              <span className={styles.usdLine} translate="no">
                {displayedOrder?.outUsdValue ? `$${Number(displayedOrder.outUsdValue).toFixed(2)}` : ""}
              </span>
            </div>
          </div>
          )}

          <div className={styles.rateRow}>
            <span translate="no">
              {quote && rate !== null && Number.isFinite(rate) ? (
                <>
                  1 {sell.code} ≈{" "}
                  <span className={styles.rateValue}>
                    {rate.toLocaleString("en-US", { maximumSignificantDigits: 6 })}
                  </span>{" "}
                  {buy.code}
                </>
              ) : quoting ? (
                text("Quoting…")
              ) : (
                ""
              )}
            </span>
          </div>

          {/* The estimate's refusal says nothing once the Review has answered for
              itself — its own refusal below, or its exact order — unless no
              press can change it: then it is the reason the button gives. */}
          {quoteFailure && ((!prepared && !actionFailure && phase === "IDLE") || !swapFailureCopy(quoteFailure.code, text).retryable) ? (
            <div className={styles.errorRow}>{failureCopy(quoteFailure.code, text)}</div>
          ) : null}

          {prepared ? (
            <section className={styles.exactReview} aria-label={reviewHeading}>
              <div className={styles.exactReviewHead}>
                <span className={styles.legLabel}>{reviewHeading}</span>
              </div>
              <div className={styles.exactReviewGrid}>
                <span>
                  {text("You pay")}
                  <b translate="no">{displayAmount(prepared.order.inAmountRaw, sellDecimals)} {sell.code}</b>
                </span>
                <span>
                  {text("You receive at least")}
                  <b translate="no">{displayAmount(prepared.order.minReceivedRaw, buyDecimals)} {buy.code}</b>
                </span>
                <span>
                  {text("Network fee estimate")}
                  <b translate="no">{estimatedNetworkFeeSol} SOL</b>
                </span>
                {BigInt(prepared.order.rentFeeLamports) > 0n ? (
                  <span>
                    {text("Account reserve")}
                    <b translate="no">{accountReserveSol} SOL</b>
                  </span>
                ) : null}
                {/* Ryntra's own fee, in the Review, beside the figures a person
                    is deciding on, on a row of its own: the rate and the amount
                    stay one figure. It is deliberately not folded into the
                    network fee or the price: a service fee is what this company
                    charges, and the one place it must never be is implicit.
                    A route that carries none prints a zero rather than nothing. */}
                <span data-wide="true">
                  {text("Ryntra fee")}
                  <b translate="no">{reviewServiceFeeText}</b>
                </span>
              </div>
              {reviewServiceFee?.mechanism === "JUPITER_REFERRAL" && reviewServiceFee.basisPoints > 0 ? (
                <p className={styles.feeNote}>{text("Includes Jupiter's share. Already included in the quote.")}</p>
              ) : null}
              {reviewWarnings.length > 0 ? (
                <ul className={styles.reviewWarnings} aria-label={text("Review before confirming")}>
                  {reviewWarnings.flatMap((finding) =>
                    reviewWarningCopies(finding, prepared.order, text).map((warning, index) => (
                      <li key={`${finding.rule}:${index}`}>{warning}</li>
                    )),
                  )}
                </ul>
              ) : null}
            </section>
          ) : null}

          {actionFailure ? (
            /* The sentence is what a person reads; the code is what somebody
               helping them needs, and it rides along without adding a line of
               technical text to the card. */
            <div className={styles.errorRow} title={actionFailure.code}>
              {failureCopy(actionFailure.code, text)}
            </div>
          ) : null}

          {/* A swap that landed says so. The reconciliation state is the
              ledger's word, not the person's — theirs is whether the trade
              happened and for how much, and an independent read of the chain
              is what answers it. The exact state stays in the Receipt. */}
          {settled && phase !== "SETTLED" ? (
            <div className={styles.riskRow} data-tone={settled.observation ? "verified" : phase === "RECOVERY" ? "high" : "caution"}>
              <StatusChip family="risk" tone={settled.observation ? "verified" : phase === "RECOVERY" ? "high" : "caution"}>
                 {settled.observation
                   ? text("Swapped")
                   : NOTHING_HAPPENED.has(settled.state)
                     ? text("Not executed")
                     : text("Checking transaction…")}
              </StatusChip>
              {settled.observation ? (
                <span translate="no">
                  {displayAmount(settled.observation.actualInputRaw, settledSell.decimals)} {settledSell.code}
                  {" → "}
                  {displayAmount(settled.observation.actualOutputRaw, settledBuy.decimals)} {settledBuy.code}
                </span>
              ) : null}
              <span translate="no">{short(settled.signature)}</span>
              <a className="rw-btn" href={explorerTxUrl(NETWORK, settled.signature)} target="_blank" rel="noreferrer">
                {text("Explorer")}
              </a>
              {settled.receipt ? (
                <>
                  <button className="rw-btn" type="button" onClick={() => downloadReceipt(settled.receipt)}>
                    {text("Receipt")}
                  </button>
                  <Link className="rw-btn" href="/app/receipts">
                    {text("Open receipt")}
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}

          {/* The wallet choice, the reason there is none, and the failure —
              all beside the control that needs them, and identical on Send,
              Swap and Bridge. */}
          <WalletConnectRow hintClassName={styles.walletHint} errorClassName={styles.errorRow} />

          {!connection && wallets.length > 1 ? null : (
            <button className={styles.cta} type="button" onClick={onCta} disabled={ctaDisabled}>
              {ctaLabel}
            </button>
          )}
          </>
          )}

        </div>
      </Panel>

      <SwapContext
        sell={side(sellMint, sell)}
        buy={side(buyMint, buy)}
        buyDecimals={buyDecimals}
        facts={contextFacts}
        tall={tall}
      />

      {picker ? (
        <div
          className={styles.pickerBackdrop}
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPicker(null);
          }}
        >
          <div ref={pickerDialogRef} className={styles.picker} role="dialog" aria-modal="true" aria-label={text("Choose an asset")}>
            <div className={styles.pickerHead}>
              <span>{picker === "sell" ? text("You pay") : text("You receive")}</span>
              <button className={styles.pickerClose} type="button" onClick={() => setPicker(null)}>
                {text("Close")}
              </button>
            </div>
            <input
              className={styles.pickerSearch}
              value={search}
              autoFocus
              spellCheck={false}
              aria-label={text("Search by name, ticker or mint address")}
              placeholder={text("Search by name, ticker or mint address")}
              onChange={(event) => setSearch(event.target.value)}
            />
            {connection && (holdingsPartial || holdingsFailed) ? (
              <p className={styles.ctaNote}>
                {text("Some balances could not be read.")} {" "}
                <button className={styles.shareButton} type="button" onClick={refreshHoldings}>{text("Read again")}</button>
              </p>
            ) : null}
            <ul className={styles.pickerList}>
              {pickerRows.map((entry) => {
                const label = describeToken(entry.mint, { ...assetCatalog, [entry.mint]: entry });
                const held = entry.holding;
                const taken = picker === "sell" ? entry.mint === buyMint : entry.mint === sellMint;
                const selected = picker === "sell" ? entry.mint === sellMint : entry.mint === buyMint;
                return (
                  <li key={entry.mint}>
                    <button
                      className={styles.pickerItem}
                      type="button"
                      data-selected={selected ? "true" : "false"}
                      disabled={taken}
                      onClick={() => choose(entry)}
                    >
                      {entry.symbol ? <MarketIcon mint={entry.mint} icon={entry.icon ?? null} symbol={label.code} /> :
                        <span className={styles.tokenGlyph} aria-hidden>{label.code.slice(0, 1)}</span>}
                      <span className={styles.pickerMeta}>
                        <span className={styles.pickerCodeRow}>
                          <span className={styles.pickerCode} translate="no">{label.code}</span>
                          {entry.isSuspicious ? <span className={styles.pickerFlag} data-tone="high" title={text("Flagged by Jupiter")}>{text("Caution")}</span> :
                            entry.isVerified ? <span className={styles.pickerVerified} title={text("Verified by Jupiter")} aria-label={text("Verified by Jupiter")}>✓</span> : null}
                        </span>
                        {label.name ? <span className={styles.pickerNote} translate="no">{label.name}</span> : null}
                      </span>
                      {held ? (
                        <span className={styles.pickerBalance} translate="no">
                          <strong>{entry.usdValue === null ? "—" : usdValue(entry.usdValue)}</strong>
                          <span>{displayAmount(held.amountRaw ?? held.spendableRaw, held.decimals)} {label.code}</span>
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {searching ? <p className={styles.ctaNote}>{text("Searching…")}</p> : null}
            {!searching && search.trim() !== "" && pickerRows.length === 0 ? (
              <p className={styles.ctaNote}>{text("No asset matched that search.")}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
