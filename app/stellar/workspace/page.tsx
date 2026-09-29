import { readIssuerControls, readLedgerParameters, readNetworkPulse } from "@/lib/stellar/reads";
import { STELLAR_MAINNET } from "@/lib/stellar/network";
import { STELLAR_MODULES } from "./hub/modules.ts";
import { FEATURED_ASSETS } from "./assets/featured.ts";
import { StellarOverview } from "./overview.tsx";

export const revalidate = 60;

export const metadata = { title: "Overview" };

/**
 * The Overview's reads.
 *
 * Everything the first screen shows is fetched here and handed to the view as
 * plain evidence envelopes, so the panels stay a client component (the shell's
 * grid, density and personalization are client state) while the network calls
 * stay on the server where they belong.
 *
 * **Issuers are deduplicated before they are read.** Four featured assets are
 * issued by three accounts — USTRY and CETES share Etherfuse — and issuing four
 * requests for three answers would put an avoidable request on Horizon every
 * sixty seconds forever. The map is keyed by issuer address, so adding a fifth
 * Etherfuse asset costs no additional read.
 *
 * A failed read is not a failed page. Each region resolves independently and
 * renders its own reason, which is the property the Asset Passport proved when
 * circle.com returned 403 and every chain fact on the page still rendered.
 */
export default async function StellarOverviewPage() {
  const issuerAddresses = [...new Set(FEATURED_ASSETS.map((asset) => asset.issuer))];

  const [pulse, parameters, ...controls] = await Promise.all([
    readNetworkPulse(STELLAR_MAINNET),
    readLedgerParameters(STELLAR_MAINNET),
    ...issuerAddresses.map((issuer) => readIssuerControls(STELLAR_MAINNET, issuer)),
  ]);

  const byIssuer = new Map(issuerAddresses.map((issuer, index) => [issuer, controls[index]]));

  const issuers = FEATURED_ASSETS.map((asset) => {
    const found = byIssuer.get(asset.issuer);
    /* The map is built from the same list this iterates, so a miss is a
       programming error rather than a network one — and it must not be papered
       over with an empty row that reads as "no powers". */
    if (!found) throw new Error(`No issuer read was scheduled for ${asset.id}.`);
    return { asset, controls: found };
  });

  const available = STELLAR_MODULES.filter((module) => module.maturity === "AVAILABLE").length;

  return (
    <StellarOverview
      pulse={pulse}
      parameters={parameters}
      issuers={issuers}
      moduleCounts={{ available, registered: STELLAR_MODULES.length - available }}
    />
  );
}
