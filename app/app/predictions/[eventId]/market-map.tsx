"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { MapCheck, MapGroup, MapLink, MarketMap } from "@/lib/predictions/market-map";

import { pct, pctPoints } from "../format";
import styles from "../predictions.module.css";
import { usePredictionsPaths } from "../surface";
import { mapCloseSentence, mapEarlierTag, outcomeLabel, venueName, wordsFor, type PredictionWord } from "../words";

/**
 * «Related markets»: the markets the provider's model links to this one, for
 * the outcome the person picked — those it expects to move with it, those
 * the other way, those on the same theme. Each says what links them in the
 * model's own words, its price and day, and what in the dates or status could
 * work against the link; each opens its market. The panel says once, on top,
 * that a link is the model's, not a cause. Prices are plain chances here,
 * never a payout: nothing in this panel is an offer.
 *
 * It reads the map only once it is on screen — a tab behind another or a
 * folded block asks the provider for nothing.
 */

type MapState = Readonly<{ status: "idle" | "loading" | "ready" | "failed"; map: MarketMap | null }>;

function useMarketMap(eventId: string, marketId: string, outcomeId: string, seen: boolean): MapState {
  const [state, setState] = useState<MapState>({ status: "idle", map: null });
  useEffect(() => {
    if (!seen) return undefined;
    const abort = new AbortController();
    setState({ status: "loading", map: null });
    void fetch(`/api/predictions/markets/${encodeURIComponent(marketId)}/map?event=${encodeURIComponent(eventId)}&outcome=${encodeURIComponent(outcomeId)}`, { headers: { accept: "application/json" }, cache: "no-store", signal: abort.signal })
      .then(async (r) => (r.ok ? ((await r.json()) as { map: MarketMap }).map : null))
      .then((map) => {
        if (!abort.signal.aborted) setState(map ? { status: "ready", map } : { status: "failed", map: null });
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ status: "failed", map: null });
      });
    return () => abort.abort();
  }, [eventId, marketId, outcomeId, seen]);
  return state;
}

/** True once the element has been on screen. */
function useSeen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver !== "function") {
      setSeen(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setSeen(true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen];
}

const GROUPS: readonly Readonly<{ id: MapGroup; title: PredictionWord; help: PredictionWord }>[] = [
  { id: "with", title: "mapWith", help: "mapWithHelp" },
  { id: "against", title: "mapAgainst", help: "mapAgainstHelp" },
  { id: "theme", title: "mapTheme", help: "mapThemeHelp" },
];

function checkText(check: MapCheck, locale: WorkspaceLocale): string | null {
  const word = wordsFor(locale);
  switch (check.code) {
    case "bothWays":
      return word("mapBothWays");
    case "settled":
      return check.status === "resolved" ? word("mapResolved") : word("mapClosed");
    case "endsBefore":
      return mapCloseSentence(check.days, "before", locale);
    case "endsAfter":
      return mapCloseSentence(check.days, "after", locale);
    case "datesUnknown":
      return word("mapDatesUnknown");
    case "statusUnknown":
      return word("mapStatusUnknown");
    case "titleOnly":
      return word("mapTitleOnly");
    /* Said by the day's line, not again here. */
    case "pricesAgainst":
      return null;
  }
}

/** The one short tag a row carries, the gravest first; the sentences are in its details. A later close is no warning. */
function tagOf(checks: readonly MapCheck[], locale: WorkspaceLocale): string | null {
  const word = wordsFor(locale);
  const order: readonly MapCheck["code"][] = ["bothWays", "settled", "endsBefore", "pricesAgainst", "titleOnly"];
  const first = order.map((code) => checks.find((c) => c.code === code)).find(Boolean);
  if (!first) return null;
  switch (first.code) {
    case "bothWays":
      return word("mapTagBothWays");
    case "settled":
      return first.status === "resolved" ? word("mapTagResolved") : word("mapTagClosed");
    case "endsBefore":
      return mapEarlierTag(first.days, locale);
    case "pricesAgainst":
      return word("mapTagAgainst");
    default:
      return word("mapTagTitleOnly");
  }
}

const tone = (delta: number | null) => (delta == null || delta === 0 ? undefined : { color: delta > 0 ? "var(--ry-pnl-pos)" : "var(--ry-pnl-neg)" });

export function MarketMapPanel({ eventId, marketId, outcomeId, outcomeName, locale }: { eventId: string; marketId: string; outcomeId: string; outcomeName: string; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const [ref, seen] = useSeen<HTMLElement>();
  const state = useMarketMap(eventId, marketId, outcomeId, seen);
  const map = state.map?.anchor.outcomeId === outcomeId ? state.map : null;
  /* The answer for the outcome picked before this one is not this one's: until the new one comes, it is loading. */
  const loading = state.status === "idle" || state.status === "loading" || (state.status === "ready" && !map);
  return (
    <section ref={ref} className={styles.card} aria-label={word("panelMap")}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{word("panelMap")}</h2>
        <span className={styles.muted}>
          {word("mapFor")} «{outcomeName}»
          {map?.anchor.change24h != null ? (
            <>
              {" · "}
              {word("mapDay")} <b style={tone(map.anchor.change24h)}>{pctPoints(map.anchor.change24h)}</b>
            </>
          ) : null}
        </span>
      </div>
      <p className={styles.mapNote} role="note">
        {word("mapNote")}
      </p>
      {loading ? (
        <div className={styles.skeleton} aria-busy="true">
          <span className={styles.bone} />
          <span className={styles.bone} />
        </div>
      ) : state.status === "failed" || !map ? (
        <p className={styles.muted} style={{ padding: "var(--ry-s3) var(--ry-s4)" }}>
          {word("unavailable")}
        </p>
      ) : (
        <>
          {map.anchor.side === null ? <p className={styles.mapNote}>{word("mapNoDirection")}</p> : null}
          {GROUPS.filter((group) => map.anchor.side !== null || group.id === "theme").map((group) => {
            const links = map.links.filter((l) => l.group === group.id);
            return (
              <div key={group.id} className={styles.mapGroup} data-group={group.id}>
                <h3 className={styles.sectionTitle}>{word(group.title)}</h3>
                <p className={styles.muted}>{word(group.help)}</p>
                {map.parts[group.id] === "failed" ? (
                  <p className={styles.muted}>{word("unavailable")}</p>
                ) : links.length === 0 ? (
                  <p className={styles.muted}>{word("mapNone")}</p>
                ) : (
                  <ul className={styles.mapList}>
                    {links.map((link) => (
                      <LinkRow key={link.eventId} link={link} outcomeName={outcomeName} locale={locale} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

function LinkRow({ link, outcomeName, locale }: { link: MapLink; outcomeName: string; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const paths = usePredictionsPaths();
  const href = `${paths.event(link.eventId)}${link.marketId ? `?market=${encodeURIComponent(link.marketId)}` : ""}`;
  const checks = link.checks.map((c) => checkText(c, locale)).filter((t): t is string => t !== null);
  const tag = tagOf(link.checks, locale);
  const label = link.label ? outcomeLabel(link.label, locale) : null;
  const moved = link.moved === "as-linked" ? word("mapMovedAsLinked") : link.moved === "against" ? word("mapMovedAgainst") : link.moved === "flat" ? word("mapMovedFlat") : null;
  const single = link.scope === "market";
  return (
    <li className={styles.mapLink} data-warn={tag ? true : undefined}>
      <Link href={href} prefetch={false} className={styles.mapTitle}>
        {link.title}
        {link.question ? <small> · {link.question}</small> : null}
      </Link>
      <span className={styles.itemMeta}>
        {single ? (
          <>
            <span>
              «{label}» {word("mapThere")} <b className={styles.mapFigure}>{pct(link.price)}</b>
            </span>
            <span>
              {word("mapDay")} <b className={styles.mapFigure} style={tone(link.change24h)}>{pctPoints(link.change24h)}</b>
            </span>
          </>
        ) : null}
        {link.venue ? <span>{venueName(link.venue)}</span> : null}
        {tag ? <span className={styles.briefMayDecide}>{tag}</span> : null}
      </span>
      <details className={styles.mapWhy}>
        <summary>{word("mapWhy")}</summary>
        <dl className={styles.briefList}>
          <dt>{word("mapLinks")}</dt>
          <dd>
            {link.reason ? <span lang="en">{link.reason}</span> : word("mapNoReason")}
            {link.domain ? (
              <span className={styles.mapDomain} lang="en">
                {link.domain}
              </span>
            ) : null}
          </dd>
          {link.there && label ? (
            <>
              <dt>{word("mapPair")}</dt>
              <dd>
                «{label}» {word("mapThere")} {link.group === "with" ? word("mapPairWith") : word("mapPairApart")} «{outcomeName}» {word("mapHere")}
              </dd>
            </>
          ) : null}
          <dt>{word("mapStrength")}</dt>
          <dd className={styles.mapFigure}>{link.score.toFixed(2)}</dd>
          {link.group !== "theme" ? (
            <>
              <dt>{word("mapDay")}</dt>
              <dd>{moved ?? (link.scope === "event" ? word("mapManyMarkets") : link.scope === "unread" ? word("mapNoFacts") : word("mapNoMove"))}</dd>
            </>
          ) : null}
          <dt>{word("mapTerms")}</dt>
          <dd>
            {checks.length === 0 ? (
              link.scope === "unread" ? word("mapNoFacts") : word("mapTermsFine")
            ) : (
              <ul className={styles.briefExceptions}>
                {checks.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
      </details>
    </li>
  );
}
