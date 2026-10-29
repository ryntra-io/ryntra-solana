"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { InfoControl } from "@/app/shell/info-control";
import type { FeedbackListRow } from "@/lib/admin/feedback";
import type { FeedbackContextView, FeedbackTopic } from "@/lib/admin/feedback-context";

import styles from "../admin.module.css";
import ext from "../panels.module.css";
import { formatAgo, formatDateTime } from "../format";
import { MetricDefinitions } from "../stat";

type ThreadDetail = {
  ok: boolean;
  thread?: {
    id: string;
    public_ref: string;
    source: string;
    category: string;
    status: string;
    priority: string;
    telegram_id: number | null;
    route: string | null;
    created_at?: string;
    updated_at?: string;
  };
  messages?: { id: string; author: string; body: string; delivery_outcome: string | null; created_at: string }[];
  context?: FeedbackContextView | null;
};

type ListRow = FeedbackListRow & { context?: FeedbackContextView | null };

const TOPIC_LABEL: Record<FeedbackTopic, string> = { question: "Запитання", idea: "Ідея", bug: "Помилка", security: "Безпека", report: "Скарга на токен" };
const CATEGORY_LABEL: Record<string, string> = { bug: "Помилка", idea: "Ідея", security: "Безпека", other: "Інше" };
const SOURCE_LABEL: Record<string, string> = { app: "кабінет", site: "сайт", bot: "бот" };

/** What a row says about who wrote it: the wallet, the contact, the account — or nothing. */
function whoText(row: { telegram_id: number | null; context?: FeedbackContextView | null }): string {
  const parts: string[] = [];
  if (row.context?.walletMasked) parts.push(row.context.walletMasked + (row.context.proven ? " ✓" : ""));
  if (row.context?.contact) parts.push(row.context.contact);
  if (row.telegram_id) parts.push("Telegram");
  return parts.length > 0 ? parts.join(" · ") : "анонімно";
}

function topicText(row: { category: string; context?: FeedbackContextView | null }): string {
  return row.context ? TOPIC_LABEL[row.context.topic] : (CATEGORY_LABEL[row.category] ?? row.category);
}

const STATUS_FILTERS = ["ALL", "OPEN", "WAITING", "CLOSED"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const STATUS_LABEL: Record<StatusFilter, string> = { ALL: "Усі", OPEN: "Без відповіді", WAITING: "Чекають користувача", CLOSED: "Закриті" };
const STATUS_TONE: Record<string, string> = { OPEN: ext.chipWarn, WAITING: ext.chipMuted, CLOSED: ext.chipOk };
const DELIVERY_LABEL: Record<string, string> = {
  pending: "доставка триває",
  sent: "доставлено в бот",
  failed: "не доставлено",
  blocked: "бот заблокований",
  not_applicable: "без Telegram",
};

function statusFilterOf(value: string | null): StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(value ?? "") ? (value as StatusFilter) : "ALL";
}

export function FeedbackPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const status = statusFilterOf(searchParams.get("status"));
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ThreadDetail | null>(null);
  const [reply, setReply] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const setStatus = (next: StatusFilter) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "ALL") params.delete("status");
    else params.set("status", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/feedback");
      if (r.status === 503) {
        setRows(null);
        setError("Інбокс не відповів. Якщо міграцію відгуків не застосовано, треди не зберігаються.");
        return;
      }
      if (!r.ok) {
        setRows(null);
        setError(r.status === 401 ? "Сесія адміністратора закінчилась." : `Код ${r.status}`);
        return;
      }
      const json = (await r.json()) as { threads: FeedbackListRow[] };
      setRows(json.threads);
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

  const open = async (id: string) => {
    const r = await fetch(`/api/admin/feedback?id=${encodeURIComponent(id)}`);
    if (!r.ok) {
      setMsg("Тред не завантажився.");
      return;
    }
    setSelected((await r.json()) as ThreadDetail);
    setReply("");
  };

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    const r = await fetch("/api/admin/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await r.json()) as Record<string, unknown>;
    const delivery = typeof json.delivery === "string" ? DELIVERY_LABEL[json.delivery] ?? json.delivery : null;
    setMsg(r.ok ? (delivery ? `Відповідь збережено · ${delivery}` : `Стан: ${String(json.status ?? "ok")}`) : String(json.error ?? "не вдалося"));
    setBusy(false);
    if (r.ok && typeof body.id === "string") await open(body.id);
    await load();
  };

  const counts = useMemo(() => {
    const out: Record<StatusFilter, number> = { ALL: 0, OPEN: 0, WAITING: 0, CLOSED: 0 };
    for (const row of rows ?? []) {
      out.ALL += 1;
      if (row.status === "OPEN" || row.status === "WAITING" || row.status === "CLOSED") out[row.status] += 1;
    }
    return out;
  }, [rows]);

  const visible = useMemo(
    () => (rows ?? []).filter((row) => status === "ALL" || row.status === status),
    [rows, status],
  );

  const oldestOpen = useMemo(() => {
    const open = (rows ?? []).filter((row) => row.status === "OPEN").map((row) => Date.parse(row.created_at)).filter(Number.isFinite);
    if (open.length === 0) return null;
    return new Date(Math.min(...open)).toISOString();
  }, [rows]);

  const securityOpen = (rows ?? []).filter((row) => row.priority === "SECURITY" && row.status !== "CLOSED").length;

  return (
    <div>
      <div className={styles.cardHead}>
        <h1 className={styles.pageTitle}>Звернення</h1>
        <InfoControl label="Що це за інбокс">
          <p>
            Один інбокс для сайту, кабінету і бота. Відповідь іде через бота, якщо на треді є Telegram id;
            результат доставки записується як факт від Telegram. Прочитання не фіксується і не вигадується.
            Вік треду — час від створення до зараз.
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

      {rows ? (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Черга</h2>
          </div>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <b className={styles.statValue}>{counts.OPEN}</b>
              <span className={styles.statLabel}>без відповіді</span>
            </div>
            <div className={styles.stat}>
              <b className={styles.statValue}>{counts.WAITING}</b>
              <span className={styles.statLabel}>чекають користувача</span>
            </div>
            <div className={styles.stat}>
              <b className={`${styles.statValue} ${oldestOpen ? "" : styles.statUnknown}`}>{oldestOpen ? formatAgo(oldestOpen).replace(" тому", "") : "—"}</b>
              <span className={styles.statLabel}>найстарше відкрите</span>
            </div>
            <div className={styles.stat}>
              <b className={styles.statValue}>{securityOpen}</b>
              <span className={styles.statLabel}>security відкриті</span>
            </div>
          </div>
          <MetricDefinitions ids={["support_open", "support_waiting", "support_oldest_open_hours", "support_security_open"]} />
        </section>
      ) : null}

      {selected?.thread ? (
        <section className={styles.drawer} aria-label="Тред">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>{selected.thread.public_ref}</h2>
            <span className={`${ext.chip} ${STATUS_TONE[selected.thread.status] ?? ""}`}>{selected.thread.status}</span>
            <span className={styles.cardNote}>{SOURCE_LABEL[selected.thread.source] ?? selected.thread.source} · {topicText({ category: selected.thread.category, context: selected.context })}{selected.thread.priority === "SECURITY" ? " · security" : ""}</span>
            <span className={styles.cardNote}>{selected.thread.telegram_id ? "бот доступний" : selected.context?.contact ? "відповідь вручну на контакт" : "без каналу відповіді"}</span>
            {selected.thread.created_at ? <span className={ext.subtle}>створено {formatDateTime(selected.thread.created_at)}</span> : null}
            <span className={styles.cardSpacer} />
            <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} onClick={() => setSelected(null)}>
              Сховати
            </button>
          </div>
          <dl className={ext.defsList} aria-label="Хто написав">
            <div className={ext.defsItem}>
              <dt>Гаманець</dt>
              <dd>
                {selected.context?.wallet ? (
                  <>
                    <code className={styles.mono}>{selected.context.wallet}</code>{" "}
                    <span className={`${ext.chip} ${selected.context.proven ? ext.chipOk : ext.chipMuted}`}>{selected.context.proven ? "підтверджений підписом" : "лише підключений"}</span>
                  </>
                ) : (
                  <span className={ext.subtle}>не підключено</span>
                )}
              </dd>
            </div>
            <div className={ext.defsItem}>
              <dt>Контакт</dt>
              <dd>{selected.context?.contact ? <code className={styles.mono}>{selected.context.contact}</code> : <span className={ext.subtle}>не залишено</span>}</dd>
            </div>
            <div className={ext.defsItem}>
              <dt>Сторінка</dt>
              <dd>{selected.context?.route ?? selected.thread.route ?? <span className={ext.subtle}>—</span>}</dd>
            </div>
          </dl>
          <ol className={ext.timeline}>
            {selected.messages?.map((item) => (
              <li key={item.id} className={ext.timelineItem}>
                <span className={ext.timelineAt}>{formatDateTime(item.created_at)}</span>
                <span>
                  <b>{item.author === "admin" ? "Адмін" : "Користувач"}:</b> {item.body}
                </span>
                {item.author === "admin" && item.delivery_outcome ? (
                  <span className={`${ext.chip} ${item.delivery_outcome === "sent" ? ext.chipOk : item.delivery_outcome === "failed" || item.delivery_outcome === "blocked" ? ext.chipRisk : ext.chipMuted}`}>
                    {DELIVERY_LABEL[item.delivery_outcome] ?? item.delivery_outcome}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              {selected.thread.telegram_id
                ? "Відповідь через бота"
                : selected.context?.contact
                  ? `Відповідь · зберігається в треді, надішліть на ${selected.context.contact} вручну`
                  : "Відповідь · зберігається в треді, каналу доставки немає"}
            </span>
            <textarea className={styles.input} rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
          </label>
          <div className={styles.btnRow}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={busy || reply.trim().length < 2}
              onClick={() => void post({ id: selected.thread!.id, body: reply })}
            >
              Відповісти
            </button>
            {selected.thread.status !== "CLOSED" ? (
              <button
                type="button"
                className={styles.btn}
                disabled={busy}
                onClick={() => void post({ id: selected.thread!.id, action: "state", status: "CLOSED", reason: reason || "закрито з інбоксу" })}
              >
                Закрити тред
              </button>
            ) : (
              <button
                type="button"
                className={styles.btn}
                disabled={busy}
                onClick={() => void post({ id: selected.thread!.id, action: "state", status: "OPEN", reason: reason || "відкрито знову з інбоксу" })}
              >
                Відкрити знову
              </button>
            )}
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Причина зміни стану</span>
            <input className={styles.input} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </section>
      ) : null}

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Треди</h2>
          <span className={styles.cardNote}>{rows ? `${visible.length} з ${rows.length}` : "—"}</span>
          <span className={styles.cardSpacer} />
          <button type="button" className={`${styles.btn} ${styles.btnSm}`} disabled={loading} onClick={() => void load()}>
            {loading ? "Оновлюю…" : "Оновити"}
          </button>
        </div>
        <div className={ext.filterChips} role="group" aria-label="Стан треду">
          {STATUS_FILTERS.map((item) => (
            <button key={item} type="button" className={ext.filterChip} aria-pressed={status === item} onClick={() => setStatus(item)}>
              {STATUS_LABEL[item]} <span className={ext.filterCount}>{counts[item]}</span>
            </button>
          ))}
        </div>

        {loading && !rows ? <p className={ext.subtle}>Завантаження…</p> : null}
        {rows && visible.length === 0 ? (
          <p className={ext.emptyLine}>
            {rows.length === 0 ? "Звернень ще не було." : "У цьому стані тредів немає."}
            {rows.length > 0 && status !== "ALL" ? (
              <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} onClick={() => setStatus("ALL")}>Показати всі</button>
            ) : null}
          </p>
        ) : null}
        {rows && visible.length > 0 ? (
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Звернення">
            <table className={styles.table}>
              <caption>Звернення · {visible.length}</caption>
              <thead>
                <tr>
                  <th scope="col">Реф</th>
                  <th scope="col">Стан</th>
                  <th scope="col" className={ext.colWide}>Джерело</th>
                  <th scope="col">Тема</th>
                  <th scope="col">Хто</th>
                  <th scope="col">Вік</th>
                  <th scope="col" className={ext.colWide}>Оновлено</th>
                  <th scope="col">Уривок</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button type="button" className={ext.rowButton} onClick={() => void open(row.id)}>
                        {row.public_ref}
                      </button>
                    </td>
                    <td><span className={`${ext.chip} ${STATUS_TONE[row.status] ?? ""}`}>{row.status}</span></td>
                    <td className={ext.colWide}>{SOURCE_LABEL[row.source] ?? row.source}</td>
                    <td>{row.priority === "SECURITY" ? <span className={`${ext.chip} ${ext.chipRisk}`}>{topicText(row)}</span> : topicText(row)}</td>
                    <td className={styles.cellMono} title={row.context?.wallet ?? undefined}>{whoText(row)}</td>
                    <td className={styles.cellMono} title={formatDateTime(row.created_at)}>{formatAgo(row.created_at)}</td>
                    <td className={`${styles.cellMono} ${ext.colWide}`} title={formatDateTime(row.updated_at)}>{formatAgo(row.updated_at)}</td>
                    <td>{row.preview}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
