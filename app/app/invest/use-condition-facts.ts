"use client";

import { useEffect, useState } from "react";

import { priceFactsOf, type PriceFacts, type PriceFactsRow } from "@/lib/autoinvest/price-condition";

/** How often an open sheet reads the company's figures again: the condition is judged on data no older than half an hour, and the page keeps them fresher than that. */
const REFRESH_MS = 60_000;

export type ConditionRead = Readonly<{ facts: PriceFacts | null; status: "idle" | "loading" | "ready" | "failed" }>;

/**
 * The facts a rule's price condition is judged on while a sheet shows it: the
 * page's own row first, then the company's row read again from the same
 * server read the order route judges on (`/api/stocks/asset`), every minute
 * while `enabled`. A read that fails keeps the last facts, which age into
 * «stale» on their own — the sheet never invents fresh ones.
 */
export function useConditionFacts(mint: string, enabled: boolean, initial: PriceFacts | null): ConditionRead {
  const [read, setRead] = useState<ConditionRead>({ facts: initial, status: initial ? "ready" : "idle" });

  useEffect(() => {
    if (!enabled || !mint) return undefined;
    let live = true;
    setRead((current) => (current.facts ? current : { facts: null, status: "loading" }));
    const fetchOnce = () =>
      fetch(`/api/stocks/asset?ticker=${encodeURIComponent(mint)}`, { headers: { accept: "application/json" }, cache: "no-store" })
        .then(async (response) => {
          const body = response.ok ? ((await response.json().catch(() => null)) as { row?: PriceFactsRow; fetchedAt?: string } | null) : null;
          if (!live) return;
          if (!body?.row) {
            setRead((current) => (current.facts ? current : { facts: null, status: "failed" }));
            return;
          }
          const readAt = body.fetchedAt ? Date.parse(body.fetchedAt) : Number.NaN;
          setRead({ facts: priceFactsOf(body.row, Number.isFinite(readAt) ? readAt : null), status: "ready" });
        })
        .catch(() => {
          if (live) setRead((current) => (current.facts ? current : { facts: null, status: "failed" }));
        });
    void fetchOnce();
    const timer = window.setInterval(() => void fetchOnce(), REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [mint, enabled]);

  return read;
}
