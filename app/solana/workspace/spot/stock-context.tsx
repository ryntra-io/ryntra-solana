"use client";

/**
 * The stock context Spot and Portfolio show beside a tokenized stock — the
 * issuer's reference and session, the multiplier, and the deviation of what
 * a person is about to do from that reference.
 *
 * Read from `/api/stocks/asset` and `/api/stocks/universe`, the same server
 * reads the Stocks page uses, cached in the module for the life of the tab so
 * a header, a Review and a portfolio row never ask three times. Every figure
 * carries its state and its time; a missing one prints as unavailable, never
 * as a zero and never as a guess.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import type { StockAsset } from "@/lib/stocks/asset.server";
import { LIFECYCLE_WORDS, markPremiumPct } from "@/lib/stocks/instrument";
import { REFERENCE_STATE_WORDS, SESSION_WORDS } from "@/lib/stocks/session";
import { deviationPct, perShareExecutable, scaledAmountString } from "@/lib/stocks/units";
import type { SlimStockRow } from "@/app/app/stocks/stock-model";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { formatPercent, formatUsdPrice, toneOf } from "./spot-format.ts";
import styles from "./spot.module.css";

const ASSET_TTL_MS = 20_000;
const UNIVERSE_TTL_MS = 60_000;
const assets = new Map<string, { at: number; value: StockAsset | null }>();
const inflight = new Map<string, Promise<StockAsset | null>>();
const slimRows = new Map<string, { at: number; value: ReadonlyMap<string, SlimStockRow> | null }>();

/** One request per mint at a time: a header, a Review and a re-mount share the answer. */
function readAsset(mint: string): Promise<StockAsset | null> {
  const hit = assets.get(mint);
  if (hit && Date.now() - hit.at < ASSET_TTL_MS) return Promise.resolve(hit.value);
  const pending = inflight.get(mint);
  if (pending) return pending;
  const promise = fetch(`/api/stocks/asset?ticker=${encodeURIComponent(mint)}`, { headers: { accept: "application/json" } })
    .then(async (response) => (response.ok ? ((await response.json()) as StockAsset) : null))
    .catch(() => null)
    .then((value) => {
      assets.set(mint, { at: Date.now(), value });
      inflight.delete(mint);
      return value;
    });
  inflight.set(mint, promise);
  return promise;
}

/**
 * The slim rows for a few mints — the Portfolio's stock holdings — from the
 * same universe the Stocks page reads, in the shape its table draws: a
 * handful of rows, not the whole market (the full universe is ~460 KB of
 * JSON for 388 rows; a slim row is a few hundred bytes).
 */
async function readSlimRows(mints: readonly string[]): Promise<ReadonlyMap<string, SlimStockRow> | null> {
  const key = [...mints].sort().join(",");
  const hit = slimRows.get(key);
  if (hit && Date.now() - hit.at < UNIVERSE_TTL_MS) return hit.value;
  try {
    const response = await fetch(`/api/stocks/universe?shape=slim&mints=${encodeURIComponent(key)}`, { headers: { accept: "application/json" } });
    const body = response.ok ? ((await response.json()) as { rows: SlimStockRow[] }) : null;
    const value = body ? new Map(body.rows.map((row) => [row.mint, row])) : null;
    slimRows.set(key, { at: Date.now(), value });
    return value;
  } catch {
    slimRows.set(key, { at: Date.now(), value: null });
    return null;
  }
}

export function useStockAsset(mint: string | null): StockAsset | null | undefined {
  const [asset, setAsset] = useState<StockAsset | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setAsset(undefined);
    if (!mint) return undefined;
    void readAsset(mint).then((value) => {
      if (live) setAsset(value);
    });
    return () => {
      live = false;
    };
  }, [mint]);
  return asset;
}

/** The slim stock rows for these mints; null until read, and null when the read failed. */
export function useStockRows(mints: readonly string[]): ReadonlyMap<string, SlimStockRow> | null {
  const [rows, setRows] = useState<ReadonlyMap<string, SlimStockRow> | null>(null);
  const key = [...mints].sort().join(",");
  useEffect(() => {
    if (key.length === 0) return undefined;
    let live = true;
    void readSlimRows(key.split(",")).then((value) => {
      if (live) setRows(value);
    });
    return () => {
      live = false;
    };
  }, [key]);
  return key.length === 0 ? null : rows;
}

function ageOf(iso: string | null, uk: boolean): string {
  if (!iso) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return uk ? `${seconds} с тому` : `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return uk ? `${minutes} хв тому` : `${minutes}m ago`;
}

/**
 * The line under a stock's price in the Spot header: the issuer's reference
 * and its state, the session, the deviation of the token's per-share price
 * from the reference, and the way into the research page.
 */
export function StockHeaderLine({ mint, symbol }: { mint: string; symbol: string }) {
  const { text, locale } = useSolanaI18n();
  const uk = locale === "uk";
  const asset = useStockAsset(mint);
  if (asset === undefined) return <p className={styles.stockLine}>{text("Reading the reference…")}</p>;
  if (asset === null) return null;
  const { row } = asset;
  const state = REFERENCE_STATE_WORDS[row.reference.state][uk ? "uk" : "en"];
  const session = SESSION_WORDS[row.session.period][uk ? "uk" : "en"];
  const tone = toneOf(row.deviationPct);
  /* A pre-IPO token: the issuer's mark named as such, its life state, no session — a private company has neither an exchange reference nor a bell. */
  if (row.representation.instrument?.class === "pre-ipo") {
    const mark = row.issuerMark;
    const markTone = toneOf(row.markPremiumPct);
    return (
      <p className={styles.stockLine}>
        <span>
          {text("Issuer's mark")}{" "}
          <b translate="no">{mark?.perUnit == null ? "—" : formatUsdPrice(mark.perUnit, locale)}</b>
          {mark ? <span className={styles.flat}> · {ageOf(mark.fetchedAt, uk)}</span> : null}
        </span>
        {row.markPremiumPct !== null ? (
          <span>
            {text("Token vs mark")}{" "}
            <b className={markTone === "up" ? styles.up : markTone === "down" ? styles.down : styles.flat} translate="no">{formatPercent(row.markPremiumPct, locale)}</b>
          </span>
        ) : null}
        <span>{LIFECYCLE_WORDS[row.lifecycle.state][uk ? "uk" : "en"]}</span>
        <Link href={`/app/stocks/${encodeURIComponent(symbol)}`}>{text("Research")} →</Link>
      </p>
    );
  }
  return (
    <p className={styles.stockLine}>
      <span>
        {text("Reference price")}{" "}
        <b translate="no">{row.reference.perShare === null ? "—" : formatUsdPrice(row.reference.perShare, locale)}</b> · {state}
        {row.reference.fetchedAt ? <span className={styles.flat}> · {ageOf(row.reference.fetchedAt, uk)}</span> : null}
      </span>
      <span>{session}</span>
      {row.deviationPct !== null ? (
        <span>
          {text("Deviation")}{" "}
          <b className={tone === "up" ? styles.up : tone === "down" ? styles.down : styles.flat} translate="no">{formatPercent(row.deviationPct, locale)}</b>
        </span>
      ) : null}
      <Link href={`/app/stocks/${encodeURIComponent(symbol)}`}>{text("Research")} →</Link>
    </p>
  );
}

/**
 * The Market and Asset blocks of a stock's Review: the reviewed amount in
 * underlying units through the active multiplier, the executable per-share
 * price against the reference, the session, the units. It never replaces the
 * quote, the minimum received or the fees above it, and it says so when the
 * reference is not there.
 *
 * Three cuts of the same facts: *essential* is what Simple keeps open — the
 * price of this order per share and the reference with the deviation;
 * *details* is what Simple folds — the underlying units, the session, the
 * units and the reference's source; *full* is Pro, everything at once. With a
 * plan's price bound the block says plainly, beside the figure, when this
 * order's per-share price is above it — before the Review, which still
 * decides.
 */
export function StockReviewBlock({
  mint,
  side,
  order,
  tokenDecimals,
  variant = "full",
  planMaxPerShare = null,
}: {
  mint: string;
  side: "BUY" | "SELL";
  order: Readonly<{ inAmountRaw: string; outAmountRaw: string; inUsdValue: string | null; outUsdValue: string | null }>;
  tokenDecimals: number | null;
  variant?: "full" | "essential" | "details";
  planMaxPerShare?: number | null;
}) {
  const { text, locale } = useSolanaI18n();
  const uk = locale === "uk";
  const asset = useStockAsset(mint);
  if (!asset || tokenDecimals === null) return null;
  const { row } = asset;
  const multiplier = asset.chainMultiplier?.current ?? row.multiplier?.current ?? null;
  const tokenRaw = side === "BUY" ? order.outAmountRaw : order.inAmountRaw;
  const usdText = side === "BUY" ? order.inUsdValue : order.outUsdValue;
  const usd = usdText === null ? null : Number(usdText);
  const scaled = multiplier === null ? null : scaledAmountString(BigInt(tokenRaw), tokenDecimals, multiplier, 6);
  const executable = scaled !== null && usd !== null && Number.isFinite(usd) ? perShareExecutable(usd, scaled) : null;
  const deviation = deviationPct(executable, row.reference.perShare);
  const tone = toneOf(deviation);
  const state = REFERENCE_STATE_WORDS[row.reference.state][uk ? "uk" : "en"];
  const session = SESSION_WORDS[row.session.period][uk ? "uk" : "en"];
  const multiplierState = asset.chainMultiplierState ?? row.multiplierState;
  const essential = variant !== "details";
  const details = variant !== "essential";
  /* A token-priced instrument (the pre-IPO issuers): the same figures on the scaled amount, said per token; the issuer's mark in the reference's place, named as such. */
  const perToken = row.representation.instrument?.unitBasis === "token";
  const preIpo = row.representation.instrument?.class === "pre-ipo";
  const mark = row.issuerMark;
  const fee = row.transferFee;
  const index = row.companyIndex ?? null;
  const orderVsMark = preIpo ? markPremiumPct(executable, mark?.perUnit ?? null) : null;
  /* The bound is per unit — a share, or a token for a token plan — the same basis as the executable price; only a known per-unit price is compared. */
  const aboveBound = side === "BUY" && planMaxPerShare !== null && executable !== null && executable > planMaxPerShare;
  return (
    <>
      <dl className={styles.costs} data-stock-review>
        {details ? (
          <div>
            <dt>{perToken ? text("Tokens") : text("Underlying units")}</dt>
            <dd translate="no">{scaled === null ? "—" : `${scaled} ${perToken ? row.representation.symbol : row.representation.underlying.symbol}`}</dd>
          </div>
        ) : null}
        {essential ? (
          <>
            <div>
              <dt>{perToken ? (variant === "essential" ? text("This order, per token") : text("Per token")) : variant === "essential" ? text("This order, per share") : text("Per share")}</dt>
              <dd translate="no" data-tone={aboveBound ? "caution" : undefined}>{executable === null ? "—" : formatUsdPrice(executable, locale)}</dd>
            </div>
            {preIpo ? (
              <div>
                <dt>{text("Issuer's mark")}</dt>
                <dd translate="no">
                  {mark?.perUnit == null ? "—" : formatUsdPrice(mark.perUnit, locale)}
                  {/* This order's per-token price against the issuer's mark — the one comparison in the token's own unit. */}
                  {orderVsMark !== null ? ` · ${formatPercent(orderVsMark, locale)} ${text("vs the mark")}` : ""}
                  {mark ? ` · ${text("not a market reference")} · ${ageOf(mark.fetchedAt, uk)}` : ""}
                </dd>
              </div>
            ) : (
              <>
                <div>
                  <dt>{text("Reference price")}</dt>
                  <dd translate="no">
                    {row.reference.perShare === null ? "—" : formatUsdPrice(row.reference.perShare, locale)} · {state}
                    {row.reference.observedAt ?? row.reference.fetchedAt ? ` · ${ageOf(row.reference.observedAt ?? row.reference.fetchedAt, uk)}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>{text("Deviation")}</dt>
                  <dd className={tone === "up" ? styles.up : tone === "down" ? styles.down : undefined} translate="no">{formatPercent(deviation, locale)}</dd>
                </div>
              </>
            )}
            {fee ? (
              <div>
                <dt>{text("Token transfer fee")}</dt>
                <dd translate="no">
                  {(fee.basisPoints / 100).toFixed(2)}% · {text("the issuer's, inside the route")}
                </dd>
              </div>
            ) : null}
          </>
        ) : null}
        {details ? (
          <>
            {preIpo ? (
              <div>
                <dt>{text("Status")}</dt>
                <dd>{LIFECYCLE_WORDS[row.lifecycle.state][uk ? "uk" : "en"]}</dd>
              </div>
            ) : (
              <div>
                <dt>{text("Session")}</dt>
                <dd>{session}</dd>
              </div>
            )}
            <div>
              <dt>{text("Units")}</dt>
              <dd translate="no">
                {multiplier === null ? "—" : perToken ? `${text("tokens as the wallet shows them")}${Math.abs(multiplier - 1) > 1e-9 ? ` · ×${multiplier.toFixed(6)}` : ""}` : `1 ${row.representation.symbol} = ${multiplier.toFixed(6)} ${row.representation.underlying.symbol}`}
                {multiplierState === "activation-window" ? ` · ${text("multiplier changing now")}` : multiplierState === "pending" ? ` · ${text("a new multiplier is pending")}` : ""}
              </dd>
            </div>
            {row.reference.source.id !== "none" ? <div><dt>{text("Reference source")}</dt><dd>{row.reference.source.label}</dd></div> : null}
            {preIpo && mark ? <div><dt>{text("Mark source")}</dt><dd>{mark.source.label}</dd></div> : null}
            {preIpo && index ? (
              <div>
                <dt>{text("Company index")}</dt>
                <dd translate="no">
                  {index.valueUsd === null ? `${index.symbol} · ${text("unavailable")}` : `${formatUsdPrice(index.valueUsd, locale)} · ${index.symbol}`}
                  {` · ${index.source.label} · ${text("indicative · not the token's price")}`}
                </dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>
      {aboveBound && executable !== null && planMaxPerShare !== null ? (
        <p className={styles.warning} role="status" data-plan-bound>
          <b>{text("The price of this order is above your plan's limit.")}</b>{" "}
          <span translate="no">
            {text("Now")} {formatUsdPrice(executable, locale)} · {text("Your limit")} {formatUsdPrice(planMaxPerShare, locale)}
          </span>
          {" · "}
          {text("The Review decides at signing.")}
        </p>
      ) : null}
    </>
  );
}

/** A token this far from the exchange's reference, per cent, is worth a chip in a row («Дорого» past 1 %). */
const ROW_DEVIATION_PCT = 1;

/**
 * What a Portfolio row of a stock says of its market, when it is not the
 * ordinary: a session other than the regular one, and a token more than 1 %
 * from the exchange's reference (the premium the product calls «Дорого»). The
 * regular session and a price in line with the exchange say nothing — the row
 * stays the position's own; the company's page keeps every figure.
 */
export function StockRowChips({ row }: { row: SlimStockRow }) {
  const { text, locale } = useSolanaI18n();
  const uk = locale === "uk";
  const tone = toneOf(row.deviation);
  const session = row.period !== "market";
  const deviation = row.deviation !== null && Math.abs(row.deviation) > ROW_DEVIATION_PCT;
  if (!session && !deviation) return null;
  return (
    <span className={styles.stockChips}>
      {session ? <span className={styles.chip}>{SESSION_WORDS[row.period][uk ? "uk" : "en"]}</span> : null}
      {deviation ? (
        <span className={styles.chip} data-tone={tone === "flat" ? undefined : tone} title={text("Deviation from the reference")}>
          {formatPercent(row.deviation as number, locale)}
        </span>
      ) : null}
    </span>
  );
}
