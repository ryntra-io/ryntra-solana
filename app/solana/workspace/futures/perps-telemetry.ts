"use client";

import { useEffect, useRef } from "react";

import { sendEvent } from "@/lib/analytics";
import { perpsEvent, type PerpsEventKind, type PerpsEventName } from "@/lib/phoenix/telemetry";

/** A state that may flap — data gone quiet, a warning shown — is sent at most once per market and kind in this window. */
const QUIET_MS = 5 * 60_000;
const QUIET_NAMES: ReadonlySet<PerpsEventName> = new Set(["market_stream_stale", "risk_warning_shown"]);
const lastSent = new Map<string, number>();

/** Sends one Perps event (`lib/phoenix/telemetry.ts`): the name, the market's symbol, one word of kind — nothing more. */
export function trackPerps(name: PerpsEventName, symbol: string | null, kind: PerpsEventKind | null, locale: "en" | "uk", now: number = Date.now()): boolean {
  if (QUIET_NAMES.has(name)) {
    const key = `${name}:${symbol ?? ""}:${kind ?? ""}`;
    const last = lastSent.get(key);
    if (last !== undefined && now - last < QUIET_MS) return false;
    lastSent.set(key, now);
  }
  sendEvent(perpsEvent(name, symbol, kind, locale));
  return true;
}

/** Sends `name` once each time `on` turns true for this key — a warning shown, a stream gone quiet — never on every render. */
export function useTrackOnce(on: boolean, name: PerpsEventName, symbol: string | null, kind: PerpsEventKind | null, locale: "en" | "uk"): void {
  const sent = useRef<string | null>(null);
  const key = `${name}:${symbol ?? ""}:${kind ?? ""}`;
  useEffect(() => {
    if (!on) {
      if (sent.current === key) sent.current = null;
      return;
    }
    if (sent.current === key) return;
    sent.current = key;
    trackPerps(name, symbol, kind, locale);
  }, [on, key, name, symbol, kind, locale]);
}
