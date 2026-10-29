import { z } from "zod";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { fetchTokenCatalog } from "@/lib/solana/catalog";
import { limitsConnection } from "@/lib/solana/limits/chain.server";
import { mintDecimals } from "@/lib/solana/limits/review.server";
import { BASE58_ADDRESS, limitHeaders, openLimitGate } from "@/lib/solana/limits/http.server";
import { syncWalletLimits } from "@/lib/solana/limits/sync.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * «Мої ордери»: a wallet's limit orders at Jupiter and on DLMM, with Ryntra's
 * own records of what it relayed — open first, then filled, cancelled and
 * expired, each with the signatures of its life. Reading advances any record
 * the venues contradict. Orders are public on chain; nothing here is private
 * beyond what the wallet's address already shows.
 */
const RequestSchema = z.object({ owner: z.string().regex(BASE58_ADDRESS) }).strict();

export async function POST(request: Request) {
  const gate = await openLimitGate(request, RequestSchema, { acts: false, owner: (body) => body.owner });
  if (!gate.ok) return gate.response;
  const synced = await syncWalletLimits(getGuardRuntime().store, gate.body.owner);
  /* Every token the list names, with its symbol and its decimals — decimals from the chain, the symbol from the catalogue. */
  const mints = [...new Set(synced.orders.flatMap((order) => [order.baseMint, order.quoteMint]))].slice(0, 40);
  const connection = limitsConnection();
  const [catalog, decimals] = await Promise.all([fetchTokenCatalog(mints), Promise.all(mints.map((mint) => mintDecimals(mint, connection)))]);
  const tokens = Object.fromEntries(mints.map((mint, index) => [mint, { symbol: catalog.ok ? (catalog.byMint[mint]?.symbol ?? null) : null, decimals: decimals[index] ?? null }]));
  return Response.json({ orders: synced.orders, tokens, complete: synced.complete }, { headers: limitHeaders(gate.rate) });
}
