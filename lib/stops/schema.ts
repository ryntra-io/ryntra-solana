/**
 * The bodies the stop routes take (CITY-149). Strict: a field the engine does not know is refused, never ignored.
 * The engine works out the stop's line itself (`stopThreshold`); a client never sends one.
 */

import { z } from "zod";

import { STOP_EXPIRIES } from "./model.ts";

const MINT = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const SYMBOL = z.string().trim().min(1).max(40);
const DECIMALS = z.number().int().min(0).max(18);

const Coin = z.object({ mint: MINT, symbol: SYMBOL, decimals: DECIMALS }).strict();

export const StopCreateSchema = z
  .object({
    side: z.enum(["buy", "sell"]),
    base: Coin.extend({ name: z.string().trim().min(1).max(128).optional() }).strict(),
    quote: Coin,
    amountRaw: z.string().regex(/^[1-9][0-9]{0,29}$/),
    price: z.string().regex(/^\d{1,18}(?:\.\d{1,18})?$/),
    expiry: z.enum(STOP_EXPIRIES as unknown as ["1d", "7d", "30d", "never"]),
    locale: z.enum(["en", "uk"]).default("en"),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.base.mint === value.quote.mint) context.addIssue({ code: "custom", path: ["quote", "mint"], message: "The two coins are the same mint." });
  });

export type StopCreate = z.output<typeof StopCreateSchema>;

/** `PATCH /api/v1/stops/{id}`: the reached stop's sale settled. */
export const StopPatchSchema = z.object({ state: z.literal("done") }).strict();
