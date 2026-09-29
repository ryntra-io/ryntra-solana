"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";

import { InfoControl } from "@/app/shell/info-control";
import type { WebhookHealth } from "@/lib/admin/bot-ops";
import { PROVIDER_STATE_LABEL, type ProviderState, type ProviderStatus } from "@/lib/admin/operations";

import styles from "../admin.module.css";
import ext from "../panels.module.css";
import { formatDateTime, formatLatency, formatTime } from "../format";

type BoardResponse = {
  checkedAt: string;
  board: ProviderStatus[];
  summary: { worst: ProviderState; attention: ProviderStatus[]; counts: Record<ProviderState, number> };
  health: WebhookHealth | null;
};

const STATE_TONE: Record<ProviderState, string> = {
  HEALTHY: ext.chipOk,
  DEGRADED: ext.chipWarn,
  UNAVAILABLE: ext.chipRisk,
  UNKNOWN: ext.chipWarn,
  UNCONFIGURED: ext.chipMuted,
};

const FACT_LABEL: Record<string, string> = {
  username: "бот",
  webhook_host: "вебхук",
  pending_updates: "у черзі",
  last_error_at: "остання помилка",
  served_by: "відповів",
  slot: "слот",
  access: "доступ",
  http: "HTTP",
  campaigns: "кампаній",
  in_flight: "у роботі",
  undelivered: "недоставлено",
};

function factText(key: string, value: string | number | boolean | null): string {
  if (value === null) return "—";
  if (key === "last_error_at" && typeof value === "string") return formatDateTime(value);
  if (typeof value === "boolean") return value ? "так" : "ні";
  return String(value);
}

export function OperationsPanel() {
  const [busy, setBusy] = useState(false);
  const [opsBusy, setOpsBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<"ok" | "error">("ok");
  const [data, setData] = useState<BoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = busy || opsBusy;

  const loadBoard = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/operations");
      if (!r.ok) {
        setError(r.status === 401 ? "Сесія адміністратора закінчилась." : `Проби не відповіли (код ${r.status}).`);
        setData(null);
        return;
      }
      setData((await r.json()) as BoardResponse);
      setError(null);
    } catch {
      setError("Запит не дійшов до сервера.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  const runFillCheck = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_fill_check" }),
      });
      const json = (await r.json()) as Record<string, unknown>;
      if (r.ok) {
        setTone("ok");
        setMsg(`Перевірка виконань: відстежено ${json.watched}, сповіщено ${json.notified}`);
      } else {
        setTone("error");
        setMsg(String(json.error ?? "не вдалося"));
      }
    } catch {
      setTone("error");
      setMsg("Запит не дійшов до сервера");
    } finally {
      setBusy(false);
    }
  };

  const testOwner = async () => {
    setOpsBusy(true);
    try {
      const r = await fetch("/api/admin/operations", { method: "POST" });
      const json = (await r.json()) as { delivery?: string; error?: string };
      setTone(r.ok && json.delivery === "sent" ? "ok" : "error");
      setMsg(r.ok ? `Тест власнику: ${json.delivery}` : String(json.error ?? "не вдалося"));
    } catch {
      setTone("error");
      setMsg("Запит не дійшов до сервера");
    } finally {
      setOpsBusy(false);
    }
  };

  const health = data?.health ?? null;
  const coverage = data?.board.find((row) => row.id === "activity_store") ?? null;

  return (
    <div>
      <div className={styles.cardHead}>
        <h1 className={styles.pageTitle}>Операції</h1>
        <InfoControl label="Що перевіряється">
          <p>
            Кожен рядок називає одну перевірену можливість. Timeout і застаріла відповідь ніколи не
            означають «працює»; HTTP 200 одного endpoint не доводить решту можливостей провайдера.
            Одна проба, що не відповіла, не ховає інших. Токени й ключі на цю сторінку не потрапляють.
          </p>
        </InfoControl>
      </div>

      {msg ? (
        <p className={`${styles.banner} ${tone === "error" ? styles.bannerError : styles.bannerOk}`} role="status">
          {msg}
        </p>
      ) : null}
      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          {error}
          <button type="button" className={styles.btn} onClick={() => void loadBoard()}>Спробувати ще раз</button>
        </div>
      ) : null}

      <section className={styles.card} aria-labelledby="ops-board">
        <div className={styles.cardHead}>
          <h2 id="ops-board" className={styles.cardTitle}>Провайдери</h2>
          {data ? (
            <span className={`${ext.chip} ${STATE_TONE[data.summary.worst]}`}>
              <i className={ext.chipDot} aria-hidden />
              найгірший стан: {PROVIDER_STATE_LABEL[data.summary.worst]}
            </span>
          ) : null}
          {data ? <span className={ext.subtle}>перевірено {formatTime(data.checkedAt)}</span> : null}
          <span className={styles.cardSpacer} />
          <button type="button" className={`${styles.btn} ${styles.btnSm}`} disabled={loading} onClick={() => void loadBoard()}>
            <ArrowClockwise size={14} weight="bold" aria-hidden="true" />
            {loading ? "Перевіряю…" : "Перевірити знову"}
          </button>
        </div>
        {loading && !data ? (
          <div className={styles.skeleton} aria-busy="true" aria-label="Проби провайдерів">
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
          </div>
        ) : null}
        {data ? (
          <div className={ext.board}>
            {data.board.map((row) => (
              <div key={row.id} className={ext.boardRow} id={row.id === "activity_store" ? "coverage" : undefined}>
                <div>
                  <div className={ext.boardName}>{row.label}</div>
                  <div className={ext.boardCapability}>{row.capability}</div>
                </div>
                <span className={`${ext.chip} ${STATE_TONE[row.state]}`}>
                  <i className={ext.chipDot} aria-hidden />
                  {PROVIDER_STATE_LABEL[row.state]}
                </span>
                <span className={ext.boardMono}>{row.latencyMs !== null ? formatLatency(row.latencyMs) : "—"}</span>
                <span className={ext.boardMono}>{row.checkedAt ? formatTime(row.checkedAt) : "—"}</span>
                <span className={ext.boardMono}>{row.reason ?? ""}</span>
                {row.detail ? <div className={ext.boardDetail}>{row.detail}</div> : null}
                {Object.keys(row.facts).length > 0 ? (
                  <div className={ext.boardFacts}>
                    {Object.entries(row.facts).map(([key, value]) => (
                      <span key={key} className={ext.chip}>{FACT_LABEL[key] ?? key}: {factText(key, value)}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {coverage ? (
        <section className={styles.card} aria-labelledby="ops-coverage">
          <div className={styles.cardHead}>
            <h2 id="ops-coverage" className={styles.cardTitle}>Покриття активності</h2>
            <span className={`${ext.chip} ${STATE_TONE[coverage.state]}`}>{PROVIDER_STATE_LABEL[coverage.state]}</span>
          </div>
          <p className={ext.emptyLine}>
            {coverage.state === "HEALTHY"
              ? "Входи й дозволені дії записуються з моменту застосування сховища; ранішої історії немає і вона не добудовується."
              : coverage.state === "UNCONFIGURED"
                ? "Сховище входів і дій не застосовано. Овервʼю показує ці показники як «не збирається», а не як нуль. Застосувати: supabase/migrations/20260905120000_ryn_admin_006_activity_v1.sql у SQL Editor проєкту ryntra."
                : "Сховище не відповіло на цю пробу; показники активності зараз недоступні."}
          </p>
        </section>
      ) : null}

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Bot Operations</h2>
          <span className={styles.cardNote}>{health?.username ? `@${health.username}` : "немає даних"}</span>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={`${styles.statValue} ${health?.webhookConfigured && health.webhookHost ? "" : styles.statUnknown}`}>
              {health?.webhookConfigured && health.webhookHost ? health.webhookHost : "немає даних"}
            </span>
            <span className={styles.statLabel}>вебхук</span>
          </div>
          <div className={styles.stat}>
            <span className={`${styles.statValue} ${typeof health?.pendingUpdates === "number" ? "" : styles.statUnknown}`}>
              {typeof health?.pendingUpdates === "number" ? String(health.pendingUpdates) : "немає даних"}
            </span>
            <span className={styles.statLabel}>у черзі</span>
          </div>
          <div className={styles.stat}>
            <span className={`${styles.statValue} ${health?.lastErrorAt ? "" : styles.statUnknown}`}>
              {health?.lastErrorAt ? formatDateTime(health.lastErrorAt) : "немає"}
            </span>
            <span className={styles.statLabel}>остання помилка вебхука</span>
          </div>
        </div>
        <div className={styles.btnRow}>
          <button type="button" className={styles.btn} disabled={locked} onClick={() => void testOwner()}>
            Тест власнику
          </button>
          <button type="button" className={styles.btn} disabled={locked} aria-busy={busy} onClick={() => void runFillCheck()}>
            <ArrowClockwise size={14} weight="bold" aria-hidden="true" />
            {busy ? "Перевіряю…" : "Перевірити виконання"}
          </button>
        </div>
      </section>
    </div>
  );
}
