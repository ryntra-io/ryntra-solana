"use client";

import { ArrowSquareOut, CaretDown, CheckCircle, CircleNotch, Clock, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { Block, Button, Review } from "@ryntra/core/ui";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import type {
  LaunchHolderBuildResponse,
  LaunchHolderPermissionBuildResponse,
  LaunchHolderPermissionSubmitResponse,
  LaunchHolderPositionView,
  LaunchHolderQuoteResponse,
  LaunchHolderResponse,
  LaunchHolderSubmitResponse,
  LaunchMarketResponse,
  LaunchWalletResponse,
} from "@/lib/api/v1/contract";
import { poolOutcomes } from "@/lib/core/launch/holder";
import { signFreshBytes } from "@/lib/solana/sign-fresh";
import { signTransactions } from "@/lib/solana/wallet.client";
import { reviewNetworkFrom, reviewWord } from "@/lib/ticket/review-words";

import { coreLang } from "../launch-blocks";
import { explorerUrl, formatBps, formatDate, formatMove, formatNumber, formatRaw, formatWhen, fromRaw, rovingNext, toRaw } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";

/**
 * «Додати ліквідність» — a holder's position in a graduated launch's pool
 * (the decision of 2026-10-07: Ryntra's collector pays the fees to
 * the owner's wallet). Drawn for 390 px first: one coin and its amount, what
 * the position will hold, Ryntra's fee at entry, the collector and its bounds,
 * the price-move simulator and «Це не депозит» before the one orange action;
 * then the wallet's positions here, each with what it earned and «Відкликати».
 *
 * The card draws nothing until the server says the entry is open or the
 * wallet already holds a position here: open to everyone with the switch on;
 * off, only an operator's wallet its sign-in proved.
 */

type Phase = "idle" | "prepare" | "sign" | "send" | "done" | "error";
type Answer<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
type Side = "pair" | "token";
type Word = ReturnType<typeof launchWords>;

const API_HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;
const SIDES = ["pair", "token"] as const;
const SLIPPAGE_BPS = 100;

async function api<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  try {
    const response = await fetch(path, { cache: "no-store", ...init, headers: { ...API_HEADERS, ...(init?.headers ?? {}) } });
    const body = (await response.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    if (!response.ok) return { ok: false, code: body?.error?.code ?? "UNAVAILABLE", message: body?.error?.message ?? "" };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: "" };
  }
}

/** An amount of the pair to the cent: «$4,92» · «< $0,01» — a sum too small is never a false zero. */
function pairMoney(raw: string | bigint, pair: LaunchHolderResponse["pair"], locale: WorkspaceLocale): string {
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  if (abs > 0n && abs < 10n ** BigInt(Math.max(0, pair.decimals - 2))) return `${negative ? "−" : ""}< ${pair.dollar ? "$" : ""}${formatNumber(0.01, locale, 2)}${pair.dollar ? "" : ` ${pair.symbol}`}`;
  const text = formatRaw(abs, pair.decimals, locale, 2);
  return `${negative ? "−" : ""}${pair.dollar ? `$${text}` : `${text} ${pair.symbol}`}`;
}

export function PoolPanel({
  market,
  symbol,
  locale,
  paused = false,
  collectorRuns = null,
}: {
  market: LaunchMarketResponse;
  symbol: string;
  locale: WorkspaceLocale;
  paused?: boolean;
  /** Whether Ryntra's collector makes its rounds now — the freshness of the executor's passes; null while not read. */
  collectorRuns?: boolean | null;
}) {
  const word = launchWords(locale);
  const { connection } = useSolanaConnection();
  const { reach } = useWalletReach();
  const ids = { amount: useId(), coin: useId() };
  const wallet = connection?.address ?? null;
  const base = `/api/v1/launch/${market.token}`;
  const [holder, setHolder] = useState<{ wallet: string; data: LaunchHolderResponse } | null>(null);
  const [held, setHeld] = useState<LaunchWalletResponse | null>(null);
  const [side, setSide] = useState<Side>("pair");
  const [text, setText] = useState("");
  const [quote, setQuote] = useState<{ key: string; data: LaunchHolderQuoteResponse | null; code: string | null; loading: boolean }>({ key: "", data: null, code: null, loading: false });
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const [entered, setEntered] = useState<LaunchHolderSubmitResponse | null>(null);

  const read = useCallback(async () => {
    if (!wallet) return;
    const [answer, balances] = await Promise.all([api<LaunchHolderResponse>(`${base}/holder/${wallet}`), api<LaunchWalletResponse>(`${base}/wallet/${wallet}`)]);
    if (answer.ok) setHolder({ wallet, data: answer.data });
    setHeld(balances.ok ? balances.data : null);
  }, [wallet, base]);

  useEffect(() => {
    setHolder(null);
    void read();
  }, [read]);

  const data = holder && holder.wallet === wallet ? holder.data : null;
  const pair = data?.pair ?? null;
  const decimals = side === "pair" ? (pair?.decimals ?? 6) : (data?.tokenDecimals ?? market.tokenDecimals);
  const amountRaw = toRaw(text, decimals);
  const spendable = held ? BigInt(side === "pair" ? held.pairRaw : held.tokenRaw) : null;
  const over = amountRaw !== null && spendable !== null && amountRaw > spendable;
  const busy = phase === "prepare" || phase === "sign" || phase === "send";
  /* The bytes were built a second time: the first signature came back after they had aged (AG-1). */
  const [again, setAgain] = useState(false);

  /* The entry counted as the amount is typed. */
  const key = `${side}:${amountRaw ?? "x"}:${data?.observedAt ?? ""}`;
  useEffect(() => {
    if (!wallet || !data?.open || amountRaw === null || amountRaw <= 0n || over) {
      setQuote({ key, data: null, code: null, loading: false });
      return;
    }
    /* A figure of another amount is never shown under this one: the box waits for this amount's own quote. */
    setQuote({ key, data: null, code: null, loading: true });
    const timer = window.setTimeout(async () => {
      const answer = await api<LaunchHolderQuoteResponse>(`${base}/holder/quote`, { method: "POST", body: JSON.stringify({ wallet, input: side, amountRaw: amountRaw.toString(), slippageBps: SLIPPAGE_BPS }) });
      setQuote((current) => (current.key === key ? { key, data: answer.ok ? answer.data : null, code: answer.ok ? null : answer.code, loading: false } : current));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [key, amountRaw, side, wallet, data?.open, base, over]);

  const shown = quote.key === key && !over ? quote.data : null;
  const deposit = useMemo(() => (shown && pair ? Number(fromRaw(shown.quote.positionValuePairRaw, pair.decimals)) : null), [shown, pair]);

  /* A pending entry the next read shows confirmed is said as confirmed. */
  const confirmedNow = entered?.state === "PENDING" && data?.positions.some((position) => position.position === entered.position && !position.pending);
  useEffect(() => {
    if (confirmedNow && entered) setEntered({ ...entered, state: "CONFIRMED" });
  }, [confirmedNow, entered]);

  /* Nothing of the entry for a wallet it is not open to, unless the wallet already holds a position here. */
  if (!wallet || !data || !pair || (!data.open && data.positions.length === 0)) return null;

  const enter = async () => {
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
    setAgain(false);
    /* Bytes live ~30 s (`lib/solana/blockhash-life.ts`): signed later, the entry is built again — never with a higher fee. */
    let first: LaunchHolderBuildResponse | null = null;
    const fresh = await signFreshBytes({
      build: async () => {
        setPhase("prepare");
        const answer = await api<LaunchHolderBuildResponse>(`${base}/holder/build`, { method: "POST", body: JSON.stringify({ wallet: connection.address, input: side, amountRaw: amountRaw.toString(), slippageBps: SLIPPAGE_BPS }) });
        if (!answer.ok) return answer;
        if (first && BigInt(answer.data.quote.feeRaw) > BigInt(first.quote.feeRaw)) return { ok: false as const, code: "LAUNCH_QUOTE_MOVED", message: "" };
        first ??= answer.data;
        return answer;
      },
      signableMsOf: (data) => data.signableMs,
      sign: async (data) => {
        setPhase("sign");
        const answer = await signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: [data.unsignedWireBase64], chain: data.network });
        return answer.ok ? { ok: true, value: answer.signedWireBase64 } : answer;
      },
      onRebuild: (why) => setAgain(why === "late"),
    });
    if (!fresh.ok) {
      if (fresh.stage === "build") return failed(fresh.failure);
      if (fresh.stage === "sign") return failed({ code: "WALLET_REFUSED", message: fresh.reason });
      return failed({ code: "LAUNCH_BUILD_EXPIRED", message: "" });
    }
    const built = { data: fresh.built };
    const signed = { signedWireBase64: fresh.signed };
    setPhase("send");
    const sent = await api<LaunchHolderSubmitResponse>(`${base}/holder/submit`, { method: "POST", body: JSON.stringify({ buildId: built.data.buildId, wallet: connection.address, signedWireBase64: signed.signedWireBase64[0] }) });
    if (!sent.ok) return failed(sent);
    setEntered(sent.data);
    setPhase("done");
    setText("");
    void read();
  };

  const errorText = (code: string): string =>
    code === "LAUNCH_BALANCE_LOW"
      ? word("errBalance")
      : code === "LAUNCH_HOLDER_CLOSED"
        ? word("errHolderClosed")
        : code === "LAUNCH_NOT_GRADUATED"
          ? word("errNotGraduated")
          : code === "LAUNCH_BUILD_EXPIRED"
            ? word("errTradeExpired")
            : code === "LAUNCH_QUOTE_MOVED"
              ? word("errQuoteMoved")
            : code === "LAUNCH_SLIPPAGE"
              ? word("errEntrySlippage")
              : code === "LAUNCH_SUBMIT_FAILED"
                ? word("errEntrySubmit")
                : code === "LAUNCH_SIGNED_OTHER_BYTES"
                  ? word("errSignedOther")
                  : code === "LAUNCH_PAUSED"
                    ? word("errLaunchPaused")
                    : code === "RATE_LIMITED"
                      ? word("errRateLimited")
                      : word("errGeneric");

  const tokens = (raw: string) => `${formatRaw(raw, data.tokenDecimals, locale, 0)} $${symbol}`;
  const money = (raw: string | bigint) => pairMoney(raw, pair, locale);
  const unit = side === "pair" ? pair.symbol : `$${symbol}`;
  const collectorOn = Boolean(data.collector);
  const presets = side === "pair" ? ["10", "50", "100"] : ["25", "50", "100"];
  const choose = (value: string) => {
    if (side === "pair") return setText(value);
    if (!held) return;
    setText(fromRaw((BigInt(held.tokenRaw) * BigInt(value)) / 100n, data.tokenDecimals));
  };

  return (
    <Block title={word("poolTitle")} titleAs="h2" lang={coreLang(locale)} id={`${ids.amount}-title`} className={styles.poolCard}>
      {data.network === "solana:devnet" ? (
        <div className={styles.blockBar}>
          <span className={styles.netChip}>{word("devnet")}</span>
        </div>
      ) : null}

      {data.open && !paused ? (
        phase === "done" && entered ? (
          <div className={styles.tradeDone} aria-live="polite">
            {entered.state === "CONFIRMED" ? <CheckCircle size={28} weight="fill" className={styles.tradeDoneIcon} aria-hidden /> : <Clock size={28} className={styles.tradePendingIcon} aria-hidden />}
            <h3 className={styles.tradeDoneTitle}>{entered.state === "CONFIRMED" ? word("enteredTitle") : word("enteredPendingTitle")}</h3>
            <p className={styles.hint}>{entered.state === "CONFIRMED" ? word("enteredLine") : word("enteredPendingLine")}</p>
            <a className={styles.markLink} href={explorerUrl(data.network, "tx", entered.signature)} target="_blank" rel="noreferrer noopener">
              {word("viewTx")} <ArrowSquareOut size={14} aria-hidden />
            </a>
            {entered.state === "CONFIRMED" ? (
              <Button variant="secondary" onClick={() => setPhase("idle")}>
                {word("enterAgain")}
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => void read()}>
                {word("checkAgain")}
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className={styles.poolLede}>{word("poolLede", { symbol })}</p>
            <div className={styles.field}>
              <div className={styles.labelRow}>
                <span id={ids.coin} className={styles.label}>
                  {word("poolCoin")}
                </span>
              </div>
              <div
                className={styles.sideSwitch}
                role="radiogroup"
                aria-labelledby={ids.coin}
                onKeyDown={(event) => {
                  const next = busy ? null : rovingNext(SIDES, side, event.key, true);
                  if (!next) return;
                  event.preventDefault();
                  if (next !== side) {
                    setSide(next);
                    setText("");
                  }
                  (event.currentTarget.querySelector(`[data-coin="${next}"]`) as HTMLButtonElement | null)?.focus();
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
                    data-coin={entry}
                    disabled={busy}
                    onClick={() => {
                      setSide(entry);
                      setText("");
                    }}
                  >
                    {entry === "pair" ? pair.symbol : `$${symbol}`}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label className={styles.label} htmlFor={ids.amount}>
                  {word("poolAmount")}
                </label>
                {held ? (
                  <span className={styles.count}>
                    {word("balance", { amount: side === "pair" ? formatRaw(held.pairRaw, pair.decimals, locale, 2) : formatRaw(held.tokenRaw, data.tokenDecimals, locale, 0), symbol: unit })}
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
                  <button key={value} type="button" className={styles.quick} disabled={busy || (side === "token" && !held)} onClick={() => choose(value)}>
                    {side === "pair" ? (pair.dollar ? `$${value}` : value) : value === "100" ? word("max") : `${value}${locale === "uk" ? " %" : "%"}`}
                  </button>
                ))}
              </div>
              {over ? <p className={styles.problem}>{word("moreThanHeld")}</p> : amountRaw === null ? <p className={styles.problem}>{word("errAmount")}</p> : null}
            </div>

            {amountRaw !== null && amountRaw > 0n && !over ? (
              <div className={styles.quoteBox} aria-live="polite" aria-busy={quote.loading}>
                {shown ? (
                  <>
                    <div className={styles.quoteMain}>
                      <span className={styles.quoteLabel}>{word("poolYouGet")}</span>
                      <span className={styles.quoteValue}>{word("poolYouGetValue", { pair: money(shown.quote.positionPairRaw), tokens: tokens(shown.quote.positionTokenRaw) })}</span>
                      <span className={styles.quoteSub}>{word("poolWorth", { amount: money(shown.quote.positionValuePairRaw) })}</span>
                    </div>
                    <dl className={styles.rows}>
                      <div className={styles.row}>
                        <dt>{word("poolEntryCost")}</dt>
                        <dd className={styles.mono}>{money(entryCostRaw(shown.quote, side, data.price ?? 0, data.tokenDecimals, pair.decimals))}</dd>
                      </div>
                      <div className={styles.row}>
                        <dt>{word("poolFee")}</dt>
                        <dd className={styles.mono}>
                          {BigInt(shown.quote.feeRaw) > 0n
                            ? word("poolFeeValue", { amount: side === "pair" ? money(shown.quote.feeRaw) : tokens(shown.quote.feeRaw), pct: formatBps(shown.quote.feeBps, locale) })
                            : word("poolFeeNone")}
                        </dd>
                      </div>
                      <div className={styles.row}>
                        <dt>{word("poolSwapped")}</dt>
                        <dd className={styles.mono}>{side === "pair" ? money(shown.quote.swappedRaw) : tokens(shown.quote.swappedRaw)}</dd>
                      </div>
                      <div className={styles.row}>
                        <dt>{word("poolMove")}</dt>
                        <dd className={styles.mono}>{formatBps(shown.quote.priceImpactBps, locale)}</dd>
                      </div>
                      <div className={styles.row}>
                        <dt>{word("poolShare")}</dt>
                        <dd className={styles.mono}>{shown.quote.shareBps > 0 ? formatBps(shown.quote.shareBps, locale) : word("poolShareTiny")}</dd>
                      </div>
                    </dl>
                  </>
                ) : quote.loading ? (
                  <p className={styles.hint}>
                    <CircleNotch size={14} className={styles.spin} aria-hidden /> {word("poolCounting")}
                  </p>
                ) : quote.code ? (
                  <p className={styles.problem}>{errorText(quote.code)}</p>
                ) : null}
              </div>
            ) : null}

            <Collector data={data} word={word} locale={locale} runs={collectorRuns} />
            {deposit !== null && shown ? <Simulator deposit={deposit} entered={Number(fromRaw(shown.quote.valuePairRaw, pair.decimals))} pair={pair} symbol={symbol} locale={locale} word={word} /> : null}
            <p className={styles.notDeposit}>
              <Warning size={16} weight="fill" aria-hidden />
              <span>{word("notDeposit", { symbol })}</span>
            </p>

            {phase === "error" && failure?.code === "WALLET_REFUSED" ? (
              <p className={styles.cancelled} role="status">
                {word("walletCancelled")}
              </p>
            ) : phase === "error" && failure ? (
              <div className={styles.failure} role="alert">
                <p className={styles.failureTitle}>
                  <Warning size={18} weight="fill" aria-hidden />
                  {word("errEntryTitle")}
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
                {phase === "prepare" ? word("stepPrepareEntry") : phase === "sign" ? word(again ? "stepSignAgain" : "stepSign") : word("stepSendEntry")}
              </p>
            ) : null}

            {/* Quiet: the page's one orange action is the trade's. */}
            <Button variant="secondary" block className={styles.poolAction} disabled={busy || amountRaw === null || amountRaw <= 0n || over || !shown || quote.loading} onClick={enter}>
              {collectorOn ? word("enterAction") : word("enterActionPlain")}
            </Button>
          </>
        )
      ) : null}

      {data.positions.length ? <Positions data={data} symbol={symbol} locale={locale} word={word} onChanged={() => void read()} collectorRuns={collectorRuns} /> : null}
      {data.positions.length ? (
        <Link className={styles.markLink} href="/app/launch/positions">
          {word("allPositions")}
        </Link>
      ) : null}
    </Block>
  );
}

/** The entry's cost to the pool — its fee and the swap's price move — in the pair currency; Ryntra's share has its own line. */
function entryCostRaw(quote: LaunchHolderQuoteResponse["quote"], side: Side, price: number, tokenDecimals: number, pairDecimals: number): bigint {
  const fee = BigInt(quote.feeRaw);
  const feePair = side === "pair" ? fee : BigInt(Math.floor((Number(fee) / 10 ** tokenDecimals) * price * 10 ** pairDecimals));
  const cost = BigInt(quote.valuePairRaw) - feePair - BigInt(quote.positionValuePairRaw);
  return cost > 0n ? cost : 0n;
}

/**
 * What Ryntra's collector does, and — behind one line — what the chain lets it and does not let it do. Whether it makes
 * its rounds now is the executor's passes' word, not the permission's: when they have stopped, that is said first.
 */
function Collector({ data, word, locale, runs }: { data: LaunchHolderResponse; word: Word; locale: WorkspaceLocale; runs: boolean | null }) {
  if (!data.collector) return <p className={styles.hint}>{word("collectorOff")}</p>;
  return (
    <div className={styles.collector}>
      {runs === false ? <p className={styles.collectorIdle}>{word("collectorIdle")}</p> : null}
      {/* The permission in four lines, large, one column — the block's title. No badge beside it: it is a boundary, not a seal. */}
      <p className={styles.collectorPromise}>
        <span>{word("collectorPromise1")}</span> <span>{word("collectorPromise2")}</span> <span>{word("collectorPromise3")}</span> <span>{word("collectorPromise4")}</span>
      </p>
      <p className={styles.collectorLine}>
        {data.compoundingBps ? word("collectorLine", { pct: formatBps(data.compoundingBps, locale) }) : word("collectorLineNoCompound")}
      </p>
      <details className={styles.details}>
        <summary className={styles.summary}>
          {word("collectorBounds")} <CaretDown size={14} aria-hidden className={styles.caret} />
        </summary>
        <ul className={styles.collectorBounds}>
          <li>{word("collectorCannot")}</li>
          <li>{word("collectorNoReinvest")}</li>
          <li>{word("collectorChain")}</li>
        </ul>
      </details>
    </div>
  );
}

/** The position against the two coins kept, at ±10 % and ±30 % of the token's price; fees not counted. */
function Simulator({ deposit, entered, pair, symbol, locale, word }: { deposit: number; entered: number; pair: LaunchHolderResponse["pair"]; symbol: string; locale: WorkspaceLocale; word: Word }) {
  const rows = poolOutcomes(deposit);
  const amount = (value: number) => {
    const text = new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));
    const sign = value < 0 && Math.abs(value) >= 0.005 ? "−" : "";
    return pair.dollar ? `${sign}$${text}` : `${sign}${text} ${pair.symbol}`;
  };
  return (
    <details className={`${styles.details} ${styles.simulator}`}>
      <summary className={styles.summary}>
        <span className={styles.simSummary}>
          <span>{word("simTitle", { symbol })}</span>
          {/* What the position is worth after the fall, against what went in — the loss as plain as a gain would be. */}
          <span className={styles.simWorst}>{word("simWorst", { worth: amount(rows[0]!.position), entered: amount(entered) })}</span>
        </span>
        <CaretDown size={14} aria-hidden className={styles.caret} />
      </summary>
      <div className={styles.simScroll}>
      <table className={styles.simTable}>
        <thead>
          <tr>
            <th scope="col">{word("simPrice")}</th>
            <th scope="col">{word("simPosition")}</th>
            <th scope="col">{word("simHeld")}</th>
            <th scope="col">{word("simDifference")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.moveBps}>
              <th scope="row" data-dir={row.moveBps > 0 ? "up" : "down"}>
                {formatMove(row.moveBps, locale)}
              </th>
              <td>{amount(row.position)}</td>
              <td>{amount(row.held)}</td>
              <td data-loss={row.difference < -0.005 ? "" : undefined}>{amount(row.difference)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className={styles.hint}>{word("simNote")}</p>
    </details>
  );
}

const GRANT_TONE: Record<string, "on" | "off" | "warn"> = { GRANTED: "on", NONE: "off", OTHER_DELEGATE: "warn", WIDER: "warn", TRANSFERABLE: "warn" };

/** The wallet's positions in this pool: what each holds and earned, its collector, «Відкликати» or «Увімкнути». */
export function Positions({
  data,
  symbol,
  locale,
  word,
  onChanged,
  heading = true,
  collectorRuns = null,
}: {
  data: Pick<LaunchHolderResponse, "network" | "pair" | "tokenDecimals" | "collector" | "open"> & Readonly<{ positions: readonly LaunchHolderPositionView[] }>;
  symbol: string;
  locale: WorkspaceLocale;
  word: Word;
  onChanged: () => void;
  heading?: boolean;
  /** Whether Ryntra's collector makes its rounds now; null where it is not read — the permission alone is then said. */
  collectorRuns?: boolean | null;
}) {
  return (
    <div className={styles.positions}>
      {heading ? <h3 className={styles.positionsTitle}>{word("positionsHere")}</h3> : null}
      <ul className={styles.positionList}>
        {data.positions.map((position) => (
          <li key={position.position}>
            <PositionRow position={position} data={data} symbol={symbol} locale={locale} word={word} onChanged={onChanged} collectorRuns={collectorRuns} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PositionRow({
  position,
  data,
  symbol,
  locale,
  word,
  onChanged,
  collectorRuns,
}: {
  position: LaunchHolderPositionView;
  data: Pick<LaunchHolderResponse, "network" | "pair" | "tokenDecimals" | "collector" | "open">;
  symbol: string;
  locale: WorkspaceLocale;
  word: Word;
  onChanged: () => void;
  collectorRuns: boolean | null;
}) {
  const { connection } = useSolanaConnection();
  const [state, setState] = useState<{ phase: "idle" | "busy" | "done" | "error"; text: string | null }>({ phase: "idle", text: null });
  /* «Увімкнути» and «Відкликати» open the core's Review first (SOL-C14); only its «Підписати в гаманці» builds the permission. */
  const [review, setReviewState] = useState<"grant" | "revoke" | null>(null);
  /* A Review opens clean: no line of an earlier permission's outcome stays under it. */
  const setReview = (next: "grant" | "revoke" | null) => {
    if (next) setState({ phase: "idle", text: null });
    setReviewState(next);
  };
  const money = (raw: string | bigint) => pairMoney(raw, data.pair, locale);
  const now = position.now;
  const change = now && now.state === "OPEN" ? BigInt(now.valuePairRaw) - BigInt(position.enteredPairRaw) : null;
  const changeBps = change !== null && BigInt(position.enteredPairRaw) > 0n ? Number((change * 10_000n) / BigInt(position.enteredPairRaw)) : null;

  const act = async (action: "grant" | "revoke") => {
    if (!connection) return;
    setState({ phase: "busy", text: null });
    /* Bytes live ~30 s (`lib/solana/blockhash-life.ts`): a signature after that is not sent — the permission is built again. */
    const fresh = await signFreshBytes({
      build: () => api<LaunchHolderPermissionBuildResponse>(`/api/v1/launch/${position.token}/holder/permission/build`, { method: "POST", body: JSON.stringify({ wallet: connection.address, position: position.position, action }) }),
      signableMsOf: (data) => data.signableMs,
      sign: async (data) => {
        const answer = await signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: [data.unsignedWireBase64], chain: data.network });
        return answer.ok ? { ok: true, value: answer.signedWireBase64 } : answer;
      },
      onRebuild: (why) => setState({ phase: "busy", text: why === "late" ? word("stepSignAgain") : null }),
    });
    setReview(null);
    if (!fresh.ok) return fresh.stage === "sign" ? setState({ phase: "idle", text: word("walletCancelled") }) : setState({ phase: "error", text: word("errPermission") });
    const built = { data: fresh.built };
    const signed = { signedWireBase64: fresh.signed };
    const sent = await api<LaunchHolderPermissionSubmitResponse>(`/api/v1/launch/${position.token}/holder/permission/submit`, { method: "POST", body: JSON.stringify({ buildId: built.data.buildId, wallet: connection.address, signedWireBase64: signed.signedWireBase64[0] }) });
    if (!sent.ok) return setState({ phase: "error", text: word("errPermission") });
    setState({ phase: "done", text: sent.data.state === "PENDING" ? word("permissionPending") : action === "revoke" ? word("permissionRevoked") : word("permissionGranted") });
    onChanged();
  };

  const lang = locale === "uk" ? "uk" : "en";
  const permissionReview = review ? (
    <Review
      className={styles.permissionReview}
      lang={lang}
      titleAs="h4"
      data-permission-review={review}
      title={word(review === "grant" ? "permReviewGrant" : "permReviewRevoke")}
      pay={reviewWord(lang, "onlyNetwork")}
      get={word(review === "grant" ? "permGetGrant" : "permGetRevoke")}
      costs={[
        { label: reviewWord(lang, "ryntra"), value: reviewWord(lang, "none") },
        { label: reviewWord(lang, "network"), value: reviewNetworkFrom(lang) },
      ]}
      costsTotal={reviewNetworkFrom(lang)}
      rows={[
        { label: word("permPosition"), value: <span translate="no">{`${position.position.slice(0, 4)}…${position.position.slice(-4)}`}</span> },
        ...(review === "grant" ? [{ label: word("permWhen"), value: word("permWhenValue") }, { label: word("permCannot"), value: word("collectorCannot") }] : []),
      ]}
      whatItIs={word(review === "grant" ? "permWhatGrant" : "permWhatRevoke")}
      {...(connection ? { signer: <span translate="no">{`${connection.address.slice(0, 4)}…${connection.address.slice(-4)}`}</span> } : {})}
      ready={Boolean(connection)}
      signing={state.phase === "busy"}
      {...(state.phase === "busy" ? {} : { onCancel: () => setReview(null) })}
      onConfirm={() => void act(review)}
      risk={reviewWord(lang, "walletShowsFee")}
      details={
        <dl className={styles.permissionDetails}>
          <dt>{word("permPosition")}</dt>
          <dd translate="no">{position.position}</dd>
        </dl>
      }
    />
  ) : null;

  const grant = now?.state === "OPEN" ? now.grant : null;
  /* The permission is the chain's; whether the collector uses it now is the executor's passes': «on» only when both hold. */
  const granted = grant === "GRANTED" ? (collectorRuns === true ? "GRANTED" : collectorRuns === false ? "GRANTED_IDLE" : "GRANTED_UNREAD") : grant;
  const tone = granted === "GRANTED_IDLE" || granted === "GRANTED_UNREAD" ? null : grant ? GRANT_TONE[grant] : null;
  return (
    <article className={styles.positionRow}>
      <div className={styles.positionHead}>
        <span className={styles.positionWhen}>{word("posSince", { date: formatDate(position.enteredAt, locale) })}</span>
        {grant ? (
          <span className={styles.grantChip} data-tone={tone}>
            {tone === "warn" ? <Warning size={14} weight="fill" aria-hidden /> : tone === "on" ? <CheckCircle size={14} weight="fill" aria-hidden /> : null}
            {word(`grantChip_${granted}` as LaunchWordKey)}
          </span>
        ) : null}
      </div>
      {grant && tone === "warn" ? <p className={styles.grantLine}>{word(`grant_${grant}` as LaunchWordKey)}</p> : null}
      {position.pending ? (
        <p className={styles.hint}>
          <Clock size={14} aria-hidden /> {word("posPending")}
        </p>
      ) : !now ? (
        <>
          <p className={styles.unread}>{word("posUnread")}</p>
          {/* Not read is not «nothing granted»: the revoke is the owner's whatever the read says. */}
          {permissionReview ?? (
            <div className={styles.positionActions}>
              <Button variant="secondary" disabled={state.phase === "busy" || !connection} onClick={() => setReview("revoke")}>
                {word("revoke")}
              </Button>
            </div>
          )}
        </>
      ) : now.state === "MOVED" ? (
        <p className={styles.hint}>{word("posMoved")}</p>
      ) : now.state === "CLOSED" ? (
        <p className={styles.hint}>{word("posClosed")}</p>
      ) : (
        <>
          <dl className={styles.positionFigures}>
            <div>
              <dt>{word("posEntered")}</dt>
              <dd>{money(position.enteredPairRaw)}</dd>
            </div>
            <div>
              <dt>{word("posWorth")}</dt>
              <dd>
                {money(now.valuePairRaw)}
                {changeBps !== null ? (
                  <span className={styles.positionChange} data-dir={changeBps > 0 ? "up" : changeBps < 0 ? "down" : undefined}>
                    {" "}
                    {formatMove(changeBps, locale)}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>{word("posFees")}</dt>
              <dd>{money(now.feesPairRaw)}</dd>
            </div>
            <div>
              <dt>{word("posWaiting")}</dt>
              <dd>{money(now.unclaimedPairRaw)}</dd>
            </div>
            <div>
              <dt>{word("posCollected")}</dt>
              <dd>{money(position.collectedPairRaw)}</dd>
            </div>
          </dl>
          <p className={styles.positionHolds}>{word("posHolds", { pair: money(now.pairRaw), tokens: `${formatRaw(now.tokenRaw, data.tokenDecimals, locale, 0)} $${symbol}` })}</p>
          {/* An account of the owner's the fees are paid into is closed: the collector waits on it rather than reopen it at its cost. */}
          {grant === "GRANTED" && now.closedAccounts?.length ? (
            <p className={styles.accountClosed} role="status">
              <Warning size={14} weight="fill" aria-hidden className={styles.warnIcon} />
              <span>
                {now.closedAccounts.length > 1
                  ? word("posAccountsClosed", { coins: `${data.pair.symbol} ${locale === "uk" ? "і" : "and"} $${symbol}` })
                  : word("posAccountClosed", { coins: now.closedAccounts[0] === "pair" ? data.pair.symbol : `$${symbol}` })}
              </span>
            </p>
          ) : position.nextCollection && collectorRuns === true ? (
            <CollectorQueue next={position.nextCollection} locale={locale} />
          ) : null}
          {permissionReview ?? (
            <div className={styles.positionActions}>
              {grant && grant !== "NONE" ? (
                <Button variant="secondary" disabled={state.phase === "busy" || !connection} onClick={() => setReview("revoke")}>
                  {word("revoke")}
                </Button>
              ) : data.collector && data.open ? (
                <Button variant="secondary" disabled={state.phase === "busy" || !connection} onClick={() => setReview("grant")}>
                  {word("turnOn")}
                </Button>
              ) : null}
              <a className={styles.markLink} href={explorerUrl(data.network, "account", position.position)} target="_blank" rel="noreferrer noopener">
                {word("posOnChain")} <ArrowSquareOut size={12} aria-hidden />
              </a>
            </div>
          )}
          {state.phase === "busy" && !review ? (
            <p className={styles.tradeStep} aria-live="polite">
              <CircleNotch size={16} className={styles.spin} aria-hidden /> {word("stepPermission")}
            </p>
          ) : state.text ? (
            <p className={state.phase === "error" ? styles.problem : styles.hint} role="status">
              {state.text}
            </p>
          ) : null}
          {position.claims.length ? (
            <details className={styles.details}>
              <summary className={styles.summary}>
                {word("posClaims", { n: position.claimsCount ?? position.claims.length })} <CaretDown size={14} aria-hidden className={styles.caret} />
              </summary>
              <ul className={styles.claimList}>
                {position.claims.map((claim) => (
                  <li key={claim.signature}>
                    <span className={styles.positionWhen}>{claim.at ? formatDate(claim.at, locale) : ""}</span>
                    <span className={styles.claimAmount}>
                      <span className={styles.mono}>{money(claim.pairRaw)}</span>
                      {BigInt(claim.tokenRaw) > 0n ? <span className={styles.claimTokens}>+ {formatRaw(claim.tokenRaw, data.tokenDecimals, locale, 0)} ${symbol}</span> : null}
                    </span>
                    <a className={styles.markLink} href={explorerUrl(data.network, "tx", claim.signature)} target="_blank" rel="noreferrer noopener">
                      {word("viewTx")} <ArrowSquareOut size={12} aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </article>
  );
}

/**
 * The collector's queue for this position, in one line, as the server reads it by the collector's own rule and attempts:
 * the next collection goes on the collector's first pass once a dollar waits and a day has passed since its last attempt.
 */
function CollectorQueue({ next, locale }: Readonly<{ next: Readonly<{ notBefore: string; enoughWaiting: boolean }>; locale: WorkspaceLocale }>) {
  const word = launchWords(locale);
  const later = Date.parse(next.notBefore) > Date.now();
  const text = next.enoughWaiting ? (later ? word("collectorNotBefore", { when: formatWhen(next.notBefore, locale) }) : word("collectorDue")) : later ? word("collectorWaitDollarAfter", { when: formatWhen(next.notBefore, locale) }) : word("collectorWaitDollar");
  return (
    <p className={styles.hint}>
      <Clock size={14} aria-hidden /> {text}
    </p>
  );
}
