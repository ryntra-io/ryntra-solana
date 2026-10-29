/**
 * The production side of «Стежити за токеном» (AI-05): Jupiter's catalogue
 * for a mint's ticker, Jupiter Price v3 (the key only where the deployment
 * set one) and DexScreener for the pass, and the price of «Чому?» from the
 * credits' settings. Reads only.
 */

import { resolveCreditsConfig, priceOf } from "../credits/prices.ts";
import { deliverOutbox } from "../../monitoring/service.server.ts";
import { summariseDexPairs } from "../data/dexscreener.ts";
import { readDexPairs } from "../data/sources.server.ts";
import { fetchTokenCatalog } from "../../solana/catalog.ts";
import { resolveJupiterCatalogEndpoint } from "../../solana/quotes.ts";
import type { GuardStore } from "../../guard/store.ts";
import { readWatchMarkets } from "./reads.ts";
import { runWatchPass } from "./run.ts";
import type { TokenLookup } from "./service.ts";

/** «Чому?» is asked as a question in the conversation, so it costs what a question costs — the price the button shows is the price charged. */
export function explainPrice(): number {
  return priceOf(resolveCreditsConfig(), "question");
}

/**
 * A mint's ticker and price: Jupiter's catalogue first; when it does not answer (a rate limit, a blink), DexScreener's
 * pairs against USDC, USDT or SOL — the same source the pass reads — so one source down does not stop a person.
 */
export const lookupToken: TokenLookup = async (mint) => {
  const read = await fetchTokenCatalog([mint], 6_000).catch(() => null);
  if (read?.ok) {
    const row = read.byMint[mint];
    if (!row) return null;
    const price = row.usdPrice !== null ? Number(row.usdPrice) : null;
    const priced = price !== null && Number.isFinite(price) && price > 0;
    return { symbol: row.symbol ?? mint.slice(0, 4), suspicious: row.isSuspicious, priceUsd: priced ? price : null, priced };
  }
  const pairs = await readDexPairs(mint);
  if (!pairs.ok) throw new Error(read && !read.ok ? read.reason : pairs.reason);
  const top = summariseDexPairs(pairs.value).top;
  /* Jupiter did not answer: its price is not known, so a level is not offered on DexScreener's. */
  return top ? { symbol: top.baseSymbol, suspicious: false, priceUsd: null, priced: false } : null;
};

export function runWatches(store: GuardStore) {
  const endpoint = resolveJupiterCatalogEndpoint();
  const url = endpoint.tier === "pro" ? "https://api.jup.ag/price/v3" : "https://lite-api.jup.ag/price/v3";
  return runWatchPass({
    store,
    clock: Date.now,
    read: (mints) => readWatchMarkets(mints, { jupiter: { url, apiKey: endpoint.apiKey }, clock: Date.now }),
    /* This pass's own deliveries, sent at once through the monitoring delivery (Telegram, push, quiet hours, retries) — it sees only their rows. */
    deliver: (rows, atMs) => deliverOutbox(onlyRows(store, rows), atMs),
    /* The agent stand's store holds one connection; production's Postgres pool takes eight at once. */
    concurrency: process.env.RYNTRA_AGENT_FIXTURES === "1" ? 1 : undefined,
  });
}

/** The store as the delivery sees it: the outbox narrowed to the rows this pass wrote, everything else as it is. */
export function onlyRows(store: GuardStore, rows: ReadonlySet<string>): GuardStore {
  return {
    ...store,
    collection: <T,>(name: string) => {
      const inner = store.collection<T>(name as never);
      if (name !== "monitoringOutbox") return inner;
      return { ...inner, valuesWithPrefix: async (prefix: string) => (await inner.valuesWithPrefix(prefix)).filter((row) => rows.has((row as { id?: string }).id ?? "")) };
    },
  } as GuardStore;
}
