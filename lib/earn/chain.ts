/**
 * What «read from the chain» means for Earn, as a type and one reader.
 *
 * A position is read from the chain and never from the interface's memory — the registry's own condition for
 * this row. The shape that promise takes in code is this: an adapter is handed a {@link HeldReader} and has no
 * other way to learn what a wallet holds, so there is no branch anywhere in which a provider's cache stands
 * in for a token account. The production reader is `chain.server.ts`, over the product's one RPC path; a test
 * hands in a map and proves the arithmetic without a network.
 *
 * A mint whose read failed is `null`, never `0`: zero is the claim that the wallet holds nothing.
 */

const RAW = /^\d+$/;

export type EarnChainRead = Readonly<{
  /** mint → raw amount the wallet holds, or null where the read failed. */
  held: ReadonlyMap<string, bigint | null>;
  /** The host that answered, for the position's own «read from». */
  host: string;
  readAt: string;
}>;

export type HeldReader = (owner: string, mints: readonly string[]) => Promise<EarnChainRead>;

/** The raw amounts of a `jsonParsed` token-accounts answer, added up; null for an answer of another shape. */
export function heldFromParsedAccounts(value: unknown): bigint | null {
  if (!Array.isArray(value)) return null;
  let total = 0n;
  for (const entry of value) {
    const amount = (entry as { account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: unknown } } } } } })?.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (typeof amount !== "string" || !RAW.test(amount)) return null;
    total += BigInt(amount);
  }
  return total;
}

/** A reader over amounts already known — the tests' chain, and the shape the real one answers in. */
export function heldReaderFrom(held: ReadonlyMap<string, bigint | null>, host = "fixture"): HeldReader {
  return async (_owner, mints) => ({
    held: new Map(mints.map((mint) => [mint, held.get(mint) ?? null])),
    host,
    readAt: new Date(0).toISOString(),
  });
}
