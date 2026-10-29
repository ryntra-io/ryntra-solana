"use client";

import { useEffect } from "react";

/**
 * The first wallet a tagged browser connects meets the source that brought it (Ріст 7, `/api/growth/touch`).
 *
 * Asks only while the readable mark `rgtp` says a touch waits — a browser that came from no post, friend or UTM
 * link sends nothing — and once per wallet in a tab; the server clears the mark once the source is written. Called
 * by the line above every product page (`invite-banner.tsx`), which the core's shell already mounts.
 */
export function useGrowthTouch(address: string | null, pathname: string): void {
  useEffect(() => {
    if (!address) return;
    let waiting = false;
    try {
      waiting = /(?:^|;\s*)rgtp=1(?:;|$)/.test(document.cookie);
    } catch {
      waiting = false;
    }
    if (!waiting) return;
    const key = `ryntra-touch:${address}`;
    try {
      if (window.sessionStorage.getItem(key) === "1") return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      /* No session storage: the server's mark still keeps it to one write. */
    }
    void fetch("/api/growth/touch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ address }),
    })
      .then((response) => {
        if (!response.ok) window.sessionStorage.removeItem(key);
      })
      .catch(() => {
        try {
          window.sessionStorage.removeItem(key);
        } catch {
          /* nothing to undo */
        }
      });
    /* Asked again on the next page while the mark stays — after a store that did not answer. */
  }, [address, pathname]);
}
