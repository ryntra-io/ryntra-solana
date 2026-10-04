import type { InstrumentClass, Observed, RadarRow } from "./radar.ts";
import { isTradable } from "./radar.ts";

/**
 * The Screener: conditions a person states, over the universe Radar shows.
 *
 * Radar is **pushed** — the product decides what is worth showing. This is
 * **queried** — the person decides, and gets back the set that matches.
 * Keeping them apart is the single most important structural decision in the
 * product, because collapsing discovery into one "markets screen" is what
 * makes every competitor's surface interchangeable.
 *
 * Two rules carry the weight here, and both are about the same thing:
 *
 *   1. **A screen has three answers per row, not two.** `match`, `miss`, and
 *      `unjudgeable` — because 51 of 231 instruments have no price/earnings
 *      ratio and 20 have no listing date. A screen that treats an absent
 *      number as a miss quietly reports "no crypto token passed the P/E
 *      filter", which is a finding it did not make. One that treats it as 0
 *      reports the opposite and is worse. Absence is its own verdict and it is
 *      returned to the caller by name.
 *   2. **A Screen cannot raise an event.** There is no callback, no listener
 *      and no subscription in this file, and `scan.ts` has no result set. That
 *      is what makes them two objects rather than two views over one query,
 *      which is the acceptance this module is written against.
 *
 * Nothing here fetches. A screen runs against rows a caller already has, which
 * is what lets the same screen be re-run later against a changed universe and
 * answer for *then* rather than replaying a cached answer.
 */

/* ------------------------------------------------------------------ fields */

export type ScreenFieldId =
  | "class"
  | "venueVerified"
  | "executable"
  | "classAgreed"
  | "price"
  | "changePercent24h"
  | "volume24h"
  | "marketCap"
  | "peRatio"
  | "dividendYield"
  | "priceToBook"
  | "listedDaysAgo";

export type FieldKind = "number" | "enum" | "flag";

export type ScreenField = Readonly<{
  id: ScreenFieldId;
  label: string;
  kind: FieldKind;
  /** The exact venue field this reads. Rendered beside the condition, never inferred. */
  source: string;
  unit?: string;
  options?: readonly string[];
  /** How many of the universe this field can judge is a *measured* fact, not a claim. */
  read: (row: RadarRow, now: number) => Observed<number | string | boolean>;
}>;

const known = <T,>(value: T, source: string): Observed<T> =>
  Object.freeze({ known: true as const, value, source });

const CLASS_OPTIONS: readonly InstrumentClass[] = ["STOCK_TOKEN", "GENERIC_ERC20", "COMMUNITY_TOKEN"];

/**
 * Every field a condition may read.
 *
 * A field that is not here cannot be screened on, which is deliberate: the
 * list is the contract with the data, and adding one means having a source for
 * it. `listedDaysAgo` is derived rather than stored, because a person screens
 * on *how new* and the venue stamps *when*.
 */
export const SCREEN_FIELDS: readonly ScreenField[] = Object.freeze([
  Object.freeze({
    id: "class" as const,
    label: "Instrument class",
    kind: "enum" as const,
    source: "derived from the venue's category, both endpoints",
    options: CLASS_OPTIONS,
    read: (row: RadarRow) => known<string>(row.instrumentClass, "radar:instrumentClass"),
  }),
  Object.freeze({
    id: "venueVerified" as const,
    label: "Verified by the venue",
    kind: "flag" as const,
    source: "arcus:spot-tokens.verified",
    read: (row: RadarRow) => known<boolean>(row.venueVerified, "arcus:spot-tokens.verified"),
  }),
  Object.freeze({
    id: "executable" as const,
    label: "Executable through Ryntra",
    kind: "flag" as const,
    /* Derived, never read: tradability needs a route *and* a live price, and
       `radar.ts` refuses to store it as a field for exactly that reason. */
    source: "derived — a pre-signed route and a live price, both required",
    read: (row: RadarRow) => known<boolean>(isTradable(row.tradability), "radar:isTradable"),
  }),
  Object.freeze({
    id: "classAgreed" as const,
    label: "Both venue endpoints agree on the class",
    kind: "flag" as const,
    source: "arcus:spot-tokens.category vs arcus:spot-overview.category",
    read: (row: RadarRow) => known<boolean>(row.origin.agreed, "radar:origin"),
  }),
  Object.freeze({
    id: "price" as const,
    label: "Price",
    kind: "number" as const,
    unit: "USD",
    source: "arcus:spot-overview.quote.price",
    read: (row: RadarRow) => row.price,
  }),
  Object.freeze({
    id: "changePercent24h" as const,
    label: "24-hour change",
    kind: "number" as const,
    unit: "%",
    source: "arcus:spot-overview.quote.changePercent24h",
    read: (row: RadarRow) => row.changePercent24h,
  }),
  Object.freeze({
    id: "volume24h" as const,
    label: "24-hour volume",
    kind: "number" as const,
    source: "arcus:spot-overview.quote.volume24h",
    read: (row: RadarRow) => row.volume24h,
  }),
  Object.freeze({
    id: "marketCap" as const,
    label: "Market capitalisation",
    kind: "number" as const,
    unit: "USD",
    source: "arcus:spot-overview.financials.marketCap",
    read: (row: RadarRow) => row.fundamentals.marketCap,
  }),
  Object.freeze({
    id: "peRatio" as const,
    label: "Price / earnings",
    kind: "number" as const,
    source: "arcus:spot-overview.financials.peRatio",
    read: (row: RadarRow) => row.fundamentals.peRatio,
  }),
  Object.freeze({
    id: "dividendYield" as const,
    label: "Dividend yield",
    kind: "number" as const,
    unit: "%",
    source: "arcus:spot-overview.financials.dividendYield",
    read: (row: RadarRow) => row.fundamentals.dividendYield,
  }),
  Object.freeze({
    id: "priceToBook" as const,
    label: "Price / book",
    kind: "number" as const,
    source: "arcus:spot-overview.financials.priceToBook",
    read: (row: RadarRow) => row.fundamentals.priceToBook,
  }),
  Object.freeze({
    id: "listedDaysAgo" as const,
    label: "Listed within",
    kind: "number" as const,
    unit: "days",
    source: "arcus:spot-tokens.addedTimestamp",
    read: (row: RadarRow, now: number) =>
      row.listedAt.known
        ? known<number>(Math.max(0, (now - row.listedAt.value) / 86_400_000), "derived from addedTimestamp")
        : row.listedAt,
  }),
]);

export function screenField(id: ScreenFieldId): ScreenField | undefined {
  return SCREEN_FIELDS.find((field) => field.id === id);
}

/* -------------------------------------------------------------- conditions */

/**
 * `atMost` on `listedDaysAgo` is how "new listings" is expressed — a person
 * asks for what appeared recently, not for a timestamp range.
 */
export type Comparator = "is" | "isNot" | "atLeast" | "atMost";

export type ConditionValue = number | string | boolean;

export type Condition = Readonly<{
  field: ScreenFieldId;
  op: Comparator;
  value: ConditionValue;
}>;

export type Screen = Readonly<{
  id: string;
  name: string;
  conditions: readonly Condition[];
}>;

/** The three answers. `unjudgeable` is the one that makes this honest. */
export type Verdict = "match" | "miss" | "unjudgeable";

/**
 * One condition against one row.
 *
 * A numeric comparator against a value that was never observed returns
 * `unjudgeable`, not `miss`. That distinction is the whole file: `miss` says
 * *this instrument does not meet your condition*, and only a number can say
 * that.
 */
export function judge(condition: Condition, row: RadarRow, now: number): Verdict {
  const field = screenField(condition.field);
  if (!field) return "unjudgeable";

  const read = field.read(row, now);
  if (!read.known) return "unjudgeable";

  const observedValue = read.value;

  if (condition.op === "is" || condition.op === "isNot") {
    const same = observedValue === condition.value;
    return (condition.op === "is") === same ? "match" : "miss";
  }

  if (typeof observedValue !== "number" || typeof condition.value !== "number") return "unjudgeable";
  const passes = condition.op === "atLeast" ? observedValue >= condition.value : observedValue <= condition.value;
  return passes ? "match" : "miss";
}

/* ------------------------------------------------------------------ result */

export type Unjudged = Readonly<{
  symbol: string;
  field: ScreenFieldId;
  /** The venue's own reason the figure is absent, carried through untouched. */
  reason: string;
}>;

export type ScreenResult = Readonly<{
  /** Rows every condition judged, and judged as a match. */
  matched: readonly RadarRow[];
  /** Rows at least one condition could not judge. Never silently a miss. */
  unjudged: readonly Unjudged[];
  /** How many rows were considered at all. */
  checked: number;
  /** When it ran. A screen re-run later answers for then, not for now. */
  ranAt: number;
}>;

/**
 * Run a screen.
 *
 * A row matches only when **every** condition returns `match`. A row any
 * condition cannot judge is excluded from `matched` and reported in
 * `unjudged` with the field and the venue's own reason — so a surface can say
 * *twelve matched, and fifty-one could not be judged on price/earnings*
 * instead of quietly reporting twelve out of a universe of 231.
 *
 * A screen with no conditions matches everything, which is the correct answer
 * to "show me the universe" and needs no special case.
 */
export function runScreen(screen: Screen, rows: readonly RadarRow[], now: number): ScreenResult {
  const matched: RadarRow[] = [];
  const unjudged: Unjudged[] = [];

  for (const row of rows) {
    let verdict: Verdict = "match";
    for (const condition of screen.conditions) {
      const answer = judge(condition, row, now);
      if (answer === "unjudgeable") {
        const field = screenField(condition.field);
        const read = field?.read(row, now);
        unjudged.push(
          Object.freeze({
            symbol: row.symbol,
            field: condition.field,
            reason: read && !read.known ? read.reason : "this condition names a field that does not exist",
          }),
        );
        verdict = "unjudgeable";
        break;
      }
      if (answer === "miss") {
        verdict = "miss";
        break;
      }
    }
    if (verdict === "match") matched.push(row);
  }

  return Object.freeze({
    matched: Object.freeze(matched),
    unjudged: Object.freeze(unjudged),
    checked: rows.length,
    ranAt: now,
  });
}

/* ----------------------------------------------------------------- presets */

/**
 * Starting points, not modes.
 *
 * Each is an ordinary set of conditions in the same grammar a person can edit,
 * so a preset is a screen they can then change — never a filter that behaves
 * differently from one they built themselves.
 *
 * **One rule is enforced by `discovery.test.mjs`, and it was written after a
 * preset shipped wrong.** *Equities under 40 P/E* carried a single condition,
 * `peRatio atMost 40`, which is literally correct and answers a different
 * question: a loss-making company has a **negative** price/earnings ratio, and
 * every one of them is "at most 40". On the live universe that quietly passed
 * `INTC` at −45.8 and `SLV` at −23.9 — a preset promising cheap earnings and
 * returning companies with none.
 *
 * The comparator is not the problem and is left literal: `atMost` means at
 * most. The problem is a *named* preset that is wider than its name. So any
 * preset that bounds a valuation multiple from above must bound it from below
 * too, and the test fails the build if a new one does not.
 */
export type ScreenPreset = Readonly<{ name: string; conditions: readonly Condition[] }>;

/** Valuation multiples: meaningless below zero, and unbounded there. */
export const VALUATION_FIELDS: readonly ScreenFieldId[] = ["peRatio", "priceToBook"];

export const SCREEN_PRESETS: readonly ScreenPreset[] = Object.freeze([
  Object.freeze({
    name: "Executable here",
    conditions: Object.freeze([Object.freeze({ field: "executable" as const, op: "is" as const, value: true })]),
  }),
  Object.freeze({
    name: "Listed this week",
    conditions: Object.freeze([Object.freeze({ field: "listedDaysAgo" as const, op: "atMost" as const, value: 7 })]),
  }),
  Object.freeze({
    name: "Unverified listings",
    conditions: Object.freeze([Object.freeze({ field: "venueVerified" as const, op: "is" as const, value: false })]),
  }),
  Object.freeze({
    name: "Equities earning, under 40 P/E",
    conditions: Object.freeze([
      Object.freeze({ field: "class" as const, op: "is" as const, value: "STOCK_TOKEN" }),
      /* The floor is the point. Without it this reads as a valuation screen and
         behaves as "everything except the expensive". */
      Object.freeze({ field: "peRatio" as const, op: "atLeast" as const, value: 0 }),
      Object.freeze({ field: "peRatio" as const, op: "atMost" as const, value: 40 }),
    ]),
  }),
  Object.freeze({
    name: "Pays a dividend",
    conditions: Object.freeze([Object.freeze({ field: "dividendYield" as const, op: "atLeast" as const, value: 0.01 })]),
  }),
]);

/* ------------------------------------------------------------------- codec */

const COMPARATORS: readonly Comparator[] = ["is", "isNot", "atLeast", "atMost"];

/** Conditions never exceed this many. A URL is untrusted input, not a query plan. */
export const MAX_CONDITIONS = 12;

/**
 * Conditions live in the URL, and that is a product decision rather than a
 * storage one.
 *
 * "Saved as a named screen, re-runnable" is what the product asks for, and a
 * screen whose conditions are in the address bar is re-runnable by definition —
 * the same link run tomorrow answers for tomorrow. It also keeps the universe
 * on the server: the alternative shipped all 231 rows to the browser so a
 * filter could run there, which is a lot of bytes to move in order to hide
 * most of them again.
 *
 * A saved screen is then a **name and a set of conditions**, and nothing else.
 * It stores no result and no market data, so it cannot go stale — it can only
 * be re-run.
 */
export function encodeConditions(conditions: readonly Condition[]): readonly string[] {
  return conditions.slice(0, MAX_CONDITIONS).map((c) => `${c.field}.${c.op}.${String(c.value)}`);
}

/**
 * Read conditions back out of a URL.
 *
 * Defensive throughout, for the same reason `layout-store` is: this is a value
 * a person can hand-edit or a link someone else wrote. An unknown field, an
 * unknown comparator or a value the field cannot hold is **dropped**, never
 * coerced — a screen that silently reinterprets a condition answers a question
 * nobody asked.
 */
export function decodeConditions(raw: string | readonly string[] | undefined): readonly Condition[] {
  const parts = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw as string];
  const out: Condition[] = [];

  for (const part of parts.slice(0, MAX_CONDITIONS * 2)) {
    if (typeof part !== "string") continue;
    const at = part.indexOf(".");
    const then = part.indexOf(".", at + 1);
    if (at < 1 || then < at + 2) continue;

    const fieldId = part.slice(0, at) as ScreenFieldId;
    const op = part.slice(at + 1, then) as Comparator;
    const rawValue = part.slice(then + 1);

    const field = screenField(fieldId);
    if (!field) continue;
    if (!COMPARATORS.includes(op)) continue;

    let value: ConditionValue | undefined;
    if (field.kind === "number") {
      if (op === "is" || op === "isNot") continue; // a number is compared, not matched
      const n = Number(rawValue);
      if (!Number.isFinite(n)) continue;
      value = n;
    } else if (field.kind === "flag") {
      if (rawValue !== "true" && rawValue !== "false") continue;
      value = rawValue === "true";
    } else {
      if (op === "atLeast" || op === "atMost") continue; // an enum is not ordered
      if (field.options && !field.options.includes(rawValue)) continue;
      value = rawValue;
    }

    out.push(Object.freeze({ field: fieldId, op, value: value as ConditionValue }));
    if (out.length >= MAX_CONDITIONS) break;
  }

  return Object.freeze(out);
}

/** One condition as a person reads it, with the field's own label and unit. */
export function describeCondition(condition: Condition): string {
  const field = screenField(condition.field);
  const label = field?.label ?? condition.field;
  const unit = field?.unit ? ` ${field.unit}` : "";
  const word =
    condition.op === "is" ? "is" : condition.op === "isNot" ? "is not" : condition.op === "atLeast" ? "at least" : "at most";
  const value = typeof condition.value === "boolean" ? (condition.value ? "yes" : "no") : String(condition.value);
  return `${label} ${word} ${value}${unit}`;
}

/**
 * How much of the universe a field can judge at all.
 *
 * Shown beside each field so a person picks a condition knowing what it can
 * see. It is measured against the rows in hand rather than remembered from a
 * probe, because coverage moves when the venue's data does.
 */
export function fieldCoverage(field: ScreenField, rows: readonly RadarRow[], now: number): Readonly<{
  judgeable: number;
  total: number;
}> {
  let judgeable = 0;
  for (const row of rows) if (field.read(row, now).known) judgeable += 1;
  return Object.freeze({ judgeable, total: rows.length });
}
