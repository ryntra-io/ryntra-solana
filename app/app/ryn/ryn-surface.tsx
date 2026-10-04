"use client";

import { ArrowRight, PaperPlaneTilt } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { WalletGate } from "@/app/solana/workspace/wallet-gate";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { AgentBudgetState, AgentCard, AgentCitation, AgentContext, AgentFigure, AgentHandoff, AgentMessageResponse, AgentSessionResponse, AgentSuggestion, AgentTurn } from "@/lib/api/v1/contract";

import { criticKindLabel, lensWordsFor } from "@/app/app/lens/lens-words";

import styles from "./ryn.module.css";
import { rynWordsFor, type RynWord } from "./ryn-words";

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
            <span className={styles.value}>{figure.value}</span>
            {figure.state !== "current" ? <span className={styles.stateTag}>{stateWord(figure.state, word)}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
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

function RynTurn({ turn, locale, word }: { turn: AgentTurn; locale: WorkspaceLocale; word: (w: RynWord) => string }) {
  const answer = turn.answer;
  const deeper = answer ? [...answer.counter, ...answer.risks, ...answer.checks].length > 0 : false;
  return (
    <article className={styles.turn} data-role="ryn" data-class={turn.class ?? ""}>
      <header className={styles.turnHead}>
        <span className={styles.who}>{word("who")}</span>
        <span className={styles.headline}>{turn.text}</span>
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

export function RynSurface({ locale, context, initialQuestion }: { locale: WorkspaceLocale; context: AgentContext | null; initialQuestion: string | null }) {
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
  const asked = useRef(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const open = useCallback(async () => {
    setPhase({ status: "opening" });
    try {
      const response = await fetch("/api/v1/agent/session", { method: "POST", headers: HEADERS, credentials: "same-origin", body: JSON.stringify({ context: JSON.parse(contextKey) as AgentContext | null, locale }) });
      if (!response.ok) {
        const failure = await readError(response);
        setPhase({ status: "failed", reason: failure.message });
        return;
      }
      const body = (await response.json()) as AgentSessionResponse;
      setPhase({ status: "ready", session: body.session, budget: body.budget, suggestions: body.suggestions });
      setTurns(body.session.turns);
    } catch {
      setPhase({ status: "failed", reason: word("openFailed") });
    }
  }, [contextKey, locale, word]);

  useEffect(() => {
    if (proven) void open();
  }, [proven, open]);

  const send = useCallback(
    async (question: string) => {
      if (phase.status !== "ready" || sending) return;
      const trimmed = question.trim();
      if (trimmed.length === 0) return;
      setSending(true);
      setError(null);
      try {
        const response = await fetch("/api/v1/agent/message", { method: "POST", headers: HEADERS, credentials: "same-origin", body: JSON.stringify({ sessionId: phase.session.id, text: trimmed.slice(0, 2000), locale }) });
        if (!response.ok) {
          const failure = await readError(response);
          setError(failure.code === "AGENT_BUSY" ? word("busy") : failure.code === "AGENT_BUDGET_EXHAUSTED" ? word("budgetExhausted") : word("failed"));
          return;
        }
        const body = (await response.json()) as AgentMessageResponse;
        setTurns((current) => [...current, body.person, body.ryn]);
        setPhase((current) => (current.status === "ready" ? { ...current, budget: body.budget } : current));
        setText("");
      } catch {
        setError(word("failed"));
      } finally {
        setSending(false);
      }
    },
    [phase, sending, locale, word],
  );

  useEffect(() => {
    if (phase.status === "ready" && initialQuestion && !asked.current) {
      asked.current = true;
      void send(initialQuestion);
    }
  }, [phase.status, initialQuestion, send]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, sending]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(text);
  };

  if (!address) {
    return (
      <section className={styles.gate}>
        <WalletGate title={word("connectToAsk")} />
      </section>
    );
  }
  if (!proven) {
    return (
      <section className={styles.gate}>
        <p className={styles.lead}>{word("confirmToAsk")}</p>
        <button type="button" className="rw-btn rw-btn--primary" onClick={() => void proof.prove()} disabled={proof.state.status === "signing"}>
          {proof.state.status === "signing" ? word("confirming") : word("confirmWallet")}
        </button>
        {proof.state.status === "refused" || proof.state.status === "failed" ? <p className={styles.error}>{proof.state.reason}</p> : null}
      </section>
    );
  }
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
  return (
    <div className={styles.surface}>
      <div className={styles.conversation} aria-live="polite">
        {turns.map((turn) =>
          turn.role === "person" ? (
            <article key={turn.id} className={styles.turn} data-role="person">
              <header className={styles.turnHead}>
                <span className={styles.who}>{word("you")}</span>
              </header>
              <p className={styles.personText}>{turn.text}</p>
            </article>
          ) : (
            <RynTurn key={turn.id} turn={turn} locale={locale} word={word} />
          ),
        )}
        {sending ? (
          <p className={styles.muted} aria-busy="true">
            {word("sending")}
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      {phase.suggestions.length > 0 && turns.length < 2 ? (
        <div className={styles.suggestions} aria-label={word("suggested")}>
          <span className={styles.suggestedLabel}>{word("suggested")}</span>
          {phase.suggestions.map((suggestion) => (
            <button key={suggestion.text} type="button" className={styles.chip} onClick={() => void send(suggestion.text)} disabled={sending}>
              {suggestion.text}
            </button>
          ))}
        </div>
      ) : null}

      <form className={styles.composer} onSubmit={submit}>
        <label className={styles.srOnly} htmlFor="ryn-question">
          {word("send")}
        </label>
        <textarea
          id="ryn-question"
          className={styles.input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={word("placeholder")}
          rows={2}
          maxLength={2000}
          disabled={sending}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(text);
            }
          }}
        />
        <button type="submit" className="rw-btn rw-btn--primary" disabled={sending || text.trim().length === 0}>
          <PaperPlaneTilt size={16} weight="bold" aria-hidden="true" />
          <span>{sending ? word("sending") : word("send")}</span>
        </button>
      </form>
      {error ? <p className={styles.error}>{error}</p> : null}
      <p className={styles.budget}>
        {budget.model === "absent" ? word("budgetAbsent") : budget.exhausted ? word("budgetExhausted") : `${budget.day.used} / ${budget.day.allowance} ${word("budgetLine")}`}
      </p>
    </div>
  );
}
