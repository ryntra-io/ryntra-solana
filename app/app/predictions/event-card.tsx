"use client";

import { ChartLineUp, Star } from "@phosphor-icons/react";
import Link from "next/link";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PredictionEventSummary } from "@/lib/predictions/model";

import { pct, pctPoints, timeLeft, usdCompact } from "./format";
import styles from "./predictions.module.css";
import { outcomeLabel, venueName, wordsFor } from "./words";

/**
 * One event, the decision information first (`RYN-PREDICTIONS-001` item 5):
 * the question, the leading outcomes with their probabilities and a bar of
 * the same width, the change since the person watched it where the store
 * holds one, the volume, the venues, the time to the end, the watch state.
 * The venues are chips at the foot — secondary, unless identity matters.
 */
export function EventCard({
  event,
  locale,
  watched,
  delta,
  onWatch,
  nowMs,
}: {
  event: PredictionEventSummary;
  locale: WorkspaceLocale;
  watched: boolean;
  /** The move of the leading outcome since it was watched, in probability; null when unknown. */
  delta: number | null;
  onWatch: ((event: PredictionEventSummary, watched: boolean) => void) | null;
  nowMs: number;
}) {
  const word = wordsFor(locale);
  const leading = event.leading.slice(0, 3);
  const quiet = leading.every((o) => o.probability == null);
  return (
    <article className={styles.event}>
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
          <Link href={`/app/predictions/${encodeURIComponent(event.id)}`} prefetch={false}>
            {event.title}
          </Link>
        </h3>
        {onWatch ? (
          <button type="button" className={styles.iconButton} aria-pressed={watched} aria-label={watched ? word("unwatch") : word("watch")} title={watched ? word("unwatch") : word("watch")} onClick={() => onWatch(event, !watched)}>
            <Star size={18} weight={watched ? "fill" : "regular"} />
          </button>
        ) : null}
      </div>
      <div className={styles.outcomes}>
        {leading.length === 0 ? <p className={styles.muted}>{word("empty")}</p> : null}
        {leading.map((outcome) => (
          <div key={outcome.id} className={styles.outcome}>
            <span className={styles.outcomeLabel}>{outcomeLabel(outcome.label, locale)}</span>
            <span className={styles.outcomeValue} data-empty={outcome.probability == null}>
              {pct(outcome.probability)}
            </span>
            <span className={styles.bar} data-tone={quiet ? "quiet" : undefined} aria-hidden="true">
              <i style={{ width: `${Math.round((outcome.probability ?? 0) * 100)}%` }} />
            </span>
          </div>
        ))}
      </div>
      <div className={styles.eventFoot}>
        <span className={styles.eventMeta}>
          <span>
            {word("volume")} <b>{usdCompact(event.volume)}</b>
          </span>
          <span>{timeLeft(event.endDate, locale, nowMs)}</span>
          {delta != null && Math.abs(delta) >= 0.001 ? (
            <span className={styles.delta} data-tone={delta > 0 ? "pos" : delta < 0 ? "neg" : undefined} title={word("sinceWatched")}>
              {pctPoints(delta)}
            </span>
          ) : null}
        </span>
        <span className={styles.venueChips} aria-label={word("venues")}>
          {event.venues.slice(0, 4).map((venue) => (
            <span key={venue} className={styles.venueChip} data-primary={venue === event.venue}>
              {venueName(venue)}
            </span>
          ))}
          {event.venues.length > 4 ? <span className={styles.venueChip}>+{event.venues.length - 4}</span> : null}
        </span>
      </div>
    </article>
  );
}
