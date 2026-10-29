"use client";

import { ArrowsClockwise } from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { InfoControl } from "@/app/shell/info-control";
import type { AgentUsage } from "@/lib/agent/budget";

import styles from "../admin.module.css";
import ext from "../panels.module.css";
import { formatDateTime } from "../format";
import { PlainStat } from "../stat";

/**
 * Ryn's spend for the admin: whether the model is switched on and which one,
 * the ceilings in force, today's and the month's model calls from the durable
 * meter, the receipts of the last fortnight by day (calls, tokens, wallets
 * counted — never listed — and outcomes) and by model, and the tools the
 * agent has with the boundary said as a fact. A deterministic answer costs
 * nothing and is not counted. Never a word of a conversation, never a key.
 */

type Payload = Readonly<{
  generatedAt: string;
  model: Readonly<{ enabled: boolean; name: string; switch: string }>;
  tools: Readonly<{ research: readonly string[]; prepare: readonly string[]; execute: false }>;
  usage: AgentUsage;
}>;

const OUTCOME_WORD: Record<string, string> = { ok: "відповів", refused: "модель відмовила", "invalid-output": "невалідний вивід", timeout: "таймаут", "rate-limited": "ліміт частоти", quota: "квота провайдера", unavailable: "недоступно" };

export function AgentPanel() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/agent", { headers: { accept: "application/json" } });
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

  const usage = payload?.usage ?? null;

  return (
    <section className={styles.card} aria-label="Ryntra · ШІ-помічник">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Ryntra · ШІ-помічник</h2>
        <InfoControl label="Що тут рахується">
          <p>Рахуються лише запитання, що дійшли до моделі: детермінована відповідь (складена з читань) нічого не коштує і не рахується. Ліміти — на гаманець за UTC-день і за місяць, одне запитання в роботі на гаманець, і стелі розгортання; лічильники живуть у сховищі Guard і рухаються compare-and-set — не в пам&apos;яті процесу.</p>
          <p>Модель вмикається лише перемикачем <code>RYNTRA_AGENT_MODEL_ENABLED=1</code> поруч із ключем — свідоме рішення, не дефолт. Квитанція на кожен виклик: модель, токени (де провайдер їх повідомляє), затримка, результат — ніколи слова розмови. Гаманці рахуються, ніколи не перелічуються. Інструментів виконання немає.</p>
        </InfoControl>
        <button type="button" className={styles.btn} onClick={() => void load()} disabled={loading} aria-label="Оновити">
          <ArrowsClockwise size={14} aria-hidden="true" />
        </button>
      </div>

      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          {error}
        </div>
      ) : null}

      {payload && usage ? (
        <div className={ext.subsection}>
          <div className={styles.cardHead}>
            <h3 className={styles.cardTitle}>{payload.model.enabled ? `модель увімкнена · ${payload.model.name}` : "модель вимкнена · відповіді з читань"}</h3>
            <span className={`${ext.chip} ${payload.model.enabled ? ext.chipOk : ext.chipWarn}`}>
              {`стеля ${usage.config.dailyCalls}/день · ${usage.config.monthlyCalls}/місяць на гаманець · ${usage.config.globalDailyCalls}/день · ${usage.config.globalMonthlyCalls}/місяць на розгортання`}
            </span>
          </div>
          <div className={styles.stats}>
            <PlainStat value={usage.today.calls} label={`викликів моделі сьогодні · ${usage.today.day}`} />
            <PlainStat value={usage.month.calls} label={`викликів моделі за місяць · ${usage.month.month}`} />
            <PlainStat value={usage.byDay.reduce((sum, row) => sum + row.calls, 0)} label="квитанцій за 14 днів" />
            <PlainStat value={usage.byDay.reduce((sum, row) => sum + row.tokens, 0)} label="токенів за 14 днів" />
            {/* AI-02: dollars from the priced receipts; the calls with no price are counted apart, never as free. */}
            <PlainStat value={Number(usage.byDay.reduce((sum, row) => sum + (row.costUsd ?? 0), 0).toFixed(4))} label="доларів витрачено за 14 днів" />
          </div>
          <p className={styles.cardNote}>
            Інструменти · дослідження: {payload.tools.research.map((tool) => <code key={tool}>{tool}</code>).reduce<ReactNode[]>((acc, node, index) => (index === 0 ? [node] : [...acc, ", ", node]), [])} · підготовка: {payload.tools.prepare.map((tool) => <code key={tool}>{tool}</code>).reduce<ReactNode[]>((acc, node, index) => (index === 0 ? [node] : [...acc, ", ", node]), [])} · виконання: <code>false</code> · оновлено {formatDateTime(payload.generatedAt)}
          </p>
          {usage.byDay.length > 0 ? (
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Квитанції за днями">
              <table className={styles.table}>
                <caption>Квитанції за днями · останні 14 днів</caption>
                <thead>
                  <tr>
                    <th scope="col">День</th>
                    <th scope="col">Викликів</th>
                    <th scope="col">Токенів</th>
                    <th scope="col">Гаманців</th>
                    <th scope="col">Гостей</th>
                    <th scope="col">$</th>
                    <th scope="col">Результати</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byDay.map((row) => (
                    <tr key={row.day}>
                      <td>
                        <code>{row.day}</code>
                      </td>
                      <td className={styles.cellNum}>{row.calls}</td>
                      <td className={styles.cellNum}>{row.tokens}</td>
                      <td className={styles.cellNum}>{row.wallets}</td>
                      <td className={styles.cellNum}>{row.guests ?? 0}</td>
                      <td className={styles.cellNum}>{`$${(row.costUsd ?? 0).toFixed(4)}${row.unpriced ? ` +${row.unpriced} без ціни` : ""}`}</td>
                      <td>{Object.entries(row.outcomes).map(([outcome, count]) => `${OUTCOME_WORD[outcome] ?? outcome} ×${count}`).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.cardNote}>Квитанцій ще немає: жоден виклик моделі не зроблено.</p>
          )}
          {usage.byModel.length > 0 ? (
            <p className={styles.cardNote}>{usage.byModel.map((row) => `${row.model}: ${row.calls} викл., ${row.inputTokens} вхідних (${row.cachedTokens ?? 0} з кешу) · ${row.outputTokens} вихідних токенів · $${(row.costUsd ?? 0).toFixed(4)}`).join(" · ")}</p>
          ) : null}
        </div>
      ) : !error ? (
        <div className={styles.skeleton} aria-busy="true">
          <div className={styles.skeletonRow} />
          <div className={styles.skeletonRow} />
        </div>
      ) : null}
    </section>
  );
}
