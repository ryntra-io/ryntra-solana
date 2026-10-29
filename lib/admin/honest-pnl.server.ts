import type { GuardStore } from "../guard/store.ts";
import { SolanaWalletActionSchema, type SolanaWalletAction } from "../solana/action-ledger.ts";
import { WRAPPED_SOL_MINT } from "../core/fee-policy.ts";
import { productionFacts } from "../wallet-watch/chain.server.ts";
import { platformHonestMetric, positionMints, type PlatformHonestMetric, type TokenMarketUsd } from "./honest-pnl.ts";
import { resolveInternalWallets } from "./internal-wallets.ts";

/**
 * The platform's honest metric (DSC-2) as the admin reads it: Ryntra's swap record scanned whole (as the business
 * model reads it), the owner's and test wallets left out, the tokens held priced once through Jupiter (a hundred
 * mints a read). The function MET-1's panel calls: `readPlatformHonestMetric(store, env, nowMs)`.
 *
 * Read only — nothing here signs, sends or writes, and nothing is published.
 */

const FACTS_BATCH = 100;

export async function readPlatformHonestMetric(
  store: GuardStore,
  env: Readonly<Record<string, string | undefined>>,
  nowMs: number,
  count = 6,
): Promise<PlatformHonestMetric> {
  const nowS = Math.floor(nowMs / 1000);
  let actions: SolanaWalletAction[] = [];
  let source: "measured" | "unavailable" = "measured";
  try {
    const raw = await store.collection<unknown>("solanaWalletActions").valuesWithPrefix("solana:mainnet:");
    for (const row of raw) {
      const parsed = SolanaWalletActionSchema.safeParse(row);
      if (parsed.success) actions.push(parsed.data);
    }
  } catch {
    actions = [];
    source = "unavailable";
  }
  const internal = await resolveInternalWallets(store, env);
  const mints = [WRAPPED_SOL_MINT, ...positionMints(actions)];
  const market = new Map<string, TokenMarketUsd>();
  for (let at = 0; at < mints.length; at += FACTS_BATCH) {
    const facts = await productionFacts(mints.slice(at, at + FACTS_BATCH)).catch(() => null);
    for (const [mint, fact] of facts ?? []) market.set(mint, { priceUsd: fact.priceUsd, liquidityUsd: fact.liquidityUsd ?? null });
  }
  const solUsd = market.get(WRAPPED_SOL_MINT)?.priceUsd ?? null;
  market.delete(WRAPPED_SOL_MINT);
  return platformHonestMetric(actions, { nowS, solUsd, market, exclude: internal.wallets, count, source });
}
