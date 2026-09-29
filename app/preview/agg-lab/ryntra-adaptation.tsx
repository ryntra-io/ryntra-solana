"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { AggClient, CorrelatedMarketCascadeItem, CorrelatedMarketSignal, SmartRouteResponse, VenueEventWithMarkets, VenueMarket } from "@agg-build/sdk";
import { useAggAuthContext, useCategories, useMidpoints, useVenueEvents } from "@agg-build/hooks";
import { AggProvider } from "@agg-build/ui";
import { EventMarketPage } from "@agg-build/ui/pages";

import { useLab } from "./lab-context";
import styles from "./adaptation.module.css";
import shell from "./lab.module.css";
import "./agg-ryntra-theme.css";

/*
 * Tab 3 — the same aggregator data in Ryntra's frame: Market → Research →
 * Plan → Review. A small preview for the visual comparison the Owner asked
 * for, not an integration: nothing here enters lib/, the rail or the product
 * pages, and there is no execution control — the Review ends where Ryntra's
 * own Review would hand over to the wallet, and says so.
 *
 * The comparison view at the bottom mounts the aggregator's EventMarketPage a
 * second time under Ryntra's tokens (agg-ryntra-theme.css), so the Owner can
 * see their component in our colours next to our own composition of the data.
 */

type Step = "market" | "research" | "plan" | "review";

const CATEGORIES = ["crypto", "politics", "finance", "sports", "world", "entertainment"] as const;

const usd = (value: number | null | undefined, digits = 0) =>
  value == null || Number.isNaN(value) ? "—" : `$${value.toLocaleString("en-US", { maximumFractionDigits: digits })}`;
const cents = (price: number | null | undefined) => (price == null ? "—" : `${(price * 100).toFixed(1)}¢`);

export function RyntraAdaptationTab({ client }: { client: AggClient }) {
  const { selection, setSelection, theme } = useLab();
  const [step, setStep] = useState<Step>(selection.eventId ? "research" : "market");
  const [category, setCategory] = useState<string>("crypto");
  const [plan, setPlan] = useState({ budget: "10", maxPrice: "", invalidation: "", thesis: "" });

  /* The API filters by category id (a cuid); the chip shows the slug. */
  const categories = useCategories({ limit: 100 });
  const categoryId = (categories.categories ?? []).find((c) => c.name === category)?.id ?? null;
  const events = useVenueEvents({
    status: ["open"] as never,
    categoryIds: categoryId ? [categoryId] : undefined,
    sortBy: "volume24hr",
    sortDir: "desc",
    limit: 12,
    queryKeyScope: "ryntra-adaptation",
    enabled: Boolean(categoryId),
  });

  /* The list carries no outcome prices; the live midpoints of each event's
     first market come from the same batch call their Home uses. */
  const firstMarkets = useMemo(
    () => (events.events ?? []).map((event) => event.venueMarkets?.[0]).filter((m): m is VenueMarket => Boolean(m)),
    [events.events],
  );
  const midpoints = useMidpoints(firstMarkets);

  const canResearch = Boolean(selection.eventId);
  const canPlan = Boolean(selection.outcomeId);

  return (
    <>
      <p className={shell.note}>
        <span>
          <strong>Ryntra-адаптація:</strong> ті самі дані AGG (події, ціни по майданчиках, книга, сигнали, маршрут) у нашій
          композиції та токенах. Без виконання — Review закінчується там, де в Ryntra починається підпис.
        </span>
      </p>
      <div className={styles.wrap}>
        <ol className={styles.steps} aria-label="Кроки">
          {(
            [
              ["market", "Ринок", true],
              ["research", "Дослідження", canResearch],
              ["plan", "План", canPlan],
              ["review", "Review", canPlan],
            ] as const
          ).map(([id, label, enabled], index) => (
            <li key={id}>
              <button
                type="button"
                className={`${styles.stepBtn} ${step === id ? styles.stepOn : ""}`}
                aria-current={step === id ? "step" : undefined}
                disabled={!enabled}
                onClick={() => setStep(id)}
              >
                <span className={styles.stepNo}>{index + 1}</span>
                {label}
              </button>
            </li>
          ))}
        </ol>

        {step === "market" ? (
          <>
            <div className={styles.head}>
              <h2 className={styles.h2}>Ринки прогнозів</h2>
              <div className={styles.chips} role="group" aria-label="Категорія">
                {CATEGORIES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`${styles.chip} ${category === item ? styles.chipOn : ""}`}
                    aria-pressed={category === item}
                    onClick={() => setCategory(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <p className={styles.lead}>
              Одна подія — одна картка, ціна з майданчика-якоря і перелік майданчиків, де вона торгується. Обсяг —
              сумарний по кластеру, як його рахує AGG.
            </p>
            {events.isLoading || (!categoryId && !categories.isError) ? <p className={styles.muted}>Читаю події…</p> : null}
            {events.isError ? <p className={styles.error}>Не вдалося прочитати події: {events.error?.message}</p> : null}
            <div className={styles.list}>
              {(events.events ?? []).map((event) => {
                const first = event.venueMarkets?.[0];
                const yes = first?.venueMarketOutcomes.find((o) => /^yes$/i.test(o.label)) ?? first?.venueMarketOutcomes[0];
                return (
                  <button
                    key={event.id}
                    type="button"
                    className={styles.row}
                    onClick={() => {
                      setSelection({ eventId: event.id, marketId: first?.id ?? null, outcomeId: yes?.id ?? null });
                      setStep("research");
                    }}
                  >
                    {event.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className={styles.thumb} src={event.image} alt="" />
                    ) : (
                      <span className={styles.thumb} />
                    )}
                    <span className={styles.rowBody}>
                      <span className={styles.rowTitle}>{event.title}</span>
                      <span className={styles.rowMeta}>
                        {(event.venues ?? [event.venue]).map((venue) => (
                          <span key={venue} className={styles.venue}>
                            {venue}
                          </span>
                        ))}
                        <span>{event.venueMarkets?.length ?? event.marketCount ?? 0} ринків</span>
                        {event.endDate ? <span>до {event.endDate.slice(0, 10)}</span> : null}
                      </span>
                    </span>
                    <span className={styles.price}>
                      {cents(yes ? (midpoints.prices.get(yes.id) ?? yes.price) : null)}
                      <span className={styles.priceSub}>{yes ? `${yes.label} · ${first?.venue ?? ""}` : "ціна пізніше"}</span>
                    </span>
                    <span className={styles.volume}>{usd(event.volume)}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        {step === "research" && selection.eventId ? (
          <Research
            client={client}
            eventId={selection.eventId}
            marketId={selection.marketId}
            outcomeId={selection.outcomeId}
            onPick={(marketId, outcomeId) => setSelection((current) => ({ ...current, marketId, outcomeId }))}
            onPlan={() => setStep("plan")}
          />
        ) : null}

        {step === "plan" && selection.outcomeId ? (
          <PlanForm
            client={client}
            marketId={selection.marketId}
            outcomeId={selection.outcomeId}
            plan={plan}
            onChange={setPlan}
            onReview={() => setStep("review")}
          />
        ) : null}

        {step === "review" && selection.outcomeId ? (
          <Review client={client} outcomeId={selection.outcomeId} marketId={selection.marketId} plan={plan} onBack={() => setStep("plan")} />
        ) : null}

        {selection.eventId ? (
          <details className={styles.card}>
            <summary className={styles.cardTitle} style={{ cursor: "pointer" }}>
              Порівняння: їхній EventMarketPage у токенах Ryntra
            </summary>
            <p className={styles.muted}>
              Той самий компонент AGG, що на вкладці 1, змонтований під темою Ryntra через їхні CSS-змінні (без правок
              компонента). Показує, що можна «затемізувати як є», а що лишається їхнім за структурою.
            </p>
            <div className={styles.compare}>
              <AggProvider
                client={client}
                config={{ general: { theme, rootClassName: "ryntra-agg-theme" }, trading: { executionMode: "paper" }, features: { enableNotifications: false } }}
              >
                <EventMarketPage
                  key={`themed-${selection.eventId}`}
                  eventId={selection.eventId}
                  defaultMarketId={selection.marketId ?? undefined}
                  defaultOutcomeId={selection.outcomeId ?? undefined}
                  showPlaceOrder
                />
              </AggProvider>
            </div>
          </details>
        ) : null}
      </div>
    </>
  );
}

/* ---- research ------------------------------------------------------------ */

type ResearchData = {
  event: VenueEventWithMarkets;
  markets: VenueMarket[];
  signals: CorrelatedMarketSignal[] | null;
  signalsNote: string | null;
  related: CorrelatedMarketCascadeItem[];
  book: { venue: string; bid: number | null; ask: number | null }[];
};

function Research({
  client,
  eventId,
  marketId,
  outcomeId,
  onPick,
  onPlan,
}: {
  client: AggClient;
  eventId: string;
  marketId: string | null;
  outcomeId: string | null;
  onPick: (marketId: string, outcomeId: string) => void;
  onPlan: () => void;
}) {
  const [data, setData] = useState<ResearchData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Outcome prices come from the live midpoints, as on their own pages. */
  const midpoints = useMidpoints(data?.markets ?? null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const event = (await client.getVenueEventById(eventId)) as VenueEventWithMarkets;
        const markets = (await client.getVenueMarkets({ venueEventId: eventId, limit: 30 })).data ?? [];
        const anchor = markets.find((m) => m.id === marketId) ?? markets[0];
        let signals: CorrelatedMarketSignal[] | null = null;
        let signalsNote: string | null = null;
        let related: CorrelatedMarketCascadeItem[] = [];
        let book: ResearchData["book"] = [];
        if (anchor) {
          const [sig, cas, ob] = await Promise.allSettled([
            client.getMarketCorrelatedSignals(anchor.id),
            client.getCorrelatedMarketCascade({ venueMarketId: anchor.id, mode: "expand", limit: 6 }),
            client.getOrderbooks({ venueMarketIds: [anchor.id], depth: 1 }),
          ]);
          if (sig.status === "fulfilled") signals = sig.value.signals;
          else signalsNote = "AGG ще не згенерував сигнали для цього ринку (404 від їхнього API).";
          if (cas.status === "fulfilled") related = cas.value.data ?? [];
          if (ob.status === "fulfilled") {
            const item = ob.value.data?.[0];
            book = Object.entries(item?.venueOrderbooks ?? {}).map(([venue, entry]) => ({
              venue,
              bid: entry.orderbook.bids[0]?.price ?? null,
              ask: entry.orderbook.asks[0]?.price ?? null,
            }));
          }
        }
        if (!cancelled) setData({ event, markets, signals, signalsNote, related, book });
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, eventId, marketId]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.muted}>Збираю дослідження з AGG: подія, ринки, книга, сигнали, пов&apos;язані події…</p>;

  const anchor = data.markets.find((m) => m.id === marketId) ?? data.markets[0];

  return (
    <>
      <div className={styles.head}>
        <h2 className={styles.h2}>{data.event.title}</h2>
        <span className={styles.volume}>{usd(data.event.volume)} обсяг · {(data.event.venues ?? []).length} майданчики</span>
      </div>
      <div className={styles.grid}>
        <section className={styles.card}>
          <p className={styles.cardKicker}>Що оцінює ринок</p>
          <h3 className={styles.cardTitle}>Ринки й наслідки</h3>
          <p className={styles.muted}>Ціна наслідку — жива середина книги (midpoint) з AGG. Обери наслідок, на який будуєш план.</p>
          {data.markets.slice(0, 12).map((market) => (
            <div key={market.id} className={styles.market}>
              <p className={styles.marketQ}>
                <span className={styles.venue}>{market.venue}</span> {market.question}
              </p>
              <div className={styles.outcomes}>
                {market.venueMarketOutcomes.map((outcome) => (
                  <button
                    key={outcome.id}
                    type="button"
                    className={`${styles.outcome} ${outcome.id === outcomeId ? styles.outcomeOn : ""}`}
                    aria-pressed={outcome.id === outcomeId}
                    onClick={() => onPick(market.id, outcome.id)}
                  >
                    {outcome.label} <b>{cents(midpoints.prices.get(outcome.id) ?? outcome.price)}</b>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
        <section className={styles.card}>
          <p className={styles.cardKicker}>Книга по майданчиках</p>
          <h3 className={styles.cardTitle}>{anchor ? anchor.question : "—"}</h3>
          {data.book.length ? (
            <dl className={styles.dl}>
              {data.book.map((row) => (
                <div key={row.venue}>
                  <dt>{row.venue}</dt>
                  <dd>
                    {cents(row.bid)} / {cents(row.ask)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className={styles.muted}>Книги для цього ринку зараз немає.</p>
          )}
          <p className={styles.muted}>bid / ask, найкращий рівень з живої книги AGG на момент читання.</p>
        </section>
        <section className={styles.card}>
          <p className={styles.cardKicker}>Сигнали AGG</p>
          <h3 className={styles.cardTitle}>Що стане імовірнішим</h3>
          {data.signals?.length ? (
            data.signals.slice(0, 8).map((signal) => (
              <div key={signal.id} className={styles.signal}>
                <span className={`${styles.dir} ${signal.direction === "more_likely" ? styles.dirUp : styles.dirDown}`}>
                  {signal.side} · {signal.direction === "more_likely" ? "↑" : "↓"}
                </span>
                <span>
                  {signal.text} <span className={styles.venue}>{signal.domain}</span>
                </span>
              </div>
            ))
          ) : (
            <p className={styles.muted}>{data.signalsNote ?? "Сигналів немає."}</p>
          )}
          <p className={styles.muted}>Згенеровано моделлю AGG; це не оцінка Ryntra і не порада.</p>
        </section>
        <section className={styles.card}>
          <p className={styles.cardKicker}>Пов&apos;язані події</p>
          <h3 className={styles.cardTitle}>Куди тягне цей ринок</h3>
          {data.related.length ? (
            data.related.map((item) => (
              <div key={item.venueEventId} className={styles.signal}>
                <span className={styles.dir}>{item.score.toFixed(2)}</span>
                <span>
                  <strong>{item.eventTitle}</strong> — {item.reason}
                </span>
              </div>
            ))
          ) : (
            <p className={styles.muted}>Пов&apos;язаних подій AGG не повернув.</p>
          )}
        </section>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={!outcomeId} onClick={onPlan}>
          Побудувати план на обраний наслідок
        </button>
      </div>
    </>
  );
}

/* ---- plan ---------------------------------------------------------------- */

type PlanDraft = { budget: string; maxPrice: string; invalidation: string; thesis: string };

function PlanForm({
  client,
  marketId,
  outcomeId,
  plan,
  onChange,
  onReview,
}: {
  client: AggClient;
  marketId: string | null;
  outcomeId: string;
  plan: PlanDraft;
  onChange: (next: PlanDraft) => void;
  onReview: () => void;
}) {
  const [label, setLabel] = useState<string>("");
  useEffect(() => {
    if (!marketId) return;
    let cancelled = false;
    client
      .getOrderbooks({ venueMarketIds: [marketId], depth: 1 })
      .then((result) => {
        if (cancelled) return;
        const q = result.data?.[0]?.requestedMarket?.venue ?? "";
        setLabel(q);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, marketId]);

  return (
    <section className={styles.card}>
      <p className={styles.cardKicker}>План</p>
      <h2 className={styles.h2}>Теза → правила → перевірка</h2>
      <p className={styles.muted}>
        Як у Trading Plan Ryntra: спершу теза й правила, потім Review на свіжому котируванні. Наслідок{" "}
        <span className={styles.venue}>{outcomeId.slice(0, 8)}…</span>
        {label ? ` (майданчик-якір ${label})` : ""}.
      </p>
      <div className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="plan-budget">Бюджет, $ (paper)</label>
          <input id="plan-budget" type="number" min="1" step="1" inputMode="decimal" value={plan.budget} onChange={(e) => onChange({ ...plan, budget: e.target.value })} />
        </div>
        <div className={styles.field}>
          <label htmlFor="plan-max">Максимальна середня ціна, ¢</label>
          <input id="plan-max" type="number" min="1" max="99" step="1" inputMode="decimal" placeholder="напр. 60" value={plan.maxPrice} onChange={(e) => onChange({ ...plan, maxPrice: e.target.value })} />
        </div>
        <div className={styles.field} style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="plan-thesis">Теза (навіщо ця позиція)</label>
          <textarea id="plan-thesis" value={plan.thesis} onChange={(e) => onChange({ ...plan, thesis: e.target.value })} placeholder="Що має статися, щоб наслідок вирішився на мою користь, і на чому це ґрунтується" />
        </div>
        <div className={styles.field} style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="plan-inv">Інвалідація (коли план неправильний)</label>
          <input id="plan-inv" type="text" value={plan.invalidation} onChange={(e) => onChange({ ...plan, invalidation: e.target.value })} placeholder="напр. ціна Yes нижче 40¢ або новина, що заперечує тезу" />
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onReview} disabled={!(Number(plan.budget) > 0)}>
          До Review
        </button>
      </div>
    </section>
  );
}

/* ---- review -------------------------------------------------------------- */

function Review({
  client,
  outcomeId,
  marketId,
  plan,
  onBack,
}: {
  client: AggClient;
  outcomeId: string;
  marketId: string | null;
  plan: PlanDraft;
  onBack: () => void;
}) {
  const auth = useAggAuthContext();
  const [quote, setQuote] = useState<SmartRouteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await client.getSmartRoute({ venueMarketOutcomeId: outcomeId, tradeSide: "buy", maxSpend: Number(plan.budget) || 1, mode: "paper", compareVenues: true });
      setQuote(next);
      setAt(new Date());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [client, outcomeId, plan.budget]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const avg = useMemo(() => {
    if (!quote?.fills?.length || !quote.totalFilled) return null;
    return quote.rawExecCost / quote.totalFilled;
  }, [quote]);
  const maxPrice = Number(plan.maxPrice) > 0 ? Number(plan.maxPrice) / 100 : null;
  const checks: { ok: "ok" | "warn" | "no"; text: string }[] = [];
  if (quote) {
    checks.push({ ok: quote.status === "ok" || quote.status === ("success" as never) ? "ok" : "warn", text: `Маршрут: ${quote.status}${quote.message ? ` — ${quote.message}` : ""}` });
    checks.push({
      ok: maxPrice == null ? "warn" : avg != null && avg <= maxPrice ? "ok" : "no",
      text: maxPrice == null ? "Максимальну ціну не задано — правило не перевіряється" : `Середня ${cents(avg)} ${avg != null && avg <= maxPrice ? "≤" : ">"} ліміту ${cents(maxPrice)}`,
    });
    checks.push({ ok: plan.thesis.trim() ? "ok" : "warn", text: plan.thesis.trim() ? "Теза записана" : "Тези немає — план без пояснення" });
    checks.push({ ok: plan.invalidation.trim() ? "ok" : "warn", text: plan.invalidation.trim() ? `Інвалідація: ${plan.invalidation.trim()}` : "Правило інвалідації не задано" });
    checks.push({ ok: "ok", text: `Режим: paper — жоден майданчик не отримує ордера; live для цього застосунку заборонений на рівні AGG` });
    checks.push({ ok: auth.isAuthenticated ? "ok" : "warn", text: auth.isAuthenticated ? "Котирування прив'язане до paper-рахунку користувача" : "Без входу AGG котирування — лише попередній перегляд (без quoteId для виконання)" });
  }

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <div>
          <p className={styles.cardKicker}>Review</p>
          <h2 className={styles.h2}>Свіже котирування перед рішенням</h2>
        </div>
        <span className={styles.volume}>{at ? `оновлено ${at.toLocaleTimeString("en-GB")}` : ""}</span>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      {quote ? (
        <>
          <dl className={styles.dl}>
            <div>
              <dt>Бюджет</dt>
              <dd>{usd(Number(plan.budget), 2)}</dd>
            </div>
            <div>
              <dt>Акцій за маршрутом</dt>
              <dd>{quote.totalFilled.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Вартість</dt>
              <dd>{usd(quote.rawExecCost, 2)}</dd>
            </div>
            <div>
              <dt>Середня ціна</dt>
              <dd>{cents(avg)}</dd>
            </div>
            <div>
              <dt>Виграш, якщо так</dt>
              <dd>{usd(quote.totalFilled, 2)}</dd>
            </div>
            <div>
              <dt>Майданчики</dt>
              <dd>{(quote.fills ?? []).map((f) => `${f.venue} ${(f.avgPrice * 100).toFixed(1)}¢`).join(", ") || "—"}</dd>
            </div>
            <div>
              <dt>Котирування діє до</dt>
              <dd>{quote.expiresAt ? quote.expiresAt.slice(11, 19) : "—"}</dd>
            </div>
            <div>
              <dt>Ринок</dt>
              <dd>{marketId ? `${marketId.slice(0, 8)}…` : "—"}</dd>
            </div>
          </dl>
          <div>
            {checks.map((check) => (
              <div key={check.text} className={styles.check}>
                <span className={`${styles.mark} ${check.ok === "ok" ? styles.markOk : check.ok === "warn" ? styles.markWarn : styles.markNo}`}>
                  {check.ok === "ok" ? "✓" : check.ok === "warn" ? "!" : "×"}
                </span>
                <span>{check.text}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className={styles.muted}>{busy ? "Питаю маршрут у AGG…" : "Котирування ще немає."}</p>
      )}
      <p className={styles.notice}>
        Тут Ryntra передала б план на підпис у гаманець. У лабораторії виконання немає навмисно: Predictions лишаються
        поза вертикаллю (канон v4.2, F7). Paper-виконання їхньою кнопкою — на вкладці 1, і крок за
        кроком — на вкладці 2.
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={() => void refresh()} disabled={busy}>
          {busy ? "Оновлюю…" : "Оновити котирування"}
        </button>
        <button type="button" className={styles.secondary} onClick={onBack}>
          Назад до плану
        </button>
      </div>
    </section>
  );
}
