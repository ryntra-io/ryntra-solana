"use client";

import { ArrowRight, CaretLeft, Eye } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Page } from "@ryntra/core/ui";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { unitsText, usdText } from "@/lib/agent/provenance";
import type { AssistantPlan, AssistantPlanFinding, AssistantPlanLevel, AssistantPlanResponse, AssistantPlansResponse } from "@/lib/api/v1/contract";

import { askTopUp, creditNumber } from "./credits-store";
import { criticCounts, StatePill } from "./ryntra-plans";
import { tradePlanWordsFor, type TradePlanWord } from "./trade-plan-words";
import pair from "../form-pair.module.css";
import styles from "./trade-plan.module.css";

/**
 * «План угоди й критик» (AI-11) on the assistant's page and panel: the
 * plans Ryntra composed with the person, the composer — the token, the
 * idea, the loss limit, the levels the person knows, the price before the
 * press — and one plan: its thesis and levels, the fees and both outcomes,
 * the critic's findings with «Детально» for the rest, the person's word
 * («Схвалити», «Стежити», «Змінити», «Перевірити ще раз», «Скасувати») and
 * «План проти реальності». Nothing here buys: an approved plan opens on its
 * own page, where the Review and the wallet's signature stay.
 */

const HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;
const QUICK_TOKENS: readonly (readonly [string, string])[] = [
  ["SOL", "So11111111111111111111111111111111111111112"],
  ["JUP", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
  ["BONK", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["WIF", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
];
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type W = (key: TradePlanWord) => string;
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
const usd = (value: number, locale: WorkspaceLocale) => usdText(value, locale);
const price = (n: number, locale: WorkspaceLocale, w: W) => fill(w("credits"), { n: creditNumber(n, locale) });
/* A comma by the person's language: in Ukrainian it is the decimal («0,125», «212,50»); in English «1,000» is a thousand and «212.50» the decimal. */
const numberOf = (text: string, locale: WorkspaceLocale): number | null => {
  const compact = text.replace(/\s/g, "");
  const value = Number(locale === "uk" ? compact.replace(",", ".") : /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(compact) ? compact.replace(/,/g, "") : compact);
  return text.trim() !== "" && Number.isFinite(value) && value > 0 ? value : null;
};

async function failureText(response: Response, w: W): Promise<Readonly<{ code: string | null; text: string }>> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string; issues?: { message: string }[] } };
    const code = body.error?.code ?? null;
    if (code === "AGENT_BUDGET_EXHAUSTED") return { code, text: fill(w("budgetOut"), { reason: body.error?.message ?? "" }) };
    if (code === "PLAN_INVALID") return { code, text: fill(w("invalid"), { issues: (body.error?.issues ?? []).map((row) => row.message).join(" ") }) };
    if (code === "ASSISTANT_PLAN_VERSION_CONFLICT") return { code, text: w("conflict") };
    if (code === "AGENT_BUSY") return { code, text: w("busy") };
    if (code === "VALIDATION_ERROR" && body.error?.message) return { code, text: body.error.message };
    return { code, text: w("failed") };
  } catch {
    return { code: null, text: w("failed") };
  }
}

/* ------------------------------------------------------------ the composer */

export function TradePlanComposer({ locale, mint, symbol, prices, onCancel }: { locale: WorkspaceLocale; mint: string | null; symbol: string | null; prices: AssistantPlansResponse["prices"] | null; onCancel: () => void }) {
  const w = tradePlanWordsFor(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const [token, setToken] = useState<Readonly<{ mint: string; symbol: string }> | null>(mint ? { mint, symbol: symbol ?? mint.slice(0, 4) } : null);
  const [pasted, setPasted] = useState("");
  const [idea, setIdea] = useState("");
  const [risk, setRisk] = useState("");
  const [budget, setBudget] = useState("");
  const [entry, setEntry] = useState("");
  const [invalidation, setInvalidation] = useState("");
  const [targets, setTargets] = useState("");
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Readonly<{ code: string | null; text: string }> | null>(null);
  /* The price is the server's: until it is read, the press waits. */
  const cost = prices?.plan ?? null;
  const chosen = token ?? (MINT.test(pasted.trim()) ? { mint: pasted.trim(), symbol: `${pasted.trim().slice(0, 4)}…` } : null);
  const ready = cost !== null && chosen !== null && idea.trim().length > 0 && (numberOf(risk, locale) !== null || numberOf(budget, locale) !== null);

  const submit = async () => {
    if (!ready || busy || !chosen || cost === null) return;
    setBusy(true);
    setFailed(null);
    try {
      /* A comma is a decimal in Ukrainian («212,50»): targets are apart by a space or a semicolon. */
      const targetsUsd = targets
        .split(/[;\s]+/)
        .map((value) => numberOf(value, locale))
        .filter((value): value is number => value !== null)
        .slice(0, 3);
      const response = await fetch(`/api/v1/assistant/plans`, {
        method: "POST",
        headers: HEADERS,
        credentials: "same-origin",
        body: JSON.stringify({ mint: chosen.mint, idea: idea.trim(), riskUsd: numberOf(risk, locale), budgetUsd: numberOf(budget, locale), entryUsd: numberOf(entry, locale), invalidationUsd: numberOf(invalidation, locale), targetsUsd, horizonDays: numberOf(days, locale) !== null ? Math.round(numberOf(days, locale)!) : null, acceptCredits: cost, locale: lang }),
      });
      if (!response.ok) {
        setFailed(await failureText(response, w));
        return;
      }
      const body = (await response.json()) as AssistantPlanResponse;
      /* What it cost travels to the plan's page, so the person sees what was taken — the plan's part alone when the critic did not answer. */
      const spent = body.spent ? `?spent=${body.spent.credits}${body.spent.critic === "rules" && body.spent.architect === "model" ? "&part=1" : ""}` : "";
      window.location.assign(`/app/ryn/plans/${body.plan.id}${spent}`);
    } catch {
      setFailed({ code: null, text: w("failed") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      aria-busy={busy}
    >
      <p className={styles.lead}>{w("composeLead")}</p>
      <fieldset className={styles.tokens}>
        <legend className={styles.label}>{w("token")}</legend>
        <div className={styles.chips} role="radiogroup" aria-label={w("token")}>
          {(token && !QUICK_TOKENS.some(([, m]) => m === token.mint) ? [[token.symbol, token.mint] as const, ...QUICK_TOKENS] : QUICK_TOKENS).map(([sym, m]) => (
            <button key={m} type="button" role="radio" aria-checked={token?.mint === m} className={styles.chip} onClick={() => setToken({ mint: m, symbol: sym })} translate="no">
              {sym}
            </button>
          ))}
        </div>
        <label className={styles.field} data-wide="">
          <span>{w("tokenMint")}</span>
          <input
            value={pasted}
            onChange={(event) => {
              setPasted(event.target.value);
              if (event.target.value.trim()) setToken(null);
            }}
            spellCheck={false}
            autoComplete="off"
            inputMode="text"
          />
        </label>
      </fieldset>
      <label className={styles.field} data-wide="">
        <span>{w("idea")}</span>
        <textarea value={idea} onChange={(event) => setIdea(event.target.value.slice(0, 600))} rows={3} placeholder={w("ideaHint")} />
      </label>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>{w("risk")}</span>
          <input value={risk} onChange={(event) => setRisk(event.target.value)} inputMode="decimal" />
        </label>
        <label className={styles.field}>
          <span>{w("budget")}</span>
          <input value={budget} onChange={(event) => setBudget(event.target.value)} inputMode="decimal" />
        </label>
      </div>
      <details className={styles.fold}>
        <summary>{w("levels")}</summary>
        <div className={styles.fields}>
          <label className={styles.field}>
            <span>{w("entry")}</span>
            <input value={entry} onChange={(event) => setEntry(event.target.value)} inputMode="decimal" />
          </label>
          <label className={styles.field}>
            <span>{w("invalidation")}</span>
            <input value={invalidation} onChange={(event) => setInvalidation(event.target.value)} inputMode="decimal" />
          </label>
          <label className={styles.field}>
            <span>{w("targets")}</span>
            <input value={targets} onChange={(event) => setTargets(event.target.value)} inputMode="decimal" />
          </label>
          <label className={styles.field}>
            <span>{w("days")}</span>
            <input value={days} onChange={(event) => setDays(event.target.value)} inputMode="numeric" />
          </label>
        </div>
      </details>
      <div className={styles.actions}>
        <button type="submit" className="rw-btn rw-btn--primary" disabled={!ready || busy}>
          {busy ? w("composing") : fill(w("composeButton"), { price: cost === null ? "…" : cost === 0 ? w("free") : price(cost, locale, w) })}
        </button>
        <button type="button" className="rw-btn" onClick={onCancel} disabled={busy}>
          {w("cancelEdit")}
        </button>
      </div>
      <p className={styles.muted}>{ready && cost !== null ? (cost === 0 ? w("freeLine") : fill(w("priceLine"), { price: price(cost, locale, w) })) : w("needIdea")}</p>
      <p className={styles.muted}>{w("noBuy")}</p>
      {failed ? (
        <p className={styles.failure} role="alert">
          {failed.text}{" "}
          {failed.code === "AGENT_BUDGET_EXHAUSTED" ? (
            <button type="button" className={styles.link} onClick={() => askTopUp()}>
              {w("topUp")}
            </button>
          ) : null}
        </p>
      ) : null}
    </form>
  );
}

/* ------------------------------------------------------------ one plan */

/** One plan on its own page: read, then every press answers the plan as it stands. */
export function TradePlanPage({ id, locale, spent = null }: { id: string; locale: WorkspaceLocale; /** What composing it cost, carried from the composer: `part` — the critic did not answer. */ spent?: Readonly<{ credits: number; part: boolean }> | null }) {
  const w = tradePlanWordsFor(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const [read, setRead] = useState<AssistantPlanResponse | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(spent && spent.credits > 0 ? fill(spent.part ? w("spentPart") : w("spent"), { n: creditNumber(spent.credits, locale) }) : null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/assistant/plans/${id}?locale=${lang}`, { headers: HEADERS, credentials: "same-origin" });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as AssistantPlanResponse;
  }, [id, lang]);

  useEffect(() => {
    let live = true;
    void load()
      .then((body) => live && setRead(body))
      .catch(() => live && setFailed(w("loadFailed")));
    return () => {
      live = false;
    };
  }, [load, w]);

  const call = useCallback(
    async (path: string, method: "POST" | "PUT", body: Record<string, unknown>): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      setFailed(null);
      setNote(null);
      try {
        const response = await fetch(`/api/v1/assistant/plans/${id}${path}?locale=${lang}`, { method, headers: HEADERS, credentials: "same-origin", body: JSON.stringify({ ...body, locale: lang }) });
        if (!response.ok) {
          const failure = await failureText(response, w);
          setFailed(failure.text);
          if (failure.code === "ASSISTANT_PLAN_VERSION_CONFLICT") void load().then(setRead).catch(() => undefined);
          return false;
        }
        const next = (await response.json()) as AssistantPlanResponse;
        setRead(next);
        if (next.spent && next.spent.credits > 0) setNote(fill(next.spent.critic === "model" ? w("spent") : w("spentPart"), { n: creditNumber(next.spent.credits, locale) }));
        return true;
      } catch {
        setFailed(w("failed"));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, id, lang, load, locale, w],
  );

  /*
   * AI-20: the core's action page in the middle of the canvas — the plan
   * with its critic beside it as the form's live review, a centred pair from 1420 px (`form-pair.module.css`); one column
   * until the plan is read. «Усі плани» leads to «Боти», the one home of a trade plan (UX-704).
   */
  return (
    <Page kind="action" className={read ? pair.page : pair.column} title={w("planTitle")} help={w("composeLead")} lang={lang}>
      <Link className={styles.back} href="/app/bots" prefetch={false}>
        <CaretLeft size={14} weight="bold" aria-hidden="true" />
        <span>{w("back")}</span>
      </Link>
      {read === null && failed === null ? (
        <p className={styles.muted} aria-busy="true">
          …
        </p>
      ) : null}
      {failed ? (
        <p className={styles.failure} role="alert">
          {failed}
        </p>
      ) : null}
      {note ? <p className={styles.muted}>{note}</p> : null}
      {read ? <TradePlanView plan={read.plan} prices={read.prices} locale={locale} busy={busy} call={call} /> : null}
    </Page>
  );
}

function who(by: AssistantPlanLevel["by"] | "plan-page", w: W): string {
  return by === "person" ? w("byPerson") : by === "ryntra" ? w("byRyntraWho") : by === "market" ? w("byMarket") : by === "plan-page" ? w("byPlanPage") : w("byRulesWho");
}

function LevelTag({ level, w }: { level: Pick<AssistantPlanLevel, "by">; w: W }) {
  if (level.by === "ryntra") return <span className={styles.tag}>{w("byRyntra")}</span>;
  if (level.by === "rules") return <span className={styles.tag}>{w("byRules")}</span>;
  return null;
}

function TradePlanView({ plan, prices, locale, busy, call }: { plan: AssistantPlan; prices: AssistantPlanResponse["prices"]; locale: WorkspaceLocale; busy: boolean; call: (path: string, method: "POST" | "PUT", body: Record<string, unknown>) => Promise<boolean> }) {
  const w = tradePlanWordsFor(locale);
  const body = plan.current.body;
  const critic = plan.current.critic;
  const [editing, setEditing] = useState(false);
  const shown = critic.findings.filter((row) => row.severity !== "note").slice(0, 3);
  const rest = critic.findings.filter((row) => !shown.includes(row));
  const fees = body.fees;
  const ended = plan.state === "done" || plan.state === "cancelled" || plan.state === "broken";
  const endLine = plan.state === "broken" ? w("brokenLine") : plan.state === "done" ? w("doneLine") : plan.state === "cancelled" && plan.stateReason === "expired" ? w("expiredLine") : null;

  return (
    <article className={styles.planPair} data-state={plan.state} aria-labelledby="trade-plan-title">
      <div className={styles.planMain}>
        <header className={styles.planHead}>
          <h2 id="trade-plan-title" className={styles.planTitle} translate="no">
            {plan.symbol}
          </h2>
          <StatePill state={plan.state} w={w} />
          <span className={styles.muted}>{fill(w("version"), { n: plan.version })}</span>
        </header>
        {endLine ? <p className={styles.endLine}>{endLine}</p> : null}

        {/* Two lines on a phone; the whole thesis is in «Припущення, джерела, версії». */}
        <p className={styles.thesis} title={body.thesis.text}>
          {body.thesis.text}
        </p>
        {body.thesis.whyNow ? <p className={styles.muted}>{body.thesis.whyNow}</p> : null}

        <dl className={styles.levels}>
          <div>
            <dt>{w("entryLine")}</dt>
            <dd>
              {usd(body.entry.priceUsd, locale)} <span className={styles.muted}>{fill(w("upTo"), { max: usd(body.entry.maxPriceUsd, locale) })}</span>
            </dd>
          </div>
          <div>
            <dt>{w("invalidationLine")}</dt>
            <dd>
              {usd(body.invalidation.priceUsd, locale)} <LevelTag level={body.invalidation} w={w} />
            </dd>
          </div>
          <div>
            <dt>{w("targetLine")}</dt>
            <dd>
              {body.targets.map((row) => usd(row.priceUsd, locale)).join(" · ")} <LevelTag level={body.targets[0]!} w={w} />
            </dd>
          </div>
          <div>
            <dt>{w("lossLimit")}</dt>
            <dd>{usd(body.lossLimit.riskUsd, locale)}</dd>
          </div>
          <div>
            <dt>{w("size")}</dt>
            <dd>
              <span translate="no">
                {unitsText(body.sizing.units, locale)} {plan.symbol}
              </span>{" "}
              <span className={styles.muted}>{usd(body.sizing.notionalUsd, locale)}</span>
            </dd>
          </div>
        </dl>
      </div>

      {/* The plan's live review — its fees and its critic — beside it on a wide desk, under the levels below one. */}
      <aside className={styles.planReview} aria-label={w("reviewLabel")}>
        <p className={styles.fees}>{fill(w("fees"), { total: usd(fees.totalUsd, locale), loss: usd(fees.lossAtInvalidationUsd, locale), reward: fees.rewardToRisk === null ? usd(fees.rewardAtTargetUsd, locale) : `${usd(fees.rewardAtTargetUsd, locale)} (${fill(w("ratio"), { r: fees.rewardToRisk.toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: 2 }) })})` })}</p>

        <section className={styles.critic} aria-labelledby="trade-plan-critic">
          <h3 id="trade-plan-critic" className={styles.sectionTitle}>
            {critic.by === "model" ? w("criticModel") : w("criticRules")} · <span className={styles.muted}>{criticCounts(critic.findings, w)}</span>
          </h3>
          {critic.summary ? <p className={styles.summary}>{critic.summary}</p> : null}
          {shown.length === 0 ? <p className={styles.muted}>{w("criticNone")}</p> : null}
          <ul className={styles.findings}>
            {shown.map((row) => (
              <Finding key={row.id} row={row} w={w} />
            ))}
          </ul>
          {rest.length > 0 || critic.gaps.length > 0 ? (
            <details className={styles.fold}>
              <summary>{w("details")}</summary>
              <ul className={styles.findings}>
                {rest.map((row) => (
                  <Finding key={row.id} row={row} w={w} />
                ))}
              </ul>
              {critic.gaps.length > 0 ? (
                <>
                  <p className={styles.label}>{w("gaps")}</p>
                  <ul className={styles.plain}>
                    {critic.gaps.map((gap, index) => (
                      <li key={`${index}:${gap}`}>{gap}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </details>
          ) : null}
        </section>
      </aside>

      <div className={styles.planRest}>
        {editing ? <EditLevels plan={plan} locale={locale} busy={busy} onSave={async (change) => (await call("", "PUT", { ifVersion: plan.version, ...change })) && setEditing(false)} onCancel={() => setEditing(false)} /> : null}

        {!ended && !editing ? (
          <div className={styles.actions}>
            {plan.actions.watch && plan.state !== "approved" ? (
              <button type="button" className="rw-btn rw-btn--primary" disabled={busy} onClick={() => void call("/state", "POST", { to: "watching", ifVersion: plan.version })}>
                <Eye size={14} weight="bold" aria-hidden="true" />
                <span>{w("approveWatch")}</span>
              </button>
            ) : null}
            {plan.actions.watch && plan.state === "approved" ? (
              <button type="button" className="rw-btn rw-btn--primary" disabled={busy} onClick={() => void call("/state", "POST", { to: "watching", ifVersion: plan.version })}>
                <Eye size={14} weight="bold" aria-hidden="true" />
                <span>{w("watch")}</span>
              </button>
            ) : null}
            {plan.actions.approve ? (
              <button type="button" className="rw-btn" disabled={busy} onClick={() => void call("/state", "POST", { to: "approved", ifVersion: plan.version })}>
                {w("approve")}
              </button>
            ) : null}
            {plan.actions.edit ? (
              <button type="button" className="rw-btn" disabled={busy} onClick={() => setEditing(true)}>
                {w("edit")}
              </button>
            ) : null}
            {plan.actions.recheck && prices.recheck > 0 ? (
              <button type="button" className="rw-btn" disabled={busy} onClick={() => void call("/critic", "POST", { ifVersion: plan.version, acceptCredits: prices.recheck })}>
                {fill(w("recheck"), { price: fill(w("credits"), { n: creditNumber(prices.recheck, locale) }) })}
              </button>
            ) : null}
            {plan.actions.cancel ? (
              <button type="button" className={`rw-btn ${styles.quiet}`} disabled={busy} onClick={() => void call("/state", "POST", { to: "cancelled", ifVersion: plan.version })}>
                {w("cancel")}
              </button>
            ) : null}
          </div>
        ) : null}

        {plan.tradingPlan ? (
          <div className={styles.approved}>
            <p className={styles.muted}>{plan.state === "watching" ? w("watching") : w("approvedNote")}</p>
            {plan.watch.line ? <p className={styles.muted}>{fill(w("watchLine"), { line: plan.watch.line })}</p> : null}
            <Link className={styles.openPlan} href={plan.tradingPlan.href} prefetch={false}>
              <span>{w("openPlan")}</span>
              <ArrowRight size={14} weight="bold" aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <p className={styles.muted}>{w("noBuy")}</p>
        )}

        {plan.reality ? <Reality reality={plan.reality} w={w} /> : null}

        <details className={styles.fold}>
          <summary>{w("more")}</summary>
          <p className={styles.label}>{w("thesis")}</p>
          <p className={styles.plainText}>{body.thesis.text}</p>
          <p className={styles.label}>{w("assumptions")}</p>
          <ul className={styles.plain}>
            {body.assumptions.map((row, index) => (
              <li key={`${index}:${row.text}`}>
                {row.text} <span className={styles.muted}>— {who(row.by, w)}</span>
              </li>
            ))}
          </ul>
          <p className={styles.label}>{w("sources")}</p>
          <ul className={styles.plain}>
            {body.sources.map((source) => (
              <li key={source.id}>
                {source.source} · <span className={styles.mono}>{source.observedAt.slice(0, 16).replace("T", " ")} UTC</span>
              </li>
            ))}
          </ul>
          <p className={styles.label}>{w("versions")}</p>
          <ul className={styles.plain}>
            {plan.versions.map((row) => (
              <li key={row.n}>
                {fill(w("version"), { n: row.n })} · {who(row.by, w)} · <span className={styles.mono}>{row.createdAt.slice(0, 16).replace("T", " ")} UTC</span>
                {row.reason ? ` · ${row.reason}` : ""}
              </li>
            ))}
          </ul>
          <p className={styles.label}>{w("journal")}</p>
          <ul className={styles.plain}>
            {plan.journal.map((row, index) => (
              <li key={`${row.at}:${index}`}>
                <span className={styles.mono}>{row.at.slice(0, 16).replace("T", " ")}</span> · {w(`ev_${row.event}` as TradePlanWord)} · {fill(w("version"), { n: row.version })}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </article>
  );
}

function Finding({ row, w }: { row: AssistantPlanFinding; w: W }) {
  return (
    <li className={styles.finding} data-severity={row.severity}>
      <span className={styles.severity}>{w(row.severity)}</span>
      <span>{row.text}</span>
    </li>
  );
}

function Reality({ reality, w }: { reality: NonNullable<AssistantPlan["reality"]>; w: W }) {
  return (
    <section className={styles.reality} aria-labelledby="trade-plan-reality">
      <h3 id="trade-plan-reality" className={styles.sectionTitle}>
        {w("reality")}
      </h3>
      {reality.summary.map((line) => (
        <p key={line} className={styles.summary}>
          {line}
        </p>
      ))}
      {reality.trades.map((trade) => (
        <div key={trade.signature} className={styles.trade} data-verdict={trade.verdict}>
          <p className={styles.label}>{w("receipt")}</p>
          {trade.receipt.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {trade.risk.length > 0 ? <p className={styles.label}>{w("riskNow")}</p> : null}
          {trade.risk.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ))}
    </section>
  );
}

function EditLevels({ plan, locale, busy, onSave, onCancel }: { plan: AssistantPlan; locale: WorkspaceLocale; busy: boolean; onSave: (change: Record<string, unknown>) => void; onCancel: () => void }) {
  const w = tradePlanWordsFor(locale);
  const body = plan.current.body;
  const [entry, setEntry] = useState(String(body.entry.priceUsd));
  const [invalidation, setInvalidation] = useState(String(body.invalidation.priceUsd));
  const [targets, setTargets] = useState(body.targets.map((row) => String(row.priceUsd)).join(" "));
  const [risk, setRisk] = useState(String(body.lossLimit.riskUsd));
  const save = () => {
    const change: Record<string, unknown> = {};
    const e = numberOf(entry, locale);
    const i = numberOf(invalidation, locale);
    const r = numberOf(risk, locale);
    const t = targets
      .split(/[;\s]+/)
      .map((value) => numberOf(value, locale))
      .filter((value): value is number => value !== null)
      .slice(0, 3);
    if (e !== null && e !== body.entry.priceUsd) change.entryUsd = e;
    if (i !== null && i !== body.invalidation.priceUsd) change.invalidationUsd = i;
    if (r !== null && r !== body.lossLimit.riskUsd) change.riskUsd = r;
    if (t.length > 0 && t.join() !== body.targets.map((row) => row.priceUsd).join()) change.targetsUsd = t;
    if (Object.keys(change).length > 0) onSave(change);
    else onCancel();
  };
  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>{w("entry")}</span>
          <input value={entry} onChange={(event) => setEntry(event.target.value)} inputMode="decimal" />
        </label>
        <label className={styles.field}>
          <span>{w("invalidation")}</span>
          <input value={invalidation} onChange={(event) => setInvalidation(event.target.value)} inputMode="decimal" />
        </label>
        <label className={styles.field}>
          <span>{w("targets")}</span>
          <input value={targets} onChange={(event) => setTargets(event.target.value)} inputMode="decimal" />
        </label>
        <label className={styles.field}>
          <span>{w("risk")}</span>
          <input value={risk} onChange={(event) => setRisk(event.target.value)} inputMode="decimal" />
        </label>
      </div>
      <div className={styles.actions}>
        <button type="submit" className="rw-btn rw-btn--primary" disabled={busy}>
          {w("save")}
        </button>
        <button type="button" className="rw-btn" onClick={onCancel} disabled={busy}>
          {w("cancelEdit")}
        </button>
      </div>
    </form>
  );
}
