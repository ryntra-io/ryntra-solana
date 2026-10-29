import {
  areaOf,
  carryFree,
  carryRect,
  DEFAULT_SIZE,
  docked,
  fitRect,
  FLOOR,
  GAP,
  gridRects,
  MIN,
  moveRect,
  openRect,
  popOutRect,
  resizeBoxes,
  stuck,
  type Guide,
  type Handle,
  type Rect,
  type Size,
  type Viewport,
} from './geometry.ts';

/**
 * The open windows of the city as one plain value (CITY-65): where each stands, which one is on the whole screen,
 * which one is on top. The store (`store.ts`) keeps it and the frames draw it; every change is a function here, so
 * the rules are tested without a page (`layout.test.mjs`).
 */

export type Placed = Readonly<{
  id: string;
  /** Its place in the workspace; on the whole screen the window keeps it to come back to. */
  rect: Rect;
  min: Size;
  /** The order the windows were opened in: the grid lays them out in it. */
  seq: number;
}>;

export type Layout = Readonly<{
  area: Rect;
  /** Bottom to top: the last one is in front and has the keyboard. */
  windows: readonly Placed[];
  /** The window on the whole screen, if one is. */
  full: string | null;
  /** The next window's `seq`. */
  next: number;
}>;

/** What a window asks for when it opens. */
export type Ask = Readonly<{ id: string; min?: Partial<Size>; size?: Size }>;
/**
 * A place this device remembers for the window, already carried onto the current workspace; `docked` when it stuck
 * to another window or the workspace's edge there, so a smaller screen keeps it stuck rather than at its least.
 */
export type Recall = Readonly<{ rect: Rect; full: boolean; docked?: boolean }>;

export function emptyLayout(viewport: Viewport): Layout {
  return { area: areaOf(viewport), windows: [], full: null, next: 0 };
}

export const top = (layout: Layout): Placed | null => layout.windows.at(-1) ?? null;
export const placed = (layout: Layout, id: string): Placed | null => layout.windows.find((w) => w.id === id) ?? null;

const minOf = (ask: Ask): Size => ({ width: Math.max(1, ask.min?.width ?? MIN.width), height: Math.max(1, ask.min?.height ?? MIN.height) });

function withWindow(layout: Layout, id: string, change: (w: Placed) => Placed): Layout {
  return { ...layout, windows: layout.windows.map((w) => (w.id === id ? change(w) : w)) };
}

/** The window comes to the front; the one on the whole screen gives the screen up to it. */
export function raiseIn(layout: Layout, id: string): Layout {
  const w = placed(layout, id);
  if (!w) return layout;
  const full = layout.full && layout.full !== id ? null : layout.full;
  if (top(layout)?.id === id && full === layout.full) return layout;
  return { ...layout, full, windows: [...layout.windows.filter((o) => o.id !== id), w] };
}

/**
 * Opens a window, or brings it to the front if it is open. It stands where this device remembers it, or near the
 * middle of the workspace, a step from the last new one.
 */
export function openIn(layout: Layout, ask: Ask, recall: Recall | null = null): Layout {
  const min = minOf(ask);
  if (placed(layout, ask.id)) return raiseIn(withWindow(layout, ask.id, (w) => ({ ...w, min, rect: fitRect(w.rect, layout.area, min) })), ask.id);
  const rect = recall
    ? fitRect(recall.rect, layout.area, recall.docked ? FLOOR : min)
    : openRect(ask.size ?? DEFAULT_SIZE, min, layout.area, layout.windows.length);
  const win: Placed = { id: ask.id, rect, min, seq: layout.next };
  return { ...layout, next: layout.next + 1, windows: [...layout.windows, win], full: recall?.full ? ask.id : layout.full };
}

export function closeIn(layout: Layout, id: string): Layout {
  if (!placed(layout, id)) return layout;
  return { ...layout, windows: layout.windows.filter((w) => w.id !== id), full: layout.full === id ? null : layout.full };
}

/** On the whole screen (macet M3). One at a time: another window there gives it back. */
export function fullIn(layout: Layout, id: string): Layout {
  if (!placed(layout, id)) return layout;
  return { ...raiseIn(layout, id), full: id };
}

/** Back from the whole screen to the window's own place, which it kept. */
export function exitFullIn(layout: Layout): Layout {
  return layout.full ? { ...layout, full: null } : layout;
}

/** The window sticks to another or to the workspace's edge: «Pop out» has somewhere to take it from. */
export function dockedIn(layout: Layout, id: string): boolean {
  const w = placed(layout, id);
  if (!w) return false;
  return docked(w.rect, layout.windows.filter((o) => o.id !== w.id).map((o) => o.rect), layout.area);
}

/**
 * «Pop out»: from the whole screen or out of a seam, the window floats free again, in front. A window that already
 * floats stays where it is.
 */
export function popOutIn(layout: Layout, id: string): Layout {
  const w = placed(layout, id);
  if (!w) return layout;
  const others = layout.windows.filter((o) => o.id !== id).map((o) => o.rect);
  const wasFull = layout.full === id;
  const free = wasFull || docked(w.rect, others, layout.area);
  const next = raiseIn(wasFull ? exitFullIn(layout) : layout, id);
  if (!free) return next;
  return withWindow(next, id, (o) => ({ ...o, rect: popOutRect(o.rect, others, layout.area, o.min) }));
}

/** Dragged by its head from where it stood at the start of the drag. */
export function moveIn(layout: Layout, id: string, start: Rect, dx: number, dy: number): { layout: Layout; guides: Guide[] } {
  const w = placed(layout, id);
  if (!w) return { layout, guides: [] };
  const others = layout.windows.filter((o) => o.id !== id).map((o) => o.rect);
  const moved = moveRect(start, dx, dy, others, layout.area, w.min);
  return { layout: withWindow(layout, id, (o) => ({ ...o, rect: moved.rect })), guides: moved.guides };
}

/** Stretched by an edge or a corner from the layout at the start of the drag; the seam behind the edge moves with it. */
export function resizeIn(start: Layout, id: string, handle: Handle, dx: number, dy: number): { layout: Layout; guides: Guide[] } {
  if (!placed(start, id)) return { layout: start, guides: [] };
  const { rects, guides } = resizeBoxes(start.windows, start.area, id, handle, dx, dy);
  return { layout: { ...start, windows: start.windows.map((w) => (rects.has(w.id) ? { ...w, rect: rects.get(w.id)! } : w)) }, guides };
}

/** Every open window stuck into one grid over the workspace, in the order they were opened (macet M2). */
export function gridIn(layout: Layout): Layout {
  const order = [...layout.windows].sort((a, b) => a.seq - b.seq);
  const rects = gridRects(order.length, layout.area);
  const at = new Map(order.map((w, i) => [w.id, rects[i]!]));
  return { ...layout, full: null, windows: layout.windows.map((w) => ({ ...w, rect: at.get(w.id)! })) };
}

/**
 * The screen changed size: every window is carried onto the new workspace. Windows that stick grow and shrink with it
 * and stay stuck — below their least if the screen is smaller than the layout's leasts, never below the floor —
 * while a floating window keeps its size and stays whole. The store always carries the layout the person last set,
 * never a carried one, so a screen that shrinks and grows back gives the same places.
 */
export function carryIn(layout: Layout, viewport: Viewport): Layout {
  const area = areaOf(viewport);
  const same = area.x === layout.area.x && area.y === layout.area.y && area.width === layout.area.width && area.height === layout.area.height;
  if (same) return layout;
  return {
    ...layout,
    area,
    windows: layout.windows.map((w) => {
      const stuckHere = dockedIn(layout, w.id);
      const rect = stuckHere ? fitRect(carryRect(w.rect, layout.area, area), area, FLOOR) : carryFree(w.rect, layout.area, area, w.min);
      return { ...w, rect };
    }),
  };
}

/** Every open window hangs together through its seams: one group, nothing floating apart. */
export function togetherIn(layout: Layout): boolean {
  const list = layout.windows;
  if (list.length <= 1) return true;
  const reached = new Set([list[0]!.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const w of list) {
      if (reached.has(w.id)) continue;
      if (list.some((o) => reached.has(o.id) && stuck(o.rect, w.rect))) {
        reached.add(w.id);
        grew = true;
      }
    }
  }
  return reached.size === list.length;
}

/** The seams between windows that stick, each as the stretch they share, for the small grips drawn on them. */
export function seamsIn(layout: Layout): Guide[] {
  const out: Guide[] = [];
  const list = layout.windows;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i]!.rect;
      const b = list[j]!.rect;
      if (!stuck(a, b)) continue;
      const [left, right] = a.x < b.x ? [a, b] : [b, a];
      const lower = a.y < b.y ? b : a;
      if (left.x + left.width + GAP === right.x) {
        out.push({ axis: 'x', at: right.x - GAP / 2, from: Math.max(a.y, b.y), to: Math.min(a.y + a.height, b.y + b.height) });
      } else {
        out.push({ axis: 'y', at: lower.y - GAP / 2, from: Math.max(a.x, b.x), to: Math.min(a.x + a.width, b.x + b.width) });
      }
    }
  }
  return out;
}
