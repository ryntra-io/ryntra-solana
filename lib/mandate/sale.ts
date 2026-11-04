/**
 * CITY-187 — the person sells what her agent bought, from the tower's window: one press, a share of it — 25, 50 or 100 %.
 * Pure and client-safe, so the window says the very numbers the engine writes (`./sale.server.ts` builds and runs it).
 *
 * A sale is a mandate of CITY-184 (`./terms.ts` `budgetCoin`): her coin moves into her own vault under a policy that lets
 * the agent sell exactly that much, once, for at least her floor in SOL, to her wallet, within a day. Ryntra's fee is the
 * table's share of the coin sold (`./fee.ts`); the floor is the pool's quote for the rest less the slippage the mandate
 * allows — the least SOL that reaches her, held on chain.
 */

export const SALE_SHARES = [25, 50, 100] as const;
export type SaleShare = (typeof SALE_SHARES)[number];
export const isSaleShare = (value: unknown): value is SaleShare => typeof value === "number" && (SALE_SHARES as readonly number[]).includes(value);

/** How long a sale's mandate stands: the agent sells within minutes; a day leaves room for one more try. */
export const SALE_SECONDS = 86_400n;

/** The slippage a sale allows, basis points — the mandate's ceiling. */
export const SALE_SLIPPAGE_BPS = 100;

/** A review the person did not sign in this long is let go: its blockhash is long past. */
export const SALE_REVIEW_MS = 10 * 60_000;

/** The coin sold for a share of what the agent holds for her: all of it at 100 %, never more. */
export function saleAmount(held: bigint, share: SaleShare): bigint {
  if (held <= 0n) return 0n;
  return share === 100 ? held : (held * BigInt(share)) / 100n;
}

/** The least SOL that reaches her: the quote less the slippage, as the agent's signer counts it. */
export const saleFloor = (quoteOut: bigint, slippageBps: number = SALE_SLIPPAGE_BPS): bigint => (quoteOut * BigInt(10_000 - slippageBps)) / 10_000n;

/**
 * CITY-195 — the room a sale through Jupiter leaves the price between her signature and the agent's sale, basis points.
 * Jupiter's route names its own quote, and her mandate holds that quote to at least her floor plus the slippage
 * (`./terms.ts` `jupiterQuoteFloor`): a floor of the quote less the slippage alone would refuse every sale whose price
 * moved by a lamport. With this room the price may fall 1 % before the agent refuses to send; she still gets her floor.
 */
export const SALE_ROOM_BPS = 100;

/** Her floor on a sale through Jupiter: the quote after Ryntra's fee, less the slippage, less the room for the price. */
export const jupiterSaleFloor = (netQuote: bigint): bigint => saleFloor(saleFloor(netQuote, SALE_SLIPPAGE_BPS), SALE_ROOM_BPS);

/** A sale as the book keeps it and the window shows it. */
export type SaleStatus = "review" | "signed" | "sold" | "failed";

/** The sales that count against what the agent holds: sold, or under way — the coin has left her wallet. */
export const countsAsSold = (status: SaleStatus) => status === "sold" || status === "signed";

/**
 * What the agent holds for her of its coin: what it bought, less what she sold through it — never more than her wallet
 * holds now (she may have sent some away), and never a coin she bought herself.
 */
export function agentHolding(boughtRaw: bigint, soldRaw: bigint, walletRaw: bigint | null): bigint {
  const book = boughtRaw - soldRaw;
  const held = walletRaw === null ? book : book < walletRaw ? book : walletRaw;
  return held > 0n ? held : 0n;
}

/**
 * What the agent did for her with its sales counted: the coins it still holds are worth `worthRaw`, the SOL its sales
 * brought is hers already. `earned` is worth plus what the sales brought, less what it spent.
 */
export function earnedWithSales(spentRaw: bigint, worthRaw: bigint | null, gotRaw: bigint): bigint | null {
  return worthRaw === null ? null : worthRaw + gotRaw - spentRaw;
}
