"use client";

import type { SpotMarket } from "@/lib/spot/markets";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { cautionFact, riskFactsOf, type RiskFact } from "./risk-facts.ts";
import { formatAge, formatCount, formatUsdCompact } from "./spot-format.ts";

import styles from "./spot.module.css";

/**
 * The token's risk in one line by «Купити» (SOL-C12, UX-156): the facts without a verdict — «Випуск увімкнено ·
 * Ліквідність $4,6 тис. · Топ-10 28,8 % · Холдери 710 · З'явився сьогодні» — over the ticket on a desk and over the pinned «Купити | Продати» on a
 * phone. Every fact here is in the strip or in «Ризик» with its source; this line only brings them to the decision.
 */
export function RiskLine({ market, lang }: Readonly<{ market: SpotMarket | null; lang: "en" | "uk" }>) {
  const { text } = useSolanaI18n();
  const facts = riskFactsOf(market, Date.now());
  if (facts.length === 0) return null;
  const locale = lang === "uk" ? "uk-UA" : "en-US";
  const word = (fact: RiskFact): string => {
    switch (fact.kind) {
      case "flagged":
        return text("Flagged");
      case "unverified":
        return text("Not verified by Jupiter");
      case "mint-on":
        return text("Minting on");
      case "freeze-on":
        return text("Freeze on");
      case "top":
        return `${text("Top 10")} ${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(fact.pct)}%`;
      case "liquidity":
        return `${text("Liquidity")} ${formatUsdCompact(fact.usd, locale)}`;
      case "holders":
        return `${text("Holders")} ${formatCount(fact.count, locale)}`;
      case "age":
        return fact.days < 1 ? text("Listed today") : `${text("Age")} ${formatAge(fact.days, lang === "uk")}`;
    }
  };
  return (
    <p className={styles.riskLine} data-risk-line title={text("Facts from Jupiter, not a verdict. «Risk» has each one with its source.")}>
      <b>{text("Risk")}</b>
      {facts.map((fact) => (
        <span key={fact.kind} data-tone={cautionFact(fact) ? "caution" : undefined}>
          {word(fact)}
        </span>
      ))}
    </p>
  );
}
