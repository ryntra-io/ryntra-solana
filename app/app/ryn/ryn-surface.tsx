"use client";

import { ArrowRight, ArrowUpRight, Bell, ClockCountdown, ClockCounterClockwise, Coins, Eye, Microphone, NotePencil, PaperPlaneTilt, Plus, Sparkle, Stop, SunHorizon, Waveform } from "@phosphor-icons/react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { ConnectWalletButton } from "@/app/solana/workspace/wallet-gate";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { AgentBudgetState, AgentCard, AgentCitation, AgentContext, AgentFigure, AgentGuestResponse, AgentHandoff, AgentMessageResponse, AgentSessionListResponse, AgentSessionResponse, AgentSessionSummary, AgentSuggestion, AgentTurn, AssistantCredits, AssistantProfileResponse, AssistantTasksResponse } from "@/lib/api/v1/contract";

import { criticKindLabel, lensWordsFor } from "@/app/app/lens/lens-words";

import { asksByItself, type AssistantTab } from "./assistant-open";
import { BriefPanel } from "./brief-panel";
import { CreditsPanel, priceLine, shownPrice } from "./credits-panel";
import { CREDITS_TOP_UP_EVENT, creditNumber, creditsWord, loadCredits, publishCredits, useCredits } from "./credits-store";
import { AboutPrompt, aboutAsked, MemoryCard, RememberedLine, useMemory } from "./memory-card";
import { TasksPanel } from "./tasks-panel";
import { Meet, profileSummary } from "./meet";
import { PlansTab } from "./plans-tab";
import styles from "./ryn.module.css";
import { rynWordsFor, type RynWord } from "./ryn-words";
import { clockOf, useDictation, useRecording, useVoiceLanguage, type RecordingProblem } from "./voice-input";
import { WatchPanel } from "./watch-panel";

/**
 * Ryn's surface:
 * one conversation, a context badge, suggested questions, the structured
 * answer with its citations, the typed cards, and the handoffs to the
 * builder, the Review, a plan and Monitoring. Ask → Understand → Prepare →
 * Review. Not ten panels around a chat: the conversation is the page, the
 * cards sit inside the turn they belong to, and every action is a link to
 * the surface where the person decides — Ryn acted on nothing.
 *
 * The conversation is the proven wallet's: the gate asks for
 * the connection and the one signature before anything is read.
 *
 * AI-02: without a proven wallet the page is not a gate any more — a guest
 * asks about the market and is answered (`/api/v1/assistant/guest`), with
 * the way to connect a wallet beside the composer. A wallet's conversations
 * carry their days and times, «Нова розмова» and the list of conversations
 * with their dates (kept 90 days).
 *
 * AI-06: the side panel and the page are one surface with its tabs —
 * Розмова · Стежу · Доручення · Плани · Огляди · Кредити; «Що бачить Ryntra»
 * beside the field; «Знайомство», five questions, the first time a wallet
 * opens it.
 *
 * AI-20 (UX-704, UX-705): one home for each thing — the token watches in
 * «Стежу», the scheduled questions in «Доручення» (a tab of their own, not a
 * block under the watches), and the trade plans in «Боти»: «Плани» composes
 * one with Ryntra or opens the builder and leads to «Боти», with no second
 * list here. A guest's «Підключити гаманець» is the header's one button
 * (B14), never a fold that unrolls a sentence.
 */

type Phase = { status: "opening" } | { status: "ready"; session: AgentSessionResponse["session"]; budget: AgentBudgetState; suggestions: readonly AgentSuggestion[] } | { status: "failed"; reason: string };

const HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;

async function readError(response: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return { code: body.error?.code ?? "UNAVAILABLE", message: body.error?.message ?? `HTTP ${response.status}` };
  } catch {
    return { code: "UNAVAILABLE", message: `HTTP ${response.status}` };
  }
}

function stateWord(state: AgentFigure["state"], word: (w: RynWord) => string): string {
  return word(state === "current" ? "stateCurrent" : state === "stale" ? "stateStale" : state === "unavailable" ? "stateUnavailable" : "stateUnknown");
}

function Figures({ figures, word }: { figures: readonly AgentFigure[]; word: (w: RynWord) => string }) {
  return (
    <dl className={styles.figures}>
      {figures.map((figure, index) => (
        <div key={`${figure.label}-${index}`} className={styles.figure} data-state={figure.state}>
          <dt>{figure.label}</dt>
          <dd>
            <span className={styles.value} data-words={!/\d/.test(figure.value)}>{figure.value}</span>
            {figure.state !== "current" ? <span className={styles.stateTag}>{stateWord(figure.state, word)}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** AI-09: a time as the answer's own words say it — in UTC, so a card and a sentence name the same minute. */
function utcTime(iso: string, locale: WorkspaceLocale): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  return `${new Date(at).toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
}

const MARK_WORD = { fact: "markFact", unverified: "markUnverified", inference: "markInference", unknown: "markUnknown" } as const;

/** A count with its noun agreeing — one, few (2–4), many in Ukrainian; one and many in English. */
function counted(n: number, locale: WorkspaceLocale, en: readonly [string, string], uk: readonly [string, string, string]): string {
  if (locale !== "uk") return `${n} ${n === 1 ? en[0] : en[1]}`;
  const ten = n % 10;
  const hundred = n % 100;
  const noun = ten === 1 && hundred !== 11 ? uk[0] : ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14) ? uk[1] : uk[2];
  return `${n} ${noun}`;
}

function Handoff({ handoff }: { handoff: AgentHandoff }) {
  return (
    <Link className={handoff.primary ? "rw-btn rw-btn--primary" : "rw-btn"} href={handoff.href} prefetch={false}>
      <span>{handoff.label}</span>
      <ArrowRight size={14} weight="bold" aria-hidden="true" />
    </Link>
  );
}

function Card({ card, locale, word }: { card: AgentCard; locale: WorkspaceLocale; word: (w: RynWord) => string }) {
  const money = (value: number | null) => (value === null ? word("stateUnavailable") : value.toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: value > 0 && value < 0.01 ? 0 : 2, maximumFractionDigits: value > 0 && value < 0.01 ? 8 : 2 }));
  switch (card.kind) {
    case "market":
    case "stock":
      return (
        <article className={styles.card} data-kind={card.kind}>
          <header className={styles.cardHead}>
            <Link href={card.href} prefetch={false} className={styles.cardTitle}>
              {card.symbol} <span className={styles.cardName}>{card.name}</span>
            </Link>
            <span className={styles.cardMeta}>{card.kind === "stock" ? card.issuer.label : card.category ?? ""}</span>
          </header>
          <Figures figures={card.figures} word={word} />
        </article>
      );
    case "evidence":
      return (
        <article className={styles.card} data-kind="evidence">
          <header className={styles.cardHead}>
            <span className={styles.cardTitle}>
              {word("cardEvidence")} <span className={styles.cardName}>{card.window}</span>
            </span>
            {card.attribution ? (
              <a className={styles.cardMeta} href={card.attribution.href} target="_blank" rel="noreferrer noopener">
                {card.attribution.text}
              </a>
            ) : null}
          </header>
          {card.figures.length > 0 ? <Figures figures={card.figures} word={word} /> : <p className={styles.muted}>{card.reason ?? word("insufficient")}</p>}
        </article>
      );
    case "holdings":
      return (
        <article className={styles.card} data-kind="holdings">
          <header className={styles.cardHead}>
            <Link href={card.href} prefetch={false} className={styles.cardTitle}>
              {word("cardHoldings")}
            </Link>
            <span className={styles.cardMeta}>
              {word("tokenRead")} {card.tokenRead.toLowerCase()} · {card.unpriced} {word("unpriced")}
            </span>
          </header>
          <ul className={styles.rows}>
            {card.rows.map((row) => (
              <li key={row.mint} className={styles.row}>
                <span className={styles.rowSymbol}>{row.symbol}</span>
                <span className={styles.rowAmount}>{row.amount}</span>
                <span className={styles.rowPrice}>{row.priceUsd === null ? word("stateUnavailable") : `$${money(row.priceUsd)} ${word("perUnit")}`}</span>
                {row.plans.length > 0 ? <span className={styles.rowPlan}>{word("cardPlan")}</span> : null}
              </li>
            ))}
          </ul>
        </article>
      );
    case "plan":
      return (
        <article className={styles.card} data-kind="plan">
          <header className={styles.cardHead}>
            <Link href={card.href} prefetch={false} className={styles.cardTitle}>
              {word("cardPlan")} {card.symbol} <span className={styles.cardName}>v{card.version}</span>
            </Link>
            <span className={styles.cardMeta}>{card.status}</span>
          </header>
          <Figures figures={card.figures} word={word} />
          {card.review && card.review.failed.length > 0 ? (
            <ul className={styles.failed}>
              {card.review.failed.map((check) => (
                <li key={check.id}>
                  <span className={styles.failedId}>{word("reviewFailed")}</span> {check.expected}
                  {check.actual ? ` · ${check.actual}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      );
    case "note":
      return (
        <article className={styles.card} data-kind="note">
          <header className={styles.cardHead}>
            <Link href={card.href} prefetch={false} className={styles.cardTitle}>
              {card.title}
            </Link>
            <span className={styles.cardMeta}>{new Date(card.createdAt).toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC</span>
          </header>
          <p className={styles.cardCopy}>{card.reason}</p>
        </article>
      );
    case "comparison":
      return (
        <article className={styles.card} data-kind="comparison">
          <header className={styles.cardHead}>
            <span className={styles.cardTitle}>
              {word("cardComparison")} <span className={styles.cardName}>{card.title}</span>
            </span>
          </header>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col" />
                  {card.columns.map((column) => (
                    <th key={column.id} scope="col">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {card.rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    {row.cells.map((cell, index) => (
                      <td key={index} data-established={cell.established}>
                        {cell.text}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.muted}>{card.note}</p>
        </article>
      );
    case "news":
      return (
        <article className={styles.card} data-kind="news">
          <header className={styles.cardHead}>
            <span className={styles.cardTitle}>
              {card.symbol ? word("cardNews") : word("cardNewsMarket")} {card.symbol ? <span className={styles.cardName}>{card.symbol}</span> : null}
            </span>
            <span className={styles.cardMeta}>
              {counted(card.day.stories, locale, ["story", "stories"], ["історія", "історії", "історій"])} · {counted(card.day.sources, locale, ["source", "sources"], ["джерело", "джерела", "джерел"])} {word("newsDay")}
              {card.state !== "current" ? <span className={styles.stateTag}> · {stateWord(card.state, word)}</span> : null}
            </span>
          </header>
          {card.items.length > 0 ? (
            <ul className={styles.news}>
              {card.items.map((item) => (
                <li key={item.id} className={styles.newsItem}>
                  <a className={styles.newsTitle} href={item.url} target="_blank" rel="noopener noreferrer nofollow">
                    {item.title}
                  </a>
                  <span className={styles.newsMeta}>
                    {item.source} · {utcTime(item.publishedAt, locale)}
                    {item.also > 0 ? ` · ${locale === "uk" ? "ще" : "+"} ${counted(item.also, locale, ["more source", "more sources"], ["джерело", "джерела", "джерел"])}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>{word("newsNone")}</p>
          )}
          <p className={styles.newsNote}>
            {card.items.length > 0 ? `${word("newsSpan")} ` : ""}
            {word("newsReport")} {word("newsCollected")}: {utcTime(card.collectedAt, locale)}.
          </p>
        </article>
      );
    case "move":
      return (
        <article className={styles.card} data-kind="move">
          <header className={styles.cardHead}>
            <span className={styles.cardTitle}>
              {word("cardMove")} <span className={styles.cardName}>{card.symbol} · {word(card.window === "1h" ? "move1h" : "move24h")}</span>
            </span>
            {card.change ? (
              <span className={styles.moveChange} data-sign={card.change.number === null ? "none" : card.change.number < 0 ? "down" : card.change.number > 0 ? "up" : "flat"}>
                {card.change.value}
                {card.change.state !== "current" ? <span className={styles.stateTag}> {stateWord(card.change.state, word)}</span> : null}
              </span>
            ) : null}
          </header>
          <ol className={styles.moveRows}>
            {card.rows.map((row, index) => (
              <li key={index} className={styles.moveRow}>
                <span className={styles.mark} data-mark={row.mark}>
                  {word(MARK_WORD[row.mark])}
                </span>
                <span className={styles.moveText}>{row.text}</span>
              </li>
            ))}
          </ol>
          <details className={styles.marksLegend}>
            <summary>{word("marksWhat")}</summary>
            <p>{word("marksLegend")}</p>
          </details>
        </article>
      );
    case "planDraft":
      return (
        <article className={styles.card} data-kind="draft">
          <header className={styles.cardHead}>
            <span className={styles.cardTitle}>
              {word("draftPlan")} <span className={styles.cardName}>{card.asset.symbol}</span>
            </span>
          </header>
          <dl className={styles.figures}>
            {[
              ["entry", card.prefill.entryUsd],
              ["maxPrice", card.prefill.maxPriceUsd],
              ["invalidation", card.prefill.invalidationUsd],
              ["risk", card.prefill.riskUsd],
              ["budget", card.prefill.budgetUsd],
            ].map(([key, value]) => (
              <div key={String(key)} className={styles.figure}>
                <dt>{{ entry: locale === "uk" ? "Вхід" : "Entry", maxPrice: locale === "uk" ? "Макс. ціна" : "Max price", invalidation: locale === "uk" ? "Інвалідація" : "Invalidation", risk: locale === "uk" ? "Плановий ризик" : "Planned risk", budget: locale === "uk" ? "Бюджет" : "Budget" }[String(key)]}</dt>
                <dd>
                  <span className={styles.value}>{typeof value === "number" ? `$${money(value)}` : "—"}</span>
                </dd>
              </div>
            ))}
            {card.sizing ? (
              <div className={styles.figure}>
                <dt>{locale === "uk" ? "Розмір" : "Size"}</dt>
                <dd>
                  <span className={styles.value}>
                    {card.sizing.units} {card.asset.symbol}
                  </span>
                </dd>
              </div>
            ) : null}
          </dl>
          {card.issues.length > 0 ? (
            <details className={styles.fold}>
              <summary>{word("draftIssues")}</summary>
              <ul className={styles.list}>
                {card.issues.map((issue) => (
                  <li key={issue.path}>{issue.message}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <details className={styles.fold}>
            <summary>{word("draftAssumptions")}</summary>
            <ul className={styles.list}>
              {card.assumptions.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
          <p className={styles.boundary}>{word("boundary")}</p>
          <div className={styles.cardActions}>
            <Handoff handoff={card.handoff} />
          </div>
        </article>
      );
    case "monitoringDraft":
      return (
        <article className={styles.card} data-kind="draft">
          <header className={styles.cardHead}>
            <span className={styles.cardTitle}>
              {word("draftMonitoring")} <span className={styles.cardName}>{card.subject.symbol}</span>
            </span>
          </header>
          <p className={styles.cardCopy}>
            <code className={styles.mono}>
              {card.condition.metric} · {card.condition.window} · {card.condition.operator} {card.condition.threshold}
            </code>
            {card.observed ? ` — ${word("observed")} ${card.observed.value}` : ""}
          </p>
          <details className={styles.fold}>
            <summary>{word("draftAssumptions")}</summary>
            <ul className={styles.list}>
              {card.assumptions.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
          <p className={styles.boundary}>{word("boundary")}</p>
          <div className={styles.cardActions}>
            <Handoff handoff={card.handoff} />
          </div>
        </article>
      );
    case "tradeDraft":
      return (
        <article className={styles.card} data-kind="draft">
          <header className={styles.cardHead}>
            <span className={styles.cardTitle}>
              {word("draftTrade")} <span className={styles.cardName}>{card.side} {card.symbol}</span>
            </span>
            {card.amountUsd !== null ? <span className={styles.cardMeta}>${money(card.amountUsd)}</span> : null}
          </header>
          <p className={styles.boundary}>{card.boundary}</p>
          <div className={styles.cardActions}>
            <Handoff handoff={card.handoff} />
          </div>
        </article>
      );
    default:
      return null;
  }
}

/**
 * The sentences as a person reads them. The citation ids each one carries
 * stay in the record, not on the line — «1,3» after a sentence is the
 * engine's bookkeeping; what a sentence stands on
 * is under *Sources*, one press deep.
 */
function Sentences({ sentences }: { sentences: readonly { text: string; cites: readonly string[] }[] }) {
  return (
    <ul className={styles.sentences}>
      {sentences.map((sentence, index) => (
        <li key={index}>{sentence.text}</li>
      ))}
    </ul>
  );
}

function Sources({ citations, locale, word }: { citations: readonly AgentCitation[]; locale: WorkspaceLocale; word: (w: RynWord) => string }) {
  if (citations.length === 0) return null;
  return (
    <details className={styles.fold}>
      <summary>{word("sources")}</summary>
      <ol className={styles.sources}>
        {citations.map((citation) => (
          <li key={citation.id} data-state={citation.state}>
            <span className={styles.sourceName}>{citation.href ? <Link href={citation.href} prefetch={false}>{citation.source}</Link> : citation.source}</span>
            <span className={styles.sourceMeta}>
              {/* The reader's own clock: the turns arrive in the browser, never rendered on a server in UTC. */}
              {citation.observedAt ? `${new Date(citation.observedAt).toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })} · ` : ""}
              {stateWord(citation.state, word)}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * The two formats inside a turn. The person asked
 * for one of them by name; the six-section answer is written beside it and
 * stays below, so nothing is lost by asking for the short read. The
 * sentences arrive already in the reader's language and already cited — the
 * conversation only lays them out.
 */
function TurnFormats({ turn, locale }: { turn: AgentTurn; locale: WorkspaceLocale }) {
  const say = lensWordsFor(locale === "uk" ? "uk" : "en");
  if (!turn.brief && !turn.critic) return null;
  return (
    <div className={styles.answer} data-format={turn.brief ? "brief" : "critic"}>
      {turn.brief ? (
        turn.brief.insufficient ? (
          <p className={styles.insufficient}>{say("insufficient")}</p>
        ) : (
          <>
            {([["changed", turn.brief.changed], ["matters", turn.brief.matters], ["supports", turn.brief.supports], ["unknown", turn.brief.unknown], ["checks", turn.brief.checks]] as const).map(([key, rows]) =>
              rows.length > 0 ? (
                <section key={key} className={styles.section}>
                  <h3>{say(key)}</h3>
                  <Sentences sentences={rows} />
                </section>
              ) : null,
            )}
          </>
        )
      ) : null}
      {turn.critic ? (
        <section className={styles.section}>
          <h3>{say("critic")}</h3>
          {turn.critic.insufficient ? (
            <p className={styles.insufficient}>{say("criticInsufficient")}</p>
          ) : (
            <ul className={styles.sentences}>
              {turn.critic.findings.map((finding) => (
                <li key={finding.id} data-kind={finding.kind}>
                  <b>{criticKindLabel(finding.kind, locale === "uk" ? "uk" : "en")}</b> — {finding.text}
                </li>
              ))}
            </ul>
          )}
          {turn.critic.gaps.length > 0 ? (
            <details className={styles.fold}>
              <summary>{say("gaps")}</summary>
              <Sentences sentences={turn.critic.gaps} />
            </details>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/**
 * AI-06c: a talk — a greeting, a thanks, «who are you», a general question —
 * reads like a person's reply: the sentences as paragraphs with no section
 * titles and no «composed from the reads», and the questions it offers as
 * buttons that ask them (on the newest reply only). A turn with a read in it
 * is never drawn this way.
 */
export function isTalkTurn(turn: Pick<AgentTurn, "role" | "class" | "cards" | "citations" | "answer">): boolean {
  return turn.role === "ryn" && turn.class === "help" && turn.cards.length === 0 && turn.citations.length === 0 && turn.answer !== null;
}

function TalkTurn({ turn, word, time, onAsk, sending }: { turn: AgentTurn; word: (w: RynWord) => string; time: string | null; onAsk: ((question: string) => void) | null; sending: boolean }) {
  const answer = turn.answer!;
  const lines = [...answer.observation, ...answer.meaning, ...answer.actions.filter((sentence) => !sentence.text.trim().endsWith("?"))];
  const asks = answer.actions.map((sentence) => sentence.text.trim()).filter((text) => text.endsWith("?"));
  return (
    <article className={styles.turn} data-role="ryn" data-class="help" data-talk="">
      <header className={styles.turnHead}>
        <span className={styles.who}>{word("who")}</span>
        {time ? <time className={styles.turnTime} dateTime={turn.at}>{time}</time> : null}
      </header>
      <div className={styles.talk}>
        {lines.map((sentence, index) => (
          <p key={index}>{sentence.text}</p>
        ))}
      </div>
      {onAsk && asks.length > 0 ? (
        <div className={styles.talkAsks} role="group" aria-label={word("talkAsks")}>
          {asks.map((question) => (
            <button key={question} type="button" className={styles.chip} onClick={() => onAsk(question)} disabled={sending}>
              {question}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function RynTurn({ turn, locale, word, time }: { turn: AgentTurn; locale: WorkspaceLocale; word: (w: RynWord) => string; time: string | null }) {
  const answer = turn.answer;
  const deeper = answer ? [...answer.counter, ...answer.risks, ...answer.checks].length > 0 : false;
  return (
    <article className={styles.turn} data-role="ryn" data-class={turn.class ?? ""}>
      <header className={styles.turnHead}>
        <span className={styles.who}>{word("who")}</span>
        <span className={styles.headline}>{turn.text}</span>
        {time ? <time className={styles.turnTime} dateTime={turn.at}>{time}</time> : null}
      </header>
      {turn.refusal ? <p className={styles.refusal}>{turn.refusal.code === "execute" ? word("refusedExecute") : word("refusedSecret")}</p> : null}
      <TurnFormats turn={turn} locale={locale} />
      {answer ? (
        <div className={styles.answer}>
          {answer.insufficient ? <p className={styles.insufficient}>{word("insufficient")}</p> : null}
          {answer.observation.length > 0 ? (
            <section className={styles.section}>
              <h3>{word("observation")}</h3>
              <Sentences sentences={answer.observation} />
            </section>
          ) : null}
          {answer.meaning.length > 0 ? (
            <section className={styles.section}>
              <h3>{word("meaning")}</h3>
              <Sentences sentences={answer.meaning} />
            </section>
          ) : null}
          {turn.cards.length > 0 ? (
            <div className={styles.cards}>
              {turn.cards.map((card, index) => (
                <Card key={`${card.kind}-${index}`} card={card} locale={locale} word={word} />
              ))}
            </div>
          ) : null}
          {deeper ? (
            <details className={styles.fold} open={turn.class === "evidence" || turn.class === "plan" || turn.class === "monitoring"}>
              <summary>{word("more")}</summary>
              {answer.counter.length > 0 ? (
                <section className={styles.section}>
                  <h3>{word("counter")}</h3>
                  <Sentences sentences={answer.counter} />
                </section>
              ) : null}
              {answer.risks.length > 0 ? (
                <section className={styles.section}>
                  <h3>{word("risks")}</h3>
                  <Sentences sentences={answer.risks} />
                </section>
              ) : null}
              {answer.checks.length > 0 ? (
                <section className={styles.section}>
                  <h3>{word("checks")}</h3>
                  <Sentences sentences={answer.checks} />
                </section>
              ) : null}
            </details>
          ) : null}
          {answer.actions.length > 0 ? (
            <section className={styles.section}>
              <h3>{word("actions")}</h3>
              <Sentences sentences={answer.actions} />
            </section>
          ) : null}
        </div>
      ) : null}
      {/* The turn's handoffs, less the ones a draft card already carries as its own button. */}
      {turn.handoffs.filter((handoff) => !turn.cards.some((card) => "handoff" in card && card.handoff.href === handoff.href)).length > 0 ? (
        <div className={styles.handoffs}>
          {turn.handoffs
            .filter((handoff) => !turn.cards.some((card) => "handoff" in card && card.handoff.href === handoff.href))
            .map((handoff) => (
              <Handoff key={handoff.href} handoff={handoff} />
            ))}
        </div>
      ) : null}
      <footer className={styles.turnFoot}>
        <Sources citations={turn.citations} locale={locale} word={word} />
        <span className={styles.composed}>{turn.composedBy === "model" ? word("composedModel") : word("composedDeterministic")}</span>
      </footer>
    </article>
  );
}

/* ── The conversation's chrome: day dividers, times, the composer (AI-02) ── */

const localeTag = (locale: WorkspaceLocale) => (locale === "uk" ? "uk-UA" : "en-US");

/** The day a turn belongs to on the reader's own clock — «Сьогодні», «Вчора», or the date. */
function dayLabel(at: string, locale: WorkspaceLocale, word: (w: RynWord) => string, nowMs: number): string {
  const day = new Date(at);
  const today = new Date(nowMs);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(day, today)) return word("today");
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(day, yesterday)) return word("yesterday");
  return day.toLocaleDateString(localeTag(locale), { day: "numeric", month: "long", year: day.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

const timeOf = (at: string, locale: WorkspaceLocale) => new Date(at).toLocaleTimeString(localeTag(locale), { hour: "2-digit", minute: "2-digit", hour12: false });

function Conversation({ turns, locale, word, sending, endRef, onAsk }: { turns: readonly AgentTurn[]; locale: WorkspaceLocale; word: (w: RynWord) => string; sending: boolean; endRef: RefObject<HTMLDivElement | null>; onAsk: (question: string) => void }) {
  /* The reader's clock, read after mount: a server renders in UTC and would print another day. */
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => setNowMs(Date.now()), [turns.length]);
  let lastDay: string | null = null;
  return (
    <div className={styles.conversation} aria-live="polite">
      {turns.map((turn, index) => {
        const label = nowMs === null ? null : dayLabel(turn.at, locale, word, nowMs);
        const divider = label !== null && label !== lastDay ? label : null;
        if (label !== null) lastDay = label;
        return (
          <Fragment key={turn.id}>
            {divider ? (
              <p className={styles.dayDivider} role="separator">
                <span>{divider}</span>
              </p>
            ) : null}
            {turn.role === "person" ? (
              <article className={styles.turn} data-role="person">
                <header className={styles.turnHead}>
                  <span className={styles.who}>{word("you")}</span>
                  {nowMs !== null ? <time className={styles.turnTime} dateTime={turn.at}>{timeOf(turn.at, locale)}</time> : null}
                </header>
                <p className={styles.personText}>{turn.text}</p>
              </article>
            ) : isTalkTurn(turn) ? (
              <TalkTurn turn={turn} word={word} time={nowMs !== null ? timeOf(turn.at, locale) : null} onAsk={index === turns.length - 1 ? onAsk : null} sending={sending} />
            ) : (
              <RynTurn turn={turn} locale={locale} word={word} time={nowMs !== null ? timeOf(turn.at, locale) : null} />
            )}
          </Fragment>
        );
      })}
      {sending ? (
        <p className={styles.muted} aria-busy="true">
          {word("sending")}
        </p>
      ) : null}
      {/* AI-06c: the newest reply is scrolled to above the sticky field, not under it. */}
      <div ref={endRef} className={styles.conversationEnd} />
    </div>
  );
}

function Composer({ text, setText, sending, onSend, word, locale, placeholder, focus = false, page = false, owner = null, onCredits }: { text: string; setText: (value: string) => void; sending: boolean; onSend: (value: string) => void; word: (w: RynWord) => string; locale: WorkspaceLocale; placeholder: string; focus?: boolean; page?: boolean; owner?: string | null; onCredits?: (credits: AssistantCredits) => void }) {
  /* The page and the side panel each draw one; the label names its own field. */
  const id = useId();
  const noteId = useId();
  /* The language the person speaks — their choice, not the page's: an English page may be spoken to in Ukrainian. */
  const [speech, toggleSpeech] = useVoiceLanguage(locale);
  /* AI-06c: the microphone writes into this field; the person reads and corrects it, and asks with the button. */
  const voice = useDictation(speech, text, setText, sending);
  /* AI-08: where the browser cannot recognise speech, or its recognition failed, a proven wallet records and Ryntra's server hears it at the price shown. */
  const credits = useCredits(owner);
  const record = useRecording(
    speech,
    text,
    setText,
    credits ? credits.prices.voice : null,
    (next) => {
      if (!owner) return;
      /* Figures the server did not say are read again — never shown as «no credits here». */
      if (next === null) {
        loadCredits(owner, true);
        return;
      }
      publishCredits(owner, next);
      onCredits?.(next);
    },
    sending,
  );
  const [fellBack, setFellBack] = useState(false);
  useEffect(() => {
    if (voice.problem === "failed") setFellBack(true);
  }, [voice.problem]);
  const server = owner !== null && credits !== undefined && credits !== null && record.supported && (!voice.supported || fellBack);
  const browser = voice.supported && !server;
  /* Asking for the microphone counts as recording: the button stops it, «Спитати» waits. */
  const recording = record.phase === "recording" || record.phase === "opening";
  /* A recording waiting to be heard takes the field's one primary button: «Розпізнати · N кредитів» stands where «Спитати» was. */
  const waiting = server && record.phase === "recorded" && record.price !== null;
  const busy = recording || record.phase === "hearing";
  /* The person reached for the field or the microphone: from then on the line about where the sound goes stands under it. */
  const [engaged, setEngaged] = useState(false);
  /* While the microphone writes or records, a press or Enter only stops it: the words are read and corrected before they are asked. */
  const ask = () => {
    if (voice.listening) {
      voice.stop();
      return;
    }
    if (recording) {
      record.stop();
      return;
    }
    if (busy || waiting) return;
    onSend(text);
  };
  const credited = (n: number) => `${creditNumber(n, locale)} ${creditsWord(n, locale)}`;
  /* Where the sound goes is said before the first press — as soon as the field or the microphone is reached — while listening and after; never to someone who does not use the field. */
  const browserLine = voice.problem === "denied" ? word("voiceDenied") : voice.problem === "silence" ? word("voiceSilence") : voice.problem === "failed" ? word("voiceFailed") : voice.listening ? `${word("voiceListening")} ${word("voiceWhere")}` : voice.used ? `${word("voiceCheck")} ${word("voiceWhere")}` : engaged ? word("voiceWhere") : null;
  const problems: Record<RecordingProblem, RynWord> = { denied: "voiceDenied", recorder: "voiceFailed", silence: "voiceNotHeard", tooLong: "voiceTooLong", unreadable: "voiceUnreadable", noCredits: "voiceNoCredits", dayCap: "voiceDayCap", daySpent: "voiceDaySpent", priceChanged: "voicePriceChanged", failed: "voiceServerFailed" };
  const perBlock = credits ? credited(credits.prices.voice) : "";
  const serverWhere = word("voiceServerWhere").replace("{credits}", perBlock);
  const serverLine = record.problem
    ? word(problems[record.problem])
    : record.phase === "opening"
      ? word("voiceOpening")
      : recording
        ? word("voiceRecording").replace("{clock}", clockOf(record.seconds))
        : record.phase === "recorded"
          ? word("voiceRecorded").replace("{clock}", clockOf(record.seconds))
          : record.phase === "hearing"
            ? word("voiceHearing")
            : record.spent !== null
              ? word(record.spent.free >= record.spent.credits && record.spent.credits > 0 ? "voiceHeardFree" : "voiceHeard").replace("{credits}", credited(record.spent.credits))
              : fellBack
                ? word("voiceFallback").replace("{credits}", perBlock)
                : engaged
                  ? serverWhere
                  : null;
  const voiceLine = server ? serverLine : browser ? browserLine : null;
  const problem = server ? record.problem !== null : voice.problem !== null;
  const describe = server ? record.phase !== "idle" || record.problem !== null || record.spent !== null : voice.listening || voice.used || voice.problem !== null;
  /* The language switch sits only beside the calm lines — where the sound goes, check the text — never beside a problem, the clock or what was spent: a line stays within two rows. */
  const calm = !voice.listening && !busy && !waiting && !problem && (!server || (record.phase === "idle" && record.spent === null));
  const languageSwitch = (
    /* The language the microphone listens in — a press switches it, and this browser keeps the choice. `data-dense`: an inline word, out of the shell's 44 px button floor. */
    <button type="button" className={styles.voiceDiscard} data-dense="" onClick={toggleSpeech} aria-label={word(speech === "uk" ? "voiceLangSwitchToEn" : "voiceLangSwitchToUk")}>
      {word(speech === "uk" ? "voiceLangUk" : "voiceLangEn")}
    </button>
  );
  return (
    <>
      <form
        className={styles.composer}
        data-page={page ? "" : undefined}
        data-listening={voice.listening || recording ? "" : undefined}
        data-waiting={waiting ? "" : undefined}
        onFocus={() => setEngaged(true)}
        onPointerEnter={() => setEngaged(true)}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          ask();
        }}
      >
        <label className={styles.srOnly} htmlFor={id}>
          {word("send")}
        </label>
        <textarea
          id={id}
          className={styles.input}
          value={text}
          onChange={(event) => {
            voice.clear();
            record.clear();
            setText(event.target.value);
          }}
          placeholder={voice.listening ? word("voiceListening") : placeholder}
          rows={2}
          maxLength={2000}
          /* The side panel's field takes the focus as it appears: the panel was opened to ask. */
          autoFocus={focus}
          disabled={sending}
          /* While the microphone writes, the field is read: the words are corrected once it stops. */
          readOnly={voice.listening}
          aria-describedby={describe ? noteId : undefined}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              ask();
            }
          }}
        />
        <div className={styles.composerActions}>
          {server ? (
            <button type="button" className={styles.mic} onClick={recording ? record.stop : record.start} disabled={sending || record.phase === "hearing"} aria-pressed={recording} aria-label={recording ? word("voiceRecordStop") : word("voiceRecord")} title={recording ? word("voiceRecordStop") : word("voiceRecord")}>
              {recording ? <Stop size={16} weight="fill" aria-hidden="true" /> : <Microphone size={18} weight="bold" aria-hidden="true" />}
            </button>
          ) : browser ? (
            <button type="button" className={styles.mic} onClick={voice.toggle} disabled={sending} aria-pressed={voice.listening} aria-label={word("voiceInput")} title={word("voiceInput")}>
              {voice.listening ? <Stop size={16} weight="fill" aria-hidden="true" /> : <Microphone size={18} weight="bold" aria-hidden="true" />}
            </button>
          ) : null}
          {/* AI-08: the recording leaves the browser only by this press, its price on it. */}
          {waiting && record.price !== null ? (
            <button type="button" className="rw-btn rw-btn--primary" onClick={record.hear} disabled={sending}>
              <Waveform size={16} weight="bold" aria-hidden="true" />
              <span>{word("voiceHear").replace("{credits}", credited(record.price))}</span>
            </button>
          ) : (
            <button type="submit" className="rw-btn rw-btn--primary" disabled={sending || voice.listening || busy || text.trim().length === 0}>
              <PaperPlaneTilt size={16} weight="bold" aria-hidden="true" />
              <span>{sending ? word("sending") : word("send")}</span>
            </button>
          )}
        </div>
      </form>
      {/* The line's place is kept from the first paint: a line that appeared on the first touch moved the microphone from under the finger (production, 390). */}
      {server || browser ? (
        <div id={noteId} className={styles.voiceNote} data-problem={problem ? "" : undefined} data-quiet={voiceLine === null ? "" : undefined}>
          {/* Before the field is reached the switch stands alone — the first press is in the right language — over the unseen line that keeps the place. */}
          {voiceLine === null ? (
            <>
              {languageSwitch}{" "}
              <span className={styles.voiceQuiet} aria-hidden="true">
                {server ? serverWhere : word("voiceWhere")}
              </span>
            </>
          ) : null}
          {/* Read aloud when it changes — but not the clock while recording: a screen reader's voice would be recorded too. */}
          <span aria-live={recording ? "off" : "polite"}>{voiceLine ?? ""}</span>
          {voiceLine !== null && waiting ? (
            <>
              {" "}
              {/* `data-dense`: an inline word in the line, out of the shell's 44 px button floor. */}
              <button type="button" className={styles.voiceDiscard} data-dense="" onClick={record.cancel}>
                {word("voiceDiscard")}
              </button>
            </>
          ) : voiceLine !== null && calm ? (
            <>
              {" "}
              {languageSwitch}
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Suggestions({ items, word, sending, onSend }: { items: readonly string[]; word: (w: RynWord) => string; sending: boolean; onSend: (value: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.suggestions} aria-label={word("suggested")}>
      <span className={styles.suggestedLabel}>{word("suggested")}</span>
      {items.map((item) => (
        <button key={item} type="button" className={styles.chip} onClick={() => onSend(item)} disabled={sending}>
          {item}
        </button>
      ))}
    </div>
  );
}

/**
 * AI-06b: a new conversation on the full page — one question in large type, one line, and the questions to start
 * with as a short list a press asks. The side panel keeps its row of chips.
 */
function EmptyState({ items, word, sending, onSend, guest }: { items: readonly string[]; word: (w: RynWord) => string; sending: boolean; onSend: (value: string) => void; guest: boolean }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyMark} aria-hidden="true">
        <Sparkle size={20} weight="fill" />
      </span>
      <h2 className={styles.emptyTitle}>{word("emptyTitle")}</h2>
      <p className={styles.emptyLine}>{guest ? word("emptyLineGuest") : word("emptyLine")}</p>
      {items.length > 0 ? (
        <ul className={styles.starters} aria-label={word("suggested")}>
          {items.slice(0, 4).map((item) => (
            <li key={item}>
              <button type="button" className={styles.starter} onClick={() => onSend(item)} disabled={sending}>
                <span>{item}</span>
                <ArrowUpRight size={16} weight="bold" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** What the conversation is about, when a page sent it here with a subject: «Про SOL», «Твій план». */
function contextLabel(context: AgentContext | null, word: (w: RynWord) => string): string | null {
  if (context === null) return null;
  switch (context.kind) {
    case "asset":
      return `${word("contextAsset")} ${context.symbol ?? `${context.mint.slice(0, 4)}…${context.mint.slice(-4)}`}`;
    case "plan":
      return word("contextPlan");
    case "portfolio":
      return word("contextPortfolio");
    case "note":
      return word("contextNote");
    default:
      /* AI-19: the conversation «Доручення» write into is named, never by its internal page id. */
      return context.page === "tasks" ? word("contextTasks") : `${word("contextPage")} ${context.page}`;
  }
}

const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase() + text.slice(1);

/** The page's subject as «Що бачить Ryntra» names it: a token by its symbol and its address. */
function seesWhat(context: AgentContext, word: (w: RynWord) => string): string | null {
  switch (context.kind) {
    case "asset":
      return `${context.symbol ? `${context.symbol} · ` : ""}${context.mint.slice(0, 4)}…${context.mint.slice(-4)}`;
    case "plan":
      return lowerFirst(word("contextPlan"));
    case "portfolio":
      return lowerFirst(word("contextPortfolio"));
    case "note":
      /* «Нагляд» is a name: only the first letter of the phrase goes lower-case mid-sentence. */
      return lowerFirst(word("contextNote"));
    default:
      /* A section of the product is not a subject Ryntra reads: no internal page name to a person. */
      return null;
  }
}

/**
 * AI-06: «Що бачить Ryntra» beside the field — the page's subject, the wallet it reads (read only) or none, the
 * market's sources, the person's own answers to «Знайомство» with «Змінити», and what it never sees or does. A fold:
 * its summary is the subject as before; the rest opens on a press.
 */
function Sees({ context, word, wallet, you, onChange, onKnows = null }: { context: AgentContext | null; word: (w: RynWord) => string; wallet: string | null; you: string | null; onChange: (() => void) | null; onKnows?: (() => void) | null }) {
  const label = context?.kind === "page" ? null : contextLabel(context, word);
  const what = context ? seesWhat(context, word) : null;
  return (
    <details className={styles.sees}>
      <summary className={styles.seesSummary}>
        <Eye size={14} weight="bold" aria-hidden="true" />
        <span>{word("seesLabel")}</span>
        {label ? <span className={styles.context}>{label}</span> : null}
      </summary>
      <ul className={styles.seesList}>
        <li>{what ? word("seesPage").replace("{what}", what) : word("seesNoPage")}</li>
        <li>{wallet ? word("seesWallet").replace("{address}", `${wallet.slice(0, 4)}…${wallet.slice(-4)}`) : word("seesGuest")}</li>
        <li>{word("seesMarket")}</li>
        {you ? (
          <li>
            {word("seesYou").replace("{what}", you)}{" "}
            {onChange ? (
              <button type="button" className={styles.seesChange} onClick={onChange}>
                {word("seesChange")}
              </button>
            ) : null}
          </li>
        ) : null}
        {onKnows ? (
          <li>
            {word("seesKnows")}{" "}
            <button type="button" className={styles.seesChange} onClick={onKnows}>
              {word("seesKnowsOpen")}
            </button>
          </li>
        ) : null}
        <li>{word("seesNever")}</li>
      </ul>
    </details>
  );
}

/* ── The guest: a market question without a wallet (AI-02) ─────────── */

function GuestSurface({ locale, context, initialQuestion, word, address, autoAsk, compact, asked, wants }: { locale: WorkspaceLocale; context: AgentContext | null; initialQuestion: string | null; word: (w: RynWord) => string; address: string | null; autoAsk: boolean; compact: boolean; asked: RefObject<boolean>; wants: AssistantTab | null }) {
  const proof = useWalletProof();
  const [turns, setTurns] = useState<readonly AgentTurn[]>([]);
  /*
   * A question that came with the link waits in the composer: a returning
   * person's proof may still be on its way, and the wallet's conversation
   * asks it then — never twice, never on a guest's allowance first.
   */
  const [text, setText] = useState(initialQuestion ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<AgentGuestResponse["guest"] | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  /* A guest asks from an asset or a page only; a plan, a portfolio or a note is someone's own. */
  const guestContext = context && (context.kind === "asset" || context.kind === "page") ? context : null;

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (sending || trimmed.length === 0) return;
      setSending(true);
      setError(null);
      try {
        const response = await fetch("/api/v1/assistant/guest", { method: "POST", headers: HEADERS, credentials: "omit", body: JSON.stringify({ text: trimmed.slice(0, 2000), locale, context: guestContext }) });
        if (!response.ok) {
          const failure = await readError(response);
          setError(failure.code === "RATE_LIMITED" ? word("guestRate") : word("failed"));
          return;
        }
        const body = (await response.json()) as AgentGuestResponse;
        setTurns((current) => [...current, body.person, body.ryn]);
        setDay(body.guest);
        setText("");
      } catch {
        setError(word("failed"));
      } finally {
        setSending(false);
      }
    },
    [sending, locale, guestContext, word],
  );

  /* AI-06a: a press that asked a question — «Пояснити рух» — asks it once, also across a wallet proven meanwhile (`asked` is the surface's); a guest's question costs nobody's credits. */
  useEffect(() => {
    if (autoAsk && initialQuestion && !asked.current) {
      asked.current = true;
      void send(initialQuestion);
    }
  }, [autoAsk, initialQuestion, send, asked]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, sending]);

  /*
   * A wallet connected but not confirmed (its sign-in ended): the page keeps its tabs — the conversation works as a
   * guest's, and each of the person's own tabs says what it holds and asks for the one signature that opens it.
   */
  const [tab, setTab] = useState<AssistantTab>(wants ?? "chat");
  const kept = address !== null;
  const lockedTabs: readonly (readonly [AssistantTab, RynWord, typeof Sparkle])[] = [
    ["chat", "tabChat", Sparkle],
    ["watch", "tabWatch", Bell],
    ["tasks", "tabTasks", ClockCountdown],
    ["plans", "tabPlans", NotePencil],
    ["brief", "tabBrief", SunHorizon],
    ["credits", "tabCredits", Coins],
  ];
  const lockedLine: Record<AssistantTab, RynWord> = { chat: "lockedWatch", watch: "lockedWatch", tasks: "lockedTasks", plans: "lockedPlans", brief: "lockedBrief", credits: "lockedCredits" };
  const tabBar = kept ? (
    <div className={styles.tabBar}>
      <div className={styles.tabs} role="tablist" aria-label={word("panelLabel")}>
        {lockedTabs.map(([id, label, Glyph]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={styles.tab} onClick={() => setTab(id)}>
            <Glyph size={16} weight={tab === id ? "fill" : "regular"} aria-hidden="true" />
            <span>{word(label)}</span>
          </button>
        ))}
      </div>
    </div>
  ) : null;
  const lockedPanel = kept && tab !== "chat" ? (
    <div className={styles.tabPanel} role="tabpanel">
      <div className={styles.lockedCard}>
        <p className={styles.lockedTitle}>{word("lockedTitle")}</p>
        <p className={styles.lockedLine}>{word(lockedLine[tab])}</p>
        <button type="button" className="rw-btn" data-variant="primary" onClick={() => void proof.prove()} disabled={proof.state.status === "signing"}>
          {proof.state.status === "signing" ? word("confirming") : word("confirmWallet")}
        </button>
        {proof.state.status === "signing" ? <p className={styles.lockedLine}>{word("confirmInWallet")}</p> : null}
        {proof.state.status === "refused" || proof.state.status === "failed" ? <p className={styles.error} role="alert">{proof.state.reason}</p> : null}
      </div>
    </div>
  ) : null;

  const suggestions = [word("guestAsk1"), word("guestAsk2"), word("guestAsk3"), word("guestAsk4")];
  const footLine = day === null ? word("guestNote") : day.model === "absent" ? word("budgetAbsent") : day.day.used >= day.day.allowance ? word("guestSpent") : `${day.day.used} / ${day.day.allowance} ${word("guestBudgetLine")}`;
  if (!compact) {
    /* AI-06b: the full page — the wallet is offered by the balance at the top, the conversation is the page. */
    return (
      <div className={styles.surface} data-page="">
        {tabBar}
        <div className={styles.chat} hidden={tab !== "chat"}>
          {turns.length > 0 ? (
            <div className={styles.chatBar}>
              <button type="button" className={styles.barButton} onClick={() => setTurns([])} disabled={sending}>
                <Plus size={14} weight="bold" aria-hidden="true" />
                <span>{word("newConversation")}</span>
              </button>
            </div>
          ) : null}
          {proof.state.status === "refused" || proof.state.status === "failed" ? <p className={styles.error}>{proof.state.reason}</p> : null}
          {turns.length === 0 && !sending ? <EmptyState items={suggestions} word={word} sending={sending} onSend={(value) => void send(value)} guest /> : <Conversation turns={turns} locale={locale} word={word} sending={sending} endRef={endRef} onAsk={(value) => void send(value)} />}
          <div className={styles.dock}>
            <Sees context={guestContext} word={word} wallet={null} you={null} onChange={null} />
            <Composer text={text} setText={setText} sending={sending} onSend={(value) => void send(value)} word={word} locale={locale} placeholder={word("guestPlaceholder")} page />
            {error ? <p className={styles.error}>{error}</p> : null}
            <p className={styles.budget}>{footLine}</p>
          </div>
        </div>
        {lockedPanel}
      </div>
    );
  }
  /* AI-06: a guest who pressed «Стежити» or «План» reads, where they pressed, what the wallet is for. */
  const symbol = context?.kind === "asset" ? (context.symbol ?? `${context.mint.slice(0, 4)}…`) : null;
  const lead = wants === "watch" && symbol ? word("guestWatchLead").replace("{symbol}", symbol) : wants === "plans" ? word("guestPlanLead") : word("guestLead");
  return (
    <div className={styles.surface} data-compact="">
      <div className={styles.guestStrip} data-wants={wants === "watch" || wants === "plans" ? "" : undefined}>
        <p className={styles.guestLead}>{lead}</p>
        {address ? (
          <button type="button" className="rw-btn" onClick={() => void proof.prove()} disabled={proof.state.status === "signing"}>
            {proof.state.status === "signing" ? word("confirming") : word("confirmWallet")}
          </button>
        ) : (
          /* B14 (UX-705): the header's own wallet panel — the choice, «Встановити Phantom», «Відкрити в Phantom» on a phone.
             Orange only where the wallet is what the press came for; otherwise «Спитати» is the panel's one orange action. */
          <ConnectWalletButton variant={wants === "watch" || wants === "plans" ? "primary" : "secondary"} />
        )}
      </div>
      {proof.state.status === "refused" || proof.state.status === "failed" ? <p className={styles.error}>{proof.state.reason}</p> : null}
      {turns.length > 0 ? (
        <div className={styles.toolbar}>
          <button type="button" className="rw-btn" onClick={() => setTurns([])} disabled={sending}>
            <Plus size={14} weight="bold" aria-hidden="true" />
            <span>{word("newConversation")}</span>
          </button>
        </div>
      ) : null}
      <Conversation turns={turns} locale={locale} word={word} sending={sending} endRef={endRef} onAsk={(value) => void send(value)} />
      {turns.length < 2 ? <Suggestions items={suggestions} word={word} sending={sending} onSend={(value) => void send(value)} /> : null}
      <Sees context={guestContext} word={word} wallet={null} you={null} onChange={null} />
      <Composer text={text} setText={setText} sending={sending} onSend={(value) => void send(value)} word={word} locale={locale} placeholder={word("panelPlaceholder")} focus={!(autoAsk && initialQuestion) && wants !== "watch" && wants !== "plans"} />
      {error ? <p className={styles.error}>{error}</p> : null}
      <p className={styles.budget}>{footLine}</p>
    </div>
  );
}

/* ── The wallet's conversations: «Нова розмова» and the list with dates ── */

function History({ word, locale, current, onOpen, refreshKey, page = false }: { word: (w: RynWord) => string; locale: WorkspaceLocale; current: string; onOpen: (sessionId: string) => void; refreshKey: number; page?: boolean }) {
  const [rows, setRows] = useState<readonly AgentSessionSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void fetch("/api/v1/agent/sessions", { headers: HEADERS, credentials: "same-origin" })
      .then((response) => (response.ok ? (response.json() as Promise<AgentSessionListResponse>) : null))
      .then((body) => {
        if (live) setRows(body?.sessions ?? []);
      })
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, [open, refreshKey]);
  return (
    <details className={styles.history} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className={page ? styles.barButton : "rw-btn"}>
        <ClockCounterClockwise size={14} weight="bold" aria-hidden="true" />
        <span>{word("conversations")}</span>
      </summary>
      <div className={styles.historyBody}>
        {rows === null ? (
          <p className={styles.muted} aria-busy="true">
            {word("loadingList")}
          </p>
        ) : rows.length === 0 ? (
          <p className={styles.muted}>{word("noConversations")}</p>
        ) : (
          <ul className={styles.historyList}>
            {rows.map((row) => (
              <li key={row.id}>
                <button type="button" className={styles.historyRow} data-current={row.id === current} onClick={() => onOpen(row.id)} disabled={row.id === current}>
                  <span className={styles.historyTitle}>{row.title ?? word("untitled")}</span>
                  <span className={styles.historyMeta}>{new Date(row.updatedAt).toLocaleString(localeTag(locale), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.muted}>{word("retention")}</p>
      </div>
    </details>
  );
}

/**
 * AI-06: «Знайомство» — the wallet's five answers, read once the wallet is proven and its conversation open. `shown`: the card stands in the
 * conversation while nothing was answered or skipped, while «Змінити» edits it, and after «Готово» until the person
 * moves on.
 */
function useProfile(proven: boolean, busy: boolean) {
  const [read, setRead] = useState<AssistantProfileResponse | null>(null);
  const [shown, setShown] = useState<"auto" | "edit" | "done" | "closed">("auto");
  useEffect(() => {
    if (!proven) return undefined;
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () => fetch("/api/v1/assistant/profile", { headers: HEADERS, credentials: "same-origin" }).then((response) => (response.ok ? (response.json() as Promise<AssistantProfileResponse>) : Promise.reject(new Error(String(response.status)))));
    /* A read that did not answer is tried once more; one that fails twice asks nothing — never the questions twice. */
    void load()
      .catch(() => new Promise<AssistantProfileResponse>((settle, refuse) => (retry = setTimeout(() => void load().then(settle, refuse), 1_500))))
      .then((body) => {
        if (live) setRead(body);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (retry) clearTimeout(retry);
    };
  }, [proven]);
  const visible = read !== null && (shown === "edit" || shown === "done" || (shown === "auto" && read.profile === null && !busy));
  return { read, setRead, shown, setShown, visible } as const;
}

/** The tabs a request may open on: the panel's «Стежити» and «План» name theirs; a note's link opens «Стежу» or «Огляди». */
const TABS: readonly AssistantTab[] = ["chat", "watch", "tasks", "plans", "brief", "credits"];

export function RynSurface({
  locale,
  context,
  initialQuestion,
  briefDay = null,
  watchId = null,
  taskId = null,
  initialTab = null,
  compact = false,
  autoAsk = true,
}: {
  locale: WorkspaceLocale;
  context: AgentContext | null;
  initialQuestion: string | null;
  briefDay?: string | null;
  /** AI-05: a watch's note lands with «Стежу» open and that watch in view (`?watch=<id>`; `all` — the tab alone). */
  watchId?: string | null;
  /** AI-19: a task's note lands on the task's own conversation (`?task=<id>`). */
  taskId?: string | null;
  /** AI-06: the tab a press opened the panel on — «Стежу» from «Стежити», «Плани» from «План». */
  initialTab?: AssistantTab | null;
  /** AI-06a: the side panel — the same tabs in a column, the conversation's chips in place of the page's start. */
  compact?: boolean;
  /** Whether `initialQuestion` is asked as the conversation opens (a press that asked it) or only waits in the field. */
  autoAsk?: boolean;
}) {
  /* Stable per locale and per context: the effects below key on them, and a fresh closure every render would reopen the session on every render. */
  const word = useMemo(() => rynWordsFor(locale), [locale]);
  const contextKey = JSON.stringify(context);
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const proven = proof.state.status === "proven" && proof.state.address === address;
  const [phase, setPhase] = useState<Phase>({ status: "opening" });
  const [turns, setTurns] = useState<readonly AgentTurn[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const asked = useRef(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  /*
   * AI-06b: «Нова розмова» and a conversation from the list switch inside the open page — the tabs, the brief and the
   * credits stay; only the first opening (or a retry) shows «Відкриваємо…» in place of the page.
   */
  const [switching, setSwitching] = useState(false);
  const readyRef = useRef(false);
  useEffect(() => {
    readyRef.current = phase.status === "ready";
  }, [phase.status]);
  const open = useCallback(
    async (options: Readonly<{ sessionId?: string; fresh?: boolean }> = {}) => {
      const inPlace = readyRef.current && (options.fresh === true || options.sessionId !== undefined);
      if (inPlace) {
        setSwitching(true);
        setError(null);
      } else setPhase({ status: "opening" });
      const failed = () => (inPlace ? setError(word("openFailed")) : setPhase({ status: "failed", reason: word("openFailed") }));
      try {
        const response = await fetch("/api/v1/agent/session", { method: "POST", headers: HEADERS, credentials: "same-origin", body: JSON.stringify({ context: JSON.parse(contextKey) as AgentContext | null, locale, ...options }) });
        if (!response.ok) {
          /* AI-06a: a person reads the product's words, never «HTTP 500» or a server's English sentence. */
          await readError(response);
          failed();
          return;
        }
        const body = (await response.json()) as AgentSessionResponse;
        setPhase({ status: "ready", session: body.session, budget: body.budget, suggestions: body.suggestions });
        setTurns(body.session.turns);
        setHistoryKey((key) => key + 1);
      } catch {
        failed();
      } finally {
        if (inPlace) setSwitching(false);
      }
    },
    [contextKey, locale, word],
  );

  useEffect(() => {
    if (proven) void open();
  }, [proven, open]);

  /* AI-18: what Ryntra knows about the person — read once the conversation is open; after each message, whether it left a note. */
  const memory = useMemory(proven && phase.status === "ready");
  const [knows, setKnows] = useState(false);
  const [remembered, setRemembered] = useState<NonNullable<typeof memory.read>["notes"]>([]);
  const [askAbout, setAskAbout] = useState(false);
  const known = memory.read?.notes;
  const refreshMemory = memory.refresh;
  /* `typed` — the person's own words from the field: only those may be kept in the memory (never a starter's or a link's). */
  const send = useCallback(
    async (question: string, typed = false) => {
      /* Not while another conversation opens: the question would go to the one being left. */
      if (phase.status !== "ready" || sending || switching) return;
      const trimmed = question.trim();
      if (trimmed.length === 0) return;
      setSending(true);
      setError(null);
      try {
        const response = await fetch("/api/v1/agent/message", { method: "POST", headers: HEADERS, credentials: "same-origin", body: JSON.stringify({ sessionId: phase.session.id, text: trimmed.slice(0, 2000), locale, acceptCredits: shownPrice(phase.budget), typed }) });
        if (!response.ok) {
          const failure = await readError(response);
          setError(failure.code === "AGENT_BUSY" ? word("busy") : failure.code === "AGENT_BUDGET_EXHAUSTED" ? word("budgetExhausted") : word("failed"));
          return;
        }
        const body = (await response.json()) as AgentMessageResponse;
        setTurns((current) => [...current, body.person, body.ryn]);
        setPhase((current) => (current.status === "ready" ? { ...current, budget: body.budget } : current));
        setText("");
        setHistoryKey((key) => key + 1);
        /* AI-18: a note this message left is said under the conversation, with «Забути» — nothing is kept unseen. */
        const before = new Set((known ?? []).map((note) => note.id));
        void refreshMemory("notes").then((next) => {
          if (next) setRemembered(next.notes.filter((note) => !before.has(note.id)));
        });
      } catch {
        setError(word("failed"));
      } finally {
        setSending(false);
      }
    },
    [phase, sending, switching, locale, word, known, refreshMemory],
  );

  /* AI-04: the credits panel read fresher figures — the line under the composer shows them too. */
  const onCredits = useCallback((credits: NonNullable<AgentBudgetState["credits"]>) => {
    setPhase((current) => (current.status === "ready" ? { ...current, budget: { ...current.budget, credits } } : current));
  }, []);

  /* AI-06: the answers are read once the conversation is open — after it, not beside it: one read at a time. */
  /* A press that asked a question or opened a tab is answered first: the five questions wait for another opening. */
  const profile = useProfile(proven && phase.status === "ready", initialQuestion !== null || (initialTab !== null && initialTab !== "chat"));
  /* AI-18: Ryntra asks once — after «Знайомство», on a conversation not yet begun — the person to say who they are in their own words. */
  useEffect(() => {
    if (address && memory.read && memory.read.about === null && profile.read?.profile && !profile.visible && turns.length === 0 && initialQuestion === null && taskId === null && !aboutAsked(address)) setAskAbout(true);
  }, [address, memory.read, profile.read, profile.visible, turns.length, initialQuestion, taskId]);

  /* AI-06b: the figures the session read are the ones the balance at the top and the header's badge show. */
  const shownCredits = phase.status === "ready" ? (phase.budget.credits ?? null) : undefined;
  useEffect(() => {
    if (proven && address && shownCredits !== undefined) publishCredits(address, shownCredits);
  }, [proven, address, shownCredits]);
  /* AI-08: a recording heard spends credits too — the line under the field and the next question's price read the figures after it. */
  const voiceSpent = useCallback((credits: AssistantCredits) => {
    setPhase((current) => (current.status === "ready" && current.budget.credits ? { ...current, budget: { ...current.budget, credits } } : current));
  }, []);

  /* AI-06b: one tab at a time — the conversation first; a brief's note, a watch's note or a press opens its own. */
  const [tab, setTab] = useState<AssistantTab>(initialTab && TABS.includes(initialTab) ? initialTab : watchId ? "watch" : briefDay ? "brief" : "chat");
  const [briefStatus, setBriefStatus] = useState<string | null>(null);
  const [watchStatus, setWatchStatus] = useState<string | null>(null);
  /* AI-06: the panel reads a tab when it is first shown — an opening for one question reads no brief, watches or plans. */
  const [seen, setSeen] = useState<ReadonlySet<AssistantTab>>(() => new Set([tab]));
  useEffect(() => setSeen((before) => (before.has(tab) ? before : new Set([...before, tab]))), [tab]);
  const drawn = (id: AssistantTab) => !compact || seen.has(id);

  /*
   * AI-19: a task's note opens the task's conversation — every run's answer — once the page is open. AI-20: a task
   * paused for credits or a price (its note: «Продовжити» shows the new price) opens «Доручення», where «Продовжити» is;
   * one the person paused themselves keeps opening its answers.
   */
  const taskOpened = useRef(false);
  useEffect(() => {
    if (!taskId || taskOpened.current || phase.status !== "ready") return;
    taskOpened.current = true;
    void fetch("/api/v1/assistant/tasks", { headers: HEADERS, credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<AssistantTasksResponse>) : null))
      .then((body) => {
        const task = body?.tasks.find((row) => row.id === taskId) ?? null;
        if (task?.status === "paused" && task.pausedBy !== "person") {
          setTab("tasks");
          return;
        }
        if (task?.sessionId && task.sessionId !== phase.session.id) void open({ sessionId: task.sessionId });
      })
      .catch(() => undefined);
  }, [taskId, phase, open]);
  /* AI-05: «Чому?» on a watch puts its question in the conversation — asked on a press, at the price under the field; AI-06: so does «Попросити Ryntra скласти» on «Плани». */
  const intoChat = useCallback((question: string) => {
    setTab("chat");
    setText(question);
  }, []);
  useEffect(() => {
    if (compact) return undefined;
    const onTopUp = () => {
      setTab("credits");
      /* The packages come with the tab's first read: once they are drawn, bring them into view and the focus to the first. */
      let tries = 0;
      const reach = () => {
        const first = document.querySelector<HTMLElement>("#credits-buy [role=group] button:not([disabled])");
        if (first) {
          document.getElementById("credits-buy")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          first.focus({ preventScroll: true });
        } else if ((tries += 1) < 100) window.setTimeout(reach, 100);
      };
      window.setTimeout(reach, 0);
    };
    window.addEventListener(CREDITS_TOP_UP_EVENT, onTopUp);
    return () => window.removeEventListener(CREDITS_TOP_UP_EVENT, onTopUp);
  }, [compact]);

  /* The wallet's own conversation took the press's question once — asked, or put in the field. */
  const placed = useRef(false);
  useEffect(() => {
    if (phase.status === "ready" && initialQuestion && !placed.current) {
      placed.current = true;
      /*
       * AI-06a: asked by itself only while the day's free credits pay for it; a question the balance would pay waits
       * in the field under the line that says so — nothing of the balance without a press after the price was shown.
       * A question the guest's surface already asked (a wallet proven meanwhile) waits in the field: one press asks it
       * again, at the price shown — the guest's answer is not kept.
       */
      if (!asked.current && asksByItself(autoAsk, shownPrice(phase.budget))) {
        asked.current = true;
        void send(initialQuestion);
      } else setText(initialQuestion);
    }
  }, [phase, initialQuestion, send, autoAsk]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, sending]);

  /* AI-06: a panel opened on «Стежу» or «Плани» brings the focus to that tab once it is drawn, not to the panel's close. */
  const focusedTab = useRef(false);
  useEffect(() => {
    if (!compact || focusedTab.current || phase.status !== "ready" || !initialTab || initialTab === "chat") return;
    focusedTab.current = true;
    requestAnimationFrame(() => document.getElementById(`ryn-tab-${initialTab}-panel`)?.focus({ preventScroll: true }));
  }, [compact, phase.status, initialTab]);

  /* Without a proven wallet Ryntra still answers — about the market, as a guest. */
  /* A connected wallet whose proof is still being read is not a guest yet: a neutral line, not the guest's page for a moment. */
  if (!proven && address && (proof.state.status === "checking" || proof.state.status === "idle")) {
    return (
      <section className={styles.gate}>
        <p className={styles.muted} aria-busy="true">
          {word("opening")}
        </p>
      </section>
    );
  }
  if (!proven) return <GuestSurface locale={locale} context={context} initialQuestion={initialQuestion} word={word} address={address} autoAsk={autoAsk && compact} compact={compact} asked={asked} wants={initialTab} />;
  if (phase.status === "opening") {
    return (
      <section className={styles.gate}>
        <p className={styles.muted} aria-busy="true">
          {word("opening")}
        </p>
      </section>
    );
  }
  if (phase.status === "failed") {
    return (
      <section className={styles.gate}>
        <p className={styles.error}>{phase.reason}</p>
        <button type="button" className="rw-btn" onClick={() => void open()}>
          {word("retry")}
        </button>
      </section>
    );
  }

  const budget = phase.budget;
  const lang = locale === "uk" ? "uk" : "en";
  const asset = context?.kind === "asset" ? context : null;
  const you = profileSummary(profile.read?.profile ?? null, word, lang) ?? (profile.read?.profile?.skipped ? word("seesSkipped") : null);
  /* The credits' tab only where credits are served: switched off on a deployment, there is nothing to show in it. */
  const tabs: readonly (readonly [AssistantTab, RynWord, typeof Sparkle, string | null])[] = [
    ["chat", "tabChat", Sparkle, null],
    ["watch", "tabWatch", Bell, watchStatus],
    ["tasks", "tabTasks", ClockCountdown, null],
    ["plans", "tabPlans", NotePencil, null],
    ["brief", "tabBrief", SunHorizon, briefStatus],
    ...(budget.credits ? ([["credits", "tabCredits", Coins, null]] as const) : []),
  ];
  const shown = tabs.some(([id]) => id === tab) ? tab : "chat";
  const meet = profile.visible && profile.read ? (
    <Meet
      key={profile.shown === "edit" ? "edit" : "first"}
      word={word}
      locale={lang}
      read={profile.read}
      compact={compact}
      onSaved={(next) => {
        profile.setRead(next);
        const closing = next.profile?.skipped || profile.shown === "edit";
        profile.setShown(closing ? "closed" : "done");
        /* The card leaves under the press: the focus goes to the field, not to the page's body. */
        if (closing) requestAnimationFrame(() => document.querySelector<HTMLElement>(`#ryn-panel-chat${compact ? "-panel" : ""} textarea`)?.focus({ preventScroll: true }));
      }}
      onFirstWatch={() => {
        profile.setShown("closed");
        setTab("watch");
      }}
      onClose={() => profile.setShown("closed")}
      onCancel={profile.shown === "edit" ? () => profile.setShown("closed") : undefined}
    />
  ) : null;
  const sees = <Sees context={context} word={word} wallet={address} you={you} onChange={profile.read ? () => profile.setShown("edit") : null} onKnows={memory.read ? () => setKnows(true) : null} />;
  /* AI-18: «Що Ryntra знає про тебе» in the conversation's place; «Розкажи про себе» once, after «Знайомство» is answered. */
  const knowsCard = knows && memory.read ? <MemoryCard word={word} locale={lang} memory={memory} you={you} onChangeProfile={profile.read ? () => { setKnows(false); profile.setShown("edit"); } : null} onClose={() => setKnows(false)} /> : null;
  const aboutCard = !knows && !meet && askAbout && address && memory.read && memory.read.about === null ? <AboutPrompt word={word} memory={memory} owner={address} onDone={() => setAskAbout(false)} /> : null;
  const chatTools = (
    <div className={compact ? styles.toolbar : styles.chatTools}>
      <button type="button" className={compact ? "rw-btn" : styles.barButton} onClick={() => void open({ fresh: true })} disabled={sending || switching || turns.length === 0}>
        <Plus size={14} weight="bold" aria-hidden="true" />
        <span>{word("newConversation")}</span>
      </button>
      <History word={word} locale={locale} current={phase.session.id} onOpen={(sessionId) => void open({ sessionId })} refreshKey={historyKey} page={!compact} />
    </div>
  );
  return (
    <div className={styles.surface} data-page={compact ? undefined : ""} data-compact={compact ? "" : undefined}>
      <div className={styles.tabBar}>
        <div className={styles.tabs} role="tablist" aria-label={word("panelLabel")}>
          {tabs.map(([id, label, Glyph, note]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`ryn-tab-${id}${compact ? "-panel" : ""}`}
              aria-controls={`ryn-panel-${id}${compact ? "-panel" : ""}`}
              aria-selected={shown === id}
              tabIndex={shown === id ? 0 : -1}
              className={styles.tab}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const at = tabs.findIndex(([key]) => key === id);
                const next = tabs[event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (at + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length][0];
                setTab(next);
                document.getElementById(`ryn-tab-${next}${compact ? "-panel" : ""}`)?.focus();
              }}
            >
              <Glyph size={16} weight={shown === id ? "fill" : "regular"} aria-hidden="true" />
              <span>{word(label)}</span>
              {/* The panel's tab has room for a count on its glyph, not for a word. */}
              {note && (!compact || /^\d+$/.test(note)) ? <span className={styles.tabNote}>{note}</span> : null}
            </button>
          ))}
        </div>
        {shown === "chat" && !compact ? chatTools : null}
      </div>
      <div className={styles.chat} role="tabpanel" id={`ryn-panel-chat${compact ? "-panel" : ""}`} aria-labelledby={`ryn-tab-chat${compact ? "-panel" : ""}`} hidden={shown !== "chat"} aria-busy={switching}>
        {compact ? chatTools : null}
        {meet}
        {knowsCard}
        {aboutCard}
        {switching ? (
          <p className={styles.muted} aria-busy="true">
            {word("opening")}
          </p>
        ) : compact ? (
          <>
            <Conversation turns={turns} locale={locale} word={word} sending={sending} endRef={endRef} onAsk={(value) => void send(value)} />
            {turns.length < 2 && !meet ? <Suggestions items={phase.suggestions.map((suggestion) => suggestion.text)} word={word} sending={sending} onSend={(value) => void send(value)} /> : null}
          </>
        ) : turns.length === 0 && !sending ? (
          meet ? null : <EmptyState items={phase.suggestions.map((suggestion) => suggestion.text)} word={word} sending={sending} onSend={(value) => void send(value)} guest={false} />
        ) : (
          <Conversation turns={turns} locale={locale} word={word} sending={sending} endRef={endRef} onAsk={(value) => void send(value)} />
        )}
        <div className={styles.dock}>
          <RememberedLine word={word} notes={remembered} memory={memory} onDismiss={() => setRemembered([])} />
          {sees}
          <Composer text={text} setText={setText} sending={sending || switching} onSend={(value) => void send(value, true)} word={word} locale={locale} owner={proven ? address : null} onCredits={voiceSpent} placeholder={compact ? word("panelPlaceholder") : word("pagePlaceholder")} page={!compact} focus={compact && shown === "chat" && !meet && !(autoAsk && initialQuestion)} />
          {error ? <p className={styles.error}>{error}</p> : null}
          {/* AI-04: the next question's price, before it is asked. */}
          <p className={styles.budget}>{priceLine(budget, word, locale)}</p>
        </div>
      </div>
      {/* AI-05: «Стежу» — the wallet's token watches; a watch's note opens this tab; AI-06: «Стежити» on a token opens it with that token chosen. */}
      <div className={styles.tabPanel} role="tabpanel" id={`ryn-panel-watch${compact ? "-panel" : ""}`} aria-labelledby={`ryn-tab-watch${compact ? "-panel" : ""}`} hidden={shown !== "watch"} tabIndex={0}>
        {drawn("watch") ? <WatchPanel locale={locale} word={word} focusId={watchId} onExplain={intoChat} onStatus={setWatchStatus} initialToken={asset ? { mint: asset.mint, symbol: asset.symbol ?? `${asset.mint.slice(0, 4)}…${asset.mint.slice(-4)}` } : null} /> : null}
      </div>
      {/* AI-19: «Доручення» — questions Ryntra asks itself on a schedule, and push on this computer; AI-20: a tab of its own. */}
      <div className={styles.tabPanel} role="tabpanel" id={`ryn-panel-tasks${compact ? "-panel" : ""}`} aria-labelledby={`ryn-tab-tasks${compact ? "-panel" : ""}`} hidden={shown !== "tasks"} tabIndex={0}>
        {drawn("tasks") ? <TasksPanel locale={locale} word={word} active={shown === "tasks"} /> : null}
      </div>
      {/* AI-06: «Плани» — compose one with Ryntra or open the builder; AI-20: the plans themselves live in «Боти». */}
      <div className={styles.tabPanel} role="tabpanel" id={`ryn-panel-plans${compact ? "-panel" : ""}`} aria-labelledby={`ryn-tab-plans${compact ? "-panel" : ""}`} hidden={shown !== "plans"} tabIndex={0}>
        <PlansTab locale={locale} word={word} mint={asset?.mint ?? null} symbol={asset?.symbol ?? null} onAsk={intoChat} active={shown === "plans"} />
      </div>
      {/* AI-10: «Огляди» — the proven wallet's morning brief; a note's link opens this tab. Kept drawn, so it reads once. */}
      <div className={styles.tabPanel} role="tabpanel" id={`ryn-panel-brief${compact ? "-panel" : ""}`} aria-labelledby={`ryn-tab-brief${compact ? "-panel" : ""}`} hidden={shown !== "brief"} tabIndex={0}>
        {drawn("brief") ? <BriefPanel locale={locale} word={word} day={briefDay} onStatus={setBriefStatus} /> : null}
      </div>
      {budget.credits ? (
        <div className={styles.tabPanel} role="tabpanel" id={`ryn-panel-credits${compact ? "-panel" : ""}`} aria-labelledby={`ryn-tab-credits${compact ? "-panel" : ""}`} hidden={shown !== "credits"} tabIndex={0}>
          {drawn("credits") ? <CreditsPanel locale={locale} word={word} budget={budget} onChange={onCredits} active={shown === "credits"} /> : null}
        </div>
      ) : null}
    </div>
  );
}
