"use client";

import { useEffect, useState } from "react";

import { SOLANA_MAINNET_USDC_MINT } from "@/lib/solana/send-kinds";

import { isNoRoute, ROUTE_MINIMUM_RETRY_MS, routeMinimumSteps } from "./company-model";

/**
 * A company's own minimum, read from the live quote (canon v5.5 В35: «де
 * живе котирування на $1 маршруту не дає — мінімум цього активу з
 * котирування, чесно»). A purchase is from a dollar; when the venue finds no
 * route for the sum asked, the same read-only quote the purchase uses is asked
 * for the ladder's larger sums in turn (`ROUTE_MINIMUM_LADDER_USD`), and the
 * first that routes is the minimum the sheet says — «На $1 маршруту зараз
 * немає. IREN — від $5.» Nothing is claimed when none routes or the venue
 * does not answer. A minimum found is kept for the page's life, so a second
 * look does not ask again.
 */

export type RouteMinimum = Readonly<{
  state: "idle" | "finding" | "found" | "none";
  /** The least sum that routes, dollars; null unless found. */
  minimumUsd: number | null;
}>;

export type QuoteRoute = "unknown" | "route" | "no-route";

const IDLE: RouteMinimum = { state: "idle", minimumUsd: null };
const FOUND = new Map<string, number>();
const QUOTE_DEBOUNCE_MS = 450;

type QuoteAnswer = Readonly<{ ok: true } | { ok: false; code: string }>;

async function quoteUsdc(mint: string, usd: number, signal: AbortSignal): Promise<QuoteAnswer> {
  try {
    const response = await fetch("/api/solana/swap/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: mint, amountRaw: String(Math.round(usd * 1e6)), access: "production" }),
      signal,
    });
    if (response.ok) return { ok: true };
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    return { ok: false, code: body?.error?.code ?? `HTTP_${response.status}` };
  } catch {
    return { ok: false, code: signal.aborted ? "ABORTED" : "NETWORK" };
  }
}

/** Whether a sum of dollars routes into the company right now — one read-only quote, asked once the sum settles. */
export function useQuoteRoute(mint: string | null, amountUsd: number | null, enabled: boolean): QuoteRoute {
  const [answer, setAnswer] = useState<Readonly<{ key: string; route: QuoteRoute }> | null>(null);
  const key = enabled && mint && amountUsd !== null && amountUsd > 0 ? `${mint}:${amountUsd}` : null;

  useEffect(() => {
    if (!key || !mint || amountUsd === null) return undefined;
    const known = FOUND.get(mint);
    if (known !== undefined && amountUsd >= known) {
      setAnswer({ key, route: "route" });
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void quoteUsdc(mint, amountUsd, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setAnswer({ key, route: result.ok ? "route" : isNoRoute(result.code) ? "no-route" : "unknown" });
      });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, mint, amountUsd]);

  return answer && answer.key === key ? answer.route : "unknown";
}

/** The company's own minimum once the sum asked has no route; idle otherwise. */
export function useRouteMinimum(mint: string, amountUsd: number | null, noRoute: boolean): RouteMinimum {
  const [found, setFound] = useState<Readonly<{ key: string; value: RouteMinimum }> | null>(null);
  const key = noRoute && amountUsd !== null && amountUsd > 0 ? `${mint}:${amountUsd}` : null;

  useEffect(() => {
    if (!key || amountUsd === null) return undefined;
    const known = FOUND.get(mint);
    if (known !== undefined && known > amountUsd) {
      setFound({ key, value: { state: "found", minimumUsd: known } });
      return undefined;
    }
    const controller = new AbortController();
    setFound({ key, value: { state: "finding", minimumUsd: null } });
    void (async () => {
      for (const step of routeMinimumSteps(amountUsd)) {
        let result = await quoteUsdc(mint, step, controller.signal);
        /* Only «no route» is an answer about the sum. A rate limit or the venue's passing refusal (seen on the stand: a 400 with no code, then a route on the next ask) only holds the answer back, so the same sum is asked again after a pause. */
        for (const pause of ROUTE_MINIMUM_RETRY_MS) {
          if (result.ok || isNoRoute(result.code) || controller.signal.aborted) break;
          await new Promise((resolve) => window.setTimeout(resolve, pause));
          if (controller.signal.aborted) return;
          result = await quoteUsdc(mint, step, controller.signal);
        }
        if (controller.signal.aborted) return;
        if (result.ok) {
          FOUND.set(mint, step);
          setFound({ key, value: { state: "found", minimumUsd: step } });
          return;
        }
        /* Only «no route» is answered by a larger sum; a venue that does not answer claims nothing. */
        if (!isNoRoute(result.code)) break;
      }
      if (!controller.signal.aborted) setFound({ key, value: { state: "none", minimumUsd: null } });
    })();
    return () => controller.abort();
  }, [key, mint, amountUsd]);

  return found && found.key === key ? found.value : key ? { state: "finding", minimumUsd: null } : IDLE;
}
