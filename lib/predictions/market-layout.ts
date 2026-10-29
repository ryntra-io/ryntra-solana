/**
 * The market page's panels, the core's «Стандарт» it opens in and the ready
 * layouts it opened in before.
 *
 * The page opens in the core's «Стандарт» — the chart (with the outcome's
 * probability over it) and the ticket beside it on the side the person
 * chose, nothing else — and «Повернути стандарт» leads back there in one act;
 * every other panel comes back from the core's «Додати панель». Moving,
 * resizing, closing and bringing panels back is the shared terminal's; what
 * is here is the product's: which panels the page has, «Стандарт» as this
 * page draws it, whether a layout kept before it is still one the person
 * never arranged by hand, and a layout carried in a link.
 *
 * Before «Стандарт» the page opened in one of three ready layouts —
 * «Стандарт», «Аналітика» and «Моніторинг» of then, every panel shown. A kept
 * layout that is still one of them, at whatever window size and on either
 * side, moves to «Стандарт» once ({@link keptUntouched}); one the person
 * arranged stays theirs.
 *
 * Pure.
 */

import type { BlockSpan, PageLayout } from "@ryntra/core/ui";

import type { TicketSide } from "./preferences.ts";

export type MarketPanelId = "chart" | "ticket" | "ryntra" | "book" | "outcomes" | "rules" | "map" | "prices" | "news";

export type MarketPanelSpec = Readonly<{
  id: MarketPanelId;
  /** Its width in the workspace's twelve columns, where a grid is drawn. */
  span: BlockSpan;
  kind?: "chart" | "book" | "ticket";
}>;

/**
 * In the order a phone stacks them: the ticket first, the act the page exists
 * for, then the chart. «Стандарт» keeps the chart and the ticket — the kinds
 * the core keeps there — and puts the rest under «Додати панель».
 */
export const MARKET_PANELS: readonly MarketPanelSpec[] = Object.freeze([
  { id: "ticket", span: 4, kind: "ticket" },
  { id: "ryntra", span: 4 },
  { id: "chart", span: 8, kind: "chart" },
  { id: "outcomes", span: 8 },
  { id: "rules", span: 6 },
  { id: "map", span: 6 },
  { id: "book", span: 4, kind: "book" },
  { id: "prices", span: 6 },
  { id: "news", span: 6 },
]);

export type ReadyLayoutId = "standard" | "analytics" | "monitoring";

/** The ready layouts the page opened in before «Стандарт», every panel shown in each. */
export const READY_LAYOUTS: readonly ReadyLayoutId[] = Object.freeze(["standard", "analytics", "monitoring"]);

type Leaf = Readonly<{ group: string; views: readonly MarketPanelId[]; share: number }>;
type Column = Readonly<{ share: number; leaves: readonly Leaf[] }>;
type Ready = Readonly<{
  /** Drawn with the ticket's column on the right, the last; the left is the same mirrored. */
  columns: readonly Column[];
  /** The order its blocks were kept in (a phone stacked them so). */
  order: readonly MarketPanelId[];
}>;

/** The ticket's and Ryntra's shares of their column's height in «Стандарт». */
const RYNTRA_UNDER_TICKET = [0.62, 0.38] as const;

const READY: Readonly<Record<ReadyLayoutId, Ready>> = Object.freeze({
  standard: {
    columns: [
      {
        share: 0.7,
        leaves: [
          { group: "g-chart", views: ["chart"], share: 0.56 },
          { group: "g-more", views: ["outcomes", "rules", "map", "book", "prices", "news"], share: 0.44 },
        ],
      },
      {
        share: 0.3,
        leaves: [
          { group: "g-ticket", views: ["ticket"], share: RYNTRA_UNDER_TICKET[0] },
          { group: "g-ryntra", views: ["ryntra"], share: RYNTRA_UNDER_TICKET[1] },
        ],
      },
    ],
    order: ["ticket", "ryntra", "chart", "outcomes", "rules", "map", "book", "prices", "news"],
  },
  analytics: {
    columns: [
      {
        share: 0.42,
        leaves: [
          { group: "g-chart", views: ["chart"], share: 0.52 },
          { group: "g-news", views: ["news", "outcomes"], share: 0.48 },
        ],
      },
      {
        share: 0.28,
        leaves: [
          { group: "g-rules", views: ["rules"], share: 0.56 },
          { group: "g-map", views: ["map", "prices", "book"], share: 0.44 },
        ],
      },
      {
        share: 0.3,
        leaves: [
          { group: "g-ticket", views: ["ticket"], share: 0.5 },
          { group: "g-ryntra", views: ["ryntra"], share: 0.5 },
        ],
      },
    ],
    order: ["ticket", "chart", "rules", "map", "news", "ryntra", "outcomes", "prices", "book"],
  },
  monitoring: {
    columns: [
      {
        share: 0.42,
        leaves: [
          { group: "g-chart", views: ["chart"], share: 0.62 },
          { group: "g-news", views: ["news", "outcomes"], share: 0.38 },
        ],
      },
      {
        share: 0.28,
        leaves: [
          { group: "g-book", views: ["book"], share: 0.58 },
          { group: "g-prices", views: ["prices"], share: 0.42 },
        ],
      },
      {
        share: 0.3,
        leaves: [
          { group: "g-ticket", views: ["ticket"], share: RYNTRA_UNDER_TICKET[0] },
          { group: "g-more", views: ["ryntra", "rules", "map"], share: RYNTRA_UNDER_TICKET[1] },
        ],
      },
    ],
    order: ["ticket", "chart", "book", "prices", "news", "outcomes", "ryntra", "rules", "map"],
  },
});

/** The size the arrangement is written at; the workspace scales it to the window it opens in. */
const WIDTH = 1200;
const HEIGHT = 760;

type Node = Record<string, unknown>;
type LeafNode = Node & { type: "leaf"; data: Record<string, unknown> & { id: string; views: string[] } };
type BranchNode = Node & { type: "branch"; data: Node[] };
type Dock = Record<string, unknown> & { grid: Record<string, unknown> & { root: Node } };

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isLeaf = (node: unknown): node is LeafNode =>
  isObject(node) && node.type === "leaf" && isObject(node.data) && typeof node.data.id === "string" && Array.isArray(node.data.views);
const isBranch = (node: unknown): node is BranchNode => isObject(node) && node.type === "branch" && Array.isArray(node.data);
const isDock = (dock: unknown): dock is Dock => isObject(dock) && isObject(dock.grid) && isObject(dock.grid.root);
const sizeOf = (node: unknown): number => (isObject(node) && typeof node.size === "number" && Number.isFinite(node.size) ? node.size : 0);

function leafNode(group: string, views: readonly string[], size: number): Node {
  return { type: "leaf", data: { id: group, views: [...views], activeView: views[0] }, size: Math.round(size) };
}

function panelEntry(id: string): Record<string, unknown> {
  const kind = MARKET_PANELS.find((spec) => spec.id === id)?.kind;
  return { id, contentComponent: "block", params: { id, ...(kind ? { kind } : {}) } };
}

/**
 * A ready layout for the shown panels, on the given side: a panel left out is
 * not in it, an emptied group goes, and a column of one group stands as that
 * group. Undefined when nothing is shown.
 */
export function readyDock(ready: ReadyLayoutId, shown: readonly string[], side: TicketSide): Record<string, unknown> | undefined {
  const visible = new Set(shown);
  const columns = READY[ready].columns
    .map((column) => {
      const leaves = column.leaves.map((leaf) => ({ leaf, views: leaf.views.filter((id) => visible.has(id)) })).filter((item) => item.views.length > 0);
      return { column, leaves };
    })
    .filter((item) => item.leaves.length > 0);
  if (columns.length === 0) return undefined;

  const shareTotal = columns.reduce((sum, item) => sum + item.column.share, 0);
  const columnNode = (item: (typeof columns)[number], width: number): Node => {
    if (item.leaves.length === 1) {
      const only = item.leaves[0]!;
      return leafNode(only.leaf.group, only.views, width);
    }
    const total = item.leaves.reduce((sum, entry) => sum + entry.leaf.share, 0);
    return { type: "branch", data: item.leaves.map((entry) => leafNode(entry.leaf.group, entry.views, (entry.leaf.share / total) * HEIGHT)), size: Math.round(width) };
  };

  let root: Node;
  let orientation: "HORIZONTAL" | "VERTICAL" = "HORIZONTAL";
  if (columns.length === 1) {
    const only = columns[0]!;
    if (only.leaves.length === 1) {
      root = { type: "branch", data: [columnNode(only, WIDTH)], size: HEIGHT };
    } else {
      // One column of several groups stands as a column: the groups one under another.
      const total = only.leaves.reduce((sum, entry) => sum + entry.leaf.share, 0);
      orientation = "VERTICAL";
      root = { type: "branch", data: only.leaves.map((entry) => leafNode(entry.leaf.group, entry.views, (entry.leaf.share / total) * HEIGHT)), size: WIDTH };
    }
  } else {
    root = { type: "branch", data: columns.map((item) => columnNode(item, (item.column.share / shareTotal) * WIDTH)), size: HEIGHT };
  }

  const panels: Record<string, unknown> = {};
  for (const spec of MARKET_PANELS) if (visible.has(spec.id)) panels[spec.id] = panelEntry(spec.id);
  const chart = visible.has("chart") ? { activeGroup: "g-chart" } : {};
  const dock = { grid: { root, width: WIDTH, height: HEIGHT, orientation }, panels, ...chart };
  return side === "left" ? mirrorDock(dock) : dock;
}

/**
 * The same arrangement left for right: every side-by-side split in reverse
 * order, sizes going with their panels. One above another stays as it is.
 */
export function mirrorDock<T extends Record<string, unknown> | undefined>(dock: T): T {
  if (!isObject(dock) || !isObject(dock.grid)) return dock;
  const flip = (node: unknown, horizontal: boolean): unknown => {
    if (!isObject(node) || node.type !== "branch" || !Array.isArray(node.data)) return node;
    const data = node.data.map((child) => flip(child, !horizontal));
    if (horizontal) data.reverse();
    return { ...node, data };
  };
  const horizontal = dock.grid.orientation !== "VERTICAL";
  return { ...dock, grid: { ...dock.grid, root: flip(dock.grid.root, horizontal) } } as T;
}

/**
 * The side the ticket stands on in an arrangement: which half of the first
 * side-by-side split holds it. Null when the ticket is not in it or stands in
 * the middle.
 */
export function ticketSide(dock: unknown): TicketSide | null {
  if (!isObject(dock) || !isObject(dock.grid)) return null;
  const holds = (node: unknown): boolean => {
    if (!isObject(node)) return false;
    if (node.type === "leaf") return isObject(node.data) && Array.isArray(node.data.views) && node.data.views.includes("ticket");
    return node.type === "branch" && Array.isArray(node.data) && node.data.some(holds);
  };
  const find = (node: unknown, horizontal: boolean): TicketSide | null => {
    if (!isObject(node) || node.type !== "branch" || !Array.isArray(node.data)) return null;
    const index = node.data.findIndex(holds);
    if (index < 0) return null;
    if (!horizontal) return find(node.data[index], true);
    const middle = (node.data.length - 1) / 2;
    if (index === middle) return find(node.data[index], false);
    return index < middle ? "left" : "right";
  };
  return find(dock.grid.root, dock.grid.orientation !== "VERTICAL");
}

/* ── «Стандарт» ── */

/** What «Стандарт» shows: the chart and the ticket. */
export const CLEAN_PANELS: readonly MarketPanelId[] = Object.freeze(["chart", "ticket"]);

/**
 * The page's «Стандарт» at `now`: the chart and, beside it, the ticket in a
 * narrower column on the side the person chose — the rest put away, each in
 * its place for when it comes back. Kept under the core's rule of starts, so
 * it never moves again.
 */
export function cleanMarketLayout(side: TicketSide, now = 0): PageLayout {
  const shown = new Set<string>(CLEAN_PANELS);
  const dock = readyDock("standard", CLEAN_PANELS, side);
  return {
    v: 1,
    preset: "clean",
    blocks: MARKET_PANELS.map((spec) => ({ id: spec.id, span: spec.span, hidden: !shown.has(spec.id) })),
    updatedAt: now,
    rev: 1,
    ...(dock ? { dock } : {}),
  };
}

type Shape = Readonly<{ panels: readonly string[] }> | Readonly<{ parts: readonly Readonly<{ share: number; shape: Shape }>[] }>;

/**
 * An arrangement without its window: each split's parts as fiftieths of it, a
 * split of one part as that part, the panels of a group in their order — not
 * which tab is in front. Null for anything else.
 */
function shapeOf(node: unknown): Shape | null {
  if (isLeaf(node)) return { panels: node.data.views };
  if (!isBranch(node) || node.data.length === 0) return null;
  if (node.data.length === 1) return shapeOf(node.data[0]);
  const total = node.data.reduce((sum, child) => sum + sizeOf(child), 0) || 1;
  const parts = node.data.map((child) => ({ share: (sizeOf(child) / total) * 50, shape: shapeOf(child) }));
  return parts.every((part) => part.shape) ? { parts: parts as { share: number; shape: Shape }[] } : null;
}

function sameShape(a: Shape | null, b: Shape | null): boolean {
  if (!a || !b) return false;
  if ("panels" in a || "panels" in b) return "panels" in a && "panels" in b && a.panels.join(" ") === b.panels.join(" ");
  return a.parts.length === b.parts.length && a.parts.every((part, index) => Math.abs(part.share - b.parts[index]!.share) <= 1 && sameShape(part.shape, b.parts[index]!.shape));
}

/** The direction of the root's split, as the library reads it: one part of a split stands as that part, turned. */
function rootShape(dock: unknown): Readonly<{ shape: Shape | null; across: boolean }> | null {
  if (!isDock(dock)) return null;
  let node: unknown = dock.grid.root;
  let horizontal = dock.grid.orientation !== "VERTICAL";
  while (isBranch(node) && node.data.length === 1) {
    node = node.data[0];
    horizontal = !horizontal;
  }
  return { shape: shapeOf(node), across: horizontal };
}

/**
 * Whether a layout kept before «Стандарт» was the start is still a ready
 * layout of then, as it opened: every panel shown in the order it kept them,
 * no step back out of a preset, and its arrangement that ready layout on
 * either side —
 * the same panels in the same groups and splits, each border within a
 * fiftieth of where it started, whichever tab is in front and at whatever
 * window size. Such a layout moves to «Стандарт» once; anything else is the
 * person's and stays.
 */
export function keptUntouched(saved: PageLayout): boolean {
  if (saved.rev !== undefined || saved.before || saved.preset !== "dense") return false;
  const known = new Set<string>(MARKET_PANELS.map((spec) => spec.id));
  const kept = saved.blocks.filter((block) => known.has(block.id));
  if (kept.length !== known.size || kept.some((block) => block.hidden)) return false;
  const order = kept.map((block) => block.id).join(" ");
  // An older copy without an arrangement opened in «Стандарт» of then, laid out by the page.
  if (saved.dock === undefined) return order === READY.standard.order.join(" ");
  const mine = rootShape(saved.dock);
  if (!mine?.shape) return false;
  return READY_LAYOUTS.some((ready) =>
    order === READY[ready].order.join(" ") &&
    (["right", "left"] as const).some((side) => {
      const theirs = rootShape(readyDock(ready, [...known], side));
      return !!theirs && theirs.across === mine.across && sameShape(theirs.shape, mine.shape);
    }),
  );
}

/**
 * Whether a kept layout is the page's «Стандарт» — on the given side, or on
 * either: the chart and the ticket only, side by side as «Стандарт» lays
 * them out.
 */
export function isCleanStandard(saved: PageLayout, only?: TicketSide): boolean {
  if (saved.preset !== "clean" || saved.before) return false;
  const shown = saved.blocks.filter((block) => !block.hidden).map((block) => block.id);
  if (shown.length !== CLEAN_PANELS.length || !CLEAN_PANELS.every((id) => shown.includes(id))) return false;
  if (saved.dock === undefined) return true;
  const mine = rootShape(saved.dock);
  if (!mine?.shape) return false;
  return (only ? [only] : (["right", "left"] as const)).some((side) => {
    const theirs = rootShape(cleanMarketLayout(side).dock);
    return !!theirs && theirs.across === mine.across && sameShape(theirs.shape, mine.shape);
  });
}

/** A kept copy that holds an arrangement of the person's: not a ready layout of before, not «Стандарт». */
export function arrangedByHand(saved: PageLayout | null): saved is PageLayout {
  return !!saved && !keptUntouched(saved) && !isCleanStandard(saved);
}

/**
 * The layout the market page opens with, from what is kept: the copy of the
 * person's page if they arranged it by hand; with nothing of theirs on it
 * (nothing kept, or a ready layout of before), the latest they arranged in
 * one of their other layouts of before — there is no way to switch to those
 * any more, and nothing arranged by hand is left out of reach; else nothing
 * — «Стандарт», on the side they chose. A copy kept before the side was last
 * chosen, its ticket on the other side, opens mirrored; a ticket dragged
 * across after it stays where the person put it.
 */
export function chooseKept(
  own: PageLayout | null,
  others: readonly (PageLayout | null)[],
  side: TicketSide,
  sideChosenAt: number,
): PageLayout | null {
  // «Стандарт» on the side chosen, or on the other one kept before it was chosen, holds nothing of the person's; one the
  // person turned by dragging the ticket across after choosing is theirs, as is anything else they arranged here.
  if (own && isCleanStandard(own) && (isCleanStandard(own, side) || own.updatedAt < sideChosenAt)) return null;
  // Only with nothing of theirs on this page: what they arranged in another layout of before.
  const pick =
    own && !keptUntouched(own)
      ? own
      : others.filter(arrangedByHand).reduce<PageLayout | null>((latest, layout) => (!latest || layout.updatedAt > latest.updatedAt ? layout : latest), null);
  if (!pick?.dock) return pick;
  const stands = ticketSide(pick.dock);
  return stands && stands !== side && pick.updatedAt < sideChosenAt ? { ...pick, dock: mirrorDock(pick.dock) } : pick;
}

/* ── A layout in a link ── */

const CODE = /^[A-Za-z0-9_-]{1,8000}$/;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(code: string): string {
  const binary = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * A layout for a link: its arrangement and which panels are shown, not when
 * it was changed and not the step back out of a preset.
 */
export function encodeSharedLayout(layout: Readonly<Record<string, unknown>>): string {
  const { before: _before, updatedAt: _updatedAt, ...shape } = layout;
  return toBase64Url(JSON.stringify({ ...shape, updatedAt: 0 }));
}

/** The layout a link carries, as plain data for the workspace's parser; null when it is not one. */
export function decodeSharedLayout(code: string | null | undefined): Record<string, unknown> | null {
  if (!code || !CODE.test(code)) return null;
  try {
    const value = JSON.parse(fromBase64Url(code));
    return isObject(value) && value.v === 1 ? value : null;
  } catch {
    return null;
  }
}
