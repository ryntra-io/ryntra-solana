"use client";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PredictionEvent, PredictionMarket } from "@/lib/predictions/model";
import { settlementPoints, type SettlementGroup, type SettlementKind, type SettlementPoint } from "@/lib/predictions/settlement";

import { dateShort } from "../format";
import styles from "../predictions.module.css";
import { catchLead, venueName, wordsFor, type PredictionWord } from "../words";

const KIND: Readonly<Record<Exclude<SettlementKind, "other">, PredictionWord>> = {
  source: "catchSource",
  threshold: "catchThreshold",
  timing: "catchTiming",
  scope: "catchScope",
  edge: "catchEdge",
};

const MEANING: Readonly<Record<Exclude<SettlementKind, "other">, PredictionWord>> = {
  source: "meaningSource",
  threshold: "meaningThreshold",
  timing: "meaningTiming",
  scope: "meaningScope",
  edge: "meaningEdge",
};

/** What a kind of difference means for the person, in one plain sentence; none for a kind Ryntra has no word for. */
export function pointMeaning(point: SettlementPoint, locale: WorkspaceLocale): string | null {
  return point.kind === "other" ? null : wordsFor(locale)(MEANING[point.kind]);
}

/** A venue's answer as the person reads it: a date in their own format (with the UTC time when it has one), any other text in the venue's words. */
function groupText(group: SettlementGroup, locale: WorkspaceLocale): string | null {
  if (!group.date) return group.text;
  const day = dateShort(group.date, locale);
  if (group.date.endsWith("T00:00:00.000Z")) return day;
  return `${day}, ${group.date.slice(11, 16)} UTC`;
}

/** A difference's name in the person's words; a kind Ryntra has no word for keeps the provider's title. */
export function pointHeadline(point: SettlementPoint, locale: WorkspaceLocale): string {
  return point.kind === "other" ? point.title : wordsFor(locale)(KIND[point.kind]);
}

/** The venues the market trades on: the anchor and every matched one, each once. */
export function marketVenues(market: PredictionMarket): readonly string[] {
  return [...new Set([market.venue, ...market.matched.map((m) => m.venue)])];
}

/**
 * «Where's the catch»: how the venues settle this market differently, one
 * line per difference — the odd venues and what they say — and the whole
 * comparison, with the provider's own words, a tap deeper.
 */
export function CatchCard({ event, market, locale }: { event: PredictionEvent; market: PredictionMarket; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const points = settlementPoints(event.settlement, marketVenues(market));
  const lead = !event.settlement ? word("catchUnknown") : points.length === 0 ? word("catchNone") : catchLead(points.length, locale);
  return (
    <section className={styles.card} aria-labelledby="pred-catch">
      <div className={styles.cardHead}>
        <h2 id="pred-catch" className={styles.cardTitle}>
          {word("catchTitle")}
        </h2>
      </div>
      <p className={styles.catchLead}>{lead}</p>
      {points.map((point, i) => {
        const odd = point.groups.slice(1);
        const first = odd[0];
        return (
          <details key={`${point.kind}:${i}`} className={styles.disclosure}>
            <summary>
              <span className={styles.catchSummary}>
                <b>
                  {pointHeadline(point, locale)}
                  {point.severity === "critical" && point.differs.length > 0 ? <small className={styles.briefMayDecide}>{word("briefMayDecide")}</small> : null}
                </b>
                {first ? (
                  <span>
                    {first.venues.map(venueName).join(", ")}: {first.text ? <span lang={first.date ? undefined : "en"}>{groupText(first, locale)}</span> : word("catchNotStated").toLowerCase()}
                    {odd.length > 1 ? ` · +${odd.length - 1}` : ""}
                  </span>
                ) : null}
              </span>
            </summary>
            <div className={styles.disclosureBody}>
              {pointMeaning(point, locale) ? <p>{pointMeaning(point, locale)}</p> : null}
              <ul className={styles.catchGroups}>
                {point.groups.map((g) => (
                  <li key={g.venues.join(",")}>
                    <span>{g.venues.map(venueName).join(", ")}</span>
                    <b lang={g.text && !g.date ? "en" : undefined} data-silent={g.text == null}>
                      {groupText(g, locale) ?? word("catchNotStated")}
                    </b>
                  </li>
                ))}
              </ul>
              {point.summary ? (
                <p className={styles.rules}>
                  <span className={styles.muted}>{word("catchProvider")}: </span>
                  <span lang="en">{point.summary}</span>
                </p>
              ) : null}
            </div>
          </details>
        );
      })}
      {event.settlement?.sharedSummary ? (
        <details className={styles.disclosure}>
          <summary>{word("catchShared")}</summary>
          <div className={styles.disclosureBody}>
            <p className={styles.rules} lang="en">
              {event.settlement.sharedSummary}
            </p>
          </div>
        </details>
      ) : null}
    </section>
  );
}
