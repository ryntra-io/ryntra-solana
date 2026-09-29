/**
 * Where a Solana action was started from, and as what.
 *
 * Spot and Swap run the same Jupiter engine — one `/order`, one signature, one
 * `/execute`, one `SWAP` row — so the row itself cannot tell a person whether
 * they *swapped SOL for USDC* or *sold SOL* on the Spot market. Both are true
 * of the same transaction; only one is what they did. The origin travels with
 * the order request into the signed execution bundle (the issuer's proof
 * covers it, so it cannot be rewritten between Review and execute) and onto
 * the Activity row, where History reads `Spot Buy` / `Spot Sell`.
 *
 * A row written before this field existed has `origin: null`, which reads as
 * a Swap — every earlier row was one.
 *
 * **The plan (`RYN-STRATEGY-PLAN-001` stage B).** An order made under a
 * Trading Plan names the plan and the version the client read
 * (`ExecutionPlanBinding`, the contract's shape). The server judges that
 * version on the order, refuses a blocked one before any bytes are built, and
 * writes the binding into the bundle with `reviewId` — the operation's own id,
 * which the plan's Review and the Receipt carry too. The binding on the row is
 * what makes History the durable source for Plan vs Actual: a plan that lost
 * the execution's write finds it again by this field, never by guessing.
 *
 * **The rule (`RYN-INVEST-SIMPLE-001`, session 3).** A purchase made under an
 * autoinvest reminder names the rule and the occurrence (`RuleBinding`); the
 * order route refuses a reminder that is not open, and the binding travels
 * into the bundle and onto the row unchanged. The row is how the rule learns
 * it was bought — the rule is never written from the purchase path.
 */

import { z } from "zod";

import { ExecutionPlanBindingSchema, RuleBindingSchema } from "../api/v1/contract.ts";

/** The binding as the server records it: the client's plan and version, and the Review's id. */
export const SolanaActionPlanBindingSchema = ExecutionPlanBindingSchema.extend({ reviewId: z.string().min(8).max(64) }).strict();
export type SolanaActionPlanBinding = z.output<typeof SolanaActionPlanBindingSchema>;

export const SolanaActionOriginSchema = z
  .object({
    surface: z.enum(["SPOT"]),
    side: z.enum(["BUY", "SELL"]),
    plan: SolanaActionPlanBindingSchema.optional(),
    rule: RuleBindingSchema.optional(),
  })
  .strict();

export type SolanaActionOrigin = z.output<typeof SolanaActionOriginSchema>;

/** What an order request may name: Spot with a side, the plan binding as the client knows it (no review id yet), and the rule's reminder. */
export const SolanaActionOriginRequestSchema = z
  .object({
    surface: z.enum(["SPOT"]),
    side: z.enum(["BUY", "SELL"]),
    plan: ExecutionPlanBindingSchema.optional(),
    rule: RuleBindingSchema.optional(),
  })
  .strict();

export type SolanaActionOriginRequest = z.output<typeof SolanaActionOriginRequestSchema>;

export function isSpotOrigin(origin: SolanaActionOrigin | null | undefined): origin is SolanaActionOrigin {
  return origin !== null && origin !== undefined && origin.surface === "SPOT";
}

/** The plan an action was made under, or null: a row from before plans, or a plain Spot or Swap action. */
export function planBindingOf(origin: SolanaActionOrigin | null | undefined): SolanaActionPlanBinding | null {
  return origin?.plan ?? null;
}

/** The autoinvest reminder an action was bought under, or null. */
export function ruleBindingOf(origin: SolanaActionOrigin | null | undefined): NonNullable<SolanaActionOrigin["rule"]> | null {
  return origin?.rule ?? null;
}
