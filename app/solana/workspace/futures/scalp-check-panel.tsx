"use client";

import { useId, useMemo, useState } from "react";

import type { PerpSide } from "@/lib/phoenix/orders-model";

import { formatAmount, formatTerminalPrice, priceDecimals } from "../spot/spot-format";

import { perpsWord } from "./perps-words";
import { scalpCheck, scalpUnits, type BookLevels, type ScalpRates } from "./scalp-check";

import styles from "./perps.module.css";

type Lang = "en" | "uk";

/**
 * Dollars for the panel: a fee on a small round trip is cents of a cent, and showing it as «$0,00» would be the same
 * as hiding it — so under a hundred dollars four places stand. What the book is worth needs none of them.
 */
const money = (value: number | null, intl: string): string =>
  value === null || !Number.isFinite(value)
    ? "—"
    : `$${new Intl.NumberFormat(intl, { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(value) >= 100 ? 2 : 4 }).format(value)}`;

/** Both legs of the round trip together; null when either side's rate was not known — never counted as nothing. */
const both = (first: number | null, second: number | null): number | null => (first === null || second === null ? null : first + second);

/** A number typed as a plain amount of dollars; null for anything else. */
function dollars(text: string): number | null {
  const clean = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,12}(\.\d{0,6})?$/.test(clean)) return null;
  const value = Number(clean);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Scalp Check (PERP-7; spec §8): beside the spread in Pro, «Перевірити вартість угоди» opens what one round trip of
 * a typed size costs on the book as it stands — size, spread, Phoenix's fee and Ryntra's, the slippage getting in and
 * getting out, and the price move that brings the whole thing back to nothing.
 *
 * Every figure walks the levels Phoenix actually sent (`scalp-check.ts`), never an assumed impact on the best price.
 * Where the book cannot carry the size, it says so with what each side can carry instead of quietly rounding the
 * numbers down. It prices execution — cost, depth and how uncertain they are — and says nothing about what a trade
 * might earn.
 */
export function ScalpCheckPanel({ book, stale, coin, markUsd, rates, lang }: { book: BookLevels | null; stale: boolean; coin: string; markUsd: number | null; rates: ScalpRates; lang: Lang }) {
  const intl = lang === "uk" ? "uk-UA" : "en-US";
  const w = (key: Parameters<typeof perpsWord>[1], fill?: Readonly<Record<string, string>>) => perpsWord(lang, key, fill);
  const panel = useId();
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<PerpSide>("long");
  const [text, setText] = useState("");

  const decimals = priceDecimals(markUsd ?? book?.asks[0]?.price ?? null);
  const price = (value: number | null) => formatTerminalPrice(value, intl, decimals);
  /*
   * A spread and a break-even move are distances, not prices: on a market quoted to the cent they can be a fraction
   * of one, and the market's own two places would print the whole answer as «0,00». Under a cent they get four.
   */
  const move = (value: number | null) => formatTerminalPrice(value, intl, value !== null && Math.abs(value) < 0.01 ? Math.max(decimals, 4) : decimals);
  const percent = (value: number | null) => (value === null || !Number.isFinite(value) ? "—" : `${formatAmount(value, intl, 3)}${lang === "en" ? "%" : " %"}`);
  const depthLine = (units: number, usd: number) => w("scalp.depth", { units: formatAmount(units, intl, 4), coin, usd: money(usd, intl) });

  /* The size is typed in dollars, as the ticket's is; the book is walked in the coin, at the price the book shows. */
  const reference = (side === "long" ? book?.asks[0]?.price : book?.bids[0]?.price) ?? markUsd;
  const check = useMemo(
    () => scalpCheck({ side, sizeUnits: scalpUnits(dollars(text), reference ?? null) ?? 0, book, rates, stale }),
    [side, text, reference, book, rates, stale],
  );

  const row = (label: string, value: string) => (
    <div key={label}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );

  return (
    <div className={styles.scalp} data-perps-scalp={open ? "open" : "closed"}>
      <button type="button" className={styles.scalpOpen} aria-expanded={open} aria-controls={panel} onClick={() => setOpen((shown) => !shown)} data-perps-scalp-open>
        {w("scalp.open")}
      </button>
      {open ? (
        <div id={panel} className={styles.scalpBody}>
          {/* The check stands over the book on the panel's whole height, so it carries its own name and its own way out. */}
          <p className={styles.scalpHead}>
            <strong>{w("scalp.title")}</strong>
            <button type="button" className={styles.scalpOpen} onClick={() => setOpen(false)} data-perps-scalp-hide>
              {w("scalp.hide")}
            </button>
          </p>
          <div className={styles.scalpForm}>
            <div className={styles.segment} role="group" aria-label={w("scalp.side")}>
              {(["long", "short"] as const).map((entry) => (
                <button key={entry} type="button" aria-pressed={side === entry} onClick={() => setSide(entry)} data-perps-scalp-side={entry}>
                  {w(entry === "long" ? "scalp.long" : "scalp.short")}
                </button>
              ))}
            </div>
            <label className={styles.scalpAmount}>
              <span>{w("scalp.size")}</span>
              <input inputMode="decimal" autoComplete="off" placeholder="0" value={text} onChange={(event) => setText(event.target.value)} data-perps-scalp-size />
            </label>
          </div>
          {check.kind === "none" ? (
            <p className={styles.muted}>{w(check.reason === "book" ? "scalp.noBook" : "scalp.noSize")}</p>
          ) : check.kind === "thin" ? (
            /* Honest figures, not a quietly smaller order: what each side of the book can actually carry. */
            <div data-perps-scalp-thin>
              <p className={styles.scalpThin} role="status">
                {w("scalp.thin")}
              </p>
              <dl className={styles.scalpFacts}>
                {row(w("scalp.thinIn"), depthLine(check.depth.entryUnits, check.depth.entryNotionalUsd))}
                {row(w("scalp.thinOut"), depthLine(check.depth.exitUnits, check.depth.exitNotionalUsd))}
              </dl>
            </div>
          ) : (
            <>
              <dl className={styles.scalpFacts} data-perps-scalp-cost>
                {row(w("scalp.spread"), check.spreadUsd === null ? "—" : `${move(check.spreadUsd)} · ${percent(check.spreadPercent)}`)}
                {row(w("scalp.entry"), `${price(check.entry.averageUsd)} · ${formatAmount(check.sizeUnits, intl, 4)} ${coin}`)}
                {row(w("scalp.exit"), price(check.exit.averageUsd))}
                {row(w("scalp.feePhoenix"), money(both(check.entry.phoenixUsd, check.exit.phoenixUsd), intl))}
                {row(w("scalp.feeRyntra"), money(both(check.entry.ryntraUsd, check.exit.ryntraUsd), intl))}
                {row(w("scalp.slipIn"), percent(check.entry.slippagePercent))}
                {row(w("scalp.slipOut"), percent(check.exit.slippagePercent))}
              </dl>
              <p className={styles.scalpBreakEven} data-perps-scalp-breakeven>
                <span>{w("scalp.breakEven")}</span>
                <strong>{check.breakEvenUsd === null ? "—" : `${move(check.breakEvenUsd)} · ${percent(check.breakEvenPercent)}`}</strong>
              </p>
              <p className={styles.muted}>{w("scalp.breakEvenNote")}</p>
              <p className={styles.muted}>{`${w("scalp.maker")}: ${money(check.makerFeesUsd, intl)} — ${w("scalp.makerNote")}`}</p>
            </>
          )}
          {stale ? <p className={styles.scalpStale} role="status">{w("scalp.stale")}</p> : null}
          <p className={styles.muted}>{w("scalp.note")}</p>
        </div>
      ) : null}
    </div>
  );
}
