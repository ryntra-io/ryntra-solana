"use client";

import { BellRinging, ClockCountdown, Pause, Play, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AssistantPushState, AssistantTask, AssistantTaskAsk, AssistantTaskCreate, AssistantTasksResponse } from "@/lib/api/v1/contract";

import type { RynWord } from "./ryn-words";
import styles from "./tasks-panel.module.css";
import { creditsWord } from "./credits-store";
import { TokenPicker, type Token } from "./watch-panel";

/**
 * «Доручення» (AI-19; a tab of its own since AI-20, beside «Стежу»): questions Ryntra asks itself on a schedule — every 10 minutes, every hour or
 * daily at a time — and whose answers come to the inbox, Telegram and push while the computer is off. The price of a
 * run (one question) and of a day is shown before «Увімкнути»; nothing is turned on without it. Beside them, push on
 * this computer: one press, the browser's own permission.
 */

type Word = (w: RynWord) => string;
const HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;
type Kind = AssistantTaskAsk["kind"];
type Every = AssistantTask["every"];
const KINDS: readonly (readonly [Kind, RynWord])[] = [
  ["question", "taskKindQuestion"],
  ["news", "taskKindNews"],
  ["move", "taskKindMove"],
  ["portfolio", "taskKindPortfolio"],
];
const EVERY: readonly (readonly [Every, RynWord])[] = [
  ["10m", "taskEvery10m"],
  ["30m", "taskEvery30m"],
  ["1h", "taskEvery1h"],
  ["1d", "taskEvery1d"],
];
const fill = (template: string, values: Readonly<Record<string, string | number>>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

function ownZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Kyiv";
  } catch {
    return "Europe/Kyiv";
  }
}

async function codeOf(response: Response): Promise<string | null> {
  try {
    return ((await response.json()) as { error?: { code?: string } }).error?.code ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ push on this computer */

type PushPhase = "unsupported" | "off" | "on" | "blocked" | "unavailable";

function supported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((base64url.length + 3) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(subscription: PushSubscription, publicKey: string): boolean {
  const held = subscription.options.applicationServerKey;
  if (!held) return true;
  const want = keyBytes(publicKey);
  const have = new Uint8Array(held);
  return have.length === want.length && have.every((byte, index) => byte === want[index]);
}

/** «Сповіщення на цьому комп'ютері»: the browser's permission once, a subscription Ryntra wakes with an empty push. */
export function ComputerPush({ word }: { word: Word }) {
  const [phase, setPhase] = useState<PushPhase | null>(null);
  const [state, setState] = useState<AssistantPushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      if (!supported()) return live && setPhase("unsupported");
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        let subscription = (await registration?.pushManager.getSubscription()) ?? null;
        const response = await fetch("/api/v1/assistant/push", { headers: { ...HEADERS, ...(subscription ? { "x-ryntra-push-endpoint": subscription.endpoint } : {}) }, credentials: "same-origin", cache: "no-store" });
        const body = response.ok ? ((await response.json()) as AssistantPushState) : null;
        if (!live) return;
        setState(body);
        if (!body?.configured || !body.publicKey) return setPhase("unavailable");
        if (Notification.permission === "denied") return setPhase("blocked");
        if (!registration || !subscription) return setPhase("off");
        /* The deployment's key was replaced: the old subscription is dead — this browser subscribes anew on its own. */
        if (!sameKey(subscription, body.publicKey)) {
          await fetch("/api/v1/assistant/push", { method: "DELETE", headers: HEADERS, credentials: "same-origin", body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => null);
          await subscription.unsubscribe();
          if (Notification.permission !== "granted") return live && setPhase("off");
          try {
            subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(body.publicKey) });
          } catch {
            /* Some browsers subscribe only on a tap: «Увімкнути» stays for it. */
            return live && setPhase("off");
          }
        } else if (body.thisBrowser) return setPhase("on");
        /* This browser's subscription is made the wallet's now — it may have been another wallet's on this computer. */
        const again = await fetch("/api/v1/assistant/push", { method: "POST", headers: HEADERS, credentials: "same-origin", body: JSON.stringify({ endpoint: subscription.endpoint }) });
        if (!live) return;
        if (again.ok) setState((await again.json()) as AssistantPushState);
        setPhase(again.ok ? "on" : "off");
      } catch {
        if (live) setPhase("unavailable");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const turnOn = async () => {
    if (!state?.publicKey || busy) return;
    setBusy(true);
    setError(false);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPhase(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/ryntra-push-sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const held = await registration.pushManager.getSubscription();
      if (held && !sameKey(held, state.publicKey)) await held.unsubscribe();
      const subscription = held && sameKey(held, state.publicKey) ? held : await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(state.publicKey) });
      const response = await fetch("/api/v1/assistant/push", { method: "POST", headers: HEADERS, credentials: "same-origin", body: JSON.stringify({ endpoint: subscription.endpoint }) });
      if (!response.ok) throw new Error(String(response.status));
      setState((await response.json()) as AssistantPushState);
      setPhase("on");
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/v1/assistant/push", { method: "DELETE", headers: HEADERS, credentials: "same-origin", body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => null);
        await subscription.unsubscribe();
      }
      setPhase("off");
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  if (phase === null) return null;
  return (
    <div className={styles.push} data-phase={phase}>
      <BellRinging size={18} weight="duotone" aria-hidden="true" />
      <div className={styles.pushText}>
        <p className={styles.pushTitle}>{word("pushTitle")}</p>
        <p className={styles.lead}>
          {phase === "on" ? word("pushOn") : phase === "blocked" ? word("pushBlocked") : phase === "unsupported" ? word("pushUnsupported") : phase === "unavailable" ? word("pushUnavailable") : word("pushOff")}
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            {word("pushFailed")}
          </p>
        ) : null}
      </div>
      {phase === "off" ? (
        <button type="button" className="rw-btn" onClick={() => void turnOn()} disabled={busy} aria-busy={busy}>
          {word("pushTurnOn")}
        </button>
      ) : phase === "on" ? (
        <button type="button" className={styles.quiet} onClick={() => void turnOff()} disabled={busy}>
          {word("pushTurnOff")}
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ the tasks */

function TaskRow({ task, word, locale, busy, price, onPatch, onRemove }: { task: AssistantTask; word: Word; locale: WorkspaceLocale; busy: boolean; /** The price of a run now — what «Продовжити» shows and sends. */ price: number; onPatch: (body: Record<string, unknown>) => void; onRemove: () => void }) {
  const tag = locale === "uk" ? "uk-UA" : "en-GB";
  const when = (iso: string) => new Date(iso).toLocaleString(tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const paused = task.status === "paused";
  return (
    <li className={styles.task} data-status={task.status}>
      <div className={styles.taskHead}>
        <a className={styles.taskName} href={task.href}>
          {task.name}
        </a>
        <span className={styles.rhythm}>
          <ClockCountdown size={14} weight="bold" aria-hidden="true" />
          {task.rhythm}
        </span>
      </div>
      <p className={styles.lead}>
        {paused
          ? task.pausedBy === "credits"
            ? word("taskPausedCredits")
            : task.pausedBy === "price"
              ? word("taskPausedPrice")
              : word("taskPaused")
          : task.nextRunAt
            ? fill(word("taskNext"), { time: when(task.nextRunAt) })
            : null}
        {" · "}
        {paused ? fill(word("taskPriceNow"), { run: price }) : fill(word("taskPrice"), { run: task.priceCredits, day: task.perDayCredits })}
      </p>
      {task.skippedAt ? <p className={styles.last}>{fill(word("taskSkipped"), { time: when(task.skippedAt) })}</p> : null}
      {task.last ? (
        <p className={styles.last}>
          {fill(word("taskLast"), { time: when(task.last.at) })} {task.last.headline}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button type="button" className={styles.quiet} disabled={busy} onClick={() => onPatch(paused ? { ifVersion: task.version, status: "active", acceptCredits: undefined } : { ifVersion: task.version, status: "paused" })}>
          {paused ? <Play size={14} weight="bold" aria-hidden="true" /> : <Pause size={14} weight="bold" aria-hidden="true" />}
          <span>{paused ? fill(word("taskResumeAt"), { run: price }) : word("taskPause")}</span>
        </button>
        <button type="button" className={styles.quiet} disabled={busy} onClick={onRemove}>
          <Trash size={14} weight="bold" aria-hidden="true" />
          <span>{word("taskRemove")}</span>
        </button>
      </div>
    </li>
  );
}

export function TasksPanel({ locale, word, active }: { locale: WorkspaceLocale; word: Word; active: boolean }) {
  const id = useId();
  const lang = locale === "uk" ? "uk" : "en";
  const [read, setRead] = useState<AssistantTasksResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [kind, setKind] = useState<Kind>("news");
  const [question, setQuestion] = useState("");
  const [token, setToken] = useState<Token | null>(null);
  const [every, setEvery] = useState<Every>("1h");
  const [time, setTime] = useState("09:00");
  const [onlyNew, setOnlyNew] = useState(true);
  const [telegram, setTelegram] = useState(true);
  const [push, setPush] = useState(true);

  const load = useCallback(async () => {
    try {
      /* A read the store dropped is asked once more before the panel says it could not read. */
      let response = await fetch("/api/v1/assistant/tasks", { headers: HEADERS, credentials: "same-origin", cache: "no-store" });
      if (response.status >= 500) response = await fetch("/api/v1/assistant/tasks", { headers: HEADERS, credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as AssistantTasksResponse;
      setRead(next);
      /* The rhythm chosen by default may not fit the day's runs: the first one that fits is chosen instead. */
      setEvery((chosen) => (next.rhythms.find((row) => row.every === chosen)?.fits === false ? (next.rhythms.find((row) => row.fits)?.every ?? chosen) : chosen));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const say = (code: string | null) =>
    setError(code === "TASK_LIMIT_REACHED" ? word("taskLimit") : code === "TASK_RUNS_CAP" ? word("taskRunsCap") : code === "TASK_PRICE_NOT_SHOWN" ? word("taskPriceChanged") : code === "TASK_VERSION_CONFLICT" ? word("taskChanged") : word("taskFailed"));

  const send = async (method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, { method, headers: HEADERS, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body) });
      if (!response.ok) {
        say(await codeOf(response));
        if (response.status === 409) void load();
        return false;
      }
      setRead((await response.json()) as AssistantTasksResponse);
      return true;
    } catch {
      say(null);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const price = read?.pricePerRun ?? 0;
  const perDay = read?.rhythms.find((row) => row.every === every)?.perDayCredits ?? 0;
  const ask: AssistantTaskAsk | null =
    kind === "question" ? (question.trim().length >= 3 ? { kind, text: question.trim() } : null) : kind === "portfolio" ? { kind } : token ? { kind, mint: token.mint, symbol: token.symbol.slice(0, 16) } : null;

  const create = async () => {
    if (!ask) return;
    const body: AssistantTaskCreate = { ask, every, ...(every === "1d" ? { time } : {}), zone: ownZone(), locale: lang, onlyWhenNew: onlyNew, channels: { telegram, push }, acceptCredits: price };
    if (await send("POST", "/api/v1/assistant/tasks", body)) {
      setMaking(false);
      setQuestion("");
      setToken(null);
    }
  };

  const tasks = read?.tasks ?? [];
  const full = read !== null && tasks.length >= read.limit;
  return (
    <section className={styles.panel} aria-labelledby={id}>
      {/* AI-20: the tab says «Доручення» — the heading stays for a screen reader; the lead, then «Нове доручення». */}
      <h3 id={id} className={styles.title}>
        {word("tasksTitle")}
      </h3>
      <p className={styles.lead}>{word("tasksLead")}</p>
      {read && !making && !full ? (
        <div className={styles.head}>
          <button type="button" className="rw-btn" onClick={() => setMaking(true)}>
            {word("taskNew")}
          </button>
        </div>
      ) : null}
      {active ? <ComputerPush word={word} /> : null}
      {failed ? (
        <p className={styles.error} role="alert">
          {word("taskLoadFailed")}{" "}
          <button type="button" className={styles.link} onClick={() => void load()}>
            {word("retry")}
          </button>
        </p>
      ) : null}
      {read === null && !failed ? <p className={styles.lead} aria-busy="true">{word("loadingList")}</p> : null}

      {making ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <fieldset className={styles.choices}>
            <legend className={styles.label}>{word("taskWhat")}</legend>
            {KINDS.map(([value, label]) => (
              <label key={value} className={styles.choice} data-on={kind === value ? "" : undefined}>
                <input type="radio" name={`${id}-kind`} value={value} checked={kind === value} onChange={() => setKind(value)} />
                <span>{word(label)}</span>
              </label>
            ))}
          </fieldset>
          {kind === "question" ? (
            <label className={styles.fieldWrap}>
              <span className={styles.label}>{word("taskQuestion")}</span>
              <textarea className={styles.field} rows={2} maxLength={300} value={question} placeholder={word("taskQuestionPlaceholder")} onChange={(event) => setQuestion(event.target.value)} />
            </label>
          ) : kind === "portfolio" ? null : (
            <TokenPicker token={token} setToken={setToken} word={word} />
          )}
          <fieldset className={styles.choices}>
            <legend className={styles.label}>{word("taskHowOften")}</legend>
            {EVERY.map(([value, label]) => {
              const off = read?.rhythms.find((row) => row.every === value)?.fits === false;
              return (
                <label key={value} className={styles.choice} data-on={every === value ? "" : undefined} data-off={off ? "" : undefined}>
                  <input type="radio" name={`${id}-every`} value={value} checked={every === value} disabled={off} onChange={() => setEvery(value)} />
                  <span>{word(label)}</span>
                </label>
              );
            })}
            {read && read.runs.cap === 0 ? (
              <p className={styles.lead}>{word("taskOff")}</p>
            ) : read && read.rhythms.some((row) => !row.fits) ? (
              <p className={styles.lead}>{word("taskRunsLeft").replace("{cap}", String(read.runs.cap))}</p>
            ) : null}
            {every === "1d" ? (
              <label className={styles.time}>
                <span>{word("briefTime")}</span>
                <input type="time" step={900} value={time} onChange={(event) => setTime(event.target.value)} />
              </label>
            ) : null}
          </fieldset>
          <fieldset className={styles.choices}>
            <legend className={styles.label}>{word("taskWhere")}</legend>
            <label className={styles.check}>
              <input type="checkbox" checked disabled />
              <span>{word("briefInbox")}</span>
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={telegram} onChange={(event) => setTelegram(event.target.checked)} />
              <span>Telegram</span>
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={push} onChange={(event) => setPush(event.target.checked)} />
              <span>Push</span>
            </label>
          </fieldset>
          <label className={styles.check}>
            <input type="checkbox" checked={onlyNew} onChange={(event) => setOnlyNew(event.target.checked)} />
            <span>{word("taskOnlyNew")}</span>
          </label>
          <p className={styles.price}>{fill(word("taskPriceBefore"), { run: `${price} ${creditsWord(price, locale)}`, day: `${perDay} ${creditsWord(perDay, locale)}` })}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.quiet} onClick={() => setMaking(false)} disabled={busy}>
              {word("taskCancel")}
            </button>
            <button type="submit" className="rw-btn rw-btn--primary" disabled={busy || ask === null} aria-busy={busy}>
              {word("taskTurnOn")}
            </button>
          </div>
        </form>
      ) : null}

      <div aria-live="polite">
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {tasks.length > 0 ? (
        <ul className={styles.list}>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              word={word}
              locale={locale}
              busy={busy}
              price={price}
              onPatch={(body) => void send("PATCH", `/api/v1/assistant/tasks/${task.id}`, body.status === "active" ? { ...body, acceptCredits: price } : body)}
              onRemove={() => void send("DELETE", `/api/v1/assistant/tasks/${task.id}`)}
            />
          ))}
        </ul>
      ) : read && !making ? (
        <p className={styles.empty}>{word("tasksNone")}</p>
      ) : null}
      {full ? <p className={styles.lead}>{word("taskLimit")}</p> : null}
    </section>
  );
}
