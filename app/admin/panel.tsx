"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone, Warning } from "@phosphor-icons/react";

import styles from "./admin.module.css";

type Metrics = {
  users_total?: number;
  tasks?: { telegram_verified?: number };
};

const BROADCAST_FILTERS = [
  { value: "verified_any", label: "Доступ підтверджено" },
  { value: "", label: "Всі користувачі" },
];

/** Скільки адресатів максимум обробляє один прогін розсилки на боці API. */
const BROADCAST_CAP = 500;

export function BroadcastPanel() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"ok" | "error">("ok");
  const [bText, setBText] = useState("");
  const [bFilter, setBFilter] = useState("verified_any");
  const [bArmed, setBArmed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin");
      if (r.ok) {
        const json = (await r.json()) as { metrics: Metrics };
        setMetrics(json.metrics);
        setLoadError(null);
      } else {
        setMetrics(null);
        setLoadError(
          r.status === 401
            ? "Сесія адміністратора закінчилась. Надішли /admin боту @RyntraBeta_bot, щоб отримати свіже посилання."
            : r.status === 503
              ? "Дані адмінки недоступні: сервер не зміг отримати їх від бази. Спробуй ще раз за хвилину."
              : `Не вдалося завантажити дані (код ${r.status}).`,
        );
      }
    } catch {
      setMetrics(null);
      setLoadError("Не вдалося завантажити дані: немає зв'язку із сервером.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (body: Record<string, unknown>): Promise<{ ok: boolean; json: Record<string, unknown> }> => {
    try {
      const r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      try {
        return { ok: r.ok, json: (await r.json()) as Record<string, unknown> };
      } catch {
        return { ok: false, json: { error: "Некоректна відповідь сервера" } };
      }
    } catch {
      return { ok: false, json: { error: "Запит не дійшов до сервера" } };
    }
  };

  const sendBroadcast = async () => {
    if (!bArmed) { setBArmed(true); return; }
    setBusy("broadcast");
    const { ok, json } = await post({ action: "broadcast", text: bText, status: bFilter });
    setMsg(ok
      ? `Розсилка: ${json.sent} надіслано, ${json.failed} помилок з ${json.targets}`
      : String(json.error ?? "не вдалося"));
    setMsgTone(ok ? "ok" : "error");
    setBusy(null); setBArmed(false); if (ok) setBText("");
  };

  const m = metrics;
  const broadcastReach =
    bFilter === "verified_any"
      ? m?.tasks?.telegram_verified
      : bFilter === ""
        ? m?.users_total
        : undefined;
  const reachKnown = typeof broadcastReach === "number";
  const overCap = reachKnown && broadcastReach > BROADCAST_CAP;

  return (
    <div lang="uk">
      <h1 className={styles.pageTitle}>Розсилки</h1>
      <p className={styles.pageLead}>Поточна одноразова розсилка. Черга кампаній — наступна хвиля.</p>

      {msg ? (
        <p
          className={`${styles.banner} ${msgTone === "error" ? styles.bannerError : styles.bannerOk}`}
          role="status"
          aria-live="polite"
        >
          <span>{msg}</span>
        </p>
      ) : null}

      {loadError ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          <Warning size={17} weight="bold" aria-hidden="true" />
          <span>{loadError}</span>
          <button type="button" className={styles.btn} disabled={loading} onClick={() => void load()}>
            {loading ? "Пробую…" : "Спробувати ще раз"}
          </button>
        </div>
      ) : null}

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>
            <Megaphone size={18} weight="bold" aria-hidden="true" /> Розсилка через бота
          </h2>
          <span className={styles.cardSpacer} />
          <span className={styles.cardNote}>
            {reachKnown
              ? overCap
                ? `${broadcastReach.toLocaleString("uk-UA")} адресатів · за прогін піде ${BROADCAST_CAP}`
                : `${broadcastReach.toLocaleString("uk-UA")} адресатів`
              : "кількість адресатів невідома"}
          </span>
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Кому</span>
          <select
            className={styles.select}
            value={bFilter}
            onChange={(e) => { setBFilter(e.target.value); setBArmed(false); }}
          >
            {BROADCAST_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Текст повідомлення</span>
          <textarea
            className={styles.textarea}
            rows={4}
            maxLength={3500}
            placeholder="Звичайний текст, без HTML. Напр.: анонс хвилі бети, оновлення продукту…"
            value={bText}
            onChange={(e) => { setBText(e.target.value); setBArmed(false); }}
          />
          <span className={styles.counter}>{bText.length} / 3500</span>
        </label>

        <div className={styles.btnRow}>
          <button
            type="button"
            className={`${styles.btn} ${bArmed ? styles.btnDanger : styles.btnPrimary}`}
            disabled={bText.trim().length < 2 || busy === "broadcast"}
            onClick={() => void sendBroadcast()}
          >
            {busy === "broadcast" ? (
              "Надсилаю…"
            ) : bArmed ? (
              <>
                <Warning size={14} weight="bold" aria-hidden="true" />
                Підтвердити відправку
              </>
            ) : (
              "Надіслати"
            )}
          </button>
          {bArmed ? (
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setBArmed(false)}>
              Скасувати
            </button>
          ) : null}
        </div>

        {bArmed ? (
          <p className={`${styles.hint} ${styles.hintWarn}`} role="status">
            Другий клік надішле повідомлення{" "}
            {reachKnown ? (
              <b>
                {overCap
                  ? `${BROADCAST_CAP} людям із ${broadcastReach.toLocaleString("uk-UA")}`
                  : `${broadcastReach.toLocaleString("uk-UA")} реальним людям`}
              </b>
            ) : (
              "реальним людям"
            )}
            . Перечитай текст.
          </p>
        ) : (
          <p className={styles.hint}>
            Відправка у два кроки: перший клік озброює кнопку, другий — надсилає. Зміна тексту
            або адресатів скидає озброєння.
          </p>
        )}
      </section>
    </div>
  );
}
