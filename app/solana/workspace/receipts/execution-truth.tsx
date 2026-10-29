"use client";

import Link from "next/link";
import { useMemo } from "react";

import { receiptTruth, type TruthAsset, type TruthAssets } from "@/lib/solana/receipt-truth";
import { useSolanaI18n } from "../i18n/provider";
import { truthHero, truthLines, type TruthCashbackInput } from "./truth-lines.ts";
import { truthWords } from "./truth-words.ts";

import styles from "./execution-truth.module.css";

/**
 * «Правда виконання» (SOL-X1) on a receipt: what arrived, against the same route without Ryntra's fee, and every fee
 * of the trade beside its actual cashback. Read off the signed receipt itself, so the swap card after a swap, the
 * receipts page and History say the same thing. A receipt that is not a swap or a launch trade, or whose facts are not
 * whole, draws nothing — the receipt stays as it was.
 */
export function ExecutionTruth({
  receipt,
  known,
  sides,
  cashback,
}: {
  receipt: unknown;
  /** The scale of the trade's mints, where a history row knows it. */
  known?: TruthAssets;
  /** Or the scale of what was spent and what arrived, where the card that made the trade holds it. */
  sides?: Readonly<{ spent: TruthAsset; received: TruthAsset }>;
  cashback: TruthCashbackInput;
}) {
  const { locale } = useSolanaI18n();
  const lang = locale === "uk" ? "uk" : "en";
  /* Keyed on the scales' values: the callers pass a new object each render, and the receipt's parse need not rerun. */
  const scales = JSON.stringify([known ?? null, sides ?? null]);
  const read = useMemo(() => {
    const [knownNow, sidesNow] = JSON.parse(scales) as [TruthAssets | null, Readonly<{ spent: TruthAsset; received: TruthAsset }> | null];
    const first = receiptTruth(receipt, knownNow ?? undefined);
    if (!first || !sidesNow) return first;
    return { ...first, assets: { [first.truth.spent.mint]: sidesNow.spent, [first.truth.received.mint]: sidesNow.received, ...first.assets } };
  }, [receipt, scales]);
  if (!read) return null;
  const word = truthWords(locale);
  const hero = truthHero(read, lang);
  const lines = truthLines(read, cashback, lang);
  return (
    <section className={styles.truth} aria-label={word("title")} data-truth={read.truth.kind}>
      <header className={styles.head}>
        <h4 className={styles.title}>{word("title")}</h4>
        <Link className={styles.how} href="/app/fees" prefetch={false}>
          {word("how")}
        </Link>
      </header>
      <p className={styles.hero}>
        <span>{hero.label}</span>
        <b translate="no">{hero.value}</b>
      </p>
      <dl className={styles.lines}>
        {lines.map((line) => (
          <div key={line.key} data-line={line.key} data-tone={line.tone}>
            <dt>{line.label}</dt>
            <dd translate="no">{line.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
