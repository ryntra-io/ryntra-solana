"use client";

import { ArrowsClockwise } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { InfoControl } from "@/app/shell/info-control";
import type { EvidenceUsage } from "@/lib/evidence/service.server";

import styles from "../admin.module.css";
import ext from "../panels.module.css";
import { formatDateTime } from "../format";
import { PlainStat } from "../stat";

/**
 * The evidence layer's spend, per provider, as an admin reconciles it with
 * each provider's dashboard: today and the longer period (the credit packet
 * for Nansen, the UTC month for DD.xyz) — calls made, calls answered,
 * failures by their kind, retries, cache hits, credits reserved and credits
 * the provider said it deducted, the balance the provider last reported (in
 * its headers, or read from its usage endpoint for reconciliation and cached
 * ten minutes), the last successful call, the ceilings in force. A missing
 * ceiling reads as *paid calls off*, which is what it means. The rights the
 * reads run under are listed by family, so a look here says what may be
 * shown, what the plan gates and what is never called. Provider cost is
 * infrastructure; nothing here is a trading fee or a person's result.
 */

type Payload = Readonly<{ generatedAt: string; usage: readonly EvidenceUsage[] }>;

const STATUS_WORD: Record<string, string> = {
  "allowed-with-attribution": "дозволено · з атрибуцією",
  restricted: "обмежено · не викликається",
  prohibited: "заборонено · ніколи",
  "plan-gated": "закрито планом · 403 · не викликається",
  unsupported: "не для Solana · не викликається",
};

const PROVIDER_WORD: Record<string, string> = { nansen: "Nansen · що робив ринок", ddxyz: "DD.xyz · як збудовано токен, адреси" };
const FAILURE_WORD: Record<string, string> = { auth: "ключ відхилено (401)", plan: "закрито планом (403)", payment: "оплата (402)", rate: "ліміт частоти (429)", timeout: "таймаут", network: "мережа", server: "5xx постачальника", invalid: "відхилений запит (4xx)", notfound: "немає суб'єкта (404)", refused: "не дозволено правами", credits: "кредити вичерпано", geo: "регіон", unknown: "інше" };

export function EvidencePanel() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (reconcile = false) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/evidence${reconcile ? "?reconcile=1" : ""}`, { headers: { accept: "application/json" } });
      if (!response.ok) {
        setError(response.status === 401 ? "Сесія адміністратора закінчилась." : `Код ${response.status}`);
        return;
      }
      setPayload((await response.json()) as Payload);
      setError(null);
    } catch {
      setError("Не вдалося прочитати облік.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const providers = payload?.usage ?? [];

  return (
    <section className={styles.card} aria-label="Докази · постачальники">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Докази · постачальники</h2>
        <InfoControl label="Що тут рахується">
          <p>Запити — реальні звернення до постачальника; кожне списує кредити за його ж заголовками (Nansen — credits, DD.xyz — compute units з <code>x-webacy-cu</code>). Cache hits — покази з нашого кешу, вони нічого не коштують і не є викликами. «Залишок за постачальником» — баланс, який постачальник повідомив у заголовках (Nansen) або на своєму usage-ендпоінті (DD.xyz; читається раз на десять хвилин, його лічильники відстають на хвилини — це звірка, не реальний час). Наш лічильник — реальний губернатор.</p>
          <p>Стеля — з конфігурації; без неї платних викликів немає. Резервовано — сума очікуваних цін до виклику; списано — те, що постачальник підтвердив (без заголовка — очікувана ціна). Довший період — пакет (Nansen) або UTC-місяць (DD.xyz). Вартість постачальника — інфраструктурна витрата, не торгова комісія і не результат людини.</p>
        </InfoControl>
        <button type="button" className={styles.btn} onClick={() => void load(true)} disabled={loading} aria-label="Оновити і звірити з постачальником">
          <ArrowsClockwise size={14} aria-hidden="true" />
        </button>
      </div>

      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          {error}
        </div>
      ) : null}

      {providers.length > 0 ? (
        providers.map((usage) => {
          const { day, total, policy } = usage;
          const period = policy?.totalPeriod === "month" ? "місяць" : "пакет";
          const failures = Object.entries(day.failures ?? {}).filter(([, count]) => count > 0);
          const reportedRemaining = usage.reported?.remaining ?? total.remainingReported ?? null;
          return (
            <div key={usage.provider} className={ext.subsection}>
              <div className={styles.cardHead}>
                <h3 className={styles.cardTitle}>{PROVIDER_WORD[usage.provider] ?? usage.provider}</h3>
                <span className={`${ext.chip} ${!usage.configured ? ext.chipRisk : policy ? ext.chipOk : ext.chipWarn}`}>
                  {!usage.configured ? "ключ не налаштовано" : policy ? `стеля ${policy.dailyCredits}/день · ${policy.totalCredits} на ${period}` : "бюджету немає · платні виклики вимкнено"}
                </span>
              </div>
              <div className={styles.stats}>
                <PlainStat value={day.requests} label={`запитів сьогодні · ${day.period}`} />
                <PlainStat value={day.usedCredits} label={usage.provider === "ddxyz" ? "CU списано сьогодні" : "кредитів списано сьогодні"} />
                <PlainStat value={day.cacheHits} label="cache hits сьогодні" />
                <PlainStat value={day.failed} label="відмов сьогодні" />
                <PlainStat value={total.requests} label={`запитів за ${period} · ${total.period}`} />
                <PlainStat value={total.usedCredits} label={usage.provider === "ddxyz" ? `CU за ${period}` : `кредитів за ${period}`} />
                <PlainStat value={reportedRemaining ?? undefined} label={usage.reported ? `залишок за постачальником · ${usage.reported.limit !== null ? `ліміт ${usage.reported.limit}` : "звірка"}` : "залишок за постачальником"} />
                <PlainStat value={total.reservedCredits} label={`резервовано за ${period}`} />
              </div>
              <p className={styles.cardNote}>
                Політика прав <code>{usage.rights.policy}</code>, прочитано {usage.rights.readOn} · атрибуція «{usage.rights.attribution}» · останній запит {total.lastRequestId ? <code>{total.lastRequestId}</code> : "—"} · останній успішний {total.lastSucceededAt ? formatDateTime(total.lastSucceededAt) : "—"} · оновлено {formatDateTime(total.updatedAt)}
                {day.retries > 0 ? ` · повторів сьогодні ${day.retries}` : ""}
                {failures.length > 0 ? ` · відмови сьогодні: ${failures.map(([kind, count]) => `${FAILURE_WORD[kind] ?? kind} ×${count}`).join(", ")}` : ""}
                {usage.reported ? ` · звірка з постачальником ${formatDateTime(usage.reported.readAt)}${usage.reported.routes.length > 0 ? ` (за його маршрутами: ${usage.reported.routes.map((route) => `${route.route} ${route.used}`).join(", ")})` : ""}` : ""}
              </p>
              <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={`Сімейства · ${usage.provider}`}>
                <table className={styles.table}>
                  <caption>Сімейства постачальника · що дозволено показувати</caption>
                  <thead>
                    <tr>
                      <th scope="col">Сімейство</th>
                      <th scope="col">Статус</th>
                      <th scope="col">{usage.provider === "ddxyz" ? "CU за виклик" : "Кредитів"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.rights.families.map((family) => (
                      <tr key={family.family}>
                        <td>
                          <code>{family.family}</code>
                        </td>
                        <td>{STATUS_WORD[family.status] ?? family.status}</td>
                        <td className={styles.cellNum}>{family.creditsPerCall || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      ) : !error ? (
        <div className={styles.skeleton} aria-busy="true">
          <div className={styles.skeletonRow} />
          <div className={styles.skeletonRow} />
        </div>
      ) : null}
    </section>
  );
}
