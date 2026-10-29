/**
 * Spot's panels on the core's terminal (B16, decision 61). A desk opens on the core's «Стандарт» (A15; SOL-C11, decision
 * 63): the chart and the ticket — the kinds the core keeps there — and the rest under «Додати панель». Dragging,
 * splitting, resizing, closing, bringing back, the presets and «Повернути стандарт» are the shared terminal's
 * (`@ryntra/core/terminal`); what is here is the product's: which panels the page has and what each is for the presets.
 *
 * Before «Стандарт» the desk opened on «Щільно» as this page laid it out ({@link denseSpotDock}): a layout kept then and
 * never arranged by hand is told by {@link spotDockUntouched}, so it too opens in «Стандарт» once.
 *
 * Pure.
 */

import type { BlockSpec, PageLayout } from "@ryntra/core/ui";

export type SpotPanelId = "chart" | "ticket" | "about" | "trades" | "holders" | "pools" | "risk" | "analytics" | "orders" | "position" | "history";

/** The page the layout is kept under. */
export const SPOT_LAYOUT_PAGE = "solana/spot";

/**
 * Every panel the page has, in the order a list of them reads. «Спокійно» keeps the chart, the ticket, the position, the
 * trades and «Про токен»; «Торгівля» the chart, the ticket and the position — the kinds the core keeps there. «Скальп»
 * needs an order book and a reference book beside it: a swap routed by Jupiter has no book, so it stays grey with its
 * reason.
 */
export const SPOT_PANELS: readonly BlockSpec[] = Object.freeze([
  { id: "chart", span: 8, kind: "chart", calm: 8, trading: 8 },
  { id: "ticket", span: 4, kind: "ticket", calm: 4, trading: 4 },
  { id: "position", span: 8, kind: "positions", calm: 8, trading: 8 },
  { id: "orders", span: 8 },
  { id: "history", span: 8 },
  { id: "trades", span: 8, calm: 8 },
  { id: "holders", span: 8 },
  { id: "pools", span: 8 },
  { id: "risk", span: 8 },
  { id: "analytics", span: 8 },
  { id: "about", span: 4, calm: 4 },
]);

export const SPOT_PANEL_IDS: readonly SpotPanelId[] = SPOT_PANELS.map((panel) => panel.id as SpotPanelId);

type Leaf = Readonly<{ group: string; views: readonly SpotPanelId[]; share: number }>;
type Row = Readonly<{ share: number; leaves: readonly Leaf[] }>;
type Column = Readonly<{ share: number; rows: readonly Row[] }>;

/**
 * «Щільно» as the desk opened on it before «Стандарт». The left column: the chart, then the bottom row — the market's
 * tabs and, beside them, the account's. The right column: the ticket the whole height, with «Про токен» a tab beside
 * it. Shares of the terminal; the window scales them.
 */
const DENSE: readonly Column[] = [
  {
    share: 0.72,
    rows: [
      { share: 0.64, leaves: [{ group: "g-chart", views: ["chart"], share: 1 }] },
      {
        share: 0.36,
        leaves: [
          { group: "g-market", views: ["trades", "holders", "pools", "risk", "analytics"], share: 0.5 },
          { group: "g-account", views: ["orders", "position", "history"], share: 0.5 },
        ],
      },
    ],
  },
  {
    share: 0.28,
    rows: [
      { share: 1, leaves: [{ group: "g-ticket", views: ["ticket", "about"], share: 1 }] },
    ],
  },
];

/** The size the arrangement is written at; the terminal scales it to the window it opens in. */
const WIDTH = 1400;
const HEIGHT = 780;

type Node = Record<string, unknown>;

const leafNode = (leaf: Leaf, views: readonly SpotPanelId[], size: number): Node => ({
  type: "leaf",
  data: { id: leaf.group, views: [...views], activeView: views[0] },
  size: Math.round(size),
});

/**
 * A list of children along one axis, as a branch of them. `collapse`: one child stands as itself — only where the child
 * is a group, so no branch ever lands where the axis would turn the other way.
 */
function along(children: readonly { node: Node; share: number }[], across: number, length: number, collapse: boolean): Node {
  const total = children.reduce((sum, child) => sum + child.share, 0);
  const sized = children.map((child) => ({ ...child.node, size: Math.round((child.share / total) * length) }));
  if (collapse && sized.length === 1) return { ...sized[0], size: Math.round(across) };
  return { type: "branch", data: sized, size: Math.round(across) };
}

/**
 * The old «Щільно» for the panels shown: a panel left out is not in it, an emptied group, row or column goes. Undefined
 * when nothing is shown.
 */
export function denseSpotDock(shown: readonly string[]): Record<string, unknown> | undefined {
  const visible = new Set(shown);
  const columns = DENSE.map((column) => ({
    share: column.share,
    rows: column.rows
      .map((row) => ({ share: row.share, leaves: row.leaves.map((leaf) => ({ leaf, views: leaf.views.filter((id) => visible.has(id)) })).filter((item) => item.views.length > 0) }))
      .filter((row) => row.leaves.length > 0),
  })).filter((column) => column.rows.length > 0);
  if (columns.length === 0) return undefined;

  const columnShare = columns.reduce((sum, column) => sum + column.share, 0);
  // The root is a row of columns; each column a stack of rows; each row a row of groups.
  const columnNodes = columns.map((column) => {
    const width = (column.share / columnShare) * WIDTH;
    const rowShare = column.rows.reduce((sum, row) => sum + row.share, 0);
    const rows = column.rows.map((row) => {
      const height = (row.share / rowShare) * HEIGHT;
      const groups = row.leaves.map((item) => ({ node: leafNode(item.leaf, item.views, 0), share: item.leaf.share }));
      return { node: along(groups, height, width, true), share: row.share };
    });
    return { node: along(rows, width, HEIGHT, false), share: column.share };
  });
  // The root is always a row of columns (side by side), each column always a stack: the axes alternate as they should.
  const root = along(columnNodes, HEIGHT, WIDTH, false);
  const orientation = "HORIZONTAL";

  const panels: Record<string, unknown> = {};
  for (const spec of SPOT_PANELS) {
    if (!visible.has(spec.id)) continue;
    panels[spec.id] = { id: spec.id, contentComponent: "block", params: { id: spec.id, ...(spec.kind ? { kind: spec.kind } : {}) } };
  }
  return { grid: { root, width: WIDTH, height: HEIGHT, orientation }, panels, ...(visible.has("chart") ? { activeGroup: "g-chart" } : {}) };
}

/** The old «Щільно» with every panel shown, dated `now`: what a desk opened on before «Стандарт». */
export function denseSpotLayout(now: number): PageLayout {
  const dock = denseSpotDock(SPOT_PANEL_IDS);
  return { v: 1, preset: "dense", blocks: SPOT_PANELS.map((spec) => ({ id: spec.id, span: spec.span, hidden: false })), updatedAt: now, ...(dock ? { dock } : {}) };
}

type Shape = Readonly<{ panels: readonly string[] }> | Readonly<{ parts: readonly Readonly<{ share: number; shape: Shape }>[] }>;

/**
 * An arrangement without its window: each split's parts as fiftieths of their parent, a split of one part as that part,
 * the panels of a group in their order — not which tab is open. Null for anything else.
 */
function shapeOf(value: unknown): Shape | null {
  if (!value || typeof value !== "object") return null;
  const node = value as { type?: unknown; data?: unknown; size?: unknown };
  if (node.type === "leaf") {
    const views = (node.data as { views?: unknown } | undefined)?.views;
    return Array.isArray(views) ? { panels: views.map(String) } : null;
  }
  if (node.type !== "branch" || !Array.isArray(node.data) || node.data.length === 0) return null;
  if (node.data.length === 1) return shapeOf(node.data[0]);
  const sizeOf = (child: unknown) => Number((child as { size?: unknown } | null)?.size) || 0;
  const total = node.data.reduce((sum: number, child: unknown) => sum + sizeOf(child), 0) || 1;
  const parts = node.data.map((child: unknown) => ({ share: (sizeOf(child) / total) * 50, shape: shapeOf(child) }));
  return parts.every((part) => part.shape) ? { parts: parts as { share: number; shape: Shape }[] } : null;
}

function sameShape(a: Shape | null, b: Shape | null): boolean {
  if (!a || !b) return false;
  if ("panels" in a || "panels" in b) return "panels" in a && "panels" in b && a.panels.join(" ") === b.panels.join(" ");
  return a.parts.length === b.parts.length && a.parts.every((part, index) => Math.abs(part.share - b.parts[index].share) <= 1 && sameShape(part.shape, b.parts[index].shape));
}

/**
 * Whether a kept arrangement is still the old «Щільно» this page laid out — the same panels in the same groups and
 * splits, each border within a fiftieth of where it started, whichever tab is open and at whatever window size: then
 * the person never arranged it, and the core moves the layout to «Стандарт» once (`dockUntouched`). Anything else is
 * the person's and stays.
 */
export function spotDockUntouched(saved: PageLayout): boolean {
  const grid = (dock: unknown) => ((dock as { grid?: { root?: unknown; orientation?: unknown } } | undefined)?.grid ?? {});
  const kept = grid(saved.dock);
  const dense = grid(denseSpotDock(SPOT_PANEL_IDS));
  return kept.orientation === dense.orientation && sameShape(shapeOf(kept.root), shapeOf(dense.root));
}
