"use client";

import { ArrowCounterClockwise, ArrowRight, ArrowSquareOut, CaretDown, CheckCircle, CircleNotch, Clock, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import type { LaunchMarketResponse, LaunchTradeBuildResponse, LaunchTradeQuoteResponse, LaunchTradeSubmitResponse, LaunchWalletResponse } from "@/lib/api/v1/contract";
import { storeBoundSolanaReceipt } from "@/lib/solana/send-receipt-vault.client";
import { signTransactions } from "@/lib/solana/wallet.client";

import { explorerUrl, formatBps, formatMoneyShort, formatMove, formatNumber, formatPercent, formatRaw, fromRaw, rovingNext, toRaw } from "../launch-format";
import { launchWords } from "../launch-words";
import styles from "../launch.module.css";
import { PausedNote } from "../paused-note";
import { ShareLink } from "../share-link";

/**
 * Buy and sell a launch: on its curve by Meteora DBC's own swap, after
 * graduation in its DAMM v2 pool. Drawn for 390 px first — the side, the
 * amount with its quick choices, what the trade gets and costs, one orange
 * action — and kept beside the chart on a desk.
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
const SLIPPAGES = [50, 100, 300, 500] as const;
const SIDES = ["buy", "sell"] as const;

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
  const { connection } = useSolanaConnection();
  const { reach } = useWalletReach();
  const ids = { amount: useId(), slip: useId() };
  const [side, setSide] = useState<Side>("buy");
  const [text, setText] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(100);
  const [held, setHeld] = useState<LaunchWalletResponse | null>(null);
  const [quote, setQuote] = useState<{ key: string; data: LaunchTradeQuoteResponse | null; code: string | null; loading: boolean }>({ key: "", data: null, code: null, loading: false });
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const [result, setResult] = useState<{ side: Side; quote: LaunchTradeQuoteResponse; submit: LaunchTradeSubmitResponse } | null>(null);
  /* The trade's receipt kept on this device, as a swap's is: the receipt link then opens the receipt itself. */
  const [receiptKept, setReceiptKept] = useState<string | null>(null);

  const pair = market.pair;
  const decimals = side === "buy" ? pair.decimals : market.tokenDecimals;
  const unit = side === "buy" ? pair.symbol : `$${symbol}`;
  const amountRaw = toRaw(text, decimals);
  const wallet = connection?.address ?? null;
  const base = `/api/v1/launch/${market.token}`;
  const spendable = held ? BigInt(side === "buy" ? held.pairRaw : held.tokenRaw) : null;
  const over = amountRaw !== null && spendable !== null && amountRaw > spendable;
  const busy = phase === "prepare" || phase === "sign" || phase === "send";

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

  /* The trade counted as the amount is typed: what it gets, the fee and who receives it. */
  const key = `${side}:${amountRaw ?? "x"}:${slippageBps}:${market.observedAt}`;
  useEffect(() => {
    if (amountRaw === null || amountRaw <= 0n) {
      setQuote({ key, data: null, code: null, loading: false });
      return;
    }
    setQuote((current) => ({ key, data: current.data, code: null, loading: true }));
    const timer = window.setTimeout(async () => {
      const read = await api<LaunchTradeQuoteResponse>(`${base}/trade/quote`, { method: "POST", body: JSON.stringify({ side, amountRaw: amountRaw.toString(), slippageBps }) });
      setQuote((current) => (current.key === key ? { key, data: read.ok ? read.data : null, code: read.ok ? null : read.code, loading: false } : current));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [key, amountRaw, side, slippageBps, base]);

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
  const presets = useMemo(() => (side === "buy" ? (pair.dollar ? ["10", "50", "100"] : ["1000", "5000", "20000"]) : ["25", "50", "100"]), [side, pair.dollar]);

  const choose = (value: string) => {
    if (side === "buy") return setText(value);
    if (!held) return;
    const raw = (BigInt(held.tokenRaw) * BigInt(value)) / 100n;
    setText(fromRaw(raw, market.tokenDecimals));
  };

  const trade = async () => {
    if (!connection) {
      reach();
      return;
    }
    if (amountRaw === null || amountRaw <= 0n || over) return;
    setFailure(null);
    setPhase("prepare");
    const failed = (answer: Readonly<{ code: string; message: string }>) => {
      setFailure({ code: answer.code, message: answer.message });
      setPhase("error");
    };
    const built = await api<LaunchTradeBuildResponse>(`${base}/trade/build`, { method: "POST", body: JSON.stringify({ wallet: connection.address, side, amountRaw: amountRaw.toString(), slippageBps }) });
    if (!built.ok) return failed(built);
    setPhase("sign");
    const signed = await signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: [built.data.unsignedWireBase64], chain: built.data.network });
    if (!signed.ok) return failed({ code: "WALLET_REFUSED", message: signed.reason });
    setPhase("send");
    const sent = await api<LaunchTradeSubmitResponse>(`${base}/trade/submit`, { method: "POST", body: JSON.stringify({ buildId: built.data.buildId, wallet: connection.address, signedWireBase64: signed.signedWireBase64[0] }) });
    if (!sent.ok) return failed(sent);
    setResult({ side, quote: built.data.quote, submit: sent.data });
    setReceiptKept(null);
    setPhase("done");
    setText("");
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

  /* Two places for money; a sum too small for them is «< 0.01», never a false zero. */
  const places = Math.min(2, pair.decimals);
  const money = (raw: string) =>
    BigInt(raw) > 0n && BigInt(raw) < 10n ** BigInt(pair.decimals - places)
      ? `< ${formatNumber(10 ** -places, locale, places)} ${pair.symbol}`
      : `${formatRaw(raw, pair.decimals, locale, places)} ${pair.symbol}`;
  const tokens = (raw: string) => formatRaw(raw, market.tokenDecimals, locale, 0);
  const capText = (value: { pair: number; usd: number | null }) => formatMoneyShort(value.usd ?? value.pair, locale, value.usd !== null, pair.symbol);
  const sniper = market.curveFee && market.curveFee.sniperUntil && shown && shown.venue === "curve" && shown.feeBps > market.curveFee.endBps + 5 ? market.curveFee : null;

  /* Launch's stop closed: said in place of the panel, before anything is typed; Swap, its own lane, still trades a graduated token. */
  if (paused) {
    return (
      <section className={`${styles.card} ${styles.tradeCard}`}>
        <PausedNote locale={locale} />
        {market.trading.jupiter ? (
          <Link className={styles.markLink} href={`/app/swap?in=${pair.mint}&out=${market.token}`}>
            {word("jupiter")}
          </Link>
        ) : null}
      </section>
    );
  }

  if (phase === "done" && result) {
    const bought = result.side === "buy";
    const confirmed = result.submit.state === "CONFIRMED";
    /* The tokens the chain says moved; the quote's figure, marked «≈», only while the transaction could not be read. */
    const tokensText = result.submit.filled ? tokens(result.submit.filled.tokensRaw) : `≈ ${tokens(bought ? result.quote.amountOutRaw : result.quote.amountInRaw)}`;
    const shareLink = confirmed ? (result.submit.shareLink ?? null) : null;
    return (
      <section className={`${styles.card} ${styles.tradeCard}`} aria-live="polite" data-trade-done>
        <div className={styles.tradeDone}>
          {confirmed ? <CheckCircle size={28} weight="fill" className={styles.tradeDoneIcon} aria-hidden /> : <Clock size={28} className={styles.tradePendingIcon} aria-hidden />}
          <h2 className={styles.tradeDoneTitle}>
            {confirmed
              ? word(bought ? "boughtTitle" : "soldTitle", { tokens: tokensText, symbol })
              : word("tradePendingTitle")}
          </h2>
          {confirmed ? (
            /* The chain's figure when its transaction was read; the quote's, marked «≈», until then. */
            <p className={styles.tradeDoneAmount}>
              {result.submit.filled
                ? bought
                  ? `−${money(result.submit.filled.pairRaw)}`
                  : `+${money(result.submit.filled.pairRaw)}`
                : bought
                  ? `≈ −${money(result.quote.amountInRaw)}`
                  : `≈ +${money(result.quote.amountOutRaw)}`}
            </p>
          ) : null}
          <p className={styles.hint}>{confirmed ? word("tradeDoneLine") : word("tradePendingLine")}</p>
          <div className={styles.tradeLinks}>
            <a className={styles.markLink} href={explorerUrl(market.network, "tx", result.submit.signature)} target="_blank" rel="noreferrer noopener">
              {word("viewTx")} <ArrowSquareOut size={14} aria-hidden />
            </a>
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
          </div>
        </div>
        {shareLink ? (
          <ShareLink
            link={shareLink}
            symbol={symbol}
            locale={locale}
            label={word("shareTrade")}
            /* The chain's figure, or none: a quote's «≈» is never posted as what happened. */
            text={result.submit.filled ? word(bought ? "shareTradeBuy" : "shareTradeSell", { tokens: tokensText, symbol }) : word(bought ? "shareTradeBuyPlain" : "shareTradeSellPlain", { symbol })}
            compact
          />
        ) : null}
        <button type="button" className={styles.tradeAgain} onClick={() => setPhase("idle")}>
          <ArrowCounterClockwise size={16} aria-hidden />
          {word("tradeAgain")}
        </button>
      </section>
    );
  }

  return (
    <section className={`${styles.card} ${styles.tradeCard}`} aria-labelledby={`${ids.amount}-title`}>
      <div className={styles.tradeHead}>
        <div
          className={styles.sideSwitch}
          role="radiogroup"
          aria-label={`${word("buy")} / ${word("sell")}`}
          onKeyDown={(event) => {
            /* A radio group moves with the arrows, Home and End. */
            const next = busy ? null : rovingNext(SIDES, side, event.key, true);
            if (!next) return;
            event.preventDefault();
            if (next !== side) {
              setSide(next);
              setText("");
              setPhase("idle");
            }
            (event.currentTarget.querySelector(`[data-side="${next}"]`) as HTMLButtonElement | null)?.focus();
          }}
        >
          {SIDES.map((entry) => (
            <button
              key={entry}
              type="button"
              role="radio"
              aria-checked={side === entry}
              tabIndex={side === entry ? 0 : -1}
              className={styles.sideOption}
              data-side={entry}
              disabled={busy}
              onClick={() => {
                setSide(entry);
                setText("");
                setPhase("idle");
              }}
            >
              {word(entry)}
            </button>
          ))}
        </div>
        <span id={`${ids.amount}-title`} className={styles.tradeVenue}>
          {market.venue === "curve" ? word("tradeOnCurve") : word("tradeInPool")}
        </span>
      </div>

      <div className={styles.field}>
        <div className={styles.labelRow}>
          <label className={styles.label} htmlFor={ids.amount}>
            {word("amount")}
          </label>
          {held ? (
            <span className={styles.count}>
              {word("balance", { amount: side === "buy" ? formatRaw(held.pairRaw, pair.decimals, locale, 2) : formatRaw(held.tokenRaw, market.tokenDecimals, locale, 0), symbol: unit })}
            </span>
          ) : null}
        </div>
        <div className={styles.affixed}>
          <input
            id={ids.amount}
            className={`${styles.input} ${styles.mono}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={text}
            disabled={busy}
            aria-invalid={over || amountRaw === null ? true : undefined}
            onChange={(event) => setText(event.target.value)}
          />
          <span className={styles.suffix}>{unit}</span>
        </div>
        <div className={styles.quickRow}>
          {presets.map((value) => (
            <button key={value} type="button" className={styles.quick} disabled={busy || (side === "sell" && !held)} onClick={() => choose(value)}>
              {side === "buy" ? (pair.dollar ? `$${value}` : `${formatNumber(Number(value), locale)}`) : value === "100" ? word("max") : formatPercent(Number(value), locale, 0)}
            </button>
          ))}
        </div>
        {over ? <p className={styles.problem}>{word("moreThanHeld")}</p> : amountRaw === null ? <p className={styles.problem}>{word("errAmount")}</p> : null}
        <div className={styles.slipRow}>
          <span id={ids.slip} className={styles.slipLabel}>
            {word("slippage")}
          </span>
          <div
            className={styles.slipGroup}
            role="radiogroup"
            aria-labelledby={ids.slip}
            onKeyDown={(event) => {
              const next = busy ? null : rovingNext(SLIPPAGES, slippageBps as (typeof SLIPPAGES)[number], event.key, true);
              if (next === null) return;
              event.preventDefault();
              setSlippageBps(next);
              (event.currentTarget.querySelector(`[data-slip="${next}"]`) as HTMLButtonElement | null)?.focus();
            }}
          >
            {SLIPPAGES.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={slippageBps === value}
                tabIndex={slippageBps === value ? 0 : -1}
                className={styles.slip}
                data-slip={value}
                disabled={busy}
                onClick={() => setSlippageBps(value)}
              >
                {formatBps(value, locale)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {amountRaw !== null && amountRaw > 0n ? (
        <div className={styles.quoteBox} aria-live="polite" aria-busy={quote.loading}>
          {shown ? (
            <>
              <div className={styles.quoteMain}>
                <span className={styles.quoteLabel}>{word("youGet")}</span>
                <span className={styles.quoteValue}>{side === "buy" ? `≈ ${tokens(shown.amountOutRaw)} $${symbol}` : `≈ ${money(shown.amountOutRaw)}`}</span>
                <span className={styles.quoteSub}>
                  {word("atLeast", { amount: side === "buy" ? `${tokens(shown.minimumOutRaw)} $${symbol}` : money(shown.minimumOutRaw) })}
                </span>
              </div>
              {sniper ? (
                <p className={styles.sniperLine}>
                  <Warning size={16} weight="fill" aria-hidden />
                  {word("feeSniper", {
                    fee: formatBps(shown.feeBps, locale),
                    end: formatBps(sniper.endBps, locale),
                    time: new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { hour: "2-digit", minute: "2-digit" }).format(new Date(sniper.sniperUntil as string)),
                  })}
                </p>
              ) : null}
              {BigInt(shown.amountLeftRaw) > 0n ? (
                <p className={styles.sniperLine}>
                  <Warning size={16} weight="fill" aria-hidden />
                  {word("partialFill", { spent: formatRaw(shown.amountInRaw, pair.decimals, locale, 2), amount: formatRaw(amountRaw, pair.decimals, locale, 2), symbol: pair.symbol })}
                </p>
              ) : null}
              <dl className={styles.rows}>
                <div className={styles.row}>
                  <dt>{word("fee")}</dt>
                  <dd className={styles.mono}>
                    {formatBps(shown.feeBps, locale)} · {money(shown.fee.totalRaw)}
                  </dd>
                </div>
                <div className={styles.row}>
                  <dt>{word("feeRyntra")}</dt>
                  <dd className={styles.mono}>{money(shown.fee.ryntraRaw)}</dd>
                </div>
                <div className={styles.row}>
                  <dt>{word("capAfter")}</dt>
                  <dd className={styles.mono}>{capText(shown.marketCapAfter)}</dd>
                </div>
              </dl>
              <details className={styles.details}>
                <summary className={styles.summary}>
                  {shown.priceMoveBps >= 0 ? word("priceUp", { pct: formatMove(shown.priceMoveBps, locale).replace(/^[+−]/, "") }) : word("priceDown", { pct: formatMove(shown.priceMoveBps, locale).replace(/^[+−]/, "") })}
                  <CaretDown size={14} aria-hidden className={styles.caret} />
                </summary>
                <p className={styles.hint}>
                  {shown.fee.creatorRaw !== null
                    ? word("feeSplitCurve", { creator: money(shown.fee.creatorRaw), ryntra: money(shown.fee.ryntraRaw), meteora: money(shown.fee.meteoraRaw) })
                    : word("feeSplitPool", { liquidity: money(shown.fee.liquidityRaw ?? "0"), ryntra: money(shown.fee.ryntraRaw), meteora: money(shown.fee.meteoraRaw) })}
                </p>
              </details>
            </>
          ) : quote.loading ? (
            <p className={styles.hint}>
              <CircleNotch size={14} className={styles.spin} aria-hidden /> {word("tradeCounting")}
            </p>
          ) : quote.code ? (
            <p className={styles.problem}>{quote.code === "LAUNCH_GRADUATING" ? word("errGraduating") : word("errQuote")}</p>
          ) : null}
        </div>
      ) : null}

      {/* The person's own «cancel» in the wallet is not a failure: said plainly, in no warning colour. */}
      {phase === "error" && failure?.code === "WALLET_REFUSED" ? (
        <p className={styles.cancelled} role="status">
          {word("walletCancelled")}
        </p>
      ) : phase === "error" && failure ? (
        <div className={styles.failure} role="alert">
          <p className={styles.failureTitle}>
            <Warning size={18} weight="fill" aria-hidden />
            {word("errTradeTitle")}
          </p>
          <p className={styles.failureText}>{errorText(failure.code)}</p>
          {failure.message ? (
            <details className={styles.details}>
              <summary className={styles.summary}>
                {word("errDetails")} <CaretDown size={14} aria-hidden className={styles.caret} />
              </summary>
              <p className={styles.failureDetail}>{failure.message}</p>
            </details>
          ) : null}
        </div>
      ) : null}

      {busy ? (
        <p className={styles.tradeStep} aria-live="polite">
          <CircleNotch size={16} className={styles.spin} aria-hidden />
          {phase === "prepare" ? word("stepPrepareTrade") : phase === "sign" ? word("stepSign") : word("stepSendTrade")}
        </p>
      ) : null}

      <button
        type="button"
        className="rw-btn rw-btn--primary"
        disabled={busy || (Boolean(connection) && (amountRaw === null || amountRaw <= 0n || over || !shown))}
        onClick={trade}
      >
        {!connection ? word("connectToTrade") : side === "buy" ? word("buyAction", { symbol }) : word("sellAction", { symbol })}
      </button>
      {market.trading.jupiter ? (
        <Link className={styles.markLink} href={`/app/swap?in=${side === "buy" ? pair.mint : market.token}&out=${side === "buy" ? market.token : pair.mint}`}>
          {word("jupiter")}
        </Link>
      ) : null}
    </section>
  );
}
