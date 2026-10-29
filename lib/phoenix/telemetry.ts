/**
 * Perps' telemetry (PERP-4, spec §18 «Сигнали телеметрії»): the moments the spec names, sent through the site's one
 * channel (`sendEvent` → `/api/track`) with nothing about a person — no wallet, no address, no signature, no amount,
 * no price, no order id: the event's name, the market's public symbol and one word of a fixed set saying which kind.
 * The core chart's own health (`ChartTelemetry`: the data's age, gaps) comes in as `market_stream_stale` too.
 *
 * Not sent, on purpose: `wallet_connection_failure` — the wallet's connection is the shell's, not Perps'; and
 * `emergency_stop_triggered` — Perps has no emergency stop yet (the Risk Guardian is PERP-7).
 */

export const PERPS_EVENT_NAMES = [
  "market_stream_stale",
  "order_review_opened",
  "review_invalidated",
  "transaction_signed",
  "tx_confirmed",
  "order_partial_fill",
  "order_filled",
  "order_cancelled",
  "risk_warning_shown",
] as const;

export type PerpsEventName = (typeof PERPS_EVENT_NAMES)[number];

/** The one word of detail an event may carry: which source went quiet, which order kind, which warning. */
export const PERPS_EVENT_KINDS = ["markets", "chart", "book", "open", "reduce", "protect", "cancel", "cancelall", "cancelleg", "aged", "margin", "liquidation", "stale"] as const;
export type PerpsEventKind = (typeof PERPS_EVENT_KINDS)[number];

/** An order's kind as the telemetry's one word: lowercase and from the fixed set, so no ref carries a shape of its own. */
const ORDER_KINDS: Readonly<Record<string, PerpsEventKind>> = Object.freeze({ open: "open", reduce: "reduce", protect: "protect", cancel: "cancel", cancelAll: "cancelall", cancelConditional: "cancelleg" });
export const perpsOrderKind = (kind: string): PerpsEventKind | null => ORDER_KINDS[kind] ?? null;

const SYMBOL = /^[A-Za-z0-9]{1,20}$/;
const NAMES: ReadonlySet<string> = new Set(PERPS_EVENT_NAMES);
const KINDS: ReadonlySet<string> = new Set(PERPS_EVENT_KINDS);

/** The placement every Perps row carries, so the admin reads them apart from the rest of the site's. */
export const PERPS_PLACEMENT = "perps";

/** An event as the page sends it. */
export function perpsEvent(name: PerpsEventName, symbol: string | null, kind: PerpsEventKind | null, locale: "en" | "uk"): Readonly<Record<string, string | null>> {
  return { name, placement: PERPS_PLACEMENT, locale, path: "/app/perps", ref: perpsRef(symbol, kind) };
}

const perpsRef = (symbol: string | null, kind: string | null): string | null => {
  const market = symbol !== null && SYMBOL.test(symbol) ? symbol : null;
  const word = kind !== null && KINDS.has(kind) ? kind : null;
  return market === null && word === null ? null : [market ?? "", word ?? ""].join(":");
};

export const isPerpsEvent = (name: unknown): name is PerpsEventName => typeof name === "string" && NAMES.has(name);

/**
 * The row `/api/track` stores for a Perps event: every field held to its fixed shape, whatever the request carried —
 * a ref that is not «SYMBOL:kind» is dropped, never stored as sent.
 */
export function perpsTrackRow(body: Readonly<Record<string, unknown>>): Readonly<{ name: string; placement: string; locale: string | null; path: string; ref: string | null }> | null {
  if (!isPerpsEvent(body.name)) return null;
  const [symbol, kind] = typeof body.ref === "string" && /^[A-Za-z0-9]{0,20}:[a-z]{0,12}$/.test(body.ref) ? body.ref.split(":") : [null, null];
  return {
    name: body.name,
    placement: PERPS_PLACEMENT,
    locale: body.locale === "en" || body.locale === "uk" ? body.locale : null,
    path: "/app/perps",
    ref: perpsRef(symbol || null, kind || null),
  };
}
