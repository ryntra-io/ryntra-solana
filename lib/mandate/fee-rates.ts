/**
 * CITY-183 — the rates of Ryntra's fee on the agent's trades: fee policy v2's (`../core/fee-policy.ts`), the very table a
 * person's own swap pays by — the router's flows that carry a fee. Pure and client-safe, so the agent's window says the
 * same numbers the engine charges (`./fee.ts` holds where the fee lands and how it travels).
 */

import { FEE_POLICY_V2, classifyPair, type FeeFlow, type SideFacts } from "../core/fee-policy.ts";

/** The flows the agent trades: the router's lane, with a fee. */
export const AGENT_FEE_FLOWS: readonly FeeFlow[] = Object.freeze(
  (Object.keys(FEE_POLICY_V2) as FeeFlow[]).filter((flow) => FEE_POLICY_V2[flow].lane === "BUILD" && FEE_POLICY_V2[flow].bps > 0),
);

/** Every rate an agent trade may carry, basis points. */
export const AGENT_FEE_RATES: readonly number[] = Object.freeze([...new Set(AGENT_FEE_FLOWS.map((flow) => FEE_POLICY_V2[flow].bps))].sort((a, b) => a - b));

/** The highest of them: what the chain lets a trade carry at most. */
export const AGENT_FEE_CEILING_BPS = AGENT_FEE_RATES.at(-1)!;
/** The lowest — what the window says the fee starts at. */
export const AGENT_FEE_FLOOR_BPS = AGENT_FEE_RATES[0]!;

/** The rate an agent trade of this flow pays; null — not an agent trade. */
export function agentFeeBps(flow: FeeFlow): number | null {
  return AGENT_FEE_FLOWS.includes(flow) ? FEE_POLICY_V2[flow].bps : null;
}

/**
 * What the table is read from for one pair: the catalogue's facts of each side, as a person's swap reads them
 * (`readSideFacts`), and the time. A dollar or a major is known by its mint alone; facts of another mint than the side's are
 * no facts (the side is unread, and the pair is not an agent trade).
 */
export type FeeSides = Readonly<{ input: SideFacts | null; output: SideFacts | null; nowMs: number }>;

/** The rate the table names for a trade of `budgetMint` into `outputMint`; null — not an agent trade. */
export function pairFeeBps(budgetMint: string, outputMint: string, sides: FeeSides): number | null {
  return agentFeeBps(classifyPair({ inputMint: budgetMint, outputMint, input: sides.input, output: sides.output, nowMs: sides.nowMs }));
}

/** The fee on `amount` of the budget: floor(amount × bps / 10 000), as Jupiter's program takes it. */
export const agentFeeRaw = (amount: bigint, bps: number): bigint => (amount * BigInt(bps)) / 10_000n;
