"use client";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PredictionEvent, PredictionMarket } from "@/lib/predictions/model";
import { resolutionBrief, settlementPhase, type ResolutionBrief, type RulesChange, type SettlementPhase } from "@/lib/predictions/resolution";
import { settlementPoints, type SettlementPoint } from "@/lib/predictions/settlement";

import { Custody } from "../custody-note";
import { dateShort, timeLeft } from "../format";
import styles from "../predictions.module.css";
import { closesSentence, delayedSentence, differsCount, exceptionsCount, outcomeLabel, venueName, wordsFor, type PredictionWord } from "../words";
import { marketVenues, pointHeadline } from "./catch-card";

/** The rules of the event's markets as Ryntra read them over time: venue market id → its changes, newest first. */
export type RulesHistoryView = Readonly<Record<string, readonly RulesChange[]>>;

const PHASE_WORD: Readonly<Record<SettlementPhase["phase"], PredictionWord>> = {
  open: "phaseOpen",
  closing: "phaseClosing",
  awaiting: "phaseAwaiting",
  past: "phasePast",
  delayed: "phaseDelayed",
  resolved: "phaseResolved",
};

const PHASE_TONE: Readonly<Record<SettlementPhase["phase"], string | undefined>> = {
  open: undefined,
  closing: "wait",
  awaiting: "wait",
  past: "wait",
  delayed: "bad",
  resolved: "good",
};

/** Everything the brief draws for one market, read once. */
export function readBrief(event: PredictionEvent, market: PredictionMarket, nowMs: number) {
  const brief = resolutionBrief(market, event.endDate);
  const phase = settlementPhase(market, event.endDate, nowMs);
  const points = settlementPoints(event.settlement, marketVenues(market));
  const deciding = points.filter((p) => p.severity === "critical" && p.differs.length > 0);
  return { brief, phase, points, deciding };
}

/** The label of the sentence that says when the chosen outcome wins: Yes as the venue words it, No as its opposite — and only when there is a sentence to oppose. */
function winLabel(outcome: string | null, hasCondition: boolean, word: (k: PredictionWord) => string): string {
  if (outcome == null) return word("briefYesWins");
  if (/^yes$/i.test(outcome)) return word("briefYouWin");
  if (/^no$/i.test(outcome) && hasCondition) return word("briefYouWinNo");
  return word("briefRulesSay");
}

export function PhaseChip({ phase, locale }: { phase: SettlementPhase; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const label = phase.phase === "resolved" && phase.winner ? `${word("phaseResolved")}: ${outcomeLabel(phase.winner, locale)}` : word(PHASE_WORD[phase.phase]);
  return (
    <span className={styles.stateChip} data-tone={PHASE_TONE[phase.phase]}>
      {label}
    </span>
  );
}

/** The warning the clock calls for, in two sentences at most; nothing while the close is far. */
export function phaseWarning(phase: SettlementPhase, brief: ResolutionBrief, locale: WorkspaceLocale, nowMs: number): string | null {
  const word = wordsFor(locale);
  if (phase.phase === "closing" && brief.closesAt) return `${closesSentence(timeLeft(brief.closesAt, locale, nowMs), locale)} ${word("warnClosing")}`;
  if (phase.phase === "awaiting") return word("warnAwaiting");
  if (phase.phase === "past") return word("warnPast");
  if (phase.phase === "delayed") {
    const from = phase.since === "resolution" ? brief.resolvesBy : brief.closesAt;
    return `${delayedSentence(timeLeft(from, locale, nowMs), phase.since, locale)} ${word("warnDelayed")}`;
  }
  return null;
}

function deadlineText(brief: ResolutionBrief, locale: WorkspaceLocale, nowMs: number): string {
  const word = wordsFor(locale);
  if (!brief.closesAt && !brief.resolvesBy) return word("briefNoDate");
  const parts: string[] = [];
  if (brief.closesAt) parts.push(`${word("briefTrading")} ${dateShort(brief.closesAt, locale)} (${timeLeft(brief.closesAt, locale, nowMs)})`);
  if (brief.resolvesBy && (!brief.closesAt || Date.parse(brief.resolvesBy) >= Date.parse(brief.closesAt))) parts.push(`${word("briefResult")} ${dateShort(brief.resolvesBy, locale)}`);
  return parts.join(" · ");
}

function SourceText({ brief, locale }: { brief: ResolutionBrief; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  if (!brief.source) return <span className={styles.muted}>{word("briefSourceUnstated")}</span>;
  let host: string | null = null;
  try {
    host = brief.source.url ? new URL(brief.source.url).host.replace(/^www\./, "") : null;
  } catch {
    host = null;
  }
  return (
    <>
      <span lang="en">{brief.source.text}</span>
      {brief.source.url && host ? (
        <>
          {" "}
          <a href={brief.source.url} target="_blank" rel="noreferrer noopener">
            {host} ↗
          </a>
        </>
      ) : null}
    </>
  );
}

/**
 * The ticket's line before the person buys: when the chosen outcome wins, in
 * the venue's own sentence, the deadline, and — when the venues settle it
 * differently in a way that can change the result — how many such ways.
 */
export function BriefLine({ event, market, outcomeLabel: chosen, locale, nowMs, inPlay = false }: { event: PredictionEvent; market: PredictionMarket; outcomeLabel: string | null; locale: WorkspaceLocale; nowMs: number; /** A game under way: the venue's date was the kick-off and trading goes on. */ inPlay?: boolean }) {
  const word = wordsFor(locale);
  const { brief, phase, deciding } = readBrief(event, market, nowMs);
  /* One line under the condition: the clock's warning in its shortest form, else the deadline; the rest is the rules panel's. */
  const clock = inPlay
    ? word("inPlayNote")
    : phase.phase === "resolved"
      ? phase.winner
        ? `${word("phaseResolved")}: ${outcomeLabel(phase.winner, locale)}`
        : word("phaseResolved")
      : phase.phase === "closing" && brief.closesAt
      ? closesSentence(timeLeft(brief.closesAt, locale, nowMs), locale)
      : phase.phase === "delayed"
        ? delayedSentence(timeLeft(phase.since === "resolution" ? brief.resolvesBy : brief.closesAt, locale, nowMs), phase.since, locale)
        : phase.phase === "awaiting"
          ? word("warnAwaiting")
          : phase.phase === "past"
            ? word("warnPast")
            : `${word("briefDeadline")}: ${deadlineText(brief, locale, nowMs)}`;
  return (
    <div className={styles.brief} role="group" aria-label={word("briefTitle")}>
      <p className={styles.briefLine} title={brief.yesWhen ?? undefined}>
        <b>{winLabel(chosen, brief.yesWhen != null, word)}:</b> {brief.yesWhen ? <span lang="en">{brief.yesWhen}</span> : <span className={styles.muted}>{word("briefYesUnstated")}</span>}
      </p>
      <p className={styles.hint} data-tone={phase.phase === "closing" || phase.phase === "delayed" ? "caution" : undefined}>
        {clock}
        {deciding.length > 0 ? ` · ${differsCount(deciding.length, locale)}` : ""}
      </p>
    </div>
  );
}

/**
 * «What you're paying for» — the market page's answer before anything else in
 * the rules: the win condition, who decides, the deadline, the exceptions, the
 * settlement's state, and what changed in the rules since Ryntra first read
 * them. Each line is the venue's own words; the full text stays below.
 */
export function BriefCard({ event, market, locale, nowMs, history }: { event: PredictionEvent; market: PredictionMarket; locale: WorkspaceLocale; nowMs: number; history: RulesHistoryView }) {
  const word = wordsFor(locale);
  const { brief, phase } = readBrief(event, market, nowMs);
  const warning = phaseWarning(phase, brief, locale, nowMs);
  const ids = [market.id, ...market.matched.map((m) => m.id)];
  const changes = ids.flatMap((id) => history[id] ?? []).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <section className={styles.card} aria-labelledby="pred-brief">
      <div className={styles.cardHead}>
        <h2 id="pred-brief" className={styles.cardTitle}>
          {word("briefTitle")}
        </h2>
        <PhaseChip phase={phase} locale={locale} />
      </div>
      <div className={styles.cardBody}>
        {warning ? (
          <p className={styles.notice} data-tone={phase.phase === "delayed" ? "bad" : "caution"} role="status">
            {warning}
          </p>
        ) : null}
        <dl className={styles.briefList}>
          <dt>{word("briefYesWins")}</dt>
          <dd>{brief.yesWhen ? <span lang="en">{brief.yesWhen}</span> : <span className={styles.muted}>{word("briefYesUnstated")}</span>}</dd>
          <dt>{word("briefSource")}</dt>
          <dd>
            <SourceText brief={brief} locale={locale} />
          </dd>
          <dt>{word("briefDeadline")}</dt>
          <dd>{deadlineText(brief, locale, nowMs)}</dd>
          {brief.exceptions.length === 0 ? (
            <>
              <dt>{word("briefExceptions")}</dt>
              <dd>
                <span className={styles.muted}>{word("briefExceptionsNone")}</span>
              </dd>
            </>
          ) : null}
        </dl>
      </div>
      {brief.exceptions.length > 0 ? (
        <details className={styles.disclosure}>
          <summary>
            {word("briefExceptions")} · {exceptionsCount(brief.exceptions.length, locale)}
          </summary>
          <div className={styles.disclosureBody}>
            <ul className={styles.briefExceptions}>
              {brief.exceptions.map((s) => (
                <li key={s} lang="en">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}
      <details className={styles.disclosure}>
        <summary>{word("briefVoids")}</summary>
        <div className={styles.disclosureBody}>
          <p>{word("briefVoidsText")}</p>
        </div>
      </details>
      <Custody locale={locale} paper />
      {changes.length > 0 ? <RulesChanges changes={changes} locale={locale} /> : null}
    </section>
  );
}

function RulesChanges({ changes, locale }: { changes: readonly RulesChange[]; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const latest = changes[0];
  return (
    <details className={styles.disclosure}>
      <summary>
        <span className={styles.briefChanged}>
          {word("rulesChanged")} {dateShort(latest.at, locale)} · {venueName(latest.venue)}
          {changes.length > 1 ? ` · +${changes.length - 1}` : ""}
        </span>
      </summary>
      <div className={styles.disclosureBody}>
        <p className={styles.hint}>{word("rulesChangedTitle")}</p>
        {changes.map((c) => {
          const diff = c.diff;
          return (
            <div key={`${c.venueMarketId}:${c.at}`} className={styles.briefChange}>
              <b>
                {dateShort(c.at, locale)} · {venueName(c.venue)}
              </b>
              {diff.closes ? (
                <p>
                  {word("rulesCloseMoved")}: {word("rulesWas")} {dateShort(diff.closes.before, locale)} → {word("rulesNow")} {dateShort(diff.closes.after, locale)}
                </p>
              ) : null}
              {diff.resolves ? (
                <p>
                  {word("rulesResultMoved")}: {word("rulesWas")} {dateShort(diff.resolves.before, locale)} → {word("rulesNow")} {dateShort(diff.resolves.after, locale)}
                </p>
              ) : null}
              {diff.removed.map((s, i) => (
                <p key={`-${i}:${s}`} data-change="removed">
                  <span className={styles.muted}>{word("rulesRemoved")}: </span>
                  <span lang="en">{s}</span>
                </p>
              ))}
              {diff.added.map((s, i) => (
                <p key={`+${i}:${s}`} data-change="added">
                  <span className={styles.muted}>{word("rulesAdded")}: </span>
                  <span lang="en">{s}</span>
                </p>
              ))}
            </div>
          );
        })}
      </div>
    </details>
  );
}

/**
 * The Review's «What you're paying for»: the same four facts for the outcome
 * being bought, the clock's warning, and the differences between the venues
 * the route actually buys on that can change the result.
 */
export function ReviewBrief({ event, market, outcomeLabel: chosen, routeVenues, locale, nowMs }: { event: PredictionEvent; market: PredictionMarket; outcomeLabel: string; routeVenues: readonly string[]; locale: WorkspaceLocale; nowMs: number }) {
  const word = wordsFor(locale);
  const { brief, phase, points } = readBrief(event, market, nowMs);
  const warning = phaseWarning(phase, brief, locale, nowMs);
  /*
   * A difference matters to this order when the route buys on venues that say
   * different things about it; bought on one venue, only when that venue is
   * the one that differs. Silence is not a side.
   */
  const onRoute = new Set(routeVenues);
  const routeDiffers = (p: SettlementPoint) => p.groups.filter((g) => g.text != null && g.venues.some((v) => onRoute.has(v))).length > 1;
  const deciding = points.filter((p) => p.severity === "critical" && (routeVenues.length > 1 ? routeDiffers(p) : routeVenues.some((v) => p.differs.includes(v))));
  return (
    <div className={styles.briefReview}>
      <h3 className={styles.sectionTitle}>{word("briefTitle")}</h3>
      {warning ? (
        <p className={styles.notice} data-tone={phase.phase === "delayed" ? "bad" : "caution"}>
          {warning}
        </p>
      ) : null}
      <dl className={styles.briefList}>
        <dt>{winLabel(chosen, brief.yesWhen != null, word)}</dt>
        <dd>{brief.yesWhen ? <span lang="en">{brief.yesWhen}</span> : <span className={styles.muted}>{word("briefYesUnstated")}</span>}</dd>
        <dt>{word("briefSource")}</dt>
        <dd>
          <SourceText brief={brief} locale={locale} />
        </dd>
        <dt>{word("briefDeadline")}</dt>
        <dd>{deadlineText(brief, locale, nowMs)}</dd>
        {brief.exceptions.length > 0 ? (
          <>
            <dt>{word("briefExceptions")}</dt>
            <dd>
              <details className={styles.briefInline}>
                <summary>{exceptionsCount(brief.exceptions.length, locale)}</summary>
                <ul className={styles.briefExceptions}>
                  {brief.exceptions.map((s) => (
                    <li key={s} lang="en">
                      {s}
                    </li>
                  ))}
                </ul>
              </details>
            </dd>
          </>
        ) : null}
        {deciding.length > 0 ? (
          <>
            <dt>{word("briefDiffers")}</dt>
            <dd>
              <small className={styles.briefMayDecide}>{word("briefMayDecide")}</small> {deciding.map((p) => pointHeadline(p, locale)).join(" · ")}
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
