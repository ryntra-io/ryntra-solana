/**
 * The Perps terminal's settings (PERP-6, spec §5 and §14): Simple or Pro, the lines on the chart, the order type a new
 * ticket opens with, and the reader's own needs — the text's size, motion, contrast and larger targets. Kept in this
 * browser beside the layout, apart from any balance or order; nothing here is a key, an amount or a market.
 *
 * Simple and Pro are one terminal with the same data and the same actions at another density (decision 64: depth of
 * the same form, not two exchanges): Simple — the core's regular density, the positions as cards, every target 44 px;
 * Pro — the compact density, the positions as a table.
 *
 * The warnings that keep money from harm are not settings: there is no field to turn them off ({@link PERPS_GUARDS}).
 *
 * Pure.
 */

import type { Density } from "@ryntra/core/ui";

export type PerpsMode = "simple" | "pro";
export type PerpsScale = 100 | 112 | 125;
export type PerpsMotion = "system" | "reduce";
export type PerpsContrast = "standard" | "more";
export type PerpsTargets = "auto" | "large";
export type PerpsOrderType = "market" | "limit";

export interface PerpsChartLines {
  /** The positions' entries, liquidations and TP/SL. */
  readonly positions: boolean;
  /** The open orders' prices. */
  readonly orders: boolean;
  /** What the ticket is setting now: a limit's price and the legs. */
  readonly draft: boolean;
}

export interface PerpsSettings {
  readonly v: 1;
  readonly mode: PerpsMode;
  /** The first switch between Simple and Pro has been explained. */
  readonly explained: boolean;
  readonly lines: PerpsChartLines;
  readonly orderType: PerpsOrderType;
  readonly scale: PerpsScale;
  readonly motion: PerpsMotion;
  readonly contrast: PerpsContrast;
  readonly targets: PerpsTargets;
}

export const PERPS_SETTINGS_KEY = "ryntra.perps.settings.v1";

export const PERPS_MODES: readonly PerpsMode[] = Object.freeze(["simple", "pro"]);
export const PERPS_SCALES: readonly PerpsScale[] = Object.freeze([100, 112, 125]);
export const PERPS_ORDER_TYPES: readonly PerpsOrderType[] = Object.freeze(["market", "limit"]);

/** Pro: the terminal as it stood before PERP-6 — a person who never opens the settings sees nothing move. */
export const DEFAULT_PERPS_SETTINGS: PerpsSettings = Object.freeze({
  v: 1,
  mode: "pro",
  explained: false,
  lines: Object.freeze({ positions: true, orders: true, draft: true }),
  orderType: "market",
  scale: 100,
  motion: "system",
  contrast: "standard",
  targets: "auto",
});

/**
 * The warnings and checks no setting turns off (spec §14, «Не дозволяти вимкнути критичні warning»): shown in
 * «Захист» as switches that stay on, with the reason.
 */
export const PERPS_GUARDS = Object.freeze(["review", "liquidation", "stale", "ceiling"] as const);
export type PerpsGuard = (typeof PERPS_GUARDS)[number];

const one = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

/** Settings read from storage, rebuilt from the known fields alone; anything else — a guard turned off among them — is left behind. */
export function parsePerpsSettings(value: unknown): PerpsSettings {
  const d = DEFAULT_PERPS_SETTINGS;
  if (!value || typeof value !== "object") return d;
  const raw = value as Record<string, unknown>;
  if (raw.v !== 1) return d;
  const lines = raw.lines && typeof raw.lines === "object" ? (raw.lines as Record<string, unknown>) : {};
  return {
    v: 1,
    mode: one(raw.mode, PERPS_MODES, d.mode),
    explained: flag(raw.explained, d.explained),
    lines: { positions: flag(lines.positions, d.lines.positions), orders: flag(lines.orders, d.lines.orders), draft: flag(lines.draft, d.lines.draft) },
    orderType: one(raw.orderType, PERPS_ORDER_TYPES, d.orderType),
    scale: one(raw.scale, PERPS_SCALES, d.scale),
    motion: one(raw.motion, ["system", "reduce"] as const, d.motion),
    contrast: one(raw.contrast, ["standard", "more"] as const, d.contrast),
    targets: one(raw.targets, ["auto", "large"] as const, d.targets),
  };
}

/** The core's density for a mode: Simple — regular, Pro — compact. */
export function densityOf(mode: PerpsMode): Density {
  return mode === "pro" ? "compact" : "regular";
}

/** Whether every control is drawn at 44 px: always in Simple, on a phone, or when the reader asks for it. */
export function largeTargets(settings: Pick<PerpsSettings, "mode" | "targets">, phone: boolean): boolean {
  return settings.mode === "simple" || settings.targets === "large" || phone;
}

/** The narrowest panel the positions' table stands in whole, its TP/SL and its actions included. */
export const CARDS_BELOW = 680;

/**
 * Whether the positions and the orders stand as cards: in Simple, and wherever their panel is too narrow for the table's
 * columns — a table that scrolls aside or cuts its actions off is no way to close a position (spec §15).
 */
export function cardsFor(mode: PerpsMode, panelWidth: number | null): boolean {
  return mode === "simple" || (panelWidth !== null && panelWidth < CARDS_BELOW);
}
