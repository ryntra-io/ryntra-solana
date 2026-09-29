/**
 * The DD.xyz mapper — one provider answer in, one normalized shape out,
 * nothing else through.
 *
 * The rights map names the fields the mapper may read from each family; it
 * reads exactly those into the registry's metrics (a token) or the address
 * shape (a recipient) and lets the rest of the answer fall away — the
 * sniper and bundler address lists, the developer address, the labels, the
 * tag descriptions and every `details.*` block are gone by the time this
 * function returns. A figure the source did not answer is `null` with
 * coverage `absent` — never a zero.
 *
 * Two readings learned at the stage-A smoke and written here so they are
 * never re-learned: a top-ten share of `0` beside millions of holders is a
 * share the engine did not measure (any held token has a top-ten share above
 * zero), so a zero there is *not measured*; and a holder count of `0` for a
 * token that trades is the same absence. Time: `analysisTimestamp` is the
 * source's own statement of when the token was analysed and becomes
 * `observedAt`; the findings engine states `analyzed_at`. `expiresAt` is the
 * rights map's cache window for the family.
 *
 * Pure: an answer and a clock in, a shape out; no fetch, no key, no store.
 */

import { type AddressEvidence, type FindingsState, riskBandOf, type SanctionsState } from "../../address.ts";
import { familyRights, filterFields, DDXYZ_RIGHTS } from "../../rights.ts";
import { EVIDENCE_NETWORK, type EvidenceCoverage, type EvidenceMetricValue, type MarketEvidenceSnapshot } from "../../snapshot.ts";

export const DDXYZ_TRADING_LITE_FAMILY = "trading-lite";
export const DDXYZ_ADDRESSES_FAMILY = "addresses";
export const DDXYZ_SANCTIONS_FAMILY = "sanctions";

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function figure(id: EvidenceMetricValue["id"], unit: EvidenceMetricValue["unit"], value: number | null, note: string | null): EvidenceMetricValue {
  const coverage: EvidenceCoverage = value === null ? "absent" : note ? "partial" : "full";
  return { id, value, unit, window: "now", coverage, note };
}

/**
 * The Token-2022 transfer fee as the source reports it: `has_transfer_tax`
 * false is a zero (the token takes none); true with a percentage is the
 * percentage; true without one is a tax of unknown size — null, with the
 * note, never zero.
 */
export function transferTaxOf(taxes: unknown): Readonly<{ value: number | null; note: string | null }> {
  if (!taxes || typeof taxes !== "object") return { value: null, note: "The source did not answer the transfer tax." };
  const block = taxes as { has_transfer_tax?: unknown; transfer_tax_percentage?: unknown };
  const has = bool(block.has_transfer_tax);
  if (has === null) return { value: null, note: "The source did not answer the transfer tax." };
  if (!has) return { value: 0, note: null };
  const pct = number(block.transfer_tax_percentage);
  return pct === null ? { value: null, note: "The source reports a transfer tax without its size." } : { value: pct, note: null };
}

/**
 * Build the token snapshot from one Trading Lite answer. Returns `null`
 * when the answer carries none of the fields the rights map names — the
 * provider covers no such token — which the read reports as UNKNOWN rather
 * than as a card of nulls.
 */
export function mapTradingLiteSnapshot(input: { mint: string; fetchedAtMs: number; json: unknown }): MarketEvidenceSnapshot | null {
  const rights = familyRights(DDXYZ_RIGHTS, DDXYZ_TRADING_LITE_FAMILY);
  if (!rights) throw new Error("the DD.xyz rights map names no trading-lite family");
  if (!input.json || typeof input.json !== "object" || Array.isArray(input.json)) return null;
  const row = filterFields(rights, input.json as Record<string, unknown>);
  if (Object.keys(row).length === 0) return null;

  const warnings: string[] = [];
  const holders = number(row.TotalHolders);
  const holderCount = holders !== null && holders > 0 ? Math.round(holders) : null;
  const top10Raw = number(row.Top10Holders);
  /* A share the engine did not measure comes back as zero; a measured share
     of a held token is never zero. */
  const top10 = top10Raw !== null && top10Raw > 0 ? Math.min(100, top10Raw) : null;
  if (top10 === null) warnings.push("The source did not measure the top-ten share for this token.");
  if (holderCount === null) warnings.push("The source did not count the holders of this token.");
  const mintable = bool(row.mintable);
  const freezable = bool(row.freezable);
  if (mintable === null || freezable === null) warnings.push("The source did not answer the authority state.");
  const tax = transferTaxOf(row.buy_sell_taxes);
  const cohort = (value: unknown) => {
    const share = number(value);
    return share !== null && share >= 0 ? Math.min(100, share) : null;
  };

  const metrics: EvidenceMetricValue[] = [
    figure("top10_holder_share_pct", "percent", top10, top10 === null ? "The source did not measure the top-ten share." : null),
    figure("holder_count", "count", holderCount, holderCount === null ? "The source did not count the holders." : null),
    figure("mint_authority", "flag", mintable === null ? null : mintable ? 1 : 0, mintable === null ? "The source did not answer." : null),
    figure("freeze_authority", "flag", freezable === null ? null : freezable ? 1 : 0, freezable === null ? "The source did not answer." : null),
    figure("transfer_tax_pct", "percent", tax.value, tax.note),
    figure("sniper_holding_pct", "percent", cohort(row.SniperPercentageHolding), null),
    figure("bundler_holding_pct", "percent", cohort(row.BundlerPercentageHolding), null),
    figure("dev_holding_pct", "percent", cohort(row.DevHoldingPercentage), null),
  ];

  const analysedAt = number(row.analysisTimestamp);
  const observedAt = analysedAt !== null && analysedAt > 1_000_000_000_000 && analysedAt <= input.fetchedAtMs + 60_000 ? new Date(analysedAt).toISOString() : null;
  const cacheSeconds = rights.cacheSeconds.now ?? 600;

  return {
    provider: "ddxyz",
    subject: { network: EVIDENCE_NETWORK, mint: input.mint, symbol: null },
    window: "now",
    fetchedAt: new Date(input.fetchedAtMs).toISOString(),
    observedAt,
    providerLagSeconds: rights.providerLagSeconds.now ?? 0,
    expiresAt: new Date(input.fetchedAtMs + cacheSeconds * 1000).toISOString(),
    metrics,
    warnings,
    attribution: DDXYZ_RIGHTS.attribution,
    rightsPolicy: DDXYZ_RIGHTS.policy,
    families: [DDXYZ_TRADING_LITE_FAMILY],
  };
}

export type DdxyzFindingsAnswer =
  | Readonly<{ state: "answered"; json: unknown }>
  /** The engine refused the kind of address (`400 Unsupported risk entity`). */
  | Readonly<{ state: "unsupported"; reason: string }>
  | Readonly<{ state: "unavailable"; reason: string }>;

export type DdxyzSanctionsAnswer = Readonly<{ state: "answered"; json: unknown }> | Readonly<{ state: "unavailable"; reason: string }>;

/**
 * Build the address evidence from the two engines' answers. Returns `null`
 * only when neither engine answered at all — the read is then UNAVAILABLE
 * with the reason; an address one engine refuses and the other screens is
 * evidence with `findings.state: "unsupported"`, never a blank.
 */
export function mapAddressEvidence(input: { address: string; fetchedAtMs: number; findings: DdxyzFindingsAnswer; sanctions: DdxyzSanctionsAnswer }): AddressEvidence | null {
  const findingsRights = familyRights(DDXYZ_RIGHTS, DDXYZ_ADDRESSES_FAMILY);
  const sanctionsRights = familyRights(DDXYZ_RIGHTS, DDXYZ_SANCTIONS_FAMILY);
  if (!findingsRights || !sanctionsRights) throw new Error("the DD.xyz rights map names no addresses or sanctions family");
  if (input.findings.state === "unavailable" && input.sanctions.state === "unavailable") return null;

  const warnings: string[] = [];
  const families: string[] = [];

  let kind: AddressEvidence["subject"]["kind"] = "unknown";
  let observedAt: string | null = null;
  let findingsState: FindingsState = input.findings.state;
  let count: number | null = null;
  let high: number | null = null;
  let medium: number | null = null;
  let score: number | null = null;
  if (input.findings.state === "answered") {
    const row = input.findings.json && typeof input.findings.json === "object" && !Array.isArray(input.findings.json) ? filterFields(findingsRights, input.findings.json as Record<string, unknown>) : {};
    if (Object.keys(row).length === 0) {
      findingsState = "unavailable";
      warnings.push("The findings engine answered without the fields the product reads.");
    } else {
      families.push(DDXYZ_ADDRESSES_FAMILY);
      count = number(row.count) === null ? null : Math.max(0, Math.round(number(row.count) as number));
      high = number(row.high) === null ? null : Math.max(0, Math.round(number(row.high) as number));
      medium = number(row.medium) === null ? null : Math.max(0, Math.round(number(row.medium) as number));
      const raw = number(row.overallRisk);
      score = raw === null ? null : Math.min(100, Math.max(0, Math.round(raw * 10) / 10));
      const isContract = bool(row.isContract);
      const addressType = typeof row.addressType === "string" ? row.addressType : null;
      kind = isContract === true ? "program" : isContract === false || addressType === "EOA" ? "wallet" : "unknown";
      const analysed = typeof row.analyzed_at === "string" ? Date.parse(row.analyzed_at) : NaN;
      if (Number.isFinite(analysed) && analysed <= input.fetchedAtMs + 60_000) observedAt = new Date(analysed).toISOString();
    }
  } else {
    warnings.push(input.findings.state === "unsupported" ? "The source cannot analyse this kind of address; a program-owned account is not a wallet it reads." : `Findings: ${input.findings.reason}`);
  }

  let sanctionsState: SanctionsState = "unavailable";
  let related: boolean | null = null;
  if (input.sanctions.state === "answered") {
    const row = input.sanctions.json && typeof input.sanctions.json === "object" && !Array.isArray(input.sanctions.json) ? filterFields(sanctionsRights, input.sanctions.json as Record<string, unknown>) : {};
    const listed = bool(row.is_sanctioned);
    const status = typeof row.sanctions_status === "string" ? row.sanctions_status : null;
    if (listed === true) sanctionsState = "sanctioned";
    else if (status === "clean" && listed === false) sanctionsState = "clean";
    else if (status === "unknown") sanctionsState = "unknown";
    else {
      sanctionsState = "unavailable";
      warnings.push("The sanctions screening answered without a status the product reads.");
    }
    if (sanctionsState !== "unavailable") {
      families.push(DDXYZ_SANCTIONS_FAMILY);
      related = bool(row.is_sanctions_related);
    }
  } else {
    warnings.push(`Sanctions: ${input.sanctions.reason}`);
  }

  if (families.length === 0) return null;
  const cacheSeconds = Math.min(findingsRights.cacheSeconds.now ?? 3600, sanctionsRights.cacheSeconds.now ?? 3600);
  return {
    provider: "ddxyz",
    subject: { network: EVIDENCE_NETWORK, address: input.address, kind },
    fetchedAt: new Date(input.fetchedAtMs).toISOString(),
    observedAt,
    providerLagSeconds: findingsState === "answered" ? (findingsRights.providerLagSeconds.now ?? 0) : (sanctionsRights.providerLagSeconds.now ?? 0),
    expiresAt: new Date(input.fetchedAtMs + cacheSeconds * 1000).toISOString(),
    sanctions: { state: sanctionsState, related },
    findings: { state: findingsState, count, high, medium, score, band: riskBandOf(score) },
    warnings,
    attribution: DDXYZ_RIGHTS.attribution,
    rightsPolicy: DDXYZ_RIGHTS.policy,
    families,
  };
}
