"use client";

import { X } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PredictionEvent, PredictionMarket } from "@/lib/predictions/model";
import type { PaperReview, PredictionOrderRecord } from "@/lib/predictions/paper";
import type { PredictionPlan } from "@/lib/predictions/plan-model";
import { parseDecimalInput } from "@/lib/plans/decimal-input";

import { orderStateWord, orderTone } from "../account-card";
import { pct, shares, usd } from "../format";
import styles from "../predictions.module.css";
import type { usePaperAccount } from "../use-paper-account";
import { outcomeLabel, venueName, wordsFor } from "../words";

type Account = ReturnType<typeof usePaperAccount>;

const PRESETS = [5, 10, 25, 50] as const;

type Flow =
  | Readonly<{ stage: "ticket" }>
  | Readonly<{ stage: "quoting" }>
  | Readonly<{ stage: "review"; review: PaperReview; order: PredictionOrderRecord }>
  | Readonly<{ stage: "placing"; review: PaperReview }>
  | Readonly<{ stage: "placed"; order: PredictionOrderRecord }>
  | Readonly<{ stage: "failed"; code: string; message: string; review: PaperReview | null }>;

type ApiFailure = { error?: { code?: string; message?: string } };

/**
 * The paper ticket and the Review over the smart route (`RYN-PREDICTIONS-001`
 * items 9, 10, 14). The ticket asks two things — which outcome and how much
 * — and hands the rest to the server: the route is priced for the person's
 * own paper session, the Review lists what they put on the outcome, what it
 * pays if right, what they lose if wrong, the fees, the quote's age, the
 * venues that fill it, the settlement summary and every check, and the one
 * act is *Place paper order*. A refused Review names why and offers a fresh
 * price. A placed order shows what the provider reported, never more.
 */
export function PaperTicket({
  event,
  market,
  outcomeId,
  onOutcome,
  locale,
  account,
  pro,
}: {
  event: PredictionEvent;
  market: PredictionMarket;
  outcomeId: string;
  onOutcome: (outcomeId: string) => void;
  locale: WorkspaceLocale;
  account: Account;
  pro: boolean;
}) {
  const word = wordsFor(locale);
  const [amount, setAmount] = useState("10");
  const [planId, setPlanId] = useState<string | null>(null);
  const [flow, setFlow] = useState<Flow>({ stage: "ticket" });
  const outcome = market.outcomes.find((o) => o.id === outcomeId) ?? market.outcomes[0];
  const spend = parseDecimalInput(amount);
  const parsedOk = spend !== null && spend > 0;
  const linked = account.state.status === "ready" && account.state.account?.link.state === "active";
  const plans = useMemo(
    () => (account.state.account?.plans ?? []).filter((p) => p.status === "active" && p.current.rules.eventId === event.id),
    [account.state.account?.plans, event.id],
  );

  useEffect(() => {
    if (planId && !plans.some((p) => p.id === planId)) setPlanId(null);
  }, [plans, planId]);

  /* A plan chosen brings its own amount and outcome. */
  const applyPlan = useCallback(
    (plan: PredictionPlan | null) => {
      setPlanId(plan?.id ?? null);
      if (plan) {
        setAmount(String(plan.current.rules.amountUsd));
        onOutcome(plan.current.rules.outcomeId);
      }
    },
    [onOutcome],
  );

  const quote = useCallback(async () => {
    if (!outcome || spend == null || spend <= 0) return;
    setFlow({ stage: "quoting" });
    try {
      const response = await fetch("/api/predictions/quote", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ eventId: event.id, venueMarketId: market.id, outcomeId: outcome.id, side: "buy", spendUsd: spend, planId, locale }),
      });
      const body = (await response.json()) as { review: PaperReview; order: PredictionOrderRecord } & ApiFailure;
      if (!response.ok) {
        setFlow({ stage: "failed", code: body.error?.code ?? "UNAVAILABLE", message: body.error?.message ?? "", review: null });
        return;
      }
      setFlow({ stage: "review", review: body.review, order: body.order });
    } catch {
      setFlow({ stage: "failed", code: "NETWORK", message: "", review: null });
    }
  }, [event.id, market.id, outcome, spend, planId, locale]);

  const place = useCallback(async (review: PaperReview) => {
    setFlow({ stage: "placing", review });
    try {
      const response = await fetch("/api/predictions/orders", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ quoteId: review.quoteId }),
      });
      const body = (await response.json()) as { order: PredictionOrderRecord } & ApiFailure;
      if (!response.ok) {
        setFlow({ stage: "failed", code: body.error?.code ?? "UNAVAILABLE", message: body.error?.message ?? "", review });
        return;
      }
      setFlow({ stage: "placed", order: body.order });
    } catch {
      setFlow({ stage: "failed", code: "NETWORK", message: "", review });
    }
  }, []);

  /* A submitted order is re-read until the provider reports a terminal state. */
  useEffect(() => {
    if (flow.stage !== "placed" || flow.order.state !== "submitted") return undefined;
    const quoteId = flow.order.quoteId;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/predictions/orders/${encodeURIComponent(quoteId)}`, { headers: { accept: "application/json" }, cache: "no-store" });
        const body = (await response.json()) as { order: PredictionOrderRecord };
        if (response.ok) setFlow({ stage: "placed", order: body.order });
      } catch {
        /* the next tick reads again */
      }
    }, 2_000);
    return () => clearTimeout(timer);
  }, [flow]);

  useEffect(() => {
    if (flow.stage === "placed" && flow.order.state !== "submitted") void account.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the account is re-read once per settled order
  }, [flow.stage, flow.stage === "placed" ? flow.order.state : null]);

  const close = useCallback(() => setFlow({ stage: "ticket" }), []);

  return (
    <section className={styles.card} aria-labelledby="pred-ticket">
      <div className={styles.cardHead}>
        <h2 id="pred-ticket" className={styles.cardTitle}>
          {word("paperBuy")}
        </h2>
        <span className={styles.paperBadge}>{word("paperBadge")}</span>
      </div>
      <div className={styles.ticket}>
        <p className={styles.muted}>{market.question}</p>
        <div className={styles.sideRow} role="group" aria-label={word("outcomes")}>
          {market.outcomes.slice(0, 2).map((o) => (
            <button key={o.id} type="button" className={styles.sideButton} aria-pressed={o.id === outcome?.id} onClick={() => onOutcome(o.id)}>
              Paper {outcomeLabel(o.label, locale)}
              <small>{pct(o.probability)}</small>
            </button>
          ))}
        </div>
        {market.outcomes.length > 2 ? (
          <select className={styles.selectInput} value={outcome?.id} aria-label={word("outcome")} onChange={(e) => onOutcome(e.target.value)}>
            {market.outcomes.map((o) => (
              <option key={o.id} value={o.id}>
                {outcomeLabel(o.label, locale)} · {pct(o.probability)}
              </option>
            ))}
          </select>
        ) : null}
        {!linked ? (
          <p className={styles.notice}>{account.state.status === "guest" ? word("walletFirst") : word("notLinkedText")}</p>
        ) : (
          <>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="pred-amount">
                {word("amount")}
              </label>
              <input id="pred-amount" className={styles.input} inputMode="decimal" value={amount} aria-invalid={!parsedOk} onChange={(e) => setAmount(e.target.value)} />
              <div className={styles.presets}>
                {PRESETS.map((p) => (
                  <button key={p} type="button" className={styles.chip} aria-pressed={spend === p} onClick={() => setAmount(String(p))}>
                    ${p}
                  </button>
                ))}
              </div>
              <p className={styles.hint}>{word("amountHint")}</p>
            </div>
            {plans.length > 0 ? (
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="pred-plan">
                  {word("underPlan")}
                </label>
                <select id="pred-plan" className={styles.selectInput} value={planId ?? ""} onChange={(e) => applyPlan(plans.find((p) => p.id === e.target.value) ?? null)}>
                  <option value="">{word("noPlan")}</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.current.rules.outcomeLabel} · {usd(p.current.rules.amountUsd, 0)} · v{p.version}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <button type="button" className="rw-btn rw-btn--primary" disabled={!outcome || spend == null || spend <= 0 || flow.stage === "quoting" || market.status !== "open"} onClick={() => void quote()}>
              {flow.stage === "quoting" ? word("quoting") : `${word("review")} · ${spend != null ? usd(spend, 0) : "—"}`}
            </button>
            {market.status !== "open" ? <p className={styles.hint}>{market.status === "resolved" ? (locale === "uk" ? "Ринок вирішено — нових ордерів немає." : "The market has resolved; no new orders.") : locale === "uk" ? "Ринок закрито для нових ордерів." : "The market is closed to new orders."}</p> : null}
            {flow.stage === "failed" && !flow.review ? <p className={styles.error}>{failureWords(flow.code, flow.message, locale)}</p> : null}
          </>
        )}
      </div>
      {flow.stage === "review" || flow.stage === "placing" || flow.stage === "placed" || (flow.stage === "failed" && flow.review) ? (
        <ReviewSheet flow={flow} locale={locale} pro={pro} onClose={close} onPlace={place} onRequote={() => void quote()} />
      ) : null}
    </section>
  );
}

function failureWords(code: string, message: string, locale: WorkspaceLocale): string {
  const word = wordsFor(locale);
  switch (code) {
    case "NOT_LINKED":
      return word("notLinkedText");
    case "SESSION_EXPIRED":
      return word("sessionExpired");
    case "QUOTE_EXPIRED":
      return word("expired");
    case "RATE_LIMITED":
      return word("rateLimited");
    case "PROVIDER_UNAVAILABLE":
    case "NETWORK":
      return word("unavailable");
    default:
      return message || word("unavailable");
  }
}

function ReviewSheet({ flow, locale, pro, onClose, onPlace, onRequote }: { flow: Flow; locale: WorkspaceLocale; pro: boolean; onClose: () => void; onPlace: (review: PaperReview) => void; onRequote: () => void }) {
  const word = wordsFor(locale);
  const review = flow.stage === "review" || flow.stage === "placing" ? flow.review : flow.stage === "failed" ? flow.review : flow.stage === "placed" ? flow.order.review : null;
  const [ageSeconds, setAge] = useState(review?.quote.ageSeconds ?? 0);
  useEffect(() => {
    if (!review) return undefined;
    const tick = () => setAge(Math.max(0, Math.round((Date.now() - Date.parse(review.quote.quotedAt)) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [review]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!review) return null;
  const expired = Date.parse(review.route.expiresAt) <= Date.now() || ageSeconds > 90;
  const placed = flow.stage === "placed" ? flow.order : null;
  const figures = review.figures;
  return (
    <div className={styles.overlay} role="presentation" onClick={(e) => { if (e.target === e.currentTarget && flow.stage !== "placing") onClose(); }}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="pred-review-title">
        <div className={styles.sheetHead}>
          <h2 id="pred-review-title">{placed ? word("placed") : word("reviewTitle")}</h2>
          <span className={styles.actions}>
            <span className={styles.paperBadge}>{word("paperBadge")}</span>
            <button type="button" className={styles.iconButton} aria-label={word("close")} onClick={onClose} disabled={flow.stage === "placing"}>
              <X size={18} />
            </button>
          </span>
        </div>
        <div className={styles.cardBody}>
          {!placed ? <p className={styles.note}>{word("reviewIntro")}</p> : null}
          <dl className={styles.kv}>
            <dt>{word("marketLabel")}</dt>
            <dd data-prose="true">{review.market.question}</dd>
            <dt>{word("outcome")}</dt>
            <dd>{outcomeLabel(review.outcome.label, locale)}</dd>
            <dt>{word("routeVenues")}</dt>
            <dd data-prose="true">{review.venues.length ? review.venues.map(venueName).join(" + ") : "—"}</dd>
          </dl>
          <div className={styles.reviewFigures}>
            <Figure label={word("amount")} value={usd(review.requested)} />
            <Figure label={word("buysAt")} value={pct(figures.probability, 1)} />
            <Figure label={word("payoutIfRight")} value={usd(figures.payoutIfRightUsd)} tone="pos" />
            <Figure label={word("maxLoss")} value={usd(figures.maxLossUsd)} tone="neg" />
          </div>
          <dl className={styles.kv}>
            <dt>{word("shares")}</dt>
            <dd>{shares(figures.shares)}</dd>
            <dt>{word("fees")}</dt>
            <dd>{usd(figures.feesUsd, 4)}</dd>
            <dt>{word("total")}</dt>
            <dd data-strong="true">{usd(figures.totalUsd)}</dd>
            <dt>{word("profitIfRight")}</dt>
            <dd data-tone="pos">{usd(figures.profitIfRightUsd)}</dd>
            <dt>{word("balance")}</dt>
            <dd>{review.balance ? usd(review.balance.cashBalance) : "—"}</dd>
            <dt>{word("quoteAge")}</dt>
            <dd data-tone={expired ? "neg" : undefined}>{ageSeconds}s</dd>
          </dl>
          {review.settlement ? <p className={styles.note}>{review.settlement.sharedSummary}</p> : null}
          <div>
            <h3 className={styles.sectionTitle}>{word("checks")}</h3>
            <ul className={styles.checks}>
              {review.checks.map((c, i) => (
                <li key={`${c.id}:${i}`} className={styles.check} data-state={c.state}>
                  <i aria-hidden="true">{c.state === "pass" ? "✓" : c.state === "warn" ? "!" : "×"}</i>
                  <span>{c.detail}</span>
                  <b>{c.figure ?? ""}</b>
                </li>
              ))}
            </ul>
          </div>
          {review.plan ? (
            <div>
              <h3 className={styles.sectionTitle}>
                {word("planChecks")} · v{review.plan.version}
              </h3>
              <ul className={styles.checks}>
                {review.plan.checks.map((c, i) => (
                  <li key={`${c.id}:${i}`} className={styles.check} data-state={c.state}>
                    <i aria-hidden="true">{c.state === "pass" ? "✓" : c.state === "warn" ? "!" : "×"}</i>
                    <span>{c.detail}</span>
                    <b>{c.figure ?? ""}</b>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {placed ? (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{word("orderState")}</span>
              <span className={styles.actions}>
                <span className={styles.stateChip} data-tone={orderTone(placed.state)}>
                  {orderStateWord(placed.state, word)}
                </span>
                {placed.execution?.orders.map((o) => (
                  <span key={o.orderId} className={styles.muted}>
                    {venueName(o.venue)} · {o.status} · {o.actualShares != null ? `${shares(o.actualShares)} @ ${pct(o.executionPrice, 1)}` : ""}
                    {o.error ? ` · ${o.error}` : ""}
                  </span>
                ))}
              </span>
              {placed.state === "submitted" ? <p className={styles.hint}>{word("submitted")}</p> : null}
            </div>
          ) : null}
          {flow.stage === "failed" ? <p className={styles.error}>{failureWords(flow.code, flow.message, locale)}</p> : null}
          {!review.canPlace && !placed ? (
            <p className={styles.error}>
              {word("blocked")}. {[...review.checks, ...(review.plan?.checks ?? [])].filter((c) => c.state === "fail").map((c) => c.detail).join(" ")}
            </p>
          ) : null}
          {expired && !placed && flow.stage !== "placing" ? <p className={styles.notice}>{word("expired")}</p> : null}
          <div className={styles.formActions}>
            {placed ? (
              <button type="button" className="rw-btn rw-btn--primary" onClick={onClose}>
                {word("close")}
              </button>
            ) : (
              <>
                <button type="button" className="rw-btn" onClick={onRequote} disabled={flow.stage === "placing"}>
                  {word("requote")}
                </button>
                <button type="button" className="rw-btn rw-btn--primary" disabled={!review.canPlace || expired || flow.stage === "placing"} onClick={() => onPlace(review)}>
                  {flow.stage === "placing" ? word("placing") : word("placePaper")}
                </button>
              </>
            )}
          </div>
          <details className={styles.disclosure} open={pro}>
            <summary>{word("routeDetail")}</summary>
            <div className={styles.disclosureBody}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{word("venue")}</th>
                      <th>{word("price")}</th>
                      <th>{word("shares")}</th>
                      <th>{word("fees")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.route.fills.map((f, i) => (
                      <tr key={`${f.venue}:${i}`}>
                        <th scope="row">{venueName(f.venue)}</th>
                        <td>{pct(f.avgPrice, 1)}</td>
                        <td>{shares(f.shares)}</td>
                        <td>{usd((f.fees.venue ?? 0) + (f.fees.builder ?? 0) + (f.fees.settlement ?? 0), 4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {review.route.venueSolo.length > 0 ? (
                <p>
                  {word("venueComparison")}:{" "}
                  {review.route.venueSolo.map((v) => `${venueName(v.venue)} ${Object.entries(v.fields).filter(([k]) => /price|cost|shares|filled/i.test(k)).slice(0, 3).map(([k, val]) => `${k} ${typeof val === "number" ? val.toFixed(4) : String(val)}`).join(", ")}`).join(" · ")}
                </p>
              ) : null}
              {review.route.warnings.length > 0 ? <p>{review.route.warnings.map((w) => `${venueName(w.venue)}: ${w.reason}`).join("; ")}</p> : null}
              <p className={styles.mono}>
                quote {review.quoteId} · {review.route.solveMs} ms / {review.route.verifyMs} ms · {word("expires")} {review.route.expiresAt.replace("T", " ").slice(0, 19)} UTC
              </p>
              <p>{word("providerNote")}</p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className={styles.figure} data-tone={tone}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
