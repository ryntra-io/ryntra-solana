/**
 * The paper agent's live reads on mainnet: the agent's own (`../jupiter.server.ts` `jupiterWorth`, `/order`
 * without a taker — a quote that builds nothing) and Ryntra's fee by the very table the agent pays by (`../fee.ts`
 * `pairFeeBps`, the catalogue's facts of each side as a person's swap reads them). Read-only: no route is built, no
 * transaction exists, no wallet is asked.
 *
 * On the deployment every ask goes through paper's own budget (`./quota.ts`): within paper's share of the key's window,
 * never from the half that belongs to agents with money, and the same quote within a minute is asked once.
 */

import { PublicKey } from "@solana/web3.js";

import type { SideFacts } from "../../core/fee-policy.ts";
import { resolveJupiterSwapEndpoint, type JupiterSwapEndpointSelection } from "../../solana/quotes.ts";
import { pairFeeBps } from "../fee.ts";
import { jupiterWorth } from "../jupiter.server.ts";
import { NATIVE_MINT } from "../ssa.ts";
import { paperFetch, PaperQuotaSpent, PAPER_FACTS_TTL_MS, PAPER_QUOTE_TTL_MS, type PaperQuota, type PaperQuoteCache } from "./quota.ts";
import type { PaperReads } from "./step.server.ts";

export type PaperReadDeps = Readonly<{
  selection?: JupiterSwapEndpointSelection;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** One side's facts as a person's swap reads them; the swap's own reader when not handed in. */
  sides?: (mint: string) => Promise<SideFacts | null>;
  now?: () => number;
  /** Paper's budget of Jupiter's asks: every quote and the table's facts are asked within it. Absent — unbounded (tests). */
  quota?: PaperQuota;
  /** Answers kept briefly: the same quote within a minute, a coin's facts within ten. Absent — every read is asked. */
  cache?: PaperQuoteCache;
}>;

const swapSide = async (mint: string): Promise<SideFacts | null> => (await import("../../core/solana-swap/fee-route.server.ts")).readSideFacts(mint);

/** The live reads of one coin against SOL, the budget's token. */
export function jupiterPaperReads(coinMint: string, deps: PaperReadDeps = {}): PaperReads {
  const coin = new PublicKey(coinMint);
  const selection = deps.selection ?? resolveJupiterSwapEndpoint();
  const fetchImpl = deps.quota ? paperFetch(deps.quota, deps.fetchImpl) : deps.fetchImpl;
  const http = { ...(fetchImpl ? { fetchImpl } : {}), ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}) };
  const kept = <T>(key: string, ttlMs: number, ask: () => Promise<T>): Promise<T> => (deps.cache ? deps.cache.get(key, ttlMs, ask) : ask());
  return {
    /* SOL into the coin: the same quote, the mints the other way round. */
    buy: (lamports) => kept(`paper:buy:${coinMint}:${lamports}`, PAPER_QUOTE_TTL_MS, () => jupiterWorth({ coin: NATIVE_MINT, budgetMint: coin, amount: lamports }, selection, http)),
    worth: (coins) => kept(`paper:worth:${coinMint}:${coins}`, PAPER_QUOTE_TTL_MS, () => jupiterWorth({ coin, budgetMint: NATIVE_MINT, amount: coins }, selection, http)),
    /*
     * The coin's trading for a signal on it — the read the agent's own is (`exitMarketOf`): Jupiter's token
     * windows as the coin's page shows them, not a quote; asked only when such a signal has a buy due, kept with the
     * coin's facts. A window not read is null, and the signal waits.
     */
    market: () =>
      kept(`paper:market:${coinMint}`, PAPER_FACTS_TTL_MS, async () => {
        if (deps.quota && !deps.quota.take()) throw new PaperQuotaSpent();
        const { readSpotTokenFacts } = await import("../../spot/markets.server.ts");
        const read = await readSpotTokenFacts(coinMint).catch(() => null);
        if (!read || !read.ok || !read.facts || read.stale) return null;
        const volume = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
        return { volumeH6Usd: volume(read.facts.windows.h6.volumeUsd), volumeH24Usd: volume(read.facts.windows.h24.volumeUsd) };
      }),
    /* The stock's exchange as the stocks engine reads it, as the agent's `stockSessionOf`; null — no stock or not read. */
    async session(now) {
      const { readPoolFacts } = await import("../../stocks/pool-facts.server.ts");
      const facts = await readPoolFacts(coinMint, now);
      return facts?.isStock ? facts.session : null;
    },
    fees: () =>
      kept(`paper:fees:${coinMint}`, PAPER_FACTS_TTL_MS, async () => {
        /* The coin's facts are one read of the catalogue, counted as one ask; SOL's are known without one. */
        if (deps.quota && !deps.quota.take()) throw new PaperQuotaSpent();
        const read = deps.sides ?? swapSide;
        const [sol, side] = await Promise.all([read(NATIVE_MINT.toBase58()), read(coinMint)]);
        const nowMs = (deps.now ?? Date.now)();
        return {
          buyBps: pairFeeBps(NATIVE_MINT.toBase58(), coinMint, { input: sol, output: side, nowMs }),
          sellBps: pairFeeBps(coinMint, NATIVE_MINT.toBase58(), { input: side, output: sol, nowMs }),
        };
      }),
  };
}
