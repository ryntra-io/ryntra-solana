"use client";

import { ArrowSquareOut, ArrowsClockwise } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Help, HelpLabel } from "@/app/shell/help";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { MarketEvidenceReadDto, MarketEvidenceSnapshotDto } from "@/lib/api/v1/contract";
import { evidenceMetric, type EvidenceMetricId, type EvidenceWindow } from "@/lib/evidence/metrics";

import { coverageWords, evidenceWordsFor, fmtAddresses, fmtClock, fmtSignedCompact, windowWord } from "./evidence-words";
import styles from "./evidence.module.css";

/**
 * The analysis card — the first of the three evidence capabilities: an
 * external source's observations of the token, read when the person asks,
 * shown as three facts with their times and the source's attribution, and one
 * press away from becoming a rule of the plan.
 *
 * Nothing loads until *Analysis* is pressed: opening an asset costs nothing
 * and the person decides whether the question is worth asking. The answer
 * is whatever the server says it is — a fresh read, a cached one, the last
 * copy held while the source is silent, *not enough data*, or *not available*
 * with the reason — and the card says which. A figure the source did not
 * answer is a dash, never a zero. The three facts are the figures a person
 * can act on (the day's trading, the movement to exchanges, the movement of
 * large holders); everything technical — the families, the coverage notes,
 * the expiry, the terms — sits under *Details*.
 *
 * `planHref` is where *Add a condition to the plan* goes, with the metric,
 * the window and the observed figure carried along so the builder starts
 * from a real number; absent, the button is not drawn (the asset has no plan
 * to add a rule to).
 */

type Fetched = Readonly<{ status: "idle" } | { status: "loading"; previous: MarketEvidenceReadDto | null } | { status: "done"; read: MarketEvidenceReadDto; at: number }>;

const FACTS: readonly EvidenceMetricId[] = ["dex_volume_usd", "exchange_net_flow_usd", "whale_net_flow_usd"];

function figureOf(snapshot: MarketEvidenceSnapshotDto, id: EvidenceMetricId) {
  return snapshot.metrics.find((metric) => metric.id === id) ?? null;
}

export function EvidenceCard({ mint, locale, planHref, initialWindow = "24h" }: { mint: string; locale: WorkspaceLocale; planHref: string | null; initialWindow?: EvidenceWindow }) {
  const word = useMemo(() => evidenceWordsFor(locale), [locale]);
  const [window, setWindow] = useState<EvidenceWindow>(initialWindow);
  const [state, setState] = useState<Fetched>({ status: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const [detailsOpen, setDetailsOpen] = useState(false);

  const load = useCallback(
    async (target: EvidenceWindow) => {
      setState((current) => ({ status: "loading", previous: current.status === "done" ? current.read : null }));
      try {
        const response = await fetch(`/api/v1/research/evidence?mint=${encodeURIComponent(mint)}&window=${target}`, { headers: { accept: "application/json", "X-Ryntra-API": "1" } });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
          const rate = body?.error?.code === "RATE_LIMITED";
          setState({ status: "done", read: { state: "UNAVAILABLE", snapshot: null, reason: rate ? (locale === "uk" ? "Забагато запитів із цієї адреси; зачекай хвилину." : "Too many reads from this address; wait a minute.") : null, served: "none" }, at: Date.now() });
          return;
        }
        const read = (await response.json()) as MarketEvidenceReadDto;
        setState({ status: "done", read, at: Date.now() });
      } catch {
        setState({ status: "done", read: { state: "UNAVAILABLE", snapshot: null, reason: null, served: "none" }, at: Date.now() });
      }
      setNow(Date.now());
    },
    [mint, locale],
  );

  /* The clock the expiry is judged against, once a minute while a snapshot is shown. */
  useEffect(() => {
    if (state.status !== "done" || !state.read.snapshot) return;
    const timer = globalThis.setInterval(() => setNow(Date.now()), 60_000);
    return () => globalThis.clearInterval(timer);
  }, [state]);

  const pick = (target: EvidenceWindow) => {
    setWindow(target);
    if (state.status !== "idle") void load(target);
  };

  const read = state.status === "done" ? state.read : state.status === "loading" ? state.previous : null;
  const snapshot = read?.snapshot ?? null;
  const expired = snapshot ? Date.parse(snapshot.expiresAt) <= now : false;
  const stale = read?.state === "STALE";
  const lagMinutes = snapshot ? Math.round(snapshot.providerLagSeconds / 60) : 0;
  const volume = snapshot ? figureOf(snapshot, "dex_volume_usd") : null;
  const buys = snapshot ? figureOf(snapshot, "dex_buy_volume_usd") : null;
  const sells = snapshot ? figureOf(snapshot, "dex_sell_volume_usd") : null;
  const whales = snapshot ? figureOf(snapshot, "whale_wallet_count") : null;
  const conditionHref = planHref && volume?.value !== null && volume?.value !== undefined ? `${planHref}${planHref.includes("?") ? "&" : "?"}evidence=${encodeURIComponent(`dex_volume_usd:${window}:gte:${Math.round(volume.value)}`)}` : planHref;

  return (
    <section className={styles.card} aria-labelledby={`evidence-title-${mint}`} data-state={read?.state ?? state.status}>
      <div className={styles.head}>
        <h2 id={`evidence-title-${mint}`}>
          <HelpLabel topic="onchainActivity" locale={locale}>
            {word("title")}
          </HelpLabel>
        </h2>
        <span className={styles.spacer} />
        <div className={styles.windows} role="group" aria-label={word("windowLabel")}>
          {(["24h", "7d"] as const).map((option) => (
            <button key={option} type="button" className={styles.windowButton} aria-pressed={window === option} onClick={() => pick(option)} disabled={state.status === "loading"}>
              {windowWord(option, locale)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.body}>
        {state.status === "idle" ? (
          <div className={styles.idle}>
            <p className={styles.lead}>{word("lead")}</p>
            {/* A sensor, not the screen's action: quiet, so the page keeps one orange action. */}
            <button type="button" className="rw-btn" onClick={() => void load(window)}>
              {word("analyse")}
            </button>
          </div>
        ) : null}

        {state.status === "loading" && !snapshot ? (
          <div className={styles.skeleton} aria-busy="true" aria-live="polite">
            <span />
            <span />
            <span />
            <p className={styles.muted}>{word("loading")}</p>
          </div>
        ) : null}

        {snapshot ? (
          <>
            <dl className={styles.facts} aria-busy={state.status === "loading"} data-dim={state.status === "loading" ? "true" : "false"}>
              {FACTS.map((id) => {
                const metric = evidenceMetric(id);
                const figure = figureOf(snapshot, id);
                if (!metric) return null;
                const value = figure?.value ?? null;
                const sub =
                  id === "dex_volume_usd"
                    ? buys?.value !== null && buys?.value !== undefined && sells?.value !== null && sells?.value !== undefined
                      ? `${word("buys")} ${fmtSignedCompact(buys.value, locale)} · ${word("sells")} ${fmtSignedCompact(sells.value, locale)}`
                      : null
                    : id === "whale_net_flow_usd"
                      ? whales?.value !== null && whales?.value !== undefined
                        ? `${fmtAddresses(whales.value, locale)} · ${word("addressesNote")}`
                        : word("movementNote")
                      : word("movementNote");
                return (
                  <div key={id}>
                    <dt>
                      {metric.words[locale].label}
                      {metric.aggregation === "cohort" ? <Help topic="tokenMovement" locale={locale} /> : null}
                    </dt>
                    <dd translate="no" data-absent={value === null ? "true" : "false"}>
                      {value === null ? <span className={styles.dash}>—</span> : fmtSignedCompact(value, locale)}
                      <span className={styles.factSub}>{value === null ? coverageWords(figure?.note ? [figure.note] : [], locale, word("noData")) : sub}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className={styles.meta}>
              <span translate="no">
                {word("askedAt")} {fmtClock(snapshot.fetchedAt, locale)}
              </span>
              {lagMinutes > 0 ? (
                <span>
                  · {word("sourceLag")} {lagMinutes} {word("minutes")}
                </span>
              ) : (
                <span>· {word("live")}</span>
              )}
              {stale ? <span className={styles.flag}>· {word("stale")}</span> : expired ? <span className={styles.flag}>· {word("expired")}</span> : null}
              <span className={styles.attribution}>
                ·{" "}
                <a href={snapshot.attribution.href} target="_blank" rel="noreferrer noopener">
                  {snapshot.attribution.text}
                  <ArrowSquareOut size={12} weight="bold" aria-hidden="true" />
                </a>
              </span>
            </p>
            <div className={styles.actions}>
              {conditionHref ? (
                <Link className="rw-btn" href={conditionHref} prefetch={false}>
                  {word("addCondition")}
                </Link>
              ) : null}
              {expired || stale ? (
                <button type="button" className="rw-btn" onClick={() => void load(window)} disabled={state.status === "loading"}>
                  <ArrowsClockwise size={14} weight="bold" aria-hidden="true" /> {word("refresh")}
                </button>
              ) : null}
              <button type="button" className={styles.detailsButton} aria-expanded={detailsOpen} aria-controls={`evidence-details-${mint}`} onClick={() => setDetailsOpen((open) => !open)}>
                {word("details")}
              </button>
            </div>
            {detailsOpen ? (
              <div id={`evidence-details-${mint}`} className={styles.details}>
                <dl className={styles.detailFacts}>
                  <div>
                    <dt>{word("windowLabel")}</dt>
                    <dd>{windowWord(snapshot.window, locale)}</dd>
                  </div>
                  <div>
                    <dt>{word("families")}</dt>
                    <dd>{snapshot.families.map((family) => (family === "tgm/token-screener" ? word("familyScreener") : family === "tgm/flow-intelligence" ? word("familyFlows") : family)).join("; ")}</dd>
                  </div>
                  <div>
                    <dt>{word("expiresAt")}</dt>
                    <dd translate="no">{fmtClock(snapshot.expiresAt, locale)}</dd>
                  </div>
                  {snapshot.warnings.length > 0 ? (
                    <div>
                      <dt>{word("coverage")}</dt>
                      <dd>{coverageWords(snapshot.warnings, locale, "")}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{word("method")}</dt>
                    <dd>{word("methodText")}</dd>
                  </div>
                </dl>
                <p className={styles.footnote}>{word("rights")}</p>
              </div>
            ) : null}
          </>
        ) : null}

        {state.status === "done" && !snapshot ? (
          <div className={styles.empty} role="status">
            <p className={styles.lead}>{read?.state === "UNKNOWN" ? word("noData") : word("unavailable")}</p>
            {read?.state === "UNAVAILABLE" && read.reason ? (
              <p className={styles.muted}>
                {word("reasonPrefix")}: {read.reason}
              </p>
            ) : null}
            <div className={styles.actions}>
              <button type="button" className="rw-btn" onClick={() => void load(window)}>
                {word("tryAgain")}
              </button>
              {read?.state === "UNKNOWN" ? (
                <span className={styles.attribution}>
                  <a href="https://nansen.ai" target="_blank" rel="noreferrer noopener">
                    Powered by Nansen API
                    <ArrowSquareOut size={12} weight="bold" aria-hidden="true" />
                  </a>
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
