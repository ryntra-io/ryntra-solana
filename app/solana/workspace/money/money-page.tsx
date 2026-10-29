"use client";

import type { ReactNode } from "react";
import type { Lang } from "@ryntra/core/ui";

import { PageTitle } from "@/app/app/page-title";

import styles from "./money-page.module.css";

/**
 * One frame for the four pages of «Гроші» — Поповнити, Надіслати, Отримати, Між мережами (B18, the B13 review's
 * item 12; `audit/2026-10/solana-web-review/critics/money.md` §5 «Каркас чотирьох вкладок»).
 *
 * The review found a 580 px card alone in the middle of a 1200 px canvas, the page's name three or four times on the
 * first screen and four different shapes for four pages of one section. Here every page is the same object: its name
 * once, as the heading; the form — fields, never a card title — in a 560 px column; and from a desk's width a side
 * column of the page's own context beside it (the latest transfers, the address, the requests), the two as one pair in
 * the middle of the canvas, the heading on the pair's left edge. Below a desk the side column stands under the form.
 * On a phone the form's one action stays pinned above the bottom bar (`MoneyAction`), so the amount and the button are
 * both in reach without scrolling.
 */
export function MoneyPage({
  title,
  help,
  lang,
  form,
  aside,
  below,
  id,
}: {
  /** The page's one name — the menu's word for it. */
  title: string;
  /** What the page is for, behind the «?» beside the heading; never printed under it. */
  help?: ReactNode;
  lang: Lang;
  form: ReactNode;
  /** The page's context: one or two blocks. */
  aside?: ReactNode;
  /** What stands under the pair, as wide as it (the latest transfers on a page with no side column). */
  below?: ReactNode;
  id?: string;
}) {
  return (
    <div className={styles.page} data-money-page={id ?? ""} data-has-aside={aside ? "true" : undefined}>
      <header className={styles.head}>
        <PageTitle className={styles.title} title={title} help={help} lang={lang} />
      </header>
      <div className={styles.pair}>
        <div className={styles.form} data-money-form="">
          {form}
        </div>
        {aside ? (
          <aside className={styles.aside} data-money-aside="">
            {aside}
          </aside>
        ) : null}
      </div>
      {below ? <div className={styles.below}>{below}</div> : null}
    </div>
  );
}

/** The form's surface: one card, no title — the page's heading names it. */
export function MoneyCard({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={[styles.card, className].filter(Boolean).join(" ")}>{children}</section>;
}

/**
 * The form's one action. In the card on a desk; on a phone pinned to the bottom of the screen, above the bottom bar,
 * so it is in reach the moment the amount is typed.
 */
export function MoneyAction({ children }: { children: ReactNode }) {
  return (
    <div className={styles.action} data-money-action="">
      {children}
    </div>
  );
}
