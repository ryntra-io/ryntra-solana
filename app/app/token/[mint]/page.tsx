import { notFound, redirect } from "next/navigation";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { launchConnection, launchNetwork } from "@/lib/launch/config.server";
import { readLaunchRecord } from "@/lib/launch/flow.server";
import { launchReadHooks } from "@/lib/launch/runtime.server";
import { parseSolanaAddress } from "@/lib/solana/address";
import { eventPageForMint } from "@/lib/stocks/company-page-route";
import { readStockUniverse } from "@/lib/stocks/universe.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * A token by its contract address — what the header's search opens when a
 * person pastes one (the menu v6.2). It finds the token's own
 * page: a tokenized stock's or a private company's page, a launch's page when
 * the token was launched on Ryntra, else the token's market in Spot, which
 * reads any mint the venue knows and says so when it knows none. A token
 * whose issuer opened a swap window opens its own page with the deadline and
 * the swap, never Spot (UX-504). An address that is not an address is the
 * cabinet's «not found».
 */
export default async function TokenByAddress({ params }: { params: Promise<{ mint: string }> }): Promise<never> {
  const { mint } = await params;
  if (!parseSolanaAddress(mint, "token").ok) notFound();

  const eventPage = eventPageForMint(mint);
  if (eventPage) redirect(eventPage);

  const stocks = await readStockUniverse();
  if (stocks.ok) {
    const row = stocks.universe.rows.find((candidate) => candidate.representation.mint === mint);
    if (row) redirect(`/app/stocks/${encodeURIComponent(row.representation.symbol)}`);
  }

  const network = launchNetwork();
  if (network) {
    const store = getGuardRuntime().store;
    const connection = launchConnection(network);
    const launched = await readLaunchRecord({ store, connection, ...launchReadHooks(network, connection, store) }, network.cluster, mint).catch(() => null);
    if (launched) redirect(`/app/launch/${mint}`);
  }

  redirect(`/app/spot?mint=${encodeURIComponent(mint)}`);
}
