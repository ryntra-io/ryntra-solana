"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createAggClient } from "@agg-build/sdk";
import { QueryClient, QueryClientProvider, useAggAuthContext } from "@agg-build/hooks";
import { AggProvider } from "@agg-build/ui";
import {
  AggAuthProvider,
  ConnectButton,
  createAppleAuthMethod,
  createEmailAuthMethod,
  createGoogleAuthMethod,
  createTwitterAuthMethod,
} from "@agg-build/auth";

import { applyThemePref, readResolvedTheme } from "@/app/app/theme";

import { AgentsDataTab } from "./agents-data";
import { LabContext, type LabSelection } from "./lab-context";
import { ReadyAppTab } from "./ready-app";
import { RyntraAdaptationTab } from "./ryntra-adaptation";
import styles from "./lab.module.css";

/*
 * The lab shell — `RYN-AGG-LAB-001`.
 *
 * One aggregator client, one query cache and one AGG provider for the whole
 * page; three tabs over them. The first tab renders the aggregator's own
 * pages as they ship them, the second is a console over their API with the
 * real responses, the third walks the same data in Ryntra's frame. The AGG app
 * behind it is in paper mode at the app level (the admin's *Paper Trading*
 * setting, confirmed by `/app/config` → `tradingMode: "paper"`): the API
 * itself refuses a live order for this app, and `trading.executionMode`
 * below is only the pre-resolution guess the SDK documents.
 */

export type LabTab = "ready" | "agents" | "ryntra";

const TABS: readonly { id: LabTab; index: string; label: string }[] = [
  { id: "ready", index: "1", label: "AGG Ready App" },
  { id: "agents", index: "2", label: "Trading agents & data" },
  { id: "ryntra", index: "3", label: "Ryntra adaptation" },
];

const AGG_API = "https://api.agg.market";
const AGG_WS = "wss://ws.agg.market/ws";

function readTabFromUrl(): LabTab {
  const value = new URLSearchParams(window.location.search).get("tab");
  return value === "agents" || value === "ryntra" ? value : "ready";
}

function writeTabToUrl(tab: LabTab) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  window.history.replaceState(window.history.state, "", url);
}

export function AggLab({ appId }: { appId: string }) {
  /* Created once per mount; the SDK keeps the session in memory and, with
     `cookie-refresh`, renews it after a reload through an HttpOnly cookie on
     the AGG host — the documented browser setup. */
  const [client] = useState(() =>
    createAggClient({ baseUrl: AGG_API, appId, wsUrl: AGG_WS, authDelivery: "cookie-refresh" }),
  );
  const [queryClient] = useState(() => new QueryClient());
  const [theme, setTheme] = useState<"light" | "dark">(() => readResolvedTheme());
  const [tab, setTab] = useState<LabTab>(() => readTabFromUrl());
  const [selection, setSelection] = useState<LabSelection>({ eventId: null, marketId: null, outcomeId: null });

  useEffect(() => {
    writeTabToUrl(tab);
  }, [tab]);

  useEffect(() => () => client.destroy(), [client]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      applyThemePref(next);
      return next;
    });
  }, []);

  /* The redirect-based methods return to this very page; the provider consumes
     the `?code=` on mount and the tab survives in the same query string. */
  const authMethods = useMemo(() => {
    const redirectUrl = `${window.location.origin}/preview/agg-lab?tab=ready`;
    return [
      createGoogleAuthMethod({ redirectUrl }),
      createEmailAuthMethod({ redirectUrl }),
      createTwitterAuthMethod({ redirectUrl }),
      createAppleAuthMethod({ redirectUrl }),
    ];
  }, []);

  const config = useMemo(
    () => ({
      general: { locale: "en-US", theme, rootClassName: "ryntra-agg-lab" },
      features: { enableAnimations: true, enableLiveUpdates: true },
      trading: { executionMode: "paper" as const },
    }),
    [theme],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AggProvider client={client} config={config}>
        <AggAuthProvider methods={authMethods}>
          <LabContext.Provider value={{ selection, setSelection, appId, theme }}>
            <div className={styles.frame} data-lab-theme={theme}>
              <header className={styles.bar}>
                <div className={styles.brand}>
                  <h1 className={styles.title}>AGG Lab</h1>
                  <p className={styles.subtitle}>внутрішня лабораторія · нікуди не веде з продукту</p>
                </div>
                <span className={styles.paperBadge} title="Застосунок AGG у paper-режимі: кожен ордер — на симульованих коштах">
                  Paper trading · AGG test environment
                </span>
                <nav className={styles.tabs} aria-label="Режими лабораторії">
                  {TABS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`${styles.tab} ${tab === item.id ? styles.tabOn : ""}`}
                      aria-pressed={tab === item.id}
                      onClick={() => setTab(item.id)}
                    >
                      <span className={styles.tabIndex}>{item.index}</span>
                      {item.label}
                    </button>
                  ))}
                </nav>
                <div className={styles.barRight}>
                  <button type="button" className={styles.ghost} onClick={toggleTheme}>
                    {theme === "dark" ? "Світла тема" : "Темна тема"}
                  </button>
                  <div className={styles.connect} title="Компонент AGG: вхід і paper-баланс їхнього користувача — не акаунт Ryntra">
                    <span className={styles.connectLabel}>AGG-акаунт</span>
                    <ConnectButton />
                  </div>
                </div>
              </header>
              <SessionLine />
              <main className={styles.stage}>
                {tab === "ready" ? <ReadyAppTab /> : null}
                {tab === "agents" ? <AgentsDataTab client={client} /> : null}
                {tab === "ryntra" ? <RyntraAdaptationTab client={client} /> : null}
              </main>
            </div>
          </LabContext.Provider>
        </AggAuthProvider>
      </AggProvider>
    </QueryClientProvider>
  );
}

/* One line under the bar that says whose session the aggregator holds, so
   every paper balance, position and order on the page has a named owner. */
function SessionLine() {
  const auth = useAggAuthContext();
  return (
    <p className={styles.note}>
      {auth.isAuthenticated && auth.user ? (
        <>
          <span>
            AGG-користувач: <strong>{auth.user.username ?? auth.user.id}</strong>
          </span>
          <span>
            paper-рахунок цього користувача; жодних реальних коштів, депозитів чи виведень на цій сторінці
          </span>
        </>
      ) : (
        <>
          <span>
            Дані ринків читаються без входу. Для paper-ордера, балансу та позицій потрібен вхід AGG-користувача
            (кнопка праворуч) — це окрема від Ryntra ідентичність, лише всередині лабораторії.
          </span>
        </>
      )}
    </p>
  );
}
