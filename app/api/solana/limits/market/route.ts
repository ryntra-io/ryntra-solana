import { z } from "zod";

import { fetchTokenCatalog } from "@/lib/solana/catalog";
import { findDlmmLimitPool } from "@/lib/solana/limits/dlmm.server";
import { BASE58_ADDRESS, limitHeaders, openLimitGate } from "@/lib/solana/limits/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * What the limit ticket needs before anyone types: the pair's price now, in
 * the quote (Jupiter's USD prices of both sides), and whether a Meteora pool of
 * the pair takes limit orders — so DLMM is offered, or shown grey with why.
 */
const RequestSchema = z
  .object({
    owner: z.string().regex(BASE58_ADDRESS).nullable(),
    baseMint: z.string().regex(BASE58_ADDRESS),
    quoteMint: z.string().regex(BASE58_ADDRESS),
  })
  .strict();

export async function POST(request: Request) {
  const gate = await openLimitGate(request, RequestSchema, { acts: false, owner: (body) => body.owner ?? "" });
  if (!gate.ok) return gate.response;
  const { baseMint, quoteMint } = gate.body;
  const [catalog, pool] = await Promise.all([fetchTokenCatalog([baseMint, quoteMint]), findDlmmLimitPool(baseMint, quoteMint)]);
  const usd = (mint: string) => {
    if (!catalog.ok) return null;
    const value = Number(catalog.byMint[mint]?.usdPrice ?? Number.NaN);
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  const baseUsd = usd(baseMint);
  const quoteUsd = usd(quoteMint);
  const price = baseUsd !== null && quoteUsd !== null ? baseUsd / quoteUsd : pool.ok ? pool.activePrice : null;
  return Response.json(
    {
      price,
      baseUsd,
      quoteUsd,
      dlmm: pool.ok ? { available: true, pool: pool.pool, name: pool.name, activePrice: pool.activePrice, binStep: pool.binStep } : { available: false, code: pool.code },
      observedAt: new Date().toISOString(),
    },
    { headers: limitHeaders(gate.rate) },
  );
}
