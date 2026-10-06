/**
 * A creator's earnings card — the data the Growth line's earnings card draws,
 * given by the core.
 *
 * Only figures from the programs' own counters, with their period: what the
 * wallet's part of its launches' creator fees came to (on the curve the
 * counter is a ceiling — the program rounds each trade's creator part down, at
 * most one raw unit a trade), what it has taken by the same counters, claims
 * made outside Ryntra included, and how many of its launches reached a DEX.
 * The receipts are those of the claims made through Ryntra. Each currency is said apart: a
 * community token is not a dollar, and its figure is never turned into one.
 * No promise, no projection — what happened, from when to when.
 *
 * Pure and client-safe.
 */

export const EARNINGS_CARD_SOURCE = "ryntra.launch.creator-earnings-card@1";

export type EarningsCardAmount = Readonly<{
  pairMint: string;
  symbol: string;
  decimals: number;
  /** A dollar stablecoin: the figure is a figure in dollars. */
  dollar: boolean;
  earnedRaw: string;
  claimedRaw: string;
}>;

export type CreatorEarningsCard = Readonly<{
  source: typeof EARNINGS_CARD_SOURCE;
  kind: "creator";
  wallet: string;
  network: string;
  /** From the wallet's first launch read here to the moment of the read. */
  period: Readonly<{ from: string; to: string }>;
  launches: number;
  /** Of them, how many left their curve for a DEX. */
  graduated: number;
  /** Launches whose chain could not be read now: their figures are not in the amounts, never counted as nothing. */
  unread: number;
  amounts: readonly EarningsCardAmount[];
  /** The receipts of the claims made through Ryntra: their signatures, newest first. */
  receipts: readonly string[];
}>;

export type EarningsCardRow = Readonly<{
  launchedAt: string;
  migrated: boolean | null;
  read: boolean;
  pair: Readonly<{ mint: string; symbol: string; decimals: number; dollar: boolean }>;
  earnedRaw: string;
  claimedRaw: string;
}>;

export function creatorEarningsCard(args: Readonly<{ wallet: string; network: string; rows: readonly EarningsCardRow[]; receipts: readonly string[]; now: string }>): CreatorEarningsCard {
  const amounts = new Map<string, { pair: EarningsCardRow["pair"]; earned: bigint; claimed: bigint }>();
  for (const row of args.rows) {
    if (!row.read) continue;
    const entry = amounts.get(row.pair.mint) ?? { pair: row.pair, earned: 0n, claimed: 0n };
    entry.earned += BigInt(row.earnedRaw);
    entry.claimed += BigInt(row.claimedRaw);
    amounts.set(row.pair.mint, entry);
  }
  const first = args.rows.map((row) => Date.parse(row.launchedAt)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  return {
    source: EARNINGS_CARD_SOURCE,
    kind: "creator",
    wallet: args.wallet,
    network: args.network,
    period: { from: first === undefined ? args.now : new Date(first).toISOString(), to: args.now },
    launches: args.rows.length,
    graduated: args.rows.filter((row) => row.migrated === true).length,
    unread: args.rows.filter((row) => !row.read).length,
    amounts: [...amounts.values()].map((entry) => ({
      pairMint: entry.pair.mint,
      symbol: entry.pair.symbol,
      decimals: entry.pair.decimals,
      dollar: entry.pair.dollar,
      earnedRaw: entry.earned.toString(),
      claimedRaw: entry.claimed.toString(),
    })),
    receipts: [...args.receipts],
  };
}
