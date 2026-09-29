import type {
  AgentPassport,
  AgentPassportConflict,
  AgentPassportFact,
  AgentPassportSource,
} from "./agent-passport.ts";

export const AGENT_CAPABILITY_STATES = [
  "DECLARED",
  "DISCOVERED",
  "OBSERVED",
  "PROVEN",
  "UNAVAILABLE",
  "CONFLICTING",
  "UNKNOWN",
] as const;

export type AgentCapabilityState = (typeof AGENT_CAPABILITY_STATES)[number];

export type AgentCapabilityValidation = Readonly<{
  id: "address-binding" | "public-profile" | "protocol-publication" | "declared-endpoints" | "provider-metrics";
  label: string;
  state: AgentCapabilityState;
  claimed: "DECLARED" | "CONFLICTING" | "UNKNOWN";
  observed: AgentCapabilityState;
  sourceIds: readonly string[];
  authority: string;
  observedAt: string;
  verificationMethod: string;
  detail: string;
  limitation: string;
}>;

const PROFILE_FIELDS = new Set<AgentPassportFact["field"]>([
  "name",
  "description",
  "status",
  "agent_type",
  "domain_name",
  "prefix",
  "handle",
  "domain",
  "category",
]);

const PROTOCOL_FIELDS = new Set<AgentPassportFact["field"]>([
  "protocols",
  "protocol_manifest_name",
  "protocol_manifest_version",
  "protocol_manifest_digest",
  "protocol_manifest_description",
  "protocol_manifest_models",
]);

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function factsFor(
  passport: AgentPassport,
  matches: (fact: AgentPassportFact) => boolean,
): readonly AgentPassportFact[] {
  return passport.providerClaims.filter(matches);
}

function conflictsFor(
  passport: AgentPassport,
  matches: (conflict: AgentPassportConflict) => boolean,
): readonly AgentPassportConflict[] {
  return passport.conflicts.filter(matches);
}

function source(passport: AgentPassport, id: AgentPassportSource["id"]): AgentPassportSource {
  const value = passport.sources.find((entry) => entry.id === id);
  if (!value) throw new Error(`Agent Passport is missing canonical source ${id}.`);
  return value;
}

function supportingSourceIds(
  facts: readonly AgentPassportFact[],
  conflicts: readonly AgentPassportConflict[],
  fallback: readonly string[],
): readonly string[] {
  const ids = unique([
    ...facts.flatMap((fact) => fact.sourceIds),
    ...conflicts.flatMap((conflict) => conflict.sourceIds),
  ]);
  return ids.length ? ids : fallback;
}

function observedAt(passport: AgentPassport, sourceIds: readonly string[]): string {
  const timestamps = passport.sources
    .filter((entry) => sourceIds.includes(entry.id))
    .map((entry) => entry.observedAt)
    .sort();
  return timestamps[0] ?? passport.createdAt;
}

function claimState(
  facts: readonly AgentPassportFact[],
  conflicts: readonly AgentPassportConflict[],
): AgentCapabilityValidation["claimed"] {
  if (conflicts.length) return "CONFLICTING";
  return facts.length ? "DECLARED" : "UNKNOWN";
}

function sourceUnavailable(value: AgentPassportSource): boolean {
  return ["NOT_FOUND", "UNAVAILABLE", "SCHEMA_DRIFT"].includes(value.availability);
}

function validation(
  passport: AgentPassport,
  input: Omit<AgentCapabilityValidation, "observedAt">,
): AgentCapabilityValidation {
  return { ...input, observedAt: observedAt(passport, input.sourceIds) };
}

/**
 * Derive per-capability evidence states from one canonical Agent Passport.
 *
 * This projection intentionally has no aggregate, weight, rank or score. The
 * current exact-address adapter can observe public records and manifests, but
 * it invokes no agent and proves no control, so it can never emit PROVEN.
 */
export function deriveAgentCapabilities(passport: AgentPassport): readonly AgentCapabilityValidation[] {
  const registry = source(passport, "agentverse-registry");
  const search = source(passport, "agentverse-search");
  const manifests = source(passport, "agentverse-manifests");

  const addressFacts = factsFor(passport, (fact) => fact.field === "address");
  const addressConflicts = conflictsFor(
    passport,
    (conflict) => conflict.field === "address" || conflict.field === "request_address",
  );
  const addressMatch = passport.ryntraObservations.some(
    (observation) => observation.kind === "ADDRESS_MATCH" && observation.value === true,
  );
  const addressIds = supportingSourceIds(
    addressFacts,
    addressConflicts,
    ["agentverse-registry", "agentverse-search"],
  );
  const addressObserved: AgentCapabilityState = addressConflicts.length
    ? "CONFLICTING"
    : addressMatch
      ? "OBSERVED"
      : sourceUnavailable(registry) && sourceUnavailable(search)
        ? "UNAVAILABLE"
        : "UNKNOWN";

  const profileFacts = factsFor(passport, (fact) => PROFILE_FIELDS.has(fact.field));
  const profileConflicts = conflictsFor(
    passport,
    (conflict) => conflict.field !== "request_address" && PROFILE_FIELDS.has(conflict.field),
  );
  const profileIds = supportingSourceIds(profileFacts, profileConflicts, ["agentverse-search"]);
  const profileObserved: AgentCapabilityState = profileConflicts.length
    ? "CONFLICTING"
    : search.availability === "AVAILABLE"
      ? "DISCOVERED"
      : sourceUnavailable(search)
        ? "UNAVAILABLE"
        : "UNKNOWN";

  const protocolFacts = factsFor(passport, (fact) => PROTOCOL_FIELDS.has(fact.field));
  const protocolConflicts = conflictsFor(
    passport,
    (conflict) => conflict.field !== "request_address" && PROTOCOL_FIELDS.has(conflict.field),
  );
  const protocolIds = supportingSourceIds(protocolFacts, protocolConflicts, ["agentverse-manifests"]);
  const hasObservedManifest = manifests.members.some((member) => member.availability === "AVAILABLE");
  const protocolObserved: AgentCapabilityState = protocolConflicts.length
    ? "CONFLICTING"
    : hasObservedManifest
      ? "OBSERVED"
      : sourceUnavailable(manifests)
        ? "UNAVAILABLE"
        : "UNKNOWN";

  const endpointFacts = factsFor(passport, (fact) => fact.field === "endpoints");
  const endpointConflicts = conflictsFor(passport, (conflict) => conflict.field === "endpoints");
  const endpointIds = supportingSourceIds(endpointFacts, endpointConflicts, ["agentverse-registry"]);
  const endpointsWereFetched = passport.ryntraObservations.some(
    (observation) => observation.kind === "DECLARED_ENDPOINT_FETCH" && observation.value === true,
  );
  const endpointObserved: AgentCapabilityState = endpointConflicts.length
    ? "CONFLICTING"
    : endpointsWereFetched
      ? "OBSERVED"
      : sourceUnavailable(registry)
        ? "UNAVAILABLE"
        : "UNKNOWN";

  const metricFacts = factsFor(
    passport,
    (fact) => fact.declaration === "PROVIDER_REPORTED_METRIC",
  );
  const metricFields = new Set(metricFacts.map((fact) => fact.field));
  const metricConflicts = conflictsFor(
    passport,
    (conflict) => conflict.field !== "request_address" && metricFields.has(conflict.field),
  );
  const metricIds = supportingSourceIds(metricFacts, metricConflicts, ["agentverse-search"]);
  const metricObserved: AgentCapabilityState = metricConflicts.length
    ? "CONFLICTING"
    : sourceUnavailable(search)
      ? "UNAVAILABLE"
      : "UNKNOWN";

  return [
    validation(passport, {
      id: "address-binding",
      label: "Exact address binding",
      state: addressObserved === "OBSERVED" ? "OBSERVED" : addressObserved,
      claimed: claimState(addressFacts, addressConflicts),
      observed: addressObserved,
      sourceIds: addressIds,
      authority: "Agentverse public records plus Ryntra exact-address comparison",
      verificationMethod: "Exact public GET; returned addresses compared with the requested bech32 address.",
      detail: addressMatch
        ? "At least one normalized public record matched the exact requested address."
        : "No matching address observation was produced by this read.",
      limitation: "An address match is source observation, not proof that the operator controls the agent.",
    }),
    validation(passport, {
      id: "public-profile",
      label: "Public profile record",
      state: profileConflicts.length ? "CONFLICTING" : profileObserved,
      claimed: claimState(profileFacts, profileConflicts),
      observed: profileObserved,
      sourceIds: profileIds,
      authority: "Agentverse search record",
      verificationMethod: "Fixed-origin exact-address profile read and strict normalization.",
      detail: profileFacts.length
        ? `${profileFacts.length} provider-declared profile field${profileFacts.length === 1 ? "" : "s"} were retained.`
        : "No provider profile field was normalized.",
      limitation: "Discovery of a public record is not functional observation, endorsement or identity proof.",
    }),
    validation(passport, {
      id: "protocol-publication",
      label: "Protocol publication",
      state: protocolConflicts.length
        ? "CONFLICTING"
        : protocolObserved === "OBSERVED"
          ? "OBSERVED"
          : protocolObserved === "UNAVAILABLE"
            ? "UNAVAILABLE"
            : protocolFacts.length
              ? "DECLARED"
              : "UNKNOWN",
      claimed: claimState(protocolFacts, protocolConflicts),
      observed: protocolObserved,
      sourceIds: protocolIds,
      authority: "Agentverse registry declarations and bounded public manifests",
      verificationMethod: "Up to six canonical manifest digests fetched from the fixed official origin.",
      detail: hasObservedManifest
        ? `${manifests.members.filter((member) => member.availability === "AVAILABLE").length} manifest${manifests.members.filter((member) => member.availability === "AVAILABLE").length === 1 ? "" : "s"} were observed.`
        : "No protocol manifest was available to this read.",
      limitation: "A published manifest describes a protocol; it does not prove a successful invocation.",
    }),
    validation(passport, {
      id: "declared-endpoints",
      label: "Declared endpoints",
      state: endpointConflicts.length
        ? "CONFLICTING"
        : endpointFacts.length
          ? "DECLARED"
          : endpointObserved === "UNAVAILABLE"
            ? "UNAVAILABLE"
            : "UNKNOWN",
      claimed: claimState(endpointFacts, endpointConflicts),
      observed: endpointObserved,
      sourceIds: endpointIds,
      authority: "Agentverse registry declaration",
      verificationMethod: "Endpoint strings retained as non-clicking metadata; no endpoint request performed.",
      detail: endpointFacts.length
        ? "The provider declared at least one endpoint; Ryntra deliberately did not contact it."
        : "No endpoint declaration was normalized.",
      limitation: "Endpoint liveness and behavior are NOT TESTED.",
    }),
    validation(passport, {
      id: "provider-metrics",
      label: "Provider-reported metrics",
      state: metricConflicts.length
        ? "CONFLICTING"
        : metricFacts.length
          ? "DECLARED"
          : metricObserved === "UNAVAILABLE"
            ? "UNAVAILABLE"
            : "UNKNOWN",
      claimed: claimState(metricFacts, metricConflicts),
      observed: metricObserved,
      sourceIds: metricIds,
      authority: "Agentverse provider-reported fields",
      verificationMethod: "Values normalized with provider authority preserved; no independent outcome sample.",
      detail: metricFacts.length
        ? `${metricFacts.length} provider-reported metric${metricFacts.length === 1 ? "" : "s"} were retained.`
        : "No provider-reported metric was normalized.",
      limitation: "Provider metrics are not a Ryntra trust, safety, reputation or quality score.",
    }),
  ];
}

export function agentPassportDisplayName(passport: AgentPassport): string {
  for (const field of ["name", "handle"] as const) {
    const value = passport.providerClaims.find((fact) => fact.field === field)?.value;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Unnamed public record";
}

export function agentPassportSearchText(passport: AgentPassport): string {
  const searchableFields = new Set<AgentPassportFact["field"]>([
    "name",
    "handle",
    "domain",
    "category",
    "protocols",
    "protocol_manifest_name",
  ]);
  const facts = passport.providerClaims
    .filter((fact) => searchableFields.has(fact.field))
    .flatMap((fact) => Array.isArray(fact.value) ? fact.value : [String(fact.value)]);
  return [passport.request.address, ...facts].join(" ").toLocaleLowerCase();
}
