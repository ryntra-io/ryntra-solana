import { ARRIVALS, MAX_FLOORS, MODULES } from "./catalog";
import {
  CREW_COLOURS,
  type CrewColour, type CrewHq, type CrewMember, type CrewRefusal, type CrewScore, type Day, type Id,
} from "./contract";
import { cleanCrewName } from "./text-safety/clean";

/**
 * A crew is a street (CITY-20, decision 71): people make one, or join by a link or a code, and their quarters move into
 * one row of one street of Arrivals that the crew holds. Across the street they build the crew's headquarters together,
 * with modules and points. Nothing here is money: no gift is a transaction, no figure is a price.
 *
 * Pure and client-safe, like `rules.ts` and `layout.ts`: the server checks every step with these, the city checks the
 * same way before it sends one, and the device's world (`city/lib/quarter/crew-mock.ts`) answers by them too.
 */

/**
 * Crews stay closed until the owner opens them, as free building did: `NEXT_PUBLIC_RYNTRA_CITY_CREWS=open` serves them
 * from the world's server (after the migration `20261031090000_world_crews.sql` is applied); `device` shows them on the
 * device's world only, for a look before that. Anything else: no crew anywhere in a production build.
 */
export type CrewsMode = "open" | "device" | "closed";
export function crewsMode(flag: string | undefined): CrewsMode {
  return flag === "open" ? "open" : flag === "device" ? "device" : "closed";
}

/** As many people as one side of a street has lots: the crew's row. */
export const CREW_LIMIT = ARRIVALS.streetLength / 2;

/** The lots of the crew's row: the street's north side, nearest the bridge first. */
export const MEMBER_LOTS: readonly number[] = Array.from({ length: CREW_LIMIT }, (_, i) => 2 * i);

/** The headquarters stands across the street from the first member, by the bridge. */
export const HQ_LOT = 1;

/** The first free lot of the crew's row, or null when it is full. */
export function memberLot(taken: readonly number[]): number | null {
  const used = new Set(taken);
  return MEMBER_LOTS.find((lot) => !used.has(lot)) ?? null;
}

/* ---------------------------------------------------------------- colour -- */

/** The colours as light: the city's player lights (`city/lib/trade/colour.ts`), never amber, mint or red. */
export const CREW_LIGHT: Readonly<Record<CrewColour, string>> = {
  cyan: "#5CE1FF",
  sky: "#6FB6FF",
  periwinkle: "#8C9BFF",
  lilac: "#A98BFF",
  orchid: "#D883FF",
  rose: "#FF7AC8",
  lime: "#C8F560",
  pearl: "#E6D4FF",
};

export function isCrewColour(value: unknown): value is CrewColour {
  return typeof value === "string" && (CREW_COLOURS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ name -- */

/** A street's name is short enough for its sign. */
export const NAME_MAX = 24;
const NAME_MIN = 2;

/**
 * The street's name as the city may show it: somebody else's text, cleaned by CITY-73 (`cleanCrewName`) — nothing
 * invisible, no disguised word, no order to a model — then at least two letters and at most 24.
 */
export function crewName(raw: unknown): { ok: true; name: string } | { ok: false } {
  const cleaned = cleanCrewName(raw);
  if (!cleaned.ok) return { ok: false };
  const name = cleaned.text.replace(/\s+/g, " ").trim();
  const length = [...name].length;
  if (length < NAME_MIN || length > NAME_MAX) return { ok: false };
  if (!/[\p{L}\p{N}]/u.test(name)) return { ok: false };
  return { ok: true, name };
}

/** A name kept in the world, read again before it is shown: a name that fails the cleaning now is not shown. */
export function shownCrewName(kept: string): string {
  const named = crewName(kept);
  return named.ok ? named.name : "Crew";
}

/* ---------------------------------------------------------------- invite -- */

/** Letters and digits nobody reads wrong: no 0 and O, no 1, I and L. */
export const INVITE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const INVITE_LENGTH = 8;

/** A new code from random bytes (rejection-sampled, so every letter is as likely). Needs at least 16 bytes. */
export function inviteCode(random: (n: number) => Uint8Array): string {
  const n = INVITE_ALPHABET.length;
  const cut = 256 - (256 % n);
  let code = "";
  while (code.length < INVITE_LENGTH) {
    for (const byte of random(16)) {
      if (byte >= cut) continue;
      code += INVITE_ALPHABET[byte % n];
      if (code.length === INVITE_LENGTH) break;
    }
  }
  return code;
}

/** A code as a person typed or pasted it — any case, with spaces or a dash — or null when it is not a code. */
export function normalInvite(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== INVITE_LENGTH) return null;
  for (const ch of code) if (!INVITE_ALPHABET.includes(ch)) return null;
  return code;
}

/** «K7Q2MX9P» reads as «K7Q2-MX9P». */
export const shownInvite = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

/* ------------------------------------------------------------------- hq -- */

/** Units the headquarters needs for each level, from 1 to 5. */
export const HQ_LEVELS: readonly number[] = [0, 50, 150, 300, 500];
/** A module given counts this many units; a point given counts one. */
export const MODULE_UNITS = 25;
/** One gift of points, at least and at most. */
export const POINTS_GIFT = { min: 5, max: 100 } as const;

export function hqLevel(units: number): number {
  let level = 1;
  for (let i = 1; i < HQ_LEVELS.length; i += 1) if (units >= HQ_LEVELS[i]!) level = i + 1;
  return level;
}

/**
 * What the headquarters wears: the newest module given of each part — one base, the newest floors up to what its
 * level carries, one roof, one light, one sign. `given` is newest first.
 */
export function hqModules(given: readonly string[], level: number): string[] {
  const floors = Math.min(MAX_FLOORS, Math.max(0, level - 1));
  const out: string[] = [];
  const seen = new Set<string>();
  let floorCount = 0;
  for (const id of given) {
    const part = MODULES[id]?.part;
    if (!part) continue;
    if (part === "floor") {
      if (floorCount < floors) {
        out.push(id);
        floorCount += 1;
      }
      continue;
    }
    if (seen.has(part)) continue;
    seen.add(part);
    out.push(id);
  }
  return out;
}

export function hqOf(units: number, given: readonly string[]): CrewHq {
  const level = hqLevel(units);
  return { level, units, next: level < HQ_LEVELS.length ? HQ_LEVELS[level]! : null, modules: hqModules(given, level) };
}

/**
 * The module a one-tap gift brings: the first part the headquarters still lacks — a base, a floor its level carries, a
 * roof, a light, a sign — else one more floor, as the best of that part the giver's quarter level opens.
 */
export function suggestedModule(hq: CrewHq, quarterLevel: number): string | null {
  const has = (part: string) => hq.modules.some((m) => MODULES[m]?.part === part);
  const floors = hq.modules.filter((m) => MODULES[m]?.part === "floor").length;
  const want = !has("base") ? "base" : floors < Math.min(MAX_FLOORS, hq.level - 1) ? "floor" : !has("roof") ? "roof" : !has("light") ? "light" : !has("sign") ? "sign" : "floor";
  let best: string | null = null;
  for (const [id, rule] of Object.entries(MODULES)) {
    if (rule.part !== want || rule.from > quarterLevel) continue;
    if (!best || rule.from >= MODULES[best]!.from) best = id;
  }
  return best;
}

export type Gift = { kind: "module"; module: string; points: 0; units: number } | { kind: "points"; module: null; points: number; units: number };

/**
 * A gift towards the headquarters, checked: a module the giver's quarter level opens, or points they still have to
 * give, each kind once a day. Points given stay in the giver's total, so a quarter never loses a level; they just
 * cannot be given twice.
 */
export function planGift(input: {
  body: unknown;
  quarterLevel: number;
  /** The giver's points not given yet. */
  points: number;
  gave: { module: boolean; points: boolean };
}): { ok: true; gift: Gift } | { ok: false; reason: CrewRefusal | "shape" } {
  const body = input.body as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return { ok: false, reason: "shape" };
  if (body.kind === "module") {
    const id = body.module;
    if (typeof id !== "string" || !(id in MODULES)) return { ok: false, reason: "shape" };
    if (MODULES[id]!.from > input.quarterLevel) return { ok: false, reason: "module" };
    if (input.gave.module) return { ok: false, reason: "today" };
    return { ok: true, gift: { kind: "module", module: id, points: 0, units: MODULE_UNITS } };
  }
  if (body.kind === "points") {
    const n = body.points;
    if (typeof n !== "number" || !Number.isInteger(n) || n < POINTS_GIFT.min || n > POINTS_GIFT.max) return { ok: false, reason: "shape" };
    if (input.gave.points) return { ok: false, reason: "today" };
    if (n > input.points) return { ok: false, reason: "points" };
    return { ok: true, gift: { kind: "points", module: null, points: n, units: n } };
  }
  return { ok: false, reason: "shape" };
}

/* ------------------------------------------------------------- the score -- */

/** The war's count (CITY-21): a person's actions count up to three a day; a verified member counts five. */
export const SCORE = { actionsPerDay: 3, verified: 5 } as const;

/** The kinds of action a street's score counts: what a person did in the world, never what they bought. */
export const SCORED_ACTIONS = ["build", "visit", "gift"] as const;
export type ScoredAction = (typeof SCORED_ACTIONS)[number];

/** The Monday a moment's week starts on, in UTC: the war's week. */
export function weekOf(at: Date): Day {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const back = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - back);
  return day.toISOString().slice(0, 10);
}

/**
 * The street's score for the week: the members' actions of the week, at most three a person a day, and five for each
 * verified member. An action of somebody no longer in the crew does not count.
 */
export function crewScore(input: {
  week: Day;
  members: readonly { residentId: Id; verified: boolean }[];
  actions: readonly { residentId: Id; day: Day; kind: string }[];
}): CrewScore {
  const members = new Set(input.members.map((m) => m.residentId));
  const perDay = new Map<string, number>();
  for (const a of input.actions) {
    if (!members.has(a.residentId) || a.day < input.week || !(SCORED_ACTIONS as readonly string[]).includes(a.kind)) continue;
    const key = `${a.residentId}|${a.day}`;
    perDay.set(key, Math.min(SCORE.actionsPerDay, (perDay.get(key) ?? 0) + 1));
  }
  const actions = [...perDay.values()].reduce((sum, n) => sum + n, 0);
  const verified = input.members.filter((m) => m.verified).length;
  return { week: input.week, actions, verified, total: actions + verified * SCORE.verified };
}

/** Members in the order of their lots, nearest the bridge first. */
export const byLot = (people: readonly CrewMember[]): CrewMember[] => [...people].sort((a, b) => a.lot - b.lot);
