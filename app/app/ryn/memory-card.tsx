"use client";

import { Brain, Trash, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { AssistantMemoryNote, AssistantMemoryResponse, AssistantMemoryUpdate } from "@/lib/api/v1/contract";

import { plural } from "./credits-store";
import styles from "./memory-card.module.css";
import type { RynWord } from "./ryn-words";

/**
 * What Ryntra knows about the person (AI-18), in three places:
 * - `MemoryCard` — «Що Ryntra знає про тебе», opened from «Що бачить Ryntra»: «Про мене» in their own words, the notes
 *   Ryntra kept from what they said (each with «Забути»), the answers of «Знайомство» with «Змінити», what the wallet
 *   shows now, and «Забути все»;
 * - `AboutPrompt` — once, after «Знайомство»: «Розкажи про себе своїми словами»;
 * - `RememberedLine` — under the conversation, when the person's last message left a note: «Запам'ятала · Забути».
 * Every word kept is the person's own and only shapes how Ryntra words an answer.
 */

type Word = (w: RynWord) => string;
const HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;
const ABOUT_MAX = 600;
const NOTE_MAX = 160;
const fill = (template: string, values: Readonly<Record<string, string | number>>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
/** «1 токен», «3 токени», «12 токенів» — «1 token», «12 tokens». */
const tokensWord = (n: number, locale: "en" | "uk") => `${n} ${plural(n, locale, ["token", "tokens"], ["токен", "токени", "токенів"])}`;

/** The person's memory as the page holds it: read once, then after each write and after each message (notes may have come). */
export function useMemory(enabled: boolean) {
  const [read, setRead] = useState<AssistantMemoryResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  /* `notes` — after a message: the notes alone, without reading the wallet again. */
  const refresh = useCallback(async (mode: "all" | "notes" = "all"): Promise<AssistantMemoryResponse | null> => {
    try {
      const url = mode === "notes" ? "/api/v1/assistant/memory?picture=0" : "/api/v1/assistant/memory";
      const get = () => fetch(url, { headers: HEADERS, credentials: "same-origin", cache: "no-store" });
      /* One more try after a moment: a store busy with the page's other reads usually answers the second time. */
      let response = await get();
      if (!response.ok && response.status >= 500) {
        await new Promise((settle) => setTimeout(settle, 1_500));
        response = await get();
      }
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as AssistantMemoryResponse;
      if (live.current) {
        /* The notes alone keep the wallet's picture already shown. */
        setRead((before) => (mode === "notes" && before ? { ...body, wallet: before.wallet } : body));
        setFailed(false);
      }
      return body;
    } catch {
      if (live.current) setFailed(true);
      return null;
    }
  }, []);
  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);
  /* `secret` — the server refused a key, a password or a recovery phrase: said in words, not as «could not write». */
  const write = useCallback(async (method: "PUT" | "DELETE", path: string, body?: AssistantMemoryUpdate): Promise<boolean | "secret"> => {
    try {
      const response = await fetch(path, { method, headers: HEADERS, credentials: "same-origin", body: body ? JSON.stringify(body) : undefined });
      if (!response.ok) {
        const code = ((await response.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code;
        return code === "MEMORY_SECRET_REFUSED" ? "secret" : false;
      }
      const next = (await response.json()) as AssistantMemoryResponse;
      /* A write's answer carries no wallet read: the picture already shown stays. */
      if (live.current) setRead((before) => (before && next.wallet.state === "unavailable" ? { ...next, wallet: before.wallet } : next));
      return true;
    } catch {
      return false;
    }
  }, []);
  return { read, failed, refresh, setRead, write } as const;
}

export type MemoryState = ReturnType<typeof useMemory>;

const SOURCE_WORD: Readonly<Record<AssistantMemoryNote["source"], RynWord>> = { said: "memSourceSaid", asked: "memSourceAsked", typed: "memSourceTyped" };

export function MemoryCard({ word, locale, memory, you, onChangeProfile, onClose }: { word: Word; locale: "en" | "uk"; memory: MemoryState; you: string | null; onChangeProfile: (() => void) | null; onClose: () => void }) {
  const heading = useId();
  const read = memory.read;
  const [about, setAbout] = useState(read?.about ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const tag = locale === "uk" ? "uk-UA" : "en-GB";

  /* The words in the field follow the record when it arrives or changes elsewhere — never over what is being typed. */
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) setAbout(read?.about ?? "");
  }, [read?.about]);
  useEffect(() => {
    cardRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const run = async (work: () => Promise<boolean | "secret">) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const ok = await work();
    if (ok !== true) setError(ok === "secret" ? word("memSecret") : word("memFailed"));
    setBusy(false);
    return ok === true;
  };

  if (!read) {
    return (
      <section className={styles.card} aria-busy={!memory.failed}>
        <p className={styles.lead}>{memory.failed ? word("memFailed") : word("loadingList")}</p>
      </section>
    );
  }

  const picture = read.wallet;
  const holds =
    picture.state === "current" && picture.tokens !== null
      ? picture.largest.length > 0
        ? fill(word("memWalletHolds"), { n: tokensWord(picture.tokens, locale), largest: picture.largest.map((row) => row.symbol).join(", ") })
        : fill(word("memWalletCount"), { n: tokensWord(picture.tokens, locale) })
      : word("memWalletUnread");

  return (
    <section ref={cardRef} className={styles.card} aria-labelledby={heading}>
      <header className={styles.head}>
        <h3 id={heading} className={styles.title}>
          <Brain size={18} weight="duotone" aria-hidden="true" />
          <span>{word("memTitle")}</span>
        </h3>
        <button type="button" className={styles.close} aria-label={word("panelClose")} title={word("panelClose")} onClick={onClose}>
          <X size={16} weight="bold" aria-hidden="true" />
        </button>
      </header>
      <p className={styles.lead}>{word("memLead")}</p>

      <div className={styles.part}>
        <label className={styles.label} htmlFor={`${heading}-about`}>
          {word("memAbout")}
        </label>
        <textarea
          id={`${heading}-about`}
          className={styles.field}
          value={about}
          maxLength={ABOUT_MAX}
          rows={3}
          placeholder={word("memAboutPlaceholder")}
          onChange={(event) => {
            typed.current = true;
            setAbout(event.target.value);
          }}
        />
        <div className={styles.row}>
          <span className={styles.count}>
            {about.length} / {ABOUT_MAX}
          </span>
          <button
            type="button"
            className="rw-btn"
            disabled={busy || about.trim() === (read.about ?? "")}
            onClick={() =>
              void run(async () => {
                const ok = await memory.write("PUT", "/api/v1/assistant/memory", { about: about.trim().length > 0 ? about.trim() : null });
                if (ok === true) typed.current = false;
                return ok;
              })
            }
          >
            {word("memSave")}
          </button>
        </div>
      </div>

      <div className={styles.part}>
        <div className={styles.rowHead}>
          <span className={styles.label}>{word("memNotes")}</span>
          <label className={styles.switch}>
            <input type="checkbox" checked={read.noticing} disabled={busy} onChange={(event) => void run(() => memory.write("PUT", "/api/v1/assistant/memory", { noticing: event.target.checked }))} />
            <span>{word("memNoticing")}</span>
          </label>
        </div>
        {read.notes.length === 0 ? (
          <p className={styles.lead}>{word("memNoNotes")}</p>
        ) : (
          <ul className={styles.notes}>
            {[...read.notes].reverse().map((item) => (
              <li key={item.id} className={styles.note}>
                <span className={styles.noteText}>{item.text}</span>
                <span className={styles.noteMeta}>
                  {word(SOURCE_WORD[item.source])} · {new Date(item.at).toLocaleDateString(tag, { day: "numeric", month: "short" })}
                </span>
                <button type="button" className={styles.forget} disabled={busy} onClick={() => void run(() => memory.write("DELETE", `/api/v1/assistant/memory/${item.id}`))} aria-label={`${word("memForget")}: ${item.text}`}>
                  <Trash size={14} weight="bold" aria-hidden="true" />
                  <span>{word("memForget")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className={styles.add}
          onSubmit={(event) => {
            event.preventDefault();
            const text = note.trim();
            if (text.length < 2) return;
            void run(async () => {
              const ok = await memory.write("PUT", "/api/v1/assistant/memory", { note: text });
              if (ok === true) setNote("");
              return ok;
            });
          }}
        >
          <label className={styles.srOnly} htmlFor={`${heading}-note`}>
            {word("memAddLabel")}
          </label>
          <input id={`${heading}-note`} className={styles.input} value={note} maxLength={NOTE_MAX} placeholder={word("memAddPlaceholder")} onChange={(event) => setNote(event.target.value)} />
          <button type="submit" className="rw-btn" disabled={busy || note.trim().length < 2}>
            {word("memAdd")}
          </button>
        </form>
      </div>

      <dl className={styles.facts}>
        <div>
          <dt>{word("memProfile")}</dt>
          <dd>
            {you ?? word("memProfileNone")}{" "}
            {onChangeProfile ? (
              <button type="button" className={styles.link} onClick={onChangeProfile}>
                {word("seesChange")}
              </button>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>{word("memWallet")}</dt>
          <dd>{holds}</dd>
        </div>
      </dl>
      <p className={styles.lead}>{word("memBounds")}</p>

      <div className={styles.foot}>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {confirmAll ? (
          <span className={styles.confirm}>
            <span>{word("memForgetAllAsk")}</span>
            <button type="button" className="rw-btn" disabled={busy} onClick={() => void run(async () => {
              const ok = await memory.write("DELETE", "/api/v1/assistant/memory");
              if (ok === true) {
                typed.current = false;
                setConfirmAll(false);
              }
              return ok;
            })}>
              {word("memForgetAllYes")}
            </button>
            <button type="button" className={styles.link} onClick={() => setConfirmAll(false)}>
              {word("memForgetAllNo")}
            </button>
          </span>
        ) : read.about || read.notes.length > 0 ? (
          <button type="button" className={styles.link} onClick={() => setConfirmAll(true)}>
            {word("memForgetAll")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

const ABOUT_ASKED_KEY = "ryntra.assistant.about-asked.v2";

/** Whether «Розкажи про себе» was answered or put off for this wallet on this browser — a convenience only; the record is the truth. */
export function aboutAsked(owner: string): boolean {
  try {
    return (window.localStorage.getItem(ABOUT_ASKED_KEY) ?? "").split(",").includes(owner);
  } catch {
    return false;
  }
}

function markAboutAsked(owner: string): void {
  try {
    const seen = (window.localStorage.getItem(ABOUT_ASKED_KEY) ?? "").split(",").filter(Boolean);
    window.localStorage.setItem(ABOUT_ASKED_KEY, [...seen.filter((item) => item !== owner), owner].slice(-20).join(","));
  } catch {
    /* storage may be off: the prompt then shows again next time, nothing more */
  }
}

/** Once, after «Знайомство»: Ryntra asks the person to say who they are in their own words. */
export function AboutPrompt({ word, memory, owner, onDone }: { word: Word; memory: MemoryState; owner: string; onDone: () => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<false | "secret" | "write">(false);
  return (
    <section className={styles.card} aria-labelledby={id} data-prompt="">
      <h3 id={id} className={styles.title}>
        <Brain size={18} weight="duotone" aria-hidden="true" />
        <span>{word("aboutAskTitle")}</span>
      </h3>
      <p className={styles.lead}>{word("aboutAskLead")}</p>
      <label className={styles.srOnly} htmlFor={`${id}-text`}>
        {word("memAbout")}
      </label>
      <textarea id={`${id}-text`} className={styles.field} rows={3} maxLength={ABOUT_MAX} value={text} placeholder={word("memAboutPlaceholder")} onChange={(event) => setText(event.target.value)} />
      {failed ? (
        <p className={styles.error} role="alert">
          {failed === "secret" ? word("memSecret") : word("memFailed")}
        </p>
      ) : null}
      <div className={styles.row}>
        <button
          type="button"
          className={styles.link}
          onClick={() => {
            markAboutAsked(owner);
            onDone();
          }}
        >
          {word("aboutAskLater")}
        </button>
        <button
          type="button"
          className="rw-btn rw-btn--primary"
          disabled={busy || text.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            setFailed(false);
            const ok = await memory.write("PUT", "/api/v1/assistant/memory", { about: text.trim() });
            setBusy(false);
            if (ok !== true) return setFailed(ok === "secret" ? "secret" : "write");
            markAboutAsked(owner);
            onDone();
          }}
        >
          {word("memSave")}
        </button>
      </div>
    </section>
  );
}

/** Under the conversation: what the last message left in the memory, with «Забути» — so nothing is kept unseen. */
export function RememberedLine({ word, notes, memory, onDismiss }: { word: Word; notes: readonly AssistantMemoryNote[]; memory: MemoryState; onDismiss: () => void }) {
  if (notes.length === 0) return null;
  return (
    <p className={styles.remembered} role="status">
      <Brain size={14} weight="duotone" aria-hidden="true" />
      <span>
        {word("memRemembered")} «{notes.map((item) => item.text).join("», «")}»
      </span>
      <button
        type="button"
        className={styles.link}
        onClick={async () => {
          for (const item of notes) await memory.write("DELETE", `/api/v1/assistant/memory/${item.id}`);
          onDismiss();
        }}
      >
        {word("memForget")}
      </button>
      <button type="button" className={styles.close} aria-label={word("panelClose")} onClick={onDismiss}>
        <X size={12} weight="bold" aria-hidden="true" />
      </button>
    </p>
  );
}
