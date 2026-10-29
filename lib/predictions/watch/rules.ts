/**
 * What a person asks Ryntra to watch on a prediction market, and nothing
 * more.
 *
 * A rule is a small, closed shape: the market and outcome it is about, one of
 * the nine things that can be watched, a direction, a figure and a period.
 * That shape is the whole agreement — the engine reads it, the pass reads it,
 * the page draws it, and none of them may widen it. A rule is never
 * permission to act: it cannot carry an amount, a venue, a side to buy or a
 * destination, and no field here can be read as one.
 *
 * The nine kinds are the nine questions people actually ask about a market
 * they care about:
 *
 * | kind | what it watches |
 * |---|---|
 * | `price` | the outcome's own price crossing a level |
 * | `probability_move` | the probability moving by so much over a period |
 * | `volume_spike` | an hour's trading against the period's own pace |
 * | `liquidity` | the book gone thin, or the spread gone wide |
 * | `news` | a news item about this market nobody has seen here yet |
 * | `resolution` | the rules changed, a date moved, or the result is late |
 * | `position_value` | what the person's own position is worth |
 * | `venue_spread` | the venues' prices for the same market pulling apart |
 * | `related_move` | a market linked to this one moving |
 *
 * A rule is set by hand or dictated in words («Спитати Ryntra»): the words
 * are read here, deterministically, into the same shape — and the person sees
 * that shape and turns the watch on themselves. Nothing is watched until they
 * do.
 *
 * Pure: shared by the server and the pages, so the figure a page shows is the
 * figure the engine compares.
 */

import { z } from "zod";

/** The nine things a rule can watch. A tenth needs a branch in the engine, words in both languages and a test of its own. */
export const WATCH_RULE_KINDS = Object.freeze(["price", "probability_move", "volume_spike", "liquidity", "news", "resolution", "position_value", "venue_spread", "related_move"] as const);
export type WatchRuleKind = (typeof WATCH_RULE_KINDS)[number];

export const WATCH_DIRECTIONS = Object.freeze(["above", "below", "any"] as const);
export type WatchDirection = (typeof WATCH_DIRECTIONS)[number];

/** How many rules one wallet may hold; past it the oldest must go before a new one is taken. */
export const WATCH_RULES_LIMIT = 40;

const Id = z.string().min(1).max(64);
const Text = z.string().min(1).max(300);

/**
 * The market a rule is about, as the person's own page knew it. The ids are
 * the provider's; the two titles are kept so a signal reads as a sentence
 * about a market even when the provider cannot be reached.
 */
export const WatchSubjectSchema = z
  .object({
    eventId: Id,
    eventTitle: Text,
    venueMarketId: Id,
    question: Text,
    /** The outcome the person watches; null for a rule about the whole market (news, the rules, the venues). */
    outcomeId: Id.nullable(),
    outcomeLabel: z.string().min(1).max(64).nullable(),
  })
  .strict();
export type WatchSubject = z.infer<typeof WatchSubjectSchema>;

export const WatchRuleInputSchema = z
  .object({
    kind: z.enum(WATCH_RULE_KINDS),
    subject: WatchSubjectSchema,
    direction: z.enum(WATCH_DIRECTIONS),
    /** The figure the kind compares against; null for a kind that compares none. */
    threshold: z.number().finite().nullable(),
    /** The period the kind looks back over, in minutes; null for a kind that looks at now. */
    windowMinutes: z.number().finite().nullable(),
    /** The person's own line about why they are watching; shown back to them, never sent to a model. */
    note: z.string().max(240).nullable(),
  })
  .strict();
export type WatchRuleInput = z.infer<typeof WatchRuleInputSchema>;

/** What a kind takes, so a page can draw the right field and the server can clamp the same way. */
export type WatchThresholdShape = Readonly<{ unit: "probability" | "points" | "times" | "usd"; min: number; max: number; default: number }>;

export type WatchRuleShape = Readonly<{
  /** The directions this kind allows, the first being its default. */
  directions: readonly WatchDirection[];
  /** What the figure means, for the page's own unit and the words. */
  unit: "probability" | "points" | "times" | "usd" | "none";
  threshold: Readonly<{ min: number; max: number; default: number }> | null;
  window: Readonly<{ min: number; max: number; default: number }> | null;
  /** True for a kind that is about one outcome rather than the whole market. */
  needsOutcome: boolean;
  /**
   * A kind whose figure means something else in one direction. The book is
   * the only one: asked for a thin book the figure is USD of depth, asked for
   * a wide spread it is probability points — two scales that cannot share one
   * pair of bounds without one of them being clamped into nonsense.
   */
  byDirection?: Readonly<Partial<Record<WatchDirection, WatchThresholdShape>>>;
}>;

const DAY = 1_440;

export const WATCH_RULE_SHAPES: Readonly<Record<WatchRuleKind, WatchRuleShape>> = {
  price: { directions: ["above", "below"], unit: "probability", threshold: { min: 0.01, max: 0.99, default: 0.6 }, window: null, needsOutcome: true },
  probability_move: { directions: ["any", "above", "below"], unit: "points", threshold: { min: 0.01, max: 0.9, default: 0.1 }, window: { min: 15, max: 7 * DAY, default: DAY }, needsOutcome: true },
  volume_spike: { directions: ["above"], unit: "times", threshold: { min: 1.5, max: 50, default: 3 }, window: { min: 120, max: 7 * DAY, default: DAY }, needsOutcome: true },
  /* `below` — the book thin (the figure is USD of depth); `above` — the spread wide (the figure is probability points); `any` — either, each at the product's own bound. */
  liquidity: {
    directions: ["any", "below", "above"],
    unit: "usd",
    threshold: { min: 1, max: 1_000_000, default: 250 },
    window: null,
    needsOutcome: false,
    byDirection: {
      /* Asked for either, Ryntra's own two bounds decide, and the person sets no figure. */
      below: { unit: "usd", min: 1, max: 1_000_000, default: 250 },
      above: { unit: "points", min: 0.005, max: 0.5, default: 0.05 },
    },
  },
  news: { directions: ["any"], unit: "none", threshold: null, window: null, needsOutcome: false },
  resolution: { directions: ["any"], unit: "none", threshold: null, window: null, needsOutcome: false },
  position_value: { directions: ["below", "above"], unit: "usd", threshold: { min: 1, max: 1_000_000, default: 50 }, window: null, needsOutcome: false },
  venue_spread: { directions: ["above"], unit: "points", threshold: { min: 0.01, max: 0.5, default: 0.03 }, window: null, needsOutcome: false },
  related_move: { directions: ["any", "above", "below"], unit: "points", threshold: { min: 0.02, max: 0.9, default: 0.1 }, window: { min: 60, max: 7 * DAY, default: DAY }, needsOutcome: false },
};

/** The spread that is wide, and the depth that is thin, when the person asked for «either» rather than a figure of their own. */
export const LIQUIDITY_WIDE_SPREAD = 0.05;
export const LIQUIDITY_THIN_DEPTH_USD = 250;
/** How far from the mid a level still counts as depth a person could trade into. */
export const LIQUIDITY_DEPTH_BAND = 0.1;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The bounds a kind's figure is held to in the direction asked for, and what
 * the figure means there. Null for a kind — or a direction — that takes no
 * figure of the person's at all.
 */
export function thresholdShape(kind: WatchRuleKind, direction: WatchDirection): WatchThresholdShape | null {
  const shape = WATCH_RULE_SHAPES[kind];
  if (shape.byDirection) return shape.byDirection[direction] ?? null;
  return shape.threshold === null ? null : { unit: shape.unit === "none" ? "usd" : shape.unit, ...shape.threshold };
}

/**
 * The rule as it will be stored: the kind's own directions, its figure inside
 * the bounds that direction holds it to, its period rounded to whole minutes,
 * and nothing a kind has no use for. A figure outside the bounds is brought
 * to the nearest one rather than refused — a person who typed 150 % meant the
 * top of the scale.
 */
export function normalizeRule(input: WatchRuleInput): WatchRuleInput {
  const shape = WATCH_RULE_SHAPES[input.kind];
  const direction = shape.directions.includes(input.direction) ? input.direction : shape.directions[0]!;
  const bounds = thresholdShape(input.kind, direction);
  const threshold =
    bounds === null ? null
    : input.threshold === null || !Number.isFinite(input.threshold) ? bounds.default
    : clamp(input.threshold, bounds.min, bounds.max);
  const windowMinutes =
    shape.window === null ? null
    : input.windowMinutes === null || !Number.isFinite(input.windowMinutes) ? shape.window.default
    : Math.round(clamp(input.windowMinutes, shape.window.min, shape.window.max));
  const note = input.note?.trim() ? input.note.trim().slice(0, 240) : null;
  /* A kind about the whole market keeps no outcome: a signal about the rules is not about one side of them. */
  const subject = shape.needsOutcome ? input.subject : { ...input.subject, outcomeId: null, outcomeLabel: null };
  return { kind: input.kind, subject, direction, threshold, windowMinutes, note };
}

/** Whether a rule can be watched at all: a kind about one outcome needs one named. */
export function ruleComplete(input: WatchRuleInput): boolean {
  return !WATCH_RULE_SHAPES[input.kind].needsOutcome || input.subject.outcomeId !== null;
}

/**
 * What makes two rules the same rule. A person who sets the same watch twice
 * — from the market page and from the portfolio, or by pressing twice — has
 * one rule, not two that both ring.
 */
export function ruleIdentity(input: WatchRuleInput): string {
  const parts = [input.kind, input.subject.venueMarketId, input.subject.outcomeId ?? "-", input.direction, input.threshold === null ? "-" : input.threshold.toFixed(6), input.windowMinutes === null ? "-" : String(input.windowMinutes)];
  return parts.join("|");
}

/* ------------------------------------------------------------------ words into a rule */

/**
 * A rule read out of a person's own sentence. `confidence` is the reading's
 * own honesty: `named` — the words said which kind and gave the figure;
 * `assumed` — the kind was clear and the figure is the kind's default, which
 * the person then sees and can change. Words that name no kind read as
 * nothing at all, and the page asks instead of guessing.
 */
export type WatchRuleDraft = Readonly<{ rule: WatchRuleInput; confidence: "named" | "assumed"; heard: readonly WatchRuleKind[] }>;

/*
 * Each kind's words in both languages, and the order they are tried in.
 *
 * The order is the precedence: the kinds whose words are least ambiguous come
 * first, because the vocabularies overlap on purpose — «the probability
 * moves» is a move over a period, while «the probability goes above 60 %» is
 * a level, and both sentences contain the word. Boundaries and stems are written in
 * Unicode classes rather than `\b` and `\w`: both are built on ASCII word
 * characters, so neither matches a Cyrillic letter, and every Ukrainian
 * phrase would be read as nothing at all.
 */
const KIND_ORDER: readonly WatchRuleKind[] = Object.freeze(["resolution", "venue_spread", "related_move", "position_value", "liquidity", "volume_spike", "news", "probability_move", "price"]);

/** A phrase with a word boundary on both sides, in either alphabet. */
const phrase = (body: string) => new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${body})`, "iu");

const KIND_WORDS: Readonly<Record<WatchRuleKind, readonly RegExp[]>> = {
  resolution: [phrase(String.raw`rules?\s+chang`), phrase(String.raw`change\s+of\s+(?:the\s+)?rules?`), phrase(String.raw`resolution\s+(?:is\s+)?(?:late|delay|chang)`), phrase(String.raw`settle[\p{L}]*\s+(?:late|delay)`), phrase(String.raw`overdue`), phrase(String.raw`змін[\p{L}]*\s+правил`), phrase(String.raw`правил[\p{L}]*\s+змін`), phrase(String.raw`затримк[\p{L}]*\s+розрахунк`), phrase(String.raw`розрахунок\s+відклад`), phrase(String.raw`простроч[\p{L}]*`)],
  venue_spread: [phrase(String.raw`venues?\s+(?:differ|diverg|disagree|are\s+apart)`), phrase(String.raw`between\s+(?:the\s+)?venues?`), phrase(String.raw`arbitrage`), phrase(String.raw`розбіжн[\p{L}]*\s+котирув`), phrase(String.raw`між\s+майданчик`), phrase(String.raw`майданчик[\p{L}]*\s+розход`), phrase(String.raw`майданчик[\p{L}]*\s+розійш`), phrase(String.raw`арбітраж`)],
  related_move: [phrase(String.raw`related\s+market`), phrase(String.raw`linked\s+market`), phrase(String.raw`correlated`), phrase(String.raw`пов['’]?язан[\p{L}]*\s+ринок`), phrase(String.raw`пов['’]?язан[\p{L}]*\s+ринк`), phrase(String.raw`суміжн[\p{L}]*\s+ринок`)],
  position_value: [phrase(String.raw`my\s+position`), phrase(String.raw`position(?:'s)?\s+(?:value|worth)`), phrase(String.raw`what\s+i\s+hold`), phrase(String.raw`вартіст[\p{L}]*\s+позиц`), phrase(String.raw`мо[\p{L}]*\s+позиц`), phrase(String.raw`позиц[\p{L}]*\s+кошту`)],
  liquidity: [phrase(String.raw`thin\s+(?:book|order\s*book)`), phrase(String.raw`order\s*book`), phrase(String.raw`spread`), phrase(String.raw`liquidit`), phrase(String.raw`depth`), phrase(String.raw`тонк[\p{L}]*\s+стакан`), phrase(String.raw`стакан`), phrase(String.raw`спред`), phrase(String.raw`ліквідн`), phrase(String.raw`глибин`)],
  volume_spike: [phrase(String.raw`volume`), phrase(String.raw`turnover`), phrase(String.raw`spike`), phrase(String.raw`обс[яє]г`), phrase(String.raw`сплеск`), phrase(String.raw`оборот`)],
  news: [phrase(String.raw`news`), phrase(String.raw`headline`), phrase(String.raw`announc`), phrase(String.raw`новин`), phrase(String.raw`заголов`)],
  probability_move: [phrase(String.raw`moves?\s+(?:by\s+)?\d`), phrase(String.raw`probabilit[\p{L}]*\s+mov`), phrase(String.raw`mov[\p{L}]*\s+\d+\s*(?:points?|pp|p\.\s*p\.)`), phrase(String.raw`changes?\s+by`), phrase(String.raw`рух\s+ймовірн`), phrase(String.raw`ймовірніст[\p{L}]*\s+(?:зрост|змін|рухн)`), phrase(String.raw`ймовірніст[\p{L}]*\s+рух`), phrase(String.raw`змін[\p{L}]*\s+на\s+\d+\s*(?:п\.?\s*п\.?|пункт)`), phrase(String.raw`рухн[\p{L}]*\s+на`)],
  price: [phrase(String.raw`price`), phrase(String.raw`goes?\s+(?:above|below|over|under)`), phrase(String.raw`reach[\p{L}]*`), phrase(String.raw`crosse?s?`), phrase(String.raw`probabilit`), phrase(String.raw`ціна`), phrase(String.raw`цін[\p{L}]*\s+(?:вищ|нижч|перевищ)`), phrase(String.raw`ціну`), phrase(String.raw`вище`), phrase(String.raw`нижче`), phrase(String.raw`перевищ[\p{L}]*`), phrase(String.raw`опуст[\p{L}]*`), phrase(String.raw`ймовірніст`)],
};

const ABOVE = phrase(String.raw`above|over|higher|up|rises?|grows?|вище|понад|більше|перевищ[\p{L}]*|зросте`);
const BELOW = phrase(String.raw`below|under|lower|down|falls?|drops?|нижче|менше|опуст[\p{L}]*|впаде`);

/** The period a sentence names, in minutes; null when it names none. */
function windowOf(text: string): number | null {
  const match = /(\d+(?:[.,]\d+)?)\s*(minutes?|mins?|хвилин[\p{L}]*|hours?|hrs?|годин[\p{L}]*|days?|дн[іея][\p{L}]*|доб[\p{L}]*|weeks?|тижн[\p{L}]*)/iu.exec(text);
  if (match) {
    const value = Number(match[1]!.replace(",", "."));
    const unit = match[2]!.toLowerCase();
    if (/^(minute|min|хвилин)/u.test(unit)) return value;
    if (/^(hour|hr|годин)/u.test(unit)) return value * 60;
    if (/^(week|тижн)/u.test(unit)) return value * 7 * DAY;
    return value * DAY;
  }
  /* The periods people name without a number. */
  if (phrase(String.raw`today|сьогодні|за\s+добу|over\s+a\s+day|in\s+a\s+day`).test(text)) return DAY;
  if (phrase(String.raw`this\s+hour|за\s+годину|за\s+останню\s+годину`).test(text)) return 60;
  if (phrase(String.raw`this\s+week|за\s+тижден[\p{L}]*|за\s+тиждень`).test(text)) return 7 * DAY;
  return null;
}

/** The figure a sentence names for this kind, in the kind's own unit; null when it names none. */
function thresholdOf(kind: WatchRuleKind, direction: WatchDirection, text: string): number | null {
  const bounds = thresholdShape(kind, direction);
  if (bounds === null) return null;
  const unit = bounds.unit;
  if (unit === "usd") {
    const money = /\$\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:usd|usdc|доларів|дол\.?)/iu.exec(text);
    return money ? Number((money[1] ?? money[2])!.replace(",", ".")) : null;
  }
  if (unit === "times") {
    const times = /(\d+(?:[.,]\d+)?)\s*(?:x|×|times?|раз[\p{L}]*)/iu.exec(text);
    if (times?.[1]) return Number(times[1].replace(",", "."));
    if (phrase(String.raw`triples?|втрич[іи]`).test(text)) return 3;
    if (phrase(String.raw`doubles?|вдвіч[іи]`).test(text)) return 2;
    return null;
  }
  /* Probability and points are both written as a percentage or as points; both land on the 0–1 scale the provider prices on. */
  const percent = /(\d+(?:[.,]\d+)?)\s*(?:%|percent|відсотк[\p{L}]*|п\.?\s*п\.?|points?|пункт[\p{L}]*)/iu.exec(text);
  if (percent) return Number(percent[1]!.replace(",", ".")) / 100;
  const bare = /(?:above|below|over|under|вище|нижче|понад|на|by)\s+(\d+(?:[.,]\d+)?)/iu.exec(text);
  if (bare) {
    const value = Number(bare[1]!.replace(",", "."));
    /* «above 0.6» is already the provider's scale; «above 60» is a percentage said without its sign. */
    return value <= 1 ? value : value / 100;
  }
  return null;
}

/**
 * The person's own sentence read into a rule. The reading is a parse, not a
 * guess by a model: the same words always give the same rule, and the person
 * confirms it before anything is watched.
 *
 * `side` is the outcome their page was on, so «tell me if it goes above 60 %»
 * is about the ticket they were looking at.
 */
export function ruleFromWords(text: string, subject: WatchSubject): WatchRuleDraft | null {
  const words = text.replace(/\s+/g, " ").trim();
  if (words.length === 0) return null;
  const heard = KIND_ORDER.filter((kind) => KIND_WORDS[kind].some((pattern) => pattern.test(words)));
  if (heard.length === 0) return null;
  const kind = heard[0]!;
  const shape = WATCH_RULE_SHAPES[kind];
  const direction: WatchDirection =
    shape.directions.length === 1 ? shape.directions[0]!
    : BELOW.test(words) && shape.directions.includes("below") ? "below"
    : ABOVE.test(words) && shape.directions.includes("above") ? "above"
    : shape.directions[0]!;
  const threshold = thresholdOf(kind, direction, words);
  const windowMinutes = windowOf(words);
  const rule = normalizeRule({ kind, subject, direction, threshold, windowMinutes, note: null });
  /* «Named» only when the words carried the figures the kind needs; otherwise the defaults stand and the person is shown them. */
  const named = (thresholdShape(kind, direction) === null || threshold !== null) && (shape.window === null || windowMinutes !== null);
  return { rule, confidence: named ? "named" : "assumed", heard };
}
