import { REWARD_RANKS, type RewardRank } from "../rewards/rules.ts";

/**
 * The badges of Ryntra ranks and achievements, and the framed avatar — one
 * drawing, as SVG markup.
 *
 * ## One language
 *
 * Every badge is the same object: a medallion with a metal rim, a dark
 * enamel face and the rank gem at its centre. A rank badge is a hexagon; an
 * achievement is the same medallion round, in its own teal enamel, with a
 * pictogram where the gem would be. What changes between ranks is the metal —
 * bronze, silver, gold, sapphire, diamond — and the number of orange marks
 * under the gem, one to five, so a rank never rests on colour alone; the
 * Diamond's gem is the largest and breaks its rim. The brand's `#FF681C` is
 * only those small marks — never a whole badge, which would read as an
 * action. Nothing here draws the R, which only `app/brand` may.
 *
 * A badge not yet earned is only the medallion's outline — a slate rim with
 * no enamel, so the card shows through — and its gem or pictogram as a
 * contour, all in a slate that keeps 3:1 against the card in both themes:
 * visible as the way up, never heavier than a badge held, never a metal.
 *
 * ## Why markup rather than components
 *
 * The same drawing has three readers: the Rewards page (React), a chart that
 * paints a trader's avatar on a canvas, and a share card rendered on the
 * server. A string serves all three from one geometry. Gradient ids carry the
 * caller's prefix, so two badges on one page never borrow each other's metal.
 */

export type Metal = Readonly<{ light: string; mid: string; dark: string; edge: string }>;

/** The five metals, light to dark along the light's axis. */
export const RANK_METALS: Readonly<Record<RewardRank, Metal>> = {
  BRONZE: { light: "#F2B98A", mid: "#C47A45", dark: "#7A4322", edge: "#5A2F17" },
  SILVER: { light: "#FFFFFF", mid: "#C3CCD6", dark: "#7D8897", edge: "#56606C" },
  GOLD: { light: "#FFE9A8", mid: "#E9B949", dark: "#A77A12", edge: "#7A570B" },
  SAPPHIRE: { light: "#A9C8FF", mid: "#3D7BFF", dark: "#1B3FA6", edge: "#122C78" },
  DIAMOND: { light: "#FFFFFF", mid: "#B9F0FF", dark: "#6CC4E6", edge: "#3E8FB3" },
};

/** The achievements' enamel: a teal no rank wears, so a deed never reads as a rank or as an action. */
export const ACHIEVEMENT_METAL: Metal = { light: "#A7F0E4", mid: "#2BB3A3", dark: "#167066", edge: "#0E4F48" };

/**
 * What a badge not yet earned is drawn in: a slate whose body keeps at least
 * 3:1 against the card on the dark ground (#0E1620) and the light (#FFFFFF).
 */
export const LOCKED_METAL: Metal = { light: "#A3AEBB", mid: "#7C8899", dark: "#64707F", edge: "#4F5A68" };

const ORANGE = "#FF681C";
const ENAMEL_TOP = "#1B2735";
const ENAMEL_BOTTOM = "#0A1118";

/** The rank's place, Bronze 1 to Diamond 5 — the number of marks under its gem. */
export function rankTier(rank: RewardRank): number {
  return REWARD_RANKS.indexOf(rank) + 1;
}

/** Silver and above wear a frame. */
export function hasAvatarFrame(rank: RewardRank | null | undefined): rank is RewardRank {
  return rank !== null && rank !== undefined && rankTier(rank) >= rankTier("SILVER");
}

/** Ids must survive inside `url(#…)`: letters, digits and hyphens only. */
function idPrefix(prefix: string | undefined): string {
  const clean = (prefix ?? "rb").replace(/[^A-Za-z0-9-]/g, "");
  return /^[A-Za-z]/.test(clean) ? clean : `rb${clean}`;
}

const r2 = (value: number): string => String(Math.round(value * 100) / 100);

/**
 * A polygon with rounded corners: each corner becomes a quadratic curve
 * through the original vertex, starting and ending `radius` along each side.
 */
function roundedPolygon(points: readonly (readonly [number, number])[], radius: number): string {
  const n = points.length;
  let d = "";
  for (let i = 0; i < n; i += 1) {
    const [x, y] = points[i];
    const [px, py] = points[(i - 1 + n) % n];
    const [nx, ny] = points[(i + 1) % n];
    const toPrev = Math.hypot(px - x, py - y);
    const toNext = Math.hypot(nx - x, ny - y);
    const a = [x + ((px - x) * radius) / toPrev, y + ((py - y) * radius) / toPrev];
    const b = [x + ((nx - x) * radius) / toNext, y + ((ny - y) * radius) / toNext];
    d += `${i === 0 ? "M" : "L"}${r2(a[0])} ${r2(a[1])}Q${r2(x)} ${r2(y)} ${r2(b[0])} ${r2(b[1])}`;
  }
  return `${d}Z`;
}

/** A pointy-top hexagon around (cx, cy). */
function hexagon(cx: number, cy: number, radius: number, corner: number): string {
  const points = [0, 1, 2, 3, 4, 5].map((k) => {
    const angle = ((-90 + k * 60) * Math.PI) / 180;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as const;
  });
  return roundedPolygon(points, corner);
}

function circle(cx: number, cy: number, radius: number): string {
  return `M${r2(cx - radius)} ${r2(cy)}a${r2(radius)} ${r2(radius)} 0 1 0 ${r2(radius * 2)} 0a${r2(radius)} ${r2(radius)} 0 1 0 ${r2(-radius * 2)} 0Z`;
}

function metalGradient(id: string, metal: Metal): string {
  return (
    `<linearGradient id="${id}" x1="0.15" y1="0" x2="0.85" y2="1">` +
    `<stop offset="0" stop-color="${metal.light}"/>` +
    `<stop offset="0.48" stop-color="${metal.mid}"/>` +
    `<stop offset="1" stop-color="${metal.dark}"/>` +
    `</linearGradient>`
  );
}

function enamelGradient(id: string): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ENAMEL_TOP}"/><stop offset="1" stop-color="${ENAMEL_BOTTOM}"/></linearGradient>`;
}

/**
 * The rank gem: a cut stone seen from the side — a table, a crown of three
 * facets and a pavilion of two — in the badge's metal, lit from the left.
 * `cx` is its centre line, `top` its table, `w` its girdle width.
 */
function gem(metal: Metal, cx: number, top: number, w: number, empty = false): string {
  const half = w / 2;
  const crown = w * 0.3;
  const girdle = top + crown;
  const tip = girdle + w * 0.62;
  const table = w * 0.27;
  const left = cx - half;
  const right = cx + half;
  const tl = cx - table;
  const tr = cx + table;
  if (empty) {
    /* The gem's place, cut but not filled: the outline and its girdle. */
    return (
      `<g fill="none" stroke="${metal.mid}" stroke-width="${r2(w * 0.07)}" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M${r2(left)} ${r2(girdle)}L${r2(tl)} ${r2(top)}L${r2(tr)} ${r2(top)}L${r2(right)} ${r2(girdle)}L${r2(cx)} ${r2(tip)}Z"/>` +
      `<path d="M${r2(left)} ${r2(girdle)}H${r2(right)}"/>` +
      `</g>`
    );
  }
  return (
    `<g stroke="${metal.edge}" stroke-width="${r2(w * 0.035)}" stroke-linejoin="round">` +
    `<path d="M${r2(left)} ${r2(girdle)}L${r2(tl)} ${r2(top)}L${r2(cx)} ${r2(girdle)}Z" fill="${metal.light}"/>` +
    `<path d="M${r2(tl)} ${r2(top)}L${r2(tr)} ${r2(top)}L${r2(cx)} ${r2(girdle)}Z" fill="${metal.mid}"/>` +
    `<path d="M${r2(tr)} ${r2(top)}L${r2(right)} ${r2(girdle)}L${r2(cx)} ${r2(girdle)}Z" fill="${metal.dark}"/>` +
    `<path d="M${r2(left)} ${r2(girdle)}L${r2(cx)} ${r2(girdle)}L${r2(cx)} ${r2(tip)}Z" fill="${metal.mid}"/>` +
    `<path d="M${r2(cx)} ${r2(girdle)}L${r2(right)} ${r2(girdle)}L${r2(cx)} ${r2(tip)}Z" fill="${metal.dark}"/>` +
    `</g>`
  );
}

/** A medallion not yet earned: its rim alone, the card showing through the face. */
function lockedRim(outer: string, inner: string): string {
  return `<path d="${outer}${inner}" fill="${LOCKED_METAL.mid}" fill-rule="evenodd"/>`;
}

/** Where the marks sit: a line across the enamel, above the hexagon's lower corner. */
export const MARKS_Y = 45;
const MARK_SIZE = 2.4;

/**
 * How far the inner hexagon's lower edges let a mark's centre go from the
 * middle at height `y` (its lower point included), with a hair of air.
 */
function marksHalfRoom(y: number): number {
  const corner = 44.25; // the inner hexagon's lower side corners, at radius 24.5
  const below = Math.max(0, y + MARK_SIZE - corner);
  return 32 - (10.78 + below * Math.sqrt(3)) - MARK_SIZE - 1;
}

/**
 * The orange marks under the gem: one per tier, each a small diamond, all on
 * one thin line of the badge's metal — spaced to stay inside the rim at five.
 */
function marks(count: number, color: string, line: string): string {
  const half = marksHalfRoom(MARKS_Y);
  const gap = count > 1 ? Math.min(7, (2 * half) / (count - 1)) : 0;
  const start = 32 - ((count - 1) * gap) / 2;
  const reach = 32 - (10.78 + Math.max(0, MARKS_Y - 44.25) * Math.sqrt(3)) - 2;
  let out = `<path data-mark-line="" d="M${r2(32 - reach)} ${MARKS_Y}H${r2(32 + reach)}" stroke="${line}" stroke-opacity="0.55" stroke-width="0.7" stroke-linecap="round"/>`;
  for (let i = 0; i < count; i += 1) {
    const x = start + i * gap;
    out += `<path data-mark="" d="M${r2(x)} ${r2(MARKS_Y - MARK_SIZE)}L${r2(x + MARK_SIZE)} ${MARKS_Y}L${r2(x)} ${r2(MARKS_Y + MARK_SIZE)}L${r2(x - MARK_SIZE)} ${MARKS_Y}Z" fill="${color}"/>`;
  }
  return out;
}

/**
 * Light that only moves when a person does: a soft spot that follows the
 * pointer and a sheen that crosses once when a badge is chosen, both clipped
 * to the medallion and invisible until the page's CSS shows them
 * (`[data-spec]`, `[data-sheen]`, driven by `--mx` and `--my`). A canvas that
 * paints the markup never shows them.
 */
function lights(id: string, shape: string): string {
  return (
    `<defs><clipPath id="${id}-k"><path d="${shape}"/></clipPath>` +
    `<radialGradient id="${id}-s"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.45"/><stop offset="0.4" stop-color="#FFFFFF" stop-opacity="0.15"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${id}-w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0.9"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient></defs>` +
    `<g clip-path="url(#${id}-k)">` +
    `<circle data-spec="" cx="32" cy="32" r="11" fill="url(#${id}-s)" opacity="0"/>` +
    `<rect data-sheen="" x="-30" y="-8" width="12" height="80" fill="url(#${id}-w)" transform="skewX(-18)" opacity="0"/>` +
    `</g>`
  );
}

/** A soft light across the rim's upper left — what makes the metal read as metal. */
function gloss(id: string, shape: string): string {
  return (
    `<linearGradient id="${id}" x1="0" y1="0" x2="0.7" y2="0.7"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.55"/><stop offset="0.45" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>` +
    `<path d="${shape}" fill="url(#${id})"/>`
  );
}

export type BadgeOptions = Readonly<{ id?: string; size?: number; title?: string }>;

function svgOpen(size: number | undefined, title: string | undefined): string {
  const dims = size ? ` width="${size}" height="${size}"` : "";
  const label = title ? ` role="img" aria-label="${escapeAttr(title)}"` : ` aria-hidden="true"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"${dims}${label} focusable="false">`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * One rank's badge: the hexagonal medallion in the rank's metal with the gem
 * and its marks. `locked` draws it without metal — a rank not reached.
 */
export function rankBadgeSvg(rank: RewardRank, options: BadgeOptions & { locked?: boolean } = {}): string {
  const id = idPrefix(options.id);
  const locked = options.locked === true;
  const metal = locked ? LOCKED_METAL : RANK_METALS[rank];
  /* The Diamond's gem is the largest; its table rises through the inner rim. */
  const [gemTop, gemWidth] = rank === "DIAMOND" ? [7, 27] : [19, 21];
  const outer = hexagon(32, 32, 30, 5);
  const inner = hexagon(32, 32, 24.5, 3.6);
  const sparkle =
    rank === "DIAMOND" && !locked
      ? `<path data-sparkle="" d="M46 25.5l1.1 3.1 3.1 1.1-3.1 1.1-1.1 3.1-1.1-3.1-3.1-1.1 3.1-1.1z" fill="#FFFFFF"/>`
      : "";
  if (locked) {
    return (
      svgOpen(options.size, options.title) +
      lockedRim(outer, inner) +
      gem(LOCKED_METAL, 32, 19, 21, true) +
      marks(rankTier(rank), LOCKED_METAL.mid, LOCKED_METAL.mid) +
      `</svg>`
    );
  }
  return (
    svgOpen(options.size, options.title) +
    `<defs>${metalGradient(`${id}-m`, metal)}${enamelGradient(`${id}-e`)}</defs>` +
    `<path d="${outer}" fill="url(#${id}-m)" stroke="${metal.edge}" stroke-width="1"/>` +
    gloss(`${id}-g`, outer) +
    `<path d="${inner}" fill="url(#${id}-e)" stroke="${metal.light}" stroke-opacity="0.45" stroke-width="0.8"/>` +
    gem(metal, 32, gemTop, gemWidth) +
    marks(rankTier(rank), ORANGE, metal.light) +
    sparkle +
    lights(id, outer) +
    `</svg>`
  );
}

/** The achievements a person can hold beside their rank badges. */
export const ACHIEVEMENT_IDS = ["FIRST_FRIEND", "FIVE_FRIENDS", "LAUNCH_ON_DEX"] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

/** Pictograms drawn on a 64 box, centred on the face; stroke only, round ends. */
function pictogram(id: AchievementId, color: string): string {
  const stroke = `fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`;
  const person = (cx: number, cy: number, scale: number) =>
    `<circle cx="${r2(cx)}" cy="${r2(cy - 5.5 * scale)}" r="${r2(3.6 * scale)}" ${stroke}/>` +
    `<path d="M${r2(cx - 6.5 * scale)} ${r2(cy + 7 * scale)}c0-4.2 2.9-6.6 ${r2(6.5 * scale)}-6.6s${r2(6.5 * scale)} 2.4 ${r2(6.5 * scale)} 6.6" ${stroke}/>`;
  switch (id) {
    case "FIRST_FRIEND":
      /* One person and the plus that brought them. */
      return person(28.5, 33, 1) + `<path d="M40 27.5v8M36 31.5h8" ${stroke}/>`;
    case "FIVE_FRIENDS":
      /* Three people, the middle one forward: a circle of friends. */
      return person(22.5, 34, 0.78) + person(41.5, 34, 0.78) + person(32, 32.5, 1);
    case "LAUNCH_ON_DEX":
      /* A curve that climbs and leaves straight: the bonding curve, then the market. */
      return `<path d="M19 42c6 0 9-3 12-9s5-9 9-10" ${stroke}/><path d="M40 23l6-6M41 17h5v5" ${stroke}/><path d="M19 45.5h26" ${stroke} stroke-opacity="0.45"/>`;
  }
}

/**
 * An achievement's badge: the same medallion, round, in its teal enamel with
 * its pictogram — or in slate while it is not yet earned.
 */
export function achievementBadgeSvg(achievement: AchievementId, options: BadgeOptions & { earned: boolean }): string {
  const id = idPrefix(options.id);
  const metal = options.earned ? ACHIEVEMENT_METAL : LOCKED_METAL;
  const outer = circle(32, 32, 30);
  const inner = circle(32, 32, 24.5);
  if (!options.earned) {
    return svgOpen(options.size, options.title) + lockedRim(outer, inner) + pictogram(achievement, LOCKED_METAL.mid) + `</svg>`;
  }
  return (
    svgOpen(options.size, options.title) +
    `<defs>${metalGradient(`${id}-m`, metal)}${enamelGradient(`${id}-e`)}</defs>` +
    `<path d="${outer}" fill="url(#${id}-m)" stroke="${metal.edge}" stroke-width="1"/>` +
    gloss(`${id}-g`, outer) +
    `<path d="${inner}" fill="url(#${id}-e)" stroke="${metal.light}" stroke-opacity="0.45" stroke-width="0.8"/>` +
    pictogram(achievement, ACHIEVEMENT_METAL.light) +
    lights(id, outer) +
    `</svg>`
  );
}

/* ------------------------------------------------------------------ avatar */

/** The frame ring's centre line, and the width of the gem that sits on it. */
const FRAME_RING = 26;
const FRAME_GEM = 11;

/** FNV-1a over the address: the same wallet always draws the same face. */
function hash(text: string): number {
  return fnv(text);
}

/**
 * The number a wallet's face is drawn from. A board sends this rather than
 * the address, so a page can draw the same face beside a masked name.
 */
export function walletFace(wallet: string): number {
  return hash(wallet);
}

function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Faces for wallets: pairs of colours that sit beside the brand on the dark
 * ground and the light one, none of them the brand orange, a rank's metal or
 * the achievements' teal — the orange belongs to actions and rank marks, the
 * metals to frames, the teal to achievements.
 */
const AVATAR_PAIRS: readonly (readonly [string, string])[] = [
  ["#6366F1", "#E2557A"],
  ["#8B5CF6", "#0EA5E9"],
  ["#84CC16", "#0EA5E9"],
  ["#EC4899", "#8B5CF6"],
  ["#E2557A", "#8B5CF6"],
  ["#0EA5E9", "#6366F1"],
  ["#22C55E", "#0EA5E9"],
  ["#A855F7", "#EC4899"],
];

/**
 * A wallet's face with the frame of its rank: a disc in two colours chosen
 * by the address, a quiet shape across it, and — from Silver up — a ring of
 * the rank's metal with the rank gem at its top. Below Silver, or when the
 * rank is unknown, no frame: the disc alone.
 */
export function walletAvatarSvg(wallet: string, rank: RewardRank | null, options: BadgeOptions = {}): string {
  return faceAvatarSvg(hash(wallet), rank, options);
}

/** The same face from its number ({@link walletFace}) — for a page that has only a masked name. */
export function faceAvatarSvg(seed: number, rank: RewardRank | null, options: BadgeOptions = {}): string {
  const id = idPrefix(options.id);
  const h = seed >>> 0;
  const [a, b] = AVATAR_PAIRS[h % AVATAR_PAIRS.length];
  const angle = (h >>> 3) % 360;
  /* Three quiet shapes; never a rotated square, which would read as a gem. */
  const shape = (h >>> 11) % 3;
  const framed = hasAvatarFrame(rank);
  /* Framed, the face is smaller so the ring and the gem on its line stay inside the box. */
  const radius = framed ? 21.5 : 30;
  const face =
    shape === 0
      ? `<circle cx="${r2(32 + radius * 0.28)}" cy="${r2(32 - radius * 0.22)}" r="${r2(radius * 0.42)}" fill="#FFFFFF" fill-opacity="0.22"/>`
      : shape === 1
        ? `<path d="M${r2(32 - radius)} ${r2(32 + radius * 0.25)}Q32 ${r2(32 - radius * 0.6)} ${r2(32 + radius)} ${r2(32 + radius * 0.1)}V${r2(32 + radius)}H${r2(32 - radius)}Z" fill="#FFFFFF" fill-opacity="0.18"/>`
        : `<circle cx="${r2(32 - radius * 0.3)}" cy="${r2(32 + radius * 0.25)}" r="${r2(radius * 0.26)}" fill="#FFFFFF" fill-opacity="0.24"/><circle cx="${r2(32 + radius * 0.34)}" cy="${r2(32 - radius * 0.3)}" r="${r2(radius * 0.16)}" fill="#FFFFFF" fill-opacity="0.24"/>`;
  const disc =
    `<clipPath id="${id}-c"><circle cx="32" cy="32" r="${radius}"/></clipPath>` +
    `<linearGradient id="${id}-f" gradientTransform="rotate(${angle} 0.5 0.5)"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
  if (!framed) {
    return (
      svgOpen(options.size, options.title) +
      `<defs>${disc}</defs>` +
      `<g clip-path="url(#${id}-c)"><rect width="64" height="64" fill="url(#${id}-f)"/>${face}</g>` +
      `</svg>`
    );
  }
  const metal = RANK_METALS[rank];
  return (
    svgOpen(options.size, options.title) +
    `<defs>${disc}${metalGradient(`${id}-m`, metal)}</defs>` +
    `<circle cx="32" cy="32" r="${FRAME_RING}" fill="none" stroke="url(#${id}-m)" stroke-width="5"/>` +
    `<circle cx="32" cy="32" r="${FRAME_RING + 2.9}" fill="none" stroke="${metal.edge}" stroke-width="0.8"/>` +
    `<circle cx="32" cy="32" r="${FRAME_RING - 2.5}" fill="${ENAMEL_BOTTOM}"/>` +
    `<g clip-path="url(#${id}-c)"><rect width="64" height="64" fill="url(#${id}-f)"/>${face}</g>` +
    /* The gem sits on the ring: its girdle on the ring's own line. */
    gem(metal, 32, 32 - FRAME_RING - FRAME_GEM * 0.3, FRAME_GEM) +
    `</svg>`
  );
}

/* ---------------------------------------------------------------- seasons */

/**
 * The season's enamel: an amethyst no rank, achievement or action wears — a
 * season badge reads as a season, never as a rank or a button.
 */
export const SEASON_METAL: Metal = { light: "#EBD3FF", mid: "#A869DB", dark: "#5E2C8C", edge: "#43206A" };

export const SEASON_BADGE_IDS = ["SEASON", "PODIUM"] as const;
export type SeasonBadgeId = (typeof SEASON_BADGE_IDS)[number];

/** A rounded square around (32, 32): the season's medallion, beside the rank's hexagon and the achievement's circle. */
function squircle(half: number, corner: number): string {
  const lo = 32 - half;
  const hi = 32 + half;
  return roundedPolygon([[lo, lo], [hi, lo], [hi, hi], [lo, hi]], corner);
}

/** The season's pictograms: a pennant on its pole for a season done, three steps for the podium. */
function seasonPictogram(id: SeasonBadgeId, color: string): string {
  const stroke = `fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`;
  if (id === "SEASON") {
    return `<path d="M22 47V17" ${stroke}/><path d="M22 18.5c5-2.6 9 2.6 14 0s7-1 9 .5v13c-2-1.5-4-2.7-9-.5s-9-2.6-14 0z" fill="${color}" fill-opacity="0.35" ${stroke}/>`;
  }
  return `<path d="M18 45V36h9v9M27 45V29h10v16M37 45V39h9v6M16 45h32" ${stroke}/><path d="M32 18.5l1.3 2.7 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z" ${stroke} stroke-width="1.6"/>`;
}

/**
 * A season badge: the medallion as a rounded square in the season's amethyst
 * with its pictogram — or, not yet earned, the rim alone in slate, like every
 * other badge.
 */
export function seasonBadgeSvg(badge: SeasonBadgeId, options: BadgeOptions & { earned: boolean }): string {
  const id = idPrefix(options.id);
  const outer = squircle(28, 9);
  const inner = squircle(22.5, 6.5);
  if (!options.earned) {
    return svgOpen(options.size, options.title) + lockedRim(outer, inner) + seasonPictogram(badge, LOCKED_METAL.mid) + `</svg>`;
  }
  return (
    svgOpen(options.size, options.title) +
    `<defs>${metalGradient(`${id}-m`, SEASON_METAL)}${enamelGradient(`${id}-e`)}</defs>` +
    `<path d="${outer}" fill="url(#${id}-m)" stroke="${SEASON_METAL.edge}" stroke-width="1"/>` +
    gloss(`${id}-g`, outer) +
    `<path d="${inner}" fill="url(#${id}-e)" stroke="${SEASON_METAL.light}" stroke-opacity="0.45" stroke-width="0.8"/>` +
    seasonPictogram(badge, SEASON_METAL.light) +
    lights(id, outer) +
    `</svg>`
  );
}
