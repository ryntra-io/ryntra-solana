"use client";

import { ArrowRight, Sparkle } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { AutoinvestBlock } from "@/app/app/invest/autoinvest-block";
import { investWords, numberLocale } from "@/app/app/invest/invest-words";
import styles from "@/app/app/invest/invest.module.css";
import { bellWords } from "@/app/app/notifications/bell-words";
import { NoteList } from "@/app/app/notifications/note-list";
import { useNotes } from "@/app/app/notifications/use-notes";
import { readSearchIndex } from "@/app/app/search/search-index";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { formatPercent, formatUsdPrice, toneOf } from "@/app/solana/workspace/spot/spot-format";
import { suggestionsFor } from "@/lib/agent/suggestions";
import { moversOf, type Mover } from "@/lib/search/movers";

import home from "./home.module.css";

/**
 * Home's right column: from 1280 px — every desk from 1440 up — it stands
 * beside the main one so no half of a wide screen is empty; on a phone its
 * blocks come under the main ones, in the same order. Four blocks, each
 * reading only what exists:
 *
 * - **Сповіщення** — the latest notes, from the page's one read of the
 *   monitoring surface the bell shares (`useNotes`), behind the wallet's proof;
 * - **Автоінвест** — the wallet's rules and their next purchases, the block
 *   Portfolio and its own page draw; a guest reads what it is in one line;
 * - **Спитати Ryntra** — a question straight to the assistant, and the ones
 *   it answers best for this wallet;
 * - **Що рухається сьогодні** — the day's biggest moves among the companies
 *   and the crypto Markets draws (`moversOf`).
 *
 * Nothing here is orange: the page's one orange action is the head's.
 */
export function HomeAside({ locale }: { locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const { connection } = useSolanaConnection();
  return (
    <aside className={home.aside} aria-label={word("asideLabel")}>
      <NotesBlock locale={locale} />
      {connection ? <AutoinvestBlock locale={locale} compact /> : <AutoinvestGuest locale={locale} />}
      <AskBlock locale={locale} wallet={Boolean(connection)} />
      <MoversBlock locale={locale} />
    </aside>
  );
}

/** How many notes stand in the column; the rest are one press away in Нагляд. */
const NOTES_SHOWN = 3;

function NotesBlock({ locale }: { locale: WorkspaceLocale }) {
  const bell = bellWords(locale);
  const notes = useNotes(locale);
  return (
    <section className={styles.section} aria-labelledby="home-notes-title" data-block="notes">
      <div className={styles.sectionHead}>
        <h2 id="home-notes-title" className={styles.sectionTitle}>
          {bell("title")}
          {notes.unread > 0 ? <span className={home.count}>{notes.unread > 99 ? "99+" : notes.unread}</span> : null}
        </h2>
        <Link className={styles.sectionLink} href="/app/alerts" prefetch={false}>
          {bell("all")}
          <ArrowRight size={14} weight="bold" aria-hidden="true" />
        </Link>
      </div>
      <div className={home.card}>
        {notes.phase === "guest" ? (
          <p className={home.cardLine}>{bell("guest")}</p>
        ) : notes.phase === "unproven" ? (
          <>
            <p className={home.cardLine}>{bell("unproven")}</p>
            <button type="button" className={home.textButton} onClick={notes.prove} disabled={notes.signing}>
              {notes.signing ? bell("confirming") : bell("confirm")}
            </button>
          </>
        ) : notes.phase === "failed" ? (
          <>
            <p className={home.cardLine}>{bell("failed")}</p>
            <button type="button" className={home.textButton} onClick={() => notes.reload()}>
              {bell("tryAgain")}
            </button>
          </>
        ) : !notes.surface ? (
          <p className={home.cardLine} aria-busy="true">{bell("loading")}</p>
        ) : notes.surface.recent.length === 0 ? (
          <p className={home.cardLine}>{bell("empty")}</p>
        ) : (
          <NoteList
            notes={notes.surface.recent.slice(0, NOTES_SHOWN)}
            locale={locale}
            onOpen={(note) => {
              if (note.unread) notes.markRead(note.id);
            }}
          />
        )}
      </div>
    </section>
  );
}

/** A guest's «Автоінвест»: what it is in one line, and the way to its page. */
function AutoinvestGuest({ locale }: { locale: WorkspaceLocale }) {
  const word = investWords(locale);
  return (
    <section className={styles.section} aria-labelledby="home-autoinvest-title" data-block="autoinvest" data-guest="true">
      <div className={styles.sectionHead}>
        <h2 id="home-autoinvest-title" className={styles.sectionTitle}>{word("autoinvest")}</h2>
      </div>
      <div className={home.card}>
        <p className={home.cardLine}>{word("autoinvestGuest")}</p>
        <Link className={home.textButton} href="/app/bots" prefetch={false}>
          {word("howItWorks")}
          <ArrowRight size={14} weight="bold" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

/**
 * A question straight to the assistant — on its page, with the wallet's
 * portfolio as the context when there is a wallet — and the questions its own
 * list says it answers best (`lib/agent/suggestions.ts`).
 */
function AskBlock({ locale, wallet }: { locale: WorkspaceLocale; wallet: boolean }) {
  const word = investWords(locale);
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const lang = locale === "uk" ? "uk" : "en";
  const portfolio = suggestionsFor({ kind: "portfolio" }, lang);
  const general = suggestionsFor(null, lang);
  /* A wallet: what changed, and the short read of it; a guest: why the market moves. */
  const offered = wallet ? [portfolio[0], portfolio[4]] : [general[1]];
  const href = (text: string) => {
    const params = new URLSearchParams(wallet ? { context: "portfolio", q: text } : { q: text });
    return `/app/ryn?${params.toString()}`;
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (text.length === 0) return;
    router.push(href(text));
  };
  return (
    <section className={styles.section} aria-labelledby="home-ask-title" data-block="ask">
      <div className={styles.sectionHead}>
        <h2 id="home-ask-title" className={`${styles.sectionTitle} ${home.withIcon}`}>
          <Sparkle size={16} weight="bold" aria-hidden="true" />
          {word("askRyntra")}
        </h2>
      </div>
      <div className={home.card}>
        <form className={home.ask} onSubmit={submit}>
          <input
            className={home.askInput}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={word("askPlaceholder")}
            aria-label={word("askRyntra")}
            maxLength={500}
            autoComplete="off"
          />
          <button type="submit" className={`rw-btn ${home.askSend}`} disabled={question.trim().length === 0}>
            {word("askSend")}
          </button>
        </form>
        <div className={home.chips}>
          {offered.filter(Boolean).map((suggestion) => (
            <Link key={suggestion.text} className={home.chip} href={href(suggestion.text)} prefetch={false}>
              {suggestion.text}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/** How many moves stand in the column. */
const MOVERS_SHOWN = 5;

function MoversBlock({ locale }: { locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const numbers = numberLocale(locale);
  const [state, setState] = useState<{ status: "loading" } | { status: "failed" } | { status: "ready"; movers: readonly Mover[] }>({ status: "loading" });
  useEffect(() => {
    let live = true;
    void readSearchIndex().then((index) => {
      if (!live) return;
      setState(index ? { status: "ready", movers: moversOf(index, MOVERS_SHOWN) } : { status: "failed" });
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className={styles.section} aria-labelledby="home-movers-title" data-block="movers">
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitles}>
          <h2 id="home-movers-title" className={styles.sectionTitle}>{word("movingToday")}</h2>
          <p className={styles.sectionNote}>{word("movingNote")}</p>
        </div>
        <Link className={styles.sectionLink} href="/app/markets" prefetch={false}>
          {word("allMarkets")}
          <ArrowRight size={14} weight="bold" aria-hidden="true" />
        </Link>
      </div>
      {state.status === "loading" ? (
        /* The shape of what is coming, one column like the list itself — never a spinner. */
        <ul className={`${home.card} ${home.movers}`} aria-hidden="true">
          {Array.from({ length: MOVERS_SHOWN }, (_, index) => (
            <li key={index}>
              <span className={home.mover}>
                <span className={`${home.moverLogo} ${home.ghost}`} />
                <span className={`${home.ghostLine} ${home.ghost}`} />
                <span className={`${home.ghostShort} ${home.ghost}`} />
              </span>
            </li>
          ))}
        </ul>
      ) : state.status === "failed" || state.movers.length === 0 ? (
        <div className={home.card}>
          <p className={home.cardLine}>{word("movingDown")}</p>
        </div>
      ) : (
        <ul className={`${home.card} ${home.movers}`}>
          {state.movers.map((mover) => (
            <li key={mover.key}>
              <Link className={home.mover} href={mover.href} prefetch={false}>
                <MarketIcon mint={mover.mint} icon={mover.icon} symbol={mover.name} size={32} className={home.moverLogo} plain={mover.kind === "crypto"} />
                <span className={home.moverName}>{mover.name}</span>
                <span className={home.moverFigures}>
                  <span className={home.moverPrice}>{formatUsdPrice(mover.price, numbers)}</span>
                  <span className={home.moverChange} data-tone={toneOf(mover.change24h)}>
                    {formatPercent(mover.change24h, numbers)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
