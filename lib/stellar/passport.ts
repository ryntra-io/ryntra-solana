/**
 * The Stellar RWA Asset Passport.
 *
 * One asset, assembled from every source that has something true to say about
 * it, with each section carrying its own evidence state. **No section inherits
 * another's confidence**: a verified issuer flag does not make an unfetchable
 * reserve attestation any more real, and a missing oracle does not make the
 * clawback flag less certain. That is why this is a record of independent
 * sections rather than one object with one status.
 *
 * There is deliberately **no score**. Five states across a dozen fields is the
 * honest shape of what is known about an asset; collapsing it into "82/100"
 * would be an invention wearing a progress bar, and the number would be the one
 * thing anybody remembered.
 *
 * Two kinds of truth live here and are never mixed:
 *
 * - **Ledger facts** — issuer flags, supply, holder addresses, the SAC id. The
 *   network enforces these.
 * - **Issuer declarations** — everything from `stellar.toml`. The ledger proves
 *   only that the issuer claims the domain; the contents are the issuer talking
 *   about itself.
 */

import {
  type Evidence,
  isResolved,
  mapEvidence,
  resolved,
  unavailable,
  unknown,
} from "./evidence.ts";
import { type AssetIdentity, formatAsset, withContractId } from "./asset.ts";
import { type StellarNetwork } from "./network.ts";
import {
  type AssetStatistics,
  type IssuerControlEvidence,
  type LedgerParameters,
  type ReadOptions,
  readAssetStatistics,
  readIssuerControls,
  readLedgerParameters,
} from "./reads.ts";
import {
  type CurrencyDeclaration,
  type OrganizationDeclaration,
  fetchStellarToml,
  findCurrency,
  readOrganization,
} from "./toml.ts";

/**
 * What holding this asset demands of any account — not what one account holds.
 *
 * Without a connected wallet there is no "your balance", and inventing one is
 * exactly the fabrication this product exists to refuse. What can be stated
 * without a wallet is the asset's own requirements, and those are useful on
 * their own: a person deciding whether to accept this asset needs to know it
 * costs a reserve and may need the issuer's permission.
 */
export type HoldingDemand = Readonly<{
  trustlineRequired: boolean;
  /** The issuer must authorize each holder before they can receive it. */
  authorizationRequired: boolean;
  /** XLM locked while the trustline exists, read from the ledger. */
  reserveXlm: string | null;
  /** The issuer can freeze an existing holding. */
  freezable: boolean;
  /** The issuer can take the asset back out of a holder's account. */
  clawbackable: boolean;
}>;

/** Whether the issuer's own domain declares this asset at all. */
export type DeclarationLink = Readonly<{
  homeDomain: string;
  /** The domain published a `[[CURRENCIES]]` entry matching code **and** issuer. */
  declaresThisAsset: boolean;
  organization: OrganizationDeclaration;
  currency: CurrencyDeclaration | null;
}>;

export type PassportUnknown = Readonly<{
  field: string;
  state: "CONFLICTING" | "UNKNOWN" | "UNAVAILABLE";
  reason: string;
}>;

export type AssetPassport = Readonly<{
  network: StellarNetwork["id"];
  networkLabel: string;
  asset: AssetIdentity;
  assetId: string;
  issuerControls: Evidence<IssuerControlEvidence>;
  statistics: Evidence<AssetStatistics>;
  ledgerParameters: Evidence<LedgerParameters>;
  holdingDemand: Evidence<HoldingDemand>;
  declaration: Evidence<DeclarationLink>;
  /** Not built yet. Each states its own reason rather than rendering blank. */
  oracle: Evidence<never>;
  liquidity: Evidence<never>;
  portfolioImpact: Evidence<never>;
  /** Computed from the sections above. Never hand-written, never empty by default. */
  unknowns: readonly PassportUnknown[];
}>;

/** Sections in the order the Passport template renders them. */
const SECTION_LABELS = {
  issuerControls: "Issuer controls",
  statistics: "Asset statistics",
  ledgerParameters: "Ledger parameters",
  holdingDemand: "Holding requirement",
  declaration: "Issuer declaration",
  oracle: "Oracle",
  liquidity: "Liquidity and routes",
  portfolioImpact: "Portfolio impact",
} as const;

/**
 * Collect every section that did not resolve.
 *
 * Computed rather than curated, because a hand-written unknowns list is a list
 * of the gaps somebody remembered. This one cannot fall out of date: a section
 * that stops resolving appears here on the next render without anyone editing
 * a page.
 */
function collectUnknowns(sections: Record<string, Evidence<unknown>>): readonly PassportUnknown[] {
  const unknowns: PassportUnknown[] = [];
  for (const [key, evidence] of Object.entries(sections)) {
    if (isResolved(evidence)) continue;
    unknowns.push({
      field: SECTION_LABELS[key as keyof typeof SECTION_LABELS] ?? key,
      state: evidence.state,
      reason: evidence.reason,
    });
  }
  return unknowns;
}

/**
 * Derive what the asset demands of a holder from the issuer's flags.
 *
 * This is a projection of ledger facts, so it carries their provenance forward
 * rather than presenting itself as a separate observation. The reserve comes
 * from the ledger parameters read, and is `null` when that read failed — a
 * reserve stated without having read it would be a guess about the user's money.
 */
function deriveHoldingDemand(
  asset: AssetIdentity,
  controls: Evidence<IssuerControlEvidence>,
  parameters: Evidence<LedgerParameters>,
): Evidence<HoldingDemand> {
  if (!isResolved(controls)) {
    return unavailable(
      `Holding requirements are derived from the issuer's flags, and those are ${controls.state.toLowerCase()}: ${controls.reason}`,
      controls.sources,
    );
  }
  const reserveXlm = isResolved(parameters) ? parameters.data.baseReserveXlm : null;
  return mapEvidence(controls, (flags): HoldingDemand => ({
    trustlineRequired: !asset.native,
    authorizationRequired: flags.authRequired,
    reserveXlm: asset.native ? null : reserveXlm,
    freezable: flags.authRevocable,
    clawbackable: flags.clawbackEnabled,
  })) as Evidence<HoldingDemand>;
}

async function readDeclaration(
  controls: Evidence<IssuerControlEvidence>,
  asset: AssetIdentity,
  options: ReadOptions,
): Promise<Evidence<DeclarationLink>> {
  if (!isResolved(controls)) {
    return unavailable(`The issuer account could not be read, so its declared domain is unknown: ${controls.reason}`, controls.sources, options.now);
  }
  const homeDomain = controls.data.homeDomain;
  if (!homeDomain) {
    /* A real and meaningful state, not a failure: this issuer publishes no
       domain at all, so there is no self-description to read and nothing
       linking the asset to any organisation. */
    return unknown(
      "This issuer publishes no home domain on the ledger, so there is no stellar.toml to read and no organisation linked to the asset.",
      controls.sources,
      options.now,
    );
  }

  const source = { ref: `https://${homeDomain}/.well-known/stellar.toml`, label: `${homeDomain} stellar.toml (issuer's own declaration)` };
  const answer = await fetchStellarToml(homeDomain, options);
  if (!answer.ok) return unavailable(answer.reason, [source], options.now);

  const currency = asset.issuer ? findCurrency(answer.value, asset.code, asset.issuer) : null;
  return resolved({
    data: {
      homeDomain,
      /* The check worth making: a domain can exist, serve a valid document, and
         never mention this asset. That is not an error — it is a fact about how
         well the asset is documented by the party that issued it. */
      declaresThisAsset: currency !== null,
      organization: readOrganization(answer.value),
      currency,
    },
    sources: [source],
    observedAt: options.now ?? new Date(),
    maxAgeSeconds: 3_600,
    now: options.now,
  });
}

/**
 * Build the Passport for one asset.
 *
 * Reads run concurrently and independently: one slow or refusing source degrades
 * its own section and nothing else. The declaration is sequential because it
 * depends on a domain the ledger has to tell us first — which is the point of
 * SEP-1 and the only reason the domain means anything.
 */
export async function buildAssetPassport(
  network: StellarNetwork,
  asset: AssetIdentity,
  options: ReadOptions = {},
): Promise<AssetPassport> {
  const issuer = asset.issuer;
  const [issuerControls, statisticsRead, ledgerParameters] = await Promise.all([
    issuer
      ? readIssuerControls(network, issuer, options)
      : Promise.resolve(unknown("The native asset has no issuer account and therefore no issuer controls.", [], options.now)),
    readAssetStatistics(network, asset, options),
    readLedgerParameters(network, options),
  ]);

  const declaration = await readDeclaration(issuerControls, asset, options);

  /* The SAC id arrives with the statistics rather than from a separate lookup,
     so the identity is completed from what was already read instead of guessed
     or fetched twice. */
  const statistics = statisticsRead;
  const resolvedAsset =
    isResolved(statistics) && statistics.data.contractId ? withContractId(asset, statistics.data.contractId) : asset;

  const holdingDemand = deriveHoldingDemand(resolvedAsset, issuerControls, ledgerParameters);

  const oracle = unknown(
    "No price oracle is wired for Stellar yet. A price shown without a source and a timestamp would be worse than none.",
    [],
    options.now,
  ) as Evidence<never>;
  const liquidity = unknown(
    "Route and liquidity evidence needs an integration with a routing provider, which is not built. Ryntra will compare quotes, never produce them.",
    [],
    options.now,
  ) as Evidence<never>;
  const portfolioImpact = unknown(
    "Portfolio impact needs a connected wallet. Without one there is no position to measure, and estimating one would be an invention.",
    [],
    options.now,
  ) as Evidence<never>;

  const sections = { issuerControls, statistics, ledgerParameters, holdingDemand, declaration, oracle, liquidity, portfolioImpact };

  return {
    network: network.id,
    networkLabel: network.label,
    asset: resolvedAsset,
    assetId: formatAsset(resolvedAsset),
    issuerControls,
    statistics,
    ledgerParameters,
    holdingDemand,
    declaration,
    oracle,
    liquidity,
    portfolioImpact,
    unknowns: collectUnknowns(sections),
  };
}
