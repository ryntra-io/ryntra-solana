"use client";

import { Check, Copy, Star, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { AreaChart } from "@ryntra/core/chart/compact";

import { ageText, changeText, pctText, pulseWords } from "@/app/app/home/pulse-words";
import { formatMoneyShort } from "@/app/app/launch/launch-format";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { candlesStatus, onTick, tickFor } from "@/app/solana/workspace/spot/core-chart-source";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { useQuickBuySums } from "@/app/solana/workspace/spot/quick-buy";
import { formatCount, formatUsdPrice, toneOf } from "@/app/solana/workspace/spot/spot-format";
import { useSpotCandles } from "@/app/solana/workspace/spot/use-spot-data";
import { ageHoursOf, pulseHref, shortMint, type PulseRow } from "@/lib/spot/pulse";
import { quickSumLabel } from "@/lib/spot/quick-trade";
import { LAMPORTS_PER_SOL, type BuyCost } from "@/lib/spot/radar-cost";

import { cardFactsOf, chartTimeframeOf, firstCostSum, type CardFact } from "./radar-model";
import { radarWords } from "./radar-words";
import r from "./radar.module.css";

/**
 * A token's card in Market Radar (SOL-R1): opened from a row's name, a sheet
 * from the foot of a phone and a panel in the middle of a desk. Its chart (the
 * core's compact line over the pool's candles, with its source and age), the
 * facts against it and beside it, and the total fees of a buy for one of the
 * person's quick sums — Ryntra's, Jupiter's and the network's, with the price
 * impact and a token account's deposit beside them, as Jupiter quotes the buy
 * now (`/api/spot/radar/cost`). One orange action: the sum's Review on the
 * token's page; the wallet signs there or nothing is bought.
 */

type CostState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; cost: BuyCost }>
  | Readonly<{ status: "failed"; code: string | null }>;

export function RadarCard({
  row,
  now,
  locale,
  watched,
  onToggleWatch,
  onClose,
}: {
  row: PulseRow | null;
  now: number;
  locale: WorkspaceLocale;
  watched: boolean;
  onToggleWatch: (mint: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const open = row !== null;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => {
    /* The page does not scroll under an open card. */
    if (!open) return undefined;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={r.sheet}
      aria-labelledby={titleId}
      data-radar-card=""
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {row ? <CardBody key={row.mint} row={row} now={now} locale={locale} titleId={titleId} watched={watched} onToggleWatch={onToggleWatch} onClose={onClose} /> : null}
    </dialog>
  );
}

function CardBody({ row, now, locale, titleId, watched, onToggleWatch, onClose }: { row: PulseRow; now: number; locale: WorkspaceLocale; titleId: string; watched: boolean; onToggleWatch: (mint: string) => void; onClose: () => void }) {
  const word = radarWords(locale);
  const pulse = pulseWords(locale);
  const numbers = locale === "uk" ? "uk-UA" : "en-US";
  const lang = locale === "uk" ? "uk" : "en";
  const [sums] = useQuickBuySums();
  const [sum, setSum] = useState(() => firstCostSum(sums));
  const age = ageHoursOf(row, now);
  const change = row.windows.h24.changePct ?? row.windows.h1.changePct;
  /* A market launched on Ryntra is bought on its launch page, at its own curve's terms; a dollar sum does nothing there unless its pair is a dollar. */
  const launch = row.ryntra !== null;
  const quick = !launch || row.ryntra?.dollarPair === true;
  /* No price or no stated pool: nothing to quote yet, so no «Купити на …» — the token's page stays (UX-165, as its row). */
  const unpriced = !launch && (row.price === null || row.liquidityUsd === null);

  return (
    <div className={r.body}>
      <header className={r.head}>
        <span className={r.grab} aria-hidden="true" />
        <MarketIcon mint={row.mint} icon={null} symbol={row.symbol} size={40} plain />
        <div className={r.names}>
          <h2 id={titleId} className={r.symbol}>
            {row.symbol}
          </h2>
          <span className={r.name}>{row.name}</span>
          <span className={r.tags}>
            {row.ryntra ? <span>{pulse("ryntra")}</span> : row.launchpad ? <span>{row.launchpad}</span> : null}
            <span>{ageText(age, locale)}</span>
            <MintCopy mint={row.mint} locale={locale} />
          </span>
        </div>
        <button type="button" className={r.icon} aria-pressed={watched} aria-label={watched ? word("unstar") : word("star")} title={watched ? word("unstar") : word("star")} onClick={() => onToggleWatch(row.mint)}>
          <Star size={20} weight={watched ? "fill" : "regular"} aria-hidden="true" />
        </button>
        <button type="button" className={r.icon} aria-label={word("close")} onClick={onClose}>
          <X size={20} weight="bold" aria-hidden="true" />
        </button>
      </header>

      <div className={r.main}>
        <div className={r.price}>
          <span className={r.priceValue} translate="no">
            {formatUsdPrice(row.price, numbers)}
          </span>
          <span className={r.change} data-tone={toneOf(change)} translate="no">
            {changeText(change, numbers)} <span className={r.muted}>{row.windows.h24.changePct !== null ? pulse("h24") : pulse("h1")}</span>
          </span>
        </div>

        <section className={r.section} aria-label={word("chart")}>
          <CardChart row={row} age={age} locale={locale} />
        </section>

        <section className={r.section} aria-labelledby={`${titleId}-risks`}>
          <h3 id={`${titleId}-risks`} className={r.sectionTitle}>
            {word("risks")}
          </h3>
          <ul className={r.facts}>
            {cardFactsOf(row, now).map((fact) => (
              <FactLine key={fact.code} fact={fact} locale={locale} />
            ))}
          </ul>
          <p className={r.note}>{word("risksNote")}</p>
        </section>
      </div>

      <div className={r.side}>
        <section className={r.section} aria-labelledby={`${titleId}-cost`} data-radar-cost="">
          <h3 id={`${titleId}-cost`} className={r.sectionTitle}>
            {word("cost")}
          </h3>
          {launch ? (
            <p className={r.note}>{word("costLaunch")}</p>
          ) : unpriced ? (
            <p className={r.note}>{word("costUnpriced")}</p>
          ) : (
            <>
              <div className={r.sums} role="group" aria-label={word("costFor")}>
                {sums.map((usd, index) => (
                  <button key={`${usd}-${index}`} type="button" className={r.sum} aria-pressed={usd === sum} onClick={() => setSum(usd)} data-dense="">
                    {quickSumLabel(usd, lang)}
                  </button>
                ))}
              </div>
              <CostLines mint={row.mint} usd={sum} locale={locale} />
            </>
          )}
        </section>

        <div className={r.actions}>
          {unpriced ? null : quick ? (
            <Link className="rw-btn rw-btn--primary" href={pulseHref(row, launch ? undefined : sum)} prefetch={false} data-radar-buy="">
              {launch ? word("openLaunch") : word("buyFor", { sum: quickSumLabel(sum, lang, true) })}
            </Link>
          ) : (
            <Link className="rw-btn rw-btn--primary" href={pulseHref(row)} prefetch={false}>
              {word("openLaunch")}
            </Link>
          )}
          {launch ? null : (
            <Link className="rw-btn" href={pulseHref(row)} prefetch={false}>
              {word("openPage")}
            </Link>
          )}
        </div>
        {launch || unpriced ? null : <p className={r.note}>{word("buyNote")}</p>}
      </div>
    </div>
  );
}

/** The token's own address, short, and one press to copy it whole: the way to tell a copy from the original (UX-154). */
function MintCopy({ mint, locale }: { mint: string; locale: WorkspaceLocale }) {
  const word = radarWords(locale);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1_500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <>
      <button
        type="button"
        className={r.mint}
        title={mint}
        aria-label={`${word("copyAddress")}: ${mint}`}
        onClick={() => {
          void navigator.clipboard?.writeText(mint).then(
            () => setCopied(true),
            () => undefined,
          );
        }}
      >
        <span translate="no">{shortMint(mint)}</span>
        {copied ? <Check size={14} weight="bold" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
      <span className={r.srOnly} role="status">
        {copied ? word("copied") : ""}
      </span>
    </>
  );
}

function FactLine({ fact, locale }: { fact: CardFact; locale: WorkspaceLocale }) {
  const word = radarWords(locale);
  const numbers = locale === "uk" ? "uk-UA" : "en-US";
  const unknown = word("unknown");
  const money = (value: number | null) => (value === null ? unknown : formatMoneyShort(value, locale, true, ""));
  const pct = (value: number | null) => (value === null ? unknown : pctText(value, numbers, value < 10 ? 1 : 0));
  let label: string;
  let value: string | null = null;
  switch (fact.code) {
    case "MINT":
      label = fact.tone === "notice" ? word("mintOn") : word("mintOff");
      break;
    case "FREEZE":
      label = fact.tone === "notice" ? word("freezeOn") : word("freezeOff");
      break;
    case "RIGHTS_UNREAD":
      label = word("rightsUnread");
      break;
    case "FLAGGED":
      label = word("flagged");
      break;
    case "BORROWED":
      label = word("borrowed", { label: fact.label ?? "" });
      break;
    case "TOP10":
      label = word("top10");
      value = pct(fact.value);
      break;
    case "CREATOR_HOLDS":
      label = word("creatorHolds");
      value = pct(fact.value);
      break;
    case "CREATOR_HISTORY":
      label = word("creatorHistory");
      value = fact.value === null ? unknown : word("creatorHistoryValue", { made: formatCount(fact.value, numbers), dex: fact.second === null || fact.second === undefined ? "—" : formatCount(fact.second, numbers) });
      break;
    case "LIQUIDITY":
      label = word("liquidity");
      value = money(fact.value);
      break;
    case "HOLDERS":
      label = word("holders");
      value = fact.value === null ? unknown : `${fact.atLeast ? "≥ " : ""}${formatCount(fact.value, numbers)}`;
      break;
    case "AGE":
      label = word("age");
      value = ageText(fact.value, locale);
      break;
    case "CURVE":
      label = word("curve");
      value = fact.value === null ? unknown : pctText(fact.value, numbers);
      break;
  }
  return (
    <li className={r.fact} data-tone={fact.tone} data-fact={fact.code}>
      <span>{label}</span>
      {value === null ? null : (
        <span className={r.factValue} translate="no">
          {value}
        </span>
      )}
    </li>
  );
}

/** The pool's candles as the core's compact line, its source and age under it; a token no pool prices says so. */
function CardChart({ row, age, locale }: { row: PulseRow; age: number | null; locale: WorkspaceLocale }) {
  const word = radarWords(locale);
  const timeframe = chartTimeframeOf(age);
  const candles = useSpotCandles(row.mint, timeframe);
  const line = useMemo(() => {
    const bars = candles.value ? candles.value.candles : [];
    const last = bars.at(-1)?.close ?? row.price ?? null;
    const tick = tickFor(last);
    return bars.filter((bar) => Number.isFinite(bar.close) && bar.close > 0).map((bar) => ({ t: bar.time * 1000, v: onTick(bar.close, tick) }));
  }, [candles.value, row.price]);
  const status = useMemo(() => {
    if (!candles.value) return null;
    const observed = candles.status === "ready" ? Date.parse(candles.observedAt) : NaN;
    const stale = candles.status === "unavailable" || (candles.status === "ready" && candles.stale);
    return candlesStatus({ observedAt: Number.isFinite(observed) ? observed : null, stale, pool: null }, timeframe);
  }, [candles, timeframe]);
  if (candles.status === "none" || (candles.status === "unavailable" && line.length === 0)) {
    return <p className={r.chartNote}>{candles.status === "none" ? word("noChart") : word("chartDown")}</p>;
  }
  const first = line[0] ? Number(line[0].v) : null;
  const last = line.at(-1) ? Number(line.at(-1)!.v) : null;
  const tone = first !== null && last !== null ? toneOf(last - first) : "flat";
  return (
    <div className={r.chart} data-state={candles.status === "loading" && line.length < 2 ? "loading" : "ready"}>
      <AreaChart
        points={candles.status === "loading" && line.length < 2 ? null : line}
        status={status}
        label={word("chartOf", { symbol: row.symbol })}
        lang={locale === "uk" ? "uk" : "en"}
        unit="USD"
        tone={tone === "up" ? "up" : tone === "down" ? "down" : "neutral"}
        head={false}
        caption="short"
      />
    </div>
  );
}

/** The fees of a buy for one sum, as Jupiter quotes it now; read again when the sum changes, never while the card is closed. */
function CostLines({ mint, usd, locale }: { mint: string; usd: number; locale: WorkspaceLocale }) {
  const word = radarWords(locale);
  const numbers = locale === "uk" ? "uk-UA" : "en-US";
  const [state, setState] = useState<CostState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void (async () => {
      try {
        const response = await fetch(`/api/spot/radar/cost?mint=${encodeURIComponent(mint)}&usd=${usd}`, { headers: { accept: "application/json" }, signal: controller.signal });
        const body = (await response.json().catch(() => null)) as { cost?: BuyCost; error?: { code?: string } } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.cost) setState({ status: "failed", code: body?.error?.code ?? null });
        else setState({ status: "ready", cost: body.cost });
      } catch {
        if (!controller.signal.aborted) setState({ status: "failed", code: null });
      }
    })();
    return () => controller.abort();
  }, [mint, usd, attempt]);

  if (state.status === "loading") {
    return (
      <p className={r.note} role="status">
        {word("costLoading")}
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <div className={r.costFailed} role="status">
        <p>{state.code === "QUOTE_NO_ROUTE" ? word("costNoRoute") : word("costFailed")}</p>
        {state.code === "QUOTE_NO_ROUTE" ? null : (
          <button type="button" className="rw-btn" onClick={() => setAttempt((count) => count + 1)}>
            {word("costRetry")}
          </button>
        )}
      </div>
    );
  }
  const { cost } = state;
  /* Dollars as the app writes them — «$1,02», «$1.02» — to the cent; under a cent said as under it. */
  const dollars = (value: number) => {
    const cent = new Intl.NumberFormat(numbers, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return value > 0 && value < 0.01 ? `< $${cent.format(0.01)}` : `$${cent.format(value)}`;
  };
  const sol = (lamports: number) => word("costInSol", { sol: new Intl.NumberFormat(numbers, { maximumFractionDigits: 6 }).format(lamports / LAMPORTS_PER_SOL) });
  const bps = (value: number) => pctText(value / 100, numbers, 2);
  const time = new Date(cost.quotedAt).toLocaleTimeString(numbers, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  /* A priority not sized yet is a range — from the signature alone to the priority's ceiling — never a zero. */
  const range = (low: string, high: string) => (low === high ? low : `${low} – ${high}`);
  /* No ceiling (Jupiter's `/order` bytes): «from» the known part, the priority said in words. */
  const open = cost.network.maxLamports === null;
  const from = (text: string) => (open ? `${text} + ${word("costPriorityShort")}` : text);
  const network =
    cost.network.usd === null || (!open && cost.network.maxUsd === null)
      ? from(open ? sol(cost.network.lamports) : range(sol(cost.network.lamports), sol(cost.network.maxLamports ?? cost.network.lamports)))
      : from(open ? dollars(cost.network.usd) : range(dollars(cost.network.usd), dollars(cost.network.maxUsd ?? cost.network.usd)));
  const total =
    cost.total.usd === null || (!open && cost.total.maxUsd === null)
      ? `${dollars(cost.total.feesUsd)} + ${open ? sol(cost.network.lamports) : range(sol(cost.network.lamports), sol(cost.network.maxLamports ?? cost.network.lamports))}${open ? ` + ${word("costPriorityShort")}` : ""}`
      : from(open ? dollars(cost.total.usd) : range(dollars(cost.total.usd), dollars(cost.total.maxUsd ?? cost.total.usd)));
  const totalPct =
    cost.total.pct === null ? null : open || cost.total.maxPct === null ? pctText(cost.total.pct, numbers, 2) : range(pctText(cost.total.pct, numbers, 2), pctText(cost.total.maxPct, numbers, 2));
  return (
    <div className={r.cost}>
      <dl className={r.costLines}>
        <div>
          <dt>
            {word("costRyntra")} · {bps(cost.ryntra.bps)}
          </dt>
          <dd translate="no">{dollars(cost.ryntra.usd)}</dd>
        </div>
        {cost.jupiter.bps > 0 ? (
          <div>
            <dt>
              {word("costJupiter")} · {bps(cost.jupiter.bps)}
            </dt>
            <dd translate="no">{dollars(cost.jupiter.usd)}</dd>
          </div>
        ) : null}
        <div>
          <dt>{word("costNetwork")}</dt>
          <dd translate="no">{network}</dd>
        </div>
        <div className={r.costTotal} data-radar-total="">
          <dt>{word("costTotal")}</dt>
          <dd translate="no">
            {total}
            {totalPct === null ? null : <span className={r.muted}> · {totalPct}</span>}
          </dd>
        </div>
        {cost.impactPct === null ? null : (
          <div>
            <dt>{word("costImpact")}</dt>
            <dd translate="no">{pctText(cost.impactPct, numbers, 2)}</dd>
          </div>
        )}
        {cost.deposit.lamports > 0 ? (
          <div>
            <dt>{cost.deposit.known ? word("costDeposit") : word("costDepositIfNew")}</dt>
            <dd translate="no">{cost.deposit.usd === null ? sol(cost.deposit.lamports) : `${sol(cost.deposit.lamports)} · ${dollars(cost.deposit.usd)}`}</dd>
          </div>
        ) : null}
        {cost.receiveUsd === null ? null : (
          <div>
            <dt>{word("costReceive")}</dt>
            <dd translate="no">{dollars(cost.receiveUsd)}</dd>
          </div>
        )}
      </dl>
      <p className={r.note}>
        {cost.network.priorityKnown
          ? null
          : cost.network.maxLamports === null
            ? `${word("costPriorityOpen")} `
            : `${word("costPriority", { sol: new Intl.NumberFormat(numbers, { maximumFractionDigits: 6 }).format((cost.network.maxLamports - cost.network.lamports) / LAMPORTS_PER_SOL) })} `}
        {word("costPools")} {word("costPaidWith", { time })}
      </p>
    </div>
  );
}
