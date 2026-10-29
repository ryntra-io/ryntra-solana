"use client";

import { ArrowRight, CircleNotch, Warning } from "@phosphor-icons/react";
import { Block, Button, TradeTicket, newDraft, ticketModel, ticketSnapshot, type TicketDraft, type TicketInput, type TicketResult, type TicketReviewed } from "@ryntra/core/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import { PURCHASE_FEE_LAMPORTS } from "@/app/app/invest/funding-model";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { useQuickBuySums } from "@/app/solana/workspace/spot/quick-buy";
import type { LaunchMarketResponse, LaunchTradeBuildResponse, LaunchTradeQuoteResponse, LaunchTradeSubmitResponse, LaunchWalletResponse } from "@/lib/api/v1/contract";
import { storeBoundSolanaReceipt } from "@/lib/solana/send-receipt-vault.client";
import { signFreshBytes } from "@/lib/solana/sign-fresh";
import { measureTradeStep } from "@/lib/solana/trade-steps";
import { signTransactions } from "@/lib/solana/wallet.client";
import { quickSum } from "@/lib/spot/quick-trade";
import { NETWORK_LABEL, decimalText, rawAmount, settledReceipt, solGas, ticketBalances, ticketMarket, ticketPrices, ticketQuote, unitsOf, type TicketCoin } from "@/lib/ticket/solana-ticket";

import { coreLang } from "../launch-blocks";
import { explorerUrl, formatBps, formatMoneyShort, formatMove, formatRaw, shortAddress } from "../launch-format";
import { useHydrated } from "../use-hydrated";
import { launchWords } from "../launch-words";
import styles from "../launch.module.css";
import { PausedNote } from "../paused-note";
import { ShareLink } from "../share-link";

/**
 * Buy and sell a launch: on its curve by Meteora DBC's own swap, after
 * graduation in its DAMM v2 pool. The form is the core's ticket — the side, the
 * amount in the pair or the token (or in dollars, where the pair has a price),
 * its quick choices, what the trade gets and costs, one orange action — kept
 * beside the chart on a desk and first on a phone.
 *
 * The panel never decides: it counts the trade as the amount is typed, says
 * the fee and who receives it (the falling fee for snipers in amber while it
 * lasts), and asks the wallet to sign the bytes the server built. A refusal
 * says what happened and that nothing moved. A trade made is in History like
 * every trade, with its receipt, and can be shared at once with the person's
 * own link.
 */

type Side = "buy" | "sell";
type Phase = "idle" | "prepare" | "sign" | "send" | "done" | "error";
type Answer<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

const API_HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;
/** The tolerances a launch's trade takes; one per cent unless the person picks another. */
const SLIPPAGES = [50, 100, 300, 500] as const;
const DEFAULT_SLIPPAGE_BPS = 100;
/**
 * How long a count stands before it is counted again (SOL-P1): a review is never signed on a quote older than this.
 * Longer than the market's own refresh (20 s), which counts again by itself: the rounds count only where the market
 * could not be read again — and never in a hidden tab, so a page left open does not spend the hour's quotes.
 */
const QUOTE_LIFE_MS = 25_000;

async function api<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  try {
    const response = await fetch(path, { ...init, headers: { ...API_HEADERS, ...(init?.headers ?? {}) } });
    const body = (await response.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    if (!response.ok) return { ok: false, code: body?.error?.code ?? "UNAVAILABLE", message: body?.error?.message ?? "" };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: "" };
  }
}

const positive = (text: string | number | null | undefined): number | null => {
  const value = typeof text === "number" ? text : typeof text === "string" ? Number(text) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
};

export function TradePanel({
  market,
  symbol,
  locale,
  paused = false,
  onTraded,
}: {
  market: LaunchMarketResponse;
  symbol: string;
  locale: WorkspaceLocale;
  /** Launch's operator stop is closed: nothing is quoted, built or sent here. */
  paused?: boolean;
  /** After a trade the network confirmed or took: the page reads the market again. */
  onTraded: (wallet: string) => void;
}) {
  const word = launchWords(locale);
  const lang = coreLang(locale);
  const { connection } = useSolanaConnection();
  const { reach } = useWalletReach();
  const [draft, setDraft] = useState<TicketDraft>(() => newDraft({ unit: "token", slippageBps: DEFAULT_SLIPPAGE_BPS }));
  const side: Side = draft.side;
  const slippageBps = draft.slippageBps;
  const [held, setHeld] = useState<LaunchWalletResponse | null>(null);
  const [quote, setQuote] = useState<{ key: string; data: LaunchTradeQuoteResponse | null; code: string | null; loading: boolean }>({ key: "", data: null, code: null, loading: false });
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<{ code: string; message: string; signed: boolean } | null>(null);
  const [result, setResult] = useState<{ side: Side; quote: LaunchTradeQuoteResponse; submit: LaunchTradeSubmitResponse; at: number; reviewed: TicketReviewed } | null>(null);
  /* The trade's receipt kept on this device, as a swap's is: the receipt link then opens the receipt itself. */
  const [receiptKept, setReceiptKept] = useState<string | null>(null);
  /* Where the ticket stands: the form, Review over what was agreed to, or the trade's result. */
  const [stage, setStage] = useState<"form" | "review" | "result">("form");
  const [reviewed, setReviewed] = useState<TicketReviewed | null>(null);
  /* The count Review agreed to, kept with it: its costs, parts and rows stay those of the amount agreed to, whatever a dollar price does meanwhile. */
  const [reviewedQuote, setReviewedQuote] = useState<LaunchTradeQuoteResponse | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const pair = market.pair;
  const wallet = connection?.address ?? null;
  const base = `/api/v1/launch/${market.token}`;
  const busy = phase === "prepare" || phase === "sign" || phase === "send";
  const hydrated = useHydrated();
  /* The bytes were built a second time: the first signature came back after they had aged (AG-1). */
  const [again, setAgain] = useState(false);

  /* ------------------------------------------------------------ the ticket's market */
  const pairCoin: TicketCoin = useMemo(() => ({ mint: pair.mint, symbol: pair.symbol, decimals: pair.decimals, digits: Math.min(pair.decimals, pair.dollar ? 2 : 4) }), [pair]);
  const tokenCoin: TicketCoin = useMemo(() => ({ mint: market.token, symbol: `$${symbol}`, decimals: market.tokenDecimals, digits: 0 }), [market.token, market.tokenDecimals, symbol]);
  const pricePair = positive(market.price.pair);
  const priceUsd = positive(market.price.usd);
  const observedAt = Date.parse(market.observedAt) || now;
  const ticketMarketOf = useMemo(() => ticketMarket({ id: market.token, base: tokenCoin, quote: pairCoin, price: pricePair }), [market.token, tokenCoin, pairCoin, pricePair]);
  /* Dollars per pair unit from the token's two prices; a dollar pair is a dollar where the market says none. */
  const pairUsd = priceUsd !== null && pricePair !== null ? priceUsd / pricePair : pair.dollar ? 1 : null;
  const prices = useMemo(
    () => ticketPrices([{ coin: tokenCoin, usd: priceUsd }, { coin: pairCoin, usd: pairUsd }], observedAt, "Meteora"),
    [tokenCoin, pairCoin, priceUsd, pairUsd, observedAt],
  );
  const reference = useMemo(() => {
    const price = pricePair !== null ? decimalText(pricePair, 15) : null;
    return price ? { price, source: "Meteora", at: observedAt } : null;
  }, [pricePair, observedAt]);
  /* The wallet's two balances once read; before that a connected wallet's are unknown, never zero. */
  const balances = !connection ? null : held ? ticketBalances([{ coin: pairCoin, raw: held.pairRaw }, { coin: tokenCoin, raw: held.tokenRaw }]) : {};
  /* On a SOL pair «Max» leaves the network's fee; the venue checks the rest. */
  const gas = useMemo(() => solGas(PURCHASE_FEE_LAMPORTS), []);

  /* What the amount typed is in the pair (a purchase) or the token (a sale): the ticket's own count, in raw units. */
  const baseInput: TicketInput = {
    market: ticketMarketOf,
    draft,
    balances,
    prices,
    reference,
    gas,
    fees: [],
    maxLegs: 1,
    swap: { status: "on" },
    limit: { status: "off" },
    slippageChoices: SLIPPAGES,
    venue: "Meteora",
    venueId: market.venue,
    now,
  };
  const typed = ticketModel(baseInput, lang);
  const amountRaw: bigint | null = draft.amount.trim() === "" ? 0n : unitsOf(typed.paid);

  const readWallet = useCallback(async () => {
    if (!wallet) {
      setHeld(null);
      return;
    }
    const read = await api<LaunchWalletResponse>(`${base}/wallet/${wallet}`);
    setHeld(read.ok ? read.data : null);
  }, [wallet, base]);

  useEffect(() => {
    void readWallet();
  }, [readWallet]);

  /* The clock a quote's freshness is read against, once a second while a figure can age on screen. */
  useEffect(() => {
    if (stage === "result") return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [stage]);

  /*
   * The trade counted as the amount is typed: what it gets, the fee and who receives it. A count lives `QUOTE_LIFE_MS`
   * (SOL-P1): then it is counted again, its old figures shown greyed and not signable meanwhile; a count the node did not
   * answer is said as not read — the review never stands on an old quote. The build counts once more at the press.
   */
  const [quoteRound, setQuoteRound] = useState(0);
  /* A round counts the same trade again: its key stays, so the old figures stay on screen greyed while it is counted. */
  const key = `${side}:${amountRaw ?? "x"}:${slippageBps}:${market.observedAt}`;
  useEffect(() => {
    if (amountRaw === null || amountRaw <= 0n) {
      setQuote({ key, data: null, code: null, loading: false });
      return;
    }
    setQuote((current) => ({ key, data: current.data, code: null, loading: true }));
    const timer = window.setTimeout(async () => {
      const started = performance.now();
      const read = await api<LaunchTradeQuoteResponse>(`${base}/trade/quote`, { method: "POST", body: JSON.stringify({ side, amountRaw: amountRaw.toString(), slippageBps }) });
      measureTradeStep("launch", "quote", started);
      setQuote((current) => (current.key === key ? { key, data: read.ok ? read.data : null, code: read.ok ? null : read.code, loading: false } : current));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [key, quoteRound, amountRaw, side, slippageBps, base]);
  const counted = quote.key === key && quote.data !== null && !quote.loading;
  useEffect(() => {
    if (!counted || busy) return;
    const born = Date.now();
    const countAgain = () => {
      if (document.visibilityState === "visible") setQuoteRound((round) => round + 1);
    };
    const timer = window.setTimeout(countAgain, QUOTE_LIFE_MS);
    /* Back in a tab whose count outlived its life: counted again at once, never signed as it was. */
    const seen = () => {
      if (Date.now() - born >= QUOTE_LIFE_MS) countAgain();
    };
    document.addEventListener("visibilitychange", seen);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", seen);
    };
  }, [counted, busy, key, quoteRound]);

  /* A receipted trade: its receipt read from the launch's own route and kept on this device for the receipt page. */
  const receiptHash = result?.submit.receiptHash ?? null;
  const receiptSignature = result?.submit.signature ?? null;
  useEffect(() => {
    if (!receiptHash || !receiptSignature || !wallet) return;
    let live = true;
    void (async () => {
      const read = await api<{ receipt: unknown }>(`${base}/trade/receipt`, { method: "POST", body: JSON.stringify({ wallet, signature: receiptSignature }) });
      if (!live || !read.ok || !read.data.receipt) return;
      try {
        if (storeBoundSolanaReceipt(window.localStorage, wallet, wallet, read.data.receipt).ok) setReceiptKept(receiptSignature);
      } catch {
        /* A device that keeps nothing still has the receipt in History. */
      }
    })();
    return () => {
      live = false;
    };
  }, [receiptHash, receiptSignature, wallet, base]);

  const shown = quote.key === key ? quote.data : null;

  /* ------------------------------------------------------------ the count, in the ticket's words */
  /* A cost in the review to the last unit of its currency: its lines add up exactly to the total beside them, and a part
     that is not zero is never written as one. */
  const cost = (raw: string) => `${formatRaw(raw, pair.decimals, locale, pair.decimals)} ${pair.symbol}`;
  const venueWord = market.venue === "curve" ? word("tradeOnCurve") : word("tradeInPool");
  /* The quote speaks for the amount asked, this side and this tolerance; while it is counted again it is not signable. */
  const ticketQuoteOf = (data: LaunchTradeQuoteResponse | null, ask: bigint | null) => {
    if (!data || ask === null || ask <= 0n) return null;
    const pay = side === "buy" ? pairCoin : tokenCoin;
    const get = side === "buy" ? tokenCoin : pairCoin;
    /* Ryntra's part is its own line; the rest of the fee — the creator's, Meteora's, the pool's — is the venue's, and the two add up to the total. */
    const ryntra = BigInt(data.fee.ryntraRaw);
    const venue = BigInt(data.fee.totalRaw) - ryntra;
    const at = Date.parse(data.observedAt) || now;
    return ticketQuote({
      figures: {
        inRaw: ask.toString(),
        outRaw: data.amountOutRaw,
        minRaw: data.minimumOutRaw,
        fees: {
          ...(venue > 0n ? { venue: rawAmount(venue, pairCoin) ?? undefined } : {}),
          ...(ryntra > 0n ? { ryntra: rawAmount(ryntra, pairCoin) ?? undefined } : {}),
        },
        route: venueWord,
        at,
        expiresAt: at + QUOTE_LIFE_MS,
        slippageBps: data.slippageBps,
      },
      side,
      market: ticketMarketOf,
      pay,
      get,
      executor: "Meteora",
      venueId: market.venue,
    });
  };
  const liveQuote = quote.loading ? null : ticketQuoteOf(shown, amountRaw);
  const input: TicketInput = { ...baseInput, ...(liveQuote ? { quote: liveQuote } : {}), ...(quote.code && !quote.loading ? { quoteFailed: quote.code === "LAUNCH_GRADUATING" ? word("errGraduating") : word("errQuote") } : {}) };
  const model = ticketModel(input, lang);
  /* The review signs only the quote of the amount typed now: while a new one is counted, the old one is not signable. */
  const ready = Boolean(shown) && !quote.loading && !busy && amountRaw !== null && amountRaw > 0n && model.fieldError === null && Boolean(connection);

  /* The fee's every part on its own line, as the launch splits it — the creator's, Ryntra's, Meteora's, the pool's. */
  const countOf = (data: LaunchTradeQuoteResponse | null) => (data ? { costLines: feeLines(data.fee, word, cost), costsTotal: `${cost(data.fee.totalRaw)} · ${formatBps(data.feeBps, locale)}` } : {});
  const reviewData = stage === "review" ? (reviewedQuote ?? result?.quote ?? null) : stage === "result" ? (result?.quote ?? shown) : shown;
  const capText = (value: { pair: number; usd: number | null }) => formatMoneyShort(value.usd ?? value.pair, locale, value.usd !== null, pair.symbol);
  /* The curve that fills first spends less than was typed: Review says what leaves now and what stays, as the old one did. */
  const partialRows =
    reviewData && BigInt(reviewData.amountLeftRaw) > 0n
      ? [
          { label: word("partialSpent"), value: side === "buy" ? cost(reviewData.amountInRaw) : `${formatRaw(reviewData.amountInRaw, tokenCoin.decimals, locale, 2)} ${symbol}` },
          { label: word("partialLeft"), value: side === "buy" ? cost(reviewData.amountLeftRaw) : `${formatRaw(reviewData.amountLeftRaw, tokenCoin.decimals, locale, 2)} ${symbol}` },
        ]
      : [];
  const reviewRows = reviewData
    ? [
        ...partialRows,
        { label: word("capAfter"), value: capText(reviewData.marketCapAfter) },
        {
          label: word("priceMove"),
          value: reviewData.priceMoveBps >= 0 ? word("priceUp", { pct: formatMove(reviewData.priceMoveBps, locale).replace(/^[+−]/, "") }) : word("priceDown", { pct: formatMove(reviewData.priceMoveBps, locale).replace(/^[+−]/, "") }),
        },
      ]
    : [];

  /* The amount the partial-fill note speaks of: in Review the one agreed to. */
  const noteAmountRaw = stage === "review" && reviewed ? (unitsOf(reviewed.paid) ?? amountRaw) : amountRaw;
  /* In Review the agreed figures follow a fresh count of the same trade while nothing is being signed: the build counts once more at the press. */
  const freshSnapshot = stage === "review" && !busy && reviewed ? ticketSnapshot(model, input, lang) : null;
  const freshAt = freshSnapshot && reviewed && freshSnapshot.paid.units === reviewed.paid.units && freshSnapshot.side === reviewed.side ? (freshSnapshot.quote?.at ?? 0) : 0;
  useEffect(() => {
    if (freshSnapshot && freshAt > (reviewed?.quote?.at ?? 0)) {
      setReviewed(freshSnapshot);
      setReviewedQuote(shown);
    }
    // The count's time is the key: a fresh count of the same trade, nothing else, moves what Review shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshAt]);

  /* ------------------------------------------------------------ the quick choices */
  const [quickSums] = useQuickBuySums();
  /* A pair that is not a dollar keeps its own round amounts; a dollar pair takes the person's quick sums, the same as on every page. */
  const quick = useMemo(() => ({ unit: "token" as const, values: (pair.dollar ? quickSums.map(String) : ["1000", "5000", "20000"]) }), [pair.dollar, quickSums]);
  /* A quick sum tapped on a Pulse card (`?buy=`) is this panel's own tap, once, on a dollar pair; the address forgets it. */
  const carriedQuick = useRef(true);
  const [focusTrade, setFocusTrade] = useState(false);
  useEffect(() => {
    if (!carriedQuick.current) return;
    carriedQuick.current = false;
    const url = new URL(window.location.href);
    const usd = quickSum(url.searchParams.get("buy") ?? "");
    if (!url.searchParams.has("buy")) return;
    url.searchParams.delete("buy");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (usd === null || !pair.dollar || paused) return;
    setDraft((current) => ({ ...current, side: "buy", unit: "token", amount: lang === "uk" ? String(usd).replace(".", ",") : String(usd) }));
    setFocusTrade(true);
  }, [pair.dollar, paused, lang]);
  /* The carried sum lands the keyboard on the ticket's own action as soon as it can be pressed. */
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusTrade || !model.ready) return;
    setFocusTrade(false);
    window.requestAnimationFrame(() => {
      const button = panelRef.current?.querySelector<HTMLButtonElement>("[data-ticket-action]");
      if (!button || button.disabled) return;
      button.focus({ preventScroll: true });
      button.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  }, [focusTrade, model.ready]);

  /* ------------------------------------------------------------ the trade */
  const trade = async () => {
    if (!connection) {
      reach();
      return;
    }
    if (!reviewed || amountRaw === null || amountRaw <= 0n) return;
    const ask = unitsOf(reviewed.paid) ?? amountRaw;
    const tradeSide = reviewed.side;
    setFailure(null);
    setPhase("prepare");
    const failed = (answer: Readonly<{ code: string; message: string }>, signed: boolean) => {
      setFailure({ code: answer.code, message: answer.message, signed });
      setPhase("error");
      setStage("result");
    };
    setAgain(false);
    /*
     * Bytes live ~30 s (`lib/solana/blockhash-life.ts`). A signature that comes back later is not sent: the trade is
     * built again and the wallet asked once more — and only when the new minimum and fee are no worse than the first.
     */
    let first: LaunchTradeBuildResponse | null = null;
    const fresh = await signFreshBytes({
      build: async () => {
        setPhase("prepare");
        const started = performance.now();
        const answer = await api<LaunchTradeBuildResponse>(`${base}/trade/build`, { method: "POST", body: JSON.stringify({ wallet: connection.address, side: tradeSide, amountRaw: ask.toString(), slippageBps: reviewed.slippageBps }) });
        measureTradeStep("launch", "prepare", started);
        if (!answer.ok) return answer;
        if (first && (BigInt(answer.data.quote.minimumOutRaw) < BigInt(first.quote.minimumOutRaw) || BigInt(answer.data.quote.fee.totalRaw) > BigInt(first.quote.fee.totalRaw))) {
          return { ok: false as const, code: "LAUNCH_QUOTE_MOVED", message: "" };
        }
        first ??= answer.data;
        return answer;
      },
      signableMsOf: (data) => data.signableMs,
      sign: async (data) => {
        setPhase("sign");
        const started = performance.now();
        const answer = await signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: [data.unsignedWireBase64], chain: data.network });
        measureTradeStep("launch", "sign", started);
        return answer.ok ? { ok: true, value: answer.signedWireBase64 } : answer;
      },
      onRebuild: (why) => setAgain(why === "late"),
    });
    if (!fresh.ok) {
      if (fresh.stage === "build") return failed(fresh.failure, false);
      if (fresh.stage === "sign") return failed({ code: "WALLET_REFUSED", message: fresh.reason }, false);
      return failed({ code: "LAUNCH_BUILD_EXPIRED", message: "" }, false);
    }
    const built = { data: fresh.built };
    const signed = { signedWireBase64: fresh.signed };
    setPhase("send");
    const sendStarted = performance.now();
    const sent = await api<LaunchTradeSubmitResponse>(`${base}/trade/submit`, { method: "POST", body: JSON.stringify({ buildId: built.data.buildId, wallet: connection.address, signedWireBase64: signed.signedWireBase64[0] }) });
    measureTradeStep("launch", "send", sendStarted);
    if (!sent.ok) return failed(sent, true);
    setResult({ side: tradeSide, quote: built.data.quote, submit: sent.data, at: Date.now(), reviewed });
    setReceiptKept(null);
    setPhase("done");
    setStage("result");
    /* The panel asks nothing more for a trade that is done: the next one starts from no sum. */
    setDraft((current) => ({ ...current, amount: "" }));
    onTraded(connection.address);
    void readWallet();
  };

  const errorText = (code: string) =>
    code === "LAUNCH_BALANCE_LOW"
      ? word("errBalance")
      : code === "LAUNCH_GRADUATING"
        ? word("errGraduating")
        : code === "LAUNCH_BUILD_EXPIRED"
          ? word("errTradeExpired")
          : code === "LAUNCH_QUOTE_MOVED"
            ? word("errQuoteMoved")
          : code === "LAUNCH_SLIPPAGE"
            ? word("errSlippage")
            : code === "LAUNCH_SUBMIT_FAILED"
              ? word("errTradeSubmit", { symbol: pair.symbol })
            : code === "LAUNCH_SIGNED_OTHER_BYTES"
              ? word("errSignedOther")
              : code === "WALLET_REFUSED"
                ? word("errWalletRefused")
                : code === "LAUNCH_PAUSED"
                  ? word("errLaunchPaused")
                  : code === "RATE_LIMITED"
                    ? word("errRateLimited")
                    : word("errGeneric");

  const tokens = (raw: string) => formatRaw(raw, market.tokenDecimals, locale, 0);
  const sniper = market.curveFee && market.curveFee.sniperUntil && shown && shown.venue === "curve" && shown.feeBps > market.curveFee.endBps + 5 ? market.curveFee : null;
  const timeOf = (at: number) => new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { hour: "2-digit", minute: "2-digit" }).format(new Date(at));

  /* Launch's stop closed: said in place of the panel, before anything is typed; Swap, its own lane, still trades a graduated token. */
  if (paused) {
    return (
      <Block title={venueWord} titleAs="h2" lang={lang} className={styles.tradeCard}>
        <div className={styles.blockStack}>
          <PausedNote locale={locale} />
          {market.trading.jupiter ? (
            <Link className={styles.markLink} href={`/app/swap?in=${pair.mint}&out=${market.token}`}>
              {word("jupiter")}
            </Link>
          ) : null}
        </div>
      </Block>
    );
  }

  /* ------------------------------------------------------------ the result, in the ticket's words */
  let ticketResult: TicketResult | undefined;
  if (stage === "result" && phase === "done" && result) {
    const bought = result.side === "buy";
    const confirmed = result.submit.state === "CONFIRMED";
    const filled = result.submit.filled;
    const pay = bought ? pairCoin : tokenCoin;
    const get = bought ? tokenCoin : pairCoin;
    ticketResult = {
      state: confirmed ? "filled" : "sent",
      time: timeOf(result.at),
      tx: result.submit.signature,
      /* The chain's figures when its transaction was read: the receipt then speaks for itself. */
      ...(confirmed && filled
        ? {
            receipt: settledReceipt({
              intentId: result.submit.signature,
              venueId: market.venue,
              marketId: market.token,
              side: result.side,
              state: "filled",
              paid: result.reviewed.paid,
              expected: result.reviewed.expected,
              atLeast: result.reviewed.atLeast,
              actualIn: rawAmount(bought ? filled.pairRaw : filled.tokensRaw, pay),
              actualOut: rawAmount(bought ? filled.tokensRaw : filled.pairRaw, get),
              fees: result.reviewed.fees,
              signature: result.submit.signature,
              signer: wallet ?? "",
              executor: "Meteora",
              at: result.at,
            }),
          }
        : {}),
    };
  } else if (stage === "result" && phase === "error" && failure) {
    /* The person's own «cancel» in the wallet is not a failure: said plainly, nothing was sent. */
    ticketResult = {
      state: "rejected",
      time: timeOf(Date.now()),
      reason: failure.code === "WALLET_REFUSED" ? word("walletCancelled") : errorText(failure.code),
      ...(failure.signed ? {} : { signed: false }),
    };
  }

  const confirmed = result?.submit.state === "CONFIRMED";
  const shareLink = phase === "done" && result && confirmed ? (result.submit.shareLink ?? null) : null;
  const tokensText = result ? (result.submit.filled ? tokens(result.submit.filled.tokensRaw) : `≈ ${tokens(result.side === "buy" ? result.quote.amountOutRaw : result.quote.amountInRaw)}`) : "";

  return (
    <Block title={venueWord} titleAs="h2" lang={lang} className={styles.tradeCard} {...(phase === "done" ? { "aria-live": "polite" as const, "data-trade-done": true } : {})}>
      <div className={styles.blockStack} ref={panelRef}>
        {stage === "form" && amountRaw !== null && amountRaw > 0n && shown ? (
          <>
            {sniper ? (
              <p className={styles.sniperLine}>
                <Warning size={16} weight="fill" aria-hidden />
                {word("feeSniper", {
                  fee: formatBps(shown.feeBps, locale),
                  end: formatBps(sniper.endBps, locale),
                  /* A time of day in the reader's zone once the page has hydrated; the server's draw says it in UTC (SOL-P1). */
                  time: new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { hour: "2-digit", minute: "2-digit", ...(hydrated ? {} : { timeZone: "UTC" }) }).format(new Date(sniper.sniperUntil as string)),
                })}
              </p>
            ) : null}
          </>
        ) : null}
        {/* The curve fills first: said on the form and again on Review, over the very count Review shows. */}
        {(stage === "form" || stage === "review") && noteAmountRaw !== null && noteAmountRaw > 0n && reviewData && BigInt(reviewData.amountLeftRaw) > 0n ? (
          <p className={styles.sniperLine} data-partial-fill>
            <Warning size={16} weight="fill" aria-hidden />
            {word("partialFill", { spent: formatRaw(reviewData.amountInRaw, pair.decimals, locale, 2), amount: formatRaw(noteAmountRaw, pair.decimals, locale, 2), symbol: pair.symbol })}
          </p>
        ) : null}

        {/* The core's ticket: the form, Review over what was agreed to, then the wallet and the result. */}
        <TradeTicket
          quietLegs
          {...input}
          className={quote.loading && stage === "form" && shown ? styles.reviewStale : undefined}
          venue="Meteora"
          network={market.network === "solana:devnet" ? "Solana Devnet" : NETWORK_LABEL}
          quick={side === "buy" ? quick : undefined}
          stage={stage}
          reviewed={reviewed ?? undefined}
          signer={connection ? shortAddress(connection.address) : word("signerConnect")}
          signing={busy}
          cancelWhileSigning={false}
          result={ticketResult}
          {...countOf(reviewData)}
          reviewRows={reviewRows}
          whatItIs={market.venue === "curve" ? word("whatCurve", { symbol }) : word("whatPool", { symbol })}
          titleAs="h3"
          lang={lang}
          onDraftChange={(next) => {
            /* A new side starts from nothing, as the person's own; the core keeps the tolerance and the unit. */
            setDraft(next.side !== draft.side ? { ...next, amount: "" } : next);
            if (phase === "error") setPhase("idle");
          }}
          onRetryQuote={() => setQuoteRound((round) => round + 1)}
          onConnect={() => reach()}
          onReview={() => {
            if (!ready) return;
            const snapshot = ticketSnapshot(model, input, lang);
            if (!snapshot) return;
            setReviewed(snapshot);
            setReviewedQuote(shown);
            setStage("review");
          }}
          onCancel={() => {
            if (busy) return;
            setReviewed(null);
            setReviewedQuote(null);
            setStage("form");
          }}
          onConfirm={() => void trade()}
          onVerify={result ? () => window.open(explorerUrl(market.network, "tx", result.submit.signature), "_blank", "noopener,noreferrer") : undefined}
          onAgain={() => {
            setPhase("idle");
            setFailure(null);
            setReviewed(null);
            setReviewedQuote(null);
            setStage("form");
            /* After a trade that went through the form starts empty; after one that failed the amount stays for another try. */
            if (phase !== "error") setDraft((current) => ({ ...current, amount: "" }));
          }}
        />

        {busy ? (
          <p className={styles.tradeStep} aria-live="polite">
            <CircleNotch size={16} className={styles.spin} aria-hidden />
            {phase === "prepare" ? word("stepPrepareTrade") : phase === "sign" ? word(again ? "stepSignAgain" : "stepSign") : word("stepSendTrade")}
          </p>
        ) : null}

        {stage === "result" && phase === "error" && failure?.message ? (
          /* What the venue said, word for word, a tap away. */
          <details className={styles.details}>
            <summary className={styles.summary}>{word("errDetails")}</summary>
            <p className={styles.failureDetail}>{failure.message}</p>
          </details>
        ) : null}

        {stage === "result" && phase === "done" && result ? (
          <>
            <p className={styles.hint}>{confirmed ? word("tradeDoneLine") : word("tradePendingLine")}</p>
            {/* A receipted trade's «Receipt»: the receipt itself once it is kept on this device, its row in History (where
                the receipt opens too) for the moment before; a trade not read yet is «In History», where it settles. */}
            <Link
              className={styles.markLink}
              href={
                receiptKept === result.submit.signature
                  ? `/app/receipts?action=${encodeURIComponent(result.submit.signature)}`
                  : `/app/activity?action=${encodeURIComponent(result.submit.signature)}`
              }
            >
              {result.submit.receiptHash ? word("tradeReceipt") : word("tradeInHistory")} <ArrowRight size={14} aria-hidden />
            </Link>
            {!confirmed ? (
              /* Sent, not read yet: the core's result is not final, so the way on is the panel's own — the transaction on
                 the explorer, and another trade — as it always was. */
              <div className={styles.tradeActions}>
                <Button variant="secondary" onClick={() => window.open(explorerUrl(market.network, "tx", result.submit.signature), "_blank", "noopener,noreferrer")} lang={lang}>
                  {word("viewTx")}
                </Button>
                <Button
                  variant="secondary"
                  icon="arrow-down-up"
                  onClick={() => {
                    setPhase("idle");
                    setFailure(null);
                    setReviewed(null);
                    setReviewedQuote(null);
                    setStage("form");
                  }}
                  lang={lang}
                >
                  {word("tradeAgain")}
                </Button>
              </div>
            ) : null}
            {shareLink ? (
              <ShareLink
                link={shareLink}
                symbol={symbol}
                locale={locale}
                label={word("shareTrade")}
                /* The chain's figure, or none: a quote's «≈» is never posted as what happened. */
                text={result.submit.filled ? word(result.side === "buy" ? "shareTradeBuy" : "shareTradeSell", { tokens: tokensText, symbol }) : word(result.side === "buy" ? "shareTradeBuyPlain" : "shareTradeSellPlain", { symbol })}
                compact
              />
            ) : null}
          </>
        ) : null}

        {market.trading.jupiter ? (
          <span className={styles.tradeLinks}>
            <Link className={styles.markLink} href={`/app/swap?in=${side === "buy" ? pair.mint : market.token}&out=${side === "buy" ? market.token : pair.mint}`}>
              {word("jupiter")}
            </Link>
            {/* The same token in Spot, which links back here: one token, two terminals that name each other (SOL-C10, UX-403). */}
            <Link className={styles.markLink} href={`/app/spot?mint=${market.token}`}>
              {word("openInSpot")}
            </Link>
          </span>
        ) : null}
      </div>
    </Block>
  );
}

/**
 * Every part of a trade's fee on its own line. On the curve: the creator, Ryntra, Meteora. In the pool the liquidity's
 * part is split as the pool shares it — the creator's locked position, Ryntra's (with its referral and terminal fee),
 * the pool's other positions, the share compounded back — and, when the pool's liquidity was not read, said whole. The
 * positions' parts follow the pool's liquidity at the quote, so they are said with «≈»; the total stays exact.
 */
function feeLines(fee: LaunchTradeQuoteResponse["fee"], word: ReturnType<typeof launchWords>, cost: (raw: string) => string): { label: string; value: string }[] {
  if (fee.creatorRaw !== null) {
    return [
      { label: word("costCreator"), value: cost(fee.creatorRaw) },
      { label: word("costRyntra"), value: cost(fee.ryntraRaw) },
      { label: word("costMeteora"), value: cost(fee.meteoraRaw) },
    ];
  }
  const split = fee.liquidity ?? null;
  if (!split) {
    return [
      { label: word("costLiquidity"), value: cost(fee.liquidityRaw ?? "0") },
      { label: word("costRyntra"), value: cost(fee.ryntraRaw) },
      { label: word("costMeteora"), value: cost(fee.meteoraRaw) },
    ];
  }
  return [
    { label: word("costCreatorLocked"), value: `≈ ${cost(split.creatorRaw)}` },
    { label: word("costRyntra"), value: `≈ ${cost((BigInt(fee.ryntraRaw) + BigInt(split.ryntraRaw)).toString())}` },
    ...(BigInt(split.othersRaw) > 0n ? [{ label: word("costOtherLps"), value: `≈ ${cost(split.othersRaw)}` }] : []),
    { label: word("costCompounding"), value: cost(split.compoundingRaw) },
    { label: word("costMeteora"), value: cost(fee.meteoraRaw) },
  ];
}
