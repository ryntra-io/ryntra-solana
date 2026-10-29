"use client";

import "@ryntra/core/chart/compact.css";

import { useMemo } from "react";
import type { DataStatus } from "@ryntra/core/adapters";
import { Sparkline } from "@ryntra/core/chart/compact";
import { priceText } from "@/lib/spot/tape";
import type { HeroPoint } from "./live-market";

/** The hero series' own state, as `hero-stage.tsx` keeps it. */
export type HeroSeriesStatus = "sample" | "live" | "stale";

/** The hero's state as the core's compact chart reads it: a sample is `demo`, never dressed as a market. */
function statusOf(status: HeroSeriesStatus, observedAt: number | null): DataStatus {
  const now = Date.now();
  const at = Math.min(now, observedAt ?? now);
  return {
    state: status === "sample" ? "demo" : status,
    market: "open",
    source: { id: "arcus", label: "Arcus", rights: "display", attribution: null },
    at,
    gateway_at: now,
    age_ms: Math.max(0, now - at),
    delay_ms: null,
    derived: false,
  };
}

/**
 * The hero's base plane: the real Arcus spot market for the token you can swap
 * today, drawn with the core's compact chart (`@ryntra/core/chart/compact`,
 * SOL-T4 — Ryntra draws no chart of anyone else's) so the landing shows the
 * product rather than a picture of it.
 *
 * Our own SVG: the server renders it whole, no chart bundle waits for
 * hydration, and nothing on it captures the page's scroll. The card above it
 * already says whether the numbers are live, stale or a sample, so the chart
 * prints no status line of its own; the accent is the hero's.
 */
export function HeroChart({
  points,
  status = "sample",
  observedAt = null,
  accent = "#ff5a1f",
}: {
  points: readonly HeroPoint[];
  status?: HeroSeriesStatus;
  observedAt?: number | null;
  accent?: string;
}) {
  const series = useMemo(() => points.map((point) => ({ t: point.time * 1000, v: priceText(point.value) })), [points]);
  const data = useMemo(() => statusOf(status, observedAt), [status, observedAt]);
  return (
    <div className="lp3-chart-canvas" style={{ ["--hero-accent" as string]: accent }} aria-hidden>
      <Sparkline points={series} status={data} label="Spot market, hourly" lang="en" caption="none" />
    </div>
  );
}
