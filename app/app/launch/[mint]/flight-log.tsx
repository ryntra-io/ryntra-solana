"use client";

import { ArrowBendDownLeft, ArrowFatLineUp, ArrowSquareOut, ArrowsClockwise, CircleNotch, Coins, DownloadSimple, FlagCheckered, HandCoins, Lock, RocketLaunch, ShareNetwork, TrendDown } from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchJournalEventView, LaunchJournalResponse } from "@/lib/api/v1/contract";

import { explorerUrl, formatBps, formatDate, formatMoneyShort, formatPrice, formatRaw } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";

type Word = ReturnType<typeof launchWords>;

const API_HEADERS = { "X-Ryntra-API": "1" } as const;
/** The log opens with this many entries; the rest are one press away. */
const FIRST = 6;

const ICONS: Readonly<Record<LaunchJournalEventView["kind"], ReactNode>> = {
  LAUNCHED: <RocketLaunch size={18} aria-hidden />,
  CREATOR_LOCKED: <Lock size={18} weight="fill" aria-hidden />,
  FEES_SHARED: <ShareNetwork size={18} aria-hidden />,
  CREATOR_SOLD: <TrendDown size={18} aria-hidden />,
  GRADUATED: <FlagCheckered size={18} aria-hidden />,
  FLOOR_POOL: <Coins size={18} aria-hidden />,
  FLOOR_PLACED: <HandCoins size={18} aria-hidden />,
  FLOOR_WITHDRAWN: <ArrowBendDownLeft size={18} aria-hidden />,
  FLOOR_RAISED: <ArrowFatLineUp size={18} aria-hidden />,
  FLOOR_ADDED: <HandCoins size={18} aria-hidden />,
};

/*
 * A figure inside a sentence — an amount, a price, a share — set in the mono face the product gives every figure. A
 * space belongs to a figure only between its digit groups; the space after it stays in the sentence.
 */
const FIGURE = /([$]?\d(?:[\d.,₀-₉]|[\s  ](?=\d))*(?: ?%|\s(?:тис\.|млн)|[KM](?![A-Za-z])|\s\$[A-Z0-9]+)?)/g;

/** A sentence for the eye — figures in the mono face, a price's zeros in a subscript — and the same written out for a screen reader. */
type Line = Readonly<{ visual: string; plain: string }>;

function Figures({ text }: { text: string }) {
  const parts = text.split(FIGURE);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 ? (
          <span key={index} className={styles.figure}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Sentence({ line }: { line: Line }) {
  return (
    <>
      <span aria-hidden>
        <Figures text={line.visual} />
      </span>
      <span className={styles.visuallyHidden}>{line.plain}</span>
    </>
  );
}

/**
 * «Бортовий журнал» on a token's page: what happened to the token, the newest
 * first, each entry with its time, its amount and the transaction anyone can
 * open — and, when Ryntra has placed it, Ryntra's buy-side liquidity as it
 * stands, said as liquidity and nothing more. A move up of that liquidity is
 * one entry, the emptying before it under it. Read after the market, and
 * again when the trades or the way to the DEX change.
 */
export function FlightLog({ token, locale, refresh, symbol }: { token: string; locale: WorkspaceLocale; refresh: string | null; symbol: string }) {
  const word = launchWords(locale);
  const [log, setLog] = useState<LaunchJournalResponse | "reading" | "failed">("reading");
  const [all, setAll] = useState(false);
  /* «5 min ago» goes on counting between reads. */
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const read = useCallback(async () => {
    const answer = await fetch(`/api/v1/launch/${token}/journal`, { headers: API_HEADERS, cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as LaunchJournalResponse) : null))
      .catch(() => null);
    setLog((before) => answer ?? (typeof before === "object" ? before : "failed"));
  }, [token]);

  useEffect(() => {
    if (refresh !== null) void read();
  }, [refresh, read]);

  if (log === "reading" || log === "failed") {
    return (
      <section className={`${styles.card} ${styles.slotLog}`} aria-labelledby="launch-log" aria-busy={log === "reading"}>
        <h2 id="launch-log" className={styles.cardTitle}>
          {word("logTitle")}
        </h2>
        {log === "reading" ? (
          <p className={styles.unread}>
            <CircleNotch size={14} className={styles.spin} aria-hidden /> {word("logReading")}
          </p>
        ) : (
          <div className={styles.unreadRow} role="status">
            <p className={styles.unread}>{word("logUnread")}</p>
            <button type="button" className={styles.textButton} onClick={() => void read()}>
              <ArrowsClockwise size={14} aria-hidden /> {word("readAgain")}
            </button>
          </div>
        )}
      </section>
    );
  }

  const entries = folded(log.events);
  /* A sale of the creator's is always in the first view: Ryntra's own entries never push it behind «Show all». */
  const shown = all ? entries : entries.filter((row, index) => index < FIRST || row.entry.kind === "CREATOR_SOLD");
  const money = (raw: string) => formatMoneyShort(Number(raw) / 10 ** log.pair.decimals, locale, log.pair.dollar, log.pair.symbol);
  const tokens = (raw: string) => `${formatRaw(raw, log.tokenDecimals, locale, 0)} $${symbol}`;
  /* A price with its unit, as the page's head writes it: the subscript for the eye, the number written out to be read. */
  const unit = (value: string) => (log.pair.dollar ? `$${value}` : `${value} ${log.pair.symbol}`);
  const price = (value: number): Line => {
    const written = formatPrice(value, locale);
    return { visual: unit(written.text), plain: unit(written.plain) };
  };

  return (
    <section className={`${styles.card} ${styles.slotLog}`} aria-labelledby="launch-log">
      <div className={styles.cardHeadRow}>
        <h2 id="launch-log" className={styles.cardTitle}>
          {word("logTitle")}
        </h2>
        {/* The log as the API answers it, saved as a file — readable without a wallet, every entry with its transaction. */}
        <button type="button" className={styles.textButton} onClick={() => saveLog(log, symbol)} aria-label={word("logSaveLabel")}>
          <DownloadSimple size={14} aria-hidden /> {word("logSave")}
        </button>
      </div>
      {log.floor ? (
        <div className={styles.floorBlock}>
          <div className={styles.floorHead}>
            <HandCoins size={18} aria-hidden />
            <h3 className={styles.floorTitle}>{word("floorTitle")}</h3>
            <a className={styles.markLink} href={explorerUrl(log.network, "account", log.floor.pool)} target="_blank" rel="noreferrer noopener" aria-label={word("floorPoolLabel")}>
              {word("floorPool")} <ArrowSquareOut size={12} aria-hidden />
            </a>
          </div>
          <p className={styles.floorLine}>
            <Sentence line={say(word, "floorLine", { amount: money(log.floor.pairRaw) }, { low: price(log.floor.priceLow), high: price(log.floor.priceHigh) })} />
          </p>
          {BigInt(log.floor.tokensRaw) > 0n ? (
            <p className={styles.floorLine}>
              <Sentence line={say(word, "floorBought", { tokens: tokens(log.floor.tokensRaw) })} />
            </p>
          ) : null}
          <p className={styles.floorNote}>{word("floorNote")}</p>
        </div>
      ) : log.floorUnread ? (
        <p className={styles.unread}>{word("floorUnread")}</p>
      ) : null}
      <ol className={styles.logList}>
        {shown.map(({ entry, emptied }) => {
          const name = word(`log_${entry.kind}` as LaunchWordKey);
          const time = entry.at ? when(entry.at, locale, word) : null;
          const line = detail(entry, word, money, tokens, price, locale);
          const emptiedTime = emptied?.at ? when(emptied.at, locale, word) : null;
          return (
            <li key={`${entry.kind}:${entry.signature}`} className={styles.logItem} data-kind={entry.kind} data-actor={entry.actor}>
              <span className={styles.logIcon}>{ICONS[entry.kind]}</span>
              <span className={styles.logText}>
                <span className={styles.logHead}>
                  <span className={styles.logName}>{name}</span>
                  {entry.enforcement ? (
                    <span className={styles.logEnforce} data-enforcement={entry.enforcement} title={word(`enforceHint_${entry.enforcement}`)}>
                      {word(`logEnforce_${entry.enforcement}`)}
                    </span>
                  ) : null}
                  {entry.at && time ? (
                    <time className={styles.logWhen} dateTime={entry.at} title={new Date(entry.at).toLocaleString(locale === "uk" ? "uk-UA" : "en-US")}>
                      {time}
                    </time>
                  ) : null}
                </span>
                {line ? (
                  <span className={styles.logDetail}>
                    <Sentence line={line} />
                  </span>
                ) : null}
                {/* A move up is one entry: the emptying that came first, its amount and its own transaction, under it. */}
                {emptied ? (
                  <span className={styles.logDetail}>
                    {emptied.pairRaw ? <Sentence line={say(word, "log_FLOOR_RAISED_emptied", { amount: money(emptied.pairRaw) })} /> : null}{" "}
                    <a className={styles.markLink} href={explorerUrl(log.network, "tx", emptied.signature)} target="_blank" rel="noreferrer noopener" aria-label={`${word("logTx")}: ${word("logTxEmptied")}${emptiedTime ? `, ${emptiedTime}` : ""}`}>
                      {word("logTxEmptied")} <ArrowSquareOut size={12} aria-hidden />
                    </a>
                  </span>
                ) : null}
              </span>
              <a className={`${styles.markLink} ${styles.logTx}`} href={explorerUrl(log.network, "tx", entry.signature)} target="_blank" rel="noreferrer noopener" aria-label={`${word("logTx")}: ${name}${time ? `, ${time}` : ""}`}>
                {word("logTx")} <ArrowSquareOut size={12} aria-hidden />
              </a>
            </li>
          );
        })}
      </ol>
      {entries.length > shown.length || all ? (
        <button type="button" className={styles.textButton} onClick={() => setAll((open) => !open)} aria-expanded={all}>
          {all ? word("logLess") : word("logMore", { n: entries.length })}
        </button>
      ) : null}
      {/* The answer gives the newest 200: a log that holds more says so, and the file it saves says the same. */}
      {log.total !== undefined && log.total > log.events.length ? <p className={styles.hint}>{word("logTotal", { shown: log.events.length, total: log.total })}</p> : null}
      {!log.complete ? <p className={styles.hint}>{word("logIncomplete")}</p> : null}
      <p className={styles.marksChecked}>{word("marksChecked", { ago: when(log.observedAt, locale, word) })}</p>
    </section>
  );
}

/** The log saved as the API answered it: one JSON file named by the token, made in the page — nothing is sent anywhere. */
function saveLog(log: LaunchJournalResponse, symbol: string) {
  const blob = new Blob([`${JSON.stringify(log, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ryntra-flight-log-${symbol.replace(/[^A-Za-z0-9]+/g, "").slice(0, 16) || "token"}-${log.token.slice(0, 6)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** The time of an entry: how long ago within a day, the date after. */
function when(at: string, locale: WorkspaceLocale, word: Word): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 1000));
  if (seconds >= 86_400) return formatDate(at, locale);
  if (seconds < 60) return word("justNow");
  const time = seconds < 3600 ? word("min", { n: Math.floor(seconds / 60) }) : word("hour", { n: Math.floor(seconds / 3600) });
  return word("ago", { time });
}

/** A word with plain values and price values: the eye's sentence and the sentence written out. */
function say(word: Word, key: LaunchWordKey, values: Readonly<Record<string, string>>, prices: Readonly<Record<string, Line>> = {}): Line {
  const visual = word(key, { ...values, ...Object.fromEntries(Object.entries(prices).map(([name, line]) => [name, line.visual])) });
  const plain = word(key, { ...values, ...Object.fromEntries(Object.entries(prices).map(([name, line]) => [name, line.plain])) });
  return { visual, plain };
}

/** The entries as the card shows them: a move up with the emptying just before it, as one. */
function folded(events: readonly LaunchJournalEventView[]): Array<Readonly<{ entry: LaunchJournalEventView; emptied: LaunchJournalEventView | null }>> {
  const out: Array<Readonly<{ entry: LaunchJournalEventView; emptied: LaunchJournalEventView | null }>> = [];
  for (let index = 0; index < events.length; index += 1) {
    const entry = events[index]!;
    const before = events[index + 1];
    if (entry.kind === "FLOOR_RAISED" && before?.kind === "FLOOR_WITHDRAWN") {
      out.push({ entry, emptied: before });
      index += 1;
    } else out.push({ entry, emptied: null });
  }
  return out;
}

function detail(entry: LaunchJournalEventView, word: Word, money: (raw: string) => string, tokens: (raw: string) => string, price: (value: number) => Line, locale: WorkspaceLocale): Line | null {
  const plain = (key: LaunchWordKey, values: Readonly<Record<string, string>> = {}) => say(word, key, values);
  switch (entry.kind) {
    case "LAUNCHED":
      return entry.pairRaw && entry.tokensRaw ? plain("log_LAUNCHED_buy", { tokens: tokens(entry.tokensRaw), amount: money(entry.pairRaw) }) : null;
    case "CREATOR_LOCKED":
      return entry.tokensRaw ? plain("log_CREATOR_LOCKED_detail", { tokens: tokens(entry.tokensRaw) }) : null;
    case "FEES_SHARED":
      return plain("log_FEES_SHARED_detail");
    case "CREATOR_SOLD":
      if (!entry.tokensRaw || !entry.pairRaw || entry.soldBps === null) return null;
      return plain(entry.soldOf === "supply" ? "log_CREATOR_SOLD_supply" : "log_CREATOR_SOLD_detail", { tokens: tokens(entry.tokensRaw), amount: money(entry.pairRaw), pct: formatBps(entry.soldBps, locale) });
    case "GRADUATED":
      return entry.pairRaw ? plain(`log_GRADUATED_${entry.actor === "ryntra" ? "ryntra" : entry.actor === "meteora" ? "meteora" : "other"}`, { amount: money(entry.pairRaw) }) : null;
    case "FLOOR_POOL":
      return entry.tokensRaw && entry.pairRaw && BigInt(entry.pairRaw) > 0n ? plain("log_FLOOR_POOL_detail", { tokens: tokens(entry.tokensRaw), amount: money(entry.pairRaw) }) : null;
    case "FLOOR_WITHDRAWN":
      return entry.pairRaw ? plain("log_FLOOR_WITHDRAWN_detail", { amount: money(entry.pairRaw) }) : null;
    case "FLOOR_PLACED":
    case "FLOOR_RAISED":
    case "FLOOR_ADDED":
      return entry.pairRaw && entry.priceLow !== null && entry.priceHigh !== null
        ? say(word, `log_${entry.kind}_detail`, { amount: money(entry.pairRaw) }, { low: price(entry.priceLow), high: price(entry.priceHigh) })
        : null;
  }
}
