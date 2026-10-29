"use client";

import { ArrowSquareOut, ArrowUpRight, CheckCircle, Circle, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Help, HelpLabel } from "@/app/shell/help";
import type { HelpTopicId } from "@/app/shell/help-topics";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { formatPercent, formatUsdCompact } from "@/app/solana/workspace/spot/spot-format";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import { fmtByUnit, fmtClock, operatorWord, windowWord } from "@/app/solana/workspace/evidence/evidence-words";
import { isTokenPlanAsset, planAssetKind, planUnitBasis, type MarketEvidenceReadDto, type PlanResult, type PlanResultsResponse, type PlanSync, type PlanVersion, type TradingPlan } from "@/lib/api/v1/contract";
import { judgeEvidenceCondition } from "@/lib/evidence/conditions";
import { evidenceMetric } from "@/lib/evidence/metrics";
import { isRetiredMint, RETIRED_WORDS } from "@/lib/stocks/retired";

import { AskRynLens } from "@/app/app/lens/ask-ryn-lens";
import { LensPanel } from "@/app/app/lens/lens-panel";

import { PlanResultCard } from "./plan-result-card";
import { fmtDate, fmtUnits, fmtUsd, fmtWhen, planWordsFor, statusWord, type PlanWord } from "./plan-words";
import styles from "./plans.module.css";
import { ensureWalletActs } from "@/lib/account/wallet-proof-store.client";

/**
 * One plan, as it stands, recomposed around decisions by the premium UI pass
 * (2026-09-15) and made to say each thing once by the clarity pass of
 * 2026-09-16.
 *
 * The person is answered in three seconds: the head says which plan and
 * what state it is in; one summary says the money the way a person reads it
 * — the purchase the plan makes, the risk limit and the loss the model
 * expects (two different figures), the highest price, the level where the
 * thesis is wrong — with the one material note that no automatic sell
 * exists; the status panel says what is true now and carries the one
 * action. Every rule stays, folded under *All plan rules*; every version
 * and every event stays, folded under *Plan history* behind the latest
 * event. Nothing here changes the plan's semantics, the Review or the
 * execution — only what a person sees first.
 *
 * *Market now* is the one block that reads the market: the token's per-share
 * price, the issuer's reference and the pool, from the same asset read the
 * stock page uses, compared to the **current** version's bounds as plain
 * facts — the Review judges that version, whichever one is being read. The
 * read carries the source's own observation time, is marked stale when old,
 * and is refreshed while the tab is visible, once a minute at most. The
 * Review decides at signing and the panel says so; nothing here is a verdict.
 *
 * An earlier version opens as a view only: the summary and the rules show
 * it as it stood, the banner says so, and the action offers the way back to
 * the current version — a trade is never offered from an old one.
 *
 * A plan on a token (1.7.0) reads *Market now* from the Spot catalogue
 * instead of the stock desk — the token's own price and the pool — and shows
 * no reference line, because a token has none; its Trade opens the Spot
 * market of its kind. Every version shows the planning price it was written
 * against, with its source and time.
 *
 * A plan on a pre-IPO token — a stock plan priced per token, the PreStocks
 * instruments — opens differently since the first-screen pass of 2026-09-23:
 * under the head, one line of state with the one action, then the three
 * things to know before anything else (not a share · limited liquidity · no
 * automatic stop), and the whole plan — the figures, the rules, the history,
 * the status — one press deep under *Details*. Presentation only: the same
 * plan, the same Review.
 */

const EVENT_WORD: Readonly<Record<TradingPlan["journal"][number]["event"], PlanWord>> = {
  created: "eventCreated",
  edited: "eventEdited",
  activated: "eventActivated",
  cancelled: "eventCancelled",
  reviewed: "eventReviewed",
  executed: "eventExecuted",
  expired: "eventExpired",
};

/** The slice of the stock desk's asset read the panel uses; the shape is the route's own. */
type AssetNow = Readonly<{
  row: Readonly<{
    tokenPerShareUsd: number | null;
    market: Readonly<{ priceUsd: number | null; liquidityUsd: number | null; icon: string | null; observedAt: string | null }>;
    reference: Readonly<{ state: string; perShare: number | null; fetchedAt: string | null }>;
    deviationPct: number | null;
    session: Readonly<{ period: string }>;
    /* A pre-IPO row's context: the issuer's mark, the premium, the mint's fee, the company's index. Absent on a listed row. */
    issuerMark?: Readonly<{ perUnit: number | null; stale: boolean; source: Readonly<{ label: string }> }> | null;
    markPremiumPct?: number | null;
    transferFee?: Readonly<{ basisPoints: number }> | null;
    companyIndex?: Readonly<{ symbol: string; valueUsd: number | null; state: string }> | null;
  }>;
  fetchedAt: string;
}>;

/** A market read older than this is said to be stale beside its clock. */
const STALE_AFTER_MS = 10 * 60_000;
/** The panel re-reads the market this often while the tab is visible — the route is cached, the figure is an orientation. */
const REFRESH_MS = 60_000;

type Tone = "ok" | "caution" | "neutral";

function ConditionIcon({ tone }: { tone: Tone }) {
  if (tone === "ok") return <CheckCircle size={18} weight="fill" aria-hidden="true" />;
  if (tone === "caution") return <Warning size={18} weight="fill" aria-hidden="true" />;
  return <Circle size={18} weight="bold" aria-hidden="true" />;
}

export function PlanDetail({ planId, locale, fromMonitoring = false }: { planId: string; locale: WorkspaceLocale; fromMonitoring?: boolean }) {
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const proven = proof.state.status === "proven" && proof.state.address === address;
  const [state, setState] = useState<{ status: "loading" | "ready" | "notFound" | "failed"; plan: TradingPlan | null }>({ status: "loading", plan: null });
  /* The words in the unit this plan was written in (1.4.0): a plan from before the field is a share plan. */
  const word = planWordsFor(locale, state.plan?.asset.unitBasis ?? "share");
  const [sync, setSync] = useState<PlanSync | null>(null);
  const [results, setResults] = useState<readonly PlanResult[]>([]);
  const [shown, setShown] = useState<PlanVersion | null>(null);
  const [asset, setAsset] = useState<{ status: "idle" | "ready" | "unavailable"; now: AssetNow | null; readAt: number | null }>({ status: "idle", now: null, readAt: null });
  const [cancelling, setCancelling] = useState<{ open: boolean; reason: string; busy: boolean; error: string | null }>({ open: false, reason: "", busy: false, error: null });
  const [activating, setActivating] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/plans/${encodeURIComponent(planId)}`, { headers: { accept: "application/json", "X-Ryntra-API": "1" } });
      if (response.status === 404) {
        setState({ status: "notFound", plan: null });
        return;
      }
      if (!response.ok) {
        setState({ status: "failed", plan: null });
        return;
      }
      const body = (await response.json()) as { plan: TradingPlan; sync?: PlanSync };
      setState({ status: "ready", plan: body.plan });
      setSync(body.sync ?? null);
      setShown(null);
      /* Plan vs Actual, only once there is an execution to put beside the plan. */
      if (body.plan.executions.length > 0) {
        const read = await fetch(`/api/v1/plans/${encodeURIComponent(planId)}/results`, { headers: { accept: "application/json", "X-Ryntra-API": "1" } });
        if (read.ok) {
          const all = (await read.json()) as PlanResultsResponse;
          setResults(all.results);
          setSync(all.sync);
        }
      } else {
        setResults([]);
      }
    } catch {
      setState({ status: "failed", plan: null });
    }
  }, [planId]);

  useEffect(() => {
    if (proven) void load();
    else setState({ status: "loading", plan: null });
  }, [proven, load]);

  /* The observations the current version's conditions name: one read per window in use, through the card's own route, once per page — the figures are cached on the server for their window and the Review reads them again at signing. A version without conditions reads nothing. */
  const conditionWindows = [...new Set((state.plan?.current.rules.evidenceConditions ?? []).map((condition) => condition.window))].sort().join(",");
  const [evidence, setEvidence] = useState<Readonly<Record<string, MarketEvidenceReadDto | "loading">>>({});
  useEffect(() => {
    const target = state.plan?.asset.mint ?? null;
    if (!target || conditionWindows === "") return;
    let cancelled = false;
    for (const window of conditionWindows.split(",")) {
      setEvidence((current) => (current[window] ? current : { ...current, [window]: "loading" }));
      fetch(`/api/v1/research/evidence?mint=${encodeURIComponent(target)}&window=${window}`, { headers: { accept: "application/json", "X-Ryntra-API": "1" } })
        .then(async (response) => (response.ok ? ((await response.json()) as MarketEvidenceReadDto) : null))
        .catch(() => null)
        .then((read) => {
          if (!cancelled) setEvidence((current) => ({ ...current, [window]: read ?? { state: "UNAVAILABLE", snapshot: null, reason: null, served: "none" } }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [state.plan?.asset.mint, conditionWindows]);

  /* The market, once the plan names its mint: the desk's own route, read again
     when the tab comes back and once a minute while it is visible. */
  const mint = state.plan?.asset.mint ?? null;
  const tokenPlan = state.plan ? isTokenPlanAsset(state.plan.asset) : false;
  useEffect(() => {
    /* A plan on a token Ryntra no longer supports is history: its market is not read. */
    if (!mint || isRetiredMint(mint)) return;
    let cancelled = false;
    const read = async () => {
      try {
        if (tokenPlan) {
          /* A token plan reads the catalogue: the token's own price and its pool, with the read's time; no reference exists for it. */
          const response = await fetch(`/api/spot/market?mint=${encodeURIComponent(mint)}`, { headers: { accept: "application/json" } });
          if (!response.ok) throw new Error(String(response.status));
          const body = (await response.json()) as { market: Readonly<{ price: number | null; liquidityUsd: number | null; icon: string | null; updatedAt: string | null }> | null; observedAt: string };
          if (!body.market) throw new Error("NO_MARKET");
          const now: AssetNow = {
            row: {
              tokenPerShareUsd: null,
              market: { priceUsd: body.market.price, liquidityUsd: body.market.liquidityUsd, icon: body.market.icon, observedAt: body.market.updatedAt ?? body.observedAt },
              reference: { state: "unavailable", perShare: null, fetchedAt: null },
              deviationPct: null,
              session: { period: "always-open" },
            },
            fetchedAt: body.observedAt,
          };
          if (!cancelled) setAsset({ status: "ready", now, readAt: Date.now() });
          return;
        }
        const response = await fetch(`/api/stocks/asset?ticker=${encodeURIComponent(mint)}`, { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as AssetNow;
        if (!cancelled) setAsset({ status: "ready", now: body, readAt: Date.now() });
      } catch {
        if (!cancelled) setAsset((current) => (current.now ? { ...current, status: "ready" } : { status: "unavailable", now: null, readAt: null }));
      }
    };
    void read();
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, REFRESH_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [mint, tokenPlan]);

  const openVersion = async (n: number) => {
    const plan = state.plan;
    if (!plan) return;
    if (n === plan.version) {
      setShown(null);
      return;
    }
    const response = await fetch(`/api/v1/plans/${encodeURIComponent(planId)}/versions/${n}`, { headers: { accept: "application/json", "X-Ryntra-API": "1" } });
    if (!response.ok) return;
    const body = (await response.json()) as { version: PlanVersion };
    setShown(body.version);
  };

  const setStatus = async (status: "active" | "cancelled", reason: string | null) => {
    const plan = state.plan;
    if (!plan) return false;
    if (!(await ensureWalletActs())) return false;
    const response = await fetch(`/api/v1/plans/${encodeURIComponent(planId)}/status`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "X-Ryntra-API": "1" },
      body: JSON.stringify({ status, ifVersion: plan.version, reason }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
      return body.error?.code === "PLAN_VERSION_CONFLICT" ? word("conflict") : word("saveFailed");
    }
    await load();
    return true;
  };

  if (!address || !proven) {
    return (
      <section className={styles.page}>
        <Crumbs word={word} />
        <section className={styles.card}>
          <div className={styles.gate}>
            <p className={styles.lead}>{address ? word("confirmToSee") : word("connectToSee")}</p>
            {address ? (
              <button type="button" className="rw-btn rw-btn--primary" onClick={() => void proof.prove()} disabled={proof.state.status === "signing"}>
                {proof.state.status === "signing" ? word("confirming") : word("confirmWallet")}
              </button>
            ) : null}
          </div>
        </section>
      </section>
    );
  }
  if (state.status !== "ready" || !state.plan) {
    return (
      <section className={styles.page}>
        <Crumbs word={word} />
        <section className={styles.card}>
          <div className={styles.cardBody}>
            {state.status === "loading" ? (
              <p className={styles.muted} aria-busy="true">
                {word("loading")}
              </p>
            ) : (
              <>
                <p className={state.status === "notFound" ? styles.muted : styles.error}>{state.status === "notFound" ? word("notFound") : word("couldNotLoad")}</p>
                {state.status === "failed" ? (
                  <div className={styles.actions}>
                    <button type="button" className="rw-btn" onClick={() => void load()}>
                      {word("tryAgain")}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>
      </section>
    );
  }

  const plan = state.plan;
  const version = shown ?? plan.current;
  const rules = version.rules;
  const sizing = version.sizing;
  /* The bounds the Review judges are the current version's, whichever version is being read. */
  const current = plan.current.rules;
  const underlying = plan.asset.underlying.symbol;
  const editable = plan.status === "draft" || plan.status === "active" || plan.status === "expired";
  /* The Spot market of the asset's kind (1.7.0): a stock under its view, a crypto or meme under theirs. */
  const tradeHref = `/app/spot?view=${planAssetKind(plan.asset)}&mint=${encodeURIComponent(plan.asset.mint)}&plan=${encodeURIComponent(plan.id)}&v=${plan.version}`;
  const editHref = `/app/strategies/new?plan=${encodeURIComponent(plan.id)}`;
  const now = asset.now?.row ?? null;
  const icon = now?.market.icon ?? null;
  const s = locale === "uk" ? "с" : "s";
  const modelledLoss = sizing.units * sizing.lossPerShareUsd;
  /* A stock plan priced per token is a pre-IPO instrument (contract 1.4.0): its page leads with what it is not. */
  const preIpo = !tokenPlan && planUnitBasis(plan.asset) === "token";
  /* A plan on a token Ryntra no longer supports reads as history: the asset says so and where it can be sold, and nothing is offered to trade or edit. */
  const retired = isRetiredMint(plan.asset.mint);
  const retiredLine = `${RETIRED_WORDS.state[locale === "uk" ? "uk" : "en"]} · ${RETIRED_WORDS.exit[locale === "uk" ? "uk" : "en"]}`;

  /* ── The state line and the conditions, as plain facts ─────────────── */
  const validUntilMs = current.entry.validUntil ? Date.parse(current.entry.validUntil) : null;
  const entryExpired = validUntilMs !== null && Number.isFinite(validUntilMs) && validUntilMs < Date.now();
  const shownExpired = rules.entry.validUntil !== null && Date.parse(rules.entry.validUntil) < Date.now();
  const stateLine = retired
    ? retiredLine
    : plan.status === "draft"
      ? word("stateDraft")
      : plan.status === "cancelled"
        ? word("stateCancelled")
        : plan.status === "expired" || (plan.status === "active" && entryExpired)
          ? word("expiredHint")
          : plan.executions.length > 0
            ? `${plan.executions.length} ${word("stateExecutedN")}`
            : word("stateWaiting");

  /* The price in the plan's own unit: a share plan reads the per-share figure, a token plan (the pre-IPO issuers) the token's price — the row states no share figure for it. */
  const unitPrice = state.plan?.asset.unitBasis === "token" ? (now?.market.priceUsd ?? null) : (now?.tokenPerShareUsd ?? null);
  const conditions: readonly Readonly<{ key: string; tone: Tone; text: ReactNode; topic?: HelpTopicId }>[] = [
    {
      key: "valid",
      tone: current.entry.validUntil === null ? "neutral" : entryExpired ? "caution" : "ok",
      text: current.entry.validUntil === null ? word("noValidUntil") : `${entryExpired ? word("entryExpiredOn") : word("validUntil")} ${fmtWhen(current.entry.validUntil, locale)}`,
      topic: "validUntil",
    },
    ...(retired
      ? [{ key: "market", tone: "neutral" as Tone, text: retiredLine }]
      : asset.status === "idle"
      ? [{ key: "market", tone: "neutral" as Tone, text: word("marketReading") }]
      : asset.status === "unavailable" || (asset.status === "ready" && unitPrice == null)
        ? [{ key: "market", tone: "neutral" as Tone, text: word("marketUnavailable") }]
        : now && unitPrice != null
        ? [
            {
              key: "price",
              tone: (current.entry.maxPricePerShare === null ? "neutral" : unitPrice <= current.entry.maxPricePerShare ? "ok" : "caution") as Tone,
              text: (
                <>
                  {word("tokenPricePerShare")} <b translate="no">{fmtUsd(unitPrice, locale)}</b> {word("perShare")}
                  {current.entry.maxPricePerShare === null ? ` · ${word("noBound")}` : ` · ${unitPrice <= current.entry.maxPricePerShare ? word("withinBound") : word("aboveBound")} ${fmtUsd(current.entry.maxPricePerShare, locale)}`}
                </>
              ),
              topic: "maxPrice" as HelpTopicId,
            },
            /* A pre-IPO row's context beside the quote, each named for what it is: the issuer's mark and the premium, the mint's fee, the company's index. */
            ...(now.issuerMark?.perUnit != null
              ? [
                  {
                    key: "mark",
                    tone: "neutral" as Tone,
                    text: (
                      <>
                        {word("issuerMark")} <b translate="no">{fmtUsd(now.issuerMark.perUnit, locale)}</b>
                        {now.markPremiumPct != null ? <> · <span translate="no">{formatPercent(now.markPremiumPct, numberLocale)}</span> {word("vsMark")}</> : null}
                        {` · ${now.issuerMark.source.label} · ${word("markNotReference")}`}
                      </>
                    ),
                  },
                ]
              : []),
            ...(now.transferFee
              ? [
                  {
                    key: "fee",
                    tone: "neutral" as Tone,
                    text: (
                      <>
                        {word("transferFee")} <b translate="no">{`${(now.transferFee.basisPoints / 100).toFixed(2)}%`}</b> · {word("insideRoute")}
                      </>
                    ),
                  },
                ]
              : []),
            ...(now.companyIndex
              ? [
                  {
                    key: "index",
                    tone: "neutral" as Tone,
                    text:
                      now.companyIndex.valueUsd === null ? (
                        `${word("companyIndexUnavailable")} · ${now.companyIndex.symbol}`
                      ) : (
                        <>
                          {word("companyIndex")} <b translate="no">{fmtUsd(now.companyIndex.valueUsd, locale)}</b> · {now.companyIndex.symbol} · {word("companyIndexIndicative")}
                        </>
                      ),
                  },
                ]
              : []),
            ...(tokenPlan ? [] : [{
              key: "reference",
              tone: (now.reference.perShare === null
                ? current.execution.referenceRequired
                  ? "caution"
                  : "neutral"
                : current.execution.maxReferenceDeviationPct === null || now.deviationPct === null
                  ? "neutral"
                  : Math.abs(now.deviationPct) <= current.execution.maxReferenceDeviationPct
                    ? "ok"
                    : "caution") as Tone,
              text:
                now.reference.perShare === null ? (
                  `${word("referenceUnavailable")}${current.execution.referenceRequired ? ` · ${word("required")}` : ""}`
                ) : (
                  <>
                    {word("reference")} <b translate="no">{fmtUsd(now.reference.perShare, locale)}</b>
                    {now.deviationPct !== null ? <> · <span translate="no">{formatPercent(now.deviationPct, numberLocale)}</span></> : null}
                    {current.execution.maxReferenceDeviationPct !== null ? ` · ${word("bound")} ±${current.execution.maxReferenceDeviationPct.toFixed(2)}%` : ""}
                  </>
                ),
              topic: "maxDeviation" as HelpTopicId,
            }]),
            {
              key: "pool",
              tone: (now.market.liquidityUsd === null
                ? "neutral"
                : current.execution.minLiquidityUsd === null
                  ? "neutral"
                  : now.market.liquidityUsd >= current.execution.minLiquidityUsd
                    ? "ok"
                    : "caution") as Tone,
              text: (
                <>
                  {word("pool")} <b translate="no">{now.market.liquidityUsd === null ? "—" : formatUsdCompact(now.market.liquidityUsd, numberLocale)}</b>
                  {current.execution.minLiquidityUsd !== null ? ` · ${word("min")} ${formatUsdCompact(current.execution.minLiquidityUsd, numberLocale)}` : ""}
                </>
              ),
              topic: "liquidity" as HelpTopicId,
            },
          ]
        : []),
    /* The current version's conditions on what the market did, judged on the read as it stands — the same judge the Review runs, on the same route's answer. */
    ...current.evidenceConditions.map((condition, index) => {
      const read = evidence[condition.window];
      const metric = evidenceMetric(condition.metric);
      const judged = read && read !== "loading" ? judgeEvidenceCondition(condition, read, Date.now()) : null;
      const figure = read && read !== "loading" && read.snapshot ? (read.snapshot.metrics.find((entry) => entry.id === condition.metric) ?? null) : null;
      const tone: Tone = !judged ? "neutral" : judged.outcome === "pass" ? "ok" : judged.outcome === "fail" ? (condition.mode === "required" ? "caution" : "neutral") : condition.mode === "required" ? "caution" : "neutral";
      const unit = metric?.unit ?? "usd";
      const flag = unit === "flag";
      const figureText = figure && figure.value !== null ? fmtByUnit(figure.value, unit, locale) : null;
      const thresholdText = fmtByUnit(condition.threshold, unit, locale);
      return {
        key: `evidence-${index}`,
        tone,
        text: (
          <>
            {metric?.words[locale].label ?? condition.metric}
            {condition.window === "now" ? "" : ` · ${windowWord(condition.window, locale)}`} · {flag ? "" : operatorWord(condition.operator, locale)} <b translate="no">{thresholdText}</b>
            {!read || read === "loading" ? ` · ${word("evidenceReading")}` : figureText && read.snapshot ? (
              <>
                {" · "}
                {word("evidenceNow")} <b translate="no">{figureText}</b>
                {judged ? ` · ${judged.outcome === "pass" ? word("evidenceMet") : judged.outcome === "fail" ? word("evidenceNotMet") : word("evidenceUnknownNow")}` : ""}
                {condition.mode === "required" ? ` · ${word("evidenceRequireShort")}` : ""}
              </>
            ) : (
              ` · ${word("evidenceNowUnknown")}${condition.mode === "required" ? ` · ${word("evidenceRequireShort")}` : ""}`
            )}
          </>
        ),
        topic: "evidenceCondition" as HelpTopicId,
      };
    }),
    {
      key: "executions",
      tone: plan.executions.length > 0 ? "ok" : "neutral",
      text: plan.executions.length > 0 ? `${plan.executions.length} ${word("stateExecutedN")}` : word("waitingNode"),
    },
  ];
  /* The evidence reads' attributions and clock, once under the list — each source's terms want its line beside its figures, and the figures are in the nodes above; two sources, two lines. */
  const evidenceReads = Object.values(evidence).filter((read): read is MarketEvidenceReadDto => read !== "loading" && read !== undefined && read.snapshot !== null);
  const evidenceAttribution =
    evidenceReads.length > 0
      ? {
          at: fmtClock(evidenceReads.map((read) => read.snapshot!.fetchedAt).sort()[0], locale),
          sources: [...new Map(evidenceReads.map((read) => [read.snapshot!.provider, { text: read.snapshot!.attribution.text, href: read.snapshot!.attribution.href }])).values()],
        }
      : null;
  /* The sources the version's rules name, for the rule card's foot — each attribution once, in the order the rules use them. */
  const ruleSources = [...new Set(rules.evidenceConditions.map((condition) => evidenceMetric(condition.metric)?.provider ?? "nansen"))].map((provider) => (provider === "ddxyz" ? word("evidenceSourceDdxyz") : word("evidenceSource"))).join(" · ");
  /* The clock is the source's own observation where it states one, else the read's; old is said to be old. */
  const observedIso = now?.market.observedAt ?? asset.now?.fetchedAt ?? null;
  const observedMs = observedIso ? Date.parse(observedIso) : Number.NaN;
  const observedClock = Number.isFinite(observedMs) ? new Date(observedMs).toLocaleTimeString(numberLocale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) : null;
  const stale = Number.isFinite(observedMs) && Date.now() - observedMs > STALE_AFTER_MS;

  const primary = shown ? (
    <button type="button" className="rw-btn rw-btn--primary" onClick={() => setShown(null)}>
      {word("backToCurrent")} · v{plan.version}
    </button>
  ) : plan.status === "draft" && !retired ? (
    <button
      type="button"
      className="rw-btn rw-btn--primary"
      disabled={activating.busy}
      onClick={() => {
        setActivating({ busy: true, error: null });
        void setStatus("active", null).then((result) => setActivating({ busy: false, error: result === true ? null : String(result) }));
      }}
    >
      {activating.busy ? word("saving") : word("activate")}
    </button>
  ) : plan.status === "active" && !entryExpired && !retired ? (
    <Link className="rw-btn rw-btn--primary" href={tradeHref} prefetch={false}>
      {word("tradeUnderPlan")}
      <ArrowUpRight size={16} weight="bold" aria-hidden="true" />
    </Link>
  ) : null;

  const thesisHasMore = rules.thesis.whyNow !== null || rules.thesis.assumptions.length > 0 || rules.thesis.sources.length > 0;
  const latest = plan.journal.length > 0 ? plan.journal[plan.journal.length - 1] : null;

  return (
    <section className={styles.page} aria-labelledby="plan-title">
      <Crumbs word={word} symbol={plan.asset.symbol} />

      {/* ── The head: which plan, what state ─────────────────────────── */}
      <header className={styles.hero}>
        <div className={styles.heroIdentity}>
          <MarketIcon mint={plan.asset.mint} icon={icon} symbol={plan.asset.symbol} size={48} className={styles.heroIcon} />
          <div className={styles.heroText}>
            <div className={styles.heroTitleRow}>
              <h1 id="plan-title" translate="no">
                {plan.asset.symbol}
              </h1>
              <span className={styles.heroKind}>
                {word("planKind")} · v{version.version}
              </span>
              <span className={styles.status} data-status={plan.status} data-size="lg">
                {statusWord(plan.status, locale)}
              </span>
            </div>
            <p className={styles.heroSub}>
              {plan.asset.underlying.name ?? underlying} · {retired ? RETIRED_WORDS.state[locale === "uk" ? "uk" : "en"] : tokenPlan ? `${planAssetKind(plan.asset) === "meme" ? word("kindMeme") : word("kindCrypto")} · ${word("verifiedOnJupiter")}` : plan.asset.issuer.label} · {word("created")} {fmtDate(plan.createdAt, locale)}
            </p>
            <p className={styles.heroThesis}>{rules.thesis.text}</p>
          </div>
        </div>
        <div className={styles.heroActions}>
          <AskRynLens subject={{ kind: "plan", planId: plan.id }} locale={locale} />
          {editable && !shown && !retired ? (
            <Link className="rw-btn" href={editHref} prefetch={false}>
              {word("edit")}
            </Link>
          ) : null}
        </div>
      </header>
      {fromMonitoring ? (
        <p className={styles.lead}>
          {locale === "uk"
            ? "У цьому плані щось змінилось. Переглянь його на сьогоднішніх цифрах — нотатка не є дозволом торгувати."
            : "Something in this plan changed. Review it on today's figures — a note is not permission to trade."}
        </p>
      ) : null}
      {activating.error ? <p className={styles.error}>{activating.error}</p> : null}

      {/* A pre-IPO plan: the state in one line with its one action, then what the token is not. */}
      {preIpo ? (
        <>
          <div className={`${styles.card} ${styles.preIpoState}`} role="status">
            <p className={styles.stateLine}>{stateLine}</p>
            {primary ? <div className={styles.preIpoAction}>{primary}</div> : null}
          </div>
          <p className={styles.preIpoBanner}>
            <Warning size={16} weight="fill" aria-hidden="true" />
            <span>{word("preIpoBanner")}</span>
          </p>
        </>
      ) : null}

      {/* The Brief on this plan, and the Critic on request — the Review is the door out of both; closed until *Ask Ryn* is pressed. */}
      <LensPanel subject={{ kind: "plan", planId: plan.id }} locale={locale} trigger="page" />

      {shown ? (
        <div className={styles.versionBanner} role="status">
          <span>
            {word("historicalView")} · <b>v{shown.version}</b> · {fmtWhen(shown.createdAt, locale)}
          </span>
          <button type="button" className="rw-btn" onClick={() => setShown(null)}>
            {word("backToCurrent")} · v{plan.version}
          </button>
        </div>
      ) : null}

      <DetailsFold fold={preIpo} label={word("details")}>
      {/* ── The summary: the money the way a person reads it ─────────── */}
      <div className={`${styles.card} ${styles.summaryCard}`} role="group" aria-label={word("rules")}>
        <div className={styles.keys}>
          <Key label={word("buyUnderPlan")} topic="size" locale={locale} value={`≈ ${fmtUsd(sizing.notionalUsd, locale)}`} sub={`${fmtUnits(sizing.units, locale)} ${underlying} · ${word("atPlanningPrice")} ${fmtUsd(rules.entry.pricePerShare, locale)}`} />
          <Key label={word("riskLimit")} topic="plannedRisk" locale={locale} value={fmtUsd(rules.risk.plannedRiskUsd, locale)} sub={`${word("modelledLossShort")} ≈ ${fmtUsd(modelledLoss, locale)}`} />
          <Key label={word("highestPrice")} topic="maxPrice" locale={locale} value={rules.entry.maxPricePerShare === null ? "—" : fmtUsd(rules.entry.maxPricePerShare, locale)} sub={rules.entry.maxPricePerShare === null ? word("noBound") : word("perShare")} />
          <Key label={word("invalidationLabel")} topic="invalidation" locale={locale} value={fmtUsd(rules.risk.invalidationPerShare, locale)} sub={`${word("perShare")} · ${word("invalidationIsRule")}`} />
        </div>
        <p className={styles.summaryNote}>
          <Warning size={14} weight="fill" aria-hidden="true" />
          {word("noAutoSell")}
        </p>
      </div>

      <div className={styles.layout}>
        <div className={styles.main}>
          {/* ── The thesis, only where it says more than the head ────── */}
          {thesisHasMore ? (
            <section className={styles.card} aria-label={word("thesis")}>
              <div className={styles.cardHead}>
                <h2>{word("thesis")}</h2>
                <span className={styles.cardHeadSpacer} />
                {shown ? <span className={styles.muted}>v{shown.version}</span> : null}
              </div>
              <div className={styles.cardBody}>
                {rules.thesis.whyNow ? (
                  <dl className={styles.factGrid}>
                    <div>
                      <dt>{word("whyNow").replace(/\s*\((?:optional|необов'язково)\)$/u, "")}</dt>
                      <dd data-prose="true">{rules.thesis.whyNow}</dd>
                    </div>
                  </dl>
                ) : null}
                {rules.thesis.assumptions.length > 0 || rules.thesis.sources.length > 0 ? (
                  <details className={styles.more}>
                    <summary>{word("assumptionsSources")}</summary>
                    <div className={styles.moreBody}>
                      {rules.thesis.assumptions.length > 0 ? (
                        <ul className={styles.list}>
                          {rules.thesis.assumptions.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      ) : null}
                      {rules.thesis.sources.length > 0 ? (
                        <ul className={styles.list}>
                          {rules.thesis.sources.map((href) => (
                            <li key={href}>
                              <a href={href} target="_blank" rel="noreferrer noopener">
                                {href}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* ── Every rule, by group, one press deep ─────────────────── */}
          <details className={`${styles.card} ${styles.fold}`}>
            <summary>
              {word("allRules")}
              <span className={styles.foldSub}>
                {word("entry")} · {word("executionRules").toLowerCase()} · {word("riskRules").toLowerCase()} · {word("exitRules").toLowerCase()}
              </span>
            </summary>
            <div className={styles.foldBody}>
              <div className={styles.ruleGrid}>
                <div className={styles.ruleColumn}>
                  <RuleCard title={word("entry")}>
                    <Fact label={word("entryPrice")} topic="plannedEntry" locale={locale} value={fmtUsd(rules.entry.pricePerShare, locale)} sub={version.planningPrice ? `${word("planningPriceAsOf")} ${fmtWhen(version.planningPrice.observedAt, locale)} · ${fmtUsd(version.planningPrice.perUnit, locale)}${version.planningPrice.state === "stale" ? ` · ${word("planningPriceStale")}` : ""}` : version.planningPrice === null ? word("planningPriceNone") : undefined} />
                    <Fact label={word("maxPrice")} topic="maxPrice" locale={locale} value={rules.entry.maxPricePerShare === null ? "—" : fmtUsd(rules.entry.maxPricePerShare, locale)} sub={rules.entry.maxPricePerShare === null ? word("reportedOnly") : undefined} />
                    <Fact label={word("validUntil")} topic="validUntil" locale={locale} value={rules.entry.validUntil ? fmtWhen(rules.entry.validUntil, locale) : word("noValidUntil")} tone={shownExpired ? "caution" : undefined} />
                    <Fact label={word("budget")} topic="budget" locale={locale} value={fmtUsd(rules.capital.budgetUsd, locale)} sub={`${fmtUsd(rules.capital.reserveForCostsUsd, locale)} ${word("kept")}`} />
                  </RuleCard>

                  <RuleCard title={word("executionRules")}>
                    <Fact label={word("maxSlippage").replace(/,.*$/u, "")} topic="maxSlippage" locale={locale} value={`${(rules.execution.maxSlippageBps / 100).toFixed(2)}%`} />
                    <Fact label={word("maxQuoteAge").replace(/,.*$/u, "")} topic="maxQuoteAge" locale={locale} value={`${rules.execution.maxQuoteAgeSeconds} ${s}`} />
                    {/* A token has no issuer reference (1.7.0): the deviation rule is not a fact of its plan. */}
                    {tokenPlan ? null : (
                    <Fact
                      label={word("maxDeviation").replace(/,.*$/u, "")}
                      topic="maxDeviation"
                      locale={locale}
                      value={rules.execution.maxReferenceDeviationPct === null ? "—" : `${rules.execution.maxReferenceDeviationPct.toFixed(2)}%`}
                      sub={rules.execution.referenceRequired ? word("required") : word("advisory")}
                    />
                    )}
                    <Fact label={word("minLiquidity").replace(/,.*$/u, "")} topic="minLiquidity" locale={locale} value={rules.execution.minLiquidityUsd === null ? "—" : fmtUsd(rules.execution.minLiquidityUsd, locale, 0)} />
                  </RuleCard>
                </div>
                <div className={styles.ruleColumn}>
                  <RuleCard title={word("riskRules")} foot={word("modelNote")}>
                    <Fact label={word("risk")} topic="plannedRisk" locale={locale} value={fmtUsd(rules.risk.plannedRiskUsd, locale)} />
                    <Fact label={word("invalidationLabel")} topic="invalidation" locale={locale} value={fmtUsd(rules.risk.invalidationPerShare, locale)} sub={word("invalidationIsRule")} />
                    <Fact label={word("lossPerShare")} value={fmtUsd(sizing.lossPerShareUsd, locale)} />
                    <Fact label={word("costBuffer").replace(/,.*$/u, "")} topic="costBuffer" locale={locale} value={`${(rules.risk.costBufferBps / 100).toFixed(2)}%`} />
                    <Fact label={word("plannedSize")} topic="size" locale={locale} value={`${fmtUnits(sizing.units, locale)} ${underlying}`} sub={sizing.limitedBy === "risk" ? word("limitedByRisk") : word("limitedByCapital")} />
                  </RuleCard>

                  <RuleCard title={word("exitRules")}>
                    <Fact label={word("target").replace(/,.*$/u, "")} topic="target" locale={locale} value={rules.exit.targetPerShare === null ? "—" : fmtUsd(rules.exit.targetPerShare, locale)} />
                    <Fact label={word("timeExit").replace(/\s*\(.*\)$/u, "")} topic="timeExit" locale={locale} value={rules.exit.timeExitAt ? fmtWhen(rules.exit.timeExitAt, locale) : "—"} />
                    <Fact label={word("horizon")} topic="horizon" locale={locale} value={rules.thesis.horizon ? `${rules.thesis.horizon.value} ${word(rules.thesis.horizon.unit)}` : word("noHorizon")} />
                  </RuleCard>

                  {/* The version's conditions on what the market did — the rule and its mode; the figure as it stands is in Market now. */}
                  <RuleCard title={word("evidenceConditions")} foot={rules.evidenceConditions.length > 0 ? ruleSources : undefined}>
                    {rules.evidenceConditions.length === 0 ? (
                      <Fact label={word("evidenceConditions")} topic="evidenceCondition" locale={locale} value="—" sub={word("evidenceNone")} />
                    ) : (
                      rules.evidenceConditions.map((condition, index) => (
                        <Fact
                          key={index}
                          label={evidenceMetric(condition.metric)?.words[locale].label ?? condition.metric}
                          topic={index === 0 ? "evidenceCondition" : undefined}
                          locale={locale}
                          value={evidenceMetric(condition.metric)?.unit === "flag" ? fmtByUnit(condition.threshold, "flag", locale) : `${operatorWord(condition.operator, locale)} ${fmtByUnit(condition.threshold, evidenceMetric(condition.metric)?.unit ?? "usd", locale)}`}
                          sub={`${condition.window === "now" ? word("evidenceStructureShort") : windowWord(condition.window, locale)} · ${condition.mode === "required" ? word("evidenceRequireShort") : word("evidenceWarn").toLowerCase()}`}
                        />
                      ))
                    )}
                  </RuleCard>
                </div>
              </div>
            </div>
          </details>

          {/* ── One history: the latest event, the rest one press deep ── */}
          <section className={styles.card} aria-label={word("history")}>
            <div className={styles.cardHead}>
              <h2>
                <HelpLabel topic="versions" locale={locale}>
                  {word("history")}
                </HelpLabel>
              </h2>
              <span className={styles.cardHeadSpacer} />
              <span className={styles.muted} translate="no">
                {plan.versions.length} · v{plan.version}
              </span>
            </div>
            <div className={styles.cardBody}>
              {sync?.state === "pending" ? <p className={styles.muted}>{word("syncing")}</p> : null}
              {latest ? (
                <ol className={styles.timeline} data-latest="true">
                  <TimelineItem entry={latest} word={word} locale={locale} />
                </ol>
              ) : null}
              <details className={styles.more}>
                <summary>{word("showHistory")}</summary>
                <div className={styles.moreBody}>
                  <ol className={styles.timeline}>
                    {plan.journal.map((entry, index) => (
                      <TimelineItem key={`${entry.at}-${index}`} entry={entry} word={word} locale={locale} />
                    ))}
                    {plan.status === "active" && plan.executions.length === 0 ? (
                      <li data-event="waiting">
                        <span className={styles.timelineDot} aria-hidden="true" />
                        <span className={styles.timelineBody}>
                          <span className={styles.timelineTitle}>{word("waitingNode")}</span>
                        </span>
                      </li>
                    ) : null}
                  </ol>
                  <p className={styles.sectionLabel}>{word("versions")}</p>
                  <ol className={styles.versionList}>
                    {[...plan.versions].reverse().map((entry) => {
                      const isCurrent = entry.version === plan.version;
                      const viewing = version.version === entry.version;
                      return (
                        <li key={entry.version}>
                          <button type="button" className={styles.versionCard} onClick={() => void openVersion(entry.version)} aria-pressed={viewing} data-current={isCurrent ? "true" : "false"}>
                            <span className={styles.versionHead}>
                              <b translate="no">v{entry.version}</b>
                              {isCurrent ? <span className={styles.versionChip}>{word("currentChip")}</span> : null}
                              <time className={styles.versionTime} dateTime={entry.createdAt}>
                                {fmtWhen(entry.createdAt, locale)}
                              </time>
                            </span>
                            <span className={styles.versionReason}>{entry.reason ?? (entry.version === 1 ? word("firstVersion") : "")}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </details>
            </div>
          </section>
        </div>

        {/* ── Plan status: what is true now, what to do next ───────────── */}
        <aside className={styles.side}>
          <section className={`${styles.card} ${styles.statusCard}`} aria-label={word("planStatus")}>
            <div className={styles.cardHead}>
              <h2>{word("planStatus")}</h2>
            </div>
            <div className={styles.cardBody}>
              <div className={styles.statusLine}>
                <span className={styles.status} data-status={plan.status} data-size="lg">
                  {statusWord(plan.status, locale)}
                </span>
                <span className={styles.statusVersion} translate="no">
                  v{plan.version}
                </span>
              </div>
              <p className={styles.stateLine}>{stateLine}</p>

              <div className={styles.nowHead}>
                <span>{word("marketNow")}</span>
                {observedClock ? (
                  <span className={styles.muted} data-stale={stale ? "true" : "false"}>
                    {`${word("asOf")} ${observedClock} UTC`}
                    {stale ? ` · ${word("stale")}` : ""}
                  </span>
                ) : null}
              </div>
              <ul className={styles.conditions}>
                {conditions.map((condition) => (
                  <li key={condition.key} data-tone={condition.tone}>
                    <ConditionIcon tone={condition.tone} />
                    <span className={styles.conditionText}>{condition.text}</span>
                    {condition.topic ? <Help topic={condition.topic} locale={locale} /> : null}
                  </li>
                ))}
              </ul>
              <p className={styles.footnote}>
                {word("orientation")}
                {current.evidenceConditions.length > 0 ? (
                  <>
                    {" "}
                    {evidenceAttribution ? (
                      <>
                        {word("evidenceAskedShort")} {evidenceAttribution.at}
                        {evidenceAttribution.sources.map((source) => (
                          <span key={source.href}>
                            {" · "}
                            <a href={source.href} target="_blank" rel="noreferrer noopener">
                              {source.text}
                            </a>
                          </span>
                        ))}
                      </>
                    ) : null}
                  </>
                ) : null}
              </p>

              {/* On a pre-IPO plan the action already stands in the state line above the fold. */}
              {primary && !preIpo ? <div className={styles.sideAction}>{primary}</div> : null}

              {editable && !shown ? (
                cancelling.open ? (
                  <div className={styles.dialog}>
                    <p className={styles.lead}>{word("confirmCancel")}</p>
                    <label className={styles.field}>
                      <span>{word("cancelReason")}</span>
                      <input value={cancelling.reason} onChange={(e) => setCancelling((c) => ({ ...c, reason: e.target.value }))} maxLength={240} />
                    </label>
                    {cancelling.error ? <p className={styles.error}>{cancelling.error}</p> : null}
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className="rw-btn rw-btn--primary"
                        disabled={cancelling.busy}
                        onClick={() => {
                          setCancelling((c) => ({ ...c, busy: true, error: null }));
                          void setStatus("cancelled", cancelling.reason.trim() || null).then((result) => setCancelling((c) => ({ ...c, busy: false, open: result !== true, error: result === true ? null : String(result) })));
                        }}
                      >
                        {cancelling.busy ? word("saving") : word("cancel")}
                      </button>
                      <button type="button" className="rw-btn" onClick={() => setCancelling({ open: false, reason: "", busy: false, error: null })}>
                        {word("keep")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className={styles.quietAction} onClick={() => setCancelling({ open: true, reason: "", busy: false, error: null })}>
                    {word("cancel")}
                  </button>
                )
              ) : null}
            </div>
          </section>
        </aside>
      </div>

      {results.length > 0 ? (
        <section className={styles.card} aria-label={word("planVsActual")}>
          <div className={styles.cardHead}>
            <h2>
              <HelpLabel topic="planVsActual" locale={locale}>
                {word("planVsActual")}
              </HelpLabel>
            </h2>
            <span className={styles.cardHeadSpacer} />
            <span className={styles.muted}>{results.length}</span>
          </div>
          <div className={styles.cardBody}>
            <div className={styles.results}>
              {results.map((result) => (
                <PlanResultCard key={result.actual.signature} result={result} locale={locale} />
              ))}
            </div>
            <p className={styles.muted}>{word("entryOnly")}</p>
          </div>
        </section>
      ) : null}
      </DetailsFold>
    </section>
  );
}

/** The plan one press deep where `fold` is set (a pre-IPO plan); elsewhere the page as it always reads. A module-level component, so a re-render keeps the fold as the person left it. */
function DetailsFold({ fold, label, children }: { fold: boolean; label: string; children: ReactNode }) {
  if (!fold) return <>{children}</>;
  return (
    <details className={styles.preIpoFold}>
      <summary>{label}</summary>
      <div className={styles.preIpoBody}>{children}</div>
    </details>
  );
}

function TimelineItem({ entry, word, locale }: { entry: TradingPlan["journal"][number]; word: (w: PlanWord) => string; locale: WorkspaceLocale }) {
  const signature = entry.event === "executed" ? entry.ref : null;
  return (
    <li data-event={entry.event}>
      <span className={styles.timelineDot} aria-hidden="true" />
      <span className={styles.timelineBody}>
        <span className={styles.timelineTitle}>
          {word(EVENT_WORD[entry.event])}
          {entry.event === "edited" ? <span translate="no"> · v{entry.version}</span> : null}
        </span>
        {entry.note ? <span className={styles.timelineNote}>{entry.note}</span> : null}
        <span className={styles.timelineMeta}>
          <time dateTime={entry.at}>{fmtWhen(entry.at, locale)}</time>
          {signature ? (
            <a href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noreferrer noopener" className={styles.timelineLink}>
              {word("viewTransaction")}
              <ArrowSquareOut size={12} weight="bold" aria-hidden="true" />
            </a>
          ) : null}
        </span>
      </span>
    </li>
  );
}

function Crumbs({ word, symbol }: { word: (w: PlanWord) => string; symbol?: string }) {
  return (
    <p className={styles.crumbs}>
      <Link href="/app/bots" prefetch={false}>
        {word("back")}
      </Link>
      {symbol ? (
        <>
          <span aria-hidden="true">/</span>
          <span translate="no">{symbol}</span>
        </>
      ) : null}
    </p>
  );
}

/** One of the four figures a person reads first. */
function Key({ label, topic, locale, value, sub }: { label: string; topic: HelpTopicId; locale: WorkspaceLocale; value: string; sub?: string }) {
  return (
    <div className={styles.key}>
      <span className={styles.keyLabel}>
        <HelpLabel topic={topic} locale={locale}>
          {label.replace(/,.*$/u, "")}
        </HelpLabel>
      </span>
      <span className={styles.keyValue} translate="no">
        {value}
      </span>
      {sub ? <span className={styles.keySub}>{sub}</span> : null}
    </div>
  );
}

function RuleCard({ title, foot, children }: { title: string; foot?: string; children: ReactNode }) {
  return (
    <section className={styles.card} aria-label={title}>
      <div className={styles.cardHead}>
        <h2>{title}</h2>
      </div>
      <dl className={styles.ruleList}>{children}</dl>
      {foot ? <p className={styles.ruleFoot}>{foot}</p> : null}
    </section>
  );
}

/** One rule: the label with its `?`, the figure, one short word under it when the figure needs one. */
function Fact({ label, topic, locale, value, sub, tone }: { label: string; topic?: HelpTopicId; locale?: WorkspaceLocale; value: string; sub?: string; tone?: "caution" }) {
  const clean = label.replace(/\s*\((?:optional|необов'язково)\)$/u, "").replace(/,\s*(\$ per share|\$ за акцію|\$|%|s|с)$/u, "");
  return (
    <div className={styles.rule} data-tone={tone}>
      <dt>
        {topic && locale ? (
          <HelpLabel topic={topic} locale={locale}>
            {clean}
          </HelpLabel>
        ) : (
          clean
        )}
      </dt>
      <dd>
        <span translate="no">{value}</span>
        {sub ? <span className={styles.ruleSub}>{sub}</span> : undefined}
      </dd>
    </div>
  );
}
