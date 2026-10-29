"use client";

import { ArrowSquareOut } from "@phosphor-icons/react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { advancedPresetOf, type AdvancedTerms as AdvancedTermsOfLaunch } from "@/lib/core/launch/advanced";
import { presetTerms, termsOf } from "@/lib/core/launch/preset-terms";
import { proofOfLaunch, type ProofClaim, type ProofInput, type ProofTopic } from "@/lib/core/launch/proof";
import type { LaunchMarketResponse } from "@/lib/api/v1/contract";

import { explorerUrl, formatBps, formatCountShort, formatDate, formatRaw } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";
import { useLaunchRead } from "./proof-context";

type Word = ReturnType<typeof launchWords>;

/** The topics said here; the program rules — the mint's rights, the curve and the DEX pool's locks, the creator's lock — are the marks above them. */
const SAID_HERE: readonly ProofTopic[] = ["supply", "distribution", "creator", "fees", "migration"];

/**
 * «Доказ запуску» beyond the program rules (SOL-L3): the supply, who holds it, what the creator did, the fees and the
 * move to the DEX — each statement with the transaction or the account it is read at, from the launch receipt the server
 * read and the market and its health the page read. A topic not read now says so, and states nothing.
 */
export function ProofRows({
  network,
  token,
  creator,
  creation,
  preset,
  pair,
  receipt,
  lockUnread,
  exitUnread,
  locale,
  advanced = null,
}: {
  network: "solana:devnet" | "solana:mainnet";
  token: string;
  creator: string;
  creation: string;
  preset: string;
  /** The pair currency the curve raises; null when this network has no pair for the preset. */
  pair: Readonly<{ symbol: string; decimals: number }> | null;
  receipt: ProofInput["receipt"];
  lockUnread: boolean;
  exitUnread: boolean;
  locale: WorkspaceLocale;
  /** «Розширений» (SOL-L5): the launch's own numbers — its terms are theirs, never the template's. */
  advanced?: AdvancedTermsOfLaunch | null;
}) {
  const word = launchWords(locale);
  const { market, health } = useLaunchRead();
  const sections = proofOfLaunch({
    token,
    creator,
    creation,
    terms: advanced ? termsOf(advancedPresetOf(advanced)) : presetTerms(preset),
    receipt,
    lockUnread,
    exitUnread,
    market: market ? marketInput(market) : null,
    health: health ? { top10Bps: health.concentration.top10Bps, top10AtLeast: health.concentration.atLeast, holders: health.holders.count, holdersAtLeast: health.holders.atLeast } : null,
  });
  const shown = sections
    .filter((section) => SAID_HERE.includes(section.topic))
    /* The creator's lock is a program's rule: the marks above say it. */
    .map((section) => ({ ...section, claims: section.claims.filter((claim) => claim.code !== "CREATOR_LOCK") }));
  /* Nothing read at all: one sentence, never five of the same. */
  if (shown.every((section) => section.claims.length === 0)) return <p className={styles.unread}>{word("proofAllUnread")}</p>;
  return (
    <div className={styles.proofTopics}>
      {shown.map((section) => (
        <section key={section.topic} className={styles.proofTopic} aria-labelledby={`launch-proof-${section.topic}`}>
          <h3 className={styles.proofTopicTitle} id={`launch-proof-${section.topic}`}>
            {word(`proofTopic_${section.topic}` as LaunchWordKey)}
            {section.claims.length === 0 ? <span className={styles.cellUnread}> · {word("proofTopicUnread")}</span> : null}
          </h3>
          {section.claims.length ? (
            <ul className={styles.proofList}>
              {section.claims.map((claim) => {
                const text = claimText(claim, { word, locale, pair, decimals: market?.tokenDecimals ?? receipt?.decimals ?? 6 });
                return (
                  <li key={`${claim.code}:${claim.evidence[0]?.id ?? ""}`} className={styles.proofRow}>
                    <span className={styles.proofText}>{text}</span>
                    <span className={styles.proofLinks}>
                      {claim.evidence.map((link) => (
                        <a
                          key={`${link.what}:${link.id}`}
                          className={styles.markLink}
                          href={explorerUrl(network, link.kind, link.id)}
                          target="_blank"
                          rel="noreferrer noopener"
                          aria-label={`${word(`proofWhat_${link.what}` as LaunchWordKey)}: ${text}`}
                        >
                          {word(`proofWhat_${link.what}` as LaunchWordKey)} <ArrowSquareOut size={12} aria-hidden />
                        </a>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {/* A topic read in part: what was read is stated, the rest said as not read. */}
          {section.claims.length && section.unread ? <p className={styles.unread}>{word("proofTopicPartial")}</p> : null}
        </section>
      ))}
    </div>
  );
}

/** What the market read holds for the proof: the supply, the way to the DEX, the creator's sales and share, the move to the DEX. */
export function marketInput(market: LaunchMarketResponse): NonNullable<ProofInput["market"]> {
  const markers = [...market.chart.markers].sort((a, b) => a.t - b.t);
  const holds = market.risk.find((fact) => fact.code === "CREATOR_HOLDS");
  const sold = market.risk.find((fact) => fact.code === "CREATOR_SOLD");
  const graduation = markers.find((marker) => marker.kind === "graduated") ?? null;
  return {
    supplyRaw: market.supplyRaw,
    decimals: market.tokenDecimals,
    migrated: market.progress.migrated,
    progressBps: market.progress.bps,
    thresholdRaw: market.progress.thresholdRaw,
    pool: market.trading.pool,
    curveFeeNowBps: market.curveFee?.nowBps ?? null,
    creatorSales: markers.filter((marker) => marker.kind === "creator-sell").map((marker) => ({ signature: marker.signature, at: marker.t })),
    /* The chart keeps its newest markers only: the count of every sale is the risk fact's, read whole. */
    creatorSalesCount: typeof sold?.values.sales === "number" ? sold.values.sales : null,
    creatorTradesComplete: market.creator.tradesComplete,
    graduation: graduation ? { signature: graduation.signature, at: graduation.t } : null,
    creatorShare: holds?.source?.kind === "account" && typeof holds.values.shareBps === "number" ? { bps: holds.values.shareBps, account: holds.source.id } : null,
  };
}

/** One statement in words, from its figures. */
function claimText(claim: ProofClaim, at: Readonly<{ word: Word; locale: WorkspaceLocale; pair: Readonly<{ symbol: string; decimals: number }> | null; decimals: number }>): string {
  const { word, locale, pair } = at;
  const v = claim.values;
  const n = (key: string) => Number(v[key] ?? 0);
  const raw = (key: string, decimals: number, digits = 2) => formatRaw(String(v[key] ?? "0"), decimals, locale, digits);
  switch (claim.code) {
    case "SUPPLY_FULL":
      return word("proof_SUPPLY_FULL", { supply: raw("supplyRaw", n("decimals")) });
    case "SUPPLY_BURNED":
      return word("proof_SUPPLY_BURNED", { supply: raw("supplyRaw", n("decimals")), launched: raw("launchedRaw", n("decimals")), burned: raw("burnedRaw", n("decimals")) });
    case "TOP10":
      return word(n("atLeast") ? "proof_TOP10_atLeast" : "proof_TOP10", { pct: formatBps(n("bps"), locale) });
    case "HOLDERS":
      return word(n("atLeast") ? "proof_HOLDERS_atLeast" : "proof_HOLDERS", { n: formatCountShort(n("count"), locale) });
    case "CREATOR_SHARE":
      return word("proof_CREATOR_SHARE", { pct: formatBps(n("bps"), locale) });
    case "FIRST_BUY":
      return word("proof_FIRST_BUY", { tokens: raw("tokensRaw", at.decimals, 0), amount: pair ? raw("quoteRaw", pair.decimals) : "—", symbol: pair?.symbol ?? "" });
    case "CREATOR_SOLD":
      return word("proof_CREATOR_SOLD", { n: n("sales"), ago: formatDate(n("at") * 1000, locale) });
    case "CURVE_FEE": {
      const text = word("proof_CURVE_FEE", { start: formatBps(n("startBps"), locale), end: formatBps(n("endBps"), locale), time: word("min", { n: Math.round(n("seconds") / 60) }) });
      return "nowBps" in v ? `${text} · ${word("proof_CURVE_FEE_now", { now: formatBps(n("nowBps"), locale) })}` : text;
    }
    case "CURVE_SPLIT":
      return word("proof_CURVE_SPLIT", { creator: formatBps(n("creatorBps"), locale), ryntra: formatBps(n("ryntraBps"), locale), meteora: formatBps(n("meteoraBps"), locale) });
    case "GRADUATION_FEE":
      return word("proof_GRADUATION_FEE", { fee: formatBps(n("feeBps"), locale), creator: formatBps(n("creatorBps"), locale), ryntra: formatBps(n("ryntraBps"), locale) });
    case "POOL_FEE":
      return word("proof_POOL_FEE", { start: formatBps(n("startBps"), locale), end: formatBps(n("endBps"), locale) });
    case "ON_CURVE": {
      const text = word("proof_ON_CURVE", { pct: formatBps(n("bps"), locale) });
      return pair ? `${text} · ${word("proof_ON_CURVE_threshold", { amount: raw("thresholdRaw", pair.decimals), symbol: pair.symbol })}` : text;
    }
    case "MIGRATED":
      return "at" in v ? word("proof_MIGRATED_at", { date: formatDate(n("at") * 1000, locale) }) : word("proof_MIGRATED");
    default:
      return word(`proof_${claim.code}` as LaunchWordKey);
  }
}
