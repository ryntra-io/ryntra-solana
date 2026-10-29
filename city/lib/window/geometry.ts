/**
 * The city's windows on a computer, as geometry (CITY-65). Every window — the swap, the spot, the chart, the futures,
 * the money — is a rectangle inside the workspace: the screen under the top bar and above the dock. Dragged near
 * another window or the workspace's edge, a window sticks to it; two windows that stick leave a thin seam between them,
 * and pulling that seam stretches one and shrinks the other. Nothing here draws or touches the page: safe anywhere,
 * tested by `geometry.test.mjs`.
 */

export type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type Size = Readonly<{ width: number; height: number }>;
export type Viewport = Size;
export type Side = 'n' | 's' | 'e' | 'w';
/** What the pointer holds: one of the four edges or one of the four corners. */
export type Handle = Side | 'ne' | 'nw' | 'se' | 'sw';
/**
 * An orange line on the screen while a window is dragged: `axis: 'x'` is an upright line at `x = at` from `from` to
 * `to` down the screen, `axis: 'y'` a level one at `y = at` from `from` to `to` across it.
 */
export type Guide = Readonly<{ axis: 'x' | 'y'; at: number; from: number; to: number }>;
/** A window as the geometry sees it: where it stands and the least it may shrink to. */
export type Box = Readonly<{ id: string; rect: Rect; min: Size }>;

/** From this screen width the windows float and stick; below it, the phone's bottom sheet. Same as the trade card. */
export const WINDOWED_FROM = 900;
/** The seam between two windows that stick together. Even, so its middle is a whole pixel. */
export const GAP = 8;
/** How near an edge has to come before it sticks. */
export const SNAP = 14;
/** The least a window shrinks to unless it asks for more: a head and a few lines. */
export const MIN = { width: 280, height: 180 } as const;
/**
 * The least a window stuck into a layout shrinks to when the screen gets smaller than the layout's leasts: its head
 * stays whole and the seams stay seams; the window's own least comes back when the screen grows.
 */
export const FLOOR = { width: 160, height: 48 } as const;
/** A new window, unless it asks for its own size. */
export const DEFAULT_SIZE = { width: 560, height: 440 } as const;
/**
 * The workspace inside the screen: under the top bar (12 px + its 44 px row + air) and above the dock (14 px + its
 * 74 px + the diamond that rises over it), with the city's side gutter.
 */
export const INSET = { top: 72, right: 16, bottom: 104, left: 16 } as const;
/** A popped-out window steps this far from where it stood, so it no longer sticks to anything. */
export const STEP = 32;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;

export function windowed(viewport: Viewport): boolean {
  return viewport.width >= WINDOWED_FROM;
}

/** The workspace on this screen. */
export function areaOf(viewport: Viewport): Rect {
  return {
    x: INSET.left,
    y: INSET.top,
    width: Math.max(0, viewport.width - INSET.left - INSET.right),
    height: Math.max(0, viewport.height - INSET.top - INSET.bottom),
  };
}

/** The thin frame of the city left around a window on the whole screen. */
export const FULL_MARGIN = 12;

/**
 * A window on the whole screen (macet M3): the city stays a thin frame around it. It covers the top bar and the dock
 * (both stand inside the frame's 12 px), and its own head brings the way back.
 */
export function fullRect(viewport: Viewport): Rect {
  const m = FULL_MARGIN;
  return { x: m, y: m, width: Math.max(0, viewport.width - 2 * m), height: Math.max(0, viewport.height - 2 * m) };
}

/** The least of a window on this workspace: its own, unless the workspace is smaller still. */
function leastIn(min: Size, area: Rect): Size {
  return { width: Math.min(min.width, area.width), height: Math.min(min.height, area.height) };
}

/** The window within its least and the workspace, moved back whole into the workspace. */
export function fitRect(rect: Rect, area: Rect, min: Size = MIN): Rect {
  const least = leastIn(min, area);
  const width = clamp(Math.round(rect.width), least.width, area.width);
  const height = clamp(Math.round(rect.height), least.height, area.height);
  const x = clamp(Math.round(rect.x), area.x, right(area) - width);
  const y = clamp(Math.round(rect.y), area.y, bottom(area) - height);
  return { x, y, width, height };
}

/** Two spans on one axis share some length (touching ends do not). */
function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

/** Two spans on one axis come within `reach` of each other. */
function near(a0: number, a1: number, b0: number, b1: number, reach: number): boolean {
  return a0 < b1 + reach && b0 < a1 + reach;
}

/** The two windows stick along a seam: one's edge stands a seam away from the other's facing edge, side by side. */
export function stuck(a: Rect, b: Rect): boolean {
  const across = overlaps(a.y, bottom(a), b.y, bottom(b)) && (right(a) + GAP === b.x || right(b) + GAP === a.x);
  const along = overlaps(a.x, right(a), b.x, right(b)) && (bottom(a) + GAP === b.y || bottom(b) + GAP === a.y);
  return across || along;
}

/** The window sticks to another window or to the workspace's edge. */
export function docked(rect: Rect, others: readonly Rect[], area: Rect): boolean {
  if (rect.x === area.x || rect.y === area.y || right(rect) === right(area) || bottom(rect) === bottom(area)) return true;
  return others.some((o) => stuck(rect, o));
}

type Target = Readonly<{ at: number; guide: Guide }>;

/** The nearest target within the pull, as the distance to move; 0 when nothing is near. */
function pull(edges: readonly { at: number; targets: readonly Target[] }[]): { by: number; guides: Guide[] } {
  let best: number | null = null;
  for (const edge of edges) {
    for (const t of edge.targets) {
      const by = t.at - edge.at;
      if (Math.abs(by) <= SNAP && (best === null || Math.abs(by) < Math.abs(best))) best = by;
    }
  }
  if (best === null) return { by: 0, guides: [] };
  const guides = edges.flatMap((edge) => edge.targets.filter((t) => t.at === edge.at + best).map((t) => t.guide));
  return { by: best, guides };
}

/**
 * Where the left and right edges (`axis: 'x'`) or the top and bottom (`axis: 'y'`) of `rect` may stick: the
 * workspace's edges, and every other window near enough across — a seam away from its facing edge, or in line with
 * its own edge so the corners meet.
 */
function targets(rect: Rect, others: readonly Rect[], area: Rect, axis: 'x' | 'y') {
  const lo = axis === 'x' ? rect.x : rect.y;
  const hi = axis === 'x' ? right(rect) : bottom(rect);
  const across0 = axis === 'x' ? rect.y : rect.x;
  const across1 = axis === 'x' ? bottom(rect) : right(rect);
  const a0 = axis === 'x' ? area.x : area.y;
  const a1 = axis === 'x' ? right(area) : bottom(area);
  const line = (at: number, from: number, to: number): Guide => ({ axis, at, from, to });
  const start: Target[] = [{ at: a0, guide: line(a0, across0, across1) }];
  const end: Target[] = [{ at: a1, guide: line(a1, across0, across1) }];
  for (const o of others) {
    const o0 = axis === 'x' ? o.x : o.y;
    const o1 = axis === 'x' ? right(o) : bottom(o);
    const p0 = axis === 'x' ? o.y : o.x;
    const p1 = axis === 'x' ? bottom(o) : right(o);
    if (!near(across0, across1, p0, p1, SNAP + GAP)) continue;
    const from = Math.min(across0, p0);
    const to = Math.max(across1, p1);
    // Side by side across a seam: the guide runs down the seam's middle.
    start.push({ at: o1 + GAP, guide: line(o1 + GAP / 2, from, to) });
    end.push({ at: o0 - GAP, guide: line(o0 - GAP / 2, from, to) });
    // In line: the two windows' edges meet, corner to corner.
    start.push({ at: o0, guide: line(o0, from, to) });
    end.push({ at: o1, guide: line(o1, from, to) });
  }
  return { lo: { at: lo, targets: start }, hi: { at: hi, targets: end } };
}

function dedupe(guides: readonly Guide[]): Guide[] {
  const seen = new Set<string>();
  return guides.filter((g) => {
    const key = `${g.axis}:${g.at}:${g.from}:${g.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Dragged by its head: the window keeps its size, stays whole in the workspace and sticks to the nearest edge within
 * the pull. Only this window moves: dragging it out of a seam unsticks it.
 */
export function moveRect(start: Rect, dx: number, dy: number, others: readonly Rect[], area: Rect, min: Size = MIN): { rect: Rect; guides: Guide[] } {
  let rect = fitRect({ ...start, x: start.x + dx, y: start.y + dy }, area, min);
  const tx = targets(rect, others, area, 'x');
  const sx = pull([tx.lo, tx.hi]);
  rect = fitRect({ ...rect, x: rect.x + sx.by }, area, min);
  const ty = targets(rect, others, area, 'y');
  const sy = pull([ty.lo, ty.hi]);
  rect = fitRect({ ...rect, y: rect.y + sy.by }, area, min);
  // The guides of the place it ended in, so a pull undone by the workspace's edge shows no line.
  const fx = targets(rect, others, area, 'x');
  const fy = targets(rect, others, area, 'y');
  const exact = (edge: { at: number; targets: readonly Target[] }) => edge.targets.filter((t) => t.at === edge.at).map((t) => t.guide);
  return { rect, guides: dedupe([...exact(fx.lo), ...exact(fx.hi), ...exact(fy.lo), ...exact(fy.hi)]) };
}

/**
 * The seam behind one edge of a window: the windows whose same edge stands in that line (`near`, the window itself
 * among them) and the windows a seam away across it (`far`), gathered through every window that overlaps one already
 * gathered. Pulling the edge moves the whole seam; a window that sticks to nothing has a seam of one.
 */
export function seamOf(boxes: readonly Box[], id: string, side: Side): { near: string[]; far: string[] } {
  const own = boxes.find((b) => b.id === id);
  if (!own) return { near: [], far: [] };
  const upright = side === 'e' || side === 'w';
  const edgeOf = (r: Rect, s: Side) => (s === 'e' ? right(r) : s === 'w' ? r.x : s === 's' ? bottom(r) : r.y);
  const opposite: Record<Side, Side> = { e: 'w', w: 'e', n: 's', s: 'n' };
  const at = edgeOf(own.rect, side);
  const farAt = side === 'e' || side === 's' ? at + GAP : at - GAP;
  const span = (r: Rect): [number, number] => (upright ? [r.y, bottom(r)] : [r.x, right(r)]);
  const touches = (r: Rect, group: Set<string>) => [...group].some((g) => {
    const o = boxes.find((b) => b.id === g)!.rect;
    const [a0, a1] = span(r);
    const [b0, b1] = span(o);
    return overlaps(a0, a1, b0, b1);
  });
  const nearSet = new Set([id]);
  const farSet = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const b of boxes) {
      if (nearSet.has(b.id) || farSet.has(b.id)) continue;
      if (edgeOf(b.rect, opposite[side]) === farAt && touches(b.rect, nearSet)) {
        farSet.add(b.id);
        grew = true;
      } else if (edgeOf(b.rect, side) === at && farSet.size && touches(b.rect, farSet)) {
        nearSet.add(b.id);
        grew = true;
      }
    }
  }
  return { near: [...nearSet], far: [...farSet] };
}

/**
 * Pulls one edge of a window by `d` (right and down are positive), and the seam behind it with it: the windows on this
 * side of the seam stretch, the windows across it shrink, none below its least, none out of the workspace. A free
 * edge sticks to the nearest edge within the pull. Returns the new places of the windows that moved.
 */
function pullEdge(boxes: readonly Box[], area: Rect, id: string, side: Side, d: number): { rects: Map<string, Rect>; guides: Guide[] } {
  const seam = seamOf(boxes, id, side);
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const upright = side === 'e' || side === 'w';
  const grows = side === 'e' || side === 's';
  const size = (b: Box) => (upright ? b.rect.width : b.rect.height);
  const least = (b: Box) => (upright ? leastIn(b.min, area).width : leastIn(b.min, area).height);
  const own = byId.get(id)!;
  const at = side === 'e' ? right(own.rect) : side === 'w' ? own.rect.x : side === 's' ? bottom(own.rect) : own.rect.y;
  const a0 = upright ? area.x : area.y;
  const a1 = upright ? right(area) : bottom(area);
  const nearBoxes = seam.near.map((n) => byId.get(n)!);
  const farBoxes = seam.far.map((n) => byId.get(n)!);
  // On this side a window grows with d (right, bottom edges) or with -d (left, top edges); across the seam, the other way.
  let lo: number;
  let hi: number;
  if (grows) {
    lo = Math.max(...nearBoxes.map((b) => least(b) - size(b)));
    hi = farBoxes.length ? Math.min(...farBoxes.map((b) => size(b) - least(b))) : a1 - at;
  } else {
    hi = Math.min(...nearBoxes.map((b) => size(b) - least(b)));
    lo = farBoxes.length ? Math.max(...farBoxes.map((b) => least(b) - size(b))) : a0 - at;
  }
  // A window already past its least (a smaller screen) may still be pulled back towards it.
  lo = Math.min(lo, 0);
  hi = Math.max(hi, 0);
  let by = clamp(Math.round(d), lo, hi);
  const guides: Guide[] = [];
  // A free edge sticks; a seam that is already one stays where the hand puts it.
  if (!farBoxes.length) {
    const moved = new Set(seam.near);
    const others = boxes.filter((b) => !moved.has(b.id)).map((b) => b.rect);
    const probe = grows
      ? upright
        ? { ...own.rect, width: own.rect.width + by }
        : { ...own.rect, height: own.rect.height + by }
      : upright
        ? { ...own.rect, x: own.rect.x + by, width: own.rect.width - by }
        : { ...own.rect, y: own.rect.y + by, height: own.rect.height - by };
    const t = targets(probe, others, area, upright ? 'x' : 'y');
    const s = pull([grows ? t.hi : t.lo]);
    const snapped = clamp(by + s.by, lo, hi);
    if (snapped === by + s.by) {
      by = snapped;
      guides.push(...s.guides);
    }
  }
  const rects = new Map<string, Rect>();
  const shift = (r: Rect, lead: boolean): Rect => {
    // `lead`: the edge that moves is the left or top one; otherwise the right or bottom one.
    if (upright) return lead ? { ...r, x: r.x + by, width: r.width - by } : { ...r, width: r.width + by };
    return lead ? { ...r, y: r.y + by, height: r.height - by } : { ...r, height: r.height + by };
  };
  for (const b of nearBoxes) rects.set(b.id, shift(b.rect, !grows));
  for (const b of farBoxes) rects.set(b.id, shift(b.rect, grows));
  if (farBoxes.length) {
    const all = [...nearBoxes, ...farBoxes].map((b) => rects.get(b.id)!);
    const from = Math.min(...all.map((r) => (upright ? r.y : r.x)));
    const to = Math.max(...all.map((r) => (upright ? bottom(r) : right(r))));
    const line = at + by + (grows ? GAP / 2 : -GAP / 2);
    guides.push({ axis: upright ? 'x' : 'y', at: line, from, to });
  }
  return { rects, guides };
}

/**
 * Stretched by an edge or a corner. The corner pulls its two edges at once; each edge pulls its seam, so the corner
 * where four windows meet moves all four.
 */
export function resizeBoxes(boxes: readonly Box[], area: Rect, id: string, handle: Handle, dx: number, dy: number): { rects: Map<string, Rect>; guides: Guide[] } {
  const horizontal: Side | null = handle.includes('e') ? 'e' : handle.includes('w') ? 'w' : null;
  const vertical: Side | null = handle.includes('n') ? 'n' : handle.includes('s') ? 's' : null;
  const across = horizontal ? pullEdge(boxes, area, id, horizontal, dx) : { rects: new Map<string, Rect>(), guides: [] };
  const down = vertical ? pullEdge(boxes, area, id, vertical, dy) : { rects: new Map<string, Rect>(), guides: [] };
  const rects = new Map<string, Rect>();
  for (const b of boxes) {
    const x = across.rects.get(b.id);
    const y = down.rects.get(b.id);
    if (!x && !y) continue;
    rects.set(b.id, { x: (x ?? b.rect).x, width: (x ?? b.rect).width, y: (y ?? b.rect).y, height: (y ?? b.rect).height });
  }
  return { rects, guides: dedupe([...across.guides, ...down.guides]) };
}

/** Splits a rectangle in two along an axis, a seam between them; `share` is the first part's part of the room. */
function split(r: Rect, axis: 'x' | 'y', share: number): [Rect, Rect] {
  if (axis === 'x') {
    const first = Math.round((r.width - GAP) * share);
    return [
      { x: r.x, y: r.y, width: first, height: r.height },
      { x: r.x + first + GAP, y: r.y, width: r.width - first - GAP, height: r.height },
    ];
  }
  const first = Math.round((r.height - GAP) * share);
  return [
    { x: r.x, y: r.y, width: r.width, height: first },
    { x: r.x, y: r.y + first + GAP, width: r.width, height: r.height - first - GAP },
  ];
}

/** Splits a rectangle into `n` equal parts along an axis, seams between them. */
function parts(r: Rect, axis: 'x' | 'y', n: number): Rect[] {
  const out: Rect[] = [];
  let rest = r;
  for (let i = n; i > 1; i -= 1) {
    const [first, more] = split(rest, axis, 1 / i);
    out.push(first);
    rest = more;
  }
  out.push(rest);
  return out;
}

/**
 * Every open window stuck into one grid that fills the workspace, in the order given (macet M2 for four: the first
 * large at the top left, the second and third stacked on the right, the fourth along the bottom).
 */
export function gridRects(count: number, area: Rect): Rect[] {
  if (count <= 0) return [];
  if (count === 1) return [area];
  if (count === 2) return split(area, 'x', 0.6);
  if (count === 3) {
    const [a, rest] = split(area, 'x', 0.6);
    return [a, ...split(rest, 'y', 0.5)];
  }
  if (count === 4) {
    const [top, low] = split(area, 'y', 0.66);
    const [a, rest] = split(top, 'x', 0.6);
    return [a, ...split(rest, 'y', 0.5), low];
  }
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const out: Rect[] = [];
  parts(area, 'y', rows).forEach((row, i) => {
    const inRow = i === rows - 1 ? count - columns * (rows - 1) : columns;
    out.push(...parts(row, 'x', inRow));
  });
  return out;
}

/**
 * A place remembered on one workspace, carried to another (a smaller window, another screen). Edges at the workspace's
 * edge stay at its edge; every other edge moves with the middle of its seam, so two windows that stuck before still
 * stick after, whichever of them is carried first.
 */
export function carryRect(rect: Rect, from: Rect, to: Rect): Rect {
  if (from.width <= 0 || from.height <= 0) return rect;
  const kx = to.width / from.width;
  const ky = to.height / from.height;
  const mapX = (x: number) => Math.round(to.x + (x - from.x) * kx);
  const mapY = (y: number) => Math.round(to.y + (y - from.y) * ky);
  const half = GAP / 2;
  const x0 = rect.x === from.x ? to.x : mapX(rect.x - half) + half;
  const x1 = right(rect) === right(from) ? right(to) : mapX(right(rect) + half) - half;
  const y0 = rect.y === from.y ? to.y : mapY(rect.y - half) + half;
  const y1 = bottom(rect) === bottom(from) ? bottom(to) : mapY(bottom(rect) + half) - half;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** A floating window keeps its size on another workspace; its middle moves with the workspace. */
export function carryFree(rect: Rect, from: Rect, to: Rect, min: Size = MIN): Rect {
  if (from.width <= 0 || from.height <= 0) return fitRect(rect, to, min);
  const cx = to.x + (rect.x + rect.width / 2 - from.x) * (to.width / from.width);
  const cy = to.y + (rect.y + rect.height / 2 - from.y) * (to.height / from.height);
  return fitRect({ x: cx - rect.width / 2, y: cy - rect.height / 2, width: rect.width, height: rect.height }, to, min);
}

/**
 * «Pop out»: the window leaves its seam and floats again — a little smaller, a step away from where it stood, still
 * whole in the workspace, sticking to nothing.
 */
export function popOutRect(rect: Rect, others: readonly Rect[], area: Rect, min: Size = MIN): Rect {
  const width = clamp(Math.round(rect.width * 0.85), Math.min(min.width, area.width), Math.max(Math.min(min.width, area.width), Math.round(area.width * 0.6)));
  const height = clamp(Math.round(rect.height * 0.85), Math.min(min.height, area.height), Math.max(Math.min(min.height, area.height), Math.round(area.height * 0.7)));
  for (let step = 1; step <= 8; step += 1) {
    const free = fitRect({ x: rect.x + STEP * step, y: rect.y + STEP * step, width, height }, area, min);
    if (!docked(free, others, area)) return free;
    const back = fitRect({ x: rect.x - STEP * step, y: rect.y - STEP * step, width, height }, area, min);
    if (!docked(back, others, area)) return back;
  }
  // A workspace too small to float in: the middle of it.
  return fitRect({ x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height }, area, min);
}

/** Where a new window first opens: its size, near the middle, each next one a step down and right of the last. */
export function openRect(size: Size, min: Size, area: Rect, index: number): Rect {
  const width = clamp(size.width, Math.min(min.width, area.width), Math.round(area.width * 0.8));
  const height = clamp(size.height, Math.min(min.height, area.height), Math.round(area.height * 0.85));
  const step = (index % 6) * STEP;
  return fitRect({ x: area.x + (area.width - width) / 2 - 2 * STEP + step, y: area.y + (area.height - height) / 2 - 2 * STEP + step, width, height }, area, min);
}
