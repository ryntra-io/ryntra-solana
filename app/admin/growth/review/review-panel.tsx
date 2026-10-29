"use client";

import { useCallback, useEffect, useState } from "react";
import { Warning } from "@phosphor-icons/react";

import { InfoControl } from "@/app/shell/info-control";
import type { QueueCase, QueuePool, ReviewQueue } from "@/lib/growth/review-queue";

import styles from "../../admin.module.css";
import ext from "../../panels.module.css";
import { formatDateTime } from "../../format";
import { adminPost } from "../../reverify";
import own from "./review.module.css";

/**
 * The review queue of the Growth line: cases first (the overdue at the top),
 * each with its signals, trust, due time and what it holds; a decision always
 * with a reason. Below, every partner's pool with its activation and money.
 * The detail of a case — its history, the hashed evidence — opens on a tap.
 */

const SIGNAL_LABEL: Record<string, string> = {
  S1_SHARED_FUNDING: "Спільне джерело коштів творця й партнера",
  S2_DIRECT_FUNDS: "Гроші між творцем і партнером",
  S3_SHARED_WITHDRAWAL: "Спільна адреса виводу",
  S4_SHARED_DEVICE: "Один пристрій чи мережа",
  S4_DEVICE_CROWD: "3+ гаманці на пристрої партнера",
  S5_YOUNG_WALLETS: "Активували молоді гаманці",
  S6_ROUND_TRIP: "Туди-назад на пулі",
  UNVERIFIED: "Перевірку не завершено автоматично",
};
const DECISION_LABEL: Record<string, string> = { CLEAR: "сплачувати", ADJUST: "знижено", CANCEL: "скасовано" };
const EVENT_LABEL: Record<string, string> = { OPENED: "Відкрито", SIGNALS: "Нові сигнали", APPEALED: "Апеляція", DECIDED: "Рішення", FROZEN: "Заморожено", UNFROZEN: "Розморожено" };
const EFFECT_LABEL: Record<string, string> = { PAY: "сплачується", HOLD: "утримано", CEILING: "зі стелею", CANCEL: "скасовано" };

const short = (value: string) => (value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value);
const usd = (micros: string | null | undefined) => {
  if (micros === null || micros === undefined) return "—";
  const value = Number(BigInt(micros)) / 1_000_000;
  return `$${value.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function stateChip(item: QueueCase) {
  if (item.state === "OPEN") {
    return item.overdue ? (
      <span className={`${ext.chip} ${ext.chipRisk}`}>прострочено</span>
    ) : (
      <span className={`${ext.chip} ${ext.chipWarn}`}>до {formatDateTime(item.dueAt)}</span>
    );
  }
  if (item.decision) {
    const tone = item.decision.kind === "CLEAR" ? ext.chipOk : item.decision.kind === "CANCEL" ? ext.chipRisk : ext.chipWarn;
    return <span className={`${ext.chip} ${tone}`}>{item.decision.kind === "ADJUST" ? `до ${usd(item.decision.ceilingUsdMicros)}` : DECISION_LABEL[item.decision.kind]}</span>;
  }
  return <span className={`${ext.chip} ${ext.chipMuted}`}>без справи</span>;
}

/** The pools table's own step: a source several active addresses share, marked an exchange or a bridge — with a reason. */
function SharedSources({ pool, onDone }: { pool: QueuePool; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Record<string, string>>({});
  const sources = pool.activity?.sharedSources ?? [];
  if (!sources.length) return <span className={ext.subtle}>—</span>;
  const reveal = async (hash: string) => {
    setBusy(true);
    try {
      const response = await adminPost("/api/admin/growth/review", { action: "reveal", network: pool.network, pool: pool.pool, hash });
      const body = (await response.json().catch(() => ({}))) as { address?: string | null };
      setShown((current) => ({ ...current, [hash]: body.address ?? "не знайдено" }));
    } finally {
      setBusy(false);
    }
  };
  const mark = async (hash: string) => {
    const note = window.prompt("Чому це біржа чи міст? Причина лишиться в записі.")?.trim();
    if (!note) return;
    setBusy(true);
    try {
      await adminPost("/api/admin/growth/review", { action: "hub", hash, note });
      await onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className={own.details}>
      <summary>
        {sources.length} спільн{sources.length === 1 ? "е" : "і"}
      </summary>
      {sources.map((source) => (
        <div key={source.hash} className={own.evidenceRow}>
          <span className={styles.mono}>{source.hash.slice(3, 15)}</span>
          <span className={ext.subtle}>гаманців: {source.wallets}</span>
          {shown[source.hash] ? (
            shown[source.hash]!.length > 30 ? (
              <a className={styles.mono} href={`https://solscan.io/account/${shown[source.hash]}`} target="_blank" rel="noreferrer">
                {shown[source.hash]}
              </a>
            ) : (
              <span className={ext.subtle}>{shown[source.hash]}</span>
            )
          ) : (
            <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} disabled={busy} onClick={() => void reveal(source.hash)}>
              Показати адресу
            </button>
          )}
          <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} disabled={busy || !shown[source.hash]} onClick={() => void mark(source.hash)}>
            Це біржа чи міст
          </button>
        </div>
      ))}
    </details>
  );
}

function CaseCard({ item, pool, onDone }: { item: QueueCase; pool: QueuePool | undefined; onDone: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [ceiling, setCeiling] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const act = async (body: Record<string, unknown>) => {
    if (!note.trim()) {
      setMessage("Напишіть причину — вона лишиться в історії справи.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await adminPost("/api/admin/growth/review", { ...body, note: note.trim() });
      if (!response.ok) {
        const error = ((await response.json().catch(() => ({}))) as { error?: string }).error;
        setMessage(error === "bad_amount" ? "Сума — у доларах, наприклад 12.50." : error === "NOT_OPEN" ? "Справа вже вирішена." : error === "ALREADY_FROZEN" ? "Гаманець уже заморожено." : error === "STALE" ? "Справа змінилась — оновлюю; перегляньте нові сигнали." : "Не вдалося — спробуйте ще раз.");
        return;
      }
      setNote("");
      setCeiling("");
      await onDone();
      return;
    } finally {
      setBusy(false);
    }
  };
  const wallet = item.pool ? `wallet:${item.pool.partner}` : item.subject;
  const seen = item.events.length ? item.events[item.events.length - 1]!.seq : -1;

  return (
    <li className={own.case}>
      <div className={own.caseHead}>
        <span className={own.caseTitle}>{item.kind === "pool" ? `Пул ${short(item.pool?.pool ?? item.subject.split(":")[2] ?? "")}` : `Гаманець ${short(item.subject.split(":")[1] ?? "")}`}</span>
        {stateChip(item)}
        {item.frozen ? <span className={`${ext.chip} ${ext.chipRisk}`}>заморожено</span> : null}
        {item.appealed ? <span className={`${ext.chip} ${ext.chipWarn}`}>апеляція</span> : null}
        <span className={styles.cardSpacer} />
        {item.signals.length ? <span className={ext.subtle}>довіра {item.trust}</span> : null}
      </div>
      {item.signals.length ? <p className={own.signals}>{item.signals.map((code) => SIGNAL_LABEL[code] ?? code).join(" · ")}</p> : null}
      {pool ? (
        <p className={ext.subtle}>
          {pool.activated ? "Творець активований" : `Незалежних адрес: ${pool.activity?.independent ?? 0} з 3`} · зароблено {usd(pool.earnedUsdMicros)} · утримано {usd(pool.heldUsdMicros)}
        </p>
      ) : null}
      <details className={own.details}>
        <summary>Подробиці й рішення</summary>
        {item.pool ? (
          <dl className={own.facts}>
            <dt>Творець</dt>
            <dd className={styles.mono}>{item.pool.creator}</dd>
            <dt>Партнер</dt>
            <dd className={styles.mono}>{item.pool.partner}</dd>
            <dt>Запуск</dt>
            <dd>{formatDateTime(item.pool.launchedAt)}</dd>
            {pool?.activity ? (
              <>
                <dt>Обсяг</dt>
                <dd>
                  {usd(pool.activity.volumeUsdMicros)}, з них команда {usd(pool.activity.teamVolumeUsdMicros)}, творець і партнер {usd(pool.activity.insiderVolumeUsdMicros)}
                </dd>
              </>
            ) : null}
          </dl>
        ) : null}
        {item.unreadable ? <p className={`${styles.hint} ${styles.hintWarn}`}>Частину історії не прочитано — гроші утримано, доки її не відновлено.</p> : null}
        <ol className={ext.timeline}>
          {item.events.map((event) => (
            <li key={event.seq} className={ext.timelineItem}>
              <span className={ext.timelineAt}>{formatDateTime(event.at)}</span>
              <span className={ext.timelineName}>
                {EVENT_LABEL[event.kind] ?? event.kind}
                {event.decision ? `: ${DECISION_LABEL[event.decision]}${event.ceilingUsdMicros ? ` до ${usd(event.ceilingUsdMicros)}` : ""}` : ""}
                {event.signals?.length ? `: ${event.signals.map((code) => SIGNAL_LABEL[code] ?? code).join(", ")}` : ""}
              </span>
              {event.note ? <span className={ext.subtle}>{event.by === "person" ? "Людина: " : event.by === "system" ? "" : `${event.by}: `}{event.note}</span> : null}
            </li>
          ))}
        </ol>
        {item.evidence.length ? (
          <div className={own.evidence}>
            <span className={styles.fieldLabel}>Відбитки сигналів (зберігаються до {formatDateTime(item.evidence[0]!.expiresAt)})</span>
            {item.evidence.map((row) => (
              <div key={`${row.code}:${row.hash}`} className={own.evidenceRow}>
                <span className={styles.mono}>{row.hash.slice(3, 15)}</span>
                <span className={ext.subtle}>{SIGNAL_LABEL[row.code] ?? row.code}</span>
                {row.code === "S1_SHARED_FUNDING" || row.code === "S3_SHARED_WITHDRAWAL" ? (
                  <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} disabled={busy} onClick={() => void act({ action: "hub", hash: row.hash })}>
                    Це біржа чи міст
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Причина рішення</span>
          <textarea className={`${styles.textarea} ${own.note}`} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="Що перевірено і чому так" />
        </label>
        <div className={own.actions}>
          {item.state === "OPEN" ? (
            <>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => void act({ action: "decide", subject: item.subject, decision: "CLEAR", seen })}>
                Сплатити
              </button>
              {item.kind === "pool" ? (
                <span className={own.adjust}>
                  <input className={`${styles.input} ${own.amount}`} inputMode="decimal" value={ceiling} onChange={(event) => setCeiling(event.target.value)} placeholder="$" aria-label="Сплатити не більше, доларів" />
                  <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={busy || !ceiling.trim()} onClick={() => void act({ action: "decide", subject: item.subject, decision: "ADJUST", ceilingUsd: ceiling, seen })}>
                    Знизити
                  </button>
                </span>
              ) : null}
              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={busy} onClick={() => void act({ action: "decide", subject: item.subject, decision: "CANCEL", seen })}>
                Скасувати
              </button>
            </>
          ) : null}
          {item.kind === "pool" ? (
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={busy} onClick={() => void act({ action: "freeze", subject: wallet })}>
              Заморозити гаманець партнера
            </button>
          ) : (
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={busy} onClick={() => void act({ action: item.frozen ? "unfreeze" : "freeze", subject: item.subject })}>
              {item.frozen ? "Розморозити" : "Заморозити"}
            </button>
          )}
        </div>
        {message ? <p className={`${styles.hint} ${styles.hintWarn}`} role="status">{message}</p> : null}
      </details>
    </li>
  );
}

export function ReviewPanel() {
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/growth/review", { cache: "no-store" });
      if (!response.ok) {
        setError(response.status === 401 ? "Сесія адміністратора закінчилась." : `Черга недоступна (код ${response.status}).`);
        return;
      }
      setQueue((await response.json()) as ReviewQueue);
      setError(null);
    } catch {
      setError("Немає зв'язку із сервером.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pools = new Map((queue?.pools ?? []).map((pool) => [`pool:${pool.network}:${pool.pool}`, pool]));

  return (
    <>
      <section className={styles.card} aria-labelledby="growth-review-title">
        <div className={styles.cardHead}>
          <h2 id="growth-review-title" className={styles.cardTitle}>Перевірка Росту</h2>
          <InfoControl label="Як це працює">
            <p>
              Підозріле не стає «доступним» само: справа тримає гроші, доки ви не вирішите. Справа відкривається на один жорсткий
              сигнал (спільне джерело коштів, гроші між творцем і партнером, спільна адреса виводу, один пристрій) або два м&apos;які
              (молоді гаманці, туди-назад), а також коли автоматична перевірка не змогла побачити все. Людині відповідаємо протягом 72 годин; причин вона не бачить. Біржу чи міст позначаєте ви: «Показати адресу» → «Це біржа чи міст». Гроші партнера за пул
              чекають і доки творець не активований — три незалежні зовнішні адреси з реальними угодами за 30 днів.
            </p>
          </InfoControl>
          <span className={styles.cardSpacer} />
          <a className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} href="/admin/growth/payouts">
            Виплати партнерам
          </a>
          {queue ? (
            <>
              <span className={`${ext.chip} ${queue.counts.overdue ? ext.chipRisk : queue.counts.open ? ext.chipWarn : ext.chipOk}`}>
                {queue.counts.open ? `відкритих: ${queue.counts.open}${queue.counts.overdue ? `, прострочених: ${queue.counts.overdue}` : ""}` : "черга порожня"}
              </span>
              {queue.counts.frozen ? <span className={`${ext.chip} ${ext.chipRisk}`}>заморожено: {queue.counts.frozen}</span> : null}
            </>
          ) : null}
        </div>
        {error ? (
          <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
            <Warning size={17} weight="bold" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}
        {queue ? (
          queue.cases.length ? (
            <ul className={own.cases}>
              {queue.cases.map((item) => (
                <CaseCard key={item.subject} item={item} pool={pools.get(item.subject)} onDone={load} />
              ))}
            </ul>
          ) : (
            <p className={ext.emptyLine}>Справ немає.</p>
          )
        ) : !error ? (
          <div className={styles.skeleton} aria-hidden="true" />
        ) : null}
      </section>

      {queue?.hubs.length ? (
        <section className={styles.card} aria-labelledby="growth-hubs-title">
          <div className={styles.cardHead}>
            <h2 id="growth-hubs-title" className={styles.cardTitle}>Біржі й мости</h2>
          </div>
          {queue.hubs.map((hub) => (
            <div key={hub.hash} className={own.evidenceRow}>
              <span className={styles.mono}>{hub.hash.slice(3, 15)}</span>
              <span className={ext.subtle}>
                {hub.note} · {hub.by} · {formatDateTime(hub.at)}
              </span>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                onClick={async () => {
                  const note = window.prompt("Чому зняти позначку?")?.trim();
                  if (!note) return;
                  await adminPost("/api/admin/growth/review", { action: "unhub", hash: hub.hash, note });
                  await load();
                }}
              >
                Зняти позначку
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <section className={styles.card} aria-labelledby="growth-pools-title">
        <div className={styles.cardHead}>
          <h2 id="growth-pools-title" className={styles.cardTitle}>Пули партнерів</h2>
          <span className={styles.cardSpacer} />
          {queue?.counts.awaitingActivation ? <span className={`${ext.chip} ${ext.chipMuted}`}>чекають активації: {queue.counts.awaitingActivation}</span> : null}
        </div>
        {queue && queue.pools.length === 0 ? <p className={ext.emptyLine}>Пулів із партнером ще немає.</p> : null}
        {queue && queue.pools.length ? (
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Пули партнерів">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Пул</th>
                  <th scope="col">Партнер</th>
                  <th scope="col">Творець</th>
                  <th scope="col" className={styles.cellNum}>Обсяг · команда</th>
                  <th scope="col">Спільні джерела</th>
                  <th scope="col">Гроші</th>
                  <th scope="col" className={styles.cellNum}>Зароблено</th>
                  <th scope="col" className={styles.cellNum}>Утримано</th>
                </tr>
              </thead>
              <tbody>
                {queue.pools.map((pool) => (
                  <tr key={`${pool.network}:${pool.pool}`}>
                    <td className={styles.cellMono}>{short(pool.pool)}</td>
                    <td className={styles.cellMono}>{short(pool.partner)}</td>
                    <td>
                      {pool.activated ? `активований ${formatDateTime(pool.activatedAt)}` : `${pool.activity?.independent ?? 0} з 3`}
                      {pool.activity && !pool.activity.partiesComplete ? <span className={`${ext.chip} ${ext.chipWarn}`}>читання сторін неповне</span> : null}
                    </td>
                    <td className={styles.cellNum}>
                      {usd(pool.activity?.volumeUsdMicros)} · {usd(pool.activity?.teamVolumeUsdMicros)}
                    </td>
                    <td>
                      <SharedSources pool={pool} onDone={load} />
                    </td>
                    <td>{pool.activated || pool.effect !== "PAY" ? EFFECT_LABEL[pool.effect] ?? pool.effect : "чекає активації"}</td>
                    <td className={styles.cellNum}>{usd(pool.earnedUsdMicros)}</td>
                    <td className={styles.cellNum}>{usd(pool.heldUsdMicros)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}
