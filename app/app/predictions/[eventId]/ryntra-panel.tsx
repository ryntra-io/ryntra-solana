"use client";

import { ArrowSquareOut, CaretDoubleRight, CaretDoubleLeft, PaperPlaneRight } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PredictionPlanDraft } from "@/lib/predictions/assistant/draft";
import type { AskResponse } from "@/lib/predictions/assistant/service";
import { ASK_BUTTONS, topicLabel, topicQuestion, type AskTopic } from "@/lib/predictions/assistant/topics";
import type { PredictionEvent, PredictionMarket, PredictionOutcome } from "@/lib/predictions/model";

import { usd } from "../format";
import styles from "../predictions.module.css";
import { wordsFor, type PredictionWord } from "../words";

type Turn = Readonly<{ id: number; question: string; state: "loading" | "done" | "failed"; response: AskResponse | null; error: string | null }>;

type Journal = Readonly<{ score: { lines: number; settledMarkets: number; brierMarket: number | null; brierRyntra: number | null } }> | "failed";

export type RyntraThread = Readonly<{
  turns: readonly Turn[];
  setTurns: Dispatch<SetStateAction<readonly Turn[]>>;
  seq: MutableRefObject<number>;
  /** The question being typed, not yet asked. */
  draft: string;
  setDraft: (text: string) => void;
}>;

/**
 * The conversation on one market outcome, kept by the page: folding the panel
 * away or the workspace rebuilding it loses nothing — the question being typed
 * included — and another market or outcome starts a new one — an answer still
 * on its way to the old one lands nowhere.
 */
export function useRyntraThread(scope: string): RyntraThread {
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [shownFor, setShownFor] = useState(scope);
  const seq = useRef(0);
  if (shownFor !== scope) {
    setShownFor(scope);
    setTurns([]);
  }
  return { turns, setTurns, seq, draft, setDraft };
}

const DETAIL_SECTIONS: readonly (readonly ["meaning" | "counter" | "risks" | "checks" | "actions", PredictionWord])[] = [
  ["meaning", "askMeaning"],
  ["counter", "askCounter"],
  ["risks", "askRisks"],
  ["checks", "askChecks"],
  ["actions", "askActions"],
];

/** A source's time as everyone reads the same: `14:02 UTC · 21 Oct`. */
function sourceTime(iso: string | null, locale: WorkspaceLocale): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
  const day = d.toLocaleDateString(locale === "uk" ? "uk-UA" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${time} · ${day}`;
}

const pctOf = (p: number, locale: WorkspaceLocale) => {
  const v = Math.round(p * 1000) / 10;
  const text = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return locale === "uk" ? `${text.replace(".", ",")} %` : `${text}%`;
};
const centsOf = (p: number, locale: WorkspaceLocale) => {
  const v = Math.round(p * 1000) / 10;
  const text = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return locale === "uk" ? `${text.replace(".", ",")} ¢` : `${text}¢`;
};

/**
 * Ryntra on a market: the five questions as buttons, the person's own
 * question, and each answer as Ryntra composed it — its first lines in view,
 * the rest under «Details», the sources with their times, the plan draft that
 * opens in the plan builder, and «not advice» under every answer. Ryntra
 * reads and drafts; the ticket's Review is where anything is decided.
 */
export function RyntraPanel({
  event,
  market,
  outcome,
  locale,
  amountUsd,
  request,
  onRequestHandled,
  thread,
  side,
  onCollapse,
  onDraft,
}: {
  event: PredictionEvent;
  market: PredictionMarket;
  outcome: PredictionOutcome;
  locale: WorkspaceLocale;
  amountUsd: number;
  /** A question asked from outside the panel — the ticket's «Ask Ryntra»; asked once, then handed back. */
  request: Readonly<{ topic: AskTopic; n: number }> | null;
  onRequestHandled: () => void;
  thread: RyntraThread;
  /** The side the panel stands on, for the fold's arrow. */
  side: "left" | "right";
  onCollapse?: () => void;
  onDraft: (draft: PredictionPlanDraft) => void;
}) {
  const word = wordsFor(locale);
  const { turns, setTurns, seq, draft: text, setDraft: setText } = thread;
  const [journal, setJournal] = useState<Journal | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const busy = turns.some((t) => t.state === "loading");

  const ask = useCallback(
    async (topic: AskTopic | null, typed: string) => {
      if (busy) return;
      const id = (seq.current += 1);
      const question = typed.trim() || topicQuestion(topic ?? "overview", locale, outcome.label);
      setTurns((list) => [...list.slice(-5), { id, question, state: "loading", response: null, error: null }]);
      try {
        const response = await fetch("/api/predictions/assistant", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ eventId: event.id, venueMarketId: market.id, outcomeId: outcome.id, topic, ...(typed.trim() ? { text: typed.trim() } : {}), locale, amountUsd }),
        });
        const body = (await response.json().catch(() => null)) as (AskResponse & { error?: { code?: string } }) | null;
        if (!response.ok || !body || !body.answer) {
          const error = body?.error?.code === "RATE_LIMITED" ? word("askRateLimited") : word("askFailed");
          setTurns((list) => list.map((t) => (t.id === id ? { ...t, state: "failed", error } : t)));
          return;
        }
        setTurns((list) => list.map((t) => (t.id === id ? { ...t, state: "done", response: body } : t)));
      } catch {
        setTurns((list) => list.map((t) => (t.id === id ? { ...t, state: "failed", error: word("askFailed") } : t)));
      }
    },
    [busy, event.id, market.id, outcome.id, outcome.label, locale, amountUsd, word, seq, setTurns],
  );

  /* The ticket's «Ask Ryntra»: asked once, when no answer is on its way, and handed back so a panel built again does not ask it twice. */
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!request || busy || handled.current === request.n) return;
    handled.current = request.n;
    onRequestHandled();
    void ask(request.topic, "");
  }, [request, busy, ask, onRequestHandled]);

  /* The newest answer in view, at its question. */
  useEffect(() => {
    const last = list.current?.lastElementChild;
    if (last && typeof (last as HTMLElement).scrollIntoView === "function") (last as HTMLElement).scrollIntoView({ block: "nearest" });
  }, [turns.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    void ask(null, text);
    setText("");
  };

  const readJournal = () => {
    if (journal && journal !== "failed") return;
    void fetch(`/api/predictions/assistant/journal?market=${encodeURIComponent(market.id)}`, { headers: { accept: "application/json" }, cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as Journal) : "failed"))
      .then((j) => setJournal(j))
      .catch(() => setJournal("failed"));
  };

  const Fold = side === "left" ? CaretDoubleLeft : CaretDoubleRight;

  return (
    <section className={`${styles.card} ${styles.ryntra}`} aria-labelledby="pred-ryntra">
      <div className={styles.cardHead}>
        <h2 id="pred-ryntra" className={styles.cardTitle}>
          {word("askRyntra")}
        </h2>
        {onCollapse ? (
          <button type="button" className={`${styles.iconButton} ${styles.ryntraFold}`} aria-label={word("askCollapse")} title={word("askCollapse")} onClick={onCollapse}>
            <Fold size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className={styles.ryntraBody}>
        {turns.length === 0 ? <p className={styles.muted}>{word("askIntro")}</p> : null}
        <div className={styles.askChips} role="group" aria-label={word("askRyntra")}>
          {ASK_BUTTONS.map((topic) => (
            <button key={topic} type="button" className={styles.chip} disabled={busy} onClick={() => void ask(topic, "")}>
              {topicLabel(topic, locale, outcome.label)}
            </button>
          ))}
        </div>
        <div className={styles.askThread} ref={list}>
          {turns.map((turn) => (
            <article key={turn.id} className={styles.askTurn}>
              <p className={styles.askQuestion}>
                <span className={styles.srOnly}>{word("askYou")}: </span>
                {turn.question}
              </p>
              {turn.state === "loading" ? (
                <p className={styles.muted} role="status">
                  {word("askThinking")}
                </p>
              ) : null}
              {turn.state === "failed" ? (
                <p className={styles.error} role="status">
                  {turn.error}
                </p>
              ) : null}
              {turn.response ? <Answer response={turn.response} locale={locale} onDraft={onDraft} /> : null}
            </article>
          ))}
        </div>
      </div>
      <form className={styles.askForm} onSubmit={submit}>
        <input className={styles.input} value={text} maxLength={600} placeholder={word("askPlaceholder")} aria-label={word("askPlaceholder")} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="rw-btn" disabled={busy || !text.trim()} aria-label={word("askSend")}>
          <PaperPlaneRight size={16} aria-hidden="true" />
          <span>{word("askSend")}</span>
        </button>
      </form>
      <details className={styles.disclosure} onToggle={(e) => (e.currentTarget.open ? readJournal() : undefined)}>
        <summary>{word("askJournal")}</summary>
        <div className={styles.disclosureBody}>
          {!journal ? (
            <p>{word("loading")}</p>
          ) : journal === "failed" ? (
            <p>{word("askJournalFailed")}</p>
          ) : (
            <>
              <p>
                {word("askJournalLines")}: <b>{journal.score.lines}</b> · {word("askJournalSettled")}: <b>{journal.score.settledMarkets}</b>
              </p>
              {journal.score.settledMarkets === 0 ? (
                <p>{word("askJournalEmpty")}</p>
              ) : (
                <p>
                  {word("askJournalMarket")}: <b>{journal.score.brierMarket?.toFixed(3) ?? "—"}</b> · {word("askJournalRyntra")}: <b>{journal.score.brierRyntra?.toFixed(3) ?? "—"}</b>
                  {journal.score.brierRyntra == null ? ` (${word("askJournalNone")})` : ""}
                </p>
              )}
              <p>{word("askJournalHint")}</p>
            </>
          )}
        </div>
      </details>
    </section>
  );
}

type Section = "observation" | "meaning" | "counter" | "risks" | "checks" | "actions";

/** What a topic's answer leads with: the risks for «risks», the venues' differences for «the catch», what was read for the rest. */
const LEAD: Readonly<Record<AskTopic, Section>> = { yes: "observation", basis: "counter", news: "observation", risks: "risks", plan: "observation", overview: "observation" };

function Answer({ response, locale, onDraft }: { response: AskResponse; locale: WorkspaceLocale; onDraft: (draft: PredictionPlanDraft) => void }) {
  const word = wordsFor(locale);
  const leadSection = response.answer[LEAD[response.topic]].length > 0 ? LEAD[response.topic] : "observation";
  const lead = response.answer[leadSection].slice(0, 3);
  const rest = (section: Section) => (section === leadSection ? response.answer[section].slice(3) : response.answer[section]);
  const more = rest("observation");
  const draft = response.draft;
  const deadline = draft?.deadline ? new Date(draft.deadline).toLocaleDateString(locale === "uk" ? "uk-UA" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;
  const hasDetails = more.length > 0 || DETAIL_SECTIONS.some(([key]) => rest(key).length > 0);
  return (
    <div className={styles.askAnswer}>
      <p className={styles.askHeadline} role="status">
        {response.headline}
      </p>
      {lead.map((s, i) => (
        <p key={i} className={styles.askBlock}>
          {s.text}
        </p>
      ))}
      {draft ? (
        <div className={styles.draftCard} role="group" aria-label={word("askDraftTitle")}>
          <b>{word("askDraftTitle")}</b>
          <dl>
            <div>
              <dt>{word("askDraftEntry")}</dt>
              <dd>{centsOf(draft.maxProbability, locale)}</dd>
            </div>
            <div>
              <dt>{word("askDraftLoss")}</dt>
              <dd>{usd(draft.amountUsd, Number.isInteger(draft.amountUsd) ? 0 : 2)}</dd>
            </div>
            {draft.invalidationBelow != null ? (
              <div>
                <dt>{word("askDraftExit")}</dt>
                <dd>{pctOf(draft.invalidationBelow, locale)}</dd>
              </div>
            ) : null}
            {deadline ? (
              <div>
                <dt>{word("askDraftUntil")}</dt>
                <dd>{deadline}</dd>
              </div>
            ) : null}
          </dl>
          <button type="button" className="rw-btn" onClick={() => onDraft(draft)}>
            {word("askOpenPlan")}
          </button>
        </div>
      ) : null}
      {response.words === "reads-free-spent" ? <p className={styles.hint}>{word("askFreeSpent")}</p> : null}
      {response.words === "reads-busy" ? <p className={styles.hint}>{word("askBusy")}</p> : null}
      {hasDetails ? (
        <details className={styles.askDetails}>
          <summary>{word("askDetails")}</summary>
          <div className={styles.askDetailsBody}>
          {more.map((s, i) => (
            <p key={`o${i}`} className={styles.askBlock}>
              {s.text}
            </p>
          ))}
          {DETAIL_SECTIONS.map(([key, title]) =>
            rest(key).length > 0 ? (
              <div key={key} className={styles.askSection}>
                <h3>{word(title)}</h3>
                {rest(key).map((s, i) => (
                  <p key={i} className={styles.askBlock}>
                    {s.text}
                  </p>
                ))}
              </div>
            ) : null,
          )}
          </div>
        </details>
      ) : null}
      {response.sources.length > 0 ? (
        <details className={styles.askDetails}>
          <summary>
            {word("askSources")} · {response.sources.length}
          </summary>
          <ul className={`${styles.askSources} ${styles.askDetailsBody}`}>
            {response.sources.map((source) => (
              <li key={source.id}>
                <span>{source.label}</span>
                {sourceTime(source.at, locale) ? <time dateTime={source.at ?? undefined}>{sourceTime(source.at, locale)}</time> : null}
                {source.href ? (
                  <a href={source.href} target="_blank" rel="noopener noreferrer nofollow" aria-label={`${source.label} ↗`}>
                    <ArrowSquareOut size={14} aria-hidden="true" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className={styles.askDisclaimer}>{response.disclaimer}</p>
    </div>
  );
}
