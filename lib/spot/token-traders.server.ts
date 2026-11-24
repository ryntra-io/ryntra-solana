/**
 * `part=traders`: the coin's traders from the trades the page reads, with what each bought and sold, its
 * average prices and its result by the honest standard (`./token-traders.ts`).
 *
 * It reads nothing of its own: the trades (`readTokenTrades` — GeckoTerminal's busiest pool, or the chain's events
 * where the deployment opens them), the coin's and SOL's prices from the Spot market's cached read, and the holders the
 * page read last, whose holdings cap what a wallet can still hold. One table per mint is kept as long as the trades it
 * stands on; the answer says from which source and over which span it is counted (`basis`).
 */

import { WRAPPED_SOL_MINT } from "../solana/send-kinds.ts";
import { readSpotTokenFacts } from "./markets.server.ts";
import { isNativeToken } from "./token-page.ts";
import { knownTokenReads, readTokenTrades, type TokenPageFailure } from "./token-page.server.ts";
import { tradersOf, type TraderRow, type TradersBasis } from "./token-traders.ts";
import { ownersOf, topHoldersOf, type LabelBasis, labelBasisOf } from "./wallet-labels.ts";
import { knownAges, ryntraAgents, walletLabelSettings } from "./wallet-labels.server.ts";

export type TokenTradersRead = Readonly<{
  ok: true;
  traders: readonly TraderRow[];
  basis: TradersBasis;
  labelBasis: LabelBasis;
  observedAt: string;
  stale: boolean;
}>;

const kept = new Map<string, { tradesAt: string; holdersAt: string | null; value: TokenTradersRead }>();
const CEILING = 400;

async function priceOf(mint: string): Promise<Readonly<{ price: number | null; liquidityUsd: number | null }>> {
  const read = await readSpotTokenFacts(mint);
  return read.ok && read.market ? { price: read.market.price, liquidityUsd: read.market.liquidityUsd } : { price: null, liquidityUsd: null };
}

export async function readTokenTraders(mint: string): Promise<TokenTradersRead | TokenPageFailure> {
  if (isNativeToken(mint)) return { ok: false, code: "NOT_READ", reason: "SOL is traded by every wallet on the network; its traders are not listed." };
  const trades = await readTokenTrades(mint);
  if (!trades.ok) return trades;
  const holders = knownTokenReads(mint).holders;
  const hit = kept.get(mint);
  if (hit && hit.tradesAt === trades.observedAt && hit.holdersAt === (holders?.observedAt ?? null)) return hit.value;
  const [coin, sol] = await Promise.all([priceOf(mint), priceOf(WRAPPED_SOL_MINT)]);
  const settings = walletLabelSettings();
  const owners = holders ? ownersOf(holders.holders) : { pools: new Set<string>(), programs: new Set<string>() };
  if (trades.pool) owners.pools.add(trades.pool.address);
  const book = {
    dev: trades.creator ?? null,
    agents: ryntraAgents(),
    topHolders: holders ? topHoldersOf(holders.holders, settings.topHolderRanks) : null,
    poolOwners: owners.pools,
    programOwners: owners.programs,
    ages: knownAges(trades.trades.map((trade) => trade.wallet)),
  };
  /* The market's depth on the dollar side: half of what Jupiter counts as the coin's liquidity, else half the busiest pool's reserve. */
  const liquidity = coin.liquidityUsd ?? trades.pool?.reserveUsd ?? null;
  const held = new Map<string, number>();
  for (const row of holders?.holders ?? []) held.set(row.owner, row.amount);
  const table = tradersOf({
    mint,
    trades: trades.trades,
    source: trades.source ?? "geckoterminal",
    whole: trades.whole === true,
    nowMs: Date.now(),
    priceUsd: coin.price,
    depthUsd: liquidity === null ? null : liquidity / 2,
    solPriceUsd: sol.price,
    book,
    held,
    settings,
  });
  const value: TokenTradersRead = {
    ok: true,
    traders: table.traders,
    basis: table.basis,
    labelBasis: labelBasisOf(book, trades.trades.map((trade) => trade.wallet), settings),
    observedAt: trades.observedAt,
    stale: trades.stale,
  };
  kept.delete(mint);
  kept.set(mint, { tradesAt: trades.observedAt, holdersAt: holders?.observedAt ?? null, value });
  while (kept.size > CEILING) {
    const oldest = kept.keys().next().value;
    if (oldest === undefined) break;
    kept.delete(oldest);
  }
  return value;
}

/** Test seam: forget the tables. */
export function resetTokenTraders(): void {
  kept.clear();
}
