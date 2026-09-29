"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { WalletGate } from "@/app/solana/workspace/wallet-gate";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { PlanMemoryFact, PlanMemoryResponse, PlanNoTradeOutcome, PlanPositionRow, PlanResult, PlanResultsResponse, PlanResultsSummary } from "@/lib/api/v1/contract";

import { planWordsFor } from "../strategies/plans/plan-words";
import plans from "../strategies/plans/plans.module.css";
import { NoTradeRow, PositionRow, ResultRow } from "./result-row";
import { citationRef, memorySentence, resultWordsFor } from "./results-words";
import styles from "./results.module.css";

/**
 * Results — `RYN-RESULTS-MEMORY-001`, canon Part A §11 and §5.3.
 *
 * The page a plan returns to, in the order a person asks: how much is open
 * and how much is closed, what each position came to, which plans made no
 * trade and why, what each operation did against the plan it was made under,
 * and what the product remembers about how this wallet decides.
 *
 * Both reads are the proven wallet's own — the results feed and the memory
 * feed — and each is asked once. A feed that does not answer leaves its own
 * section saying so; it never blanks the page, because the other sections
 * are still true.
 */

const EMPTY_SUMMARY: PlanResultsSummary = { plans: 0, trades: 0, entries: 0, exits: 0, noTrade: 0, openPositions: 0, closedPositions: 0 };

type Feed = Readonly<{
  status: "idle" | "loading" | "ready" | "failed";
  results: readonly PlanResult[];
  outcomes: readonly PlanNoTradeOutcome[];
  positions: readonly PlanPositionRow[];
  summary: PlanResultsSummary;
  pending: number;
}>;

const EMPTY: Feed = { status: "idle", results: [], outcomes: [], positions: [], summary: EMPTY_SUMMARY, pending: 0 };

export function ResultsPanel({ locale }: { locale: WorkspaceLocale }) {
  const word = resultWordsFor(locale);
  const plan = planWordsFor(locale);
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const proven = proof.state.status === "proven" && proof.state.address === address;
  const [feed, setFeed] = useState<Feed>(EMPTY);
  const [memory, setMemory] = useState<readonly PlanMemoryFact[]>([]);

  const load = useCallback(async () => {
    setFeed((current) => ({ ...current, status: "loading" }));
    const headers = { accept: "application/json", "X-Ryntra-API": "1" } as const;
    try {
      const response = await fetch("/api/v1/plans/results", { headers });
      if (!response.ok) {
        setFeed({ ...EMPTY, status: "failed" });
        return;
      }
      const body = (await response.json()) as PlanResultsResponse;
      setFeed({
        status: "ready",
        results: body.results,
        outcomes: body.outcomes ?? [],
        positions: body.positions ?? [],
        summary: body.summary ?? EMPTY_SUMMARY,
        pending: body.sync.pending,
      });
    } catch {
      setFeed({ ...EMPTY, status: "failed" });
      return;
    }
    /* Memory is a second read on purpose: it reaches the monitoring surface too, and a memory that cannot be read never hides a result that can. */
    try {
      const response = await fetch("/api/v1/plans/memory", { headers });
      if (!response.ok) {
        setMemory([]);
        return;
      }
      const body = (await response.json()) as PlanMemoryResponse;
      setMemory(body.facts);
    } catch {
      setMemory([]);
    }
  }, []);

  useEffect(() => {
    if (proven) void load();
    else {
      setFeed(EMPTY);
      setMemory([]);
    }
  }, [proven, load]);

  if (!address) {
    return (
      <section className={plans.card}>
        <div className={plans.gate}>
          <WalletGate title={plan("connectToSee")} />
        </div>
      </section>
    );
  }

  if (!proven) {
    return (
      <section className={plans.card}>
        <div className={plans.gate}>
          <p className={plans.lead}>{plan("confirmToSee")}</p>
          <button type="button" className="rw-btn rw-btn--primary" onClick={() => void proof.prove()} disabled={proof.state.status === "signing"}>
            {proof.state.status === "signing" ? plan("confirming") : plan("confirmWallet")}
          </button>
          {proof.state.status === "refused" || proof.state.status === "failed" ? <p className={plans.error}>{proof.state.reason}</p> : null}
        </div>
      </section>
    );
  }

  if (feed.status === "loading" && feed.results.length === 0 && feed.outcomes.length === 0) {
    return (
      <section className={plans.card}>
        <div className={plans.cardBody}>
          <p className={plans.muted} aria-busy="true">
            {plan("loadingResults")}
          </p>
        </div>
      </section>
    );
  }

  if (feed.status === "failed") {
    return (
      <section className={plans.card}>
        <div className={plans.cardBody}>
          <p className={plans.error}>{plan("couldNotLoad")}</p>
          <div className={plans.actions}>
            <button type="button" className="rw-btn" onClick={() => void load()}>
              {plan("tryAgain")}
            </button>
          </div>
        </div>
      </section>
    );
  }

  const nothing = feed.results.length === 0 && feed.outcomes.length === 0 && feed.positions.length === 0;
  if (nothing) {
    return (
      <section className={plans.card}>
        <div className={plans.cardBody}>
          {feed.pending > 0 ? <p className={plans.muted}>{plan("syncing")}</p> : null}
          <p className={plans.muted}>{word("nothingYet")}</p>
          <div className={plans.actions}>
            <Link className="rw-btn rw-btn--primary" href="/app/strategies" prefetch={false}>
              {plan("myStrategies")}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const sentences = memory
    .map((fact) => ({ fact, text: memorySentence(fact, locale) }))
    .filter((entry): entry is { fact: PlanMemoryFact; text: string } => entry.text !== null)
    .slice(0, 12);

  return (
    <div className={styles.stack}>
      {feed.pending > 0 ? <p className={plans.muted}>{plan("syncing")}</p> : null}

      <section className={styles.section} aria-label={word("summary")}>
        <div className={styles.tiles}>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{feed.summary.openPositions}</span>
            <span className={styles.tileLabel}>{word("openPositions")}</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{feed.summary.closedPositions}</span>
            <span className={styles.tileLabel}>{word("closedPositions")}</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{feed.summary.noTrade}</span>
            <span className={styles.tileLabel}>{word("noTradePlans")}</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{feed.summary.trades}</span>
            <span className={styles.tileLabel}>{word("tradesMade")}</span>
          </div>
        </div>
      </section>

      {feed.positions.length > 0 ? (
        <section className={styles.section} aria-label={word("positionsTitle")}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{word("positionsTitle")}</h2>
          </div>
          <div className={styles.rows}>
            {feed.positions.map((row) => (
              <PositionRow key={row.planId} row={row} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}

      {feed.outcomes.length > 0 ? (
        <section className={styles.section} aria-label={word("outcomesTitle")}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{word("outcomesTitle")}</h2>
          </div>
          <div className={styles.rows}>
            {feed.outcomes.map((outcome) => (
              <NoTradeRow key={outcome.planId} outcome={outcome} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}

      {feed.results.length > 0 ? (
        <section className={styles.section} aria-label={word("resultsTitle")}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{word("resultsTitle")}</h2>
          </div>
          <div className={styles.rows}>
            {feed.results.map((result) => (
              <ResultRow key={result.actual.signature} result={result} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}

      {sentences.length > 0 ? (
        <section className={styles.section} aria-label={word("memoryTitle")}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{word("memoryTitle")}</h2>
          </div>
          <p className={styles.sectionNote}>{word("memoryLead")}</p>
          <ul className={styles.memory}>
            {sentences.map(({ fact, text }) => (
              <li key={fact.id} className={styles.memoryItem}>
                <p className={styles.memoryText}>{text}</p>
                <div className={styles.cites}>
                  {fact.cites.map((cite) =>
                    cite.href ? (
                      <Link key={`${cite.kind}:${cite.id}`} className={styles.cite} href={cite.href} prefetch={false}>
                        {citationRef(cite, locale)}
                      </Link>
                    ) : (
                      <span key={`${cite.kind}:${cite.id}`} className={styles.cite}>
                        {citationRef(cite, locale)}
                      </span>
                    ),
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
