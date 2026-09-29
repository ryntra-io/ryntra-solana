"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle } from "@phosphor-icons/react";

import { InfoControl } from "@/app/shell/info-control";
import type { OverviewModel } from "@/lib/admin/overview";
import { PROVIDER_STATE_LABEL } from "@/lib/admin/operations";

import styles from "./admin.module.css";
import ext from "./panels.module.css";
import { formatDate, formatTime } from "./format";
import { MetricDefinitions, Stat } from "./stat";

const SERVICE_TONE: Record<OverviewModel["services"][number]["state"], string> = {
  HEALTHY: ext.chipOk,
  DEGRADED: ext.chipWarn,
  UNAVAILABLE: ext.chipRisk,
  UNKNOWN: ext.chipWarn,
  UNCONFIGURED: ext.chipMuted,
};

const ATTENTION_TONE = { ok: ext.chipOk, warn: ext.chipWarn, risk: ext.chipRisk, muted: ext.chipMuted } as const;

function Coverage({ model }: { model: OverviewModel }) {
  const { coverage } = model;
  if (coverage.activity === "measured") {
    return (
      <span className={`${ext.chip} ${ext.chipOk}`}>
        входи і дії збираються{coverage.loginsSince ? ` з ${formatDate(coverage.loginsSince)}` : ""}
      </span>
    );
  }
  if (coverage.activity === "not_collected") {
    return <span className={`${ext.chip} ${ext.chipMuted}`}>входи і дії ще не збираються</span>;
  }
  return <span className={`${ext.chip} ${ext.chipRisk}`}>сховище активності не відповіло</span>;
}

function Sparkline({ rows }: { rows: OverviewModel["daily30d"] }) {
  const peak = Math.max(1, ...rows.map((row) => Math.max(row.signedIn, row.acted)));
  return (
    <div className={ext.sparkRow}>
      <div className={styles.spark} role="img" aria-label="Входили та діяли по днях за 30 днів">
        {rows.map((row) => (
          <div key={row.day} className={styles.sparkBar} title={`${row.day}: входили ${row.signedIn}, діяли ${row.acted}, помилок ${row.errors}`}>
            <div className={ext.sparkBarPair}>
              <span className={styles.sparkFill} style={{ height: `${Math.round((row.signedIn / peak) * 100)}%` }} />
              <span className={ext.sparkFillSecondary} style={{ height: `${Math.round((row.acted / peak) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className={ext.sparkLegend}>
        <span><i className={`${ext.sparkSwatch} ${ext.sparkPrimary}`} />входили</span>
        <span><i className={`${ext.sparkSwatch} ${ext.sparkSecondary}`} />діяли</span>
        <span>{rows[0]?.day} — {rows[rows.length - 1]?.day}</span>
      </div>
    </div>
  );
}

export function OverviewPanel() {
  const [model, setModel] = useState<OverviewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/overview");
      if (!r.ok) {
        setModel(null);
        setError(r.status === 401 ? "Сесія адміністратора закінчилась." : `Код ${r.status}`);
        return;
      }
      const json = (await r.json()) as { overview: OverviewModel };
      setModel(json.overview);
      setError(null);
    } catch {
      setModel(null);
      setError("Немає зв'язку із сервером.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className={styles.cardHead}>
        <h1 className={styles.pageTitle}>Огляд</h1>
        <InfoControl label="Що рахує огляд">
          <p>
            Лише виміряне. Порожня плитка каже, чому вона порожня: «немає даних», «не збирається»,
            «джерело недоступне» або «замало даних». Акаунт — це обліковий запис; гість і гаманець
            акаунтами не є. Операторські акаунти виключені з продуктових показників. Без сум і P&amp;L.
          </p>
        </InfoControl>
      </div>
      <div className={ext.meta}>
        {model ? <Coverage model={model} /> : null}
        {model ? <span>оновлено {formatTime(model.generatedAt)}</span> : null}
        <button type="button" className={`${styles.btn} ${styles.btnSm}`} disabled={loading} onClick={() => void load()}>
          {loading ? "Оновлюю…" : "Оновити"}
        </button>
      </div>

      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          <span>{error}</span>
          <button type="button" className={styles.btn} onClick={() => void load()}>
            Спробувати ще раз
          </button>
        </div>
      ) : null}

      {loading && !model ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="Завантаження огляду">
          <div className={styles.skeletonRow} />
          <div className={styles.skeletonRow} />
          <div className={styles.skeletonRow} />
        </div>
      ) : null}

      {model ? (
        <div className={styles.grid}>
          <section className={`${styles.card} ${styles.cardHalf}`} aria-labelledby="ov-attention">
            <div className={styles.cardHead}>
              <h2 id="ov-attention" className={styles.cardTitle}>Потребує уваги</h2>
              <span className={styles.cardNote}>{model.attention.length}</span>
            </div>
            {model.attention.length === 0 ? (
              <p className={ext.allClear}>
                <CheckCircle size={18} weight="bold" aria-hidden />
                Нічого термінового: звернень без відповіді немає, помилок за 7 днів немає, провайдери відповідають.
              </p>
            ) : (
              <ul className={ext.attention}>
                {model.attention.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href} className={ext.attentionLink}>
                      <span className={`${ext.chip} ${ATTENTION_TONE[item.tone]}`}><i className={ext.chipDot} aria-hidden />{item.tone === "risk" ? "ризик" : item.tone === "warn" ? "увага" : "довідка"}</span>
                      <span className={ext.attentionLabel}>{item.label}</span>
                      {typeof item.value === "number" ? <span className={ext.attentionValue}>{item.value.toLocaleString("uk-UA")}</span> : null}
                      <ArrowRight size={16} weight="bold" aria-hidden className={ext.attentionArrow} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${styles.card} ${styles.cardHalf}`} aria-labelledby="ov-services">
            <div className={styles.cardHead}>
              <h2 id="ov-services" className={styles.cardTitle}>Сервіси</h2>
              <span className={styles.cardSpacer} />
              <Link href="/admin/operations" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}>Усі проби</Link>
            </div>
            <div className={ext.filterChips}>
              {model.services.map((service) => (
                <span key={service.id} className={`${ext.chip} ${SERVICE_TONE[service.state]}`}>
                  <i className={ext.chipDot} aria-hidden />
                  {service.label}: {PROVIDER_STATE_LABEL[service.state]}
                </span>
              ))}
            </div>
            <p className={ext.subtle}>Швидка перевірка бази, бота, сховищ, скарбниці Rewards і реферального акаунта Jupiter. Solana RPC, Jupiter і Circle — у розділі Операції.</p>
          </section>

          <section className={styles.card} aria-labelledby="ov-accounts">
            <div className={styles.cardHead}>
              <h2 id="ov-accounts" className={styles.cardTitle}>Акаунти</h2>
              <span className={styles.cardSpacer} />
              <Link href="/admin/users" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}>Список</Link>
            </div>
            <div className={styles.stats}>
              <Stat cell={model.accounts.total} label="акаунти" metric="accounts_total" />
              <Stat cell={model.accounts.new7d} label="нові за 7 днів" metric="accounts_new_7d" />
              <Stat cell={model.accounts.signedIn7d} label="входили за 7 днів" metric="signed_in_7d" />
              <Stat cell={model.accounts.acted7d} label="діяли за 7 днів" metric="acted_7d" />
              <Stat cell={model.accounts.activation14d} label="активація за 14 днів" format="percent" metric="activation_14d" />
              <Stat cell={model.accounts.retentionW1} label="повернення на 2-й тиждень" format="percent" metric="retention_w1" />
              <Stat cell={model.accounts.operators} label="операторські (виключено)" metric="operators_accounts" />
            </div>
            <MetricDefinitions ids={["accounts_total", "accounts_new_7d", "signed_in_7d", "acted_7d", "activation_14d", "retention_w1", "operators_accounts"]} />
          </section>

          <section className={styles.card} aria-labelledby="ov-daily">
            <div className={styles.cardHead}>
              <h2 id="ov-daily" className={styles.cardTitle}>30 днів</h2>
              <span className={styles.cardNote}>по днях, UTC</span>
            </div>
            {model.daily30d.length > 0 ? (
              <Sparkline rows={model.daily30d} />
            ) : (
              <p className={ext.emptyLine}>
                {model.coverage.activity === "not_collected"
                  ? "Динаміка з'явиться після застосування сховища активності."
                  : "Сховище активності не відповіло — динаміка недоступна."}
                <Link href="/admin/operations#coverage" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}>Покриття</Link>
              </p>
            )}
            <MetricDefinitions ids={["daily_signed_in", "daily_acted", "daily_errors"]} />
          </section>

          <section className={`${styles.card} ${styles.cardHalf}`} aria-labelledby="ov-funnel">
            <div className={styles.cardHead}>
              <h2 id="ov-funnel" className={styles.cardTitle}>Шлях</h2>
            </div>
            <div className={styles.stats}>
              <Stat cell={model.funnel.botStarts} label="старт у боті" metric="funnel_bot_starts" />
              <Stat cell={model.funnel.accessConfirmed} label="доступ підтверджено" metric="funnel_access_confirmed" />
              <Stat cell={model.funnel.firstLogin} label="перший вхід" metric="funnel_first_login" />
              <Stat cell={model.funnel.firstAction} label="перша дія" metric="funnel_first_action" />
              <Stat cell={model.funnel.returnedW1} label="повернулись" metric="funnel_returned_w1" />
            </div>
            <MetricDefinitions ids={["funnel_bot_starts", "funnel_access_confirmed", "funnel_first_login", "funnel_first_action", "funnel_returned_w1"]} />
          </section>

          <section className={`${styles.card} ${styles.cardHalf}`} aria-labelledby="ov-support">
            <div className={styles.cardHead}>
              <h2 id="ov-support" className={styles.cardTitle}>Підтримка</h2>
              <span className={styles.cardSpacer} />
              <Link href="/admin/feedback?status=OPEN" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}>Інбокс</Link>
            </div>
            <div className={styles.stats}>
              <Stat cell={model.support.open} label="без відповіді" metric="support_open" />
              <Stat cell={model.support.waiting} label="чекають користувача" metric="support_waiting" />
              <Stat cell={model.support.oldestOpenHours} label="найстарше відкрите" format="hours" metric="support_oldest_open_hours" />
              <Stat cell={model.support.securityOpen} label="security відкриті" metric="support_security_open" />
            </div>
            <MetricDefinitions ids={["support_open", "support_waiting", "support_oldest_open_hours", "support_security_open"]} />
          </section>

          <section className={`${styles.card} ${styles.cardHalf}`} aria-labelledby="ov-problems">
            <div className={styles.cardHead}>
              <h2 id="ov-problems" className={styles.cardTitle}>Проблеми</h2>
              <span className={styles.cardSpacer} />
              <Link href="/admin/users?filter=errors_7d" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}>Хто зіткнувся</Link>
            </div>
            <div className={styles.stats}>
              <Stat cell={model.problems.errors7d} label="помилки за 7 днів" metric="errors_7d" />
              <Stat cell={model.problems.accountsWithErrors7d} label="акаунти з помилками" metric="accounts_with_errors_7d" />
              <Stat cell={model.problems.broadcastFailures} label="недоставлені розсилки" metric="broadcast_failures" />
            </div>
            {model.problems.errorClasses.length > 0 ? (
              <div className={ext.filterChips}>
                {model.problems.errorClasses.map((row) => (
                  <span key={row.name} className={`${ext.chip} ${ext.chipWarn}`}>{row.name} · {row.count}</span>
                ))}
              </div>
            ) : null}
            <MetricDefinitions ids={["errors_7d", "accounts_with_errors_7d", "broadcast_failures"]} />
          </section>

          <section className={`${styles.card} ${styles.cardHalf}`} aria-labelledby="ov-demand">
            <div className={styles.cardHead}>
              <h2 id="ov-demand" className={styles.cardTitle}>Попит</h2>
              <span className={styles.cardSpacer} />
              <Link href="/admin/analytics" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}>Аналітика</Link>
            </div>
            <div className={styles.stats}>
              <Stat cell={model.demand.paperActive} label="paper-акаунти" metric="paper_active" />
              <Stat cell={model.demand.paperActions24h} label="paper-плани за 24 год" metric="paper_actions_24h" />
              <Stat cell={model.demand.journalNoteRows} label="нотатки (рядки)" metric="journal_note_rows" />
              <Stat cell={model.demand.watchedAddresses} label="адреси на алертах" metric="watched_addresses" />
              <Stat cell={model.demand.siteCta14d} label="кліки CTA бота, 14 дн" metric="site_cta_14d" />
              <Stat cell={model.demand.siteWorkspaceCta14d} label="кліки CTA кабінету, 14 дн" metric="site_workspace_cta_14d" />
            </div>
            <MetricDefinitions ids={["paper_active", "paper_actions_24h", "journal_note_rows", "watched_addresses", "site_cta_14d", "site_workspace_cta_14d"]} />
          </section>
        </div>
      ) : null}
    </div>
  );
}
