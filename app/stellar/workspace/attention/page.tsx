import { readIssuerControls, readLedgerParameters, readNetworkPulse } from "@/lib/stellar/reads";
import { STELLAR_MAINNET } from "@/lib/stellar/network";
import { FEATURED_ASSETS } from "../assets/featured.ts";
import { AttentionConsole } from "./attention-console.tsx";

export const revalidate = 60;

export const metadata = { title: "Attention & Recovery" };

/**
 * Attention & Recovery — the reads.
 *
 * Same shape as the Overview's: the network and issuer reads happen on the
 * server, the wallet and the stored activity are client facts, and one shared
 * function combines them. There is exactly one list of what needs a person in
 * this product, and this page is the whole of it rather than a second opinion.
 */
export default async function StellarAttentionPage() {
  const issuerAddresses = [...new Set(FEATURED_ASSETS.map((asset) => asset.issuer))];

  const [pulse, parameters, ...controls] = await Promise.all([
    readNetworkPulse(STELLAR_MAINNET),
    readLedgerParameters(STELLAR_MAINNET),
    ...issuerAddresses.map((issuer) => readIssuerControls(STELLAR_MAINNET, issuer)),
  ]);

  const byIssuer = new Map(issuerAddresses.map((issuer, index) => [issuer, controls[index]]));
  const issuers = FEATURED_ASSETS.map((asset) => {
    const found = byIssuer.get(asset.issuer);
    if (!found) throw new Error(`No issuer read was scheduled for ${asset.id}.`);
    return { asset, controls: found };
  });

  return <AttentionConsole pulse={pulse} parameters={parameters} issuers={issuers} />;
}
