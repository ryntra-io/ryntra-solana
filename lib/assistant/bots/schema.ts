/**
 * What the bots hub may ask Ryntra's bot tools, and the draft they answer
 * with (CITY-133, B3).
 *
 * Every field is a choice, a number or an address — there is no free text
 * anywhere in a request, so nothing a person or a post writes can become a
 * tool's input, and a body carrying any key the schema does not name is
 * refused whole (`.strict()`). Words from chat or social media never start
 * a tool: a tool starts from the person's own tap in the city, on figures it
 * reads from the engine itself.
 *
 * The draft is a bot's settings and nothing more: no bytes, no instructions,
 * no accounts to sign for. The window opens it in its own review, where the
 * person changes what they want and starts it. Pure.
 */

import { z } from "zod";

import { ASSISTANT_BOT_KINDS, ASSISTANT_GOALS, HORIZON_KEYS } from "./kinds.ts";

/** A Solana address (kept here so this module's imports stay the schemas'). */
export const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** A bot of the engine's Hangar: `grid:<address>`, `limit:<venue>:<order>`, `dca:<rule>` … */
export const HANGAR_BOT_ID = /^[A-Za-z0-9_][A-Za-z0-9:_.\-]{0,159}$/;

/** The window's amounts: at least ten dollars, at most what practice takes (`city/lib/bots/draft.ts`). */
export const AMOUNT_MIN = 10;
export const AMOUNT_MAX = 100_000;

const Mint = z.string().regex(BASE58);
const Locale = z.enum(["en", "uk"]).default("en");
const Amount = z.number().finite().min(AMOUNT_MIN).max(AMOUNT_MAX);
const Kind = z.enum(ASSISTANT_BOT_KINDS);
const Horizon = z.enum(["week", "month", "half_year"]) satisfies z.ZodType<(typeof HORIZON_KEYS)[number]>;

const Subject = z.discriminatedUnion("about", [
  z.object({ about: z.literal("kind"), kind: Kind }).strict(),
  z.object({ about: z.literal("bot"), wallet: Mint, botId: z.string().regex(HANGAR_BOT_ID) }).strict(),
  z.object({ about: z.literal("hangar"), wallet: Mint }).strict(),
]);

export const BotsToolRequestSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("weather"), locale: Locale, mint: Mint }).strict(),
  z.object({ tool: z.literal("suggest"), locale: Locale, mint: Mint, goal: z.enum(ASSISTANT_GOALS).optional(), horizon: Horizon.optional(), amountUsd: Amount.optional() }).strict(),
  z.object({ tool: z.literal("simulate"), locale: Locale, mint: Mint, kind: Kind, amountUsd: Amount, horizon: Horizon.default("month") }).strict(),
  z.object({ tool: z.literal("explain"), locale: Locale, subject: Subject }).strict(),
  z.object({ tool: z.literal("draft"), locale: Locale, mint: Mint, kind: Kind, amountUsd: Amount, horizon: Horizon.default("month") }).strict(),
]);
export type BotsToolRequest = z.output<typeof BotsToolRequestSchema>;
export type BotsToolName = BotsToolRequest["tool"];

/** The tools by their names in the assistant's registry. */
export const BOTS_TOOL_NAMES = ["bots.weather", "bots.suggest", "bots.simulate", "bots.explain", "bots.draft"] as const;

/* ------------------------------------------------------------------ the draft */

const Pct = z.number().finite().positive();

export const AssistantBotDraftSchema = z
  .object({
    schema: z.literal("ryntra.bot-draft"),
    schemaVersion: z.literal("1.0.0"),
    /** Always a draft: the window's review turns it into a bot, the person's own tap starts it. */
    status: z.literal("draft"),
    /** Nothing in a draft signs: no transaction, no instruction, no account. */
    signs: z.literal(false),
    kind: Kind,
    mint: Mint,
    symbol: z.string().min(1).max(32),
    amountUsd: Amount,
    horizon: Horizon,
    /** The engine's last close the draft was sized at. */
    price: z.number().finite().positive(),
    exit: z.enum(["stop", "wait"]),
    grid: z.object({ lower: Pct, upper: Pct, levels: z.number().int().min(3).max(69) }).strict().nullable(),
    ladder: z.object({ steps: z.number().int().min(2).max(12), firstPct: Pct, lastPct: Pct }).strict().nullable(),
    recurring: z.object({ everyHours: z.number().int().min(1).max(720), buys: z.number().int().min(2).max(60) }).strict().nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type AssistantBotDraft = z.output<typeof AssistantBotDraftSchema>;
