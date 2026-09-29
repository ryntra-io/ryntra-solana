"use client";

import { useCallback, useEffect, useState } from "react";

import { LOGIN_KIND_LABEL, PRODUCT_EVENT_LABEL } from "@/lib/admin/activity";
import type { InsightsModel } from "@/lib/admin/insights";

import styles from "../admin.module.css";
import ext from "../panels.module.css";
import biz from "./analytics.module.css";
import { BusinessPanel } from "./business-panel";
import { AgentPanel } from "./agent-panel";
import { EvidencePanel } from "./evidence-panel";
import { OperationsPanel } from "./operations-panel";
import { formatDate } from "../format";
import { MetricDefinitions, PlainStat } from "../stat";

/**
 * Analytics, in two layers.
 *
 * The business dashboard is the page: wallets, trades, volume, fees, rewards,
 * the funnel and the live feed, from the product's own ledgers. The three
 * traffic sources — first-party site clicks, GA4 and Search Console — are the
 * older, separate truths and sit below in one disclosure. They are never
 * merged with each other or with the business figures: a click is not a
 * person, an unconfigured Google is not a zero, and a product event is not a
 * trade.
 */

function statusCopy(status: InsightsModel["ga4"]["status"]): string {
  if (status === "measured") return "виміряно";
  if (status === "unknown") return "немає даних";
  return "не підключено";
}

const SITE_EVENT_LABEL: Record<string, string> = {
  telegram_cta_click: "CTA бота",
  workspace_cta_click: "CTA кабінету",
  arcus_link_click: "посилання Arcus",
};

function TrafficSources() {
  const [model, setModel] = useState<InsightsModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/analytics");
    if (!r.ok) {
      setModel(null);
      setError(r.status === 401 ? "Сесія адміністратора закінчилась." : `Код ${r.status}`);
      return;
    }
    const json = (await r.json()) as { insights: InsightsModel };
    setModel(json.insights);
    setError(null);
  }, []);

  /* Read only once the disclosure opens: the sources are historical context,
     and the page should not pay for them on every visit. */
  useEffect(() => {
    if (opened && !model && !error) void load();
  }, [opened, model, error, load]);

  const product = model?.firstParty.product;

  return (
    <details className={biz.sources} onToggle={(event) => setOpened((event.target as HTMLDetailsElement).open)}>
      <summary className={biz.sourcesSummary}>Джерела трафіку: сайт · GA4 · Search Console</summary>
      <div className={biz.sourcesBody}>
        <p className={biz.kpiNote}>
          Три різні правди, їх не зводять в одну цифру. Порожнє Google — це «не підключено», не нуль відвідувачів.
          Кліки на сайті — анонімні події, не люди; дії в продукті — дозволені дії акаунтів, без сум і адрес.
        </p>

        {error ? (
          <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
            {error}
            <button type="button" className={styles.btn} onClick={() => void load()}>Спробувати ще раз</button>
          </div>
        ) : null}

        {opened && !model && !error ? (
          <div className={styles.skeleton} aria-busy="true" aria-label="Завантаження джерел">
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
          </div>
        ) : null}

        {model ? (
          <div className={styles.grid}>
            <section className={`${styles.card} ${styles.cardHalf}`}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>Сайт (first-party, 14 днів)</h2>
                <span className={styles.cardNote}>{statusCopy(model.firstParty.status)}</span>
              </div>
              <div className={styles.stats}>
                {model.firstParty.events.map((event) => (
                  <PlainStat key={event.name} value={event.count} label={SITE_EVENT_LABEL[event.name] ?? event.name} />
                ))}
              </div>
              <MetricDefinitions ids={["site_cta_14d", "site_workspace_cta_14d"]} />
            </section>

            <section className={`${styles.card} ${styles.cardHalf}`}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>Продукт (дії акаунтів, 30 днів)</h2>
                <span className={`${ext.chip} ${product?.status === "measured" ? ext.chipOk : product?.status === "unavailable" ? ext.chipRisk : ext.chipMuted}`}>
                  {product?.status === "measured" ? `збирається${product.since ? ` з ${formatDate(product.since)}` : ""}` : product?.status === "unavailable" ? "сховище не відповіло" : "ще не збирається"}
                </span>
              </div>
              {product?.status === "measured" ? (
                <>
                  <div className={styles.stats}>
                    <PlainStat value={product.logins30d} label="входи, 30 дн" />
                    {Object.entries(product.loginsByKind30d).map(([kind, count]) => (
                      <PlainStat key={kind} value={count} label={`входи · ${LOGIN_KIND_LABEL[kind as keyof typeof LOGIN_KIND_LABEL] ?? kind}`} />
                    ))}
                    <PlainStat value={product.anonymousOk30d} label="анонімні звернення, 30 дн" />
                  </div>
                  {product.events.length > 0 ? (
                    <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Дії за 30 днів">
                      <table className={styles.table}>
                        <caption>Дії за 30 днів · події, не люди</caption>
                        <thead>
                          <tr>
                            <th scope="col">Дія</th>
                            <th scope="col">Подій</th>
                          </tr>
                        </thead>
                        <tbody>
                          {product.events.map((row) => (
                            <tr key={row.name}>
                              <td>{(PRODUCT_EVENT_LABEL as Record<string, string>)[row.name] ?? row.name}</td>
                              <td className={styles.cellNum}>{row.count ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className={ext.emptyLine}>Дозволених дій за 30 днів ще не записано.</p>
                  )}
                </>
              ) : (
                <p className={ext.emptyLine}>
                  {product?.status === "unavailable"
                    ? "Сховище активності не відповіло."
                    : "Дії акаунтів з'являться після застосування сховища активності."}
                </p>
              )}
              <MetricDefinitions ids={["product_events_30d", "logins_30d"]} />
            </section>

            <section className={`${styles.card} ${styles.cardHalf}`}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>GA4</h2>
                <span className={styles.cardNote}>{statusCopy(model.ga4.status)}</span>
              </div>
              <p className={styles.laterCopy}>
                {model.ga4.status === "unconfigured"
                  ? "Серверні облікові дані відсутні. Це не нуль відвідувачів."
                  : "Облікові дані є, живого читання ще немає."}
              </p>
            </section>

            <section className={`${styles.card} ${styles.cardHalf}`}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>Search Console</h2>
                <span className={styles.cardNote}>{statusCopy(model.searchConsole.status)}</span>
              </div>
              <p className={styles.laterCopy}>
                {model.searchConsole.status === "unconfigured"
                  ? "Domain property не підключена з сервера. Це не нуль запитів."
                  : "Облікові дані є, живого читання ще немає."}
              </p>
            </section>
          </div>
        ) : null}
      </div>
    </details>
  );
}

export function AnalyticsPanel() {
  return (
    <div>
      <BusinessPanel />
      <OperationsPanel />
      {/* The evidence layer's spend, reconciled with the provider's dashboard (RYN-NANSEN-EVIDENCE-001). */}
      <div className={styles.grid}>
        <EvidencePanel />
        {/* Ryn's spend and the boundary said as a fact (RYN-AGENT-TEXT-001). */}
        <AgentPanel />
      </div>
      <TrafficSources />
    </div>
  );
}
