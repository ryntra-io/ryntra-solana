/**
 * The production reads behind Нагляд over positions (`positions.server.ts`):
 * the chain, the shared universe, the account service for the Telegram
 * channel and the store's History. Apart from the reader, so a test composes
 * the reader with its own facts and never reaches an account service.
 */

import { readTelegramChannel } from "../account/notifications.ts";
import { accountByWallet } from "../account/rpc.ts";
import type { GuardStore } from "../guard/store.ts";
import { listSolanaWalletActions } from "../solana/action-ledger.ts";
import { fetchTokenCatalog } from "../solana/catalog.ts";
import { createSolanaRpcHandle, withRpcDiscipline } from "../solana/rpc.ts";
import { readStockUniverse } from "../stocks/universe.server.ts";
import type { PortfolioRiskDeps, TokenPrice } from "./portfolio-risk.server.ts";
import { readWalletHoldingsOnChain, type PositionsDeps } from "./positions.server.ts";

export function productionPositionsDeps(store: GuardStore): PositionsDeps {
  return {
    readHeld: readWalletHoldingsOnChain,
    readUniverse: readStockUniverse,
    readTelegram: async (owner) => {
      const accountId = await accountByWallet("solana", owner).catch(() => undefined);
      if (accountId === undefined) return null;
      if (accountId === null) return false;
      return (await readTelegramChannel(store, accountId)) !== null;
    },
    readRows: async (owner) => {
      try {
        return (await listSolanaWalletActions(store, { network: "mainnet", wallet: owner })).actions;
      } catch {
        return [];
      }
    },
  };
}

/** The catalogue answers this many mints a read. */
const CATALOGUE_READ = 50;

/**
 * The production reads behind «Ризик портфеля» (`portfolio-risk.server.ts`):
 * Нагляд's own, the wallet's SOL — one short read, three seconds without a
 * retry, as the token programs are read — and the catalogue's prices for
 * every other token, 50 a read, all at once, with whether the catalogue
 * verifies each and marks it suspicious. Any read of prices that fails is a
 * failed read of prices: a part of the wallet is never priced silently.
 */
export function productionPortfolioRiskDeps(store: GuardStore): PortfolioRiskDeps {
  return {
    ...productionPositionsDeps(store),
    readSolBalance: async (owner) => {
      const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 3_000, retries: 0 });
      const balance = await withRpcDiscipline(handle, (abortSignal) => handle.rpc.getBalance(owner as never, { commitment: "confirmed" }).send({ abortSignal }));
      return BigInt(balance.value);
    },
    readPrices: async (mints) => {
      const chunks: string[][] = [];
      for (let start = 0; start < mints.length; start += CATALOGUE_READ) chunks.push(mints.slice(start, start + CATALOGUE_READ));
      const reads = await Promise.all(chunks.map((chunk) => fetchTokenCatalog(chunk, 4_000)));
      const prices = new Map<string, TokenPrice>();
      for (const read of reads) {
        if (!read.ok) return null;
        for (const [mint, entry] of Object.entries(read.byMint)) {
          const usd = entry.usdPrice === null ? Number.NaN : Number(entry.usdPrice);
          prices.set(mint, { usd: Number.isFinite(usd) && usd > 0 ? usd : null, symbol: entry.symbol, name: entry.name, verified: entry.isVerified === true, suspicious: entry.isSuspicious === true });
        }
      }
      return prices;
    },
  };
}
