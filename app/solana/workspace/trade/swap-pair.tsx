"use client";

import Link from "next/link";

import { MarketIcon } from "../spot/market-list.tsx";

import styles from "./swap-pair.module.css";

/** One side of the pair as the panel reads it: the catalogue's claims, labelled as Jupiter's, and the wallet's balance. */
export type SwapPairSide = Readonly<{
  mint: string;
  code: string;
  name: string;
  icon: string | null;
  /** USD per whole unit, Jupiter's; null when it states none. */
  usd: number | null;
  verified: boolean | null;
  suspicious: boolean;
  /** What this wallet may spend of it, already scaled; null without a wallet or an answer. */
  balance: string | null;
}>;

/**
 * The pair beside the converter (SOL-C13): where Spot has its chart, Swap has the two assets and the one price between
 * them — with its age and source, said once (UX-261, UX-907) — and the two doors out: the chart and limit orders in Spot
 * for this very pair (UX-260, UX-017), funds on another network in «Між мережами». No figure here is the trade's: the
 * amounts, every cost and the minimum stand in the ticket and its Review.
 */
export function SwapPair({ pay, receive, age, offline, route, spotHref, text, locale }: {
  pay: SwapPairSide;
  receive: SwapPairSide;
  /** Seconds since the prices were read; null — not read yet. */
  age: number | null;
  offline: boolean;
  /** The live quote's route, when there is one. */
  route: string | null;
  spotHref: string;
  text: (english: string) => string;
  locale: "uk" | "en";
}) {
  const number = (value: number, digits: number) => value.toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { maximumSignificantDigits: digits });
  /* A dollar price in cents from a dollar up, in four significant digits under it — a meme keeps its digits. */
  const dollars = (value: number) =>
    value >= 1
      ? value.toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : number(value, 4);
  const rate = pay.usd !== null && receive.usd !== null && receive.usd > 0 ? pay.usd / receive.usd : null;
  const ageText = age === null ? null : age < 60 ? `${age} ${text("s ago")}` : age < 3600 ? `${Math.floor(age / 60)} ${text("min ago")}` : `${Math.floor(age / 3600)} ${text("h ago")}`;
  /* Two minutes without a fresh read is no longer the price, only the last one known (B-07). */
  const stale = age !== null && age > 120;
  const meta = offline
    ? null
    : ageText === null
      ? null
      : stale
        ? `${text("Last known price")} · ${ageText}`
        : `Jupiter · ${ageText}`;

  const row = (side: SwapPairSide, label: string) => (
    <li className={styles.asset}>
      <MarketIcon mint={side.mint} icon={side.icon} symbol={side.code} size={32} />
      <span className={styles.name}>
        <span className={styles.label}>{label}</span>
        <b translate="no">{side.code}</b>
        {side.name ? <span className={styles.sub} translate="no">{side.name}</span> : null}
      </span>
      <span className={styles.figure}>
        <span className={styles.label}>{text("Price")}</span>
        <b translate="no">{side.usd === null ? "—" : `$${dollars(side.usd)}`}</b>
      </span>
      {side.balance !== null ? (
        <span className={styles.figure}>
          <span className={styles.label}>{text("Balance")}</span>
          <b translate="no">{side.balance}</b>
        </span>
      ) : null}
      <span className={styles.check} data-tone={side.suspicious ? "caution" : side.verified ? "verified" : "plain"}>
        {side.suspicious ? text("Flagged by Jupiter") : side.verified ? text("Verified by Jupiter") : text("Not verified by Jupiter")}
      </span>
      <Link className={styles.details} href={`/app/assets?mint=${side.mint}`} aria-label={`${text("About")} ${side.code}`}>
        {text("About")}
        <span aria-hidden="true"> →</span>
      </Link>
    </li>
  );

  return (
    <section className={styles.pair} aria-label={text("The pair")} data-swap-pair>
      <header className={styles.head}>
        <span className={styles.marks} aria-hidden="true">
          <MarketIcon mint={pay.mint} icon={pay.icon} symbol={pay.code} size={28} />
          <MarketIcon mint={receive.mint} icon={receive.icon} symbol={receive.code} size={28} />
        </span>
        <h2 className={styles.title} translate="no">
          {pay.code} → {receive.code}
        </h2>
        <p className={styles.rate} data-swap-rate data-stale={stale || offline ? "true" : undefined}>
          <b translate="no">{rate === null ? "—" : `1 ${pay.code} ≈ ${number(rate, 6)} ${receive.code}`}</b>
          {/* The age changes every second and is not read out; the state is — the live region is always in place, so
              «Немає зв'язку» and «Остання відома ціна» are announced when they come (UX-907). */}
          {meta ? <span className={styles.meta}>{meta}</span> : null}
          <span className={offline ? styles.meta : styles.live} role="status">
            {offline ? text("No connection") : stale ? text("Last known price") : ""}
          </span>
        </p>
      </header>
      <ul className={styles.assets}>
        {row(pay, text("You pay"))}
        {row(receive, text("You receive"))}
      </ul>
      {route ? (
        <p className={styles.route}>
          <span className={styles.label}>{text("Route")}</span> <span translate="no">{route}</span>
        </p>
      ) : null}
      <nav className={styles.doors} aria-label={text("Other sections")}>
        <Link className={styles.door} href={spotHref}>
          <span>{text("Chart and limit orders")}</span>
          <b>
            {text("Open Spot")}
            <span aria-hidden="true"> →</span>
          </b>
        </Link>
        <Link className={styles.door} href="/app/bridge">
          <span>{text("Funds on another network?")}</span>
          <b>
            {text("Bring them to Solana")}
            <span aria-hidden="true"> →</span>
          </b>
        </Link>
      </nav>
    </section>
  );
}
