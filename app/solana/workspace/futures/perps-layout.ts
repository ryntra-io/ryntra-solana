/**
 * The Perps terminal's panels on the core's terminal (PERP-2): which panels the page has, what each is for the core's
 * presets, and the page's own «Стандарт» — the perpetual's working place, as every serious perps terminal lays it out:
 * the chart wide on the left with the order book beside it, the positions and the orders under both across their width;
 * on the right the order ticket and, under it, the account with its collateral — deposit and withdraw beside the order. Dragging, resizing, splitting, closing, bringing back, the
 * presets and «Повернути стандарт» are the shared terminal's (`@ryntra/core/terminal`).
 *
 * Pure.
 */

import type { BlockSpec, LayoutStore, PageLayout } from "@ryntra/core/ui";

export type PerpsPanelId = "chart" | "book" | "ticket" | "positions" | "orders" | "trades" | "funding" | "history" | "account" | "markets";

/**
 * The bottom dock's tabs in the order the spec puts them (PERP-5, spec §11.1): the positions first where there are
 * any, then the open orders, the trades, the funding and the order history.
 */
export const PERPS_DOCK_TABS: readonly PerpsPanelId[] = Object.freeze(["positions", "orders", "trades", "funding", "history"]);

/**
 * The widths the terminal is laid out for (PERP-6, spec §2): a desk from 1200 px; under it the book turns into a tab
 * beside the chart and the ticket keeps its column («narrow»); under 900 px — a tablet's two columns, the account among
 * the tables and the ticket the whole height; under 768 px — a phone, where the panels stand one under another and an
 * order is made on a screen of its own. The window's width, as the spec measures it; a phone's edge is the core's.
 */
export type PerpsWidth = "desk" | "narrow" | "tablet" | "phone";
export const PERPS_WIDTHS: readonly PerpsWidth[] = Object.freeze(["desk", "narrow", "tablet", "phone"]);
/** The widest window of each class below the desk, in CSS px (`max-width`). */
export const PERPS_WIDTH_MAX: Readonly<Record<Exclude<PerpsWidth, "desk">, number>> = Object.freeze({ narrow: 1199, tablet: 899, phone: 767 });

export function perpsWidthOf(width: number): PerpsWidth {
  if (width <= PERPS_WIDTH_MAX.phone) return "phone";
  if (width <= PERPS_WIDTH_MAX.tablet) return "tablet";
  if (width <= PERPS_WIDTH_MAX.narrow) return "narrow";
  return "desk";
}

/**
 * The page the desk's layout is kept under. `v3` (PERP-6): each width keeps its own arrangement (spec §14, «окремо для
 * desktop/tablet»), so a laptop's narrower window never squeezes the desk's into it; a layout kept under `v2` — one for
 * every width — moves to the desk's once ({@link perpsLayoutStore}).
 */
export const PERPS_LAYOUT_PAGE = "solana/perps.v3";
/** Where the layout lived from 22.10 to PERP-6: read once, to move to the desk's page; never written again. */
export const PERPS_LAYOUT_LEGACY = "solana/perps.v2";

/** The page each width keeps its layout under. */
export function perpsLayoutPage(width: PerpsWidth): string {
  return width === "desk" ? PERPS_LAYOUT_PAGE : `${PERPS_LAYOUT_PAGE}.${width}`;
}

/**
 * Every panel the page has, in the order a list of them reads — and a phone stands them in: the chart, the ticket, the
 * account's tables, then the book. «Торгівля» keeps the chart, the book, the ticket and the
 * positions; «Спокійно» the chart, the ticket and the positions; «Скальп» needs a reference book beside the book —
 * Phoenix has none here, so it stays grey with its reason.
 */
export const PERPS_PANELS: readonly BlockSpec[] = Object.freeze([
  { id: "chart", span: 8, kind: "chart", calm: 8, trading: 8, standard: true },
  { id: "ticket", span: 4, kind: "ticket", calm: 4, trading: 4, standard: true },
  { id: "positions", span: 8, kind: "positions", calm: 8, trading: 8, standard: true },
  { id: "orders", span: 8, standard: true },
  { id: "trades", span: 8, standard: true },
  { id: "funding", span: 8, standard: true },
  { id: "history", span: 8, standard: true },
  { id: "account", span: 4, calm: 4, standard: true },
  { id: "book", span: 4, kind: "book", trading: 4, standard: true },
  { id: "markets", span: 4, standard: false },
]);

export const PERPS_PANEL_IDS: readonly PerpsPanelId[] = PERPS_PANELS.map((panel) => panel.id as PerpsPanelId);

/** The size «Стандарт» is written at; the terminal scales it to the window it opens in. */
const WIDTH = 1400;
const HEIGHT = 820;
/** The narrower widths' «Стандарт» is written at their own size, so the ticket's share gives it its 316 px and more. */
const NARROW_WIDTH = 900;
const TABLET_WIDTH = 760;
/**
 * The shares: the ticket's column; within the rest, the chart over the account's tabs, and the book beside the chart. The
 * core tells a person's arrangement from this one by each share in fiftieths: none sits on a half, where a window's rounding
 * would tip it over and call the start the person's.
 */
const TICKET_COLUMN = 0.28;
const BOOK_SHARE = 0.26;
const TOP_ROW = 0.66;
/** The ticket's share of the right column; the account takes the rest under it. */
const TICKET_ROW = 0.72;

/** Under 1200 px the ticket's column is wider: 316 px and more of a window with the menu beside it. */
const NARROW_TICKET_COLUMN = 0.44;
/** A tablet: the ticket the whole height on the right. */
const TABLET_TICKET_COLUMN = 0.44;

const leaf = (group: string, views: readonly PerpsPanelId[], size: number) => ({ type: "leaf", data: { id: group, views: [...views], activeView: views[0] }, size: Math.round(size) });

const dockPanels = (): Record<string, unknown> => {
  const panels: Record<string, unknown> = {};
  for (const spec of PERPS_PANELS) {
    if (spec.standard === false) continue;
    panels[spec.id] = { id: spec.id, contentComponent: "block", params: { id: spec.id, ...(spec.kind ? { kind: spec.kind } : {}) } };
  }
  return panels;
};

/**
 * The terminal's arrangement of «Стандарт», as the docking library reads it — a row of two columns: on the left the
 * chart with the book beside it, and under both the positions and the orders across their whole width (a positions
 * table needs it); on the right the ticket and the account under it, so collateral is never a tab away from an order.
 */
export function perpsStandardDock(): Record<string, unknown> {
  const left = WIDTH * (1 - TICKET_COLUMN);
  const right = WIDTH * TICKET_COLUMN;
  const top = HEIGHT * TOP_ROW;
  const root = {
    type: "branch",
    size: HEIGHT,
    data: [
      {
        type: "branch",
        size: Math.round(left),
        data: [
          { type: "branch", size: Math.round(top), data: [leaf("g-chart", ["chart"], left * (1 - BOOK_SHARE)), leaf("g-book", ["book"], left * BOOK_SHARE)] },
          leaf("g-trades", [...PERPS_DOCK_TABS], HEIGHT - top),
        ],
      },
      {
        type: "branch",
        size: Math.round(right),
        data: [leaf("g-ticket", ["ticket"], HEIGHT * TICKET_ROW), leaf("g-account", ["account"], HEIGHT * (1 - TICKET_ROW))],
      },
    ],
  };
  return { grid: { root, width: WIDTH, height: HEIGHT, orientation: "HORIZONTAL" }, panels: dockPanels(), activeGroup: "g-chart" };
}

/**
 * «Стандарт» under 1200 px (spec §2): the book is a tab beside the chart, the positions and the orders under them; the
 * ticket keeps its column on the right with the account under it.
 */
export function perpsNarrowDock(): Record<string, unknown> {
  const left = NARROW_WIDTH * (1 - NARROW_TICKET_COLUMN);
  const right = NARROW_WIDTH * NARROW_TICKET_COLUMN;
  const top = HEIGHT * TOP_ROW;
  const root = {
    type: "branch",
    size: HEIGHT,
    data: [
      { type: "branch", size: Math.round(left), data: [leaf("g-chart", ["chart", "book"], top), leaf("g-trades", [...PERPS_DOCK_TABS], HEIGHT - top)] },
      { type: "branch", size: Math.round(right), data: [leaf("g-ticket", ["ticket"], HEIGHT * TICKET_ROW), leaf("g-account", ["account"], HEIGHT * (1 - TICKET_ROW))] },
    ],
  };
  return { grid: { root, width: NARROW_WIDTH, height: HEIGHT, orientation: "HORIZONTAL" }, panels: dockPanels(), activeGroup: "g-chart" };
}

/**
 * «Стандарт» of a tablet, under 900 px (spec §2, «компактне планшетне компонування»): two columns — the chart with the
 * book as its tab over the positions, the orders and the account in tabs; the ticket the whole height on the right.
 */
export function perpsTabletDock(): Record<string, unknown> {
  const left = TABLET_WIDTH * (1 - TABLET_TICKET_COLUMN);
  const right = TABLET_WIDTH * TABLET_TICKET_COLUMN;
  const top = HEIGHT * TOP_ROW;
  const root = {
    type: "branch",
    size: HEIGHT,
    data: [
      { type: "branch", size: Math.round(left), data: [leaf("g-chart", ["chart", "book"], top), leaf("g-trades", [...PERPS_DOCK_TABS, "account"], HEIGHT - top)] },
      leaf("g-ticket", ["ticket"], right),
    ],
  };
  return { grid: { root, width: TABLET_WIDTH, height: HEIGHT, orientation: "HORIZONTAL" }, panels: dockPanels(), activeGroup: "g-chart" };
}

const standardOf = (now: number, dock: Record<string, unknown> | undefined): PageLayout => ({
  v: 1,
  preset: "clean",
  rev: 1,
  blocks: PERPS_PANELS.map((spec) => ({ id: spec.id, span: spec.span, hidden: spec.standard === false })),
  updatedAt: now,
  ...(dock ? { dock } : {}),
});

/** «Стандарт» of the Perps terminal, dated `now`: every panel but «Ринки» (the head's market menu does its work). */
export function perpsStandardLayout(now: number): PageLayout {
  return standardOf(now, perpsStandardDock());
}

/**
 * Each width's «Стандарт». A phone has no arrangement: its panels stand one under another in the order of
 * {@link PERPS_PANELS} — the chart, the order's buttons, the positions, the orders, the account, the book.
 */
export const PERPS_STANDARDS: Readonly<Record<PerpsWidth, (now: number) => PageLayout>> = Object.freeze({
  desk: perpsStandardLayout,
  narrow: (now: number) => standardOf(now, perpsNarrowDock()),
  tablet: (now: number) => standardOf(now, perpsTabletDock()),
  phone: (now: number) => standardOf(now, undefined),
});

/**
 * The layout's store with the move from `v2`: the desk's page, read empty, takes what was kept under `v2` — the
 * person's arrangement, as they left it — and keeps it under `v3` at once, so it moves once. The other widths start
 * from their own «Стандарт»: an arrangement made for a desk is not a tablet's. Nothing is deleted; `v2` is never
 * written again. A store that fails answers null, as the core's own do.
 */
export function perpsLayoutStore(base: LayoutStore): LayoutStore {
  return {
    async read(page) {
      const own = await base.read(page);
      if (own || page !== PERPS_LAYOUT_PAGE) return own;
      const kept = await base.read(PERPS_LAYOUT_LEGACY);
      if (!kept) return null;
      await base.write(PERPS_LAYOUT_PAGE, kept);
      return kept;
    },
    write: (page, layout) => base.write(page, layout),
  };
}
