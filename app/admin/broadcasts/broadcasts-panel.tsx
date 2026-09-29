"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone, Warning } from "@phosphor-icons/react";

import { InfoControl } from "@/app/shell/info-control";
import type { BroadcastAudience, BroadcastListRow, CampaignState } from "@/lib/admin/broadcast";

import styles from "../admin.module.css";
import { adminPost } from "../reverify";
import { BroadcastPanel } from "../panel";

const AUDIENCE: { value: BroadcastAudience; label: string }[] = [
  { value: "verified", label: "Доступ підтверджено" },
  { value: "all", label: "Всі користувачі" },
];

const STATE_LABEL: Record<CampaignState, string> = {
  DRAFT: "Чернетка",
  READY: "Готова",
  SCHEDULED: "Запланована",
  QUEUED: "У черзі",
  SENDING: "Надсилається",
  COMPLETED: "Завершена",
  PARTIAL: "Частково",
  CANCELLED: "Скасована",
};

export function BroadcastsPanel() {
  const [rows, setRows] = useState<BroadcastListRow[] | null>(null);
  const [queueMissing, setQueueMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("Розсилка");
  const [audience, setAudience] = useState<BroadcastAudience>("verified");
  const [text, setText] = useState("");
  const [cta, setCta] = useState("");
  const [scheduled, setScheduled] = useState("");
  const [selected, setSelected] = useState<BroadcastListRow | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/broadcasts");
    if (r.status === 503) {
      setRows(null);
      setQueueMissing(true);
      setError(null);
      return;
    }
    if (!r.ok) {
      setRows(null);
      setQueueMissing(false);
      setError(r.status === 401 ? "Сесія адміністратора закінчилась." : `Код ${r.status}`);
      return;
    }
    const json = (await r.json()) as { campaigns: BroadcastListRow[] };
    setRows(json.campaigns);
    setQueueMissing(false);
    setError(null);
  }, []);

  const loadCount = useCallback(async (next: BroadcastAudience) => {
    const r = await fetch(`/api/admin/broadcasts?audience=${encodeURIComponent(next)}`);
    if (!r.ok) {
      setCount(null);
      return;
    }
    const json = (await r.json()) as { n: number };
    setCount(json.n);
  }, []);

  useEffect(() => {
    void load();
    void loadCount(audience);
  }, [audience, load, loadCount]);

  useEffect(() => {
    if (!selected || !rows) return;
    const next = rows.find((row) => row.id === selected.id);
    if (
      next &&
      (next.state !== selected.state || next.test_sent_at !== selected.test_sent_at)
    ) {
      setSelected(next);
    }
  }, [rows, selected]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(String(body.action ?? "save"));
    const r = await adminPost("/api/admin/broadcasts", body);
    const json = (await r.json()) as Record<string, unknown>;
    setBusy(null);
    setArmed(false);
    if (!r.ok) {
      setMsg(String(json.error ?? "не вдалося"));
      return null;
    }
    setMsg(String(json.state ?? json.delivery ?? "ok"));
    await load();
    return json;
  };

  if (queueMissing) {
    return (
      <div>
        <p className={styles.banner} role="status">
          Черга кампаній ще не підключена. Одноразова розсилка лишається.
        </p>
        <BroadcastPanel />
      </div>
    );
  }

  const tested = Boolean(selected?.test_sent_at && selected.state === "READY");

  return (
    <div>
      <div className={styles.cardHead}>
        <h1 className={styles.pageTitle}>Розсилки</h1>
        <InfoControl label="Як працює черга">
          <p>
            Спочатку тест собі, потім підтвердження. Немає метрики прочитань.
            Аудиторія — підтверджений доступ або всі, ніколи гаманець чи P&amp;L.
          </p>
        </InfoControl>
      </div>

      {msg ? <p className={styles.banner} role="status">{msg}</p> : null}
      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          {error}
          <button type="button" className={styles.btn} onClick={() => void load()}>Спробувати ще раз</button>
        </div>
      ) : null}

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>
            <Megaphone size={18} weight="bold" aria-hidden="true" /> Кампанія
          </h2>
          <span className={styles.cardNote}>
            {count == null ? "кількість невідома" : `${count.toLocaleString("uk-UA")} адресатів`}
          </span>
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Назва</span>
          <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Кому</span>
          <select
            className={styles.select}
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value as BroadcastAudience);
              setArmed(false);
            }}
          >
            {AUDIENCE.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Текст</span>
          <textarea
            className={styles.textarea}
            rows={4}
            maxLength={3500}
            value={text}
            onChange={(e) => { setText(e.target.value); setArmed(false); }}
          />
          <span className={styles.counter}>{text.length} / 3500</span>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Посилання (необовʼязково, лише ryntra.io)</span>
          <input className={styles.input} value={cta} onChange={(e) => setCta(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Коли (порожньо = зараз)</span>
          <input
            className={styles.input}
            type="datetime-local"
            value={scheduled}
            onChange={(e) => setScheduled(e.target.value)}
          />
        </label>

        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.btn}
            disabled={busy !== null || text.trim().length < 2}
            onClick={() => void post({
              action: selected && (selected.state === "DRAFT" || selected.state === "READY") ? "update" : "create",
              id: selected && (selected.state === "DRAFT" || selected.state === "READY") ? selected.id : undefined,
              name,
              audience,
              body: text,
              cta: cta.trim() || null,
            }).then((json) => {
              if (json && typeof json.id === "string") {
                setSelected({
                  id: json.id,
                  public_ref: String(json.public_ref ?? ""),
                  name,
                  audience,
                  state: "DRAFT",
                  queued_count: 0,
                  sent_count: 0,
                  failed_count: 0,
                  blocked_count: 0,
                  test_sent_at: null,
                  scheduled_at: null,
                  created_at: new Date().toISOString(),
                  body: text,
                });
              }
            })}
          >
            Зберегти
          </button>
          <button
            type="button"
            className={styles.btn}
            disabled={busy !== null || !selected}
            onClick={() => void post({ action: "test", id: selected?.id, body: text })}
          >
            Тест собі
          </button>
          <button
            type="button"
            className={`${styles.btn} ${armed ? styles.btnDanger : styles.btnPrimary}`}
            disabled={busy !== null || !selected || !tested}
            onClick={() => {
              if (!armed) { setArmed(true); return; }
              const when = scheduled.trim() ? new Date(scheduled).toISOString() : null;
              void post({ action: "enqueue", id: selected?.id, scheduled_at: when });
            }}
          >
            {busy === "enqueue" ? (
              "Ставлю в чергу…"
            ) : armed ? (
              <>
                <Warning size={14} weight="bold" aria-hidden="true" />
                Підтвердити відправку
              </>
            ) : (
              "У чергу"
            )}
          </button>
          {armed ? (
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setArmed(false)}>
              Скасувати
            </button>
          ) : null}
        </div>
        {armed ? (
          <p className={`${styles.hint} ${styles.hintWarn}`} role="status">
            Другий клік поставить кампанію в чергу
            {count == null ? " реальним людям" : ` на ${count.toLocaleString("uk-UA")} людей`}.
            Прочитання не рахується.
          </p>
        ) : null}
      </section>

      {rows && rows.length === 0 ? <p className={styles.laterCopy}>Кампаній ще немає.</p> : null}
      {rows && rows.length > 0 ? (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Кампанії">
          <table className={styles.table}>
            <caption>Кампанії · {rows.length}</caption>
            <thead>
              <tr>
                <th scope="col">Реф</th>
                <th scope="col">Назва</th>
                <th scope="col">Стан</th>
                <th scope="col">Надіслано</th>
                <th scope="col">Помилки</th>
                <th scope="col">Блок</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnGhost}`}
                      onClick={() => {
                        setSelected(row);
                        setName(row.name);
                        setAudience(row.audience);
                        setText(row.body ?? text);
                      }}
                    >
                      {row.public_ref}
                    </button>
                  </td>
                  <td>{row.name}</td>
                  <td>{STATE_LABEL[row.state]}</td>
                  <td className={styles.cellNum}>{row.sent_count}</td>
                  <td className={styles.cellNum}>{row.failed_count}</td>
                  <td className={styles.cellNum}>{row.blocked_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {selected && (selected.state === "QUEUED" || selected.state === "SENDING" || selected.state === "SCHEDULED" || selected.state === "DRAFT" || selected.state === "READY") ? (
        <div className={styles.btnRow}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnDanger}`}
            disabled={busy !== null}
            onClick={() => void post({ action: "cancel", id: selected.id, reason: "скасовано з адмінки" })}
          >
            Скасувати кампанію
          </button>
        </div>
      ) : null}
    </div>
  );
}
