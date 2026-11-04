import {
  areaOf,
  BAY_REACH,
  bayRect,
  baysOf,
  bayWidth,
  carryFree,
  CITY_SHARE,
  carryRect,
  DEFAULT_SIZE,
  docked,
  fitRect,
  FLOOR,
  GAP,
  gridRects,
  HEAD,
  INSET,
  liftRect,
  MIN,
  moveRect,
  openRect,
  popOutRect,
  resizeBoxes,
  stuck,
  type Bay,
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
 *
 * Since CITY-84 (helm §4) a window stands in one of two bays — the workspace's left and right side, the city in the
 * middle — or floats; windows dropped on each other's head share one frame as tabs (a «stack»). `seat` keeps every
 * layout true to that: one frame per bay, a stack's windows on one place. Whatever the system arranges by itself — a
 * first place, a layout, «Snap together», a stretch, a pop out — leaves the city at least 40 % of the screen
 * (`coverIn`); only the person's own drag and the whole screen may cover more.
 */

export type Placed = Readonly<{
  id: string;
  /** Its place in the workspace; on the whole screen the window keeps it to come back to. */
  rect: Rect;
  min: Size;
  /** The order the windows were opened in: the grid lays them out in it. */
  seq: number;
  /** The bay it stands in, or null while it floats. */
  bay: Bay | null;
  /** Its frame: windows with the same stack stand on one place as tabs, the one in front of them shown. */
  stack: number;
}>;

export type Layout = Readonly<{
  area: Rect;
  /** Bottom to top: the last one is in front and has the keyboard. */
  windows: readonly Placed[];
  /** The window on the whole screen, if one is. */
  full: string | null;
  /** The next window's `seq`, and the next new stack's number. */
  next: number;
  /** The width the person gave each bay; a bay not given one is as wide as it may be. */
  bays: Readonly<Partial<Record<Bay, number>>>;
}>;

/** What a window asks for when it opens. */
export type Ask = Readonly<{ id: string; min?: Partial<Size>; size?: Size }>;
/**
 * A place for a window: remembered by this device (already carried onto the current workspace), planned by a layout,
 * or the first one. `docked` when it stuck to another window or the workspace's edge there, so a smaller screen keeps
 * it stuck rather than at its least; `bay` when it stands in a bay; `tab` — a window it joins as a tab, if that one is
 * open.
 */
export type Recall = Readonly<{ rect: Rect; full: boolean; docked?: boolean; bay?: Bay | null; tab?: string | null }>;

/** Where a dragged window lands when the pointer lets go: in a bay, or as a tab of another window. */
export type Drop = Readonly<{ kind: 'bay'; bay: Bay; rect: Rect } | { kind: 'tab'; id: string; rect: Rect }>;

export function emptyLayout(viewport: Viewport): Layout {
  return { area: areaOf(viewport), windows: [], full: null, next: 0, bays: {} };
}

export const top = (layout: Layout): Placed | null => layout.windows.at(-1) ?? null;
export const placed = (layout: Layout, id: string): Placed | null => layout.windows.find((w) => w.id === id) ?? null;
/** The windows of one stack, bottom to top: the last is the tab in front. */
export const membersOf = (layout: Layout, stack: number): Placed[] => layout.windows.filter((w) => w.stack === stack);
/** The tabs of a window's frame, in the order they joined it; one when it stands alone. */
export const tabsOf = (layout: Layout, id: string): Placed[] => {
  const w = placed(layout, id);
  return w ? membersOf(layout, w.stack).sort((a, b) => a.seq - b.seq) : [];
};
/** The frames on the screen, bottom to top: the tab in front of every stack. */
export function framesIn(layout: Layout): Placed[] {
  const lead = new Map<number, Placed>();
  for (const w of layout.windows) lead.set(w.stack, w);
  return layout.windows.filter((w) => lead.get(w.stack) === w);
}
/** The window shown in a frame: it is the one in front of its stack. */
export const frontOfStack = (layout: Layout, id: string): boolean => {
  const w = placed(layout, id);
  return Boolean(w && membersOf(layout, w.stack).at(-1) === w);
};

const minOf = (ask: Ask): Size => ({ width: Math.max(1, ask.min?.width ?? MIN.width), height: Math.max(1, ask.min?.height ?? MIN.height) });
const right = (r: Rect) => r.x + r.width;
const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function withWindow(layout: Layout, id: string, change: (w: Placed) => Placed): Layout {
  return { ...layout, windows: layout.windows.map((w) => (w.id === id ? change(w) : w)) };
}

function withStack(layout: Layout, stack: number, change: (w: Placed) => Placed): Layout {
  return { ...layout, windows: layout.windows.map((w) => (w.stack === stack ? change(w) : w)) };
}

/** The windows of a stack brought to the top, in their order, with `id` last: it is the tab shown. */
function stackToFront(layout: Layout, id: string, change: (w: Placed) => Placed = (w) => w): Layout {
  const own = placed(layout, id);
  if (!own) return layout;
  const members = membersOf(layout, own.stack);
  const moving = [...members.filter((m) => m.id !== id), own].map(change);
  return { ...layout, windows: [...layout.windows.filter((w) => w.stack !== own.stack), ...moving] };
}

/**
 * The layout made true to its rules: every window of a stack stands where the tab in front of it stands; one frame per
 * bay — a second stack docked in a bay joins the one in front there as tabs; a bay this screen does not have hands its
 * windows to the one it has; a window in a bay stands the workspace's whole height at the bay's width. The same layout
 * back when it already was.
 */
function seat(layout: Layout): Layout {
  const on = baysOf(layout.area);
  const here = (bay: Bay | null): Bay | null => (bay && !on.includes(bay) ? on[0]! : bay);
  const leadOf = new Map<number, Placed>();
  for (const w of layout.windows) leadOf.set(w.stack, w);
  // The stack in front in each bay holds it; any other there joins it.
  const holder = new Map<Bay, number>();
  for (const w of layout.windows) {
    const lead = leadOf.get(w.stack)!;
    const bay = here(lead.bay);
    if (lead === w && bay) holder.set(bay, w.stack);
  }
  const stackOf = (w: Placed): number => {
    const bay = here(leadOf.get(w.stack)!.bay);
    return bay ? holder.get(bay)! : w.stack;
  };
  const leads = new Map<number, Placed>();
  for (const w of layout.windows) leads.set(stackOf(w), w);
  let changed = false;
  const windows = layout.windows.map((w) => {
    const stack = stackOf(w);
    const lead = leads.get(stack)!;
    const bay = here(lead.bay);
    const rect = bay ? bayRect(layout.area, bay, layout.bays[bay]) : lead.rect;
    if (w.stack === stack && w.bay === bay && sameRect(w.rect, rect)) return w;
    changed = true;
    return { ...w, stack, bay, rect };
  });
  const full = layout.full && windows.some((w) => w.id === layout.full) ? layout.full : null;
  if (!changed && full === layout.full) return layout;
  return { ...layout, windows: changed ? windows : layout.windows, full };
}

/** The window comes to the front; the one on the whole screen gives the screen up to it. */
export function raiseIn(layout: Layout, id: string): Layout {
  const w = placed(layout, id);
  if (!w) return layout;
  const full = layout.full && layout.full !== id ? null : layout.full;
  if (top(layout)?.id === id && full === layout.full) return layout;
  return seat({ ...layout, full, windows: [...layout.windows.filter((o) => o.id !== id), w] });
}

/** The bays with no frame in them, the right one first: where a window opens the first time. */
export function freeBaysIn(layout: Layout): Bay[] {
  const taken = new Set(framesIn(layout).map((f) => f.bay));
  return (['right', 'left'] as const).filter((bay) => baysOf(layout.area).includes(bay) && !taken.has(bay));
}

/**
 * Where a window opens the first time (helm §4): in a free bay, the right one first; with both bays taken, as a tab of
 * the bay in front — so the city always keeps its share of the screen — but never over a window a signature holds
 * (`held`): it would go out of sight. Null when no bay can take it.
 */
export function firstPlace(layout: Layout, held: (id: string) => boolean = () => false): Recall | null {
  const free = freeBaysIn(layout)[0];
  if (free) return { rect: bayRect(layout.area, free, layout.bays[free]), full: false, bay: free };
  const front = framesIn(layout)
    .filter((f) => f.bay && !held(f.id))
    .at(-1);
  return front ? { rect: front.rect, full: false, bay: front.bay, tab: front.id } : null;
}

/**
 * Opens a window, or brings it to the front if it is open. A new one stands where it is placed — a tab of a window that
 * is open, a bay, or a remembered place — or near the middle of the workspace, a step from the last new one, no larger
 * than the city's share allows.
 */
export function openIn(layout: Layout, ask: Ask, recall: Recall | null = null): Layout {
  const min = minOf(ask);
  if (placed(layout, ask.id)) return raiseIn(withWindow(layout, ask.id, (w) => ({ ...w, min, rect: w.bay ? w.rect : fitRect(w.rect, layout.area, min) })), ask.id);
  const seq = layout.next;
  const fresh: Placed = { id: ask.id, min, seq, stack: seq, bay: null, rect: layout.area };
  const host = recall?.tab ? placed(layout, recall.tab) : null;
  let win: Placed;
  if (host) win = { ...fresh, stack: host.stack, bay: host.bay, rect: host.rect };
  else if (recall?.bay) win = { ...fresh, bay: recall.bay, rect: bayRect(layout.area, recall.bay, layout.bays[recall.bay]) };
  else if (recall) {
    const rect = fitRect(recall.rect, layout.area, recall.docked ? FLOOR : min);
    // A floating frame on exactly this place: the window was its tab.
    const twin = framesIn(layout).find((f) => !f.bay && sameRect(f.rect, rect));
    win = twin ? { ...fresh, stack: twin.stack, rect } : { ...fresh, rect };
  } else win = { ...fresh, rect: openRect(ask.size ?? DEFAULT_SIZE, min, layout.area, layout.windows.length) };
  const opened = seat({ ...layout, next: seq + 1, windows: [...layout.windows, win], full: recall?.full ? ask.id : layout.full });
  // A window the system places floating (none remembered, no bay to take it) is never larger than the city allows.
  return recall ? opened : shrinkToCover(opened, ask.id, coverIn(layout));
}

export function closeIn(layout: Layout, id: string): Layout {
  if (!placed(layout, id)) return layout;
  return seat({ ...layout, windows: layout.windows.filter((w) => w.id !== id), full: layout.full === id ? null : layout.full });
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

/** Into a bay, the window's every tab with it; a frame already there takes them as tabs. */
export function dockIn(layout: Layout, id: string, bay: Bay): Layout {
  if (!placed(layout, id)) return layout;
  return seat({ ...stackToFront(layout, id, (m) => ({ ...m, bay })), full: null });
}

/** A tab of another window: the window — and every tab it had — joins that frame, where it stands, shown in front. */
export function tabIn(layout: Layout, id: string, target: string): Layout {
  const w = placed(layout, id);
  const t = placed(layout, target);
  if (!w || !t || w.stack === t.stack) return layout;
  const lead = membersOf(layout, t.stack).at(-1)!;
  return seat({ ...stackToFront(layout, id, (m) => ({ ...m, stack: t.stack, bay: lead.bay, rect: lead.rect })), full: null });
}

/** A window out of its bay, floating near it: the bay's width, about three quarters of its height, in the middle. */
function fromBay(rect: Rect, area: Rect, min: Size): Rect {
  const lifted = liftRect(rect, { x: rect.x, y: rect.y }, area, min);
  return fitRect({ ...lifted, y: rect.y + Math.round((rect.height - lifted.height) / 2) }, area, min);
}

/**
 * Picked up from its bay by the head: the window — every tab with it — floats under the pointer at the bay's width, the
 * pointer on the same spot of its head.
 */
export function liftIn(layout: Layout, id: string, at: Readonly<{ x: number; y: number }>): Layout {
  const w = placed(layout, id);
  if (!w || !w.bay) return layout;
  const rect = liftRect(w.rect, at, layout.area, w.min);
  return seat(withStack(layout, w.stack, (m) => ({ ...m, bay: null, rect })));
}

/** The window sticks to another, stands in a bay or shares a frame: «Pop out» has somewhere to take it from. */
export function dockedIn(layout: Layout, id: string): boolean {
  const w = placed(layout, id);
  if (!w) return false;
  if (w.bay || membersOf(layout, w.stack).length > 1) return true;
  return stuckIn(layout, w);
}

/** The window sticks to another frame or to the workspace's edge. */
function stuckIn(layout: Layout, w: Placed): boolean {
  return docked(w.rect, framesIn(layout).filter((o) => o.stack !== w.stack).map((o) => o.rect), layout.area);
}

/**
 * «Pop out»: from the whole screen, out of a seam, out of its bay or out of a frame it shared as a tab, the window
 * floats free again, in front. A window that already floats stays where it is.
 */
export function popOutIn(layout: Layout, id: string): Layout {
  const w = placed(layout, id);
  if (!w) return layout;
  const before = coverIn(exitFullIn(layout));
  const out = popOut(layout, id);
  // Floating free, it is never larger than the city's share allows: smaller, if it must, down to its least.
  return out === layout ? out : shrinkToCover(out, id, before);
}

function popOut(layout: Layout, id: string): Layout {
  const wasFull = layout.full === id;
  const next = raiseIn(wasFull ? exitFullIn(layout) : layout, id);
  const own = placed(next, id)!;
  const others = framesIn(next).filter((o) => o.stack !== own.stack).map((o) => o.rect);
  const tabs = membersOf(next, own.stack).length > 1;
  if (tabs) {
    // Out of the frame: a stack of its own, a step away from the frame it leaves.
    const from = own.bay ? fromBay(own.rect, next.area, own.min) : own.rect;
    const rect = popOutRect(from, [...others, own.rect], next.area, own.min);
    return seat({ ...withWindow(next, id, (o) => ({ ...o, stack: next.next, bay: null, rect })), next: next.next + 1 });
  }
  if (own.bay) {
    const rect = popOutRect(fromBay(own.rect, next.area, own.min), others, next.area, own.min);
    return seat(withStack(next, own.stack, (o) => ({ ...o, bay: null, rect })));
  }
  const free = wasFull || docked(own.rect, others, next.area);
  if (!free) return next;
  return seat(withStack(next, own.stack, (o) => ({ ...o, rect: popOutRect(o.rect, others, next.area, o.min) })));
}

/** Dragged by its head from where it stood at the start of the drag: its frame — every tab — moves, out of any bay. */
export function moveIn(layout: Layout, id: string, start: Rect, dx: number, dy: number): { layout: Layout; guides: Guide[] } {
  const w = placed(layout, id);
  if (!w) return { layout, guides: [] };
  const others = framesIn(layout).filter((o) => o.stack !== w.stack).map((o) => o.rect);
  const moved = moveRect(start, dx, dy, others, layout.area, w.min);
  return { layout: seat(withStack(layout, w.stack, (o) => ({ ...o, rect: moved.rect, bay: null }))), guides: moved.guides };
}

/**
 * Stretched by an edge or a corner from the layout at the start of the drag; the seam behind the edge moves with it. A
 * window in a bay stretches by its inner edge only: the bay grows or narrows, within its narrowest and its cap.
 */
export function resizeIn(start: Layout, id: string, handle: Handle, dx: number, dy: number): { layout: Layout; guides: Guide[] } {
  const own = placed(start, id);
  if (!own) return { layout: start, guides: [] };
  if (own.bay) {
    const inner = own.bay === 'left' ? 'e' : 'w';
    if (!handle.includes(inner)) return { layout: start, guides: [] };
    const width = bayWidth(start.area, own.rect.width + (own.bay === 'left' ? dx : -dx));
    const layout = seat({ ...start, bays: { ...start.bays, [own.bay]: width } });
    const rect = placed(layout, id)!.rect;
    const at = own.bay === 'left' ? right(rect) : rect.x;
    return { layout, guides: [{ axis: 'x', at, from: rect.y, to: rect.y + rect.height }] };
  }
  const frames = framesIn(start).filter((f) => !f.bay);
  const lead = frames.find((f) => f.stack === own.stack);
  if (!lead) return { layout: start, guides: [] };
  const stretch = (t: number) => {
    const { rects, guides } = resizeBoxes(frames, start.area, lead.id, handle, Math.round(dx * t), Math.round(dy * t));
    const stacks = new Map(frames.filter((f) => rects.has(f.id)).map((f) => [f.stack, rects.get(f.id)!]));
    return { layout: seat({ ...start, windows: start.windows.map((w) => (stacks.has(w.stack) ? { ...w, rect: stacks.get(w.stack)! } : w)) }), guides };
  };
  // A frame stretched by hand stops where the windows would cover more of the screen than the city leaves them.
  const most = Math.max(coverLimit, coverIn(start));
  const whole = stretch(1);
  if (coverIn(whole.layout) <= most) return whole;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i += 1) {
    const mid = (lo + hi) / 2;
    if (coverIn(stretch(mid).layout) <= most) lo = mid;
    else hi = mid;
  }
  return stretch(lo);
}

/**
 * The room «Snap together» has: the workspace between the bays that hold a frame, no wider than what the city's share
 * leaves after them, in the middle of that room. Null when there is too little to snap into.
 */
export function gridRoomIn(layout: Layout): Rect | null {
  const area = layout.area;
  const taken = framesIn(layout).filter((f) => f.bay);
  const left = taken.find((f) => f.bay === 'left');
  const rightBay = taken.find((f) => f.bay === 'right');
  const x0 = left ? right(left.rect) + GAP : area.x;
  const x1 = rightBay ? rightBay.rect.x - GAP : right(area);
  const screen = screenOf(area);
  const budget = Math.floor((1 - CITY_SHARE) * screen.width) - taken.reduce((sum, f) => sum + f.rect.width, 0);
  const width = Math.min(x1 - x0, budget);
  if (width < MIN.width) return null;
  return { x: Math.round(x0 + (x1 - x0 - width) / 2), y: area.y, width, height: area.height };
}

/**
 * Every floating frame stuck into one grid in the order they were opened (macet M2), the tabs kept together: in the
 * room between the bays, leaving the city its share. The bays stay as they are; with no room, nothing moves.
 */
export function gridIn(layout: Layout): Layout {
  const room = gridRoomIn(layout);
  if (!room) return layout.full ? { ...layout, full: null } : layout;
  const first = (stack: number) => Math.min(...membersOf(layout, stack).map((m) => m.seq));
  const order = framesIn(layout)
    .filter((f) => !f.bay)
    .sort((a, b) => first(a.stack) - first(b.stack));
  const rects = gridRects(order.length, room);
  const at = new Map(order.map((f, i) => [f.stack, rects[i]!]));
  return seat({ ...layout, full: null, windows: layout.windows.map((w) => (at.has(w.stack) ? { ...w, rect: at.get(w.stack)! } : w)) });
}

/**
 * The screen changed size: every window is carried onto the new workspace. The bays keep the width the person gave
 * them within the new cap; windows that stick grow and shrink with the screen and stay stuck — below their least if the
 * screen is smaller than the layout's leasts, never below the floor — while a floating window keeps its size and stays
 * whole. The store always carries the layout the person last set, never a carried one, so a screen that shrinks and
 * grows back gives the same places.
 */
export function carryIn(layout: Layout, viewport: Viewport): Layout {
  const area = areaOf(viewport);
  const same = area.x === layout.area.x && area.y === layout.area.y && area.width === layout.area.width && area.height === layout.area.height;
  if (same) return layout;
  return seat({
    ...layout,
    area,
    windows: layout.windows.map((w) => {
      if (w.bay) return w;
      const rect = stuckIn(layout, w) ? fitRect(carryRect(w.rect, layout.area, area), area, FLOOR) : carryFree(w.rect, layout.area, area, w.min);
      return { ...w, rect };
    }),
  });
}

/** The frames that float, for the seams and «Snap together»: the bays stand on their own. */
const floating = (layout: Layout) => framesIn(layout).filter((f) => !f.bay);

/** Every floating frame hangs together through its seams: one group, nothing floating apart. */
export function togetherIn(layout: Layout): boolean {
  const list = floating(layout);
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

/** The seams between floating frames that stick, each as the stretch they share, for the small grips drawn on them. */
export function seamsIn(layout: Layout): Guide[] {
  const out: Guide[] = [];
  const list = floating(layout);
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

/** The screen, from its workspace. */
const screenOf = (area: Rect) => ({ width: area.width + INSET.left + INSET.right, height: area.height + INSET.top + INSET.bottom });

/** The most of the screen the windows may cover by the system's own hand: the city keeps the rest (helm §4). */
export const coverLimit = 1 - CITY_SHARE;

/**
 * How much of the screen the frames cover, 0–1: the area of their union (a frame over another counts once). The whole
 * screen, which the person chooses, is not counted.
 */
export function coverIn(layout: Layout): number {
  const rects = framesIn(layout).map((f) => f.rect);
  if (!rects.length) return 0;
  const xs = [...new Set(rects.flatMap((r) => [r.x, right(r)]))].sort((a, b) => a - b);
  let covered = 0;
  for (let i = 0; i + 1 < xs.length; i += 1) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    const spans = rects
      .filter((r) => r.x <= x0 && right(r) >= x1)
      .map((r) => [r.y, r.y + r.height] as const)
      .sort((a, b) => a[0] - b[0]);
    let run = 0;
    let end = -Infinity;
    for (const [y0, y1] of spans) {
      if (y0 > end) {
        run += y1 - y0;
        end = y1;
      } else if (y1 > end) {
        run += y1 - end;
        end = y1;
      }
    }
    covered += run * (x1 - x0);
  }
  const screen = screenOf(layout.area);
  return covered / Math.max(1, screen.width * screen.height);
}

/**
 * A floating frame made smaller, about its middle, until the windows cover no more than the city leaves them (or no
 * more than `before`, when they already did) — never below its least.
 */
function shrinkToCover(layout: Layout, id: string, before: number): Layout {
  const w = placed(layout, id);
  const most = Math.max(coverLimit, before);
  if (!w || w.bay || coverIn(layout) <= most) return layout;
  const from = w.rect;
  const at = (k: number) => {
    const width = Math.max(Math.min(w.min.width, from.width), Math.round(from.width * k));
    const height = Math.max(Math.min(w.min.height, from.height), Math.round(from.height * k));
    const rect = fitRect({ x: from.x + (from.width - width) / 2, y: from.y + (from.height - height) / 2, width, height }, layout.area, w.min);
    return seat(withStack(layout, w.stack, (m) => ({ ...m, rect })));
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i += 1) {
    const mid = (lo + hi) / 2;
    if (coverIn(at(mid)) <= most) lo = mid;
    else hi = mid;
  }
  return at(lo);
}

/** Both bays hold a frame (helm §4): the city steps back — dimmed, and drawn more cheaply. */
export function bothBaysIn(layout: Layout): boolean {
  const on = baysOf(layout.area);
  const frames = framesIn(layout);
  return on.length === 2 && on.every((bay) => frames.some((f) => f.bay === bay));
}

/** The city is mostly behind windows — both bays taken, or one window on the whole screen: it is drawn more cheaply. */
export function leanIn(layout: Layout): boolean {
  return layout.full !== null || bothBaysIn(layout);
}

/**
 * Where a dragged window would land if the pointer let go here: on another frame's head — a tab of it; near the
 * screen's side — that bay, joining the frame there if one stands in it. Null: it floats where it is.
 */
export function dropAt(layout: Layout, id: string, at: Readonly<{ x: number; y: number }>): Drop | null {
  const own = placed(layout, id);
  if (!own) return null;
  const frames = framesIn(layout).filter((f) => f.stack !== own.stack);
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const r = frames[i]!.rect;
    if (at.x >= r.x && at.x <= right(r) && at.y >= r.y && at.y <= r.y + HEAD) return { kind: 'tab', id: frames[i]!.id, rect: r };
  }
  const area = layout.area;
  const on = baysOf(area);
  if (on.includes('left') && at.x <= area.x + BAY_REACH) return { kind: 'bay', bay: 'left', rect: bayRect(area, 'left', layout.bays.left) };
  if (on.includes('right') && at.x >= right(area) - BAY_REACH) return { kind: 'bay', bay: 'right', rect: bayRect(area, 'right', layout.bays.right) };
  return null;
}

/** The pointer let go over a place to land: the window docks in the bay or joins the frame as a tab. */
export function dropIn(layout: Layout, id: string, drop: Drop): Layout {
  return drop.kind === 'bay' ? dockIn(layout, id, drop.bay) : tabIn(layout, id, drop.id);
}

/**
 * An open window placed again, as a layout asks (CITY-84): out of the frame it shared, into its bay, as a tab of another
 * window, or at its place — keeping the order it was opened in.
 */
export function placeIn(layout: Layout, id: string, recall: Recall): Layout {
  const w = placed(layout, id);
  if (!w) return layout;
  const without = seat({ ...layout, windows: layout.windows.filter((o) => o.id !== id), full: layout.full === id ? null : layout.full });
  const back = openIn(without, { id, min: w.min }, recall);
  return { ...back, windows: back.windows.map((o) => (o.id === id ? { ...o, seq: w.seq } : o)) };
}
