"use client";

import { useCallback, useEffect, useState } from "react";

import { InfoControl } from "@/app/shell/info-control";

type AuditListRow = {
  id: string;
  occurred_at: string;
  action: string;
  outcome: string;
  reason: string | null;
};

import styles from "../admin.module.css";

export function AuditPanel() {
  const [rows, setRows] = useState<AuditListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/audit");
      if (!r.ok) {
        setRows(null);
        setError(
          r.status === 503
            ? "Журнал ще не підключений. Міграція не застосована."
            : r.status === 401
              ? "Сесія адміністратора закінчилась."
              : `Код ${r.status}`,
        );
        return;
      }
      const json = (await r.json()) as { rows: AuditListRow[] };
      setRows(json.rows);
      setError(null);
    } catch {
      setRows(null);
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
        <h1 className={styles.pageTitle}>Журнал аудиту</h1>
        <InfoControl label="Що пишеться">
          <p>
            Append-only. UPDATE і DELETE відхиляє база. Консоль лишається
            вторинним логом.
          </p>
        </InfoControl>
      </div>

      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          {error}
          <button type="button" className={styles.btn} onClick={() => void load()}>
            Спробувати ще раз
          </button>
        </div>
      ) : null}

      {loading && !rows ? <p>Завантаження…</p> : null}

      {rows && rows.length === 0 ? (
        <p className={styles.laterCopy}>Записів ще немає.</p>
      ) : null}

      {rows && rows.length > 0 ? (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Аудит">
          <table className={styles.table}>
            <caption>Останні події</caption>
            <thead>
              <tr>
                <th scope="col">Час</th>
                <th scope="col">Дія</th>
                <th scope="col">Результат</th>
                <th scope="col">Причина</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={styles.cellMono}>
                    {new Date(row.occurred_at).toLocaleString("uk-UA")}
                  </td>
                  <td>{row.action}</td>
                  <td>{row.outcome}</td>
                  <td>{row.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
