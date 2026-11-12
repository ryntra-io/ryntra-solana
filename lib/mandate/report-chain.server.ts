/**
 * CITY-245 — the agent's trades of a span as the chain shows them, for the daily report to check its book against:
 * the successful transactions in which the Smart Account program acted on the mandate's budget account and the coin the
 * agent buys moved — a stranger's transaction that only names the budget is not one of them. Found through
 * Helius's Parsed Events Scan, one request, on mainnet where the node is Helius; elsewhere — devnet, another provider,
 * a scan that fails or a span with more trades than one listing holds — null, and the report says what the book says.
 *
 * Reads only: signatures, never an amount — every figure stays the book's and the venue's. Signs and sends nothing.
 */

import { addressHistoryOf, type AddressHistory } from "../core/history/address-history.ts";
import { resolveEndpoints } from "../solana/rpc.ts";
import { SSA_PROGRAM_ID } from "./ssa.ts";

/** The most trades one span's check lists; a busier span is not checked. */
export const CHAIN_CHECK_LIMIT = 500;
/** How long the check may take: the report pass has a minute for everyone. */
const CHAIN_CHECK_MS = 6_000;

export async function chainTradeSignatures(
  input: Readonly<{ budget: string; coin: string; since: number; until: number }>,
  deps: Readonly<{ history?: AddressHistory | null; now?: () => number }> = {},
): Promise<readonly string[] | null> {
  const history = deps.history !== undefined ? deps.history : addressHistoryOf(resolveEndpoints("mainnet")[0]?.url);
  if (!history || !(input.since < input.until)) return null;
  const now = deps.now ?? Date.now;
  const listed = await history
    .signatures({
      address: input.budget,
      match: { programs: [{ programId: SSA_PROGRAM_ID.toBase58(), scope: "address" }], mints: [{ mint: input.coin, scope: "transaction" }] },
      limit: CHAIN_CHECK_LIMIT,
      /* The book keeps the moment a trade was sent; the chain, a moment later: the span's end is held a minute open. */
      time: { gte: Math.floor(input.since / 1000), lte: Math.ceil(input.until / 1000) + 60 },
      until: now() + CHAIN_CHECK_MS,
    })
    .catch(() => null);
  if (!listed || !listed.whole) return null;
  return listed.entries.map((entry) => entry.signature);
}
