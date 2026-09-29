import { type Evidence, isResolved, resolved, unavailable, type EvidenceSources } from "./evidence.ts";
import { fetchStellarToml, findCurrency, readOrganization, type CurrencyDeclaration, type OrganizationDeclaration } from "./toml.ts";
import { readIssuerControls, readLedgerParameters, readNetworkPulse, type IssuerControlEvidence } from "./reads.ts";
import { readSoroswapHealth, type SoroswapHealth } from "./routes/soroswap.ts";
import type { StellarNetwork } from "./network.ts";

/**
 * The Observe slice's reads.
 *
 * Three surfaces — Issuers & Anchors, Markets & Liquidity, Providers — need the
 * same two things the Passport already reads per asset: what an issuer's own
 * account says about it, and what the issuer says about itself in its
 * `stellar.toml`. The difference is direction. A Passport starts from one asset;
 * these start from one **issuer** and ask what it has issued.
 *
 * ## The honest limit, stated in the type
 *
 * There is no asset index on Stellar that this product reads, so the reverse
 * lookup cannot be "every asset by issuer" — it is "every asset **we know
 * about**, by issuer". That is a real difference and it is carried in the data
 * as `scope: "CURATED"` rather than left for a page to remember to say.
 *
 * A surface built on this must not call itself a market. It is a curated set,
 * read live, and the word for that is a set.
 */

/** Where the list of assets came from, and therefore what it is not. */
export type ObserveScope = "CURATED";

export type IssuerAsset = Readonly<{
  code: string;
  id: string;
  /** What the asset is, factually. Never whether it is good. */
  note: string;
  /** The issuer's own declaration for this code, when its domain publishes one. */
  declaration: CurrencyDeclaration | null;
}>;

export type IssuerProfile = Readonly<{
  address: string;
  /** Powers the issuer holds over every holding of its assets. */
  controls: Evidence<IssuerControlEvidence>;
  /** What the issuer says about itself. Unverified by Ryntra, always. */
  organization: OrganizationDeclaration | null;
  /** Why the declaration is absent, when it is. */
  declarationReason: string | null;
  assets: readonly IssuerAsset[];
  scope: ObserveScope;
}>;

/**
 * One issuer, its account flags, its self-description, and what it has issued —
 * out of what we know about.
 *
 * The organisation block is **the issuer describing itself**. It carries no more
 * authority than a company's own website, which is exactly what it is, and every
 * surface that renders it has to say so. Circle's domain returning 403 during
 * the Passport work is the proof that this section fails on its own without
 * taking the ledger facts with it.
 */
export async function readIssuerProfile(
  network: StellarNetwork,
  address: string,
  assets: readonly Readonly<{ code: string; id: string; note: string }>[],
): Promise<IssuerProfile> {
  const controls = await readIssuerControls(network, address);

  const domain = isResolved(controls) ? controls.data.homeDomain : null;
  if (!domain) {
    return {
      address,
      controls,
      organization: null,
      declarationReason: isResolved(controls)
        ? "This issuer declares no home domain on its account, so there is no stellar.toml to read."
        : "The issuer account could not be read, so its home domain is unknown.",
      assets: assets.map((asset) => ({ ...asset, declaration: null })),
      scope: "CURATED",
    };
  }

  const toml = await fetchStellarToml(domain);
  if (!toml.ok) {
    return {
      address,
      controls,
      organization: null,
      declarationReason: `${domain} did not return a readable stellar.toml: ${toml.reason}`,
      assets: assets.map((asset) => ({ ...asset, declaration: null })),
      scope: "CURATED",
    };
  }

  return {
    address,
    controls,
    organization: readOrganization(toml.value),
    declarationReason: null,
    assets: assets.map((asset) => ({
      ...asset,
      declaration: findCurrency(toml.value, asset.code, address),
    })),
    scope: "CURATED",
  };
}

/** One external dependency, and whether it answered the request that built this page. */
export type ProviderStatus = Readonly<{
  id: string;
  label: string;
  /** What breaks when this is down, in one sentence. */
  role: string;
  /** What it answered, or why it did not. */
  state: "ANSWERING" | "DEGRADED" | "UNAVAILABLE" | "GATED";
  detail: string;
  /** The exact next step when this is not answering, or null. */
  recovery: string | null;
}>;

export type ProviderReport = Readonly<{
  providers: readonly ProviderStatus[];
  soroswap: Evidence<SoroswapHealth>;
}>;

/**
 * Every external source this workspace depends on, read at once.
 *
 * `GATED` is its own state and not a failure. A provider that is reachable but
 * needs a credential this deployment does not hold is not down, and reporting it
 * as down would send somebody to look for an outage that does not exist.
 */
export async function readProviderReport(network: StellarNetwork): Promise<ProviderReport> {
  const [pulse, parameters, soroswap] = await Promise.all([
    readNetworkPulse(network),
    readLedgerParameters(network),
    readSoroswapHealth(),
  ]);

  const providers: ProviderStatus[] = [
    {
      id: "stellar-rpc",
      label: "Stellar RPC",
      role: "Ledger sequence, protocol version and how far back this endpoint can answer.",
      state: isResolved(pulse) ? (pulse.state === "FRESH" ? "ANSWERING" : "DEGRADED") : "UNAVAILABLE",
      detail: isResolved(pulse)
        ? `Ledger ${pulse.data.ledgerSequence.toLocaleString("en-US")}, protocol v${pulse.data.protocolVersion}, observed ${pulse.ageSeconds}s ago.`
        : pulse.reason,
      recovery: isResolved(pulse) ? null : "Reload. If it persists, every ledger figure on this workspace is stale and the surfaces say so.",
    },
    {
      id: "horizon",
      label: "Horizon",
      role: "Base fee, base reserve, account and trustline reads, and the ledger read back after a submission.",
      state: isResolved(parameters) ? (parameters.state === "FRESH" ? "ANSWERING" : "DEGRADED") : "UNAVAILABLE",
      detail: isResolved(parameters)
        ? `Base fee ${parameters.data.baseFeeStroops} stroops, reserve ${parameters.data.baseReserveXlm} XLM, observed ${parameters.ageSeconds}s ago.`
        : parameters.reason,
      recovery: isResolved(parameters) ? null : "Reload. A payment can still be built; its fee ceiling falls back to the protocol default rather than a read.",
    },
    {
      id: "soroswap",
      label: "Soroswap",
      role: "Route and liquidity evidence across Soroban and classic venues. Ryntra normalizes what it says and never routes.",
      state: isResolved(soroswap)
        ? soroswap.data.configured
          ? soroswap.data.reachable
            ? "ANSWERING"
            : "DEGRADED"
          : "GATED"
        : "UNAVAILABLE",
      detail: isResolved(soroswap)
        ? `Indexer ${soroswap.data.reachable ? "reachable" : "unreachable"}; indexing ${soroswap.data.indexed.mainnet.join(", ") || "nothing"} on mainnet and ${soroswap.data.indexed.testnet.join(", ") || "nothing"} on testnet.${soroswap.data.configured ? "" : " Quotes, pools and prices need an API key this deployment does not hold."}`
        : soroswap.reason,
      recovery:
        isResolved(soroswap) && !soroswap.data.configured
          ? "Register at api.soroswap.finance/register, generate an API key, and set SOROSWAP_API_KEY. No agent may create that account."
          : isResolved(soroswap)
            ? null
            : "The provider did not answer at all. This is an outage rather than a missing credential.",
    },
  ];

  return { providers, soroswap };
}

/** Issuer domains, read per issuer, reported as one row each. */
export function issuerProviderRows(profiles: readonly IssuerProfile[]): readonly ProviderStatus[] {
  return profiles.map((profile) => {
    const domain = isResolved(profile.controls) ? profile.controls.data.homeDomain : null;
    return {
      id: `issuer-${profile.address}`,
      label: domain ?? `${profile.address.slice(0, 6)}…${profile.address.slice(-4)}`,
      role: "The issuer describing itself: asset declarations, redemption terms and organisation details.",
      state: profile.declarationReason === null ? ("ANSWERING" as const) : ("UNAVAILABLE" as const),
      detail:
        profile.declarationReason ??
        `Publishes a readable stellar.toml covering ${profile.assets.length} ${profile.assets.length === 1 ? "asset" : "assets"} we read.`,
      recovery:
        profile.declarationReason === null
          ? null
          : "Nothing to do here — a failing issuer domain costs only its own section, and every ledger fact about the asset still reads.",
    };
  });
}

/** A whole-report verdict, so a surface does not have to compute one. */
export function providerSummary(rows: readonly ProviderStatus[]): Readonly<{
  answering: number;
  gated: number;
  down: number;
  tone: "evidence" | "caution";
}> {
  const answering = rows.filter((row) => row.state === "ANSWERING").length;
  const gated = rows.filter((row) => row.state === "GATED").length;
  const down = rows.filter((row) => row.state === "UNAVAILABLE" || row.state === "DEGRADED").length;
  return { answering, gated, down, tone: down > 0 ? "caution" : "evidence" };
}

/** Re-exported so a surface imports one module rather than three. */
export { isResolved, resolved, unavailable };
export type { EvidenceSources };
