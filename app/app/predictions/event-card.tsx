"use client";

import { ChartLineUp, Star } from "@phosphor-icons/react";
import { ProbabilityLine } from "@ryntra/core/chart/compact";
import Link from "next/link";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { marketAccess, type AccessFacts } from "@/lib/predictions/access";
import type { PredictionEventSummary } from "@/lib/predictions/model";

import { cadenceLabel, cardPhase } from "@/lib/predictions/hub-lists";
import { eventInPlay } from "@/lib/predictions/model";
import { chanceHero, chanceSecond, moveText } from "@/lib/predictions/units";

import { AccessChip } from "./access-chip";

import { dateShort, timeLeft, usdCompact } from "./format";
import styles from "./predictions.module.css";
import { usePredictPrefs } from "./prefs-context";
import { useOutcomeWeek } from "./use-market-facts";
import { onVenues, outcomeLabel, wordsFor } from "./words";
import { usePredictionsPaths } from "./surface";

const SOON_MS = 48 * 3_600_000;

/**
 * One event, the decision first: the question, the market's estimate large
 * with its move over the last day and what the usual amount pays under it,
 * then when it closes, on how many venues it trades, and whether this person
 * can buy it — as the provider states it. On an event of several markets the
 * figure is named by its market's question. An event past its close or
 * settled says so in place of any figure: its last price is no offer.
 */
export function EventCard({
  event,
  locale,
  watched,
  onWatch,
  nowMs,
  access,
}: {
  event: PredictionEventSummary;
  locale: WorkspaceLocale;
  watched: boolean;
  onWatch: ((event: PredictionEventSummary, watched: boolean) => void) | null;
  nowMs: number;
  access: AccessFacts;
}) {
  const paths = usePredictionsPaths();
  const word = wordsFor(locale);
  const binary = event.leading.some((o) => /^yes$/i.test(o.label));
  const lead = binary ? event.leading.find((o) => /^yes$/i.test(o.label)) : [...event.leading].sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1))[0];
  const others = binary ? [] : event.leading.filter((o) => o.id !== lead?.id).slice(0, 2);
  /* A lead without a price (it has stopped) has no move worth a line either. */
  const { ref, week } = useOutcomeWeek(lead?.probability == null ? null : (lead?.id ?? null));
  const move = week === undefined ? undefined : week.move;
  const { prefs } = usePredictPrefs();
  const market = event.leadingQuestion && event.leadingQuestion.trim().toLowerCase() !== event.title.trim().toLowerCase() ? event.leadingQuestion : null;
  const end = event.endDate ? Date.parse(event.endDate) : null;
  const phase = cardPhase(event, nowMs);
  const inPlay = phase === "live" && eventInPlay(event, nowMs);
  const cadence = cadenceLabel(event.recurrence, locale);
  const closes = end == null ? timeLeft(null, locale, nowMs) : phase === "live" && end - nowMs < SOON_MS ? timeLeft(event.endDate, locale, nowMs) : dateShort(event.endDate, locale);
  const hero = chanceHero(lead?.probability, prefs.units, prefs.amountUsd);
  const state = marketAccess(event.venues, access);
  return (
    <article className={styles.event} data-phase={phase === "live" ? undefined : phase} ref={ref as React.RefObject<HTMLElement>}>
      <div className={styles.eventTop}>
        {event.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- the venue's own cover, an external host the platform does not optimise
          <img className={styles.eventImage} src={event.image} alt="" loading="lazy" width={44} height={44} />
        ) : (
          <span className={styles.eventImage} data-empty="true" aria-hidden="true">
            <ChartLineUp size={18} />
          </span>
        )}
        <h3 className={styles.eventTitle}>
          <Link href={paths.event(event.id)} prefetch={false}>
            {event.title}
          </Link>
        </h3>
        {onWatch ? (
          <button type="button" className={styles.iconButton} aria-pressed={watched} aria-label={watched ? word("unwatch") : word("watch")} title={watched ? word("unwatch") : word("watch")} onClick={() => onWatch(event, !watched)}>
            <Star size={18} weight={watched ? "fill" : "regular"} />
          </button>
        ) : null}
      </div>
      {phase !== "live" ? (
        <div className={styles.odds}>
          {market ? <span className={styles.oddsMarket}>{market}</span> : null}
          <span className={styles.cardState}>{phase === "resolved" ? word("phaseResolved") : word("cardAwaiting")}</span>
        </div>
      ) : lead ? (
        <div className={styles.odds}>
          {market ? <span className={styles.oddsMarket}>{market}</span> : null}
          <span className={styles.oddsLine}>
            <b className={styles.oddsValue} data-empty={lead.probability == null} data-units={hero.units}>
              {hero.text}
            </b>
            <span className={styles.oddsLabel}>{outcomeLabel(lead.label, locale)}</span>
            <span className={styles.oddsMove} data-tone={move == null ? undefined : move > 0 ? "pos" : move < 0 ? "neg" : undefined} title={word("change24h")}>
              {move === undefined ? "" : move == null || Math.abs(move) < 0.0005 ? `${word("change24h")} —` : `${moveText(move, prefs.units)} · ${word("change24h")}`}
            </span>
          </span>
          {/* The week on the core's 0–100 % axis — the level and its move in points; its source and age are said once under
              the cards, and on the card itself when its numbers are stale. No price, or a history that could not be read: no
              chart at all, never an empty frame. */}
          {lead.probability == null || (week !== undefined && week.status == null) ? null : (
            <ProbabilityLine
              className={styles.cardLine}
              points={week === undefined ? null : week.points}
              status={week?.status ?? null}
              label={`${outcomeLabel(lead.label, locale)} · ${word("week")}`}
              lang={locale === "uk" ? "uk" : "en"}
              head={false}
              caption={week?.status?.state === "stale" ? "short" : "none"}
            />
          )}
          <span className={styles.oddsPays}>{chanceSecond(lead.probability, prefs.units, prefs.amountUsd, outcomeLabel(lead.label, locale), locale)}</span>
          {others.length > 0 ? <span className={styles.oddsOthers}>{others.map((o) => `${outcomeLabel(o.label, locale)} ${chanceHero(o.probability, prefs.units, prefs.amountUsd).text}`).join(" · ")}</span> : null}
        </div>
      ) : (
        <p className={styles.muted}>{word("empty")}</p>
      )}
      <div className={styles.eventFoot}>
        <span className={styles.eventMeta} title={`${word("volume")} ${usdCompact(event.volume)}`}>
          {inPlay ? (
            <span className={styles.liveChip}>{word("inPlay")}</span>
          ) : phase === "live" ? (
            <span>
              {cadence ? <span className={styles.cadenceChip}>{cadence}</span> : null} {word("closes")} <b>{closes}</b>
            </span>
          ) : end != null && end <= nowMs ? (
            <span>
              {word("closedWord")} <b>{closes}</b>
            </span>
          ) : null}
          <span>{onVenues(event.venues.length, locale)}</span>
        </span>
        {/* «Access not confirmed yet» is said once, over the cards; a state the provider did state stays on its card. */}
        {state === "unknown" ? null : <AccessChip state={state} locale={locale} />}
      </div>
    </article>
  );
}
