"use client";

/**
 * A page of the product that is not yet a capability.
 *
 * The routes, the shell and the links of all eleven pages may be laid down at
 * once, with exactly one thing forbidden while they are: **an unimplemented
 * module gets no invented balances, no live quotes and no active execute
 * button.** This surface is what that permission and that prohibition look
 * like together.
 *
 * Three rules it keeps, none of them decorative:
 *
 * **It says which of the four statuses it is, in the product's own words**, and
 * it *looks the word up* from the route registry by page id rather than being
 * handed one. The first version took a `readiness` prop, and within an hour
 * Ideas was declared `building` in the registry and `planned` on the page — the
 * rail said nothing while the page said `In the plan`. A page cannot state a
 * status it does not own.
 *
 * **It states what the page is for before it states what is missing.** A person
 * who opened Perps wants to know what Perps will be. A page that opens with an
 * apology has told them nothing.
 *
 * **It ends on something that works today.** A dead end is a defect however
 * honestly it is worded, so every one of these carries one real destination —
 * the nearest thing the product can actually do — and that link is the page's
 * single primary action.
 *
 * There is no fake chart, no greyed-out ticket and no disabled Buy button. A
 * disabled control is a claim that the control exists.
 */

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";

import { StatusChip } from "@/app/shell/status-chip";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
import type { PageReadiness, ProductPageId } from "@/app/shell/domains";
import { PRODUCT_ROUTES } from "@/app/shell/product-routes";
import styles from "./not-yet.module.css";

export type NotYetCopy = Readonly<{
  /** The page's own name, as the rail says it. */
  title: string;
  /**
   * The one line under the name — what kind of thing this page is, e.g.
   * `Prediction markets · Agg integration`. A locked page reads *name · what
   * it is · Coming soon*, and looks intended.
   */
  tagline?: string;
  /** One sentence: what a person will do here — its «Призначення». */
  purpose: string;
  /** What the page will hold. Three to five short lines, never a paragraph. */
  holds: readonly string[];
  /** The one thing that works today, and where it is. */
  instead: Readonly<{ label: string; href: string; hint: string }>;
}>;

/* The word for a locked page is *Coming soon*: visible, intended, and not
   yet a capability. The rail says the short form of the same fact from the
   same registry. */
const STATUS_WORD: Readonly<Record<PageReadiness, Readonly<{ en: string; uk: string }>>> = {
  available: { en: "Available", uk: "Доступно" },
  building: { en: "Being built", uk: "Розробляється" },
  planned: { en: "Coming soon", uk: "Незабаром" },
};

function readinessOf(page: ProductPageId): PageReadiness {
  const route = PRODUCT_ROUTES.find((candidate) => candidate.id === page);
  if (!route) throw new Error(`Ryntra page "${page}" is not in the route registry.`);
  if (route.readiness === "available") {
    /* A page that renders this surface is by definition not a capability. If the
       registry says otherwise the two have drifted, and the loud failure is the
       point: the alternative is a working-looking page that does nothing. */
    throw new Error(`Ryntra page "${page}" is registered available but renders the not-yet surface.`);
  }
  return route.readiness;
}

export function NotYet({
  page,
  en,
  uk,
}: {
  page: ProductPageId;
  en: NotYetCopy;
  uk: NotYetCopy;
}) {
  const { locale } = useSolanaI18n();
  const isUk = locale === "uk";
  const copy = isUk ? uk : en;
  const status = STATUS_WORD[readinessOf(page)][isUk ? "uk" : "en"];

  return (
    <section className={styles.page} aria-labelledby="not-yet-title">
      <header className={styles.head}>
        <h1 id="not-yet-title">{copy.title}</h1>
        {/* Neutral by construction. A page that is unfinished is not a page that
            is dangerous — and the maturity family has only the LIVE look in the
            shared stylesheet, so it would print `Coming soon` in the colour that
            means *this works now*. A readiness is a fact, not a verdict. */}
        <StatusChip family="descriptor">{status}</StatusChip>
      </header>

      {copy.tagline ? <p className={styles.tagline}>{copy.tagline}</p> : null}

      <p className={styles.purpose}>{copy.purpose}</p>

      <div className={styles.holds}>
        <h2 className={styles.holdsTitle}>{isUk ? "Що тут буде" : "What this page will hold"}</h2>
        <ul>
          {copy.holds.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className={styles.instead}>
        <p className={styles.insteadHint}>{copy.instead.hint}</p>
        <Link className={styles.insteadLink} href={copy.instead.href}>
          <span>{copy.instead.label}</span>
          <ArrowRight size={18} weight="bold" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
