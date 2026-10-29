import type { Building, Id, PublicBuilding, Quarter } from "./contract";
import { QUARTER_SLOTS, openSlots } from "./catalog";

/**
 * Free building on a quarter (CITY-55, decision 72): small pieces on a grid, as in Townscaper — put one down, turn
 * it, take it off; the city fits each piece to its neighbours when it draws them. A layout is cosmetic and nothing
 * else: it never pays points, never moves a task of the day and never touches money (`docs/city/FREE-BUILD.md`).
 *
 * Pure and client-safe, like `contract.ts` and `rules.ts`: the server checks every save with `planLayout`, the city
 * checks the same way before it sends one, so a refusal is rare and always says why.
 */

/* ------------------------------------------------------------------ grid -- */

/** Each plot of the quarter (3 across, 4 deep) is cut into 3 × 3 cells. */
export const CELLS_PER_PLOT = 3;
export const PLOTS_WIDE = 3;
export const GRID_W = PLOTS_WIDE * CELLS_PER_PLOT; // 9
export const GRID_D = Math.ceil(QUARTER_SLOTS / PLOTS_WIDE) * CELLS_PER_PLOT; // 12
/** How high a column of pieces may stand. */
export const MAX_STACK = 3;

/** The plot (the world's slot) a cell lies in: slots 0–2 are the row by the street, left to right as seen from it. */
export function slotOfCell(gx: number, gz: number): number {
  return Math.floor(gz / CELLS_PER_PLOT) * PLOTS_WIDE + Math.floor(gx / CELLS_PER_PLOT);
}

/* ---------------------------------------------------------------- pieces -- */

export const PIECE_KINDS = [
  "block", "glass", "arch", "turret", "path", "hedge", "tree", "lamp", "fountain", "sign",
  "vault_house", "mini_ring", "arcade",
] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

export type PieceRule = Readonly<{
  /** The quarter level from which the piece may be placed. */
  from: number;
  /** Cells it covers on each side: 1, or 2 for the game buildings (2 × 2, inside one plot). */
  size: 1 | 2;
  /** Something may stand on it. */
  carries: boolean;
  /** It stands on the ground only. */
  ground: boolean;
  /** How many one quarter may hold; null — as many as the quarter's cap allows. */
  perQuarter: number | null;
}>;

export const PIECES: Readonly<Record<PieceKind, PieceRule>> = {
  block: { from: 1, size: 1, carries: true, ground: false, perQuarter: null },
  glass: { from: 1, size: 1, carries: true, ground: false, perQuarter: null },
  arch: { from: 1, size: 1, carries: true, ground: true, perQuarter: null },
  turret: { from: 2, size: 1, carries: false, ground: false, perQuarter: null },
  path: { from: 1, size: 1, carries: false, ground: true, perQuarter: null },
  hedge: { from: 1, size: 1, carries: false, ground: true, perQuarter: null },
  tree: { from: 1, size: 1, carries: false, ground: false, perQuarter: null },
  lamp: { from: 1, size: 1, carries: false, ground: false, perQuarter: null },
  fountain: { from: 2, size: 1, carries: false, ground: true, perQuarter: 4 },
  sign: { from: 1, size: 1, carries: false, ground: false, perQuarter: 3 },
  // The game buildings of decision 72: a shell in the quarter, no game and no money behind it yet.
  arcade: { from: 1, size: 2, carries: false, ground: true, perQuarter: 1 },
  vault_house: { from: 2, size: 2, carries: false, ground: true, perQuarter: 1 },
  mini_ring: { from: 3, size: 2, carries: false, ground: true, perQuarter: 1 },
};

export type Rotation = 0 | 1 | 2 | 3;

/** One piece: its cell (gx across from the left, gz from the street inward), its height in the column and its turn. */
export type Piece = {
  gx: number;
  gz: number;
  y: number;
  kind: PieceKind;
  rot: Rotation;
  /** A sign's own words; only a sign carries them, and others never read them (`publicLayout`). */
  text?: string;
};

export type Layout = {
  quarterId: Id;
  pieces: Piece[];
  /** Starts at 0 with nothing saved; every save sends the version it saw. */
  version: number;
  updatedAt: string | null;
};

/** How many pieces a quarter of this level may hold: 40 at first, 10 more a level, 120 at most. */
export function pieceCap(quarterLevel: number): number {
  return Math.min(120, 40 + 10 * (Math.max(1, Math.floor(quarterLevel) || 1) - 1));
}

export const MAX_SIGN_TEXT = 12;

/* ----------------------------------------------------------------- signs -- */

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}]/u;
/** Until CITY-73 cleans foreign text, a sign holds only plain letters, digits and a few marks. */
const PLAIN = /^[\p{Script=Latin}\p{Script=Cyrillic}0-9 .,!?&'-]+$/u;

/**
 * The one place a sign's words are let in. CITY-73 («чужий текст у місті безпечний») replaces the body of this
 * function with its cleaner when it is merged; until then a sign takes at most 12 plain characters and nothing else,
 * and nobody but its owner sees them (`publicLayout`).
 */
export function signText(raw: unknown): { ok: true; text: string } | { ok: false } {
  if (typeof raw !== "string") return { ok: false };
  const text = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  // CITY-73: call the city's text cleaner here once it is merged.
  if (text.length === 0 || [...text].length > MAX_SIGN_TEXT || INVISIBLE.test(text) || !PLAIN.test(text)) return { ok: false };
  return { ok: true, text };
}

/** Whether people other than the owner may read a sign's words. False until CITY-73's cleaner stands in `signText`. */
export const SIGN_TEXT_PUBLIC = false;

/* ---------------------------------------------------------------- checks -- */

export type LayoutRefusalReason =
  | "shape" // not a list of pieces
  | "cap" // more pieces than the quarter's level allows
  | "cell" // outside the grid, or a game building across two plots
  | "closed" // a plot a higher level opens
  | "built" // a plot that holds a building of the quarter
  | "overlap" // two pieces in one place
  | "support" // floating, or standing on what carries nothing
  | "kind" // a piece a higher level opens
  | "limit" // more of one piece than a quarter holds
  | "sign"; // a sign's words the city does not take

export type LayoutRefusal = Readonly<{ reason: LayoutRefusalReason; index: number | null; need?: { quarterLevel: number } }>;

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export function isPieceKind(value: unknown): value is PieceKind {
  return typeof value === "string" && (PIECE_KINDS as readonly string[]).includes(value);
}

/** One piece from a request, checked field by field; null when it is not a piece. */
export function parsePiece(value: unknown): Piece | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !["gx", "gz", "y", "kind", "rot", "text"].includes(k))) return null;
  if (!isInt(v.gx, 0, GRID_W - 1) || !isInt(v.gz, 0, GRID_D - 1) || !isInt(v.y, 0, MAX_STACK - 1) || !isInt(v.rot, 0, 3) || !isPieceKind(v.kind)) return null;
  const piece: Piece = { gx: v.gx, gz: v.gz, y: v.y, kind: v.kind, rot: v.rot as Rotation };
  if (v.text !== undefined) {
    if (v.kind !== "sign" || typeof v.text !== "string") return null;
    piece.text = v.text;
  }
  return piece;
}

/** The cells a piece covers on the ground. */
export function footprint(p: Pick<Piece, "gx" | "gz" | "kind">): { gx: number; gz: number }[] {
  const n = PIECES[p.kind].size;
  const cells: { gx: number; gz: number }[] = [];
  for (let dz = 0; dz < n; dz += 1) for (let dx = 0; dx < n; dx += 1) cells.push({ gx: p.gx + dx, gz: p.gz + dz });
  return cells;
}

const cellKey = (gx: number, gz: number) => gx * 64 + gz;

/** One order for every layout: from the street inward, left to right, bottom to top. */
export function sortPieces(pieces: readonly Piece[]): Piece[] {
  return [...pieces].sort((a, b) => a.gz - b.gz || a.gx - b.gx || a.y - b.y);
}

/** The plots the layout may use: open at this level and holding no building. */
export function freePlots(level: number, buildings: readonly Pick<Building, "slot">[]): Set<number> {
  const open = openSlots(level);
  const built = new Set(buildings.map((b) => b.slot));
  const free = new Set<number>();
  for (let slot = 0; slot < open; slot += 1) if (!built.has(slot)) free.add(slot);
  return free;
}

/**
 * Check a whole layout against the quarter as the server read it. Pieces come back in the one order the world keeps,
 * signs with their words as `signText` let them in. The first piece that does not fit is named by its index.
 */
export function planLayout(input: Readonly<{
  quarter: Pick<Quarter, "level">;
  buildings: readonly Pick<Building | PublicBuilding, "slot">[];
  pieces: unknown;
}>): { ok: true; pieces: Piece[] } | { ok: false; refusal: LayoutRefusal } {
  const level = input.quarter.level;
  if (!Array.isArray(input.pieces)) return { ok: false, refusal: { reason: "shape", index: null } };
  if (input.pieces.length > pieceCap(level)) {
    return { ok: false, refusal: level < 10 ? { reason: "cap", index: null, need: { quarterLevel: level + 1 } } : { reason: "cap", index: null } };
  }
  const parsed: Piece[] = [];
  for (let i = 0; i < input.pieces.length; i += 1) {
    const p = parsePiece(input.pieces[i]);
    if (!p) return { ok: false, refusal: { reason: "shape", index: i } };
    parsed.push(p);
  }
  const free = freePlots(level, input.buildings);
  const columns = new Map<number, (Piece | null)[]>();
  const counts = new Map<PieceKind, number>();
  const refuse = (reason: LayoutRefusalReason, index: number, need?: number): { ok: false; refusal: LayoutRefusal } => ({
    ok: false,
    refusal: need ? { reason, index, need: { quarterLevel: need } } : { reason, index },
  });

  for (let i = 0; i < parsed.length; i += 1) {
    const p = parsed[i]!;
    const rule = PIECES[p.kind];
    if (level < rule.from) return refuse("kind", i, rule.from);
    const cells = footprint(p);
    const slot = slotOfCell(p.gx, p.gz);
    if (cells.some((c) => c.gx >= GRID_W || c.gz >= GRID_D || slotOfCell(c.gx, c.gz) !== slot)) return refuse("cell", i);
    if (slot >= openSlots(level)) return refuse("closed", i, Math.max(1, slot - 1));
    if (!free.has(slot)) return refuse("built", i);
    if (rule.ground && p.y !== 0) return refuse("support", i);
    for (const c of cells) {
      const column = columns.get(cellKey(c.gx, c.gz)) ?? Array.from({ length: MAX_STACK }, () => null);
      if (column[p.y]) return refuse("overlap", i);
      // A building of two by two takes its whole column: nothing stands on it or under it.
      if (rule.size === 2 && column.some(Boolean)) return refuse("overlap", i);
      column[p.y] = p;
      if (rule.size === 2) column.fill(p);
      columns.set(cellKey(c.gx, c.gz), column);
    }
    const n = (counts.get(p.kind) ?? 0) + 1;
    counts.set(p.kind, n);
    if (rule.perQuarter !== null && n > rule.perQuarter) return refuse("limit", i);
    if (p.kind === "sign" && p.text !== undefined) {
      const words = signText(p.text);
      if (!words.ok) return refuse("sign", i);
      p.text = words.text;
    }
  }
  // Every piece above the ground stands on one that carries.
  for (let i = 0; i < parsed.length; i += 1) {
    const p = parsed[i]!;
    if (p.y === 0) continue;
    const below = columns.get(cellKey(p.gx, p.gz))?.[p.y - 1] ?? null;
    if (!below || below === p || !PIECES[below.kind].carries) return refuse("support", i);
  }
  return { ok: true, pieces: sortPieces(parsed) };
}

/**
 * The pieces that still fit the quarter as it is now: a building put on a plot since takes it back, and whatever
 * stood on a removed piece falls with it. The city draws and saves only these.
 */
export function fitToQuarter(pieces: readonly Piece[], level: number, buildings: readonly Pick<Building, "slot">[]): Piece[] {
  const free = freePlots(level, buildings);
  const kept = sortPieces(pieces).filter((p) => free.has(slotOfCell(p.gx, p.gz)) && level >= PIECES[p.kind].from);
  const at = new Map<string, Piece>();
  const out: Piece[] = [];
  for (const p of kept) {
    const below = p.y === 0 ? null : at.get(`${p.gx}:${p.gz}:${p.y - 1}`);
    if (p.y > 0 && (!below || !PIECES[below.kind].carries)) continue;
    const heights = PIECES[p.kind].size === 2 ? Array.from({ length: MAX_STACK }, (_, y) => y) : [p.y];
    if (footprint(p).some((c) => heights.some((y) => at.has(`${c.gx}:${c.gz}:${y}`)))) continue;
    for (const c of footprint(p)) for (const y of heights) at.set(`${c.gx}:${c.gz}:${y}`, p);
    out.push(p);
  }
  return out.slice(0, pieceCap(level));
}

/**
 * The deployment's switch for free building (CITY-55): `NEXT_PUBLIC_RYNTRA_CITY_FREE_BUILD=open`, closed when not set.
 * Closed, the quarter shows no «Free build», reads no layout, and `/api/world/layout` answers 404. Open it only after
 * the owner applied the migration `20261028150000_quarter_layout.sql`.
 */
export function freeBuildOpen(value: string | undefined): boolean {
  return value === "open";
}

/** The layout as anyone may read it: a sign's words stay with its owner until the city cleans foreign text. */
export function publicLayout(layout: Layout): Layout {
  if (SIGN_TEXT_PUBLIC) return layout;
  return { ...layout, pieces: layout.pieces.map(({ text: _text, ...p }) => p) };
}

/* ---------------------------------------------------------------- bodies -- */

/** `POST /api/world/layout` — the whole layout of my quarter at the version I saw. */
export type LayoutSaveRequest = { quarterId: Id; pieces: Piece[]; version: number };

/** `GET /api/world/layout` (mine, with my signs' words), `GET /api/world/layout/:quarterId` (anyone) and the save. */
export type LayoutResponse = { layout: Layout };
