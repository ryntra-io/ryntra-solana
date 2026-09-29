"use client";

import { useEffect, useState } from "react";

import { useAggAuthContext } from "@agg-build/hooks";
import type { VenueEventWithMarkets, VenueMarket, VenueMarketOutcome } from "@agg-build/hooks";
import { EventMarketPage, HomePage } from "@agg-build/ui/pages";

import { useLab } from "./lab-context";
import { ProfileFromHooks } from "./profile-from-hooks";
import styles from "./lab.module.css";

/*
 * Tab 1 — the aggregator's own product, as they ship it.
 *
 * `HomePage` with its own header, search and category tabs; `EventMarketPage`
 * with the hero chart, the market list, the orderbook and their order panel;
 * their profile page fed from their hooks. Nothing here is restyled: the point
 * of the tab is that the Owner sees the original AGG UX and decides from it.
 * The only Ryntra parts are the three view switches under the bar and the
 * routing between the pages, which their app does with its own router.
 */

type View = "home" | "event" | "profile";

function readEventFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("event");
}

export function ReadyAppTab() {
  const { selection, setSelection } = useLab();
  const auth = useAggAuthContext();
  const [view, setView] = useState<View>(() => (selection.eventId || readEventFromUrl() ? "event" : "home"));

  /* A link opened in a new tab (`getEventHref` below) carries the event id. */
  useEffect(() => {
    const fromUrl = readEventFromUrl();
    if (fromUrl && !selection.eventId) {
      setSelection({ eventId: fromUrl, marketId: null, outcomeId: null });
    }
    // once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEvent = (event: VenueEventWithMarkets, market?: VenueMarket, outcome?: VenueMarketOutcome) => {
    setSelection({ eventId: event.id, marketId: market?.id ?? null, outcomeId: outcome?.id ?? null });
    setView("event");
  };

  return (
    <>
      <div className={styles.note}>
        <nav className={styles.subnav} aria-label="Сторінки AGG">
          <button
            type="button"
            className={`${styles.subnavItem} ${view === "home" ? styles.subnavOn : ""}`}
            onClick={() => setView("home")}
          >
            HomePage
          </button>
          <button
            type="button"
            className={`${styles.subnavItem} ${view === "event" ? styles.subnavOn : ""}`}
            onClick={() => setView("event")}
            disabled={!selection.eventId}
            title={selection.eventId ? undefined : "Відкрий подію з Home"}
          >
            EventMarketPage
          </button>
          <button
            type="button"
            className={`${styles.subnavItem} ${view === "profile" ? styles.subnavOn : ""}`}
            onClick={() => setView("profile")}
          >
            UserProfilePage
          </button>
        </nav>
        <span>
          {view === "home"
            ? "Їхній Home: хедер, пошук, категорії, картки подій із цінами по майданчиках. Клік по картці відкриває EventMarketPage."
            : view === "event"
              ? "Їхня сторінка події: графік, ринки й наслідки, orderbook, PlaceOrder у paper-режимі."
              : auth.isAuthenticated
                ? "Їхній профіль: paper-баланс, позиції, ордери, активність — з їхніх hooks."
                : "Профіль показує дані лише після входу AGG-користувача."}
        </span>
      </div>
      <div className={styles.aggStage}>
        {view === "home" ? (
          <div className={styles.aggInnerFull}>
            <HomePage
              withHeader
              onEventClick={(event) => openEvent(event)}
              onMarketClick={(event, market, outcome) => openEvent(event, market, outcome)}
              getEventHref={(event) => `/preview/agg-lab?tab=ready&event=${encodeURIComponent(event.id)}`}
              stickyOrderPanel={{ enabled: true, top: 96 }}
            />
          </div>
        ) : null}
        {view === "event" && selection.eventId ? (
          <div className={styles.aggInner}>
            <EventMarketPage
              key={selection.eventId}
              eventId={selection.eventId}
              defaultMarketId={selection.marketId ?? undefined}
              defaultOutcomeId={selection.outcomeId ?? undefined}
              showPlaceOrder
              stickyOrderPanel={{ enabled: true, top: 96 }}
              onExpandedMarketChange={(marketId) =>
                setSelection((current) => ({ ...current, marketId: marketId ?? current.marketId }))
              }
              onError={(error) => console.error("[agg-lab] EventMarketPage", error)}
            />
          </div>
        ) : null}
        {view === "event" && !selection.eventId ? (
          <p className={styles.empty}>Спершу відкрий подію на HomePage — сторінка події читає її за ідентифікатором.</p>
        ) : null}
        {view === "profile" ? (
          <div className={styles.aggInner}>
            <ProfileFromHooks onOpenEvent={(eventId) => { setSelection({ eventId, marketId: null, outcomeId: null }); setView("event"); }} />
          </div>
        ) : null}
      </div>
    </>
  );
}
