"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EnvelopeSimple } from "@phosphor-icons/react";

import { InfoControl } from "@/app/shell/info-control";
import type { GlobalBetaMode, UserAccessState } from "@/lib/admin/access";
import { LOGIN_KIND_LABEL, PRODUCT_EVENT_LABEL, type ProductEventName, type UserActivity } from "@/lib/admin/activity";
import {
  ADMIN_USER_CSV_HEADER,
  USER_FILTERS,
  USER_FILTER_LABEL,
  USER_PAGE_SIZES,
  USER_SORTS,
  USER_SORT_LABEL,
  adminUserCsvRow,
  parseUsersQuery,
  usersQueryToSearchParams,
  type AdminUserRow,
  type UsersQuery,
} from "@/lib/admin/users";

import styles from "../admin.module.css";
import { adminPost } from "../reverify";
import ext from "../panels.module.css";
import { formatAgo, formatDate, formatDateTime } from "../format";

const ACCESS_LABEL: Record<UserAccessState, string> = {
  REQUESTED: "Запит",
  ACTIVE: "Активний",
  PAUSED: "Пауза",
  REVOKED: "Відкликано",
  EXPIRED: "Закінчився",
};

type PageResponse = {
  mode: GlobalBetaMode;
  activity: "measured" | "not_collected" | "unavailable";
  query: UsersQuery;
  total: number;
  capped: boolean;
  rows: AdminUserRow[];
};

type DetailResponse = { activity: "measured"; detail: UserActivity } | { activity: "not_collected"; detail: null };

function LoginCell({ row, at, kind, store }: { row: AdminUserRow; at: string | null; kind?: string | null; store: PageResponse["activity"] }) {
  if (store === "unavailable") return <span className={ext.cellStatus}>джерело недоступне</span>;
  if (row.activity !== "measured") return <span className={ext.cellStatus}>не збирається</span>;
  if (!at) return <span className={ext.cellStatus}>ще не було</span>;
  return (
    <span title={formatDateTime(at)}>
      {formatAgo(at)}
      {kind ? <span className={ext.subtle}> · {LOGIN_KIND_LABEL[kind as keyof typeof LOGIN_KIND_LABEL] ?? kind}</span> : null}
    </span>
  );
}

function eventLabel(name: string): string {
  return (PRODUCT_EVENT_LABEL as Record<string, string>)[name as ProductEventName] ?? name;
}

export function UsersPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => parseUsersQuery(new URLSearchParams(searchParams.toString())), [searchParams]);
  const selectedKey = (searchParams.get("user") ?? "").trim();

  const [data, setData] = useState<PageResponse | null>(null);
  const [draft, setDraft] = useState(query.query ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "error">("idle");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [dmText, setDmText] = useState("");

  const navigate = useCallback(
    (next: Partial<UsersQuery>, extra: { user?: string | null } = {}) => {
      const merged: UsersQuery = { ...query, ...next };
      const params = usersQueryToSearchParams(merged);
      const user = extra.user === undefined ? (selectedKey || null) : extra.user;
      if (user) params.set("user", user);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, query, router, selectedKey],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = usersQueryToSearchParams(query);
      const r = await fetch(`/api/admin/users${params.toString() ? `?${params}` : ""}`);
      if (!r.ok) {
        setError(r.status === 401 ? "Сесія адміністратора закінчилась." : r.status === 503 ? "База не відповіла." : `Код ${r.status}`);
        setData(null);
        return;
      }
      setData((await r.json()) as PageResponse);
      setError(null);
    } catch {
      setError("Немає зв'язку із сервером.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setDraft(query.query ?? "");
  }, [query.query]);

  useEffect(() => {
    if (!selectedKey) return;
    document.querySelector<HTMLElement>('[data-user-drawer]')?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [selectedKey]);

  const selected = useMemo(
    () => (selectedKey && data ? data.rows.find((row) => row.key === selectedKey) ?? null : null),
    [data, selectedKey],
  );

  useEffect(() => {
    if (!selectedKey) {
      setDetail(null);
      setDetailState("idle");
      return;
    }
    let cancelled = false;
    setDetailState("loading");
    void (async () => {
      try {
        const r = await fetch(`/api/admin/users?detail=${encodeURIComponent(selectedKey)}`);
        if (cancelled) return;
        if (!r.ok) {
          setDetail(null);
          setDetailState("error");
          return;
        }
        setDetail((await r.json()) as DetailResponse);
        setDetailState("idle");
      } catch {
        if (!cancelled) {
          setDetail(null);
          setDetailState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  const postAccess = async (body: Record<string, unknown>) => {
    const r = await adminPost("/api/admin/users", body);
    const json = (await r.json()) as Record<string, unknown>;
    return { ok: r.ok, json };
  };

  const mutate = async (mutation: "grant" | "pause" | "revoke") => {
    if (!selected) return;
    setBusy(mutation);
    const { ok, json } = await postAccess({ telegram_id: selected.telegramId, mutation, reason });
    setMsg(ok ? `Доступ: ${ACCESS_LABEL[String(json.state) as UserAccessState] ?? String(json.state)}` : String(json.error ?? "не вдалося"));
    setBusy(null);
    if (ok) {
      setReason("");
      await load();
    }
  };

  const changeMode = async (next: GlobalBetaMode) => {
    setBusy("mode");
    const { ok, json } = await postAccess({ action: "mode", mode: next, reason: reason || "зміна режиму бети" });
    setMsg(ok ? `Режим: ${next}` : String(json.error ?? "не вдалося"));
    setBusy(null);
    if (ok) await load();
  };

  const sendDm = async () => {
    if (!selected) return;
    setBusy("dm");
    const r = await adminPost("/api/admin", { action: "message_user", telegram_id: selected.telegramId, text: dmText });
    const json = (await r.json()) as Record<string, unknown>;
    setMsg(r.ok ? "Надіслано" : String(json.error ?? "не вдалося"));
    setBusy(null);
    if (r.ok) setDmText("");
  };

  const exportCsv = () => {
    if (!data || data.rows.length === 0) return;
    const body = data.rows
      .map((row) => adminUserCsvRow(row).map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([String.fromCharCode(0xfeff) + ADMIN_USER_CSV_HEADER + "\n" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ryntra-users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : (query.page - 1) * query.size + 1;
  const to = Math.min(total, query.page * query.size);
  const lastPage = Math.max(1, Math.ceil(total / query.size));

  return (
    <div>
      <div className={styles.cardHead}>
        <h1 className={styles.pageTitle}>Користувачі та доступ</h1>
        <InfoControl label="Що тут видно">
          <p>
            Реєстрація — це створення акаунта. Перший і останній вхід — лише підтверджені сервером обміни
            посилання бота або підпису гаманця; перевірка cookie входом не є. Остання дія — дозволена змістовна
            дія, не перегляд сторінки. Доки сховище активності не застосоване, ці колонки кажуть «не збирається».
            Адреса гаманця тут не показується.
          </p>
        </InfoControl>
      </div>

      {msg ? (
        <p className={styles.banner} role="status" aria-live="polite">
          {msg}
        </p>
      ) : null}
      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          {error}
          <button type="button" className={styles.btn} onClick={() => void load()}>
            Спробувати ще раз
          </button>
        </div>
      ) : null}

      {selectedKey ? (
        <section className={styles.drawer} aria-label="Картка користувача" data-user-drawer>
          {selected ? (
            <>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>{selected.displayName}</h2>
                <span className={styles.cardNote}>{selected.telegramId !== null ? `id ${selected.telegramId}` : `акаунт ${(selected.accountId ?? "").slice(0, 8)}`}</span>
                <span className={`${styles.mark} ${selected.access === "ACTIVE" ? styles.markOk : styles.markOff}`}>{ACCESS_LABEL[selected.access]}</span>
                {selected.isOperator ? <span className={`${ext.chip} ${ext.chipMuted}`}>оператор · поза продуктовими показниками</span> : null}
                <span className={styles.cardSpacer} />
                <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} onClick={() => navigate({}, { user: null })}>
                  Закрити
                </button>
              </div>
              <dl className={ext.kv}>
                <div>
                  <dt>Зареєстровано</dt>
                  <dd className={ext.kvMono}>{formatDateTime(selected.registeredAt)}</dd>
                </div>
                <div>
                  <dt>Перший вхід</dt>
                  <dd className={ext.kvMono}>{selected.activity === "measured" ? (selected.firstLoginAt ? formatDateTime(selected.firstLoginAt) : "ще не було") : data?.activity === "unavailable" ? "джерело недоступне" : "не збирається"}</dd>
                </div>
                <div>
                  <dt>Останній вхід</dt>
                  <dd className={ext.kvMono}>
                    {selected.activity === "measured" ? (selected.lastLoginAt ? formatDateTime(selected.lastLoginAt) : "ще не було") : data?.activity === "unavailable" ? "джерело недоступне" : "не збирається"}
                    {selected.lastLoginKind ? <span className={ext.subtle}> · {LOGIN_KIND_LABEL[selected.lastLoginKind]}</span> : null}
                  </dd>
                </div>
                <div>
                  <dt>Остання дія</dt>
                  <dd className={ext.kvMono}>{selected.activity === "measured" ? (selected.lastActivityAt ? formatDateTime(selected.lastActivityAt) : "ще не було") : data?.activity === "unavailable" ? "джерело недоступне" : "не збирається"}</dd>
                </div>
                <div>
                  <dt>Входів · дій за 30 дн · помилок за 7 дн</dt>
                  <dd className={ext.kvMono}>{selected.activity === "measured" ? `${selected.loginCount ?? 0} · ${selected.events30d ?? 0} · ${selected.errors7d ?? 0}` : data?.activity === "unavailable" ? "джерело недоступне" : "не збирається"}</dd>
                </div>
                <div>
                  <dt>Доступ</dt>
                  <dd>{ACCESS_LABEL[selected.access]} <span className={ext.subtle}>· {selected.accessSource === "control" ? "керування" : "спадкове поле"}</span></dd>
                </div>
                <div>
                  <dt>Гаманець</dt>
                  <dd>{selected.walletLinked === null ? "невідомо" : selected.walletLinked ? "прив'язано підписом" : "не прив'язано"}{selected.hasWatchAddress ? <span className={ext.subtle}> · є адреса на алертах</span> : null}</dd>
                </div>
                <div>
                  <dt>Мова · paper · запрошення</dt>
                  <dd className={ext.kvMono}>{selected.locale || "—"} · {selected.paperActions} · {selected.invites}</dd>
                </div>
              </dl>

              <div className={styles.cardHead}>
                <h3 className={styles.cardTitle}>Хронологія</h3>
                <span className={styles.cardNote}>входи й дозволені дії, без сум</span>
              </div>
              {detailState === "loading" ? <p className={ext.subtle}>Завантаження…</p> : null}
              {detailState === "error" ? <p className={`${styles.banner} ${styles.bannerError}`}>Хронологія не завантажилась.</p> : null}
              {detail?.activity === "not_collected" ? (
                <p className={ext.emptyLine}>Історія входів і дій ще не збирається. <Link href="/admin/operations#coverage">Покриття</Link></p>
              ) : null}
              {detail?.activity === "measured" && detail.detail.timeline.length === 0 ? (
                <p className={ext.emptyLine}>Записаних входів чи дій ще немає.</p>
              ) : null}
              {detail?.activity === "measured" && detail.detail.timeline.length > 0 ? (
                <ol className={ext.timeline}>
                  {detail.detail.timeline.map((entry, index) => (
                    <li key={`${entry.at}-${index}`} className={ext.timelineItem}>
                      <span className={ext.timelineAt}>{formatDateTime(entry.at)}</span>
                      <span className={ext.timelineName}>
                        {entry.type === "login"
                          ? `Вхід · ${LOGIN_KIND_LABEL[entry.name as keyof typeof LOGIN_KIND_LABEL] ?? entry.name}${entry.admin ? " · адмінка" : entry.target ? ` · ${entry.target}` : ""}`
                          : eventLabel(entry.name)}
                      </span>
                      <span className={`${ext.chip} ${entry.outcome === "ok" ? ext.chipOk : entry.outcome === "error" ? ext.chipRisk : ext.chipWarn}`}>
                        {entry.outcome === "ok" ? "ок" : entry.outcome === "error" ? `помилка${entry.errorClass ? ` · ${entry.errorClass}` : ""}` : "відмова"}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Причина дії</span>
                <input className={styles.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="мінімум 3 символи — потрапляє в аудит" />
              </label>
              <div className={styles.btnRow}>
                <button type="button" className={styles.btn} disabled={selected.telegramId === null || busy !== null || reason.trim().length < 3} onClick={() => void mutate("grant")}>
                  Надати доступ
                </button>
                <button type="button" className={styles.btn} disabled={selected.telegramId === null || busy !== null || reason.trim().length < 3} onClick={() => void mutate("pause")}>
                  Пауза
                </button>
                <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={selected.telegramId === null || busy !== null || reason.trim().length < 3} onClick={() => void mutate("revoke")}>
                  Відкликати
                </button>
              </div>
              <div className={styles.dmRow}>
                <div className={ext.inlineActions}>
                  <EnvelopeSimple size={16} weight="bold" aria-hidden="true" />
                  <input
                    className={`${styles.input} ${ext.grow}`}
                    value={dmText}
                    onChange={(e) => setDmText(e.target.value)}
                    placeholder="Пряме повідомлення через бота"
                    aria-label="Пряме повідомлення"
                  />
                  <button type="button" className={styles.btn} disabled={selected.telegramId === null || dmText.trim().length < 2 || busy === "dm"} onClick={() => void sendDm()}>
                    Надіслати
                  </button>
                  <Link className={`${styles.btn} ${styles.btnGhost}`} href="/admin/feedback">
                    Звернення
                  </Link>
                </div>
              </div>
            </>
          ) : (
            <p className={ext.emptyLine}>
              {loading ? "Завантаження…" : "Цього користувача немає на поточній сторінці."}
              <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} onClick={() => navigate({ query: selectedKey, filter: "all", page: 1 })}>
                Знайти за id
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} onClick={() => navigate({}, { user: null })}>
                Закрити
              </button>
            </p>
          )}
        </section>
      ) : null}

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Список</h2>
          <span className={styles.cardNote}>
            {data ? `${total.toLocaleString("uk-UA")}${data.capped ? "+" : ""} у вибірці` : "—"}
          </span>
          {data && data.activity !== "measured" ? (
            <span className={`${ext.chip} ${data.activity === "unavailable" ? ext.chipRisk : ext.chipMuted}`}>
              {data.activity === "unavailable" ? "сховище активності не відповіло" : "входи й дії ще не збираються"}
            </span>
          ) : null}
          <span className={styles.cardSpacer} />
          <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} disabled={rows.length === 0} onClick={exportCsv}>
            CSV сторінки
          </button>
        </div>

        <form
          className={ext.filters}
          onSubmit={(event) => {
            event.preventDefault();
            navigate({ query: draft.trim() || null, page: 1 });
          }}
        >
          <input
            className={`${styles.input} ${ext.grow}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="@нік, ім'я, id або код"
            spellCheck={false}
            aria-label="Пошук користувачів"
          />
          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? "Шукаю…" : "Пошук"}
          </button>
          <select
            className={`${styles.select} ${ext.selectNarrow}`}
            aria-label="Фільтр"
            value={query.filter}
            onChange={(e) => navigate({ filter: e.target.value as UsersQuery["filter"], page: 1 })}
          >
            {USER_FILTERS.map((filter) => (
              <option key={filter} value={filter}>{USER_FILTER_LABEL[filter]}</option>
            ))}
          </select>
          <select
            className={`${styles.select} ${ext.selectNarrow}`}
            aria-label="Сортування"
            value={query.sort}
            onChange={(e) => navigate({ sort: e.target.value as UsersQuery["sort"], page: 1 })}
          >
            {USER_SORTS.map((sort) => (
              <option key={sort} value={sort}>{USER_SORT_LABEL[sort]}</option>
            ))}
          </select>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            aria-label={query.dir === "desc" ? "За спаданням" : "За зростанням"}
            onClick={() => navigate({ dir: query.dir === "desc" ? "asc" : "desc", page: 1 })}
          >
            {query.dir === "desc" ? "↓" : "↑"}
          </button>
        </form>

        {rows.length === 0 && !loading ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>
              {query.query || query.filter !== "all" ? "За цим запитом нікого не знайдено" : "Користувачів ще немає"}
            </p>
            {query.query || query.filter !== "all" ? (
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => navigate({ query: null, filter: "all", page: 1 })}>
                Скинути фільтри
              </button>
            ) : null}
          </div>
        ) : null}

        {rows.length > 0 ? (
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Користувачі">
            <table className={`${styles.table} ${styles.tableWide}`}>
              <caption>
                Користувачі · {from}–{to} з {total.toLocaleString("uk-UA")}{data?.capped ? "+" : ""}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Користувач</th>
                  <th scope="col">Доступ</th>
                  <th scope="col" className={ext.colWide}>Зареєстровано</th>
                  <th scope="col">Перший вхід</th>
                  <th scope="col">Останній вхід</th>
                  <th scope="col">Остання дія</th>
                  <th scope="col" className={ext.colWide}>Paper</th>
                  <th scope="col" className={ext.colWide}>Гаманець</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.key} aria-selected={u.key === selectedKey || undefined}>
                    <td>
                      <button type="button" className={ext.rowButton} onClick={() => navigate({}, { user: u.key })}>
                        {u.displayName}
                      </button>
                      {u.isOperator ? <span className={`${ext.chip} ${ext.chipMuted}`}>оператор</span> : null}
                      {(u.errors7d ?? 0) > 0 ? <span className={`${ext.chip} ${ext.chipWarn}`}>помилки · {u.errors7d}</span> : null}
                    </td>
                    <td>
                      <span className={`${styles.mark} ${u.access === "ACTIVE" ? styles.markOk : styles.markOff}`}>
                        {ACCESS_LABEL[u.access]}
                      </span>
                    </td>
                    <td className={`${styles.cellMono} ${ext.colWide}`}>{formatDate(u.registeredAt)}</td>
                    <td><LoginCell row={u} at={u.firstLoginAt} store={data?.activity ?? "not_collected"} /></td>
                    <td><LoginCell row={u} at={u.lastLoginAt} kind={u.lastLoginKind} store={data?.activity ?? "not_collected"} /></td>
                    <td><LoginCell row={u} at={u.lastActivityAt} store={data?.activity ?? "not_collected"} /></td>
                    <td className={`${styles.cellNum} ${ext.colWide}`}>{u.paperActions}</td>
                    <td className={ext.colWide}>{u.walletLinked === null ? <span className={ext.cellStatus}>невідомо</span> : u.walletLinked ? "прив'язано" : "ні"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {total > 0 ? (
          <div className={ext.pager}>
            <span className={ext.pagerRange}>{from}–{to} з {total.toLocaleString("uk-UA")}{data?.capped ? "+" : ""}</span>
            <button type="button" className={`${styles.btn} ${styles.btnSm}`} disabled={query.page <= 1} onClick={() => navigate({ page: query.page - 1 })}>
              Назад
            </button>
            <button type="button" className={`${styles.btn} ${styles.btnSm}`} disabled={query.page >= lastPage} onClick={() => navigate({ page: query.page + 1 })}>
              Далі
            </button>
            <select
              className={`${styles.select} ${ext.selectNarrow}`}
              aria-label="Розмір сторінки"
              value={query.size}
              onChange={(e) => navigate({ size: Number(e.target.value), page: 1 })}
            >
              {USER_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>{size} на сторінці</option>
              ))}
            </select>
            {data?.capped ? <span>список обрізано на 500 рядках — підсумок є нижньою межею</span> : null}
          </div>
        ) : null}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Режим бети</h2>
          <span className={styles.cardNote}>{data?.mode ?? "—"}</span>
        </div>
        <div className={styles.btnRow}>
          {(["OPEN_CONFIRM", "MANUAL_APPROVAL", "CLOSED"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`${styles.btn} ${data?.mode === item ? styles.btnPrimary : ""}`}
              disabled={busy === "mode" || !data}
              onClick={() => void changeMode(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <label className={`${styles.field} ${styles.reasonField}`}>
          <span className={styles.fieldLabel}>Причина зміни режиму</span>
          <input className={styles.input} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </section>
    </div>
  );
}
