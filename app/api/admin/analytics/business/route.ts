import { NextResponse } from "next/server";

import { isBusinessRange, isBusinessScope, projectBusiness } from "@/lib/admin/business";
import { readBusinessInputs } from "@/lib/admin/business.server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { getAdminSession } from "@/lib/session";
import { fetchTokenCatalog } from "@/lib/solana/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The owner's business figures, from the product's own ledgers.
 *
 * Admin session only. The default scope leaves the owner's internal wallets
 * out; `scope=all` puts them back so a test swap can be seen without being
 * counted as a customer. Nothing here is cached: a figure is the store at the
 * moment of the request.
 *
 * Names for the feed come from the same token catalogue Activity uses: the
 * swap lane stores mints and no symbols, and a row that says `SOL → DezX…`
 * is a row the owner has to decode. A catalogue that does not answer leaves
 * the mint, which is honest and still readable.
 */
export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const range = url.searchParams.get("range") ?? "24h";
  const scope = url.searchParams.get("scope") ?? "external";
  if (!isBusinessRange(range) || !isBusinessScope(scope)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const inputs = await readBusinessInputs(getGuardRuntime().store, { now: new Date().toISOString(), range, scope, env: process.env });
  const mints = inputs.actions.flatMap((action) =>
    [action.out, action.in].flatMap((leg) => (leg && leg.mint && !leg.symbol ? [leg.mint] : [])),
  );
  const catalog = mints.length > 0 ? await fetchTokenCatalog(mints, 2_500) : null;
  const named = catalog && catalog.ok ? catalog.byMint : {};
  const withSymbol = (leg: (typeof inputs.actions)[number]["out"]) =>
    leg === null || leg.symbol || !leg.mint ? leg : { ...leg, symbol: named[leg.mint]?.symbol ?? null };
  const model = projectBusiness({
    ...inputs,
    actions: inputs.actions.map((action) => ({ ...action, out: withSymbol(action.out), in: withSymbol(action.in) })),
  });
  return NextResponse.json({ business: model }, { headers: { "Cache-Control": "private, no-store" } });
}
