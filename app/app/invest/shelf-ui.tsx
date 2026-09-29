"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { formatPercent, formatUsdPrice, toneOf } from "@/app/solana/workspace/spot/spot-format";
import type { ShelfCoin } from "@/lib/spot/coin-shelf";
import type { ShelfCard } from "@/lib/stocks/shelf";

import styles from "./invest.module.css";

/**
 * The shelf's two shapes (canon v5.0 §2: a company by its logo and name, a
 * price in dollars, the day's change — nothing else at rest).
 *
 * A **tile** is Home's «Популярні компанії»: a square a thumb lands on.
 * A **row** is Markets': one company to a row, full width on a phone, in
 * columns on a wide screen. Both are links — the whole card is the target —
 * to the company's page, or to Spot for a coin.
 */

export type ShelfItem = Readonly<{
  key: string;
  name: string;
  href: string;
  mint: string;
  icon: string | null;
  price: number;
  change24h: number | null;
  /** A short mark under the name — «Це не акція» on a private company. */
  note?: string;
  /** A quiet line beside the mark — a private company's one number, its price against the issuer's valuation. */
  sub?: string;
  /** A coin's icon comes from any host, and the optimiser refuses some: served as it is. */
  plainIcon?: boolean;
  /** The row carries its one number in place of the day's change (a private company, canon v5.2 В27). */
  oneNumber?: boolean;
}>;

/**
 * A company's card. A private company's card (`privateLine`) carries «Це не
 * акція» and its one number — «на 31% дорожче за оцінку PreStocks» — in place
 * of the day's change: one number, not two (canon v5.2 В27).
 */
export function companyItem(card: ShelfCard, privateLine?: Readonly<{ note: string; premium: string | null }>): ShelfItem {
  return {
    key: card.mint,
    name: card.name,
    href: `/app/stocks/${encodeURIComponent(card.ticker)}`,
    mint: card.mint,
    icon: card.icon,
    price: card.price,
    change24h: card.change24h,
    note: privateLine?.note,
    sub: privateLine?.premium ?? undefined,
    oneNumber: privateLine !== undefined,
  };
}

export function coinItem(coin: ShelfCoin): ShelfItem {
  return { key: coin.mint, name: coin.name, href: `/app/spot?mint=${encodeURIComponent(coin.mint)}`, mint: coin.mint, icon: coin.icon, price: coin.price, change24h: coin.change24h, plainIcon: true };
}

function Change({ value, locale }: { value: number | null; locale: string }) {
  if (value === null) return <span className={styles.change} data-tone="flat">—</span>;
  return (
    <span className={styles.change} data-tone={toneOf(value)}>
      {formatPercent(value, locale)}
    </span>
  );
}

export function ShelfTile({ item, locale }: { item: ShelfItem; locale: string }) {
  return (
    <Link className={styles.tile} href={item.href} prefetch={false}>
      <MarketIcon mint={item.mint} icon={item.icon} symbol={item.name} size={40} className={styles.logo} plain={item.plainIcon} />
      <span className={styles.tileName}>{item.name}</span>
      <span className={styles.tileFigures}>
        <span className={styles.price}>{formatUsdPrice(item.price, locale)}</span>
        <Change value={item.change24h} locale={locale} />
      </span>
    </Link>
  );
}

/**
 * One row. `figures` replaces the price and the day's change where the row
 * says something else on the right — what a position is worth, on Home.
 */
export function ShelfRow({ item, locale, figures }: { item: ShelfItem; locale: string; figures?: ReactNode }) {
  return (
    <Link className={styles.row} href={item.href} prefetch={false}>
      <MarketIcon mint={item.mint} icon={item.icon} symbol={item.name} size={36} className={styles.rowLogo} plain={item.plainIcon} />
      {item.oneNumber ? (
        /* A private company: the name with «Це не акція» beside it, and under them its one number, whole — it may wrap, never be cut. */
        <span className={styles.rowName}>
          <span className={styles.rowTitleLine}>
            <span className={styles.rowTitle}>{item.name}</span>
            {item.note ? <span className={styles.note}>{item.note}</span> : null}
          </span>
          {item.sub ? <span className={styles.rowPremium} data-premium>{item.sub}</span> : null}
        </span>
      ) : (
        <span className={styles.rowName}>
          <span className={styles.rowTitle}>{item.name}</span>
          {item.note || item.sub ? (
            <span className={styles.rowMeta}>
              {item.note ? <span className={styles.note}>{item.note}</span> : null}
              {item.sub ? <span className={styles.rowSub}>{item.sub}</span> : null}
            </span>
          ) : null}
        </span>
      )}
      <span className={styles.rowFigures}>
        {figures ?? (
          <>
            <span className={styles.price}>{formatUsdPrice(item.price, locale)}</span>
            {item.oneNumber ? null : <Change value={item.change24h} locale={locale} />}
          </>
        )}
      </span>
    </Link>
  );
}

/** The shape of what is coming — never a spinner (canon v5.0 §2, rule 14). */
export function TileSkeleton({ count, className }: { count: number; className?: string }) {
  return (
    <div className={className ? `${styles.tiles} ${className}` : styles.tiles} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={`${styles.tile} ${styles.ghost}`}>
          <span className={styles.ghostLogo} />
          <span className={styles.ghostLine} />
          <span className={styles.ghostLineShort} />
        </span>
      ))}
    </div>
  );
}

export function RowSkeleton({ count }: { count: number }) {
  return (
    <div className={styles.rows} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={`${styles.row} ${styles.ghost}`}>
          <span className={styles.ghostLogo} />
          <span className={styles.ghostLine} />
          <span className={styles.ghostLineShort} />
        </span>
      ))}
    </div>
  );
}

/** Whether a stored value is a list of shelf cards — the copy is read defensively. */
export function isShelfCards(value: unknown): value is ShelfCard[] {
  return (
    Array.isArray(value) &&
    value.every(
      (card) =>
        typeof card === "object" &&
        card !== null &&
        typeof (card as ShelfCard).name === "string" &&
        typeof (card as ShelfCard).ticker === "string" &&
        typeof (card as ShelfCard).mint === "string" &&
        typeof (card as ShelfCard).price === "number",
    )
  );
}

export function isShelfCoins(value: unknown): value is ShelfCoin[] {
  return (
    Array.isArray(value) &&
    value.every(
      (coin) =>
        typeof coin === "object" &&
        coin !== null &&
        typeof (coin as ShelfCoin).name === "string" &&
        typeof (coin as ShelfCoin).mint === "string" &&
        typeof (coin as ShelfCoin).price === "number",
    )
  );
}
