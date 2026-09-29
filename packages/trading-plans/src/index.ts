/**
 * @ryntra/trading-plans — the deterministic helpers of a Trading Plan.
 *
 * A Trading Plan is a set of rules a person writes before they sign: why this
 * asset, how much money, at what entry, where the thesis is wrong. Two parts
 * of it are pure arithmetic and are published here:
 *
 * - **sizing** — the size of a spot-long position from the entry, the
 *   invalidation, the budget and the planned risk, with the assumptions the
 *   figure stands on. The same function sizes the form in the browser and
 *   the stored version on the server, so no client keeps a second financial
 *   logic (`sizing.ts`). A plan on a token (SOL, a verified crypto or meme)
 *   passes the context `{ unitWord: "token", tokenAsset: true }`: the
 *   assumptions say *per token*, a loss per unit below a cent keeps its
 *   digits, and the two reference rules a token cannot have are refused
 *   with their codes. Every refused rule carries a stable `code`
 *   (`PlanIssueCode`) beside its sentence, so a form can say the
 *   contradiction in its own words with the person's figures;
 * - **decimal input** — a number a person typed into a money or price field,
 *   read the way the person meant it: `0,5` is a half, `1 000,50` is
 *   `1000.5`, an empty field is `null` and never zero (`decimal-input.ts`).
 *
 * These are the modules the Ryntra product runs on, imported rather than
 * copied. Nothing here fetches, stores, signs or places an order.
 */

export { computePlanSizing, validatePlanRules, roundPrice, formatUsd, type PlanIssue, type PlanIssueCode, type PlanSizing, type PlanSizingContext, type PlanSizingRules } from "../../../lib/plans/sizing.ts";

export { decimalReadingDiffers, parseDecimalInput } from "../../../lib/plans/decimal-input.ts";
