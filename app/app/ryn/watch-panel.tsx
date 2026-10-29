"use client";

import { Bell, BellSlash, MagnifyingGlass, PencilSimple, Play, Trash } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AssistantWatch, AssistantWatchRule, AssistantWatchesResponse } from "@/lib/api/v1/contract";

import { creditUnit } from "./credits-panel";
import styles from "./watch-panel.module.css";
import type { RynWord } from "./ryn-words";

/**
 * «Стежу» on the assistant's page (AI-05): the person's token watches and a
 * new one in four presses — a token, when to write, where, «Увімкнути» —
 * with «Детально» for the rule itself. Each card says what the rule reads
 * now, from where and when, its latest alert with «Чому?» at its price, and
 * «Пауза», «Змінити», «Вимкнути». The rules are judged on the server without
 * a model; nothing here signs, trades or spends — «Чому?» puts the question
 * in the conversation, where it is asked at the price shown, on a press.
 */

type Word = (w: RynWord) => string;
const HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;

/** The tokens most people start from, by mint — a press instead of a search. */
const QUICK_TOKENS: readonly (readonly [string, string])[] = [
  ["SOL", "So11111111111111111111111111111111111111112"],
  ["JUP", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
  ["BONK", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["WIF", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
];

const COOLDOWNS = [15, 60, 240, 1_440] as const;

export type Token = Readonly<{ mint: string; symbol: string; name: string | null; verified: boolean | null }>;

/** The rule as the form holds it: every field a string while typed, a rule once it holds. */
type Draft = Readonly<{
  kind: AssistantWatchRule["kind"];
  direction: "below" | "above";
  level: string;
  window: "m5" | "h1" | "h24";
  move: "down" | "up" | "any";
  pct: string;
  factor: string;
  liqWindow: "h1" | "h24";
  liq: "drop" | "rise" | "any";
  liqPct: string;
  pool: string;
}>;

const EMPTY: Draft = { kind: "move", direction: "below", level: "", window: "h24", move: "down", pct: "10", factor: "3", liqWindow: "h1", liq: "drop", liqPct: "30", pool: "" };

function draftOf(rule: AssistantWatchRule): Draft {
  switch (rule.kind) {
    case "price":
      return { ...EMPTY, kind: "price", direction: rule.direction, level: String(rule.level) };
    case "move":
      return { ...EMPTY, kind: "move", window: rule.window, move: rule.direction, pct: String(rule.pct) };
    case "volume":
      return { ...EMPTY, kind: "volume", factor: String(rule.factor) };
    case "liquidity":
      return { ...EMPTY, kind: "liquidity", liqWindow: rule.window, liq: rule.direction, liqPct: String(rule.pct), pool: rule.pool ?? "" };
  }
}

const numberOf = (text: string) => {
  const value = Number(text.replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(value) ? value : NaN;
};

function ruleOf(draft: Draft): AssistantWatchRule | null {
  switch (draft.kind) {
    case "price": {
      const level = numberOf(draft.level);
      return level > 0 ? { kind: "price", direction: draft.direction, level } : null;
    }
    case "move": {
      const pct = numberOf(draft.pct);
      return pct >= 0.5 && pct <= 1_000 ? { kind: "move", window: draft.window, direction: draft.move, pct } : null;
    }
    case "volume": {
      const factor = numberOf(draft.factor);
      return factor >= 1.5 && factor <= 100 ? { kind: "volume", factor } : null;
    }
    case "liquidity": {
      const pct = numberOf(draft.liqPct);
      const pool = draft.pool.trim();
      if (pool && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pool)) return null;
      return pct >= 5 && pct <= 100 ? { kind: "liquidity", window: draft.liqWindow, direction: draft.liq, pct, pool: pool || null } : null;
    }
  }
}

function cooldownWords(minutes: number, locale: WorkspaceLocale): string {
  const uk = locale === "uk";
  if (minutes >= 1_440) return uk ? "1 доба" : "1 day";
  if (minutes >= 60) return uk ? `${minutes / 60} год` : `${minutes / 60} h`;
  return uk ? `${minutes} хв` : `${minutes} min`;
}

/** A card's times in UTC, as its alerts say them — one clock on the card and in the note. */
function timeOf(at: string | null, locale: WorkspaceLocale): string | null {
  if (!at) return null;
  return `${new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at))} UTC`;
}

const STATE_WORD: Readonly<Record<AssistantWatch["now"]["state"], RynWord>> = {
  armed: "watchStateArmed",
  rang: "watchStateRang",
  cooling: "watchStateCooling",
  unread: "watchStateUnread",
  learning: "watchStateLearning",
  paused: "watchStatePaused",
};

const ERROR_WORD: Readonly<Record<string, RynWord>> = {
  WATCH_LIMIT_REACHED: "watchFull",
  ASSET_UNCONFIRMED: "watchUnknownToken",
  PRICE_UNAVAILABLE: "watchNoPrice",
  WATCH_VERSION_CONFLICT: "watchChanged",
};

/** The server's refusal in the reader's words; one that names nothing known is «could not save». */
async function failureOf(response: Response, word: Word): Promise<Readonly<{ code: string | null; text: string }>> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    const code = body.error?.code ?? null;
    if (code === "VALIDATION_ERROR" && body.error?.message?.startsWith("You already watch")) return { code, text: word("watchDuplicate") };
    if (code === "ASSET_UNCONFIRMED" && body.error?.message?.includes("suspicious")) return { code, text: word("watchSuspicious") };
    if (code === "PRICE_UNAVAILABLE" && body.error?.message?.includes("does not price")) return { code, text: word("watchUnpriced") };
    const key = code ? ERROR_WORD[code] : undefined;
    return { code, text: key ? word(key) : word("watchFailed") };
  } catch {
    return { code: null, text: word("watchFailed") };
  }
}

function Select<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select value={String(value)} onChange={(event) => onChange(options.find(([key]) => String(key) === event.target.value)?.[0] ?? value)}>
        {options.map(([key, text]) => (
          <option key={String(key)} value={String(key)}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field({ label, value, onChange, inputMode = "decimal", wide = false }: { label: string; value: string; onChange: (value: string) => void; inputMode?: "decimal" | "text"; wide?: boolean }) {
  return (
    <label className={styles.field} data-wide={wide || undefined}>
      <span>{label}</span>
      <input value={value} inputMode={inputMode} autoComplete="off" spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/** The rule's own fields — «Детально» on a new watch, and «Змінити» on a card. */
function RuleFields({ draft, setDraft, word, locale }: { draft: Draft; setDraft: (draft: Draft) => void; word: Word; locale: WorkspaceLocale }) {
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const windows: readonly (readonly ["m5" | "h1" | "h24", string])[] = [
    ["m5", locale === "uk" ? "5 хв" : "5 min"],
    ["h1", locale === "uk" ? "1 год" : "1 hour"],
    ["h24", locale === "uk" ? "24 год" : "24 hours"],
  ];
  return (
    <div className={styles.fields}>
      <Select label={word("watchKind")} value={draft.kind} onChange={(kind) => set({ kind })} options={[["price", word("kindPrice")], ["move", word("kindMove")], ["volume", word("kindVolume")], ["liquidity", word("kindLiquidity")]]} />
      {draft.kind === "price" ? (
        <>
          <Select label={word("watchDirection")} value={draft.direction} onChange={(direction) => set({ direction })} options={[["below", word("watchBelow")], ["above", word("watchAbove")]]} />
          <Field label={word("watchLevel")} value={draft.level} onChange={(level) => set({ level })} />
        </>
      ) : null}
      {draft.kind === "move" ? (
        <>
          <Select label={word("watchDirection")} value={draft.move} onChange={(move) => set({ move })} options={[["down", word("watchDown")], ["up", word("watchUp")], ["any", word("watchAny")]]} />
          <Field label={word("watchPct")} value={draft.pct} onChange={(pct) => set({ pct })} />
          <Select label={word("watchWindow")} value={draft.window} onChange={(window) => set({ window })} options={windows} />
        </>
      ) : null}
      {draft.kind === "volume" ? <Field label={word("watchFactor")} value={draft.factor} onChange={(factor) => set({ factor })} /> : null}
      {draft.kind === "liquidity" ? (
        <>
          <Select label={word("watchDirection")} value={draft.liq} onChange={(liq) => set({ liq })} options={[["drop", word("watchDrop")], ["rise", word("watchRise")], ["any", word("watchAny")]]} />
          <Field label={word("watchPct")} value={draft.liqPct} onChange={(liqPct) => set({ liqPct })} />
          <Select label={word("watchWindow")} value={draft.liqWindow} onChange={(liqWindow) => set({ liqWindow })} options={windows.filter(([key]) => key !== "m5") as readonly (readonly ["h1" | "h24", string])[]} />
          <Field label={word("watchPool")} value={draft.pool} onChange={(pool) => set({ pool })} inputMode="text" wide />
        </>
      ) : null}
    </div>
  );
}

export function TokenPicker({ token, setToken, word }: { token: Token | null; setToken: (token: Token | null) => void; word: Word }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<readonly Token[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  /* A pasted address is taken as it is: the server reads the token by mint when the watch starts. */
  const pasted = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query.trim()) ? query.trim() : null;
  const search = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    const text = query.trim();
    if (!text) return;
    setSearching(true);
    setSearchFailed(false);
    try {
      const response = await fetch("/api/solana/tokens/search", { method: "POST", headers: HEADERS, body: JSON.stringify({ query: text, limit: 6 }) });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { tokens: { mint: string; symbol: string | null; name: string | null; isVerified: boolean | null; isSuspicious: boolean }[] };
      setFound(body.tokens.filter((row) => !row.isSuspicious).map((row) => ({ mint: row.mint, symbol: row.symbol ?? row.mint.slice(0, 4), name: row.name, verified: row.isVerified })));
    } catch {
      /* A search that did not answer is not «nothing found». */
      setFound(null);
      setSearchFailed(true);
    } finally {
      setSearching(false);
    }
  }, [query]);

  if (token) {
    const short = `${token.mint.slice(0, 4)}…${token.mint.slice(-4)}`;
    return (
      <div className={styles.chosen}>
        {/* A token chosen from a page that had not read its symbol yet is named by its address alone, once. */}
        {token.symbol !== short ? <span className={styles.symbol}>{token.symbol}</span> : null}
        <span className={styles.mint} title={token.mint}>
          {short}
        </span>
        <button type="button" className={styles.link} onClick={() => setToken(null)}>
          {word("watchChange")}
        </button>
      </div>
    );
  }
  return (
    <div className={styles.picker}>
      <div className={styles.chips} role="group" aria-label={word("watchToken")}>
        {QUICK_TOKENS.map(([symbol, mint]) => (
          <button key={mint} type="button" className={styles.chip} onClick={() => setToken({ mint, symbol, name: null, verified: true })}>
            {symbol}
          </button>
        ))}
      </div>
      <div className={styles.search}>
        <input value={query} placeholder={word("watchSearch")} aria-label={word("watchSearch")} autoComplete="off" spellCheck={false} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => (event.key === "Enter" ? void search(event) : undefined)} />
        <button type="button" className="rw-btn" onClick={() => void search()} disabled={searching || query.trim().length === 0} aria-label={word("watchSearch")}>
          <MagnifyingGlass size={16} aria-hidden="true" />
        </button>
      </div>
      {searching ? <p className={styles.muted}>{word("watchSearching")}</p> : null}
      {searchFailed && !searching ? <p className={styles.muted}>{word("watchSearchFailed")}</p> : null}
      {pasted && !found?.some((row) => row.mint === pasted) ? (
        <button type="button" className={styles.result} onClick={() => setToken({ mint: pasted, symbol: `${pasted.slice(0, 4)}…`, name: null, verified: null })}>
          <span className={styles.symbol}>{word("watchByAddress")}</span>
          <span className={styles.mint}>
            {pasted.slice(0, 4)}…{pasted.slice(-4)}
          </span>
        </button>
      ) : null}
      {found && !searching ? (
        found.length === 0 ? (
          <p className={styles.muted}>{word("watchNoMatch")}</p>
        ) : (
          <ul className={styles.results}>
            {found.map((row) => (
              <li key={row.mint}>
                <button type="button" className={styles.result} onClick={() => setToken(row)}>
                  <span className={styles.symbol}>{row.symbol}</span>
                  <span className={styles.muted}>{row.name ?? ""}</span>
                  <span className={styles.mint}>
                    {row.mint.slice(0, 4)}…{row.mint.slice(-4)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function WatchCard({ watch, word, locale, focus, busy, onPatch, onRemove, onExplain }: { watch: AssistantWatch; word: Word; locale: WorkspaceLocale; focus: boolean; busy: boolean; onPatch: (id: string, body: Record<string, unknown>) => Promise<boolean>; onRemove: (id: string) => Promise<boolean>; onExplain: (question: string) => void }) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const [asking, setAsking] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);
  const when = timeOf(watch.now.observedAt, locale);
  const rule = editing ? ruleOf(editing) : null;
  return (
    <article ref={ref} className={styles.card} data-state={watch.now.state} data-focus={focus || undefined}>
      <div className={styles.cardHead}>
        <span className={styles.symbol}>{watch.symbol}</span>
        <span className={styles.rule}>{watch.ruleText}</span>
        <span className={styles.state} data-state={watch.now.state}>
          {word(STATE_WORD[watch.now.state])}
        </span>
      </div>
      {watch.now.text ? (
        <p className={styles.now}>
          {word("watchNow")}: <strong>{watch.now.text}</strong>
          {watch.now.source ? <span className={styles.muted}> · {watch.now.source}{when ? `, ${when}` : ""}</span> : null}
        </p>
      ) : null}
      {watch.last ? (
        <div className={styles.last}>
          <p className={styles.lastTitle}>
            {watch.last.title} <span className={styles.muted}>· {timeOf(watch.last.at, locale)}</span>
          </p>
          <p className={styles.muted}>{watch.last.reason}</p>
        </div>
      ) : null}
      {editing ? (
        <div className={styles.editor}>
          <RuleFields draft={editing} setDraft={setEditing} word={word} locale={locale} />
          <div className={styles.actions}>
            <button
              type="button"
              className="rw-btn rw-btn--primary"
              disabled={busy || rule === null}
              onClick={async () => {
                if (rule && (await onPatch(watch.id, { ifVersion: watch.version, rule }))) setEditing(null);
              }}
            >
              {word("watchSave")}
            </button>
            <button type="button" className="rw-btn" onClick={() => setEditing(null)}>
              {word("watchCancel")}
            </button>
          </div>
        </div>
      ) : asking ? (
        <div className={styles.confirm} role="group">
          <p>{word("watchOffAsk")}</p>
          <div className={styles.actions}>
            <button type="button" className="rw-btn rw-btn--primary" disabled={busy} onClick={() => void onRemove(watch.id)}>
              {word("watchYes")}
            </button>
            <button type="button" className="rw-btn" onClick={() => setAsking(false)}>
              {word("watchCancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          {watch.explain ? (
            <button type="button" className="rw-btn" onClick={() => onExplain(watch.explain?.question ?? "")}>
              {word("watchWhy").replace("{n}", `${watch.explain.priceCredits} ${locale === "uk" ? word("creditMany") : creditUnit(watch.explain.priceCredits, word, locale)}`)}
            </button>
          ) : null}
          {/* Pause and resume are safe whatever the pass wrote meanwhile: no version to clash with. */}
          <button type="button" className="rw-btn" disabled={busy} onClick={() => void onPatch(watch.id, { status: watch.status === "active" ? "paused" : "active" })}>
            {watch.status === "active" ? <BellSlash size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            <span>{watch.status === "active" ? word("watchPause") : word("watchResume")}</span>
          </button>
          <button type="button" className="rw-btn" disabled={busy} onClick={() => setEditing(draftOf(watch.rule))}>
            <PencilSimple size={14} aria-hidden="true" />
            <span>{word("watchEdit")}</span>
          </button>
          <button type="button" className={styles.ghost} disabled={busy} onClick={() => setAsking(true)}>
            <Trash size={14} aria-hidden="true" />
            <span>{word("watchOff")}</span>
          </button>
        </div>
      )}
    </article>
  );
}

export function WatchPanel({ locale, word, focusId, onExplain, onStatus, initialToken = null }: { locale: WorkspaceLocale; word: Word; focusId: string | null; onExplain: (question: string) => void; onStatus?: (status: string | null) => void; /** AI-06: «Стежити» on a token's page — the new watch starts on that token, by its mint. */ initialToken?: Readonly<{ mint: string; symbol: string }> | null }) {
  const lang = locale === "uk" ? "uk" : "en";
  const [read, setRead] = useState<AssistantWatchesResponse | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<Token | null>(initialToken ? { mint: initialToken.mint, symbol: initialToken.symbol, name: null, verified: null } : null);
  const [preset, setPreset] = useState<AssistantWatchesResponse["presets"][number]["id"] | null>("drop24h");
  const [detail, setDetail] = useState<Draft | null>(null);
  const [cooldown, setCooldown] = useState<number>(60);
  const [channels, setChannels] = useState<{ telegram: boolean; push: boolean } | null>(null);

  const load = useCallback(() => fetch(`/api/v1/assistant/watches?locale=${lang}`, { headers: HEADERS, credentials: "same-origin" }).then((response) => (response.ok ? (response.json() as Promise<AssistantWatchesResponse>) : Promise.reject(new Error(String(response.status))))), [lang]);

  useEffect(() => {
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    void load()
      .catch(() => new Promise<AssistantWatchesResponse>((settle, refuse) => (retry = setTimeout(() => void load().then(settle, refuse), 1_500))))
      .then((body) => {
        if (live) setRead(body);
      })
      .catch(() => {
        if (live) setFailed(word("watchLoadFailed"));
      });
    /* What a card reads now moves every minute: read again while the page is open and in view. */
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load().then((body) => live && setRead(body)).catch(() => undefined);
    }, 60_000);
    return () => {
      live = false;
      if (retry) clearTimeout(retry);
      clearInterval(timer);
    };
  }, [load, word]);

  useEffect(() => {
    if (!read) return;
    const on = read.watches.filter((watch) => watch.status === "active").length;
    onStatus?.(on > 0 ? String(on) : null);
  }, [read, onStatus]);

  const call = useCallback(
    async (url: string, method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      setFailed(null);
      try {
        const response = await fetch(`${url}?locale=${lang}`, { method, headers: HEADERS, credentials: "same-origin", body: body ? JSON.stringify(body) : undefined });
        if (!response.ok) {
          const failure = await failureOf(response, word);
          setFailed(failure.text);
          /* Changed meanwhile: show the watch as it stands, so the next press is on what is there. */
          if (failure.code === "WATCH_VERSION_CONFLICT") void load().then(setRead).catch(() => undefined);
          return false;
        }
        setRead((await response.json()) as AssistantWatchesResponse);
        return true;
      } catch {
        setFailed(word("watchFailed"));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, lang, word, load],
  );
  /* Where alerts go, as Нагляд's preferences say until the person changes it here. */
  const sends = channels ?? { telegram: read?.channels.telegram ?? true, push: read?.channels.push ?? true };

  const detailRule = detail ? ruleOf(detail) : null;
  const ready = token !== null && (detail ? detailRule !== null : preset !== null);
  const start = async () => {
    if (!token || !ready) return;
    const body = { mint: token.mint, ...(detail ? { rule: detailRule } : { preset }), cooldownMinutes: cooldown, channels: sends, locale: lang };
    if (await call("/api/v1/assistant/watches", "POST", body)) {
      setToken(null);
      setDetail(null);
    }
  };

  const left = read?.limit.left ?? 0;
  return (
    <div className={styles.panel}>
      <p className={styles.lead}>{word("watchLead")}</p>
      {read === null && failed === null ? (
        <p className={styles.muted} aria-busy="true">
          {word("loadingList")}
        </p>
      ) : null}
      {read ? (
        <section className={styles.list} aria-label={word("tabWatch")}>
          {read.watches.length === 0 ? <p className={styles.muted}>{word("watchNone")}</p> : null}
          {read.watches.map((watch) => (
            <WatchCard
              key={watch.id}
              watch={watch}
              word={word}
              locale={locale}
              focus={focusId === watch.id}
              busy={busy}
              onExplain={onExplain}
              onPatch={(id, body) => call(`/api/v1/assistant/watches/${id}`, "PATCH", body)}
              onRemove={(id) => call(`/api/v1/assistant/watches/${id}`, "DELETE")}
            />
          ))}
        </section>
      ) : null}
      {read ? (
        left > 0 ? (
          <section className={styles.new} aria-labelledby="watch-new">
            <h3 id="watch-new" className={styles.newHead}>
              <Bell size={16} aria-hidden="true" /> {word("watchNew")}
            </h3>
            <div className={styles.step}>
              <span className={styles.stepLabel}>{word("watchToken")}</span>
              <TokenPicker token={token} setToken={setToken} word={word} />
            </div>
            <div className={styles.step}>
              <span className={styles.stepLabel}>{word("watchPreset")}</span>
              <div className={styles.chips} role="radiogroup" aria-label={word("watchPreset")}>
                {read.presets.map((row) => (
                  <button key={row.id} type="button" role="radio" aria-checked={!detail && preset === row.id} className={styles.chip} onClick={() => {
                    setPreset(row.id);
                    setDetail(null);
                  }}>
                    {row.text}
                  </button>
                ))}
              </div>
              <details className={styles.detail} open={detail !== null} onToggle={(event) => setDetail((event.currentTarget as HTMLDetailsElement).open ? (detail ?? EMPTY) : null)}>
                <summary>{word("watchDetail")}</summary>
                {detail ? (
                  <>
                    <RuleFields draft={detail} setDraft={setDetail} word={word} locale={locale} />
                    <div className={styles.fields}>
                      <Select label={word("watchCooldown")} value={cooldown} onChange={setCooldown} options={COOLDOWNS.map((minutes) => [minutes, cooldownWords(minutes, locale)] as const)} />
                    </div>
                  </>
                ) : null}
              </details>
            </div>
            <div className={styles.step}>
              <span className={styles.stepLabel}>{word("watchChannels")}</span>
              <div className={styles.channels}>
                <span className={styles.muted}>{word("briefInbox")}</span>
                <label>
                  <input type="checkbox" checked={sends.telegram} onChange={(event) => setChannels({ ...sends, telegram: event.target.checked })} /> Telegram
                </label>
                <label>
                  <input type="checkbox" checked={sends.push} onChange={(event) => setChannels({ ...sends, push: event.target.checked })} /> Push
                </label>
                <Link href="/app/alerts" prefetch={false} className={styles.link}>
                  {word("briefChannels")}
                </Link>
              </div>
            </div>
            <div className={styles.go}>
              <button type="button" className="rw-btn rw-btn--primary" disabled={!ready || busy} onClick={() => void start()}>
                {busy ? word("watchStarting") : word("watchStart")}
              </button>
              <span className={styles.muted}>{word("watchCost").replace("{n}", String(left))}</span>
            </div>
          </section>
        ) : (
          <p className={styles.muted}>{word("watchFull")}</p>
        )
      ) : null}
      {failed ? (
        <p className={styles.error} role="alert">
          {failed}
        </p>
      ) : null}
      <details className={styles.how}>
        <summary>{word("watchHow")}</summary>
        <p>{word("watchHow1")}</p>
        <p>{word("watchHow2")}</p>
        <p>{word("watchHow3")}</p>
      </details>
    </div>
  );
}
