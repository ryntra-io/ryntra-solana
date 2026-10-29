import { isSwapNetwork, resolveSwapAsset } from "@/lib/swap/catalog";
import { solanaServerText } from "../i18n/server.ts";
import { BridgeSurface } from "./bridge-surface.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const AMOUNT_SHAPE = /^\d{1,20}(\.\d{1,18})?$/;

export async function generateMetadata() {
  const { text } = await solanaServerText();
  return { title: text("Between networks") };
}

/**
 * Bridge — value moving between Solana and another network.
 *
 * A page again since 2026-09-10, and deliberately not the classical crypto
 * bridge it was the first time. Nobody is asked for a source chain, a
 * destination chain, a protocol, a route and a solver: they say what they have
 * and where they want it, and Relay finds an executable route.
 *
 * ## It opens on the direction that is actually used
 *
 * Ryntra is a Solana platform, so the main journey is **bringing money in** —
 * the page opens on another network's USDC against Solana, and moving funds out
 * is the same form pointed the other way rather than a second mode. The default
 * is a starting point, not a decision: every part of it is the person's to
 * change, and no amount is ever seeded.
 *
 * ## It may swap while it moves
 *
 * `ETH · Ethereum → SOL · Solana` is one operation here, not three the person
 * has to sequence through a stablecoin. That is what makes this a product
 * scenario rather than a mechanism: the word *Bridge* names what somebody wants
 * done, and whether Relay fills it as a bridge, a swap, or both is Relay's
 * business and the Review's disclosure.
 *
 * ## What it will not do
 *
 * It never reaches for Jupiter. A pair on one network is Swap's work and this
 * page says so rather than quietly carrying it — for the same reason Swap never
 * quietly starts a cross-chain operation. Each page owns one provider, one
 * failure and one status model, so Relay being down leaves Swap working and a
 * Jupiter problem leaves this page working.
 *
 * `ResumeUnfinished` sits above the form (inside the surface since B18) because a
 * cross-network transfer is the operation that can outlive the tab it started in. The engines remember an
 * unfinished one but only read that memory while mounted, and each mounts only
 * for its own pair — so the way back cannot depend on which pair happens to be
 * selected.
 */
export default async function BridgePage({
  searchParams,
}: {
  searchParams: Promise<{ amount?: string; from?: string; fa?: string; to?: string; ta?: string; in?: string; out?: string }>;
}) {
  const params = await searchParams;

  /* The same gate the card classifies with, rather than a written-out list of
     networks and assets: a side exists exactly when `resolveSwapAsset` says the
     asset is an asset on that network. A list is what went stale the day
     Robinhood Chain and USDG arrived, in both directions at once. */
  const networkOk = (value: string | undefined) => (value && isSwapNetwork(value) ? value : undefined);
  const assetOk = (network: string | undefined, asset: string | undefined) =>
    network && asset && isSwapNetwork(network) && resolveSwapAsset({ network, asset }) ? asset : undefined;

  const fromNetwork = networkOk(params.from);
  const toNetwork = networkOk(params.to);
  const seed = {
    /* Bring funds to Solana is the opening direction, so an unspecified link
       opens on Base USDC against Solana USDC — dollars stay dollars (decided
       17.10 for B18: «Між мережами» opens USDC → USDC, the pair that keeps the
       asset and moves through Circle). Both sides are seeds. */
    fromNetwork: fromNetwork ?? "base",
    fromAsset: assetOk(params.from, params.fa) ?? (fromNetwork === undefined ? "USDC" : undefined),
    toNetwork: toNetwork ?? "solana",
    toAsset: assetOk(params.to, params.ta) ?? (toNetwork === undefined ? "USDC" : undefined),
    amount: params.amount && AMOUNT_SHAPE.test(params.amount) ? params.amount : undefined,
  };

  /* The surface draws the whole page since B18: the heading once, the form and, beside it, the latest moves between
     networks (`../money/money-page.tsx`). */
  return <BridgeSurface seed={seed} />;
}
