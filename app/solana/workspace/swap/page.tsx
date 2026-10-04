import Link from "next/link";
import { redirect } from "next/navigation";

import { PanelGrid } from "@/app/shell/panel";
import { isSwapNetwork, resolveSwapAsset } from "@/lib/swap/catalog";
import { PageHead } from "../hub/parts.tsx";
import { solanaServerText } from "../i18n/server.ts";
import { SwapCard } from "../trade/swap-card.tsx";

import styles from "./swap-entry.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MINT_SHAPE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const AMOUNT_SHAPE = /^\d{1,20}(\.\d{1,18})?$/;

export async function generateMetadata() {
  const { text } = await solanaServerText();
  return { title: text("Swap") };
}

/**
 * Swap — one asset for another, inside Solana, and nothing else.
 *
 * Swap is Solana-only and Jupiter-only; Bridge is cross-chain and Relay-only,
 * with no automatic fallback between them. This page had spent one release
 * trying to answer two different questions from one form —
 * *«хочу USDC поміняти на SOL»* and *«у мене ETH на Base, хочу перенести кошти в
 * Solana»* — and the code underneath them was never the same code either: one
 * chain against two, one wallet format against two, one status model against a
 * cross-chain one with its own recovery.
 *
 * So there is **no network selector on this page at all**. `You pay` / `You
 * receive`, asset against asset, the way a person already understands it from
 * every Solana wallet they have used. What decides whether it can be done is
 * Jupiter's own live answer; a pair it cannot route today is an honest
 * *Route unavailable*, and nothing quietly becomes a cross-chain operation
 * behind the person's back.
 *
 * ## Old links still land somewhere true
 *
 * Old URLs lead to the new place. The unified form used to write
 * `?from=…&fa=…&to=…&ta=…` into the address bar for every pair it could carry,
 * so those links exist in bookmarks and in shared messages:
 *
 * - a **cross-network** pair is Bridge's work now and is redirected there with
 *   its pair and amount intact, rather than being silently reopened as
 *   something else;
 * - a **Solana** pair is this page's own work and is turned back into the
 *   `?in=`/`?out=` mints the card seeds from.
 */
export default async function SwapPage({
  searchParams,
}: {
  searchParams: Promise<{ in?: string; out?: string; amount?: string; from?: string; fa?: string; to?: string; ta?: string }>;
}) {
  const { text } = await solanaServerText();
  const params = await searchParams;

  const amount = params.amount && AMOUNT_SHAPE.test(params.amount) ? params.amount : undefined;

  /* A network named in the link and it is not Solana: that pair belongs to
     Bridge. Redirected rather than reinterpreted — reinterpreting is how a
     Robinhood Chain link silently reopened Solana once already. */
  const namedNetworks = [params.from, params.to].filter((value): value is string => typeof value === "string" && isSwapNetwork(value));
  if (namedNetworks.some((network) => network !== "solana")) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string" && value.length > 0) query.set(key, value);
    redirect(`/app/bridge${query.size > 0 ? `?${query.toString()}` : ""}`);
  }

  /* A Solana side may arrive as a bare mint (`?in=`) or as the catalogue's own
     name (`?from=solana&fa=SOL`). Both resolve to the mint the card seeds from,
     and anything that resolves to neither is simply not seeded — the card opens
     on its own default pair rather than on an error. */
  const mintOf = (mint: string | undefined, asset: string | undefined): string | undefined => {
    if (mint && MINT_SHAPE.test(mint)) return mint;
    if (!asset) return undefined;
    const resolved = resolveSwapAsset({ network: "solana", asset });
    return resolved?.solanaMint ?? undefined;
  };

  return (
    <>
      <PageHead title="Swap" />
      <div className="ry-money-flow">
        <PanelGrid label={text("Swap")}>
          <SwapCard initialSell={mintOf(params.in, params.fa)} initialBuy={mintOf(params.out, params.ta)} initialAmount={amount} />
        </PanelGrid>
        <p className={styles.out}>
          <span>{text("Funds on another network?")}</span>
          <Link className={styles.link} href="/app/bridge">
            {text("Bring them to Solana")}
            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
          </Link>
        </p>
      </div>
    </>
  );
}
