"use client";

import { ArrowRight, CheckCircle, Clock, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { WalletGate } from "@/app/solana/workspace/wallet-gate";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { PlanListResponse, PlanResult, PlanResultsResponse, TradingPlan } from "@/lib/api/v1/contract";
import { isRetiredMint, RETIRED_WORDS } from "@/lib/stocks/retired";

import { PlanResultCard } from "./plan-result-card";
import { fmtUnits, fmtUsd, fmtWhen, planWordsFor, statusWord } from "./plan-words";
import styles from "./plans.module.css";

/**
 * The proven wallet's plans, in the order a person acts — the Owner's
 * direction of 2026-09-15: what needs a decision first, then what is
 * active, then what is drafted, then what recently happened; the catalogue
 * of types stays below all of it. The Premium Product UI Pass of the same
 * day set the shape: a card per plan that says what the plan is in one
 * glance — the asset, the state, the version, the planned entry, the
 * planned risk, the planned size, what happens next — with *Open plan* on
 * it. The clarity pass of 2026-09-16 (`RYN-UX-CLARITY-001` §5.1) made the
 * counts a compact line of the non-zero states only, drawn when there is
 * more than one state to count — two plans need no dashboard of zeros.
 *
 * A section with nothing in it is not drawn, and nothing here is a state
 * the product does not observe: an expired entry is the one thing v1 knows
 * needs a decision (no server monitoring yet — `RYN-MONITORING-PUSH-001`).
 *
 * A wallet that is not connected or not yet proven is told exactly that
 * and nothing else — a plan is private to the wallet that wrote it (canon
 * §0.6), so no card is drawn before the proof exists, and a wallet with no
 * plans is told where a plan starts: from a stock, in the builder's picker.
 */
const RECENT_RESULTS = 3;

/** The icons of the plans' assets, read once per mint from the stock desk's own route. */
type IconMap = Readonly<Record<string, string | null>>;

function PlanCard({ plan, locale, icon }: { plan: TradingPlan; locale: WorkspaceLocale; icon: string | null }) {
  const word = planWordsFor(locale);
  const rules = plan.current.rules;
  const validUntilMs = rules.entry.validUntil ? Date.parse(rules.entry.validUntil) : null;
  const entryExpired = validUntilMs !== null && Number.isFinite(validUntilMs) && validUntilMs < Date.now();
  const foot: Readonly<{ tone: "ok" | "caution" | "neutral"; text: string }> =
    plan.status === "draft"
      ? { tone: "neutral", text: word("stateDraft") }
      : plan.status === "cancelled"
        ? { tone: "neutral", text: word("stateCancelled") }
        : plan.status === "expired" || (plan.status === "active" && entryExpired)
          ? { tone: "caution", text: word("expiredHint") }
          : plan.executions.length > 0
            ? { tone: "ok", text: `${plan.executions.length} ${word("stateExecutedN")}` }
            : { tone: "neutral", text: rules.entry.validUntil ? `${word("stateWaiting")} ${word("validUntil")} ${fmtWhen(rules.entry.validUntil, locale)}.` : word("stateWaiting") };
  return (
    <li>
      <Link className={`${styles.card} ${styles.planCard}`} href={`/app/strategies/plans/${plan.id}`} prefetch={false} data-status={plan.status}>
        <span className={styles.planCardHead}>
          <MarketIcon mint={plan.asset.mint} icon={icon} symbol={plan.asset.symbol} size={40} className={styles.planCardIcon} />
          <span className={styles.planCardTitle}>
            <span className={styles.planCardSymbol}>
              <span translate="no">{plan.asset.symbol}</span>
              <span className={styles.status} data-status={plan.status}>
                {statusWord(plan.status, locale)}
              </span>
              <span className={styles.planCardVersion} translate="no">
                v{plan.version}
              </span>
            </span>
            <span className={styles.planCardSub}>
              {/* A plan on a token Ryntra no longer supports names no issuer — it says so in its place (canon v5.2 В26). */}
              {word("planKind")} · {plan.asset.underlying.name ?? plan.asset.underlying.symbol} · {isRetiredMint(plan.asset.mint) ? RETIRED_WORDS.state[locale === "uk" ? "uk" : "en"] : plan.asset.issuer.label}
            </span>
          </span>
          <span className={styles.planCardOpen}>
            {word("openPlan")}
            <ArrowRight size={14} weight="bold" aria-hidden="true" />
          </span>
        </span>
        <dl className={styles.planCardFigures}>
          <div className={styles.planFigure}>
            <dt>{word("entryPrice").replace(/,.*$/u, "")}</dt>
            <dd translate="no">{fmtUsd(rules.entry.pricePerShare, locale)}</dd>
          </div>
          <div className={styles.planFigure}>
            <dt>{word("risk")}</dt>
            <dd translate="no">{fmtUsd(rules.risk.plannedRiskUsd, locale)}</dd>
          </div>
          <div className={styles.planFigure}>
            <dt>{word("plannedSize")}</dt>
            <dd translate="no">
              <span>{fmtUsd(plan.current.sizing.notionalUsd, locale)}</span>
              <span className={styles.planFigureSub}>
                {fmtUnits(plan.current.sizing.units, locale)} {plan.asset.underlying.symbol}
              </span>
            </dd>
          </div>
          <div className={styles.planFigure}>
            <dt>{word("budget")}</dt>
            <dd translate="no">{fmtUsd(rules.capital.budgetUsd, locale, 0)}</dd>
          </div>
        </dl>
        <span className={styles.planCardFoot} data-tone={foot.tone}>
          {foot.tone === "ok" ? <CheckCircle size={16} weight="fill" aria-hidden="true" /> : foot.tone === "caution" ? <Warning size={16} weight="fill" aria-hidden="true" /> : <Clock size={16} weight="bold" aria-hidden="true" />}
          <span>{foot.text}</span>
        </span>
      </Link>
    </li>
  );
}

function SectionHead({ title, count, tone, children }: { title: string; count?: number; tone?: "attention"; children?: ReactNode }) {
  return (
    <div className={styles.sectionHead} data-tone={tone}>
      <h2>
        {title}
        {count !== undefined ? <span className={styles.sectionCount}>{count}</span> : null}
      </h2>
      <span className={styles.sectionSpacer} />
      {children}
    </div>
  );
}

export function PlansPanel({ locale }: { locale: WorkspaceLocale }) {
  const word = planWordsFor(locale);
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const proven = proof.state.status === "proven" && proof.state.address === address;
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "failed"; plans: readonly TradingPlan[]; total: number }>({ status: "idle", plans: [], total: 0 });
  const [results, setResults] = useState<{ status: "idle" | "ready"; results: readonly PlanResult[]; pending: number }>({ status: "idle", results: [], pending: 0 });
  const [icons, setIcons] = useState<IconMap>({});

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading" }));
    try {
      const response = await fetch("/api/v1/plans", { headers: { accept: "application/json", "X-Ryntra-API": "1" } });
      if (!response.ok) {
        setState({ status: "failed", plans: [], total: 0 });
        return;
      }
      const body = (await response.json()) as PlanListResponse;
      setState({ status: "ready", plans: body.plans, total: body.total });
      if (body.plans.some((plan) => plan.executions.length > 0)) {
        const read = await fetch("/api/v1/plans/results", { headers: { accept: "application/json", "X-Ryntra-API": "1" } });
        if (read.ok) {
          const all = (await read.json()) as PlanResultsResponse;
          setResults({ status: "ready", results: all.results, pending: all.sync.pending });
        }
      } else {
        setResults({ status: "ready", results: [], pending: 0 });
      }
    } catch {
      setState({ status: "failed", plans: [], total: 0 });
    }
  }, []);

  useEffect(() => {
    if (proven) void load();
    else {
      setState({ status: "idle", plans: [], total: 0 });
      setResults({ status: "idle", results: [], pending: 0 });
    }
  }, [proven, load]);

  /* The pictures: one read per distinct mint; a mint the desk does not answer for keeps its two letters. */
  const mints = Array.from(new Set(state.plans.map((plan) => plan.asset.mint))).join(",");
  useEffect(() => {
    if (!mints) return;
    let cancelled = false;
    void Promise.all(
      mints.split(",").map(async (mint) => {
        try {
          const response = await fetch(`/api/stocks/asset?ticker=${encodeURIComponent(mint)}`, { headers: { accept: "application/json" } });
          if (!response.ok) return [mint, null] as const;
          const body = (await response.json()) as { row?: { market?: { icon?: string | null } } };
          return [mint, body.row?.market?.icon ?? null] as const;
        } catch {
          return [mint, null] as const;
        }
      }),
    ).then((pairs) => {
      if (!cancelled) setIcons(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [mints]);

  if (!address) {
    return (
      <section className={styles.card}>
        <div className={styles.gate}>
          <WalletGate title={word("connectToSee")} />
        </div>
      </section>
    );
  }
  if (!proven) {
    return (
      <section className={styles.card}>
        <div className={styles.gate}>
          <p className={styles.lead}>{word("confirmToSee")}</p>
          <button type="button" className="rw-btn rw-btn--primary" onClick={() => void proof.prove()} disabled={proof.state.status === "signing"}>
            {proof.state.status === "signing" ? word("confirming") : word("confirmWallet")}
          </button>
          {proof.state.status === "refused" || proof.state.status === "failed" ? <p className={styles.error}>{proof.state.reason}</p> : null}
        </div>
      </section>
    );
  }
  if (state.status === "loading" && state.plans.length === 0) {
    return (
      <section className={styles.card}>
        <div className={styles.cardBody}>
          <p className={styles.muted} aria-busy="true">
            {word("loading")}
          </p>
        </div>
      </section>
    );
  }
  if (state.status === "failed") {
    return (
      <section className={styles.card}>
        <div className={styles.cardBody}>
          <p className={styles.error}>{word("couldNotLoad")}</p>
          <div className={styles.actions}>
            <button type="button" className="rw-btn" onClick={() => void load()}>
              {word("tryAgain")}
            </button>
          </div>
        </div>
      </section>
    );
  }

  const attention = state.plans.filter((plan) => plan.status === "expired");
  const active = state.plans.filter((plan) => plan.status === "active");
  const drafts = state.plans.filter((plan) => plan.status === "draft");
  const closed = state.plans.filter((plan) => plan.status === "executed" || plan.status === "cancelled");
  const recent = results.results.slice(0, RECENT_RESULTS);

  if (state.plans.length === 0) {
    return (
      <section className={styles.card} aria-label={word("myStrategies")}>
        <div className={styles.emptyPlans}>
          <b>{word("noPlansTitle")}</b>
          <p className={styles.lead}>{word("startFromStock")}</p>
          <Link className="rw-btn rw-btn--primary" href="/app/strategies/new" prefetch={false}>
            {word("createPlan")}
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </Link>
        </div>
      </section>
    );
  }

  /* The counts, only the states that exist, and only when there is more than one of them to tell apart. */
  const counts: readonly Readonly<{ key: string; label: string; value: number; tone?: "attention" | "active"; href?: string }>[] = [
    { key: "attention", label: word("attention"), value: attention.length, tone: "attention" as const },
    { key: "active", label: word("activePlans"), value: active.length, tone: "active" as const },
    { key: "drafts", label: word("drafts"), value: drafts.length },
    { key: "closed", label: word("closed"), value: closed.length },
    { key: "results", label: word("recentResults"), value: results.results.length, href: "/app/results" },
  ].filter((count) => count.value > 0);

  return (
    <>
      {counts.length > 1 ? (
        <div className={styles.counts} role="group" aria-label={word("myStrategies")}>
          {counts.map((count) =>
            count.href ? (
              <Link key={count.key} className={styles.count} href={count.href} prefetch={false} data-tone={count.tone}>
                <span className={styles.countValue} translate="no">
                  {count.value}
                </span>
                <span>{count.label}</span>
              </Link>
            ) : (
              <span key={count.key} className={styles.count} data-tone={count.tone}>
                <span className={styles.countValue} translate="no">
                  {count.value}
                </span>
                <span>{count.label}</span>
              </span>
            ),
          )}
        </div>
      ) : null}

      {attention.length > 0 ? (
        <section aria-label={word("attention")}>
          <SectionHead title={word("attention")} count={attention.length} tone="attention" />
          <ul className={styles.planGrid}>
            {attention.map((plan) => (
              <PlanCard key={plan.id} plan={plan} locale={locale} icon={icons[plan.asset.mint] ?? null} />
            ))}
          </ul>
        </section>
      ) : null}

      {active.length > 0 ? (
        <section aria-label={word("activePlans")}>
          <SectionHead title={word("activePlans")} count={active.length} />
          <ul className={styles.planGrid}>
            {active.map((plan) => (
              <PlanCard key={plan.id} plan={plan} locale={locale} icon={icons[plan.asset.mint] ?? null} />
            ))}
          </ul>
        </section>
      ) : null}

      {drafts.length > 0 ? (
        <section aria-label={word("drafts")}>
          <SectionHead title={word("drafts")} count={drafts.length} />
          <ul className={styles.planGrid}>
            {drafts.map((plan) => (
              <PlanCard key={plan.id} plan={plan} locale={locale} icon={icons[plan.asset.mint] ?? null} />
            ))}
          </ul>
        </section>
      ) : null}

      {recent.length > 0 || results.pending > 0 ? (
        <section aria-label={word("recentResults")}>
          <SectionHead title={word("recentResults")} count={results.results.length}>
            {results.results.length > RECENT_RESULTS ? (
              <Link className="rw-btn" href="/app/results" prefetch={false}>
                {word("allResults")}
              </Link>
            ) : null}
          </SectionHead>
          {results.pending > 0 ? <p className={styles.muted}>{word("syncing")}</p> : null}
          <div className={styles.results}>
            {recent.map((result) => (
              <PlanResultCard key={result.actual.signature} result={result} locale={locale} compact />
            ))}
          </div>
        </section>
      ) : null}

      {closed.length > 0 ? (
        <details className={`${styles.card} ${styles.closed}`}>
          <summary>
            {word("closed")} · {closed.length}
          </summary>
          <ul className={styles.planGrid}>
            {closed.map((plan) => (
              <PlanCard key={plan.id} plan={plan} locale={locale} icon={icons[plan.asset.mint] ?? null} />
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
